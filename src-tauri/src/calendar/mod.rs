//! CalendarSource — Google Calendar via OAuth 2.0 for desktop apps: PKCE +
//! loopback redirect, system browser, tokens in the Keychain (SPEC §8). No
//! client secret in the app. Supports MULTIPLE connected Google accounts: each
//! account's tokens are stored in a list, and `calendar_upcoming` aggregates
//! events across every account and every calendar each account holds. Also
//! detects video links and exposes attendee emails for emailing notes.

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
const USERINFO_ENDPOINT: &str = "https://www.googleapis.com/oauth2/v3/userinfo";
// openid+email identifies which account this is (for the picker + Gmail "from");
// calendar.readonly to list meetings; gmail.send to email finished notes.
const SCOPE: &str = "openid email https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.send";
/// Keychain key holding the JSON array of connected accounts.
const ACCOUNTS_KEY: &str = "google_accounts";
/// Legacy single-account key (pre multi-account). Cleaned up on first connect.
const LEGACY_TOKENS_KEY: &str = "google_tokens";

/// One connected Google account and its OAuth tokens.
#[derive(Serialize, Deserialize, Default, Clone)]
struct Account {
    email: String,
    refresh_token: String,
    access_token: String,
    /// Unix seconds when access_token expires.
    expires_at: u64,
}

