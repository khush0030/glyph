import { useCallback, useState } from "react";
import Sidebar from "./components/Sidebar";
import Dashboard from "./screens/Dashboard";
import Calendar from "./screens/Calendar";
import Notes from "./screens/Notes";
import Meeting from "./screens/Meeting";
import Settings from "./screens/Settings";
import MeetingStartingPrompt from "./components/MeetingStartingPrompt";
import Onboarding from "./components/Onboarding";
import RecordingBar from "./components/RecordingBar";
import { commands, type NoteSource, type CalendarEvent } from "./lib/ipc";
import { useMeetingScheduler } from "./lib/useMeetingScheduler";
import { useRecordingController } from "./lib/useRecordingController";
import { useSettings } from "./lib/useSettings";
import { useTheme } from "./lib/useTheme";

export type Page = "dashboard" | "calendar" | "notes" | "meeting" | "settings";

export default function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [meetingNoteId, setMeetingNoteId] = useState<string | null>(null);
  const [starting, setStarting] = useState<CalendarEvent | null>(null);

  // Load the persisted theme and apply `.dark` to <html> on startup.
  useTheme();

  // First-run permission walk-through, shown until completed/skipped once.
  const { values: settings, set: setSetting, loaded: settingsLoaded } = useSettings();
  const [onboardDismissed, setOnboardDismissed] = useState(false);
  const showOnboarding =
    settingsLoaded && settings.onboarded !== "yes" && !onboardDismissed;
  const finishOnboarding = useCallback(() => {
    setOnboardDismissed(true);
    setSetting("onboarded", "yes");
  }, [setSetting]);

  // App-level recording lifecycle — survives navigation; shown/stoppable anywhere.
  const rec = useRecordingController();

  const viewActiveRecording = useCallback(() => {
    if (rec.activeNoteId) {
      setMeetingNoteId(rec.activeNoteId);
      setPage("meeting");
    }
  }, [rec.activeNoteId]);

  // Create a fresh note row, open the Meeting view, and (if recording) start.
  const openMeeting = useCallback(
    async (recording: boolean, opts?: { title?: string; source?: NoteSource }) => {
      // Already recording? Don't start a second one — jump to the active meeting.
      if (recording && (rec.recording || rec.transcribing)) {
        viewActiveRecording();
        return;
      }
      try {
        const source = opts?.source ?? (recording ? "recorded" : "manual");
        const title = opts?.title ?? (recording ? "Untitled meeting" : "New note");
        const id = await commands.createNote(source, title);
        setMeetingNoteId(id);
        setPage("meeting");
        if (recording) await rec.start(id);
      } catch (e) {
        console.error("could not create note", e);
      }
    },
    [rec, viewActiveRecording]
  );

  // Fire at a meeting's start: auto-record, or ask via the prompt.
  const onAuto = useCallback(
    (ev: CalendarEvent) => openMeeting(true, { title: ev.title, source: "calendar" }),
    [openMeeting]
  );
  const onAsk = useCallback((ev: CalendarEvent) => setStarting(ev), []);
  useMeetingScheduler(onAuto, onAsk);

  // Open an existing saved note.
  function openNote(id: string) {
    setMeetingNoteId(id);
    setPage("meeting");
  }

  if (showOnboarding) return <Onboarding onDone={finishOnboarding} />;

  return (
    <div className="grid grid-cols-[230px_1fr] h-screen">
      <Sidebar
        page={page}
        onNavigate={setPage}
        onRecord={() => openMeeting(true)}
        recordingActive={rec.recording || rec.transcribing}
        onReturnToRecording={viewActiveRecording}
      />
      <main className="overflow-y-auto h-screen">
        <RecordingBar ctl={rec} onView={viewActiveRecording} />
        <div className="px-10 pt-[34px] pb-16 max-w-[1000px] mx-auto">
          {page === "dashboard" && (
            <Dashboard
              onNavigate={setPage}
              onOpenMeeting={openMeeting}
              onOpenNote={openNote}
            />
          )}
          {page === "calendar" && (
            <Calendar onNavigate={setPage} onOpenMeeting={openMeeting} />
          )}
          {page === "notes" && (
            <Notes onOpenMeeting={openMeeting} onOpenNote={openNote} />
          )}
          {page === "meeting" && meetingNoteId && (
            <Meeting
              key={meetingNoteId}
              noteId={meetingNoteId}
              isRecording={rec.activeNoteId === meetingNoteId && rec.recording}
              transcribing={rec.activeNoteId === meetingNoteId && rec.transcribing}
              elapsed={rec.elapsed}
              statusMsg={rec.statusMsg}
              recError={rec.error}
              finishedToken={rec.finishedToken}
              onStop={rec.stop}
              onDeleted={() => setPage("notes")}
            />
          )}
          {page === "settings" && <Settings />}
        </div>
      </main>

      {starting && (
        <MeetingStartingPrompt
          event={starting}
          onRecord={() => {
            const ev = starting;
            setStarting(null);
            openMeeting(true, { title: ev.title, source: "calendar" });
          }}
          onDismiss={() => setStarting(null)}
        />
      )}
    </div>
  );
}
