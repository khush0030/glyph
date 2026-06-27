# CLAUDE.md — Glyph

Read this first, every session. `SPEC.md` is the detail, `ROADMAP.md` is the order of work. Ship the cloud path first; local "Private Mode" comes later as its own milestone.

## What we're building
**Glyph** — a desktop-first macOS meeting notetaker. It records mic + system audio (online calls) or mic alone (in-person meetings), transcribes Hindi / English / Hinglish, and turns the transcript plus the user's sparse typed notes into clean structured notes (summary, key points, decisions, action items). It pulls upcoming meetings from the calendar, can auto- or manually start recording, and pushes action items straight to Asana with assignees. Granola-style, clean, minimal.

## Locked stack (do not change without asking)
- **Shell:** Tauri v2 — Rust core + React + TypeScript + Tailwind frontend.
- **Audio capture:** native **Swift CLI sidecar** — Core Audio process tap (system audio) + AVAudioEngine (mic), mixed to 16 kHz mono PCM, streamed to Rust over stdout. Shipped as a Tauri `externalBin`.
- **STT (cloud default):** **ElevenLabs Scribe v2 Realtime** over WebSocket (~$0.28/hr, ~150 ms, language = multi).
- **Analysis LLM (cloud default):** **OpenAI GPT-4o-mini** (`gpt-4o-mini`, well under 1¢/meeting), two-pass: proofread the transcript, then summarize. `gpt-4o` as an optional "deep notes" toggle. (Migrated off Claude Haiku on 2026-06-27 for cost — no Anthropic dependency remains.)
- **Private Mode (local, later milestone):** Whisper large-v3-turbo (`whisper.cpp`/whisper-rs, Metal) + Ollama (`qwen2.5:7b`). Same interfaces — a toggle, not a second app.
- **Calendar:** Google Calendar API via OAuth (PKCE, system browser, token in macOS Keychain).
- **Tasks:** Asana API via OAuth — action items → tasks with assignee, due date, project.
- **Storage:** local **SQLite**. No web backend — the desktop app holds API keys in the macOS Keychain and calls OpenAI / Google (Calendar + Gmail) / Asana directly.

## The six swappable interfaces (core rule)
The React UI depends ONLY on these, never on a concrete implementation. Cloud vs local is which implementation is wired in.
- `AudioSource` — emits 16 kHz mono PCM (+ RMS). Always the native sidecar.
- `Transcriber` — PCM → `{text, lang, startMs, endMs, isFinal}`. Cloud: Scribe v2. Local: Whisper.
- `NoteGenerator` — transcript + scratch → markdown. Cloud: OpenAI GPT-4o (two-pass). Local: Ollama.
- `NotesStore` — SQLite persistence.
- `CalendarSource` — upcoming events + video-link detection. Google Calendar.
- `TaskExporter` — action items → external tasks. Asana.

## Hard rules
1. **Keys live in the macOS Keychain only** — never in the repo, never in plaintext config. OpenAI/Google/Asana tokens all go through Keychain.
2. **Do not translate transcribed text.** Every line stays in the language spoken. The note-gen prompt enforces this. Translation is a future opt-in feature.
3. **Always run STT with language = multi / auto.** Never force `hi` or `en`.
4. **Spike the risky thing first.** The Swift audio sidecar is ~80% of the project risk. M1 proves it before any UI polish or note-gen.
5. **Two record triggers, one pipeline.** Manual ("Start recording" button) and calendar-driven (auto / ask-first) both feed the same capture → transcribe → notes flow. Build manual first; calendar is a later trigger on top.
6. **Recording is consent-sensitive.** Always show a visible recording indicator. Offer an optional auto-disclosure line in notes. These are real client calls.
7. **Minimal > clever.** React hooks for state, no Redux, no abstraction beyond the six interfaces. Match `design/mockup.html` exactly — clean indigo + lime, don't redesign.

## Conventions
- Rust: `thiserror`, `tracing` (local file only), no `unwrap()` in non-test code.
- Frontend: TypeScript strict, Tailwind, functional components. Brand = `design/glyph-logo.svg`. Pages = Dashboard, Meeting/record, Settings (+ Asana modal) per `design/mockup.html`.
- IPC: everything through the typed command/event contract in `SPEC.md §10`.
- OAuth: loopback + PKCE via the system browser; tokens to Keychain. No client secrets in the bundle.
- Commit one ROADMAP slice per commit with its acceptance criterion.

## When unsure
Stop and surface the decision — especially anything touching macOS audio APIs, signing/entitlements, putting a key outside the Keychain, or deviating from the six-interface structure. Resolve `SPEC.md §13` open items before the milestone that depends on them.
