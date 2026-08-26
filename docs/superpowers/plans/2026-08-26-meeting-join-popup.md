# Meeting-Join Popup ("Meeting Radar") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a meeting starts — by calendar time or by the user actually joining a Zoom/Teams/browser call — show a floating always-on-top popup with the meeting's name, platform, time and attendees, offering Record / Dismiss; Record hands off to the existing recording pipeline.

**Architecture:** A new headless `--detect` mode of the Swift `audiocap` sidecar reports "a call started/ended" (mic-in-use flag + process scan, zero audio captured). A Rust `detect` module keeps that sidecar alive, applies suppression rules, matches the call to the nearest calendar event, and drives a new Rust `prompt` module that owns a second Tauri window (label `prompt`, always-on-top, frameless). The frontend calendar scheduler stops rendering its in-app toast and routes through the same prompt window, so both triggers share one popup. The popup's Record button emits `prompt://record` to the main window, which runs the existing `openMeeting(true, …)` path.

**Tech Stack:** Swift 5.9 (CoreAudio, AppKit, libproc), Rust + Tauri 2.11 (`tauri-plugin-shell` sidecar, multi-window), React 18 + TypeScript + Tailwind.

Spec: `docs/superpowers/specs/2026-08-26-meeting-join-popup-design.md`.

## Global Constraints

- Keys in the macOS Keychain only; this feature stores no secrets.
- Detection captures **no audio**; recording starts only on explicit Record or the existing per-meeting Auto setting (spec §5).
- Rust: `thiserror`/`tracing`, **no `unwrap()` in non-test code**.
- Frontend: TypeScript strict, Tailwind, functional components, React hooks only (no Redux). Reuse `Badge`/`Seg` from `src/components/ui.tsx`; palette tokens from `src/index.css` (`bg-surface`, `border-line`, `text-muted`, `bg-indigo`, `bg-rec`, …).
- IPC: every new command/event is added to BOTH `src-tauri/src/events.rs` / Rust commands AND `src/lib/ipc.ts` (SPEC §10 contract).
- Note source for recordings started from the popup is the existing `"calendar"` `NoteSource` — no new variant.
- Reuse the existing `calendar` `CalendarEvent` Rust struct (all fields `pub`).
- Detection timing: start debounce **3 s**, end debounce **10 s**, dismiss cooldown **2 min**, popup auto-hide **60 s**, calendar match window **[now − 10 min, now + 5 min]**, sidecar restart backoff capped at **60 s**.
- Sidecar protocol: stdout JSON lines `{"evt":"call_started","platform":"zoom|teams|browser|unknown"}` and `{"evt":"call_ended"}`; status/errors on stderr via existing `Log`.
- New setting key: `detect_meetings` = `"on"` (default) | `"off"`.
- Implementation note (approved deviation from spec §1 wording): the sidecar **polls** the mic-busy flag once a second instead of registering a CoreAudio property listener. Same signal, no listener re-registration when the default input device changes (AirPods etc.). Debounce values are unchanged.
- Deviation from spec "Error handling": the prompt window is declared in `tauri.conf.json`, so it exists whenever the app boots — there is no runtime "window creation failed → in-app toast" fallback, and the old in-app toast is deleted (Task 5). A failed `show` is logged and the calendar trigger is simply missed for that meeting.
- Commands to verify things: `cd src-tauri && cargo check`, `cd src-tauri && cargo test`, `pnpm build` (runs `tsc`), `sidecar/build-and-install.sh` after any Swift change, `pnpm tauri dev` to run the app.

---

## File map

| Path | Responsibility |
|---|---|
| `sidecar/audiocap/Sources/audiocap/Detect.swift` (new) | `--detect` mode: mic-busy poll + process scan → call_started/call_ended JSON on stdout |
| `sidecar/audiocap/Sources/audiocap/main.swift` (modify) | dispatch `--detect` before audio setup |
| `src-tauri/Cargo.toml` (modify) | `macos-private-api` tauri feature (transparent window), tokio `time` |
| `src-tauri/tauri.conf.json` (modify) | second window `prompt`, `macOSPrivateApi` |
| `src-tauri/capabilities/default.json` (modify) | grant `prompt` window the same permissions |
| `src-tauri/src/events.rs` (modify) | `MEETING_DETECTED`, `MEETING_ENDED`, `PROMPT_RECORD` |
| `src-tauri/src/prompt.rs` (new) | prompt window state, positioning, show/hide, commands `show_prompt`, `prompt_current`, `prompt_dismiss`, `prompt_record` |
| `src-tauri/src/detect/mod.rs` (new) | detect sidecar lifecycle + restart backoff, suppression, calendar matching, `detect_set_enabled` command |
| `src-tauri/src/audio/mod.rs` (modify) | make `drain_lines` `pub(crate)` for reuse |
| `src-tauri/src/main.rs` (modify) | register modules, state, commands, start detector |
| `src/lib/ipc.ts` (modify) | `PromptPayload`, new commands + events |
| `src/PromptWindow.tsx` (new) | the popup UI, rendered in the `prompt` window |
| `src/main.tsx` (modify) | branch on window label |
| `src/App.tsx` (modify) | calendar `onAsk` → `show_prompt`; listen `prompt://record`; drop in-app toast |
| `src/components/MeetingStartingPrompt.tsx` (delete) | replaced by `PromptWindow` |
| `src/lib/useSettings.ts` (modify) | default `detect_meetings: "on"` |
| `src/screens/Settings.tsx` (modify) | "Detect when I join meetings" toggle |
| `SPEC.md` §10 (modify) | document new events/commands |

---

### Task 1: Sidecar `--detect` mode

**Files:**
- Create: `sidecar/audiocap/Sources/audiocap/Detect.swift`
- Modify: `sidecar/audiocap/Sources/audiocap/main.swift:15-17`

**Interfaces:**
- Produces: CLI `audiocap --detect` — runs until killed; stdout lines `{"evt":"call_started","platform":"zoom"|"teams"|"browser"|"unknown"}` / `{"evt":"call_ended"}`; stderr `{"kind":"status","msg":"detect mode"}` on start.

- [ ] **Step 1: Write `Detect.swift`**

