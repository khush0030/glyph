import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import CalendarEventRow from "../components/CalendarEventRow";
import { Card, SectionHead, Btn, ConnPill } from "../components/ui";
import { CalendarIcon } from "../components/Icons";
import { useCalendar, groupByDay } from "../lib/useCalendar";
import { useAutoRecord } from "../lib/useAutoRecord";
import type { Page } from "../App";

export default function Calendar({
  onNavigate,
  onOpenMeeting,
}: {
  onNavigate: (p: Page) => void;
  onOpenMeeting: (recording: boolean) => void;
}) {
  const cal = useCalendar();
  const auto = useAutoRecord();
  const groups = groupByDay(cal.events);

  return (
    <div className="animate-fade">
      <PageHeader
        title="Calendar"
        sub="Upcoming meetings · auto-detected video links"
        right={
          cal.connected ? (
            <div className="flex items-center gap-2">
              <ConnPill>Google Calendar</ConnPill>
              <Btn sm onClick={cal.disconnect}>
                Disconnect
              </Btn>
            </div>
          ) : undefined
        }
      />

      {cal.error && (
        <div className="mb-4 px-4 py-3 rounded-r text-[12.5px] text-rec bg-rec-soft">
          {cal.error}
        </div>
      )}

      {!cal.connected ? (
        <EmptyState
          icon={<CalendarIcon className="w-7 h-7" />}
          title="Google Calendar not connected"
          body="Connect your calendar to list upcoming meetings grouped by day, detect Meet/Zoom/Teams links, and auto- or ask-to-record at start time."
          action={
            <div className="flex flex-col items-center gap-2">
              <Btn variant="primary" onClick={cal.connect}>
                {cal.loading ? "Waiting for Google…" : "Connect Google Calendar"}
              </Btn>
              <button
                type="button"
                onClick={() => onNavigate("settings")}
                className="text-[12px] text-faint hover:text-muted"
              >
                Add the OAuth client ID in Settings first
              </button>
            </div>
          }
        />
      ) : cal.events.length === 0 ? (
        <EmptyState
          icon={<CalendarIcon className="w-7 h-7" />}
          title={cal.loading ? "Loading meetings…" : "No upcoming meetings"}
          body="Nothing scheduled in the next two weeks. New events will show up here automatically."
        />
      ) : (
        groups.map((day) => (
          <div key={day.label}>
            <SectionHead title={day.label} />
            <Card className="mb-2">
              {day.items.map((ev) => (
                <CalendarEventRow
                  key={ev.id}
                  ev={ev}
                  showRecord
                  onRecord={() => onOpenMeeting(true)}
                  autoRecord={auto.get(ev.id)}
                  onAutoRecordChange={(v) => auto.set(ev.id, v)}
                />
              ))}
            </Card>
          </div>
        ))
      )}
    </div>
  );
}
