import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import { Btn } from "../components/ui";
import { PlusIcon, NotesIcon, RecordDotIcon } from "../components/Icons";

export default function Notes({
  onOpenMeeting,
}: {
  onOpenMeeting: (recording: boolean) => void;
}) {
  // Saved notes load from SQLite in M4; until then, an empty library.
  return (
    <div className="animate-fade">
      <PageHeader
        title="Notes"
        sub="Your meeting notes, saved on this Mac"
        right={
          <Btn onClick={() => onOpenMeeting(false)}>
            <PlusIcon className="w-[15px] h-[15px]" /> New note
          </Btn>
        }
      />
      <EmptyState
        icon={<NotesIcon className="w-7 h-7" />}
        title="No notes yet"
        body="Record a meeting or create a blank note. Everything you capture is stored locally and shows up here."
        action={
          <Btn variant="primary" onClick={() => onOpenMeeting(true)}>
            <RecordDotIcon className="w-[15px] h-[15px]" /> Start recording
          </Btn>
        }
      />
    </div>
  );
}
