//! Credential commands — the Settings UI's API-key/token entry. Every secret
//! goes straight into the macOS Keychain (CLAUDE.md rule #1); the frontend can
//! only set, clear, or ask whether a credential *is present* — it never reads a
//! secret back.

use serde::Serialize;

use crate::keychain;

/// The credentials Glyph stores. Keychain account name == the id string.
pub const CREDENTIAL_IDS: &[&str] = &[
    "elevenlabs_api_key",   // Scribe v2 STT (M2)
    "anthropic_api_key",    // Claude Haiku/Sonnet analysis (M3)
    "google_oauth_client_id", // Google Calendar OAuth client (M5)
    "asana_access_token",   // Asana PAT / OAuth token (M6)
];

fn is_known(id: &str) -> bool {
    CREDENTIAL_IDS.contains(&id)
}

#[derive(Serialize)]
pub struct CredentialStatus {
    pub id: String,
    pub present: bool,
}

/// Store (or replace) a credential. Empty value clears it.
#[tauri::command]
pub fn set_credential(id: String, value: String) -> Result<(), String> {
    if !is_known(&id) {
        return Err(format!("unknown credential id: {id}"));
    }
    if value.is_empty() {
        keychain::delete(&id).map_err(|e| e.to_string())
    } else {
        keychain::set(&id, &value).map_err(|e| e.to_string())
    }
}

/// Remove a credential from the Keychain.
#[tauri::command]
pub fn delete_credential(id: String) -> Result<(), String> {
    if !is_known(&id) {
        return Err(format!("unknown credential id: {id}"));
    }
    keychain::delete(&id).map_err(|e| e.to_string())
}

/// Which credentials are set — booleans only, never the secrets.
#[tauri::command]
pub fn credential_status() -> Result<Vec<CredentialStatus>, String> {
    let mut out = Vec::with_capacity(CREDENTIAL_IDS.len());
    for &id in CREDENTIAL_IDS {
        let present = keychain::get(id).map_err(|e| e.to_string())?.is_some();
        out.push(CredentialStatus {
            id: id.to_string(),
            present,
        });
    }
    Ok(out)
}
