//! CalendarSource — Google Calendar via OAuth 2.0 for desktop apps: PKCE +
//! loopback redirect, system browser, tokens in the Keychain (SPEC §8). No
//! client secret in the app. Lists upcoming events and detects video links.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::keychain;

const AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const SCOPE: &str = "https://www.googleapis.com/auth/calendar.readonly";
const TOKENS_KEY: &str = "google_tokens";

#[derive(Serialize, Deserialize, Default)]
struct Tokens {
    refresh_token: String,
    access_token: String,
    /// Unix seconds when access_token expires.
    expires_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    pub id: String,
    pub title: String,
    pub start_ts: i64, // epoch ms
    pub end_ts: i64,
    pub link: Option<String>,
    pub platform: Option<String>,
    pub attendees: Vec<String>,
    pub auto_record: String,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn b64url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn random_b64(len: usize) -> Result<String, String> {
    let mut buf = vec![0u8; len];
    getrandom::getrandom(&mut buf).map_err(|e| e.to_string())?;
    Ok(b64url(&buf))
}

#[tauri::command]
pub fn calendar_connected() -> bool {
    matches!(keychain::get(TOKENS_KEY), Ok(Some(_)))
}

#[tauri::command]
pub async fn calendar_connect(app: AppHandle) -> Result<(), String> {
    let client_id = keychain::get("google_oauth_client_id")
        .map_err(|e| e.to_string())?
        .filter(|s| !s.is_empty())
        .ok_or("No Google OAuth client ID — add it in Settings.")?;

    let verifier = random_b64(32)?;
    let challenge = b64url(&Sha256::digest(verifier.as_bytes()));
    let state = random_b64(16)?;

    // Bind the loopback listener first so we know the redirect port.
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect = format!("http://127.0.0.1:{port}");

    let auth_url = format!(
        "{AUTH_ENDPOINT}?client_id={}&redirect_uri={}&response_type=code&scope={}&code_challenge={}&code_challenge_method=S256&access_type=offline&prompt=consent&state={}",
        urlencode(&client_id),
        urlencode(&redirect),
        urlencode(SCOPE),
        challenge,
        state,
    );

    app.opener()
        .open_url(auth_url, None::<&str>)
        .map_err(|e| format!("could not open browser: {e}"))?;

    // Wait (off the async runtime) for Google to hit the loopback redirect.
    let expected_state = state.clone();
    let code = tauri::async_runtime::spawn_blocking(move || wait_for_code(listener, &expected_state))
        .await
        .map_err(|e| e.to_string())??;

    let tokens = exchange_code(&client_id, &code, &verifier, &redirect).await?;
    keychain::set(
        TOKENS_KEY,
        &serde_json::to_string(&tokens).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn calendar_disconnect() -> Result<(), String> {
    keychain::delete(TOKENS_KEY).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn calendar_upcoming() -> Result<Vec<CalendarEvent>, String> {
    let client_id = keychain::get("google_oauth_client_id")
        .map_err(|e| e.to_string())?
        .ok_or("No Google client ID.")?;
    let stored = keychain::get(TOKENS_KEY)
        .map_err(|e| e.to_string())?
        .ok_or("Google Calendar not connected.")?;
    let mut tokens: Tokens = serde_json::from_str(&stored).map_err(|e| e.to_string())?;

    if tokens.expires_at <= now_secs() + 30 {
        refresh(&client_id, &mut tokens).await?;
        keychain::set(
            TOKENS_KEY,
            &serde_json::to_string(&tokens).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    }

    let time_min = chrono::Utc::now().to_rfc3339();
    let time_max = (chrono::Utc::now() + chrono::Duration::days(14)).to_rfc3339();
    let url = format!(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin={}&timeMax={}&singleEvents=true&orderBy=startTime&maxResults=50",
        urlencode(&time_min),
        urlencode(&time_max),
    );

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .bearer_auth(&tokens.access_token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let s = resp.status();
        let b = resp.text().await.unwrap_or_default();
        return Err(format!("Calendar API {s}: {}", b.chars().take(200).collect::<String>()));
    }
    let body: Value = resp.json().await.map_err(|e| e.to_string())?;
    let items = body.get("items").and_then(|i| i.as_array()).cloned().unwrap_or_default();

    Ok(items.iter().filter_map(parse_event).collect())
}

fn parse_event(e: &Value) -> Option<CalendarEvent> {
    let id = e.get("id")?.as_str()?.to_string();
    let title = e
        .get("summary")
        .and_then(|s| s.as_str())
        .unwrap_or("(no title)")
        .to_string();
    let start_ts = parse_time(e.get("start"))?;
    let end_ts = parse_time(e.get("end")).unwrap_or(start_ts);

    let (link, platform) = detect_link(e);
    let attendees = e
        .get("attendees")
        .and_then(|a| a.as_array())
        .map(|arr| {
            arr.iter()
                .filter(|a| a.get("self").and_then(|s| s.as_bool()) != Some(true))
                .filter_map(|a| {
                    a.get("displayName")
                        .or_else(|| a.get("email"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                })
                .collect()
        })
        .unwrap_or_default();

    Some(CalendarEvent {
        id,
        title,
        start_ts,
        end_ts,
        link,
        platform,
        attendees,
        auto_record: "ask".into(),
    })
}

fn parse_time(node: Option<&Value>) -> Option<i64> {
    let node = node?;
    if let Some(dt) = node.get("dateTime").and_then(|v| v.as_str()) {
        return chrono::DateTime::parse_from_rfc3339(dt).ok().map(|d| d.timestamp_millis());
    }
    // all-day event: date only
    if let Some(d) = node.get("date").and_then(|v| v.as_str()) {
        let s = format!("{d}T00:00:00Z");
        return chrono::DateTime::parse_from_rfc3339(&s).ok().map(|d| d.timestamp_millis());
    }
    None
}

/// Detect a meeting link + platform from conferenceData, hangoutLink,
/// location, or description.
fn detect_link(e: &Value) -> (Option<String>, Option<String>) {
    // conferenceData.entryPoints[].uri where type == "video"
    if let Some(eps) = e
        .get("conferenceData")
        .and_then(|c| c.get("entryPoints"))
        .and_then(|p| p.as_array())
    {
        for ep in eps {
            if ep.get("entryPointType").and_then(|t| t.as_str()) == Some("video") {
                if let Some(uri) = ep.get("uri").and_then(|u| u.as_str()) {
                    return (Some(uri.to_string()), Some(platform_for(uri)));
                }
            }
        }
    }
    if let Some(h) = e.get("hangoutLink").and_then(|v| v.as_str()) {
        return (Some(h.to_string()), Some("Google Meet".into()));
    }
    // scan location + description for a known meeting URL
    for field in ["location", "description"] {
        if let Some(text) = e.get(field).and_then(|v| v.as_str()) {
            for host in ["zoom.us", "teams.microsoft.com", "meet.google.com"] {
                if let Some(pos) = text.find(host) {
                    let start = text[..pos].rfind("https://").unwrap_or(pos);
                    let url: String = text[start..]
                        .chars()
                        .take_while(|c| !c.is_whitespace())
                        .collect();
                    return (Some(url.clone()), Some(platform_for(&url)));
                }
            }
        }
    }
    (None, None)
}

fn platform_for(url: &str) -> String {
    if url.contains("zoom.us") {
        "Zoom".into()
    } else if url.contains("teams.microsoft.com") {
        "Teams".into()
    } else if url.contains("meet.google.com") {
        "Google Meet".into()
    } else {
        "Video".into()
    }
}

async fn exchange_code(
    client_id: &str,
    code: &str,
    verifier: &str,
    redirect: &str,
) -> Result<Tokens, String> {
    let params = [
        ("client_id", client_id),
        ("code", code),
        ("code_verifier", verifier),
        ("grant_type", "authorization_code"),
        ("redirect_uri", redirect),
    ];
    let resp = reqwest::Client::new()
        .post(TOKEN_ENDPOINT)
        .form(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let ok = resp.status().is_success();
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    if !ok {
        return Err(format!("token exchange failed: {v}"));
    }
    Ok(Tokens {
        refresh_token: v.get("refresh_token").and_then(|t| t.as_str()).unwrap_or("").to_string(),
        access_token: v.get("access_token").and_then(|t| t.as_str()).unwrap_or("").to_string(),
        expires_at: now_secs() + v.get("expires_in").and_then(|e| e.as_u64()).unwrap_or(3600),
    })
}

async fn refresh(client_id: &str, tokens: &mut Tokens) -> Result<(), String> {
    if tokens.refresh_token.is_empty() {
        return Err("no refresh token — reconnect Google Calendar.".into());
    }
    let params = [
        ("client_id", client_id),
        ("refresh_token", tokens.refresh_token.as_str()),
        ("grant_type", "refresh_token"),
    ];
    let resp = reqwest::Client::new()
        .post(TOKEN_ENDPOINT)
        .form(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let ok = resp.status().is_success();
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    if !ok {
        return Err(format!("token refresh failed: {v}"));
    }
    tokens.access_token = v.get("access_token").and_then(|t| t.as_str()).unwrap_or("").to_string();
    tokens.expires_at = now_secs() + v.get("expires_in").and_then(|e| e.as_u64()).unwrap_or(3600);
    Ok(())
}

/// Block on the loopback listener until Google redirects with `?code=`.
fn wait_for_code(listener: TcpListener, expected_state: &str) -> Result<String, String> {
    for stream in listener.incoming() {
        let mut stream = stream.map_err(|e| e.to_string())?;
        let mut buf = [0u8; 4096];
        let n = stream.read(&mut buf).map_err(|e| e.to_string())?;
        let req = String::from_utf8_lossy(&buf[..n]);
        let first = req.lines().next().unwrap_or("");
        // "GET /?code=...&state=... HTTP/1.1"
        let path = first.split_whitespace().nth(1).unwrap_or("");
        let query = path.split('?').nth(1).unwrap_or("");
        let mut code = None;
        let mut got_state = None;
        for pair in query.split('&') {
            let mut kv = pair.splitn(2, '=');
            match (kv.next(), kv.next()) {
                (Some("code"), Some(v)) => code = Some(urldecode(v)),
                (Some("state"), Some(v)) => got_state = Some(urldecode(v)),
                (Some("error"), Some(v)) => {
                    respond(&mut stream, "Authorization failed. You can close this tab.");
                    return Err(format!("google returned error: {v}"));
                }
                _ => {}
            }
        }
        if code.is_some() || got_state.is_some() {
            respond(&mut stream, "Glyph is connected to Google Calendar. You can close this tab.");
            if got_state.as_deref() != Some(expected_state) {
                return Err("state mismatch (possible CSRF) — try again.".into());
            }
            return code.ok_or_else(|| "no code in redirect".to_string());
        }
        // ignore favicon/other probes and keep waiting
        respond(&mut stream, "Waiting for Google…");
    }
    Err("loopback closed before redirect".into())
}

fn respond(stream: &mut std::net::TcpStream, msg: &str) {
    let body = format!(
        "<html><body style=\"font-family:-apple-system,sans-serif;text-align:center;padding-top:80px;color:#1A1823\"><h2>{msg}</h2></body></html>"
    );
    let resp = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(resp.as_bytes());
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn urldecode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                    out.push(v);
                    i += 3;
                    continue;
                }
                out.push(bytes[i]);
                i += 1;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}