```swift
import Foundation
import AppKit
import CoreAudio
import Darwin

// audiocap --detect — headless meeting-join detector for Glyph. Captures NO
// audio. Once a second it reads two cheap signals:
//   1. is some process using the default input device?
//      (kAudioDevicePropertyDeviceIsRunningSomewhere — public device metadata)
//   2. the running-process list, to attribute the call to a platform
//      (Zoom's in-meeting helper `CptHost`, Microsoft Teams, a browser).
// After 3 s of continuous activity it prints one JSON line to stdout:
//   {"evt":"call_started","platform":"zoom|teams|browser|unknown"}
// and after 10 s of inactivity:
//   {"evt":"call_ended"}
// Status / error lines stay on stderr via Log, like the other modes.
enum Detect {
    static let pollInterval: TimeInterval = 1
    static let startDebounce: TimeInterval = 3
    static let endDebounce: TimeInterval = 10

    private static var inCall = false
    private static var activeSince: Date?
    private static var idleSince: Date?

    static func run() -> Never {
        Log.status("detect mode")
        let timer = Timer(timeInterval: pollInterval, repeats: true) { _ in tick() }
        RunLoop.main.add(timer, forMode: .common)
        RunLoop.main.run()
        exit(0)
    }

    static func tick() {
        let procs = processNames()
        let zoomInMeeting = procs.contains("CptHost")
        let active = zoomInMeeting || micBusy()
        let now = Date()

        if active {
            idleSince = nil
            if activeSince == nil { activeSince = now }
            if !inCall, let since = activeSince, now.timeIntervalSince(since) >= startDebounce {
                inCall = true
                emit(["evt": "call_started", "platform": platform(procs: procs, zoom: zoomInMeeting)])
            }
        } else {
            activeSince = nil
            guard inCall else { return }
            if idleSince == nil { idleSince = now }
            if let since = idleSince, now.timeIntervalSince(since) >= endDebounce {
                inCall = false
                idleSince = nil
                emit(["evt": "call_ended"])
            }
        }
    }

    /// True when any process has the default input device running.
    static func micBusy() -> Bool {
        var addr = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultInputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        var dev = AudioDeviceID(0)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        let st = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &dev)
        guard st == noErr, dev != 0 else { return false }

        addr.mSelector = kAudioDevicePropertyDeviceIsRunningSomewhere
        var running: UInt32 = 0
        size = UInt32(MemoryLayout<UInt32>.size)
        guard AudioObjectGetPropertyData(dev, &addr, 0, nil, &size, &running) == noErr else {
            return false
        }
        return running != 0
    }

    /// Short names of every running process (libproc; no extra permissions).
    static func processNames() -> Set<String> {
        var names = Set<String>()
        let count = proc_listallpids(nil, 0)
        guard count > 0 else { return names }
        var pids = [pid_t](repeating: 0, count: Int(count) * 2)
        let bytes = Int32(pids.count * MemoryLayout<pid_t>.size)
        let got = proc_listallpids(&pids, bytes)
        var buf = [CChar](repeating: 0, count: Int(MAXPATHLEN))
        for pid in pids.prefix(Int(max(got, 0))) where pid > 0 {
            let n = buf.withUnsafeMutableBufferPointer { p -> Int32 in
                proc_name(pid, p.baseAddress, UInt32(p.count))
            }
            if n > 0 { names.insert(String(cString: buf)) }
        }
        return names
    }

    static let teamsNames: Set<String> = ["Microsoft Teams", "MSTeams", "Teams"]
    static let browserNames: Set<String> = [
        "Google Chrome", "Safari", "Arc", "Microsoft Edge", "Brave Browser", "Firefox",
    ]

    /// Attribute the call. Zoom is certain (CptHost); otherwise prefer whatever
    /// app is frontmost, then fall back to "is it running at all".
    static func platform(procs: Set<String>, zoom: Bool) -> String {
        if zoom { return "zoom" }
        if let front = NSWorkspace.shared.frontmostApplication?.localizedName {
            if teamsNames.contains(front) { return "teams" }
            if browserNames.contains(front) { return "browser" }
        }
        if !procs.isDisjoint(with: teamsNames) { return "teams" }
        if !procs.isDisjoint(with: browserNames) { return "browser" }
        return "unknown"
    }

    static func emit(_ obj: [String: Any]) {
        guard
            let data = try? JSONSerialization.data(withJSONObject: obj),
            let line = String(data: data, encoding: .utf8)
        else { return }
        FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
    }
}
```

- [ ] **Step 2: Dispatch `--detect` in `main.swift`**

Replace lines 15–17 (the one-shot permission probes) with:

```swift
// One-shot / headless modes: handle before any audio engine setup.
if CommandLine.arguments.contains("--check-perms") { Permissions.report() }
if CommandLine.arguments.contains("--request-perms") { Permissions.request() }
if CommandLine.arguments.contains("--detect") { Detect.run() }
```

Also add `//   audiocap --detect              headless call detector (see Detect.swift)` to the mode comment block at the top of `main.swift` (after the `--request-perms` line).

- [ ] **Step 3: Build**

Run: `cd sidecar/audiocap && swift build -c release 2>&1 | tail -5`
Expected: `Compiling audiocap … Build complete!` with no errors. (If `proc_listallpids` is unresolved, add `import Darwin.libproc` — but on macOS 14 SDK `import Darwin` covers it.)

- [ ] **Step 4: Manual verification**

Run: `cd sidecar/audiocap && .build/release/audiocap --detect`
Expected on stderr immediately: `{"kind":"status","msg":"detect mode"}`.
Then open a Google Meet in Chrome and join with mic → within ~4 s stdout prints `{"evt":"call_started","platform":"browser"}`. Leave the call → within ~11 s `{"evt":"call_ended"}`. Repeat with Zoom → `"platform":"zoom"`. Ctrl-C to stop.

- [ ] **Step 5: Install the sidecar binary + commit**

Run: `sidecar/build-and-install.sh`
Expected: `installed + signed → src-tauri/binaries/audiocap-<triple>`.

```bash
git add sidecar/audiocap/Sources/audiocap/Detect.swift sidecar/audiocap/Sources/audiocap/main.swift src-tauri/binaries/
git commit -m "sidecar: add --detect mode (mic-busy + process scan → call_started/ended)"
```

