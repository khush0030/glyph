//! NoteGenerator — OpenAI Chat Completions API. Two passes:
//!   1. CLEAN — proofread the raw transcript (fix STT errors, grammar, filler;
//!      same language, no summary) so the model summarizes accurate text.
//!   2. NOTES — fold the cleaned transcript + the user's scratch into structured
//!      notes (SPEC §7): Summary, Key points, Decisions, Action items.
//!
//! Rules baked into the prompt: the notes are ALWAYS written in English (Hindi/
//! Hinglish meetings are translated for the summary), scratch is high-priority.
//! The verbatim transcript is stored separately and is never translated.
//! Structured output is obtained via a forced tool (function) call.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::keychain;

const API_URL: &str = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL: &str = "gpt-4o-mini";

/// Pass 1 — proofread the raw transcript before it is summarized. Keeps the
/// spoken language and every fact; only fixes recognition noise.
const CLEAN_PROMPT: &str = "You are a meticulous transcript proofreader. You receive a raw speech-to-text transcript of a meeting — it may be Hindi, English, or Hinglish, with recognition errors, missing punctuation, filler words, false starts, and repeated phrases.

Return a corrected transcript:
- Fix transcription/spelling errors, punctuation, and obviously wrong words using context.
- Remove filler ('um', 'uh', 'haan haan'), false starts, and verbatim repetitions.
- Join broken fragments so each line reads cleanly.
- Keep the SAME language that was spoken on every line — do NOT translate.
- Do NOT summarize, add, reorder, or drop any information or speaker intent.

Output ONLY the corrected transcript text — no commentary, no labels.";

const CONCISE_PROMPT: &str = "You convert a meeting transcript into tight, structured notes by calling the emit_notes tool. The full transcript is saved separately — your job is the sharp signal, not a recap. A reader skims this in 30 seconds and knows what happened and what to do.

Be ruthless. Cut anything obvious, filler, or already implied:
- summary: 2-3 sentences MAX. What the meeting was about and what came out of it. No preamble, no 'the team discussed'.
- key_points: only what a reader must keep — distinct facts, numbers, context. Merge related ideas into one bullet. Usually 3-6 bullets. Never restate the summary.
- decisions: only firm decisions actually reached.
- open_questions: only real unresolved questions. Often none.
- action_items: concrete tasks someone must do, with owner + deadline if stated.

NO REDUNDANCY: each fact lives in exactly ONE section. Never repeat a point across summary / key points / decisions / action items.

FAITHFULNESS:
- NEVER invent, assume, or embellish. Only what is in the transcript or scratch notes.
- ALWAYS write the notes in clear, natural English. If the meeting was spoken in Hindi or Hinglish, translate the meaning into English. Every field must be English (Latin script), never Devanagari. (The original transcript is preserved separately and unchanged.)
- Treat the user's scratch notes as high-priority intent — weight them heavily.
- Return every field as a normal JSON value (arrays of plain strings, objects with text/assignee/due_hint). Never use XML, <item> tags, or markup inside fields.
- If an action item's owner or deadline is not stated, OMIT that field. Never output placeholders like 'unknown', 'N/A', 'TBD', 'none', or '<UNKNOWN>'.

