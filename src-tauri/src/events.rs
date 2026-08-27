//! Event name constants (Rust → frontend), mirroring SPEC §10 and
//! src/lib/ipc.ts. Emitted by later milestones.

#![allow(dead_code)]

pub const TRANSCRIPT_PARTIAL: &str = "transcript://partial";
pub const TRANSCRIPT_FINAL: &str = "transcript://final";
pub const RECORDING_LEVEL: &str = "recording://level";
pub const RECORDING_STATUS: &str = "recording://status";
pub const NOTES_GENERATED: &str = "notes://generated";

/// → `prompt` window: show/refresh the popup with a PromptPayload.
pub const MEETING_DETECTED: &str = "meeting://detected";
/// → `prompt` window: the detected call ended; hide if still showing.
pub const MEETING_ENDED: &str = "meeting://ended";
/// → `main` window: user clicked Record in the popup; payload = PromptPayload.
pub const PROMPT_RECORD: &str = "prompt://record";
