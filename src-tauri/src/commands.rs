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

/// macOS permission state for the first-run flow. `mic` is one of
/// authorized/denied/restricted/undetermined; `screen` is granted/denied.
/// Calendar is Google OAuth (app-level) — reported via `calendar_connected`.
#[derive(serde::Serialize, Default)]
pub struct Permissions {
    pub mic: String,
    pub screen: String,
}

// Ask the sidecar (which owns AVFoundation + the system-audio tap) to report
// permission state. `flag` is --check-perms (no prompt) or --request-perms.
async fn probe_permissions(app: &tauri::AppHandle, flag: &str) -> Result<Permissions, String> {
    use tauri_plugin_shell::ShellExt;
    let out = app
        .shell()
        .sidecar("audiocap")
        .map_err(|e| e.to_string())?
        .args([flag])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let line = stdout.lines().last().unwrap_or("").trim();
    let v: serde_json::Value =
        serde_json::from_str(line).map_err(|e| format!("bad perms output {line:?}: {e}"))?;
    Ok(Permissions {
        mic: v["mic"].as_str().unwrap_or("undetermined").to_string(),
        screen: v["screen"].as_str().unwrap_or("denied").to_string(),
    })
}

/// Report current mic + screen-recording permission, without prompting.
#[tauri::command]
pub async fn check_permissions(app: tauri::AppHandle) -> Result<Permissions, String> {
    probe_permissions(&app, "--check-perms").await
}

/// Trigger the OS permission prompts (mic + screen capture), then report.
#[tauri::command]
pub async fn request_permissions(app: tauri::AppHandle) -> Result<Permissions, String> {
    probe_permissions(&app, "--request-perms").await
}

/// Open the Screen & System-Audio Recording pane — the one that needs a manual
/// toggle (mic is grantable in-app; the system-audio tap is not).
#[tauri::command]
pub fn open_permission_settings(app: tauri::AppHandle) -> Result<(), String> {
    open_privacy_settings(app, "screen".into())
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
