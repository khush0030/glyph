//! Event name constants (Rust → frontend), mirroring SPEC §10 and
//! src/lib/ipc.ts. Emitted by later milestones.

#![allow(dead_code)]

pub const TRANSCRIPT_PARTIAL: &str = "transcript://partial";
pub const TRANSCRIPT_FINAL: &str = "transcript://final";
pub const RECORDING_LEVEL: &str = "recording://level";
pub const RECORDING_STATUS: &str = "recording://status";
pub const NOTES_GENERATED: &str = "notes://generated";
pub const MEETING_STARTING: &str = "meeting://starting";
pub const ASANA_CREATED: &str = "asana://created";
