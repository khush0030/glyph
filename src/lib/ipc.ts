// Typed wrappers over the Tauri command/event contract (SPEC §10). M0 defines
// the surface; concrete commands are implemented per milestone. Importing the
// Tauri API lazily keeps the app runnable in a plain browser during UI work.
import { invoke } from "@tauri-apps/api/core";
import { listen, type EventCallback } from "@tauri-apps/api/event";

import type { RecordMode } from "../core/AudioSource";

// ---- Commands (frontend → Rust) -------------------------------------------
export const commands = {
  startRecording: (source: RecordMode, eventId?: string) =>
    invoke<string>("start_recording", { source, eventId }),
  stopRecording: () => invoke<string>("stop_recording"),
  // Local whisper.cpp transcription of a finished recording WAV → segments.
  // language: undefined/"auto" = auto-detect, or "hi"/"en" to force.
  transcribeRecording: (wavPath: string, language?: string) =>
    invoke<StoredSegment[]>("transcribe_recording", { wavPath, language }),
  // NotesStore (SQLite persistence).
  createNote: (source: NoteSource, title?: string) =>
    invoke<string>("create_note", { source, title }),
  listNotes: () => invoke<NoteSummary[]>("list_notes"),
  getNote: (id: string) => invoke<NoteDetail>("get_note", { id }),
  updateTitle: (id: string, title: string) =>
    invoke<void>("update_title", { id, title }),
  saveScratch: (id: string, scratch: string) =>
    invoke<void>("save_scratch", { id, scratch }),
  saveSegments: (noteId: string, segments: StoredSegment[]) =>
    invoke<void>("save_segments", { noteId, segments }),
  saveGenerated: (noteId: string, note: GeneratedNote) =>
    invoke<void>("save_generated", {
      noteId,
      summary: note.summary,
      keyPoints: note.keyPoints,
      decisions: note.decisions,
      openQuestions: note.openQuestions,
      actionItems: note.actionItems,
      model: note.model,
    }),
  addActionItem: (noteId: string, text: string, assignee?: string, dueHint?: string) =>
    invoke<string>("add_action_item", { noteId, text, assignee, dueHint }),
  deleteActionItem: (id: string) => invoke<void>("delete_action_item", { id }),
  setRecordingResult: (id: string, audioPath: string | null, durationSec: number) =>
    invoke<void>("set_recording_result", { id, audioPath, durationSec }),
  deleteNote: (id: string) => invoke<void>("delete_note", { id }),
  deleteAudio: (id: string) => invoke<void>("delete_audio", { id }),
  revealNoteFiles: (id: string) => invoke<string>("reveal_note_files", { id }),
  getSettings: () => invoke<Record<string, string>>("get_settings"),
  setSettings: (kv: Record<string, string>) => invoke("set_settings", { kv }),
  openPrivacySettings: (pane: "microphone" | "screen") =>
    invoke<void>("open_privacy_settings", { pane }),
  checkPermissions: () => invoke<Permissions>("check_permissions"),
  requestPermissions: () => invoke<Permissions>("request_permissions"),
  openPermissionSettings: () => invoke<void>("open_permission_settings"),
  // Asana (Personal Access Token).
  asanaWorkspaces: () => invoke<AsanaIdName[]>("asana_workspaces"),
  asanaProjects: (workspace: string) =>
    invoke<AsanaIdName[]>("asana_projects", { workspace }),
  asanaUsers: (workspace: string) =>
    invoke<AsanaUser[]>("asana_users", { workspace }),
  asanaCreateTasks: (
    noteId: string,
    projectGid: string,
    workspace: string,
    items: AsanaTaskIn[]
  ) =>
    invoke<number>("asana_create_tasks", { noteId, projectGid, workspace, items }),

  // Calendar — Google Calendar via OAuth (PKCE).
  calendarConnected: () => invoke<boolean>("calendar_connected"),
  calendarConnect: () => invoke<void>("calendar_connect"),
  calendarDisconnect: () => invoke<void>("calendar_disconnect"),
  calendarUpcoming: () => invoke<CalendarEvent[]>("calendar_upcoming"),

  // Notes — fold transcript + scratch into structured notes via Claude.
  generateNotes: (
    transcript: string,
    scratch: string,
    model?: AnalysisModelId,
    depth?: NotesDepth
  ) => invoke<GeneratedNote>("generate_notes", { transcript, scratch, model, depth }),

  // Credentials — secrets go to the Keychain; status returns booleans only.
  setCredential: (id: CredentialId, value: string) =>
    invoke<void>("set_credential", { id, value }),
  deleteCredential: (id: CredentialId) =>
    invoke<void>("delete_credential", { id }),
  credentialStatus: () =>
    invoke<CredentialStatus[]>("credential_status"),
};

export interface CalendarEvent {
  id: string;
  title: string;
  startTs: number; // epoch ms
  endTs: number;
  link: string | null;
  platform: string | null;
  attendees: string[];
  autoRecord: string;
}

export interface AsanaIdName {
  gid: string;
  name: string;
}

export interface AsanaUser {
  gid: string;
  name: string;
  email: string | null;
}

export interface AsanaTaskIn {
  actionItemId: string;
  text: string;
  assigneeGid?: string;
  dueOn?: string;
}

export type MicPermission = "authorized" | "denied" | "restricted" | "undetermined";
export type ScreenPermission = "granted" | "denied";
export interface Permissions {
  mic: MicPermission;
  screen: ScreenPermission;
}

export type AnalysisModelId = "claude-haiku-4-5" | "claude-sonnet-4-6";
export type NotesDepth = "concise" | "detailed";

export interface GeneratedActionItem {
  text: string;
  assignee?: string;
  dueHint?: string;
}

export interface GeneratedNote {
  summary: string;
  keyPoints: string[];
  decisions: string[];
  openQuestions: string[];
  actionItems: GeneratedActionItem[];
  model: string;
}

export type NoteSource = "recorded" | "manual" | "calendar";

export interface NoteSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  source: NoteSource;
  status: string;
  actionItemCount: number;
}

export interface StoredSegment {
  text: string;
  lang: string;
  startMs: number;
  endMs: number;
}

export interface StoredActionItem {
  id: string;
  text: string;
  assignee?: string;
  dueHint?: string;
  source: "ai" | "manual";
  asanaGid?: string;
}

export interface NoteDetail {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  source: NoteSource;
  status: string;
  scratch: string;
  durationSec: number;
  audioPath: string | null;
  segments: StoredSegment[];
  generated: {
    summary: string;
    keyPoints: string[];
    decisions: string[];
    openQuestions: string[];
    model: string;
  } | null;
  actionItems: StoredActionItem[];
}

export type CredentialId =
  | "elevenlabs_api_key"
  | "anthropic_api_key"
  | "google_oauth_client_id"
  | "google_oauth_client_secret"
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
