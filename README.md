<div align="center">

<img src="design/glyph-logo.svg" alt="Glyph" width="96" height="96" />

# Glyph

**A desktop-first macOS meeting notetaker for Hindi, English & Hinglish calls.**

Records mic + system audio, transcribes **locally** in the language spoken, and
turns the transcript plus your sparse typed notes into clean structured notes —
summary, key points, decisions, and action items you can push to Asana.

Granola-style. Clean indigo + lime. Minimal. Runs on your Mac — audio never
leaves the device.

</div>

---

## Contents

- [Download & install (for the team)](#download--install-for-the-team)
- [First-run setup](#first-run-setup)
- [What it does](#what-it-does)
- [How it works](#how-it-works)
- [Build from source (for contributors)](#build-from-source-for-contributors)
- [Where your data lives](#where-your-data-lives)
- [Contributing](#contributing)
- [Project layout](#project-layout)
- [Troubleshooting](#troubleshooting)

---

## Download & install (for the team)

> **Requirements:** a Mac with **Apple Silicon** (M1/M2/M3/M4) on **macOS 14.4+**.
> Intel Macs are not supported.

1. Download the latest **`Glyph_x.y.z_aarch64.dmg`** from the
   **[Releases page](https://github.com/khush0030/glyph/releases/latest)**.
2. Open the `.dmg` and drag **Glyph** into **Applications**.
3. **First launch — important.** The app isn't notarized by Apple yet, so macOS
   will block it the first time. Do **one** of these:
   - **Right-click** `Glyph.app` → **Open** → **Open** in the dialog, **or**
   - run this once in Terminal to clear the quarantine flag:
     ```bash
     xattr -dr com.apple.quarantine /Applications/Glyph.app
     ```
4. Continue to [First-run setup](#first-run-setup).

There is no installer/auto-update yet — to upgrade, download the newer `.dmg`
and replace the app. Your notes, settings, and recordings are kept (they live
outside the app — see [Where your data lives](#where-your-data-lives)).

## First-run setup

**1. Add your Anthropic API key** (required for generating notes; transcription
is local and needs no key).

Create a file at:

```
~/Library/Application Support/ai.oltaflock.glyph/.env
```

with:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Get a key at <https://console.anthropic.com/settings/keys>. Google Calendar and
Asana keys are optional — see [`.env.example`](.env.example) for the full list.
Quick way to create it:

```bash
mkdir -p ~/Library/Application\ Support/ai.oltaflock.glyph
printf 'ANTHROPIC_API_KEY=sk-ant-REPLACE_ME\n' > ~/Library/Application\ Support/ai.oltaflock.glyph/.env
```

Then quit and reopen Glyph.

**2. Grant permissions.** On first launch Glyph asks for **Microphone** and
**Screen & System Audio Recording** (the latter is how it captures the other
side of an online call). Approve both. For Screen Recording, macOS will ask you
to **quit & reopen** Glyph once.

**3. First transcription downloads the speech model** (~1.6 GB, one time) to the
app-data folder. You'll see a "Downloading speech model…" status. After that,
transcription is fully offline.

**Using it:** click **Start recording**, talk / join your call, then **Stop**
(the red bar at the top lets you stop from any screen). Glyph transcribes the
recording locally and generates notes. For Hindi/Hinglish meetings, set the
language selector at the top of the meeting to **हिं** for best results (it’s
remembered).

## What it does

- **Records real meetings** — mic + system audio for online calls (no meeting
  bot, no virtual audio device), or mic alone for in-person meetings.
- **Transcribes locally** with whisper.cpp (Whisper large-v3-turbo, Metal GPU) —
  Hindi / English / Hinglish, in the language actually spoken. No cloud, no
  per-minute cost, no quota. Transcription runs **after you stop**.
- **Generates structured notes** with Claude — Summary · Key points · Decisions ·
  Open questions · Action items. Notes are written in **English**; the verbatim
  transcript stays in the original language. Toggle **Concise / Detailed**.
- **Pulls upcoming meetings** from Google Calendar (optional) and can auto- or
  ask-to-record at start time.
- **Exports action items to Asana** (optional) as tasks with assignee/due/project.
- **Stores everything locally** in SQLite, plus readable `transcript.txt` /
  `notes.md` files per meeting. Automatic DB backups on every launch.
- **Light & dark themes.**

## How it works

```
React + TS + Tailwind  (Tauri v2 WebView)
        │  IPC (typed commands/events)
        ▼
Tauri Core (Rust)  ──  AudioController · whisper.cpp · Anthropic · Google Cal · Asana · SQLite
        │
   ┌────┴───────────────┬─────────────────────┬──────────────────────┐
   ▼                    ▼                     ▼                      ▼
audiocap (Swift)   whisper.cpp (local)   Claude Haiku 4.5      Google Cal / Asana
mic + system tap   large-v3-turbo, Metal (structured notes)    (OAuth, PKCE)  [optional]
→ 16kHz mono WAV   transcribe-after-stop
```

The UI depends only on a small set of swappable interfaces; the engine behind
each can change without touching the UI.

| Interface        | Current implementation                          |
|------------------|-------------------------------------------------|
| `AudioSource`    | Native Swift sidecar (`audiocap`)               |
| `Transcriber`    | **Local whisper.cpp** (large-v3-turbo, Metal)   |
| `NoteGenerator`  | Claude Haiku 4.5 (Sonnet 4.6 optional)          |
| `NotesStore`     | SQLite (+ per-meeting `.txt`/`.md` exports)      |
| `CalendarSource` | Google Calendar (OAuth PKCE)                    |
| `TaskExporter`   | Asana (OAuth / token)                           |

**STT is batch + on-device:** the recording is saved as a 16 kHz WAV while you
talk; on **Stop**, whisper.cpp transcribes the whole file in one pass. No
websockets, no streaming, no API key for speech.

## Build from source (for contributors)

**Prerequisites** (Apple Silicon, macOS 14.4+):

- [Rust](https://www.rust-lang.org/tools/install) (stable)
- [Node.js](https://nodejs.org/) 18+ and [pnpm](https://pnpm.io/) (`npm i -g pnpm`)
- Xcode Command Line Tools — `xcode-select --install`
- CMake — `brew install cmake` (whisper.cpp builds with it)

```bash
# 1. clone
git clone https://github.com/khush0030/glyph.git
cd glyph

# 2. install frontend deps
pnpm install

# 3. add your key for dev (repo-root .env is picked up automatically)
cp .env.example .env && $EDITOR .env   # set ANTHROPIC_API_KEY

# 4. run in dev (Vite + Tauri; hot reload)
pnpm tauri dev

# 5. build a release .app + .dmg and install to /Applications
./scripts/rebuild-install.sh
```

`scripts/rebuild-install.sh` builds the release, copies `Glyph.app` to
`/Applications`, and produces a drag-install `.dmg` under
`src-tauri/target/release/bundle/dmg/`. First Rust build is slow (it compiles
whisper.cpp); later builds are incremental.

**Tests:**

```bash
cd src-tauri && cargo test            # Rust unit tests
pnpm exec tsc --noEmit                # frontend type-check (from repo root)
```

> The Swift `audiocap` sidecar is prebuilt and committed under
> `src-tauri/binaries/`. Rebuild it only if you change Swift sources:
> `./sidecar/build-and-install.sh`.

## Where your data lives

Everything is under `~/Library/Application Support/ai.oltaflock.glyph/`:

```
glyph.db                  SQLite — notes, transcripts, action items, settings
.env                      your API keys (installed app reads it here)
recordings/               raw .wav files (kept by default; re-transcribable)
meetings/<id>/
  ├─ transcript.txt       full verbatim transcript (original language)
  └─ notes.md             summary / key points / decisions / action items
backups/                  rotating glyph-*.db snapshots (newest 8, made on launch)
models/                   downloaded whisper ggml model (~1.6 GB)
```

Nothing here is in the repo. Deleting the app does not delete this folder.

## Contributing

1. Branch off `main`: `git checkout -b feat/your-thing`.
2. Make changes; keep `cargo test` and `pnpm exec tsc --noEmit` green.
3. Match the existing style (Rust: `thiserror`/`tracing`, no `unwrap()` in non-test
   code; Frontend: TS strict, Tailwind, functional components, hooks for state).
4. Commit one logical change at a time with a clear message.
5. Push and open a PR against `main`.

Read [`CLAUDE.md`](CLAUDE.md), [`SPEC.md`](SPEC.md), and [`ROADMAP.md`](ROADMAP.md)
first — they're the source of truth for architecture and conventions.

**Design principles**

1. **Transcript stays in the spoken language** — never translated; it's the
   lossless record (kept on disk as `transcript.txt`).
2. **Generated notes are always in English** — even for Hindi/Hinglish meetings.
3. **Keys never in the repo** — `.env` (gitignored) or the macOS Keychain only.
4. **Recording is consent-sensitive** — always a visible indicator. These are
   real client calls.
5. **Minimal > clever** — hooks for state, no Redux, no abstraction beyond the
   interfaces above.

## Project layout

```
glyph/
├─ README.md · CLAUDE.md · SPEC.md · ROADMAP.md   # docs — read these first
├─ design/            { mockup.html, glyph-logo.svg, app icon }
├─ scripts/           rebuild-install.sh           # build + install + .dmg
├─ sidecar/audiocap/  Swift audio capture sidecar
├─ src-tauri/         Rust core
│  ├─ migrations/     0001_init.sql                # SQLite schema
│  └─ src/            audio · whisper · notes · store · calendar · asana ·
│                     keychain · commands · events
└─ src/               React frontend
   ├─ screens/        Dashboard · Calendar · Notes · Meeting · Settings
   ├─ components/     Sidebar · RecordingBar · Transcript · NotesView · ...
   └─ lib/            ipc.ts · useRecordingController.ts · hooks
```

## Troubleshooting

- **"Glyph is damaged / can't be opened"** — Gatekeeper on the unsigned app. Run
  `xattr -dr com.apple.quarantine /Applications/Glyph.app`, or right-click → Open.
- **"Couldn't generate notes" / API errors** — check `ANTHROPIC_API_KEY` in
  `~/Library/Application Support/ai.oltaflock.glyph/.env`, then restart Glyph.
- **Transcript looks wrong (English for a Hindi meeting, repeated lines)** — set
  the language selector to **हिं** and use **Re-transcribe audio** in the meeting
  sidebar (audio is kept, so you can redo it).
- **Glyph isn't in System Settings → Privacy → Microphone / Screen Recording** —
  it registers there only after the first record attempt; start a recording once,
  then grant access and reopen.
- **Lost notes?** Restore from a snapshot in the `backups/` folder.

## License

Private project. All rights reserved.
