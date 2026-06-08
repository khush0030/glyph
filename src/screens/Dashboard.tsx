import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import { SectionHead, Btn } from "../components/ui";
import { PlusIcon, RecordDotIcon, CalendarIcon, NotesIcon } from "../components/Icons";
import { greeting, longDate } from "../lib/datetime";
import type { Page } from "../App";

export default function Dashboard({
  onNavigate,
  onOpenMeeting,
}: {
  onNavigate: (p: Page) => void;
  onOpenMeeting: (recording: boolean) => void;
}) {
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

      <SectionHead title="Up next" />
      <EmptyState
        icon={<CalendarIcon className="w-7 h-7" />}
        title="No upcoming meetings"
        body="Connect Google Calendar to see your schedule and auto-record meetings with a video link."
        action={
          <Btn variant="primary" onClick={() => onNavigate("settings")}>
            Connect Google Calendar
          </Btn>
        }
      />

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
