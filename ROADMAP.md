# ROADMAP.md — Glyph build order

Cloud path first. Each milestone has one "Done when" gate — don't start the next until it passes. Don't polish ahead of the M1 spike.

---

### M0 — Scaffold (½ day)
Tauri v2 + React + TS + Tailwind boots showing the three pages from `design/mockup.html` (Dashboard, Meeting, Settings) with static data, branded with `design/glyph-logo.svg`. SQLite initialized with the §11 schema. The six `core/` interfaces stubbed. Keychain helper in place.
**Done when:** `cargo tauri dev` opens the app rendering all three pages and an empty DB exists.

---

### M1 — AUDIO SIDECAR SPIKE (make-or-break) (2–4 days)
Build `audiocap` standalone first: Core Audio tap (system audio) + AVAudioEngine (mic) → 16 kHz mono PCM → stdout. Validate by writing a WAV and listening (your voice + a YouTube clip, clean, no clipping). Then wire as a Tauri `externalBin`; Rust spawns it and logs RMS.
**Done when:** manual record produces a saved 16 kHz WAV with both mic and system audio, intelligible, and Rust logs a live level. **If this can't be made reliable, stop and reassess before building further.**

---

### M2 — Live transcription, Scribe v2 (1–2 days)
`Transcriber` → Scribe v2 Realtime WS (key from Keychain), language = multi. Stream PCM, render live partial/final segments. Test on a Hinglish clip, a Hindi clip, and an English clip.
**Done when:** recording a mixed Hindi/English clip shows a live, recognizably-correct on-screen transcript in both scripts.

---

### M3 — Analysis, Claude Haiku 4.5 (1 day)
`NoteGenerator` → Anthropic `claude-haiku-4-5` with the §7 prompt. On Stop, fold transcript + scratch into the four sections, **action items emitted as structured rows** `{text, assignee?, dueHint?}`. Verify it does NOT translate and surfaces scratch notes.
**Done when:** stopping a mixed-language recording yields clean notes preserving each line's language, with structured action items + inferred assignees.

---

### M4 — Persistence, history, manual capture (1–2 days)
`NotesStore` wired (notes, segments, generated, action_items). Dashboard "recent notes" + the **Notes** library + Meeting view load real data; title + scratch autosave; delete + delete-audio. The full **manual** loop polished: Start recording → live transcript → Stop → notes → reopen; plus **"New note"** (blank, no recording) and **manually adding/editing action items** (with assignee + due) — stored with `source='manual'`.
**Done when:** quit/relaunch — all notes, transcripts, generated notes, and action items (AI + manual) are intact; manual record, blank note, and manual action items all work through the UI.

---

### M5 — Calendar page + auto/ask recording (2 days)
`CalendarSource` → Google Calendar OAuth (PKCE, Keychain). A dedicated **Calendar page** lists all upcoming meetings grouped by day with detected video links and a per-meeting Ask/Auto toggle; the Dashboard "Up next" links into it. At start time, fire `meeting://starting` → ask-first prompt (default) or silent auto-record. Map meeting → default Asana project.
**Done when:** the Calendar page shows all upcoming Google meetings grouped by day, and at start time a meeting prompts (or auto-starts) recording per its setting.

---

### M6 — Asana action-item export (1–2 days)
`TaskExporter` → Asana OAuth (Keychain). Fetch projects + users. The Action items panel + Asana modal (per `design/mockup.html`): pick project, assignee per item, due date, "Create N tasks." Store returned gids; show "sent" state; prevent duplicates.
**Done when:** action items from a real meeting create assigned, dated tasks in the correct Asana project, and the app reflects they were sent.

---

### M7 — Settings, cost display & polish (1 day)
Settings page wired: engine (Cloud now; Private placeholder), analysis model (Haiku/Sonnet), integration connect/disconnect, auto-record default, audio retention, permissions + deep-links, Scribe per-hour cost note, recording indicator + optional auto-disclosure line. Appearance: Light/Dark/System theme (CSS-variable palette, follows macOS in System mode), persisted in settings.
**Done when:** every toggle in `design/mockup.html` Settings is functional and persists, and the theme toggle flips the whole app light/dark (System tracks macOS).

---

### M8 — Private Mode (local) — the cloud-vs-local comparison
Local `Transcriber` (whisper.cpp / whisper-rs, Metal, large-v3-turbo) + local `NoteGenerator` (Ollama `qwen2.5:7b`), behind the existing interfaces, as a per-meeting + global toggle with model download/RAM handling. Add a simple side-by-side eval (same audio → cloud vs local → WER + note quality) so the choice is data-driven.
**Done when:** a meeting can be recorded fully offline with nothing leaving the Mac, and you can compare cloud vs local output on the same audio.

---

### M9 — Packaging & permissions polish (1–2 days)
Info.plist + entitlements, sign the sidecar, hardened runtime; first-run permission flow (mic + system audio + calendar) with graceful denial; notarize only if distributing beyond this Mac.
**Done when:** a fresh launch walks through permissions and records successfully with no Terminal steps.

---

## First message to give Claude Code
> Read CLAUDE.md, SPEC.md, and ROADMAP.md. Confirm the open decisions in SPEC §13 with me before scaffolding. Then do M0, and stop at the M1 gate for my review — M1 (the Swift audio sidecar) is the spike that decides if the approach holds. Use Glyph branding from design/glyph-logo.svg and match the three pages in design/mockup.html. Cloud path only for now; Private Mode (local) is M8.
