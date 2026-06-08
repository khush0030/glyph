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
    Ok(conn)
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
