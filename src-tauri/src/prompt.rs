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
        self.0
            .lock()
            .map(|g| g.visible)
            .map_err(|e| tracing::error!("prompt state lock poisoned: {e}"))
            .unwrap_or(false)
    }

    pub fn in_cooldown(&self, now: Instant) -> bool {
        self.0
            .lock()
            .map(|g| g.cooldown_until.is_some_and(|t| now < t))
            .map_err(|e| tracing::error!("prompt state lock poisoned: {e}"))
            .unwrap_or(false)
    }
}

/// Position, load the payload into, and reveal the prompt window. Calling it
/// while already visible just refreshes the card (calendar info arriving after
/// a generic "detected" card).
pub fn show(app: &AppHandle, payload: PromptPayload) -> Result<(), String> {
    let win = app
        .get_webview_window(WINDOW_LABEL)
        .ok_or_else(|| "prompt window missing".to_string())?;
    position_top_right(app, &win)?;
    app.emit_to(WINDOW_LABEL, events::MEETING_DETECTED, payload.clone())
        .map_err(|e| e.to_string())?;
    win.show().map_err(|e| e.to_string())?;

    let state = app.state::<PromptState>();
    {
        let mut g = state.0.lock().map_err(|e| e.to_string())?;
        g.current = Some(payload);
        g.visible = true;
    }
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
    } else {
        tracing::warn!("prompt window missing on hide");
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
    } else {
        tracing::warn!("main window missing on prompt_record");
    }
    Ok(())
}
