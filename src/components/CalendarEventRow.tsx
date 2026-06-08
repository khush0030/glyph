import { Seg, Badge, Btn } from "./ui";
import { fmtClock } from "../lib/useCalendar";
import type { CalendarEvent } from "../lib/ipc";

const platformColor = (p: string | null): string => {
  if (!p) return "#A4A1B2";
  if (p.includes("Meet")) return "#2F9E6B";
  if (p.includes("Zoom")) return "#4087E5";
  if (p.includes("Teams")) return "#5A4BD4";
  return "#A4A1B2";
};

// One meeting row from Google Calendar. Internal/Client typing isn't known from
// the calendar yet, so no tag is shown unless inferable.
export default function CalendarEventRow({
  ev,
  showRecord = false,
  onRecord,
}: {
  ev: CalendarEvent;
  showRecord?: boolean;
  onRecord?: () => void;
}) {
  const { t, ampm } = fmtClock(ev.startTs);
  const durMin = Math.max(0, Math.round((ev.endTs - ev.startTs) / 60000));
  return (
    <div className="flex items-center gap-4 px-[18px] py-[15px] border-b border-line-soft last:border-b-0">
      <div className="min-w-[64px]">
        <div className="text-[14.5px] font-bold">{t}</div>
        <div className="text-[11.5px] text-faint font-medium">{ampm}</div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[14.5px] font-semibold truncate">{ev.title}</div>
        <div className="text-[12.5px] text-muted mt-[3px] flex items-center gap-[10px] flex-wrap">
          <Badge color={platformColor(ev.platform)}>
            {ev.platform ?? "No video link"}
          </Badge>
          {durMin > 0 && <span>· {durMin} min</span>}
          {ev.attendees.length > 0 && (
            <span className="truncate">· {ev.attendees.slice(0, 3).join(", ")}</span>
          )}
        </div>
      </div>
      {ev.link && (
        <Seg options={["Ask", "Auto"]} title="Auto-record" />
      )}
      {showRecord && (
        <Btn sm onClick={onRecord}>
          Record
        </Btn>
      )}
    </div>
  );
}
