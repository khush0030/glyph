//! Gmail sender — emails a finished meeting's notes (with the PDF attached) to
//! the attendees, using the same Google OAuth as Calendar (gmail.send scope).
//! The access token comes from `calendar::valid_access_token`; nothing here
//! touches the Keychain directly.

use base64::Engine;
use serde_json::{json, Value};

const SEND_URL: &str = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const BOUNDARY: &str = "glyph_mime_boundary_8f3a1c";

fn b64_standard(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

/// Wrap a base64 string to 76-character lines (RFC 2045).
fn wrap76(s: &str) -> String {
    s.as_bytes()
        .chunks(76)
        .map(|c| String::from_utf8_lossy(c).into_owned())
        .collect::<Vec<_>>()
        .join("\r\n")
}

/// RFC 2047 encoded-word so non-ASCII (e.g. Hindi) subjects survive transit.
fn encode_subject(s: &str) -> String {
    if s.is_ascii() {
        s.to_string()
    } else {
        format!("=?UTF-8?B?{}?=", b64_standard(s.as_bytes()))
    }
}

/// Send `pdf_base64` (standard base64 of the PDF bytes) as an attachment to
/// `to`, with a plain-text `body`, from the connected Google account `from`
/// (falls back to the first connected account). `filename` is the attachment
/// name.
#[tauri::command]
pub async fn gmail_send(
    from: String,
    to: Vec<String>,
    subject: String,
    body: String,
    pdf_base64: String,
    filename: String,
) -> Result<(), String> {
    let recipients: Vec<String> = to
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if recipients.is_empty() {
        return Err("No recipients — add at least one email address.".into());
    }

    let sender = if from.trim().is_empty() {
        crate::calendar::first_account_email()
            .ok_or("No Google account connected — connect one in Settings.")?
    } else {
        from.trim().to_string()
    };
    let token = crate::calendar::account_token(&sender).await?;

    let safe_name = filename.replace(['"', '\r', '\n'], "");
    let mime = format!(
        "To: {to}\r\n\
         Subject: {subject}\r\n\
         MIME-Version: 1.0\r\n\
         Content-Type: multipart/mixed; boundary=\"{b}\"\r\n\
         \r\n\
         --{b}\r\n\
         Content-Type: text/plain; charset=\"UTF-8\"\r\n\
         Content-Transfer-Encoding: base64\r\n\
         \r\n\
         {body_b64}\r\n\
         --{b}\r\n\
         Content-Type: application/pdf; name=\"{name}\"\r\n\
         Content-Disposition: attachment; filename=\"{name}\"\r\n\
         Content-Transfer-Encoding: base64\r\n\
         \r\n\
         {pdf}\r\n\
         --{b}--\r\n",
        to = recipients.join(", "),
        subject = encode_subject(&subject),
        b = BOUNDARY,
        body_b64 = wrap76(&b64_standard(body.as_bytes())),
        name = safe_name,
        pdf = wrap76(&pdf_base64),
    );

    let raw = base64::engine::general_purpose::URL_SAFE.encode(mime.as_bytes());

    let resp = reqwest::Client::new()
        .post(SEND_URL)
        .bearer_auth(&token)
        .json(&json!({ "raw": raw }))
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    let status = resp.status();
    if status.is_success() {
        return Ok(());
    }
    let v: Value = resp.json().await.unwrap_or_default();
    let msg = v
        .get("error")
        .and_then(|e| e.get("message"))
        .and_then(|m| m.as_str())
        .unwrap_or("unknown error");
    // The most common failure: the stored token predates the gmail.send scope.
    if msg.contains("insufficient")
        || msg.to_lowercase().contains("scope")
        || status.as_u16() == 403
    {
        return Err(
            "Gmail permission missing. Reconnect Google Calendar in Settings to grant email access, then try again."
                .into(),
        );
    }
    Err(format!("Gmail API {status}: {msg}"))
}