---

### Task 2: Prompt window (Rust) + config

**Files:**
- Modify: `src-tauri/Cargo.toml` (tauri features, tokio features)
- Modify: `src-tauri/tauri.conf.json` (`app.windows`, `app.macOSPrivateApi`)
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src-tauri/src/events.rs`
- Create: `src-tauri/src/prompt.rs`
- Modify: `src-tauri/src/main.rs`

**Interfaces:**
- Produces (Rust, used by Task 3):
  - `prompt::PromptPayload { kind: String, title: String, platform: Option<String>, start_ts: Option<i64>, attendees: Vec<String>, event_id: Option<String> }` (serde camelCase)
  - `prompt::PromptState` (managed) with `fn visible(&self) -> bool`, `fn in_cooldown(&self, now: Instant) -> bool`
  - `prompt::show(app: &AppHandle, payload: PromptPayload) -> Result<(), String>`
  - `prompt::hide(app: &AppHandle, start_cooldown: bool) -> Result<(), String>`
  - `events::MEETING_DETECTED = "meeting://detected"`, `events::MEETING_ENDED = "meeting://ended"`, `events::PROMPT_RECORD = "prompt://record"`
- Produces (IPC, used by Task 4/5): commands `show_prompt {payload}`, `prompt_current` → `Option<PromptPayload>`, `prompt_dismiss`, `prompt_record {payload}`; events `meeting://detected` (to `prompt` window, payload `PromptPayload`), `meeting://ended` (to `prompt`), `prompt://record` (to `main`, payload `PromptPayload`).

- [ ] **Step 1: Cargo features**

In `src-tauri/Cargo.toml` change:

```toml
tauri = { version = "2", features = ["macos-private-api"] }
tokio = { version = "1", features = ["sync", "rt", "macros", "time"] }
```

(`macos-private-api` is required for `transparent: true` windows on macOS; `time` gives `tokio::time::sleep` for the restart backoff in Task 3.)

- [ ] **Step 2: Window config**

In `src-tauri/tauri.conf.json`, set `app` to:

```json
"app": {
  "macOSPrivateApi": true,
  "windows": [
    {
      "label": "main",
      "title": "Glyph",
      "width": 1180,
      "height": 780,
      "minWidth": 940,
      "minHeight": 640,
      "resizable": true,
      "titleBarStyle": "Transparent"
    },
    {
      "label": "prompt",
      "title": "Glyph",
      "url": "index.html",
      "width": 360,
      "height": 168,
      "visible": false,
      "focus": false,
      "alwaysOnTop": true,
      "decorations": false,
      "transparent": true,
      "resizable": false,
      "skipTaskbar": true,
      "visibleOnAllWorkspaces": true
    }
  ],
  "security": {
    "csp": null
  }
}
```

In `src-tauri/capabilities/default.json` change `"windows": ["main"]` to `"windows": ["main", "prompt"]` and the description to `"Core permissions for the Glyph main + prompt windows."`.

- [ ] **Step 3: Event constants**

Append to `src-tauri/src/events.rs`:

```rust
/// → `prompt` window: show/refresh the popup with a PromptPayload.
pub const MEETING_DETECTED: &str = "meeting://detected";
/// → `prompt` window: the detected call ended; hide if still showing.
pub const MEETING_ENDED: &str = "meeting://ended";
/// → `main` window: user clicked Record in the popup; payload = PromptPayload.
pub const PROMPT_RECORD: &str = "prompt://record";
```

- [ ] **Step 4: Write `src-tauri/src/prompt.rs`**

```rust
//! Floating always-on-top prompt window — the one popup surface for both
//! record triggers: calendar start time (frontend scheduler → `show_prompt`)
//! and join detection (`detect` module → `show`). Record hands off to the
//! main window's existing recording pipeline via `prompt://record`.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewWindow};

use crate::events;

pub const WINDOW_LABEL: &str = "prompt";
const MAIN_LABEL: &str = "main";
/// After a Dismiss, join-detection stays quiet this long.
const DISMISS_COOLDOWN: Duration = Duration::from_secs(120);
/// Logical-pixel inset from the screen's top-right corner (clears the menu bar).
const MARGIN_RIGHT: f64 = 16.0;
const MARGIN_TOP: f64 = 44.0;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PromptPayload {
    /// "starting" (calendar time) or "detected" (call join).
    pub kind: String,
    pub title: String,
    pub platform: Option<String>,
    /// Epoch ms; None for ad-hoc calls not on the calendar.
    pub start_ts: Option<i64>,
    pub attendees: Vec<String>,
    pub event_id: Option<String>,
}

#[derive(Default)]
struct Inner {
    visible: bool,
    cooldown_until: Option<Instant>,
    current: Option<PromptPayload>,
}

#[derive(Default)]
pub struct PromptState(Mutex<Inner>);

impl PromptState {
    pub fn visible(&self) -> bool {
        self.0.lock().map(|g| g.visible).unwrap_or(false)
    }

    pub fn in_cooldown(&self, now: Instant) -> bool {
        self.0
            .lock()
            .map(|g| g.cooldown_until.is_some_and(|t| now < t))
            .unwrap_or(false)
    }
}

/// Position, load the payload into, and reveal the prompt window. Calling it
/// while already visible just refreshes the card (calendar info arriving after
/// a generic "detected" card).
pub fn show(app: &AppHandle, payload: PromptPayload) -> Result<(), String> {
    let state = app.state::<PromptState>();
    {
        let mut g = state.0.lock().map_err(|e| e.to_string())?;
        g.current = Some(payload.clone());
        g.visible = true;
    }
    let win = app
        .get_webview_window(WINDOW_LABEL)
        .ok_or_else(|| "prompt window missing".to_string())?;
    position_top_right(app, &win)?;
    app.emit_to(WINDOW_LABEL, events::MEETING_DETECTED, payload)
        .map_err(|e| e.to_string())?;
    win.show().map_err(|e| e.to_string())?;
    tracing::info!("prompt shown");
    Ok(())
}

