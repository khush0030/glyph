# SPEC.md — Glyph Technical Specification

> Desktop-first macOS meeting notetaker. Mic + system audio → local Whisper (Hindi/English/Hinglish) → OpenAI GPT-4o structured notes (proofread, then summarize). Calendar-driven + manual recording. Action items → Asana; notes → PDF / Gmail. Minimal.

---

## 1. Goals & non-goals
**Goals (v1, cloud)**
- Manual **"Start recording"** for in-person / ad-hoc meetings (mic-first, system audio if present).
- Calendar-driven recording: show upcoming meetings, detect video links, auto- or ask-to-record at start time.
- Capture mic + system audio with no meeting bot and no virtual-audio-device install.
- Live transcript while recording; Hindi / English / Hinglish via Scribe v2 (language = multi).
- Fold transcript + scratch notes into Summary / Key points / Decisions / Action items via OpenAI GPT-4o.
- Push action items to **Asana** as tasks with assignee, due date, and project.
- **Add action items and notes manually** (with no recording) — quick-capture "anything on your mind", editable AI output, and blank "New note".
- A dedicated **Calendar** page listing all upcoming meetings (grouped by day) and a **Notes** library of past meetings.
- Everything stored locally (SQLite).

**Non-goals (v1)** — local transcription/LLM (that's Private Mode, §12), speaker diarization, automatic translation, Windows/Linux, mobile, cloud sync, multi-user.

---

## 2. Target & constraints
- macOS **14.4+ (Sonoma)**, Apple Silicon. (Core Audio process tap needs 14.4+.)
- Chrome/native meeting apps both fine — desktop capture is OS-level, not browser-bound.
- 16 GB RAM assumed (matters mainly for Private Mode later).

---

## 3. Architecture
```
┌────────────────────────────────────────────────────────────┐
│ React + TS + Tailwind (Tauri WebView)                        │
│  Dashboard · Meeting/record · Settings · Asana modal         │
│  depends only on 6 interfaces (AudioSource, Transcriber,     │
│  NoteGenerator, NotesStore, CalendarSource, TaskExporter)    │
└───────▲───────────────────────────────────┬─────────────────┘
 events │ (transcript, level, status)        │ commands
┌───────┴───────────────────────────────────▼─────────────────┐
│ Tauri Core (Rust)                                            │
│  AudioController · whisper.cpp · OpenAI client               │
│  Google Calendar client · Asana client · SQLite · Keychain   │
└───┬────────────────┬───────────────┬───────────────┬─────────┘
PCM │           WS   │          HTTPS │          HTTPS│
┌───▼────────┐ ┌─────▼──────┐ ┌───────▼──────┐ ┌──────▼───────┐
│ audiocap   │ │ whisper.cpp│ │ OpenAI        │ │ Google Cal / │
│ (Swift)    │ │ (local)    │ │ GPT-4o        │ │ Asana APIs   │
└────────────┘ └────────────┘ └──────────────┘ └──────────────┘
```
All credentials in the macOS Keychain. No web backend.

**Recording flow:** trigger (manual button OR calendar start time) → `audiocap` streams 16 kHz PCM → Rust → saved WAV. On **Stop**, local Whisper transcribes → transcript + scratch → OpenAI (proofread, then summarize) → markdown notes. Action items are parsed into structured rows the user can push to Asana.

---

## 4. Repo structure
```
glyph/
├─ CLAUDE.md · SPEC.md · ROADMAP.md
├─ design/ { mockup.html, glyph-logo.svg }
├─ sidecar/audiocap/         # Swift CLI: tap + mic + mix + resample → stdout
├─ src-tauri/
│  ├─ tauri.conf.json        # externalBin=audiocap, entitlements, plist
│  └─ src/
│     ├─ audio/  stt/  notes/  store/  calendar/  asana/  keychain.rs
│     ├─ commands.rs  events.rs  main.rs
└─ src/
   ├─ core/ { AudioSource, Transcriber, NoteGenerator, NotesStore, CalendarSource, TaskExporter }.ts
   ├─ screens/ { Dashboard, Calendar, Notes, Meeting, Settings }.tsx
   ├─ components/ { Sidebar, RecordButton, Transcript, NotesView, ActionItems, AddActionItem, AsanaModal, MeetingCard, CalendarList, NotesList, Toggles }
   └─ lib/ { ipc.ts, prompt.ts }
```

---

## 5. Audio capture (v1 spike)
Swift CLI `audiocap`. References: `insidegui/AudioCap`, `AudioTee`.
- System audio: default output → `CATapDescription` (mono global, exclude self) → `AudioHardwareCreateProcessTap` → private aggregate device (`kAudioAggregateDeviceTapListKey`, `kAudioAggregateDeviceIsPrivateKey=true`) → `AudioDeviceCreateIOProcIDWithBlock`.
- Mic: `AVAudioEngine` input tap (independent stream).
- Mix mic + system, resample to **16 kHz mono Int16** (`AVAudioConverter`), light input-gain guard.
- Output: length-framed PCM on stdout (`[u32 LE len][Int16 LE]`, ~100 ms frames); status/logs as JSON on stderr.
- **Manual mode** = mic only by default (no system audio needed for in-person); system audio added automatically if a tap is active.
- Permissions: mic (`NSMicrophoneUsageDescription` + AVCaptureDevice) and system-audio TCC prompt (handle silent-tap denial → settings deep-link).

## 6. Transcription — Scribe v2 (cloud default)
- Rust opens a WebSocket to Scribe v2 Realtime, key from Keychain. Send 16 kHz PCM, receive partial + final segments with word timestamps.
- **language = multi.** Output `Segment { text, lang, startMs, endMs, isFinal }`.
- Behind `Transcriber` so local Whisper drops in later (Private Mode).
- Set the ElevenLabs account to its strictest available retention.

## 7. Analysis — OpenAI GPT-4o (cloud default)
- Rust calls the OpenAI Chat Completions API, model `gpt-4o-mini` (default), key from Keychain. Implemented in `notes/mod.rs`.
- **Two passes:** (1) proofread the raw transcript — fix STT errors, grammar, filler; same language, no summary, no translation; (2) summarize the cleaned transcript into structured notes via a forced `emit_notes` function call.
- **Output contract:** `{ summary, key_points, decisions, open_questions, action_items[] }`. **Each action item is structured** — `{ text, assignee?, dueHint? }` — so it can map to Asana. Notes are written in **English** (Hindi/Hinglish translated for the notes); the verbatim transcript is preserved unchanged. Treat scratch notes as high-priority. Terse, no preamble.
- Well under 1¢/meeting on `gpt-4o-mini`. Offer `gpt-4o` ("deep notes") toggle for long, messy calls.

## 8. Calendar — Google Calendar (`CalendarSource`)
- OAuth (PKCE, system browser, loopback redirect), token in Keychain. Scope: read-only calendar events.
- Poll events for the next window; parse `conferenceData` / location / description for Meet / Zoom / Teams links.
- Surface "upcoming meetings" on the Dashboard with per-meeting auto-record setting (Ask / Auto).
- At an event's start time: if it has a video link, fire the recording trigger per the user's setting (ask-first default). Enhancement: only prompt if the mic is actually in use by a meeting app.
- Map a meeting → a default Asana project (client vs internal) so action items route correctly.

## 9. Tasks — Asana (`TaskExporter`)
- OAuth, token in Keychain. Fetch workspaces, projects, and users to populate dropdowns.
- From a generated note's Action items: user picks a project (defaults to the meeting's linked project), assignee per item (mapped to an Asana user gid), and due date; "Create N tasks."
- Create tasks: `POST /tasks` with `name` (item text), `assignee`, `projects`, `due_on`, and `notes` linking back to the meeting (title + date). Store the returned task gid in `action_items.asana_gid` so the UI shows "sent" state and avoids duplicates.

