// Typed wrappers over the Tauri command/event contract (SPEC §10). M0 defines
// the surface; concrete commands are implemented per milestone. Importing the
// Tauri API lazily keeps the app runnable in a plain browser during UI work.
import { invoke } from "@tauri-apps/api/core";
import { listen, type EventCallback } from "@tauri-apps/api/event";

import type { RecordMode } from "../core/AudioSource";
import type { AnalysisModel } from "../core/NoteGenerator";

// ---- Commands (frontend → Rust) -------------------------------------------
export const commands = {
  startRecording: (source: RecordMode, eventId?: string) =>
    invoke<string>("start_recording", { source, eventId }),
  stopRecording: () => invoke<string>("stop_recording"),
  listNotes: () => invoke("list_notes"),
  getNote: (id: string) => invoke("get_note", { id }),
  updateTitle: (id: string, title: string) =>
    invoke("update_title", { id, title }),
  saveScratch: (id: string, scratch: string) =>
    invoke("save_scratch", { id, scratch }),
  regenerateNotes: (id: string, model: AnalysisModel) =>
    invoke("regenerate_notes", { id, model }),
  deleteNote: (id: string) => invoke("delete_note", { id }),
  deleteAudio: (id: string) => invoke("delete_audio", { id }),
  getSettings: () => invoke<Record<string, string>>("get_settings"),
  setSettings: (kv: Record<string, string>) => invoke("set_settings", { kv }),
  checkPermissions: () => invoke("check_permissions"),
  openPermissionSettings: () => invoke("open_permission_settings"),
  calendarConnect: () => invoke("calendar_connect"),
  calendarUpcoming: () => invoke("calendar_upcoming"),
  asanaConnect: () => invoke("asana_connect"),
  asanaProjects: () => invoke("asana_projects"),
  asanaUsers: () => invoke("asana_users"),
  asanaCreateTasks: (noteId: string, projectGid: string, items: unknown[]) =>
    invoke<number>("asana_create_tasks", { noteId, projectGid, items }),

  // Credentials — secrets go to the Keychain; status returns booleans only.
  setCredential: (id: CredentialId, value: string) =>
    invoke<void>("set_credential", { id, value }),
  deleteCredential: (id: CredentialId) =>
    invoke<void>("delete_credential", { id }),
  credentialStatus: () =>
    invoke<CredentialStatus[]>("credential_status"),
};

export type CredentialId =
  | "elevenlabs_api_key"
  | "anthropic_api_key"
  | "google_oauth_client_id"
  | "asana_access_token";

export interface CredentialStatus {
  id: CredentialId;
  present: boolean;
}

// ---- Events (Rust → frontend) ---------------------------------------------
export const EVENTS = {
  transcriptPartial: "transcript://partial",
  transcriptFinal: "transcript://final",
  recordingLevel: "recording://level",
  recordingStatus: "recording://status",
  notesGenerated: "notes://generated",
  meetingStarting: "meeting://starting",
  asanaCreated: "asana://created",
} as const;

export function on<T>(
  event: (typeof EVENTS)[keyof typeof EVENTS],
  cb: EventCallback<T>
) {
  return listen<T>(event, cb);
}
