import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import { Btn } from "../components/ui";
import { CalendarIcon } from "../components/Icons";
import type { Page } from "../App";

export default function Calendar({
  onNavigate,
}: {
  onNavigate: (p: Page) => void;
}) {
  // Real Google Calendar events arrive in M5; until connected, show an
  // empty/connect state rather than placeholder meetings.
  return (
    <div className="animate-fade">
      <PageHeader
        title="Calendar"
        sub="Upcoming meetings · auto-detected video links"
      />
      <EmptyState
        icon={<CalendarIcon className="w-7 h-7" />}
        title="Google Calendar not connected"
        body="Connect your calendar to list upcoming meetings grouped by day, detect Meet/Zoom/Teams links, and auto- or ask-to-record at start time."
        action={
          <Btn variant="primary" onClick={() => onNavigate("settings")}>
            Connect in Settings
          </Btn>
        }
      />
    </div>
  );
}
