//! Credential store. By default secrets live in the macOS Keychain. If a `.env`
//! file is present (or matching process env vars are set), Glyph reads secrets
//! from there instead and never touches the Keychain ("env-only mode").
//!
//! Lookup order in `get`:
//!   1. process env var  (e.g. ELEVENLABS_API_KEY)
//!   2. `.env` file      (GLYPH_ENV_FILE, ./.env, ../.env, or next to the binary)
//!   3. macOS Keychain   (skipped entirely when in env-only mode)
//!
//! Account name -> env var name == the account uppercased
//! (`anthropic_api_key` -> `ANTHROPIC_API_KEY`).
//!
//! NOTE: a `.env` stores keys as plaintext on disk — weaker than the Keychain.
//! Keep it out of the repo (it is gitignored). See CLAUDE.md rule #1.
#![allow(dead_code)]

use std::collections::HashMap;
use std::path::PathBuf;

use keyring::Entry;
use thiserror::Error;

const SERVICE: &str = "ai.oltaflock.glyph";

#[derive(Debug, Error)]
pub enum KeychainError {
    #[error("keyring error: {0}")]
    Keyring(#[from] keyring::Error),
    #[error("credential store: {0}")]
    Sidecar(String),
}

/// Candidate `.env` locations, in priority order.
fn env_file_path() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(p) = std::env::var("GLYPH_ENV_FILE") {
        candidates.push(PathBuf::from(p));
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join(".env")); // src-tauri/.env in `tauri dev`
        if let Some(parent) = cwd.parent() {
            candidates.push(parent.join(".env")); // project-root .env
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(".env")); // bundled app
        }
    }
    candidates.into_iter().find(|p| p.is_file())
}

/// True when Glyph should bypass the Keychain entirely.
fn env_only_mode() -> bool {
    env_file_path().is_some() || std::env::var_os("GLYPH_NO_KEYCHAIN").is_some()
}

/// Find `key` in a `.env`-formatted string. Handles blank/comment lines, an
/// optional `export ` prefix, and surrounding single/double quotes.
fn parse_env(content: &str, key: &str) -> Option<String> {
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line);
        let Some((k, v)) = line.split_once('=') else {
            continue;
        };
        if k.trim() != key {
            continue;
        }
        let mut val = v.trim();
        if val.len() >= 2
            && ((val.starts_with('"') && val.ends_with('"'))
                || (val.starts_with('\'') && val.ends_with('\'')))
        {
            val = &val[1..val.len() - 1];
        }
        return Some(val.to_string());
    }
    None
}

/// Read `account` from process env vars or a `.env` file. `None` if neither has it.
fn read_from_env(account: &str) -> Option<String> {
    let key = account.to_ascii_uppercase();
    if let Ok(v) = std::env::var(&key) {
        if !v.is_empty() {
            return Some(v);
        }
    }
    let path = env_file_path()?;
    let content = std::fs::read_to_string(path).ok()?;
    parse_env(&content, &key).filter(|v| !v.is_empty())
}

/// Writable secret store used in env-only mode. Holds secrets the app generates
/// at runtime (e.g. OAuth tokens) which can't live in the hand-edited `.env`.
/// `chmod 600` JSON next to the app database.
fn sidecar_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(
        PathBuf::from(home)
            .join("Library/Application Support")
            .join(SERVICE)
            .join("secrets.json"),
    )
}

fn load_sidecar() -> HashMap<String, String> {
    sidecar_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_sidecar(map: &HashMap<String, String>) -> Result<(), KeychainError> {
    let path = sidecar_path().ok_or_else(|| KeychainError::Sidecar("no HOME directory".into()))?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| KeychainError::Sidecar(e.to_string()))?;
    }
    let json = serde_json::to_string_pretty(map).map_err(|e| KeychainError::Sidecar(e.to_string()))?;
    std::fs::write(&path, json).map_err(|e| KeychainError::Sidecar(e.to_string()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// Store a secret for `account` (e.g. "anthropic_api_key"). In env-only mode it
/// goes to the writable sidecar store; otherwise to the macOS Keychain.
pub fn set(account: &str, secret: &str) -> Result<(), KeychainError> {
    if env_only_mode() {
        let mut map = load_sidecar();
        map.insert(account.to_string(), secret.to_string());
        return save_sidecar(&map);
    }
    Entry::new(SERVICE, account)?.set_password(secret)?;
    Ok(())
}

/// Fetch a secret; `Ok(None)` if it is not set anywhere. Order:
/// process env var -> `.env` file -> sidecar store -> Keychain.
pub fn get(account: &str) -> Result<Option<String>, KeychainError> {
    if let Some(v) = read_from_env(account) {
        return Ok(Some(v));
    }
    if let Some(v) = load_sidecar().get(account) {
        if !v.is_empty() {
            return Ok(Some(v.clone()));
        }
    }
    if env_only_mode() {
        return Ok(None);
    }
    match Entry::new(SERVICE, account)?.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Remove a secret; succeeds even if it was already absent.
pub fn delete(account: &str) -> Result<(), KeychainError> {
    if env_only_mode() {
        let mut map = load_sidecar();
        if map.remove(account).is_some() {
            save_sidecar(&map)?;
        }
        return Ok(());
    }
    match Entry::new(SERVICE, account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_get_delete_round_trip() {
        // Skip when a developer .env is shadowing the Keychain on this machine.
        if env_only_mode() {
            return;
        }
        let acct = "glyph_test_credential";
        // clean slate
        delete(acct).unwrap();
        assert_eq!(get(acct).unwrap(), None);
        // set + read back
        set(acct, "secret-value-123").unwrap();
        assert_eq!(get(acct).unwrap().as_deref(), Some("secret-value-123"));
        // overwrite
        set(acct, "rotated").unwrap();
        assert_eq!(get(acct).unwrap().as_deref(), Some("rotated"));
        // delete is idempotent
        delete(acct).unwrap();
        delete(acct).unwrap();
        assert_eq!(get(acct).unwrap(), None);
    }

    #[test]
    fn parse_env_handles_quotes_comments_and_export() {
        let content = "\
# a comment\n\
\n\
export ANTHROPIC_API_KEY=plain-value\n\
ELEVENLABS_API_KEY=\"quoted-value\"\n\
ASANA_ACCESS_TOKEN='single-quoted'\n";
        assert_eq!(
            parse_env(content, "ANTHROPIC_API_KEY").as_deref(),
            Some("plain-value")
        );
        assert_eq!(
            parse_env(content, "ELEVENLABS_API_KEY").as_deref(),
            Some("quoted-value")
        );
        assert_eq!(
            parse_env(content, "ASANA_ACCESS_TOKEN").as_deref(),
            Some("single-quoted")
        );
        assert_eq!(parse_env(content, "MISSING"), None);
    }
}
