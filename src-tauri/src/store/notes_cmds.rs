//! NotesStore commands (SPEC §11) — SQLite-backed persistence for notes,
//! transcript segments, generated notes, and action items. Wired in M4 so the
//! full record → transcript → notes → reopen loop survives quit/relaunch.

use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::Db;

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn new_id() -> String {
    let mut b = [0u8; 12];
    let _ = getrandom::getrandom(&mut b);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(b)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSummary {
    id: String,
    title: String,
    created_at: i64,
    updated_at: i64,
    source: String,
    status: String,
    action_item_count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentRow {
    text: String,
    lang: String,
    start_ms: i64,
    end_ms: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionItemRow {
    id: String,
    text: String,
    assignee: Option<String>,
    due_hint: Option<String>,
    source: String,
    asana_gid: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedStored {
    summary: String,
    key_points: Vec<String>,
    decisions: Vec<String>,
    model: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteDetail {
    id: String,
    title: String,
    created_at: i64,
    updated_at: i64,
    source: String,
    status: String,
    scratch: String,
    duration_sec: i64,
    audio_path: Option<String>,
    segments: Vec<SegmentRow>,
    generated: Option<GeneratedStored>,
    action_items: Vec<ActionItemRow>,
}

#[derive(Deserialize)]
pub struct SegmentIn {
    pub text: String,
    #[serde(default)]
    pub lang: String,
    #[serde(default, rename = "startMs", alias = "start_ms")]
    pub start_ms: i64,
    #[serde(default, rename = "endMs", alias = "end_ms")]
    pub end_ms: i64,
}

#[derive(Deserialize)]
pub struct ActionItemIn {
    pub text: String,
    pub assignee: Option<String>,
    #[serde(rename = "dueHint", alias = "due_hint")]
    pub due_hint: Option<String>,
}

#[tauri::command]
pub fn create_note(db: State<'_, Db>, source: String, title: Option<String>) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = new_id();
    let ts = now_ms();
    conn.execute(
        "INSERT INTO notes (id, title, created_at, updated_at, source, status) VALUES (?1,?2,?3,?3,?4,'draft')",
        params![id, title.unwrap_or_default(), ts, source],
    )
    .map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
pub fn list_notes(db: State<'_, Db>) -> Result<Vec<NoteSummary>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT n.id, n.title, n.created_at, n.updated_at, n.source, n.status,
                    (SELECT COUNT(*) FROM action_items a WHERE a.note_id = n.id)
             FROM notes n ORDER BY n.updated_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(NoteSummary {
                id: r.get(0)?,
                title: r.get(1)?,
                created_at: r.get(2)?,
                updated_at: r.get(3)?,
                source: r.get(4)?,
                status: r.get(5)?,
                action_item_count: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_note(db: State<'_, Db>, id: String) -> Result<NoteDetail, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let (title, created_at, updated_at, source, status, scratch, duration_sec, audio_path) = conn
        .query_row(
            "SELECT title, created_at, updated_at, source, status, scratch, duration_sec, audio_path FROM notes WHERE id = ?1",
            params![id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, i64>(6)?,
                    r.get::<_, Option<String>>(7)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    let mut seg_stmt = conn
        .prepare("SELECT text, lang, start_ms, end_ms FROM segments WHERE note_id = ?1 ORDER BY idx")
        .map_err(|e| e.to_string())?;
    let segments = seg_stmt
        .query_map(params![id], |r| {
            Ok(SegmentRow {
                text: r.get(0)?,
                lang: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                start_ms: r.get(2)?,
                end_ms: r.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let generated = conn
        .query_row(
            "SELECT markdown, model FROM generated_notes WHERE note_id = ?1",
            params![id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .ok()
        .and_then(|(json, model)| {
            serde_json::from_str::<serde_json::Value>(&json).ok().map(|v| GeneratedStored {
                summary: v.get("summary").and_then(|s| s.as_str()).unwrap_or("").to_string(),
                key_points: v
                    .get("keyPoints")
                    .and_then(|k| k.as_array())
                    .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                    .unwrap_or_default(),
                decisions: v
                    .get("decisions")
                    .and_then(|k| k.as_array())
                    .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                    .unwrap_or_default(),
                model,
            })
        });

    let mut ai_stmt = conn
        .prepare("SELECT id, text, assignee, due_hint, source, asana_gid FROM action_items WHERE note_id = ?1 ORDER BY rowid")
        .map_err(|e| e.to_string())?;
    let action_items = ai_stmt
        .query_map(params![id], |r| {
            Ok(ActionItemRow {
                id: r.get(0)?,
                text: r.get(1)?,
                assignee: r.get(2)?,
                due_hint: r.get(3)?,
                source: r.get(4)?,
                asana_gid: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(NoteDetail {
        id,
        title,
        created_at,
        updated_at,
        source,
        status,
        scratch,
        duration_sec,
        audio_path,
        segments,
        generated,
        action_items,
    })
}

fn touch(conn: &rusqlite::Connection, id: &str) {
    let _ = conn.execute("UPDATE notes SET updated_at = ?2 WHERE id = ?1", params![id, now_ms()]);
}

#[tauri::command]
pub fn update_title(db: State<'_, Db>, id: String, title: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE notes SET title = ?2, updated_at = ?3 WHERE id = ?1", params![id, title, now_ms()])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn save_scratch(db: State<'_, Db>, id: String, scratch: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE notes SET scratch = ?2, updated_at = ?3 WHERE id = ?1", params![id, scratch, now_ms()])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Replace all transcript segments for a note (called after a recording stops).
#[tauri::command]
pub fn save_segments(db: State<'_, Db>, note_id: String, segments: Vec<SegmentIn>) -> Result<(), String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM segments WHERE note_id = ?1", params![note_id])
        .map_err(|e| e.to_string())?;
    for (i, s) in segments.iter().enumerate() {
        tx.execute(
            "INSERT INTO segments (id, note_id, idx, start_ms, end_ms, text, lang) VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![new_id(), note_id, i as i64, s.start_ms, s.end_ms, s.text, s.lang],
        )
        .map_err(|e| e.to_string())?;
    }
    touch(&tx, &note_id);
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Persist the generated note + its AI action items (replacing prior AI items).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn save_generated(
    db: State<'_, Db>,
    note_id: String,
    summary: String,
    key_points: Vec<String>,
    decisions: Vec<String>,
    action_items: Vec<ActionItemIn>,
    model: String,
) -> Result<(), String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let json = serde_json::json!({
        "summary": summary, "keyPoints": key_points, "decisions": decisions, "model": model
    })
    .to_string();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM generated_notes WHERE note_id = ?1", params![note_id])
        .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO generated_notes (note_id, markdown, model, generated_at) VALUES (?1,?2,?3,?4)",
        params![note_id, json, model, now_ms()],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM action_items WHERE note_id = ?1 AND source = 'ai'", params![note_id])
        .map_err(|e| e.to_string())?;
    for a in &action_items {
        tx.execute(
            "INSERT INTO action_items (id, note_id, text, assignee, due_hint, source) VALUES (?1,?2,?3,?4,?5,'ai')",
            params![new_id(), note_id, a.text, a.assignee, a.due_hint],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.execute("UPDATE notes SET status = 'ready', updated_at = ?2 WHERE id = ?1", params![note_id, now_ms()])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn add_action_item(
    db: State<'_, Db>,
    note_id: String,
    text: String,
    assignee: Option<String>,
    due_hint: Option<String>,
) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = new_id();
    conn.execute(
        "INSERT INTO action_items (id, note_id, text, assignee, due_hint, source) VALUES (?1,?2,?3,?4,?5,'manual')",
        params![id, note_id, text, assignee, due_hint],
    )
    .map_err(|e| e.to_string())?;
    touch(&conn, &note_id);
    Ok(id)
}

#[tauri::command]
pub fn delete_action_item(db: State<'_, Db>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM action_items WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Record audio/duration/status after a recording stops.
#[tauri::command]
pub fn set_recording_result(
    db: State<'_, Db>,
    id: String,
    audio_path: Option<String>,
    duration_sec: i64,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE notes SET audio_path = ?2, duration_sec = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, audio_path, duration_sec, now_ms()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_note(db: State<'_, Db>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    // remove audio file if present
    if let Ok(Some(path)) = conn.query_row(
        "SELECT audio_path FROM notes WHERE id = ?1",
        params![id],
        |r| r.get::<_, Option<String>>(0),
    ) {
        let _ = std::fs::remove_file(path);
    }
    conn.execute("DELETE FROM notes WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_audio(db: State<'_, Db>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    if let Ok(Some(path)) = conn.query_row(
        "SELECT audio_path FROM notes WHERE id = ?1",
        params![id],
        |r| r.get::<_, Option<String>>(0),
    ) {
        let _ = std::fs::remove_file(path);
    }
    conn.execute("UPDATE notes SET audio_path = NULL, updated_at = ?2 WHERE id = ?1", params![id, now_ms()])
        .map_err(|e| e.to_string())?;
    Ok(())
}
