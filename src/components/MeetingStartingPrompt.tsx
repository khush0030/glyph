import { Badge } from "./ui";
import type { CalendarEvent } from "../lib/ipc";

// Ask-first prompt shown at a meeting's start time (bottom-right toast).
export default function MeetingStartingPrompt({
  event,
  onRecord,
  onDismiss,
}: {
  event: CalendarEvent;
  onRecord: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="fixed bottom-6 right-6 z-50 w-[340px] bg-surface border border-line rounded-rl shadow-[0_24px_70px_rgba(26,24,35,.28)] p-[18px] animate-fade">
      <div className="flex items-center gap-[7px] mb-2">
        <span className="w-[8px] h-[8px] rounded-full bg-rec animate-pulse-dot" />
        <span className="text-[11px] font-bold tracking-[0.6px] uppercase text-rec">
          Meeting starting
        </span>
      </div>
      <div className="text-[15px] font-bold mb-1 truncate">{event.title}</div>
      <div className="text-[12.5px] text-muted mb-[14px]">
        {event.platform && <Badge color="#2F9E6B">{event.platform}</Badge>}
        {event.attendees.length > 0 && <span> · {event.attendees.slice(0, 2).join(", ")}</span>}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onRecord}
          className="flex-1 flex items-center justify-center gap-[7px] bg-indigo text-white font-semibold text-[13.5px] py-[10px] rounded-[11px] hover:bg-indigo-deep transition-colors"
        >
          <span className="w-2 h-2 rounded-full bg-white" /> Record
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="font-semibold text-[13.5px] px-[15px] py-[10px] rounded-[11px] border border-line text-muted hover:border-faint"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
