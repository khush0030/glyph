import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import CalendarEventRow from "../components/CalendarEventRow";
import { SectionHead, Btn, Card } from "../components/ui";
import { PlusIcon, RecordDotIcon, CalendarIcon, NotesIcon, ChevronRightIcon } from "../components/Icons";
import { greeting, longDate } from "../lib/datetime";
import { useCalendar } from "../lib/useCalendar";
import type { Page } from "../App";

export default function Dashboard({
  onNavigate,
  onOpenMeeting,
}: {
  onNavigate: (p: Page) => void;
  onOpenMeeting: (recording: boolean) => void;
}) {
  const cal = useCalendar();
  const next = cal.events.slice(0, 3);

  return (
    <div className="animate-fade">
      <PageHeader
        title={`${greeting()}, Khush`}
        sub={longDate()}
        right={
          <>
            <Btn onClick={() => onOpenMeeting(false)}>
              <PlusIcon className="w-[15px] h-[15px]" /> New note
            </Btn>
            <Btn variant="primary" onClick={() => onOpenMeeting(true)}>
              <RecordDotIcon className="w-[15px] h-[15px]" /> Start recording
            </Btn>
          </>
        }
      />

      <div className="flex items-center justify-between mt-[30px] mb-[14px]">
        <span className="text-[12px] font-bold tracking-[0.7px] uppercase text-faint">
          Up next
        </span>
        {cal.connected && cal.events.length > 0 && (
          <a
            onClick={() => onNavigate("calendar")}
            className="text-[13px] font-semibold text-indigo cursor-pointer inline-flex items-center gap-1"
          >
            View all <ChevronRightIcon className="w-[13px] h-[13px]" />
          </a>
        )}
      </div>

      {cal.connected ? (
        next.length > 0 ? (
          <Card>
            {next.map((ev) => (
              <CalendarEventRow key={ev.id} ev={ev} />
            ))}
          </Card>
        ) : (
          <EmptyState title="No upcoming meetings" body="Nothing scheduled soon." />
        )
      ) : (
        <EmptyState
          icon={<CalendarIcon className="w-7 h-7" />}
          title="No upcoming meetings"
          body="Connect Google Calendar to see your schedule and auto-record meetings with a video link."
          action={
            <Btn variant="primary" onClick={() => onNavigate("calendar")}>
              Connect Google Calendar
            </Btn>
          }
        />
      )}

      <SectionHead title="Recent notes" />
      <EmptyState
        icon={<NotesIcon className="w-7 h-7" />}
        title="No notes yet"
        body="Start a recording or create a note — your meetings will show up here."
        action={
          <Btn onClick={() => onOpenMeeting(true)}>
            <RecordDotIcon className="w-[15px] h-[15px]" /> Start recording
          </Btn>
        }
      />
    </div>
  );
}
