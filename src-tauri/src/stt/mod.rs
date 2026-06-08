//! Transcriber — ElevenLabs Scribe v2 Realtime WebSocket client (cloud default).
//! Sends 16 kHz mono PCM as base64 `input_audio_chunk` messages and forwards
//! `partial_transcript` / `committed_transcript` results to the UI as
//! `transcript://partial` / `transcript://final` events.
//!
//! language is left unset on the connection → Scribe auto-detects (Hindi /
//! English / Hinglish). We never force a language and never translate.

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

use crate::events;

const WS_URL: &str =
    "wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime&include_timestamps=true";

/// Handle to a live Scribe session. Push base64 PCM frames; drop to close.
pub struct ScribeHandle {
    audio_tx: mpsc::UnboundedSender<String>,
}

impl ScribeHandle {
    /// Forward one base64-encoded 16 kHz Int16 PCM frame to Scribe.
    pub fn push_b64(&self, b64: String) {
        let _ = self.audio_tx.send(b64);
    }
}

/// Connect, then spawn writer (PCM → WS) and reader (WS → UI events) tasks.
/// Dropping the returned handle ends the writer, which closes the socket and
/// stops the reader.
pub async fn connect(app: AppHandle, api_key: String) -> Result<ScribeHandle, String> {
    let mut req = WS_URL
        .into_client_request()
        .map_err(|e| format!("bad ws request: {e}"))?;
    req.headers_mut().insert(
        "xi-api-key",
        api_key.parse().map_err(|_| "invalid api key header".to_string())?,
    );

    let (ws, _resp) = connect_async(req)
        .await
        .map_err(|e| format!("scribe connect failed: {e}"))?;
    let (mut write, mut read) = ws.split();

    let (audio_tx, mut audio_rx) = mpsc::unbounded_channel::<String>();

    // Writer: drain PCM frames → input_audio_chunk messages.
    tauri::async_runtime::spawn(async move {
        while let Some(b64) = audio_rx.recv().await {
            let msg = json!({
                "message_type": "input_audio_chunk",
                "audio_base_64": b64,
                "sample_rate": 16_000,
            });
            if write.send(Message::Text(msg.to_string())).await.is_err() {
                break;
            }
        }
        // Channel closed (handle dropped) → flush a final commit and close.
        let commit = json!({
            "message_type": "input_audio_chunk",
            "audio_base_64": "",
            "commit": true,
            "sample_rate": 16_000,
        });
        let _ = write.send(Message::Text(commit.to_string())).await;
        let _ = write.send(Message::Close(None)).await;
    });

    // Reader: parse transcripts → UI events.
    let app_evt = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(Ok(msg)) = read.next().await {
            let Message::Text(text) = msg else { continue };
            let Ok(v) = serde_json::from_str::<Value>(&text) else {
                continue;
            };
            match v.get("message_type").and_then(|m| m.as_str()) {
                Some("session_started") => {
                    tracing::info!("scribe session started");
                }
                Some("partial_transcript") => {
                    emit_segment(&app_evt, events::TRANSCRIPT_PARTIAL, &v, false);
                }
                Some("committed_transcript")
                | Some("committed_transcript_with_timestamps") => {
                    emit_segment(&app_evt, events::TRANSCRIPT_FINAL, &v, true);
                }
                other => {
                    tracing::debug!("scribe msg: {:?}", other);
                }
            }
        }
        tracing::info!("scribe reader closed");
    });

    Ok(ScribeHandle { audio_tx })
}

/// Build a Segment-shaped payload and emit it. start/end come from the word
/// timestamps when present; language from the detected `language` field if any.
fn emit_segment(app: &AppHandle, event: &str, v: &Value, is_final: bool) {
    let text = v
        .get("text")
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_string();
    if text.is_empty() {
        return;
    }
    let words = v.get("words").and_then(|w| w.as_array());
    let start_ms = words
        .and_then(|w| w.first())
        .and_then(|w| w.get("start"))
        .and_then(|s| s.as_f64())
        .map(|s| (s * 1000.0) as i64)
        .unwrap_or(0);
    let end_ms = words
        .and_then(|w| w.last())
        .and_then(|w| w.get("end"))
        .and_then(|s| s.as_f64())
        .map(|s| (s * 1000.0) as i64)
        .unwrap_or(0);
    let lang = v
        .get("language")
        .and_then(|l| l.as_str())
        .unwrap_or("")
        .to_string();

    let _ = app.emit(
        event,
        json!({
            "text": text,
            "lang": lang,
            "startMs": start_ms,
            "endMs": end_ms,
            "isFinal": is_final,
        }),
    );
}