/// Hide the prompt. `start_cooldown` = true for an explicit Dismiss.
pub fn hide(app: &AppHandle, start_cooldown: bool) -> Result<(), String> {
    let state = app.state::<PromptState>();
    {
        let mut g = state.0.lock().map_err(|e| e.to_string())?;
        g.visible = false;
        g.current = None;
        if start_cooldown {
            g.cooldown_until = Some(Instant::now() + DISMISS_COOLDOWN);
        }
    }
    if let Some(win) = app.get_webview_window(WINDOW_LABEL) {
        win.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Top-right of the monitor under the cursor (falls back to the primary one).
fn position_top_right(app: &AppHandle, win: &WebviewWindow) -> Result<(), String> {
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| win.primary_monitor().ok().flatten())
        .ok_or_else(|| "no monitor".to_string())?;
    let scale = monitor.scale_factor();
    let size = win.outer_size().map_err(|e| e.to_string())?;
    let origin = monitor.position();
    let extent = monitor.size();
    let x = origin.x + extent.width as i32 - size.width as i32 - (MARGIN_RIGHT * scale) as i32;
    let y = origin.y + (MARGIN_TOP * scale) as i32;
    win.set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())
}

// ---- Commands -------------------------------------------------------------

/// Frontend calendar scheduler → show the popup for a meeting at start time.
#[tauri::command]
pub fn show_prompt(app: AppHandle, payload: PromptPayload) -> Result<(), String> {
    show(&app, payload)
}

/// The popup asks for the current card on mount (covers a show that raced
/// its webview load).
#[tauri::command]
pub fn prompt_current(state: State<'_, PromptState>) -> Result<Option<PromptPayload>, String> {
    let g = state.0.lock().map_err(|e| e.to_string())?;
    Ok(g.current.clone())
}

#[tauri::command]
pub fn prompt_dismiss(app: AppHandle) -> Result<(), String> {
    hide(&app, true)
}

