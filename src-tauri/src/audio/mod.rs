//! AudioController — spawns the native Swift `audiocap` sidecar (stream mode)
//! and fans its output out three ways: persists a 16 kHz mono WAV, forwards
//! each PCM frame to the Scribe v2 Transcriber for live transcription (M2), and
//! re-emits the sidecar's RMS level / status to the UI.

mod wav;

use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

use crate::events;

/// Holds the live recording session, if any.
#[derive(Default)]
pub struct AudioState(pub Mutex<Option<Session>>);

pub struct Session {
    child: CommandChild,
    wav_path: String,
}

#[tauri::command]
pub fn start_recording(app: AppHandle, source: String) -> Result<String, String> {
    let state = app.state::<AudioState>();
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Err("already recording".into());
    }

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("recordings");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let wav_path = dir.join(format!("rec-{ts}.wav"));
    let wav_str = wav_path.to_string_lossy().to_string();

    tracing::info!("start_recording (source={source}) → {wav_str}");
    // The shell plugin resolves the sidecar as `<exe_dir>/<name>` (no dir
    // stripping), and Tauri installs it as the basename next to the executable
    // (target/debug/audiocap in dev, Contents/MacOS/audiocap in the bundle).
    let (rx, child) = app
        .shell()
        .sidecar("audiocap")
        .map_err(|e| e.to_string())?
        .spawn()
        .map_err(|e| e.to_string())?;

    // Local STT: persist the WAV + emit levels only. Transcription runs after
    // the user stops (whisper.cpp on the saved file) — no streaming, no cloud.
    let app_task = app.clone();
    let wav_for_task = wav_str.clone();
    tauri::async_runtime::spawn(pipeline(app_task, rx, wav_for_task));

    *guard = Some(Session {
        child,
        wav_path: wav_str.clone(),
    });
    Ok(wav_str)
}

#[tauri::command]
pub fn stop_recording(app: AppHandle) -> Result<String, String> {
    let state = app.state::<AudioState>();
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let session = guard.take().ok_or("not recording")?;
    let path = session.wav_path.clone();
    // Killing the sidecar ends its stdout → the pipeline task finalizes the WAV
    // and drops the Scribe handle (closing the socket).
    session.child.kill().map_err(|e| e.to_string())?;
    tracing::info!("stop_recording → saved {path}");
    Ok(path)
}

/// Consumes the sidecar's event stream until it exits.
async fn pipeline(
    app: AppHandle,
    mut rx: tauri::async_runtime::Receiver<CommandEvent>,
    wav_path: String,
) {
    let _ = app.emit(events::RECORDING_STATUS, serde_json::json!({"state":"recording"}));

    let mut wav = wav::WavWriter::create(Path::new(&wav_path), 16_000)
        .map_err(|e| tracing::error!("wav create failed: {e}"))
        .ok();

    let mut out_buf: Vec<u8> = Vec::new();
    let mut err_buf: Vec<u8> = Vec::new();

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => {
                out_buf.extend_from_slice(&bytes);
                drain_lines(&mut out_buf, |line| handle_pcm(line, wav.as_mut()));
            }
            CommandEvent::Stderr(bytes) => {
                err_buf.extend_from_slice(&bytes);
                drain_lines(&mut err_buf, |line| handle_status(&app, line));
            }
            CommandEvent::Terminated(_) => break,
            _ => {}
        }
    }

    if let Some(w) = wav.take() {
        let _ = w.finalize();
    }
    let _ = app.emit(events::RECORDING_STATUS, serde_json::json!({"state":"stopped"}));
}

/// Split `buf` on newlines, invoking `cb` per complete line; keep the remainder.
fn drain_lines(buf: &mut Vec<u8>, mut cb: impl FnMut(&[u8])) {
    let mut start = 0;
    while let Some(pos) = buf[start..].iter().position(|&b| b == b'\n') {
        let end = start + pos;
        cb(&buf[start..end]);
        start = end + 1;
    }
    if start > 0 {
        buf.drain(..start);
    }
}

/// A `{"kind":"pcm","b64":...}` line → append to the WAV.
fn handle_pcm(line: &[u8], wav: Option<&mut wav::WavWriter>) {
    let Ok(v) = serde_json::from_slice::<Value>(line) else {
        return;
    };
    if v.get("kind").and_then(|k| k.as_str()) != Some("pcm") {
        return;
    }
    let Some(b64) = v.get("b64").and_then(|b| b.as_str()) else {
        return;
    };
    if let Some(w) = wav {
        if let Ok(pcm) = base64::engine::general_purpose::STANDARD.decode(b64) {
            let _ = w.write_pcm(&pcm);
        }
    }
}

/// A sidecar stderr line (status/level/error JSON) → log + UI events.
fn handle_status(app: &AppHandle, line: &[u8]) {
    let Ok(v) = serde_json::from_slice::<Value>(line) else {
        return;
    };
    match v.get("kind").and_then(|k| k.as_str()) {
        Some("level") => {
            if let Some(rms) = v.get("rms").and_then(|r| r.as_f64()) {
                let _ = app.emit(events::RECORDING_LEVEL, serde_json::json!({ "rms": rms }));
            }
        }
        Some("status") | Some("ready") | Some("error") => {
            tracing::info!("audiocap: {}", String::from_utf8_lossy(line));
            let _ = app.emit(events::RECORDING_STATUS, v);
        }
        _ => {}
    }
}
