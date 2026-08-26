//! Cloud Transcriber — Sarvam AI batch speech-to-text (saaras:v3).
//!
//! Transcribe-after-stop, same shape as the local Whisper path: the finished
//! 16 kHz mono WAV is uploaded as a one-file batch job, polled to completion,
//! and the output JSON is mapped to `Seg`s. Batch (not the 30 s sync endpoint)
//! because meetings run long (up to 2 h/file) and only batch offers speaker
//! diarization. Language stays `unknown` (auto) unless the user forces one;
//! mode = transcribe, so nothing is translated (CLAUDE.md rule #2).
//!
//! Flow: POST job/v1 → POST upload-files (presigned PUT) → POST start →
//! GET status until Completed → POST download-files → GET output JSON.

use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::events;
use crate::whisper::Seg;

const BASE: &str = "https://api.sarvam.ai";
const MODEL: &str = "saaras:v3";
const POLL_EVERY: Duration = Duration::from_secs(3);
const POLL_TIMEOUT: Duration = Duration::from_secs(20 * 60);

/// Map the app's language setting ("hi" / "en" / None=auto) to Sarvam BCP-47.
fn language_code(lang: Option<&str>) -> &'static str {
    match lang {
        Some("hi") => "hi-IN",
        Some("en") => "en-IN",
        _ => "unknown",
    }
}

fn status(app: &AppHandle, state: &str) {
    let _ = app.emit(events::RECORDING_STATUS, json!({ "state": state }));
}

async fn api_error(resp: reqwest::Response, what: &str) -> String {
    let code = resp.status();
    let body = resp.text().await.unwrap_or_default();
    let msg = serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|v| {
            v.get("error")
                .and_then(|e| e.get("message").or(Some(e)))
                .or_else(|| v.get("detail"))
                .map(|m| m.to_string())
        })
        .unwrap_or(body);
    format!("Sarvam {what} {code}: {msg}")
}

