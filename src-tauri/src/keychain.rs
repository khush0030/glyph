//! macOS Keychain helper. ALL credentials (Scribe / Anthropic / Google /
//! Asana) live here only — never in the repo or plaintext config (CLAUDE.md
//! hard rule #1). Thin wrapper over the `keyring` crate.
//!
//! get/set/delete are the credential API consumed from M2 onward; unused in M0.
#![allow(dead_code)]

use keyring::Entry;
use thiserror::Error;

const SERVICE: &str = "ai.oltaflock.glyph";

#[derive(Debug, Error)]
pub enum KeychainError {
    #[error("keyring error: {0}")]
    Keyring(#[from] keyring::Error),
}

/// Store a secret for `account` (e.g. "anthropic_api_key").
pub fn set(account: &str, secret: &str) -> Result<(), KeychainError> {
    Entry::new(SERVICE, account)?.set_password(secret)?;
    Ok(())
}

/// Fetch a secret; `Ok(None)` if it is not set yet.
pub fn get(account: &str) -> Result<Option<String>, KeychainError> {
    match Entry::new(SERVICE, account)?.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Remove a secret; succeeds even if it was already absent.
pub fn delete(account: &str) -> Result<(), KeychainError> {
    match Entry::new(SERVICE, account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}
