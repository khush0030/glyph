import { Seg, Tag, Badge, Btn } from "./ui";
import type { UpcomingMeeting } from "../lib/mock";

// One meeting row (.mrow). `showRecord` adds the inline Record button used on
// the Calendar page; the Dashboard "Up next" rows omit it.
export default function MeetingCard({
  m,
  showRecord = false,
  onRecord,
}: {
  m: UpcomingMeeting;
  showRecord?: boolean;
  onRecord?: () => void;
}) {
  return (
    <div className="flex items-center gap-4 px-[18px] py-[15px] border-b border-line-soft last:border-b-0">
      <div className="min-w-[64px]">
        <div className="text-[14.5px] font-bold">{m.time}</div>
        <div className="text-[11.5px] text-faint font-medium">{m.ampm}</div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[14.5px] font-semibold flex items-center gap-[9px]">
          {m.title} <Tag type={m.type} />
        </div>
        <div className="text-[12.5px] text-muted mt-[3px] flex items-center gap-[10px]">
          <Badge color={m.platformColor}>{m.platform}</Badge>
          {m.duration && <span>· {m.duration}</span>}
          {m.attendees && <span>· {m.attendees}</span>}
        </div>
      </div>
      <Seg
        options={["Ask", "Auto"]}
        initial={m.autoRecord === "Auto" ? 1 : 0}
        title="Auto-record"
      />
      {showRecord && (
        <Btn sm onClick={onRecord}>
          Record
        </Btn>
      )}
    </div>
  );
}