/// Just the token triple from a code/refresh exchange.
#[derive(Default)]
struct Tokens {
    refresh_token: String,
    access_token: String,
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
    /// Attendee email addresses (excludes self) — recipients for emailed notes.
    pub attendee_emails: Vec<String>,
    /// Which connected Google account this event came from (email).
    pub account: String,
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

// ---- Account store ----------------------------------------------------------

fn load_accounts() -> Vec<Account> {
    keychain::get(ACCOUNTS_KEY)
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_accounts(accts: &[Account]) -> Result<(), String> {
    keychain::set(
        ACCOUNTS_KEY,
        &serde_json::to_string(accts).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

/// Connected account emails, in connection order.
#[tauri::command]
pub fn calendar_accounts() -> Vec<String> {
    load_accounts().into_iter().map(|a| a.email).collect()
}

#[tauri::command]
pub fn calendar_connected() -> bool {
    !load_accounts().is_empty()
}

/// Return a currently-valid access token for `email`, refreshing (and persisting
/// the new token) if needed. Shared by Calendar fetches + Gmail send.
pub async fn account_token(email: &str) -> Result<String, String> {
    let client_id = keychain::get("google_oauth_client_id")
        .map_err(|e| e.to_string())?
        .ok_or("No Google client ID.")?;
    let client_secret = keychain::get("google_oauth_client_secret")
        .ok()
        .flatten()
        .filter(|s| !s.is_empty());

    let mut accts = load_accounts();
    let idx = accts
        .iter()
        .position(|a| a.email == email)
        .ok_or("That Google account is not connected.")?;

    if accts[idx].expires_at <= now_secs() + 30 {
        let t = refresh_access(&client_id, client_secret.as_deref(), &accts[idx].refresh_token).await?;
        accts[idx].access_token = t.access_token;
        accts[idx].expires_at = t.expires_at;
        save_accounts(&accts)?;
    }
    Ok(accts[idx].access_token.clone())
}

/// Email of the first connected account (Gmail "from" default).
pub fn first_account_email() -> Option<String> {
    load_accounts().into_iter().next().map(|a| a.email)
}

// ---- OAuth connect ----------------------------------------------------------

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

    let expected_state = state.clone();
    let code = tauri::async_runtime::spawn_blocking(move || wait_for_code(listener, &expected_state))
        .await
        .map_err(|e| e.to_string())??;

    let client_secret = keychain::get("google_oauth_client_secret")
        .ok()
        .flatten()
        .filter(|s| !s.is_empty());
    let tokens = exchange_code(&client_id, client_secret.as_deref(), &code, &verifier, &redirect).await?;

    let email = fetch_email(&tokens.access_token).await?;
    if email.is_empty() {
        return Err("Couldn't read the Google account email — please try connecting again.".into());
    }

    // Upsert: re-connecting the same account refreshes its tokens.
    let mut accts = load_accounts();
    if let Some(a) = accts.iter_mut().find(|a| a.email == email) {
        if !tokens.refresh_token.is_empty() {
            a.refresh_token = tokens.refresh_token;
        }
        a.access_token = tokens.access_token;
        a.expires_at = tokens.expires_at;
    } else {
        accts.push(Account {
            email,
            refresh_token: tokens.refresh_token,
            access_token: tokens.access_token,
            expires_at: tokens.expires_at,
        });
    }
    save_accounts(&accts)?;
    let _ = keychain::delete(LEGACY_TOKENS_KEY); // drop pre-multi-account token
    Ok(())
}

/// Disconnect one account by email, or all accounts when `email` is None.
#[tauri::command]
pub async fn calendar_disconnect(email: Option<String>) -> Result<(), String> {
    match email {
        Some(e) => {
            let mut accts = load_accounts();
            accts.retain(|a| a.email != e);
            save_accounts(&accts)
        }
        None => keychain::delete(ACCOUNTS_KEY).map_err(|e| e.to_string()),
    }
}

/// Fetch the account's email address from the userinfo endpoint.
async fn fetch_email(access_token: &str) -> Result<String, String> {
    let resp = reqwest::Client::new()
        .get(USERINFO_ENDPOINT)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Ok(String::new());
    }
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(v.get("email").and_then(|e| e.as_str()).unwrap_or("").to_string())
}

// ---- Event fetching ---------------------------------------------------------

#[tauri::command]
pub async fn calendar_upcoming() -> Result<Vec<CalendarEvent>, String> {
    let time_min = chrono::Utc::now().to_rfc3339();
    let time_max = (chrono::Utc::now() + chrono::Duration::days(14)).to_rfc3339();
    aggregate_events(&time_min, &time_max).await
}

/// Best-effort attendee emails for a finished meeting, matched by title across a
/// recent + upcoming window over ALL accounts. Empty vec (not an error) when
/// nothing matches, so the email composer still opens.
#[tauri::command]
pub async fn calendar_attendees(title: String) -> Result<Vec<String>, String> {
    let needle = title.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(vec![]);
    }
    let time_min = (chrono::Utc::now() - chrono::Duration::days(2)).to_rfc3339();
    let time_max = (chrono::Utc::now() + chrono::Duration::days(14)).to_rfc3339();
    let events = aggregate_events(&time_min, &time_max).await.unwrap_or_default();

    let now = chrono::Utc::now().timestamp_millis();
    let mut best: Option<(&CalendarEvent, i64)> = None;
    for e in &events {
        if e.attendee_emails.is_empty() {
            continue;
        }
        let t = e.title.to_lowercase();
        if t == needle || t.contains(&needle) || needle.contains(&t) {
            let dist = (e.start_ts - now).abs();
            if best.map(|(_, d)| dist < d).unwrap_or(true) {
                best = Some((e, dist));
            }
        }
    }
    Ok(best.map(|(e, _)| e.attendee_emails.clone()).unwrap_or_default())
}

/// Aggregate events across every connected account and all of its calendars,
/// de-duplicated (same title + start across accounts) and sorted by start time.
async fn aggregate_events(time_min: &str, time_max: &str) -> Result<Vec<CalendarEvent>, String> {
    let accounts = load_accounts();
    if accounts.is_empty() {
        return Err("Google not connected — connect a Google account in Settings.".into());
    }

    let mut all: Vec<CalendarEvent> = Vec::new();
    let mut last_err: Option<String> = None;
    for acct in &accounts {
        // Refresh sequentially (persists to Keychain) before the concurrent fetch.
        match account_token(&acct.email).await {
            Ok(token) => {
                let evs = fetch_account_events(&acct.email, &token, time_min, time_max).await;
                all.extend(evs);
            }
            Err(e) => last_err = Some(e),
        }
    }

    // If every account failed, surface the error instead of an empty list.
    if all.is_empty() {
        if let Some(e) = last_err {
            return Err(e);
        }
    }

    all.sort_by_key(|e| e.start_ts);
    // De-dup the same meeting showing up on multiple calendars/accounts.
    let mut seen = std::collections::HashSet::new();
    all.retain(|e| seen.insert((e.title.clone(), e.start_ts)));
    Ok(all)
}

/// Fetch events from all of one account's calendars, concurrently.
async fn fetch_account_events(
    email: &str,
    token: &str,
    time_min: &str,
    time_max: &str,
) -> Vec<CalendarEvent> {
    let client = reqwest::Client::new();
    let cal_ids = list_calendar_ids(&client, token)
        .await
        .unwrap_or_else(|_| vec!["primary".to_string()]);

    let futs = cal_ids.into_iter().map(|cid| {
        let client = client.clone();
        let token = token.to_string();
        let tmin = time_min.to_string();
        let tmax = time_max.to_string();
        let email = email.to_string();
        async move {
            fetch_calendar_events(&client, &token, &cid, &tmin, &tmax)
                .await
                .unwrap_or_default()
                .into_iter()
                .map(|mut e| {
                    e.account = email.clone();
                    // Make ids unique across accounts/calendars (React keys).
                    e.id = format!("{email}:{}", e.id);
                    e
                })
                .collect::<Vec<_>>()
        }
    });
    futures_util::future::join_all(futs)
        .await
        .into_iter()
        .flatten()
        .collect()
}

/// The calendars to read for an account: selected (shown) ones, plus primary.
async fn list_calendar_ids(client: &reqwest::Client, token: &str) -> Result<Vec<String>, String> {
    let resp = client
        .get("https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader")
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("calendarList {}", resp.status()));
    }
    let body: Value = resp.json().await.map_err(|e| e.to_string())?;
    let items = body.get("items").and_then(|i| i.as_array()).cloned().unwrap_or_default();
    let mut ids: Vec<String> = items
        .iter()
        .filter(|c| {
            c.get("primary").and_then(|p| p.as_bool()) == Some(true)
                || c.get("selected").and_then(|s| s.as_bool()) == Some(true)
        })
        .filter_map(|c| c.get("id").and_then(|i| i.as_str()).map(String::from))
        .collect();
    if ids.is_empty() {
        // No selected calendars exposed — fall back to all readable ones.
        ids = items
            .iter()
            .filter_map(|c| c.get("id").and_then(|i| i.as_str()).map(String::from))
            .collect();
    }
    if ids.is_empty() {
        ids.push("primary".to_string());
    }
    Ok(ids)
}

