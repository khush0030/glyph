import { noteTime } from "../lib/useNotesList";
import type { NoteSummary } from "../lib/ipc";

const dotFor = (source: string): string =>
  source === "recorded" ? "#5A4BD4" : source === "calendar" ? "#2F9E6B" : "#A4A1B2";

// One saved-note row in the Dashboard "Recent" and Notes library.
export default function NoteRow({
  note,
  onOpen,
}: {
  note: NoteSummary;
  onOpen: (id: string) => void;
}) {
  const count = note.actionItemCount;
  return (
    <div
      onClick={() => onOpen(note.id)}
      className="flex items-center gap-[14px] px-[18px] py-[14px] border-b border-line-soft last:border-b-0 cursor-pointer transition-[0.12s] hover:bg-line-soft"
    >
      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: dotFor(note.source) }} />
      <div className="flex-1 text-[14px] font-semibold truncate">
        {note.title || "Untitled"}
      </div>
      <div className="text-[12px] text-faint shrink-0">
        {noteTime(note.updatedAt)}
        {count > 0 && ` · ${count} action item${count === 1 ? "" : "s"}`}
      </div>
    </div>
  );
}
