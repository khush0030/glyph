//! NoteGenerator — Anthropic Messages API. Folds the transcript + the user's
//! scratch notes into structured notes (SPEC §7): Summary, Key points,
//! Decisions, and Action items as structured rows { text, assignee?, dueHint? }.
//!
//! Rules baked into the prompt: the notes are ALWAYS written in English (Hindi/
//! Hinglish meetings are translated for the summary), scratch is high-priority.
//! The verbatim transcript is stored separately and is never translated.
//! Structured output is obtained via a forced tool call.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::keychain;

const API_URL: &str = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL: &str = "claude-haiku-4-5";

const CONCISE_PROMPT: &str = "You convert raw meeting transcripts into clean, structured notes by calling the emit_notes tool. The full verbatim transcript is saved separately, so your job is a SHARP SUMMARY — capture what someone needs to remember and act on, not every sentence.

CONCISE BUT COMPLETE — capture what matters, drop the rest:
- summary: 2-4 sentences. The essence of the meeting. Not a wall of text.
- key_points: only the important, distinct facts and topics. Merge related ideas into one bullet. The vital few, not an exhaustive list — aim for roughly 4-8.
- decisions: only actual decisions reached.
- open_questions: only genuinely unresolved important questions. Often few or none.
- action_items: concrete tasks someone must do, with owner + deadline if stated.

NO REDUNDANCY: each fact belongs in ONE section only. Do not restate the summary as key points, or repeat a decision as a key point or action item. If it is a decision, it is not also a key point.

FAITHFULNESS:
- NEVER invent, assume, or embellish. Only what is in the transcript or scratch notes.
- ALWAYS write the notes in English. If the meeting was spoken in Hindi or Hinglish, translate the meaning into clear, natural English. Every field — summary, key points, decisions, open questions, action items — must be in English (Latin script), never Devanagari. (The original transcript is preserved separately and unchanged.)
- Treat the user's scratch notes as high-priority intent.
- Return every field as a normal JSON value (arrays of plain strings, objects with text/assignee/due_hint). Never use XML, <item> tags, or markup inside fields.
- If an action item's owner or deadline is not stated, OMIT that field. Never output placeholders like 'unknown', 'N/A', 'TBD', 'none', or '<UNKNOWN>'.

Prefer fewer, denser bullets. A reader should scan the whole note in under a minute. Important nuance lives in the transcript; the notes are the summary.";

const DETAILED_PROMPT: &str = "You convert raw meeting transcripts into thorough, structured notes by calling the emit_notes tool. Capture everything important — but stay organized and non-repetitive.

DETAILED MODE — be comprehensive:
- summary: a full paragraph (4-7 sentences) covering every major theme.
- key_points: every substantive fact, number, detail, and discussion thread. When unsure whether something matters, include it.
- decisions: every decision, including tentative or conditional ones.
- open_questions: every unresolved question or issue raised.
- action_items: every task, commitment, or follow-up, with owner + deadline if stated.

NO REDUNDANCY: each fact belongs in ONE section only. Do not restate the summary as key points, or repeat a decision as a key point or action item.

FAITHFULNESS:
- NEVER invent, assume, or embellish. Only what is in the transcript or scratch notes.
- ALWAYS write the notes in English. If the meeting was spoken in Hindi or Hinglish, translate the meaning into clear, natural English. Every field — summary, key points, decisions, open questions, action items — must be in English (Latin script), never Devanagari. (The original transcript is preserved separately and unchanged.)
- Treat the user's scratch notes as high-priority intent.
- Return every field as a normal JSON value (arrays of plain strings, objects with text/assignee/due_hint). Never use XML, <item> tags, or markup inside fields.
- If an action item's owner or deadline is not stated, OMIT that field. Never output placeholders like 'unknown', 'N/A', 'TBD', 'none', or '<UNKNOWN>'.";

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

// ---- Tolerant parsing -------------------------------------------------------
// The model usually returns clean JSON, but Haiku occasionally emits the tool
// input as XML-ish text (<item>…</item>, <parameter name="…">) inside a single
// string field. These helpers recover the notes either way instead of failing.

