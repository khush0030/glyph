//! Join detection — keeps `audiocap --detect` running for the app's lifetime
//! (while the `detect_meetings` setting is on), turns its call_started /
//! call_ended lines into prompt-window shows/hides, and matches the call to
//! the nearest calendar event for the meeting's name + attendees.
//! Captures no audio: the sidecar reads a device-busy flag and the process list.

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
