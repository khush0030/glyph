//! Tauri commands (frontend → Rust), SPEC §10. M0 wires the few that work
//! without API keys (settings persistence backed by SQLite + a health check);
//! recording/calendar/asana commands arrive in their milestones.

use std::collections::HashMap;
use std::sync::Mutex;

use rusqlite::Connection;
use tauri::State;

/// Live SQLite connection, guarded for the single-window desktop app.
pub struct Db(pub Mutex<Connection>);

#[tauri::command]
pub fn health_check() -> &'static str {
    "ok"
}

/// Open the relevant macOS System Settings privacy pane so the user can grant
/// mic / screen-recording (system audio) access.
#[tauri::command]
pub fn open_privacy_settings(app: tauri::AppHandle, pane: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let url = match pane.as_str() {
        "microphone" => "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
        "screen" => "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
        _ => "x-apple.systempreferences:com.apple.preference.security?Privacy",
    };
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_settings(db: State<'_, Db>) -> Result<HashMap<String, String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT key, value FROM settings")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    let mut out = HashMap::new();
    for row in rows {
        let (k, v) = row.map_err(|e| e.to_string())?;
        out.insert(k, v);
    }
    Ok(out)
}

#[tauri::command]
pub fn set_settings(
    db: State<'_, Db>,
    kv: HashMap<String, String>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    for (k, v) in kv {
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![k, v],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}
