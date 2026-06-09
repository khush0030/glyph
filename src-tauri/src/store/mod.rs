//! NotesStore (SQLite) — SPEC §11. `open()` applies the schema; the CRUD
//! commands live in `notes_cmds` (M4).

pub mod notes_cmds;

use std::path::PathBuf;

use rusqlite::Connection;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

/// Open (creating if needed) the Glyph database at `db_path` and apply the
/// schema migration. Returns the live connection.
pub fn open(db_path: &PathBuf) -> Result<Connection, StoreError> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(db_path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    apply_migrations(&conn)?;
    backup(&conn, db_path);
    Ok(conn)
}

/// Best-effort rotating snapshot on launch so accidental data loss is always
/// recoverable. `VACUUM INTO` writes a consistent copy (incl. WAL). Keeps the
/// newest 8 under `<data>/backups/`. Never fails the open.
fn backup(conn: &Connection, db_path: &PathBuf) {
    let Some(parent) = db_path.parent() else { return };
    // Only back up if there's something to lose.
    let notes: i64 = conn
        .query_row("SELECT COUNT(*) FROM notes", [], |r| r.get(0))
        .unwrap_or(0);
    if notes == 0 {
        return;
    }
    let dir = parent.join("backups");
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let target = dir.join(format!("glyph-{stamp}.db"));
    if target.exists() {
        return;
    }
    if let Err(e) = conn.execute("VACUUM INTO ?1", [target.to_string_lossy().to_string()]) {
        tracing::warn!("db backup failed: {e}");
        return;
    }
    tracing::info!("db backed up → {}", target.display());
    // Prune to the newest 8.
    if let Ok(entries) = std::fs::read_dir(&dir) {
        let mut files: Vec<_> = entries
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().starts_with("glyph-"))
            .collect();
        files.sort_by_key(|e| e.file_name());
        while files.len() > 8 {
            let f = files.remove(0);
            let _ = std::fs::remove_file(f.path());
        }
    }
}

fn apply_migrations(conn: &Connection) -> Result<(), StoreError> {
    // M0 has a single embedded migration. A version table lets later
    // milestones add migrations without re-running this one.
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);",
    )?;
    let current: i64 = conn
        .query_row("SELECT COALESCE(MAX(version), 0) FROM schema_version", [], |r| {
            r.get(0)
        })
        .unwrap_or(0);

    if current < 1 {
        conn.execute_batch(include_str!("../../migrations/0001_init.sql"))?;
        conn.execute("INSERT INTO schema_version (version) VALUES (1)", [])?;
        tracing::info!("applied migration 0001_init");
    }
    Ok(())
}
