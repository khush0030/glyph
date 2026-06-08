//! AudioController — spawns the native Swift `audiocap` sidecar and bridges it
//! to the UI. M1: sidecar records to a 16 kHz mono WAV in app data; Rust reads
//! its JSON stderr, logs the live RMS level and re-emits it as
//! `recording://level` / `recording://status`. Live PCM streaming to the
//! Transcriber lands in M2.

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

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

    // Manual is mic-first; the sidecar still attempts the system tap and falls
    // back to mic-only if it is unavailable.
    tracing::info!("start_recording (source={source}) → {wav_str}");
    let (mut rx, child) = app
        .shell()
        .sidecar("binaries/audiocap")
        .map_err(|e| e.to_string())?
        .args(["--wav", &wav_str])
        .spawn()
        .map_err(|e| e.to_string())?;

    let app_evt = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                // The shell plugin emits one stderr line per event (newline
                // stripped) — each is a JSON status/level/error object.
                CommandEvent::Stderr(line) => handle_line(&app_evt, &line),
                CommandEvent::Terminated(_) => {
                    let _ = app_evt
                        .emit(events::RECORDING_STATUS, serde_json::json!({"state": "stopped"}));
                    break;
                }
                _ => {}
            }
        }
    });

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
    // SIGKILL is fine: the sidecar patches the WAV header every frame, so the
    // file on disk is always a valid, playable 16 kHz mono WAV.
    session.child.kill().map_err(|e| e.to_string())?;
    tracing::info!("stop_recording → saved {path}");
    Ok(path)
}

fn handle_line(app: &AppHandle, line: &[u8]) {
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
