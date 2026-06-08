-- Glyph schema — SPEC §11. Applied once on first launch.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS notes (
  id                 TEXT PRIMARY KEY,
  title              TEXT NOT NULL DEFAULT '',
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  source             TEXT NOT NULL,            -- manual | recorded | calendar
  lang_mode          TEXT NOT NULL DEFAULT 'multi',
  engine             TEXT NOT NULL DEFAULT 'cloud',
  duration_sec       INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'draft',
  scratch            TEXT NOT NULL DEFAULT '',
  audio_path         TEXT,
  asana_project_gid  TEXT
);

CREATE TABLE IF NOT EXISTS segments (
  id        TEXT PRIMARY KEY,
  note_id   TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  idx       INTEGER NOT NULL,
  start_ms  INTEGER NOT NULL,
  end_ms    INTEGER NOT NULL,
  text      TEXT NOT NULL,
  lang      TEXT
);
CREATE INDEX IF NOT EXISTS idx_segments_note ON segments(note_id, idx);

CREATE TABLE IF NOT EXISTS generated_notes (
  note_id       TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  markdown      TEXT NOT NULL,
  model         TEXT NOT NULL,
  generated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS action_items (
  id         TEXT PRIMARY KEY,
  note_id    TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  assignee   TEXT,
  due_hint   TEXT,
  source     TEXT NOT NULL,                    -- ai | manual
  asana_gid  TEXT                              -- null until pushed
);
CREATE INDEX IF NOT EXISTS idx_action_items_note ON action_items(note_id);

CREATE TABLE IF NOT EXISTS calendar_events (
  id                 TEXT PRIMARY KEY,
  note_id            TEXT REFERENCES notes(id) ON DELETE SET NULL,
  provider_event_id  TEXT NOT NULL,
  title              TEXT NOT NULL,
  start_ts           INTEGER NOT NULL,
  link               TEXT,
  auto_record        TEXT NOT NULL DEFAULT 'ask'   -- ask | auto
);

CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
