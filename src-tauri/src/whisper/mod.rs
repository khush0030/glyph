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

/// Run whisper.cpp over the samples (blocking, GPU via Metal).
/// `language` = None for auto-detect, or e.g. Some("hi") to force.
fn run_whisper(model_path: &str, samples: &[f32], language: Option<&str>) -> Result<Vec<Seg>, String> {
    let ctx = WhisperContext::new_with_params(model_path, WhisperContextParameters::default())
        .map_err(|e| format!("load model: {e}"))?;
    let mut state = ctx.create_state().map_err(|e| format!("whisper state: {e}"))?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(language); // None = auto (Hindi / English / Hinglish)
    params.set_translate(false); // never translate the transcript
    // Anti-hallucination: no cross-window context (kills repetition loops like
    // "the the the"), temperature fallback, and silence/low-confidence skipping.
    params.set_no_context(true);
    params.set_suppress_blank(true);
    params.set_suppress_nst(true);
    params.set_temperature(0.0);
    params.set_temperature_inc(0.2);
    params.set_entropy_thold(2.4);
    params.set_logprob_thold(-1.0);
    params.set_no_speech_thold(0.6);
    let threads = std::thread::available_parallelism()
        .map(|n| n.get() as i32)
        .unwrap_or(4)
        .clamp(1, 8);
    params.set_n_threads(threads);
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
    let mut segs: Vec<Seg> = Vec::new();
    for i in 0..n {
        let text = state.full_get_segment_text(i).unwrap_or_default().trim().to_string();
        // Drop empty / punctuation-only noise ("-", "...", etc.).
        if !text.chars().any(|c| c.is_alphanumeric()) {
            continue;
        }
        // Drop immediate repeats — the classic whisper hallucination loop.
        if segs.last().map(|p| p.text == text).unwrap_or(false) {
            continue;
        }
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
    Ok(drop_repetition_runs(segs))
}

/// Remove long runs where the same short line repeats (hallucination on silence):
/// if a line occurs ≥3 times within any 6-segment window, keep only the first.
fn drop_repetition_runs(segs: Vec<Seg>) -> Vec<Seg> {
    let mut out: Vec<Seg> = Vec::with_capacity(segs.len());
    for s in segs {
        let recent = out.iter().rev().take(6).filter(|p| p.text == s.text).count();
        if recent >= 2 {
            continue;
        }
        out.push(s);
    }
    out
}

/// Transcribe a finished recording WAV → segments. Downloads the model on first
/// use, then runs whisper.cpp off the async runtime.
#[tauri::command]
pub async fn transcribe_recording(
    app: AppHandle,
    wav_path: String,
    language: Option<String>,
) -> Result<Vec<Seg>, String> {
    let model = ensure_model(&app).await?;
    let model_str = model.to_string_lossy().to_string();
    let _ = app.emit(
        events::RECORDING_STATUS,
        serde_json::json!({"state":"transcribing"}),
    );
    let lang = language.filter(|s| !s.is_empty() && s != "auto");
    let segs = tauri::async_runtime::spawn_blocking(move || {
        let samples = read_wav_f32(&wav_path)?;
        if samples.is_empty() {
            return Ok::<Vec<Seg>, String>(vec![]);
        }
        run_whisper(&model_str, &samples, lang.as_deref())
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
        let wav = std::env::var("GLYPH_TEST_WAV")
            .unwrap_or_else(|_| format!("{base}/recordings/rec-1780916564408.wav"));
        let lang = std::env::var("GLYPH_TEST_LANG").ok();
        let samples = read_wav_f32(&wav).expect("read wav");
        eprintln!("samples: {} lang={:?}", samples.len(), lang);
        let segs = run_whisper(&model, &samples, lang.as_deref()).expect("transcribe");
        for s in &segs {
            eprintln!("[{}-{} {}] {}", s.start_ms, s.end_ms, s.lang, s.text);
        }
        assert!(!segs.is_empty(), "expected at least one segment");
    }
}
