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

const SYSTEM_PROMPT: &str = "You convert raw meeting transcripts into clean, structured notes by calling the emit_notes tool. The full verbatim transcript is saved separately, so your job is a SHARP SUMMARY — capture what someone needs to remember and act on, not every sentence.

CONCISE BUT COMPLETE — capture what matters, drop the rest:
- summary: 2-4 sentences. The essence of the meeting. Not a wall of text.
- key_points: only the important, distinct facts and topics. Merge related ideas into one bullet. The vital few, not an exhaustive list — aim for roughly 4-8.
- decisions: only actual decisions reached.
- open_questions: only genuinely unresolved important questions. Often few or none.
- action_items: concrete tasks someone must do, with owner + deadline if stated.

NO REDUNDANCY: each fact belongs in ONE section only. Do not restate the summary as key points, or repeat a decision as a key point or action item. If it is a decision, it is not also a key point.

FAITHFULNESS:
- NEVER invent, assume, or embellish. Only what is in the transcript or scratch notes.
- NEVER translate. Keep every line in the language spoken: Hindi in Devanagari, English in Latin, Hinglish as-is. Do not romanize Hindi.
- Treat the user's scratch notes as high-priority intent.
- If an action item's owner or deadline is not stated, OMIT that field. Never output placeholders like 'unknown', 'N/A', 'TBD', 'none', or '<UNKNOWN>'.

Prefer fewer, denser bullets. A reader should scan the whole note in under a minute. Important nuance lives in the transcript; the notes are the summary.";

/// Drop assignee/due-hint values that are empty or LLM placeholders ("unknown",
/// "N/A", …) so they never leak into the UI or exported files.
fn clean_field(v: Option<String>) -> Option<String> {
    v.map(|s| s.trim().to_string()).filter(|s| {
        let l = s.to_ascii_lowercase();
        !s.is_empty()
            && !matches!(
                l.as_str(),
                "unknown" | "<unknown>" | "n/a" | "na" | "none" | "tbd" | "tbc" | "-" | "?"
            )
    })
}

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
    #[serde(default, alias = "open_questions")]
    pub open_questions: Vec<String>,
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
                "summary": { "type": "string", "description": "Concise but complete summary covering all major topics, in the source language(s)." },
                "key_points": { "type": "array", "items": { "type": "string" }, "description": "Every substantive point, detail, number, and discussion item. Be thorough — do not omit." },
                "decisions": { "type": "array", "items": { "type": "string" }, "description": "Every decision reached, including tentative/conditional ones." },
                "open_questions": { "type": "array", "items": { "type": "string" }, "description": "Questions or issues raised but left unresolved — things that still need an answer or follow-up." },
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
            "required": ["summary", "key_points", "decisions", "open_questions", "action_items"]
        }
    });

    let body = json!({
        "model": model,
        "max_tokens": 8000,
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
    for item in &mut note.action_items {
        item.assignee = clean_field(item.assignee.take());
        item.due_hint = clean_field(item.due_hint.take());
    }
    note.model = model;
    Ok(note)
}
