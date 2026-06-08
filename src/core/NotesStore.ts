// NotesStore — SQLite persistence (schema in SPEC §11). Wired in M4 via Tauri
// commands; this is the frontend-facing contract.

import type { Segment } from "./Transcriber";
import type { ActionItem } from "./NoteGenerator";

export type NoteSource = "manual" | "recorded" | "calendar";
export type NoteStatus = "draft" | "recording" | "transcribing" | "ready";

export interface Note {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  source: NoteSource;
  langMode: string;
  engine: string;
  durationSec: number;
  status: NoteStatus;
  scratch: string;
  audioPath?: string;
  asanaProjectGid?: string;
}

export interface StoredActionItem extends ActionItem {
  id: string;
  noteId: string;
  /** "ai" generated vs "manual" added. */
  source: "ai" | "manual";
  /** Null until pushed to Asana. */
  asanaGid?: string;
}

export interface NotesStore {
  list(): Promise<Note[]>;
  get(id: string): Promise<Note | null>;
  segments(noteId: string): Promise<Segment[]>;
  actionItems(noteId: string): Promise<StoredActionItem[]>;
  create(partial: Partial<Note>): Promise<string>;
  updateTitle(id: string, title: string): Promise<void>;
  saveScratch(id: string, scratch: string): Promise<void>;
  delete(id: string): Promise<void>;
  deleteAudio(id: string): Promise<void>;
}
