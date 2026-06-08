<div align="center">

<img src="design/glyph-logo.svg" alt="Glyph" width="96" height="96" />

# Glyph

**A desktop-first macOS meeting notetaker for Hindi, English & Hinglish calls.**

Records mic + system audio, transcribes in the language spoken, and turns the
transcript plus your sparse typed notes into clean structured notes — summary,
key points, decisions, and action items you can push straight to Asana.

Granola-style. Clean indigo + lime. Minimal.

</div>

---

## What it does

- **Records real meetings** — mic + system audio for online calls (no meeting bot,
  no virtual audio device), or mic alone for in-person meetings.
- **Transcribes Hindi / English / Hinglish** live, in the language actually spoken.
  No translation — every line stays in its own script.
- **Generates structured notes** from the transcript + your scratch notes:
  Summary · Key points · Decisions · Action items.
- **Pulls upcoming meetings** from Google Calendar, detects Meet/Zoom/Teams links,
  and can auto- or ask-to-record at start time.
- **Exports action items to Asana** as real tasks with assignee, due date, and project.
- **Manual capture too** — quick "anything on your mind" notes, blank notes, and
  hand-added action items, no recording required.
- **Stores everything locally** in SQLite. No web backend.
- **Light & dark themes** — pick Light, Dark, or System (follows macOS appearance).

A **Private Mode** (fully local transcription + analysis, nothing leaves the Mac)
is a planned later milestone — see [Roadmap](#roadmap).

## How it works

```
React + TS + Tailwind  (Tauri WebView)
        │  depends only on 6 swappable interfaces
        ▼
Tauri Core (Rust)  ──  AudioController · Scribe WS · Anthropic · Google Cal · Asana · SQLite · Keychain
        │
   ┌────┴───────────────┬──────────────────┬─────────────────┐
   ▼                    ▼                  ▼                 ▼
audiocap (Swift)   Scribe v2 STT     Claude Haiku 4.5   Google Cal / Asana
mic + system tap   (multi-lang WS)   (structured notes)  (OAuth, PKCE)
→ 16kHz mono PCM
```

The UI talks **only** to six interfaces; cloud vs. local is just which
implementation is wired in:

| Interface        | Cloud (v1)            | Local (Private Mode, later)        |
|------------------|-----------------------|------------------------------------|
| `AudioSource`    | Native Swift sidecar  | *(same — always native)*           |
| `Transcriber`    | ElevenLabs Scribe v2  | Whisper large-v3-turbo (whisper.cpp) |
| `NoteGenerator`  | Claude Haiku 4.5      | Ollama (`qwen2.5:7b`)              |
| `NotesStore`     | SQLite                | SQLite                             |
| `CalendarSource` | Google Calendar       | Google Calendar                    |
| `TaskExporter`   | Asana                 | Asana                              |

## Stack

- **Shell** — Tauri v2 (Rust core + React 18 + TypeScript + Tailwind, Vite).
- **Audio** — native Swift CLI sidecar (`audiocap`): Core Audio process tap for
  system audio + AVAudioEngine for mic, mixed to 16 kHz mono PCM, streamed to
  Rust over stdout. Shipped as a Tauri `externalBin`.
- **Speech-to-text** — ElevenLabs Scribe v2 Realtime over WebSocket, `language = multi`.
- **Analysis** — Claude Haiku 4.5 (`claude-haiku-4-5`), with an optional Sonnet 4.6
  "deep notes" toggle.
- **Calendar** — Google Calendar API (OAuth PKCE, system browser).
- **Tasks** — Asana API (OAuth).
- **Storage** — local SQLite.

All API keys live in the **macOS Keychain only** — never in the repo, never in
plaintext config. The desktop app calls every service directly; there is no
server in between.

## Requirements

- macOS **14.4+** (Sonoma), Apple Silicon — the Core Audio process tap needs 14.4+.
- [Rust](https://www.rust-lang.org/tools/install) toolchain
- [Node.js](https://nodejs.org/) 18+
- Xcode command-line tools (for the Swift sidecar)
- API keys for ElevenLabs, Anthropic, Google Calendar, and Asana
  (entered in-app; stored in Keychain)

## Getting started

```bash
# install frontend deps
npm install

# run the app in dev (boots Vite + Tauri)
npm run tauri dev

# build a release bundle
npm run tauri build
```

> **Status:** early build. M0 scaffold (UI shell, six core interfaces, SQLite
> schema, Keychain helper) is in place. The Swift audio sidecar — the make-or-break
> spike — is next. See the [Roadmap](#roadmap).

## Project layout

```
glyph/
├─ CLAUDE.md · SPEC.md · ROADMAP.md      # source of truth — read these first
├─ design/         { mockup.html, glyph-logo.svg }
├─ src-tauri/      Rust core
│  ├─ migrations/  0001_init.sql          # SQLite schema
│  └─ src/         audio · stt · notes · store · calendar · asana · keychain
└─ src/            React frontend
   ├─ core/        the six swappable interfaces
   ├─ screens/     Dashboard · Calendar · Notes · Meeting · Settings
   ├─ components/  Sidebar · RecordButton · Transcript · NotesView · ...
   └─ lib/         ipc.ts · prompt.ts
```

The Swift sidecar (`sidecar/audiocap/`) lands with the M1 spike.

## Roadmap

Cloud path ships first; each milestone has one gate before the next starts.

| #  | Milestone                          | Gate |
|----|------------------------------------|------|
| M0 | Scaffold                           | App boots, renders pages, empty DB exists ✅ |
| M1 | **Audio sidecar spike**            | Manual record → 16 kHz WAV with mic + system audio, intelligible |
| M2 | Live transcription (Scribe v2)     | Mixed Hindi/English clip shows live correct transcript |
| M3 | Analysis (Claude Haiku 4.5)        | Clean notes, language preserved, structured action items |
| M4 | Persistence, history, manual capture | Quit/relaunch keeps everything; manual flows work |
| M5 | Calendar page + auto/ask recording | Upcoming Google meetings listed; start-time prompt/auto |
| M6 | Asana action-item export           | Items create assigned, dated tasks in the right project |
| M7 | Settings, cost display & polish    | Every Settings toggle persists; Light/Dark/System theme flips the app |
| M8 | Private Mode (local)               | Full offline recording; cloud-vs-local comparison |
| M9 | Packaging & permissions polish     | Fresh launch → permission flow → records, no Terminal |

Full detail in [`ROADMAP.md`](ROADMAP.md); technical spec in [`SPEC.md`](SPEC.md).

## Design principles

1. **Keys in the Keychain only** — never the repo, never plaintext.
2. **Never translate transcribed text** — every line stays in the language spoken.
3. **Always run STT with `language = multi`** — never force `hi` or `en`.
4. **The six interfaces are the contract** — the UI never touches a concrete
   implementation. Cloud vs. local is a toggle, not a second app.
5. **Recording is consent-sensitive** — always a visible indicator, optional
   auto-disclosure line. These are real client calls.
6. **Minimal > clever** — React hooks for state, no Redux, no abstraction beyond
   the six interfaces.

## License

Private project. All rights reserved.
