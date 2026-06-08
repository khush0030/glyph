import PageHeader from "../components/PageHeader";
import MeetingCard from "../components/MeetingCard";
import { Card, SectionHead, ConnPill } from "../components/ui";
import { calendarDays } from "../lib/mock";

export default function Calendar({
  onOpenMeeting,
}: {
  onOpenMeeting: (recording: boolean) => void;
}) {
  return (
    <div className="animate-fade">
      <PageHeader
        title="Calendar"
        sub="Upcoming meetings · auto-detected video links"
        right={<ConnPill>Google Calendar</ConnPill>}
      />
      {calendarDays.map((day) => (
        <div key={day.label}>
          <SectionHead title={day.label} />
          <Card className="mb-2">
            {day.items.map((m, i) => (
              <MeetingCard
                key={i}
                m={m}
                showRecord
                onRecord={() => onOpenMeeting(true)}
              />
            ))}
          </Card>
        </div>
      ))}
    </div>
  );
}