## 10. IPC contract (frontend ↔ Rust)
**Commands:** `start_recording {source: manual|calendar, eventId?}` → sessionId; `stop_recording` → noteId; `list_notes`; `get_note {id}`; `update_title`; `save_scratch`; `regenerate_notes {id, model}`; `delete_note`; `delete_audio`; `get_settings`/`set_settings`; `check_permissions`/`open_permission_settings`; `calendar_connect`/`calendar_upcoming`; `asana_connect`/`asana_projects`/`asana_users`/`asana_create_tasks {noteId, projectGid, items[]}`.
**Events:** `transcript://partial`, `transcript://final`, `recording://level`, `recording://status`, `notes://generated`, `meeting://starting {event}` (auto-record prompt), `asana://created {count}`.

## 11. Data model (SQLite)
```sql
notes(id, title, created_at, updated_at, source, lang_mode, engine, duration_sec, status, scratch, audio_path, asana_project_gid);
segments(id, note_id, idx, start_ms, end_ms, text, lang);
generated_notes(note_id, markdown, model, generated_at);
action_items(id, note_id, text, assignee, due_hint, source, asana_gid);   -- source: ai|manual; asana_gid null until pushed
calendar_events(id, note_id, provider_event_id, title, start_ts, link, auto_record);
settings(key, value);
```

## 12. Private Mode (local — later milestone, not v1)
Same interfaces, local implementations: `Transcriber` → whisper.cpp (whisper-rs, Metal, large-v3-turbo); `NoteGenerator` → Ollama (`qwen2.5:7b`). A per-meeting + global toggle. Purpose: zero data leaves the Mac for sensitive client calls, and a direct quality/perf comparison vs cloud. Model download + RAM management required.

## 13. Open decisions — resolve before the dependent milestone
1. **Calendar = Google OAuth** (recommended) vs EventKit. Confirm; blocks M5.
2. **Auto-record default = Ask first** (recommended) vs Auto-record all. Confirm; affects M5.
3. **Devanagari** output (recommended) vs romanized Hindi. Confirm; affects M3 prompt.
4. **Distribution** — personal Mac (self-sign) vs notarized build. Affects M9.
5. **Asana ID** — confirm workspace + a default mapping of meeting types → projects.

## 14. References
- `insidegui/AudioCap`, `AudioTee` (Core Audio tap, macOS 14.4+).
- ElevenLabs Scribe v2 Realtime WebSocket API.
- OpenAI Chat Completions API, `gpt-4o-mini` / `gpt-4o`.
- Google Calendar API (OAuth PKCE, `conferenceData`).
- Asana API (OAuth, tasks/projects/users).