/// Upload + transcribe one WAV via a Sarvam batch job. Emits recording://status
/// ("uploading" → "transcribing") along the way.
pub async fn transcribe_wav(
    app: &AppHandle,
    api_key: &str,
    wav_path: &str,
    language: Option<&str>,
) -> Result<Vec<Seg>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;
    let auth = |r: reqwest::RequestBuilder| r.header("api-subscription-key", api_key);

    // 1. Create the job.
    status(app, "uploading");
    let body = json!({
        "job_parameters": {
            "model": MODEL,
            "mode": "transcribe",
            "language_code": language_code(language),
            "with_timestamps": true,
            "with_diarization": true,
        }
    });
    let resp = auth(client.post(format!("{BASE}/speech-to-text/job/v1")))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Sarvam create job: {e}"))?;
    if !resp.status().is_success() {
        return Err(api_error(resp, "create job").await);
    }
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    let job_id = v
        .get("job_id")
        .and_then(|j| j.as_str())
        .ok_or("Sarvam create job: no job_id")?
        .to_string();

    // 2. Presigned upload URL → PUT the WAV (Azure block blob).
    let file_name = "0.wav";
    let resp = auth(client.post(format!("{BASE}/speech-to-text/job/v1/upload-files")))
        .json(&json!({ "job_id": job_id, "files": [file_name] }))
        .send()
        .await
        .map_err(|e| format!("Sarvam upload-files: {e}"))?;
    if !resp.status().is_success() {
        return Err(api_error(resp, "upload-files").await);
    }
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    let upload_url = v
        .get("upload_urls")
        .and_then(|u| u.get(file_name))
        .and_then(|u| u.get("file_url"))
        .and_then(|u| u.as_str())
        .ok_or("Sarvam upload-files: no upload url")?
        .to_string();
    let bytes = tokio::fs::read(wav_path)
        .await
        .map_err(|e| format!("read wav: {e}"))?;
    let resp = client
        .put(&upload_url)
        .header("x-ms-blob-type", "BlockBlob")
        .header("Content-Type", "audio/wav")
        .body(bytes)
        .send()
        .await
        .map_err(|e| format!("Sarvam upload: {e}"))?;
    if !resp.status().is_success() {
        return Err(api_error(resp, "upload").await);
    }

    // 3. Start.
    let resp = auth(client.post(format!("{BASE}/speech-to-text/job/v1/{job_id}/start")))
        .send()
        .await
        .map_err(|e| format!("Sarvam start: {e}"))?;
    if !resp.status().is_success() {
        return Err(api_error(resp, "start").await);
    }

    // 4. Poll.
    status(app, "transcribing");
    let started = std::time::Instant::now();
    let output_file = loop {
        tokio::time::sleep(POLL_EVERY).await;
        let resp = auth(client.get(format!("{BASE}/speech-to-text/job/v1/{job_id}/status")))
            .send()
            .await
            .map_err(|e| format!("Sarvam status: {e}"))?;
        if !resp.status().is_success() {
            return Err(api_error(resp, "status").await);
        }
        let v: Value = resp.json().await.map_err(|e| e.to_string())?;
        let state = v.get("job_state").and_then(|s| s.as_str()).unwrap_or("");
        tracing::info!("sarvam job {job_id}: {state}");
        match state {
            "Completed" | "PartiallyCompleted" => {
                let out = v
                    .get("job_details")
                    .and_then(|d| d.as_array())
                    .and_then(|d| d.first())
                    .and_then(|d| d.get("outputs"))
                    .and_then(|o| o.as_array())
                    .and_then(|o| o.first())
                    .and_then(|o| o.get("file_name"))
                    .and_then(|f| f.as_str())
                    .map(String::from);
                match out {
                    Some(f) => break f,
                    None => {
                        let err = v
                            .get("job_details")
                            .and_then(|d| d.as_array())
                            .and_then(|d| d.first())
                            .and_then(|d| d.get("error_message"))
                            .and_then(|e| e.as_str())
                            .unwrap_or("no output file");
                        return Err(format!("Sarvam transcription failed: {err}"));
                    }
                }
            }
            "Failed" => {
                let err = v
                    .get("error_message")
                    .and_then(|e| e.as_str())
                    .unwrap_or("unknown error");
                return Err(format!("Sarvam job failed: {err}"));
            }
            _ => {}
        }
        if started.elapsed() > POLL_TIMEOUT {
            return Err("Sarvam job timed out".into());
        }
    };

    // 5. Download the output JSON.
    let resp = auth(client.post(format!("{BASE}/speech-to-text/job/v1/download-files")))
        .json(&json!({ "job_id": job_id, "files": [output_file] }))
        .send()
        .await
        .map_err(|e| format!("Sarvam download-files: {e}"))?;
    if !resp.status().is_success() {
        return Err(api_error(resp, "download-files").await);
    }
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    let dl_url = v
        .get("download_urls")
        .and_then(|u| u.get(&output_file))
        .and_then(|u| u.get("file_url"))
        .and_then(|u| u.as_str())
        .ok_or("Sarvam download-files: no download url")?
        .to_string();
    let resp = client
        .get(&dl_url)
        .send()
        .await
        .map_err(|e| format!("Sarvam download: {e}"))?;
    if !resp.status().is_success() {
        return Err(api_error(resp, "download").await);
    }
    let out: Value = resp.json().await.map_err(|e| format!("bad output json: {e}"))?;
    Ok(segments_from_output(&out))
}