/// Record clicked: hide the popup, hand the payload to the main window (which
/// runs the existing openMeeting → recording pipeline) and bring it forward.
#[tauri::command]
pub fn prompt_record(app: AppHandle, payload: PromptPayload) -> Result<(), String> {
    hide(&app, false)?;
    app.emit_to(MAIN_LABEL, events::PROMPT_RECORD, payload)
        .map_err(|e| e.to_string())?;
    if let Some(main) = app.get_webview_window(MAIN_LABEL) {
        main.show().map_err(|e| e.to_string())?;
        main.unminimize().map_err(|e| e.to_string())?;
        main.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

- [ ] **Step 5: Register in `main.rs`**

Add `mod prompt;` to the module list (alphabetical, after `mod notes;`). Add `.manage(prompt::PromptState::default())` right after `.manage(audio::AudioState::default())`. Add to `generate_handler!` (after the `calendar::` lines):

```rust
            prompt::show_prompt,
            prompt::prompt_current,
            prompt::prompt_dismiss,
            prompt::prompt_record,
```

- [ ] **Step 6: Compile**

Run: `cd src-tauri && cargo check 2>&1 | tail -20`
Expected: `Finished` with no errors. (Warnings about unused `PromptState::visible`/`in_cooldown` are fine until Task 3.)

- [ ] **Step 7: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json src-tauri/capabilities/default.json src-tauri/src/events.rs src-tauri/src/prompt.rs src-tauri/src/main.rs
git commit -m "prompt: floating always-on-top prompt window + show/dismiss/record commands"
```

---

### Task 3: Rust `detect` module

**Files:**
- Modify: `src-tauri/src/audio/mod.rs:124` (`fn drain_lines` → `pub(crate) fn drain_lines`)
- Create: `src-tauri/src/detect/mod.rs`
- Modify: `src-tauri/src/main.rs`
- Test: inline `#[cfg(test)]` in `src-tauri/src/detect/mod.rs`

**Interfaces:**
- Consumes: `prompt::{show, hide, PromptPayload, PromptState}`, `audio::AudioState` (recording iff `.0.lock().is_some()`), `calendar::{calendar_upcoming, CalendarEvent}`, `commands::Db`, `audio::drain_lines`.
- Produces: `detect::start_if_enabled(app: &AppHandle)`, command `detect_set_enabled {enabled: bool}`, pure fns `should_prompt`, `match_event`, `build_payload`, `SETTING_KEY = "detect_meetings"`.

- [ ] **Step 1: Write the failing tests + module skeleton**

Create `src-tauri/src/detect/mod.rs` with the pure functions and tests only (the sidecar loop is added in Step 3 — TDD the logic first):

```rust
//! Join detection — keeps `audiocap --detect` running for the app's lifetime
//! (while the `detect_meetings` setting is on), turns its call_started /
//! call_ended lines into prompt-window shows/hides, and matches the call to
//! the nearest calendar event for the meeting's name + attendees.
//! Captures no audio: the sidecar reads a device-busy flag and the process list.

use crate::calendar::CalendarEvent;
use crate::prompt::PromptPayload;

pub const SETTING_KEY: &str = "detect_meetings";
/// Calendar match window around "now" (spec §2).
const MATCH_BEFORE_MS: i64 = 10 * 60 * 1000;
const MATCH_AFTER_MS: i64 = 5 * 60 * 1000;

/// Suppression rules (spec §2): never prompt while recording, while the popup
/// is already up, or during the post-Dismiss cooldown.
pub fn should_prompt(recording: bool, popup_visible: bool, in_cooldown: bool) -> bool {
    !recording && !popup_visible && !in_cooldown
}

/// Nearest event with a video link whose start is within the match window.
pub fn match_event(events: &[CalendarEvent], now_ms: i64) -> Option<&CalendarEvent> {
    events
        .iter()
        .filter(|e| e.link.is_some())
        .filter(|e| e.start_ts >= now_ms - MATCH_BEFORE_MS && e.start_ts <= now_ms + MATCH_AFTER_MS)
        .min_by_key(|e| (e.start_ts - now_ms).abs())
}

/// Card contents for a detected call: the matched event's details, or a
/// generic title from the detected platform.
pub fn build_payload(platform: &str, ev: Option<&CalendarEvent>) -> PromptPayload {
    let platform_label = match platform {
        "zoom" => Some("Zoom".to_string()),
        "teams" => Some("Teams".to_string()),
        "browser" => Some("Web call".to_string()),
        _ => None,
    };
    match ev {
        Some(e) => PromptPayload {
            kind: "detected".into(),
            title: e.title.clone(),
            platform: e.platform.clone().or(platform_label),
            start_ts: Some(e.start_ts),
            attendees: e.attendees.clone(),
            event_id: Some(e.id.clone()),
        },
        None => PromptPayload {
            kind: "detected".into(),
            title: match platform {
                "zoom" => "Zoom meeting",
                "teams" => "Teams meeting",
                _ => "Meeting",
            }
            .into(),
            platform: platform_label,
            start_ts: None,
            attendees: vec![],
            event_id: None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(id: &str, start_ts: i64, link: bool) -> CalendarEvent {
        CalendarEvent {
            id: id.into(),
            title: format!("Meeting {id}"),
            start_ts,
            end_ts: start_ts + 30 * 60 * 1000,
            link: link.then(|| "https://meet.google.com/abc".to_string()),
            platform: link.then(|| "Google Meet".to_string()),
            attendees: vec!["Malayka".into()],
            attendee_emails: vec![],
            account: String::new(),
            auto_record: "ask".into(),
        }
    }

    const NOW: i64 = 1_000_000_000_000;
    const MIN: i64 = 60 * 1000;

    #[test]
    fn should_prompt_only_when_all_clear() {
        assert!(should_prompt(false, false, false));
        assert!(!should_prompt(true, false, false));
        assert!(!should_prompt(false, true, false));
        assert!(!should_prompt(false, false, true));
    }

    #[test]
    fn match_picks_nearest_in_window() {
        let events = vec![ev("a", NOW - 8 * MIN, true), ev("b", NOW + 2 * MIN, true)];
        assert_eq!(match_event(&events, NOW).map(|e| e.id.as_str()), Some("b"));
    }

    #[test]
    fn match_skips_events_without_link() {
        let events = vec![ev("nolink", NOW, false), ev("linked", NOW + 4 * MIN, true)];
        assert_eq!(match_event(&events, NOW).map(|e| e.id.as_str()), Some("linked"));
    }

    #[test]
    fn match_none_outside_window() {
        let events = vec![ev("late", NOW + 6 * MIN, true), ev("early", NOW - 11 * MIN, true)];
        assert!(match_event(&events, NOW).is_none());
    }

    #[test]
    fn payload_uses_event_when_matched() {
        let e = ev("a", NOW, true);
        let p = build_payload("browser", Some(&e));
        assert_eq!(p.title, "Meeting a");
        assert_eq!(p.platform.as_deref(), Some("Google Meet"));
        assert_eq!(p.start_ts, Some(NOW));
        assert_eq!(p.event_id.as_deref(), Some("a"));
        assert_eq!(p.attendees, vec!["Malayka".to_string()]);
        assert_eq!(p.kind, "detected");
    }

    #[test]
    fn payload_falls_back_to_platform_title() {
        let p = build_payload("zoom", None);
        assert_eq!(p.title, "Zoom meeting");
        assert_eq!(p.platform.as_deref(), Some("Zoom"));
        assert_eq!(p.start_ts, None);
        assert!(p.attendees.is_empty());
        let u = build_payload("unknown", None);
        assert_eq!(u.title, "Meeting");
        assert_eq!(u.platform, None);
    }
}
```

Add `mod detect;` to `main.rs` (after `mod credentials;`).

- [ ] **Step 2: Run the tests**

Run: `cd src-tauri && cargo test detect:: 2>&1 | tail -15`
Expected: `test result: ok. 6 passed`.

- [ ] **Step 3: Add the sidecar loop, suppression wiring and command**

In `src-tauri/src/audio/mod.rs` change `fn drain_lines(` to `pub(crate) fn drain_lines(`.

Append to `src-tauri/src/detect/mod.rs` (above the `#[cfg(test)]` block), and extend the `use` list at the top to:

```rust
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

use crate::audio::{self, AudioState};
use crate::calendar::{self, CalendarEvent};
use crate::commands::Db;
use crate::events;
use crate::prompt::{self, PromptPayload, PromptState};
```

then the runtime code:

```rust
const BACKOFF_MIN: Duration = Duration::from_secs(2);
const BACKOFF_MAX: Duration = Duration::from_secs(60);
/// A run longer than this counts as healthy and resets the backoff.
const HEALTHY_RUN: Duration = Duration::from_secs(60);

#[derive(Default)]
pub struct DetectState {
    child: Mutex<Option<CommandChild>>,
    /// Bumped on every enable/disable; a loop exits when it no longer matches.
    generation: AtomicU64,
    running: AtomicBool,
}

/// Called once at startup: spawn the detector unless the user turned it off.
pub fn start_if_enabled(app: &AppHandle) {
    if read_enabled(app) {
        spawn_loop(app.clone());
    } else {
        tracing::info!("detect: disabled by setting");
    }
}

fn read_enabled(app: &AppHandle) -> bool {
    let db = app.state::<Db>();
    let Ok(conn) = db.0.lock() else { return true };
    let v: Result<String, _> = conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        [SETTING_KEY],
        |r| r.get(0),
    );
    !matches!(v.as_deref(), Ok("off"))
}

/// Settings toggle. Persisting the value is the frontend's job (set_settings);
/// this just starts/stops the sidecar.
#[tauri::command]
pub fn detect_set_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    let state = app.state::<DetectState>();
    if enabled {
        if !state.running.load(Ordering::SeqCst) {
            spawn_loop(app.clone());
        }
        return Ok(());
    }
    state.generation.fetch_add(1, Ordering::SeqCst);
    let child = state.child.lock().map_err(|e| e.to_string())?.take();
    if let Some(c) = child {
        c.kill().map_err(|e| e.to_string())?;
    }
    prompt::hide(&app, false)
}

fn spawn_loop(app: AppHandle) {
    // Scoped so the State borrow ends before `app` moves into the task.
    let my_gen = {
        let state = app.state::<DetectState>();
        state.running.store(true, Ordering::SeqCst);
        state.generation.fetch_add(1, Ordering::SeqCst) + 1
    };
    tauri::async_runtime::spawn(async move {
        let mut backoff = BACKOFF_MIN;
        loop {
            let state = app.state::<DetectState>();
            if state.generation.load(Ordering::SeqCst) != my_gen {
                break;
            }
            let spawned = app
                .shell()
                .sidecar("audiocap")
                .map_err(|e| e.to_string())
                .and_then(|c| c.args(["--detect"]).spawn().map_err(|e| e.to_string()));
            let (rx, child) = match spawned {
                Ok(v) => v,
                Err(e) => {
                    tracing::error!("detect: spawn failed: {e}");
                    tokio::time::sleep(backoff).await;
                    backoff = (backoff * 2).min(BACKOFF_MAX);
                    continue;
                }
            };
            if let Ok(mut g) = state.child.lock() {
                *g = Some(child);
            }
            tracing::info!("detect: sidecar running");
            let started = Instant::now();
            consume(&app, rx).await;
            if let Ok(mut g) = state.child.lock() {
                g.take();
            }
            if state.generation.load(Ordering::SeqCst) != my_gen {
                break; // stopped on purpose
            }
            backoff = if started.elapsed() > HEALTHY_RUN {
                BACKOFF_MIN
            } else {
                (backoff * 2).min(BACKOFF_MAX)
            };
            tracing::warn!("detect: sidecar exited, restarting in {backoff:?}");
            tokio::time::sleep(backoff).await;
        }
        app.state::<DetectState>().running.store(false, Ordering::SeqCst);
        tracing::info!("detect: stopped");
    });
}

/// Read the sidecar's stdout (events) + stderr (status) until it exits.
async fn consume(app: &AppHandle, mut rx: tauri::async_runtime::Receiver<CommandEvent>) {
    let mut out_buf: Vec<u8> = Vec::new();
    let mut err_buf: Vec<u8> = Vec::new();
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => {
                out_buf.extend_from_slice(&bytes);
                let mut lines: Vec<String> = Vec::new();
                audio::drain_lines(&mut out_buf, |l| {
                    lines.push(String::from_utf8_lossy(l).into_owned())
                });
                for line in lines {
                    handle_line(app, &line).await;
                }
            }
            CommandEvent::Stderr(bytes) => {
                err_buf.extend_from_slice(&bytes);
                audio::drain_lines(&mut err_buf, |l| {
                    tracing::info!("audiocap --detect: {}", String::from_utf8_lossy(l))
                });
            }
            CommandEvent::Terminated(_) => break,
            _ => {}
        }
    }
}

async fn handle_line(app: &AppHandle, line: &str) {
    let Ok(v) = serde_json::from_str::<Value>(line) else {
        return;
    };
    match v.get("evt").and_then(|e| e.as_str()) {
        Some("call_started") => {
            let platform = v.get("platform").and_then(|p| p.as_str()).unwrap_or("unknown");
            on_call_started(app, platform).await;
        }
        Some("call_ended") => on_call_ended(app),
        _ => {}
    }
}

async fn on_call_started(app: &AppHandle, platform: &str) {
    let recording = app
        .state::<AudioState>()
        .0
        .lock()
        .map(|g| g.is_some())
        .unwrap_or(false);
    let ps = app.state::<PromptState>();
    if !should_prompt(recording, ps.visible(), ps.in_cooldown(Instant::now())) {
        tracing::info!("detect: call_started ({platform}) suppressed");
        return;
    }
    // Not connected / fetch failed → generic card (spec: error handling).
    let events = calendar::calendar_upcoming().await.unwrap_or_default();
    let payload = build_payload(platform, match_event(&events, now_ms()));
    tracing::info!("detect: call_started ({platform}) → prompt '{}'", payload.title);
    if let Err(e) = prompt::show(app, payload) {
        tracing::error!("detect: show prompt failed: {e}");
    }
}

fn on_call_ended(app: &AppHandle) {
    let ps = app.state::<PromptState>();
    if !ps.visible() {
        return;
    }
    let _ = app.emit_to(prompt::WINDOW_LABEL, events::MEETING_ENDED, ());
    if let Err(e) = prompt::hide(app, false) {
        tracing::error!("detect: hide prompt failed: {e}");
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
```

- [ ] **Step 4: Wire into `main.rs`**

Add `.manage(detect::DetectState::default())` after the `PromptState` manage line. In `setup`, after `app.manage(Db(Mutex::new(conn)));` add:

```rust
            detect::start_if_enabled(app.handle());
```

Add `detect::detect_set_enabled,` to `generate_handler!` after the `prompt::` lines.

- [ ] **Step 5: Compile + test**

Run: `cd src-tauri && cargo check 2>&1 | tail -20 && cargo test detect:: 2>&1 | tail -5`
Expected: no errors; `6 passed`.

- [ ] **Step 6: Smoke run**

Run: `RUST_LOG=glyph=info pnpm tauri dev` (leave running ~20 s).
Expected in the terminal: `detect: sidecar running` and `audiocap --detect: {"kind":"status","msg":"detect mode"}`. Join a Meet call → `detect: call_started (browser) → prompt '…'` and `prompt shown`; a blank/empty always-on-top window (~360×168) appears top-right (the popup UI arrives in Task 4). Quit with Ctrl-C.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/detect/mod.rs src-tauri/src/audio/mod.rs src-tauri/src/main.rs
git commit -m "detect: run audiocap --detect, match calls to calendar, drive prompt window"
```

---

### Task 4: Frontend IPC + `PromptWindow`

**Files:**
- Modify: `src/lib/ipc.ts`
- Create: `src/PromptWindow.tsx`
- Modify: `src/main.tsx`

**Interfaces:**
- Consumes: Task 2 commands/events.
- Produces: `PromptPayload` TS type; `commands.showPrompt / promptCurrent / promptDismiss / promptRecord / detectSetEnabled`; `EVENTS.meetingDetected / meetingEnded / promptRecord`.

- [ ] **Step 1: `ipc.ts` additions**

After the `credentialStatus` entry inside `commands` add:

```ts
  // Prompt window (floating popup) — one surface for calendar + join triggers.
  showPrompt: (payload: PromptPayload) => invoke<void>("show_prompt", { payload }),
  promptCurrent: () => invoke<PromptPayload | null>("prompt_current"),
  promptDismiss: () => invoke<void>("prompt_dismiss"),
  promptRecord: (payload: PromptPayload) => invoke<void>("prompt_record", { payload }),
  // Join detection on/off (persist the setting separately via setSettings).
  detectSetEnabled: (enabled: boolean) => invoke<void>("detect_set_enabled", { enabled }),
```

After the `CalendarEvent` interface add:

```ts
/** What the floating prompt shows. kind: "starting" = calendar start time,
 *  "detected" = a call was joined. */
export interface PromptPayload {
  kind: "starting" | "detected";
  title: string;
  platform: string | null;
  startTs: number | null; // epoch ms; null for ad-hoc calls
  attendees: string[];
  eventId: string | null;
}
```

Extend `EVENTS`:

```ts
  meetingStarting: "meeting://starting",
  meetingDetected: "meeting://detected",
  meetingEnded: "meeting://ended",
  promptRecord: "prompt://record",
```

- [ ] **Step 2: Write `src/PromptWindow.tsx`**

```tsx
import { useCallback, useEffect, useState } from "react";
import { Badge } from "./components/ui";
import { commands, on, EVENTS, type PromptPayload } from "./lib/ipc";
import { fmtClock } from "./lib/useCalendar";
import { useTheme } from "./lib/useTheme";

const AUTO_HIDE_MS = 60_000;
const PLATFORM_COLORS: Record<string, string> = {
  Zoom: "#2D8CFF",
  Teams: "#6264A7",
  "Google Meet": "#2F9E6B",
  "Web call": "#2F9E6B",
};

/** Root of the always-on-top `prompt` window. Shows the card pushed by Rust
 *  (`meeting://detected`), hides on Dismiss / Record / call end / 60 s. */
export default function PromptWindow() {
  useTheme();
  const [p, setP] = useState<PromptPayload | null>(null);

  // Frameless + transparent window: only the card itself paints.
  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  }, []);

  useEffect(() => {
    commands.promptCurrent().then((cur) => cur && setP(cur)).catch(() => {});
    const uns: Array<() => void> = [];
    on<PromptPayload>(EVENTS.meetingDetected, (e) => setP(e.payload)).then((u) => uns.push(u));
    on<void>(EVENTS.meetingEnded, () => setP(null)).then((u) => uns.push(u));
    return () => uns.forEach((u) => u());
  }, []);

  const dismiss = useCallback(() => {
    setP(null);
    commands.promptDismiss().catch(() => {});
  }, []);

  const record = useCallback(() => {
    if (!p) return;
    const cur = p;
    setP(null);
    commands.promptRecord(cur).catch((e) => console.error("prompt_record failed", e));
  }, [p]);

  useEffect(() => {
    if (!p) return;
    const t = setTimeout(dismiss, AUTO_HIDE_MS);
    return () => clearTimeout(t);
  }, [p, dismiss]);

  if (!p) return <div className="h-screen w-screen" />;

  const when = p.startTs ? fmtClock(p.startTs) : null;
  const extra = p.attendees.length - 2;

  return (
    <div className="h-screen w-screen p-2">
      <div className="h-full bg-surface border border-line rounded-[16px] shadow-[0_24px_70px_rgba(26,24,35,.28)] p-[14px] flex flex-col animate-fade">
        <div className="flex items-center gap-[7px] mb-[6px]">
          <span className="w-[8px] h-[8px] rounded-full bg-rec animate-pulse-dot" />
          <span className="text-[11px] font-bold tracking-[0.6px] uppercase text-rec">
            {p.kind === "detected" ? "Meeting detected" : "Meeting starting"}
          </span>
        </div>
        <div className="text-[14.5px] font-bold truncate">{p.title}</div>
        <div className="text-[12px] text-muted truncate mb-auto">
          {p.platform && (
            <Badge color={PLATFORM_COLORS[p.platform] ?? "#70695F"}>{p.platform}</Badge>
          )}
          {when && <span> · {when.t} {when.ampm}</span>}
          {p.attendees.length > 0 && (
            <span>
              {" "}· {p.attendees.slice(0, 2).join(", ")}
              {extra > 0 && ` +${extra}`}
            </span>
          )}
        </div>
        <div className="flex gap-2 mt-[10px]">
          <button
            type="button"
            onClick={record}
            className="flex-1 flex items-center justify-center gap-[7px] bg-indigo text-white font-semibold text-[13px] py-[8px] rounded-[10px] hover:bg-indigo-deep transition-colors"
          >
            <span className="w-2 h-2 rounded-full bg-white" /> Record
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="font-semibold text-[13px] px-[14px] py-[8px] rounded-[10px] border border-line text-muted hover:border-faint"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Branch in `src/main.tsx`**

Replace the `App` import + render with:

```tsx
import App from "./App";
import PromptWindow from "./PromptWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
```

(keep the font/css imports as they are) and

```tsx
// The same bundle serves both Tauri windows; pick the root by window label.
// Outside Tauri (plain browser during UI work) getCurrentWindow throws → App.
const isPromptWindow = (() => {
  try {
    return getCurrentWindow().label === "prompt";
  } catch {
    return false;
  }
})();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{isPromptWindow ? <PromptWindow /> : <App />}</React.StrictMode>
);
```

- [ ] **Step 4: Type-check + run**

Run: `pnpm build 2>&1 | tail -5`
Expected: `tsc` clean, `vite build` completes.

Run: `pnpm tauri dev`, join a Meet call. Expected: the top-right card appears with "MEETING DETECTED", a title (calendar title if a linked event is within the window, else "Meeting"), platform badge, and Record / Dismiss. Click **Dismiss** → card hides; joining again within 2 min does not re-prompt (cooldown; check the log line `suppressed`). Wait >2 min, rejoin → prompts again. Leave the card alone for 60 s → hides itself.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ipc.ts src/PromptWindow.tsx src/main.tsx
git commit -m "prompt: PromptWindow UI in the floating window + IPC surface"
```

---

### Task 5: Route the calendar trigger through the popup; Record hand-off

**Files:**
- Modify: `src/App.tsx`
- Delete: `src/components/MeetingStartingPrompt.tsx`

**Interfaces:**
- Consumes: `commands.showPrompt`, `EVENTS.promptRecord`, `PromptPayload`.

- [ ] **Step 1: Edit `App.tsx`**

Imports: remove `import MeetingStartingPrompt from "./components/MeetingStartingPrompt";`; change the react import to `import { useCallback, useEffect, useRef, useState } from "react";`; change the ipc import to `import { commands, on, EVENTS, type NoteSource, type CalendarEvent, type PromptPayload } from "./lib/ipc";`.

Remove `const [starting, setStarting] = useState<CalendarEvent | null>(null);`.

Replace the `onAsk` line and add the record listener, so the scheduler block reads:

```tsx
  // Fire at a meeting's start: auto-record, or ask via the floating prompt
  // window (same surface join-detection uses).
  const onAuto = useCallback(
    (ev: CalendarEvent) => openMeeting(true, { title: ev.title, source: "calendar" }),
    [openMeeting]
  );
  const onAsk = useCallback((ev: CalendarEvent) => {
    commands
      .showPrompt({
        kind: "starting",
        title: ev.title,
        platform: ev.platform,
        startTs: ev.startTs,
        attendees: ev.attendees,
        eventId: ev.id,
      })
      .catch((e) => console.error("show_prompt failed", e));
  }, []);
  useMeetingScheduler(onAuto, onAsk);

  // Record clicked in the prompt window → the normal calendar-record path.
  const openMeetingRef = useRef(openMeeting);
  openMeetingRef.current = openMeeting;
  useEffect(() => {
    let un: (() => void) | undefined;
    on<PromptPayload>(EVENTS.promptRecord, (e) => {
      openMeetingRef.current(true, { title: e.payload.title, source: "calendar" });
    }).then((u) => (un = u));
    return () => un?.();
  }, []);
```

Delete the whole `{starting && ( <MeetingStartingPrompt … /> )}` block at the bottom of the JSX.

- [ ] **Step 2: Delete the old toast**

Run: `git rm src/components/MeetingStartingPrompt.tsx`

- [ ] **Step 3: Type-check + verify**

Run: `pnpm build 2>&1 | tail -5` → clean.

Run: `pnpm tauri dev`. Create a Google Calendar event starting in 2 minutes with a Meet link; wait. Expected: the floating card appears top-right with "MEETING STARTING", the event title, platform badge, time, attendees — even with Glyph's main window hidden behind another app. Click **Record** → Glyph's main window comes to the front on the Meeting page, recording indicator running, note titled after the event. Stop the recording → transcript/notes as before.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "app: calendar ask-first goes through the floating prompt; Record hand-off"
```

---

### Task 6: Settings toggle

**Files:**
- Modify: `src/lib/useSettings.ts:7-18`
- Modify: `src/screens/Settings.tsx` (Recording & privacy card, after the "Auto-record meetings" row)

- [ ] **Step 1: Default**

In `DEFAULTS` add `detect_meetings: "on",` after `auto_record: "ask",`.

- [ ] **Step 2: Row**

In `Settings.tsx`, directly after the `Auto-record meetings` `<SRow … />` add:

```tsx
        <SRow
          title="Detect when I join meetings"
          desc="Show a floating prompt to record when a Zoom, Teams or browser call starts — even for meetings not on your calendar. Nothing is recorded until you tap Record."
          control={
            <Seg
              options={["Off", "On"]}
              value={idx(["off", "on"], values.detect_meetings)}
              onChange={(i) => {
                const v = ["off", "on"][i];
                set("detect_meetings", v);
                commands.detectSetEnabled(v === "on").catch((e) =>
                  console.error("detect_set_enabled failed", e)
                );
              }}
            />
          }
        />
```

(`commands`, `Seg`, `idx`, `set`, `values` are already in scope in this file.)

- [ ] **Step 3: Verify**

Run: `pnpm build 2>&1 | tail -3` → clean. Run `pnpm tauri dev`: flip the toggle Off → log shows `detect: stopped`; join a call → no popup. Flip On → `detect: sidecar running`; join → popup. Quit and relaunch with it Off → log `detect: disabled by setting`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/useSettings.ts src/screens/Settings.tsx
git commit -m "settings: 'Detect when I join meetings' toggle"
```

---

### Task 7: Docs + full-screen check + final verification

**Files:**
- Modify: `SPEC.md` §10 (events/commands list)
- Modify: `ROADMAP.md` (M5 note)

- [ ] **Step 1: SPEC §10**

In the `**Events:**` line of SPEC.md §10 append: `` `meeting://detected {PromptPayload}` (→ prompt window), `meeting://ended` (→ prompt window), `prompt://record {PromptPayload}` (→ main window) ``. Add a `**Prompt window commands:**` line: `` `show_prompt {payload}`, `prompt_current`, `prompt_dismiss`, `prompt_record {payload}`, `detect_set_enabled {enabled}` ``. Add one sentence under the calendar section (line ~100): "Join detection: `audiocap --detect` (mic-busy flag + process scan, no audio) fires the same ask-first prompt for calls not on the calendar; see `docs/superpowers/specs/2026-08-26-meeting-join-popup-design.md`."

- [ ] **Step 2: ROADMAP**

Under M5 add: `**Meeting radar (2026-08-26):** floating always-on-top prompt window for both triggers + sidecar `--detect` join detection. Done when joining a Zoom/Meet call with Glyph in the background shows the prompt and Record starts a recording.`

- [ ] **Step 3: Full-screen behaviour check (spec §3 caveat)**

Run `pnpm tauri dev`, put Zoom in macOS full-screen, join a meeting. Record the outcome in the ROADMAP line: either "shows over full-screen Zoom" or "shows once Zoom leaves full-screen (known limit)". No code change either way in this plan.

- [ ] **Step 4: Final verification**

Run: `cd src-tauri && cargo test 2>&1 | tail -3 && cargo check 2>&1 | tail -1 && cd .. && pnpm build 2>&1 | tail -2`
Expected: all tests pass, check clean, build clean.

- [ ] **Step 5: Commit**

```bash
git add SPEC.md ROADMAP.md
git commit -m "docs: meeting radar — prompt window events/commands, roadmap note"
```
