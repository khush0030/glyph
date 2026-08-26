# Meeting-Join Popup ("Meeting Radar") — Design

**Date:** 2026-08-26
**Status:** Approved by Khush (trigger = both, surface = floating window, detection = sidecar detect mode)

## Goal

Whenever a meeting starts — by calendar start time *or* by the user actually joining a call
(Zoom, Teams, Google Meet in a browser) — Glyph shows a small floating always-on-top popup
over whatever app is frontmost. The popup shows the meeting's basic info (name, platform,
start time, attendees) and offers **Record** / **Dismiss**. Record hands off to the existing
capture → transcribe → notes pipeline (hard rule 5: two triggers, one pipeline).

## What exists today

- `useMeetingScheduler` (frontend) fires at a calendar event's start time (±5 min window,
  once per event per session) and either auto-records or shows `MeetingStartingPrompt`,
  an in-app bottom-right toast. Invisible when Glyph is backgrounded — which is exactly
  when the user is joining a meeting.
- No detection of an actual call starting. Ad-hoc meetings (not on the calendar) never prompt.

## Architecture

### 1. Sidecar `--detect` mode (Swift, new `Detect.swift`)

A new headless mode of the existing `audiocap` sidecar. **Captures zero audio.**

- **Signal A — mic in use:** CoreAudio property listener on the default input device for
  `kAudioDevicePropertyDeviceIsRunningSomewhere` ("some process is using the mic").
  Re-resolves the listener when the default input device changes. This is public device
  metadata; no new permissions are required.
- **Signal B — attribution:** when mic-busy flips on, scan running processes
  (`NSWorkspace.runningApplications` + `sysctl` for helper processes):
  - `CptHost` process present → `zoom` (Zoom's in-meeting helper; the reliable Zoom tell).
  - `Microsoft Teams` running → `teams`.
  - Chrome / Safari / Arc / Edge running → `browser` (Meet et al.).
  - Otherwise → `unknown`.
- **Debounce:** mic busy must persist ≥ 3 s before firing (filters Siri / dictation blips).
  Call end fires when mic busy has been clear ≥ 10 s and `CptHost` is gone.
- **Protocol:** JSON lines on stdout:
  `{"evt":"call_started","platform":"zoom|teams|browser|unknown"}` and
  `{"evt":"call_ended"}`. Status / error lines stay JSON on stderr via the existing `Log`.
- CLI: `audiocap --detect`. Standalone-testable in a terminal.

### 2. Rust `detect` module (`src-tauri/src/detect/mod.rs`)

- Spawns `audiocap --detect` at app startup as a long-lived process (separate from the
  recording spawn in `audio/mod.rs`); restarts with backoff if it exits. Spawn is gated on
  the new setting (see §4).
- **Suppression:** a `call_started` is ignored when (a) a recording is already active,
  (b) the popup is already visible, or (c) within a 2-minute cooldown after a Dismiss.
- **Calendar matching:** on `call_started`, look through the cached upcoming calendar
  events for the nearest event with a video link whose start time is within
  [now − 10 min, now + 5 min]. Match → attach `{title, startTs, attendees, platform}`.
  No match → fallback payload with a generic title ("Zoom meeting" / "Teams meeting" /
  "Meeting") and the detected platform.
- **Events:** new constants in `events.rs`, mirrored in `ipc.ts`:
  - `meeting://detected {platform, event?}` — show/refresh the popup.
  - `meeting://ended` — hide the popup if still showing.
- Errors: `thiserror`, `tracing`; no `unwrap()`.

### 3. Floating popup window (Tauri v2 second WebviewWindow)

- Label `prompt`, created hidden at startup. Config: `alwaysOnTop`, `decorations: false`,
  `transparent: true`, `resizable: false`, `skipTaskbar: true`, visible on all workspaces,
  ~360 × 150, positioned top-right of the screen containing the cursor.
- Loads the same `index.html`; `main.tsx` branches on the Tauri window label —
  `prompt` renders a new `PromptWindow` component instead of `App`.
- `PromptWindow` listens for `meeting://detected` and renders an enriched card reusing
  `MeetingStartingPrompt`'s visual style: pulsing red dot, "Meeting detected" /
  "Meeting starting" label, title, platform badge, start time, first 2 attendees + "+N".
- **Both triggers unify here.** The calendar scheduler's `onAsk` path stops rendering the
  in-app toast; instead it invokes a new command `show_prompt(event)` which routes the same
  payload to the floating window. One popup surface for both triggers. Dedup: if a
  detection matches an event already shown by the calendar trigger, the popup just
  updates its info instead of re-appearing.
- **Record:** popup emits `prompt://record {payload}`; the main window's `App` listens,
  runs the existing `openMeeting(true, {title, source: "calendar"})` path (reuse the
  existing `calendar` note source; no new `NoteSource` variant),
  and the main window is shown + focused (new command `show_main_window`). Popup hides.
- **Dismiss / timeout / end:** Dismiss hides the popup (and starts the 2-min cooldown);
  the popup auto-hides after 60 s without interaction, and on `meeting://ended`.
- Full-screen caveat: showing over a *full-screen* Zoom needs the macOS panel window
  level; verify during implementation, acceptable fallback is appearing once Zoom is not
  full-screen.

### 4. Settings

New toggle in Settings: **"Detect when I join meetings"**, default **on**, persisted in the
existing settings store. Off → the detect sidecar is not spawned (and is killed if running).

### 5. Consent (hard rule 6)

Detection captures no audio — it reads a device-busy flag and the process list. Recording
still starts only on an explicit Record click or the existing per-meeting Auto setting,
with the existing visible recording indicator.

## Data flow

```
audiocap --detect ──stdout JSON──▶ Rust detect module ──match calendar──▶ meeting://detected
calendar scheduler (frontend) ──show_prompt cmd──────────────────────────▶     │
                                                                               ▼
                                                                    prompt window (floating)
                                                                   Record ▶ prompt://record
                                                                               │
                                                       main window App ◀───────┘
                                                       openMeeting(true) → existing pipeline
```

## Error handling

- Detect sidecar crash → log, restart with exponential backoff (cap ~1 min); never blocks
  the app or recording.
- Calendar not connected / fetch fails → popup still fires with the generic fallback title.
- Popup window creation failure → log and fall back to the existing in-app toast path.

## Testing

- **Sidecar:** run `audiocap --detect` in a terminal; join/leave a Zoom and a Meet call;
  verify `call_started` platform attribution, debounce, and `call_ended`.
- **Rust:** unit-test the calendar-matching function (in-window match, no-link skip,
  no-match fallback) and the suppression rules.
- **Frontend:** drive `PromptWindow` with mock `meeting://detected` payloads; verify
  Record hand-off reaches `openMeeting` and the dedup/update path.

## Out of scope

- Auto-record on detection (detection always asks; per-meeting Auto stays calendar-only).
- FaceTime / phone-call detection.
- Windows/Linux (macOS only, like the rest of Glyph).