/// Map Sarvam's output JSON to segments. Prefers diarized entries (speaker-
/// labelled when >1 speaker), then chunk timestamps, then the whole transcript.
fn segments_from_output(out: &Value) -> Vec<Seg> {
    let lang = out
        .get("language_code")
        .and_then(|l| l.as_str())
        .map(|l| l.split('-').next().unwrap_or(l).to_string())
        .filter(|l| l != "unknown")
        .unwrap_or_default();

    if let Some(entries) = out
        .get("diarized_transcript")
        .and_then(|d| d.get("entries"))
        .and_then(|e| e.as_array())
    {
        let speakers: std::collections::BTreeSet<&str> = entries
            .iter()
            .filter_map(|e| e.get("speaker_id").and_then(|s| s.as_str()))
            .collect();
        let label = speakers.len() > 1;
        let segs: Vec<Seg> = entries
            .iter()
            .filter_map(|e| {
                let text = e.get("transcript")?.as_str()?.trim();
                if !text.chars().any(|c| c.is_alphanumeric()) {
                    return None;
                }
                let speaker = e.get("speaker_id").and_then(|s| s.as_str()).unwrap_or("");
                let text = if label && !speaker.is_empty() {
                    format!("{}: {text}", speaker_label(speaker))
                } else {
                    text.to_string()
                };
                Some(Seg {
                    text,
                    lang: lang.clone(),
                    start_ms: secs_ms(e.get("start_time_seconds")),
                    end_ms: secs_ms(e.get("end_time_seconds")),
                    is_final: true,
                })
            })
            .collect();
        if !segs.is_empty() {
            return segs;
        }
    }

    if let Some(ts) = out.get("timestamps") {
        let words = ts.get("words").and_then(|w| w.as_array());
        let starts = ts.get("start_time_seconds").and_then(|w| w.as_array());
        let ends = ts.get("end_time_seconds").and_then(|w| w.as_array());
        if let (Some(words), Some(starts), Some(ends)) = (words, starts, ends) {
            let segs: Vec<Seg> = words
                .iter()
                .enumerate()
                .filter_map(|(i, w)| {
                    let text = w.as_str()?.trim();
                    if !text.chars().any(|c| c.is_alphanumeric()) {
                        return None;
                    }
                    Some(Seg {
                        text: text.to_string(),
                        lang: lang.clone(),
                        start_ms: secs_ms(starts.get(i)),
                        end_ms: secs_ms(ends.get(i)),
                        is_final: true,
                    })
                })
                .collect();
            if !segs.is_empty() {
                return segs;
            }
        }
    }

    let text = out
        .get("transcript")
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .trim();
    if text.is_empty() {
        return vec![];
    }
    vec![Seg {
        text: text.to_string(),
        lang,
        start_ms: 0,
        end_ms: 0,
        is_final: true,
    }]
}

fn secs_ms(v: Option<&Value>) -> i64 {
    v.and_then(|s| s.as_f64()).map(|s| (s * 1000.0) as i64).unwrap_or(0)
}

/// "SPEAKER_00" / "speaker_1" / "0" → "Speaker 1".
fn speaker_label(id: &str) -> String {
    let digits: String = id.chars().filter(|c| c.is_ascii_digit()).collect();
    match digits.parse::<u32>() {
        Ok(n) => format!("Speaker {}", n + 1),
        Err(_) => id.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_diarized_output() {
        let out = json!({
            "transcript": "hello there kaise ho",
            "language_code": "hi-IN",
            "diarized_transcript": { "entries": [
                { "transcript": "hello there", "start_time_seconds": 0.5, "end_time_seconds": 1.2, "speaker_id": "SPEAKER_00" },
                { "transcript": "kaise ho", "start_time_seconds": 1.5, "end_time_seconds": 2.0, "speaker_id": "SPEAKER_01" }
            ]}
        });
        let s = segments_from_output(&out);
        assert_eq!(s.len(), 2);
        assert_eq!(s[0].text, "Speaker 1: hello there");
        assert_eq!(s[0].start_ms, 500);
        assert_eq!(s[1].text, "Speaker 2: kaise ho");
        assert_eq!(s[0].lang, "hi");
    }

    #[test]
    fn single_speaker_unlabelled_and_fallbacks() {
        let out = json!({
            "transcript": "just me",
            "diarized_transcript": { "entries": [
                { "transcript": "just me", "start_time_seconds": 0.0, "end_time_seconds": 1.0, "speaker_id": "SPEAKER_00" }
            ]}
        });
        assert_eq!(segments_from_output(&out)[0].text, "just me");
        let out = json!({ "transcript": "plain", "language_code": "unknown" });
        let s = segments_from_output(&out);
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].text, "plain");
        assert_eq!(s[0].lang, "");
    }
}
