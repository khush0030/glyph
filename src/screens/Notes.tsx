import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import NoteRow from "../components/NoteRow";
import { Card, SectionHead, Btn } from "../components/ui";
import { PlusIcon, NotesIcon, RecordDotIcon } from "../components/Icons";
import { useNotesList, groupNotesByDay } from "../lib/useNotesList";

export default function Notes({
  onOpenMeeting,
  onOpenNote,
}: {
  onOpenMeeting: (recording: boolean) => void;
  onOpenNote: (id: string) => void;
}) {
  const { notes, loading } = useNotesList();
  const groups = groupNotesByDay(notes);

  return (
    <div className="animate-fade">
      <PageHeader
        title="Notes"
        sub={notes.length > 0 ? `${notes.length} saved on this Mac` : "Your meeting notes, saved on this Mac"}
        right={
          <Btn onClick={() => onOpenMeeting(false)}>
            <PlusIcon className="w-[15px] h-[15px]" /> New note
          </Btn>
        }
      />

      {!loading && notes.length === 0 ? (
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
      ) : (
        groups.map((day) => (
          <div key={day.label}>
            <SectionHead title={day.label} />
            <Card className="mb-2">
              {day.items.map((n) => (
                <NoteRow key={n.id} note={n} onOpen={onOpenNote} />
              ))}
            </Card>
          </div>
        ))
      )}
    </div>
  );
}
