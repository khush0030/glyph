// The six swappable interfaces the UI depends on (CLAUDE.md "core rule").
// Cloud vs local is purely which implementation is wired behind these — the
// React UI never imports a concrete impl. M0 only defines the contracts.
export * from "./AudioSource";
export * from "./Transcriber";
export * from "./NoteGenerator";
export * from "./NotesStore";
export * from "./CalendarSource";
export * from "./TaskExporter";
