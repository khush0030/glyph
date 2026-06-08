//! NoteGenerator — Anthropic Messages API. Folds the transcript + the user's
//! scratch notes into structured notes (SPEC §7): Summary, Key points,
//! Decisions, and Action items as structured rows { text, assignee?, dueHint? }.
//!
//! Hard rules baked into the prompt: NEVER translate (preserve each line's
//! language; Hindi stays in Devanagari), treat scratch as high-priority, terse.
//! Structured output is obtained via a forced tool call.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::keychain;

const API_URL: &str = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL: &str = "claude-haiku-4-5";

const SYSTEM_PROMPT: &str = "You clean raw meeting transcripts into structured notes by calling the emit_notes tool.

Rules:
- NEVER translate. Keep every line in the language it was spoken: Hindi in Devanagari, English in Latin, Hinglish as-is. Do not romanize Hindi.
- Treat the user's scratch notes as high-priority intent — they reflect what the user most cares about.
- For each action item, infer the assignee from context when possible and a due hint if one was mentioned.
- Be terse and concrete. No preamble, no filler.";

#[derive(Debug, Serialize, Deserialize)]
pub struct ActionItem {
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignee: Option<String>,
    #[serde(rename = "dueHint", alias = "due_hint")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_hint: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedNote {
    pub summary: String,
    // Serialized to the frontend as camelCase; deserialized from the tool's
    // snake_case output via the aliases.
    #[serde(alias = "key_points")]
    pub key_points: Vec<String>,
    pub decisions: Vec<String>,
    #[serde(alias = "action_items")]
    pub action_items: Vec<ActionItem>,
    #[serde(default)]
    pub model: String,
}

#[tauri::command]
pub async fn generate_notes(
    transcript: String,
    scratch: String,
    model: Option<String>,
) -> Result<GeneratedNote, String> {
    let key = keychain::get("anthropic_api_key")
        .map_err(|e| e.to_string())?
        .ok_or("No Anthropic API key — add it in Settings → API keys.")?;
    let model = model.unwrap_or_else(|| DEFAULT_MODEL.to_string());

    let user_prompt = format!(
        "TRANSCRIPT:\n{}\n\nSCRATCH NOTES (high priority):\n{}",
        if transcript.trim().is_empty() { "(none)" } else { transcript.trim() },
        if scratch.trim().is_empty() { "(none)" } else { scratch.trim() },
    );

    let tool = json!({
        "name": "emit_notes",
        "description": "Return the cleaned, structured meeting notes.",
        "input_schema": {
            "type": "object",
            "properties": {
                "summary": { "type": "string", "description": "2-4 sentence summary, in the source language(s)." },
                "key_points": { "type": "array", "items": { "type": "string" } },
                "decisions": { "type": "array", "items": { "type": "string" } },
                "action_items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "text": { "type": "string" },
                            "assignee": { "type": "string", "description": "Inferred owner, if any." },
                            "due_hint": { "type": "string", "description": "e.g. 'Fri', 'next week', if mentioned." }
                        },
                        "required": ["text"]
                    }
                }
            },
            "required": ["summary", "key_points", "decisions", "action_items"]
        }
    });

    let body = json!({
        "model": model,
        "max_tokens": 2000,
        "system": SYSTEM_PROMPT,
        "tools": [tool],
        "tool_choice": { "type": "tool", "name": "emit_notes" },
        "messages": [{ "role": "user", "content": user_prompt }]
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(API_URL)
        .header("x-api-key", key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    let status = resp.status();
    let v: Value = resp
        .json()
        .await
        .map_err(|e| format!("bad response: {e}"))?;
    if !status.is_success() {
        let msg = v
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("unknown error");
        return Err(format!("Anthropic API {status}: {msg}"));
    }

    // Find the forced tool_use block and parse its input into GeneratedNote.
    let input = v
        .get("content")
        .and_then(|c| c.as_array())
        .and_then(|blocks| {
            blocks
                .iter()
                .find(|b| b.get("type").and_then(|t| t.as_str()) == Some("tool_use"))
        })
        .and_then(|b| b.get("input"))
        .ok_or("no tool_use block in response")?;

    let mut note: GeneratedNote = serde_json::from_value(input.clone())
        .map_err(|e| format!("could not parse notes: {e}"))?;
    note.model = model;
    Ok(note)
}