Fewer, denser, sharper. When in doubt, cut it.";

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
// The model usually returns clean JSON, but it occasionally emits the tool
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
    let key = keychain::get("openai_api_key")
        .map_err(|e| e.to_string())?
        .filter(|s| !s.is_empty())
        .ok_or("No OpenAI API key — add it in Settings → API keys.")?;
    // Guard against a stale stored model id (e.g. a legacy non-OpenAI value):
    // only OpenAI chat models are valid against this endpoint.
    let model = match model {
        Some(m) if m.starts_with("gpt") => m,
        _ => DEFAULT_MODEL.to_string(),
    };

    let client = reqwest::Client::new();

    // Pass 1 — proofread the transcript before summarizing. Best effort: any
    // failure falls back to the raw transcript so notes still generate.
    let transcript = transcript.trim().to_string();
    let cleaned = if transcript.is_empty() {
        String::new()
    } else {
        clean_transcript(&client, &key, &model, &transcript)
            .await
            .unwrap_or_else(|e| {
                tracing::warn!("transcript cleanup failed, using raw: {e}");
                transcript.clone()
            })
    };
    let effective = if cleaned.trim().is_empty() { &transcript } else { &cleaned };

    // Pass 2 — fold the cleaned transcript + scratch into structured notes.
    let system_prompt = if depth.as_deref() == Some("detailed") {
        DETAILED_PROMPT
    } else {
        CONCISE_PROMPT
    };
    let user_prompt = format!(
        "TRANSCRIPT:\n{}\n\nSCRATCH NOTES (high priority):\n{}",
        if effective.trim().is_empty() { "(none)" } else { effective.trim() },
        if scratch.trim().is_empty() { "(none)" } else { scratch.trim() },
    );

    let tool = json!({
        "type": "function",
        "function": {
            "name": "emit_notes",
            "description": "Return the cleaned, structured meeting notes.",
            "parameters": {
                "type": "object",
                "properties": {
                    "summary": { "type": "string", "description": "Sharp 2-3 sentence summary of what the meeting was about and its outcome." },
                    "key_points": { "type": "array", "items": { "type": "string" }, "description": "Only the distinct facts/numbers/context a reader must keep. Usually 3-6." },
                    "decisions": { "type": "array", "items": { "type": "string" }, "description": "Firm decisions actually reached." },
                    "open_questions": { "type": "array", "items": { "type": "string" }, "description": "Real unresolved questions. Often none." },
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
        }
    });

    let body = json!({
        "model": model,
        "temperature": 0.3,
        "tools": [tool],
        "tool_choice": { "type": "function", "function": { "name": "emit_notes" } },
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": user_prompt }
        ]
    });

    let resp = client
        .post(API_URL)
        .bearer_auth(&key)
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
        return Err(format!("OpenAI API {status}: {msg}"));
    }

    // The forced function call returns its arguments as a JSON string.
    let args = v
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|a| a.first())
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("tool_calls"))
        .and_then(|t| t.as_array())
        .and_then(|a| a.first())
        .and_then(|c| c.get("function"))
        .and_then(|f| f.get("arguments"))
        .and_then(|a| a.as_str())
        .ok_or("no tool call in response")?;
    let input: Value =
        serde_json::from_str(args).map_err(|e| format!("bad tool arguments: {e}"))?;

    let mut note = parse_notes(&input);
    for item in &mut note.action_items {
        item.assignee = clean_field(item.assignee.take());
        item.due_hint = clean_field(item.due_hint.take());
    }
    note.model = model;
    Ok(note)
}

/// Pass 1 — ask the model to proofread the raw transcript. Returns the cleaned
/// text (same language, no summary). Errors propagate so the caller can fall
/// back to the raw transcript.
async fn clean_transcript(
    client: &reqwest::Client,
    key: &str,
    model: &str,
    transcript: &str,
) -> Result<String, String> {
    let body = json!({
        "model": model,
        "temperature": 0.2,
        "max_tokens": 16000,
        "messages": [
            { "role": "system", "content": CLEAN_PROMPT },
            { "role": "user", "content": transcript }
        ]
    });
    let resp = client
        .post(API_URL)
        .bearer_auth(key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    let status = resp.status();
    let v: Value = resp.json().await.map_err(|e| format!("bad response: {e}"))?;
    if !status.is_success() {
        let msg = v
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("unknown error");
        return Err(format!("OpenAI API {status}: {msg}"));
    }
    Ok(v
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|a| a.first())
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|s| s.as_str())
        .unwrap_or("")
        .trim()
        .to_string())
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
