//! Local Transcriber — whisper.cpp (large-v3-turbo, Metal) via whisper-rs.
//! Transcribe-after-stop: the recording is saved as a 16 kHz mono WAV, then
//! transcribed in one pass when the user stops. No cloud, no API key, no quota.
//! The ggml model is downloaded once to the app-data dir on first use.

use std::path::PathBuf;

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::events;

const MODEL_FILE: &str = "ggml-large-v3-turbo.bin";
const MODEL_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Seg {
    pub text: String,
    pub lang: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub is_final: bool,
}

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("models");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Download the ggml model to app-data/models on first use (≈1.6 GB), with
/// progress events. Returns the local path. No-op if already present.
async fn ensure_model(app: &AppHandle) -> Result<PathBuf, String> {
    let path = models_dir(app)?.join(MODEL_FILE);
    if path.exists() && std::fs::metadata(&path).map(|m| m.len() > 1_000_000).unwrap_or(false) {
        return Ok(path);
    }
    let _ = app.emit(
        events::RECORDING_STATUS,
        serde_json::json!({"state":"downloading_model","pct":0}),
    );
    let tmp = path.with_extension("part");
    let resp = reqwest::get(MODEL_URL)
        .await
        .map_err(|e| format!("model download failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("model download HTTP {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);
    let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;
    let mut last_pct = 0u64;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("download error: {e}"))?;
        use std::io::Write;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        if total > 0 {
            let pct = downloaded * 100 / total;
            if pct != last_pct {
                last_pct = pct;
                let _ = app.emit(
                    events::RECORDING_STATUS,
                    serde_json::json!({"state":"downloading_model","pct":pct}),
                );
            }
        }
    }
    drop(file);
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Read our 16 kHz mono i16 WAV into the f32 samples whisper expects.
fn read_wav_f32(path: &str) -> Result<Vec<f32>, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    // Find the "data" chunk; fall back to the standard 44-byte header.
    let data_start = bytes
        .windows(4)
        .position(|w| w == b"data")
        .map(|p| p + 8)
        .unwrap_or(44);
    if bytes.len() <= data_start {
        return Ok(vec![]);
    }
    let pcm = &bytes[data_start..];
    let n = pcm.len() / 2;
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let s = i16::from_le_bytes([pcm[i * 2], pcm[i * 2 + 1]]);
        out.push(s as f32 / 32768.0);
    }
    Ok(out)
}

/// Run whisper.cpp over the samples (blocking, GPU via Metal). language=auto.
fn run_whisper(model_path: &str, samples: &[f32]) -> Result<Vec<Seg>, String> {
    let ctx = WhisperContext::new_with_params(model_path, WhisperContextParameters::default())
        .map_err(|e| format!("load model: {e}"))?;
    let mut state = ctx.create_state().map_err(|e| format!("whisper state: {e}"))?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(None); // auto-detect (Hindi / English / Hinglish)
    params.set_translate(false); // never translate the transcript
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_print_special(false);

    state.full(params, samples).map_err(|e| format!("transcribe: {e}"))?;

    let lang = state
        .full_lang_id_from_state()
        .ok()
        .and_then(whisper_rs::get_lang_str)
        .unwrap_or("")
        .to_string();

    let n = state.full_n_segments().map_err(|e| e.to_string())?;
    let mut segs = Vec::new();
    for i in 0..n {
        let text = state.full_get_segment_text(i).unwrap_or_default().trim().to_string();
        if text.is_empty() {
            continue;
        }
        // t0/t1 are in centiseconds (10 ms units).
        let t0 = state.full_get_segment_t0(i).unwrap_or(0);
        let t1 = state.full_get_segment_t1(i).unwrap_or(t0);
        segs.push(Seg {
            text,
            lang: lang.clone(),
            start_ms: t0 * 10,
            end_ms: t1 * 10,
            is_final: true,
        });
    }
    Ok(segs)
}

/// Transcribe a finished recording WAV → segments. Downloads the model on first
/// use, then runs whisper.cpp off the async runtime.
#[tauri::command]
pub async fn transcribe_recording(app: AppHandle, wav_path: String) -> Result<Vec<Seg>, String> {
    let model = ensure_model(&app).await?;
    let model_str = model.to_string_lossy().to_string();
    let _ = app.emit(
        events::RECORDING_STATUS,
        serde_json::json!({"state":"transcribing"}),
    );
    let segs = tauri::async_runtime::spawn_blocking(move || {
        let samples = read_wav_f32(&wav_path)?;
        if samples.is_empty() {
            return Ok::<Vec<Seg>, String>(vec![]);
        }
        run_whisper(&model_str, &samples)
    })
    .await
    .map_err(|e| e.to_string())??;
    let _ = app.emit(
        events::RECORDING_STATUS,
        serde_json::json!({"state":"transcribed","segments":segs.len()}),
    );
    Ok(segs)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Runtime smoke test for whisper.cpp + Metal + model load + WAV decode.
    // Uses on-disk fixtures; run explicitly:
    //   cargo test --release whisper_smoke -- --ignored --nocapture
    #[test]
    #[ignore]
    fn whisper_smoke() {
        let home = std::env::var("HOME").unwrap();
        let base = format!("{home}/Library/Application Support/ai.oltaflock.glyph");
        let model = format!("{base}/models/{MODEL_FILE}");
        let wav = format!("{base}/recordings/rec-1780916564408.wav");
        let samples = read_wav_f32(&wav).expect("read wav");
        eprintln!("samples: {}", samples.len());
        let segs = run_whisper(&model, &samples).expect("transcribe");
        for s in &segs {
            eprintln!("[{}-{} {}] {}", s.start_ms, s.end_ms, s.lang, s.text);
        }
        assert!(!segs.is_empty(), "expected at least one segment");
    }
}
