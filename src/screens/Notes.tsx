import PageHeader from "../components/PageHeader";
import NotesList from "../components/NotesList";
import { Card, SectionHead, Btn } from "../components/ui";
import { PlusIcon } from "../components/Icons";
import { notesDays } from "../lib/mock";

export default function Notes({
  onOpenMeeting,
}: {
  onOpenMeeting: (recording: boolean) => void;
}) {
  return (
    <div className="animate-fade">
      <PageHeader
        title="Notes"
        sub="14 meetings this week"
        right={
          <Btn onClick={() => onOpenMeeting(false)}>
            <PlusIcon className="w-[15px] h-[15px]" /> New note
          </Btn>
        }
      />
      {notesDays.map((day) => (
        <div key={day.label}>
          <SectionHead title={day.label} />
          <Card className="mb-2">
            <NotesList rows={day.items} onOpen={() => onOpenMeeting(false)} />
          </Card>
        </div>
      ))}
    </div>
  );
}
