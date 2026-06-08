import PageHeader from "../components/PageHeader";
import MeetingCard from "../components/MeetingCard";
import NotesList from "../components/NotesList";
import { Card, SectionHead, Btn } from "../components/ui";
import { PlusIcon, RecordDotIcon, ChevronRightIcon } from "../components/Icons";
import { upcoming, recentNotes } from "../lib/mock";
import type { Page } from "../App";

const ViewAll = ({ onClick }: { onClick: () => void }) => (
  <a
    onClick={onClick}
    className="text-[13px] font-semibold text-indigo cursor-pointer inline-flex items-center gap-1"
  >
    View all <ChevronRightIcon className="w-[13px] h-[13px]" />
  </a>
);

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
        title="Good afternoon, Khush"
        sub="Monday, 8 June · 2 meetings today"
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

      <SectionHead
        title="Up next"
        action={<ViewAll onClick={() => onNavigate("calendar")} />}
      />
      <Card>
        {upcoming.map((m, i) => (
          <MeetingCard key={i} m={m} />
        ))}
      </Card>

      <SectionHead
        title="Recent notes"
        action={<ViewAll onClick={() => onNavigate("notes")} />}
      />
      <Card>
        <NotesList rows={recentNotes} onOpen={() => onOpenMeeting(false)} />
      </Card>
    </div>
  );
}