fn strip_tags(s: &str) -> String {
    let mut out = String::new();
    let mut depth = 0i32;
    for c in s.chars() {
        match c {
            '<' => depth += 1,
            '>' => {
                if depth > 0 {
                    depth -= 1;
                }
            }
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    out.replace("&quot;", "\"")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&#39;", "'")
        .trim()
        .to_string()
}

/// Pull `<item>…</item>` contents out of a blob (tolerates a missing final close).
fn extract_items(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = s;
    while let Some(start) = rest.find("<item>") {
        let after = &rest[start + 6..];
        let end = after.find("</item>").unwrap_or(after.len());
        let text = strip_tags(&after[..end]);
        if !text.is_empty() {
            out.push(text);
        }
        rest = &after[end..];
    }
    out
}

/// The text after `<parameter name="NAME">` up to the next parameter/section.
fn section(blob: &str, name: &str) -> String {
    let marker = format!("<parameter name=\"{name}\">");
    let Some(i) = blob.find(&marker) else { return String::new() };
    let after = &blob[i + marker.len()..];
    let end = after.find("<parameter name=\"").unwrap_or(after.len());
    after[..end].to_string()
}

fn list_field(input: &Value, name: &str) -> Vec<String> {
    match input.get(name) {
        Some(Value::Array(a)) => a
            .iter()
            .filter_map(|x| x.as_str().map(|s| s.trim().to_string()))
            .filter(|s| !s.is_empty())
            .collect(),
        Some(Value::String(s)) if s.contains("<item>") => extract_items(s),
        Some(Value::String(s)) => s
            .lines()
            .map(|l| l.trim().trim_start_matches(['-', '•', '*']).trim().to_string())
            .filter(|l| !l.is_empty())
            .collect(),
        _ => vec![],
    }
}

fn action_from_obj(v: &Value) -> Option<ActionItem> {
    let text = v.get("text").and_then(|t| t.as_str())?.trim().to_string();
    if text.is_empty() {
        return None;
    }
    Some(ActionItem {
        text,
        assignee: v.get("assignee").and_then(|a| a.as_str()).map(String::from),
        due_hint: v
            .get("due_hint")
            .or_else(|| v.get("dueHint"))
            .and_then(|a| a.as_str())
            .map(String::from),
    })
}

/// Value of a nested `<parameter name="NAME">…` within one item chunk.
fn field_in(item: &str, name: &str) -> Option<String> {
    let m = format!("<parameter name=\"{name}\">");
    let i = item.find(&m)?;
    let after = &item[i + m.len()..];
    let end = after
        .find("<parameter name=\"")
        .or_else(|| after.find("</"))
        .unwrap_or(after.len());
    let v = strip_tags(&after[..end]);
    if v.is_empty() {
        None
    } else {
        Some(v)
    }
}

fn parse_action_blob(s: &str) -> Vec<ActionItem> {
    let mut out = Vec::new();
    for chunk in s.split("<item>").skip(1) {
        let item = chunk.split("</item>").next().unwrap_or(chunk);
        let text = field_in(item, "text").unwrap_or_else(|| strip_tags(item));
        if text.trim().is_empty() {
            continue;
        }
        out.push(ActionItem {
            text,
            assignee: field_in(item, "assignee"),
            due_hint: field_in(item, "due_hint").or_else(|| field_in(item, "dueHint")),
        });
    }
    out
}

/// Find a malformed XML-ish blob in any string field of the tool input.
fn find_blob(input: &Value) -> Option<String> {
    input
        .as_object()?
        .values()
        .filter_map(|v| v.as_str())
        .find(|s| s.contains("<item>") || s.contains("<parameter name="))
        .map(|s| s.to_string())
}

fn parse_notes(input: &Value) -> GeneratedNote {
    let raw_summary = input.get("summary").and_then(|v| v.as_str()).unwrap_or("");
    let summary = if raw_summary.contains('<') {
        strip_tags(raw_summary)
    } else {
        raw_summary.to_string()
    };

    // Pathological case: the whole structured output collapsed into one XML-ish
    // string. Recover every section from it.
    if let Some(blob) = find_blob(input) {
        let kp_part = blob
            .split("<parameter name=\"decisions\">")
            .next()
            .unwrap_or(&blob);
        // action_items is the last section and contains nested <parameter> tags,
        // so take everything after its marker to the end of the blob.
        let action_part = blob
            .split("<parameter name=\"action_items\">")
            .nth(1)
            .unwrap_or("")
            .to_string();
        return GeneratedNote {
            summary,
            key_points: extract_items(kp_part),
            decisions: extract_items(&section(&blob, "decisions")),
            open_questions: extract_items(&section(&blob, "open_questions")),
            action_items: parse_action_blob(&action_part),
            model: String::new(),
        };
    }

    let action_items = match input.get("action_items") {
        Some(Value::Array(a)) => a.iter().filter_map(action_from_obj).collect(),
        Some(Value::String(s)) => parse_action_blob(s),
        _ => vec![],
    };
    GeneratedNote {
        summary,
        key_points: list_field(input, "key_points"),
        decisions: list_field(input, "decisions"),
        open_questions: list_field(input, "open_questions"),
        action_items,
        model: String::new(),
    }
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
    depth: Option<String>,
) -> Result<GeneratedNote, String> {
    let key = keychain::get("anthropic_api_key")
        .map_err(|e| e.to_string())?
        .ok_or("No Anthropic API key — add it in Settings → API keys.")?;
    let model = model.unwrap_or_else(|| DEFAULT_MODEL.to_string());
    let system_prompt = if depth.as_deref() == Some("detailed") {
        DETAILED_PROMPT
    } else {
        CONCISE_PROMPT
    };

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
        "system": system_prompt,
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

    let mut note = parse_notes(input);
    for item in &mut note.action_items {
        item.assignee = clean_field(item.assignee.take());
        item.due_hint = clean_field(item.due_hint.take());
    }
    note.model = model;
    Ok(note)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn recovers_xmlish_blob() {
        let blob = "\n<item>KP one</item>\n<item>KP two</item>\n</key_points>\n<parameter name=\"decisions\">\n<item>Decision A</item>\n</decisions>\n<parameter name=\"open_questions\">\n<item>Question Z?</item>\n</questions>\n<parameter name=\"action_items\">\n<item>\n<parameter name=\"text\">Do the thing</item>";
        let input = json!({"summary":"A short summary.","key_points":blob,"decisions":[],"open_questions":[],"action_items":[]});
        let n = parse_notes(&input);
        assert_eq!(n.summary, "A short summary.");
        assert_eq!(n.key_points, vec!["KP one", "KP two"]);
        assert_eq!(n.decisions, vec!["Decision A"]);
        assert_eq!(n.open_questions, vec!["Question Z?"]);
        assert_eq!(n.action_items.len(), 1);
        assert!(n.action_items[0].text.contains("Do the thing"));
    }

    #[test]
    fn parses_normal_json() {
        let input = json!({"summary":"S","key_points":["a","b"],"decisions":["d"],"open_questions":[],"action_items":[{"text":"t","assignee":"X"}]});
        let n = parse_notes(&input);
        assert_eq!(n.key_points, vec!["a", "b"]);
        assert_eq!(n.action_items.len(), 1);
        assert_eq!(n.action_items[0].text, "t");
        assert_eq!(n.action_items[0].assignee.as_deref(), Some("X"));
    }
}