async fn fetch_calendar_events(
    client: &reqwest::Client,
    token: &str,
    calendar_id: &str,
    time_min: &str,
    time_max: &str,
) -> Result<Vec<CalendarEvent>, String> {
    let url = format!(
        "https://www.googleapis.com/calendar/v3/calendars/{}/events?timeMin={}&timeMax={}&singleEvents=true&orderBy=startTime&maxResults=50",
        urlencode(calendar_id),
        urlencode(time_min),
        urlencode(time_max),
    );
    let resp = client
        .get(&url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("events {}", resp.status()));
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
    let guests: Vec<&Value> = e
        .get("attendees")
        .and_then(|a| a.as_array())
        .map(|arr| {
            arr.iter()
                .filter(|a| a.get("self").and_then(|s| s.as_bool()) != Some(true))
                .collect()
        })
        .unwrap_or_default();
    let attendees = guests
        .iter()
        .filter_map(|a| {
            a.get("displayName")
                .or_else(|| a.get("email"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
        .collect();
    let attendee_emails = guests
        .iter()
        .filter_map(|a| a.get("email").and_then(|v| v.as_str()).map(|s| s.to_string()))
        .collect();

    Some(CalendarEvent {
        id,
        title,
        start_ts,
        end_ts,
        link,
        platform,
        attendees,
        attendee_emails,
        account: String::new(),
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
    client_secret: Option<&str>,
    code: &str,
    verifier: &str,
    redirect: &str,
) -> Result<Tokens, String> {
    let mut params = vec![
        ("client_id", client_id),
        ("code", code),
        ("code_verifier", verifier),
        ("grant_type", "authorization_code"),
        ("redirect_uri", redirect),
    ];
    if let Some(secret) = client_secret {
        params.push(("client_secret", secret));
    }
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

async fn refresh_access(
    client_id: &str,
    client_secret: Option<&str>,
    refresh_token: &str,
) -> Result<Tokens, String> {
    if refresh_token.is_empty() {
        return Err("no refresh token — reconnect this Google account.".into());
    }
    let mut params = vec![
        ("client_id", client_id),
        ("refresh_token", refresh_token),
        ("grant_type", "refresh_token"),
    ];
    if let Some(secret) = client_secret {
        params.push(("client_secret", secret));
    }
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
    Ok(Tokens {
        refresh_token: refresh_token.to_string(),
        access_token: v.get("access_token").and_then(|t| t.as_str()).unwrap_or("").to_string(),
        expires_at: now_secs() + v.get("expires_in").and_then(|e| e.as_u64()).unwrap_or(3600),
    })
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
            respond(&mut stream, "Glyph is connected to Google. You can close this tab.");
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
