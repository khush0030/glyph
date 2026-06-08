// Glyph — Tauri v2 core. M0: boot the window, open the SQLite DB and apply the
// §11 schema, expose settings + health commands. Hide the console window on
// Windows release builds (no-op on macOS).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod asana;
mod audio;
mod calendar;
mod commands;
mod credentials;
mod events;
mod keychain;
mod notes;
mod stt;
mod store;

use std::sync::Mutex;

use tauri::Manager;

use commands::Db;

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "glyph=info".into()),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(audio::AudioState::default())
        .setup(|app| {
            // Per-app data dir, e.g. ~/Library/Application Support/ai.oltaflock.glyph
            let dir = app.path().app_data_dir()?;
            let db_path = dir.join("glyph.db");
            let conn = store::open(&db_path)
                .map_err(|e| format!("db init failed: {e}"))?;
            tracing::info!("glyph db ready at {}", db_path.display());
            app.manage(Db(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::health_check,
            commands::get_settings,
            commands::set_settings,
            credentials::set_credential,
            credentials::delete_credential,
            credentials::credential_status,
            audio::start_recording,
            audio::stop_recording,
            notes::generate_notes,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Glyph");
}
