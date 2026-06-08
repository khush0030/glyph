import { useCallback, useState } from "react";
import Sidebar from "./components/Sidebar";
import Dashboard from "./screens/Dashboard";
import Calendar from "./screens/Calendar";
import Notes from "./screens/Notes";
import Meeting from "./screens/Meeting";
import Settings from "./screens/Settings";
import MeetingStartingPrompt from "./components/MeetingStartingPrompt";
import { commands, type NoteSource, type CalendarEvent } from "./lib/ipc";
import { useMeetingScheduler } from "./lib/useMeetingScheduler";
import { useRecordingActive } from "./lib/useRecordingActive";
import { useTheme } from "./lib/useTheme";

export type Page = "dashboard" | "calendar" | "notes" | "meeting" | "settings";

export default function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [meetingNoteId, setMeetingNoteId] = useState<string | null>(null);
  const [meetingRecording, setMeetingRecording] = useState(false);
  const [starting, setStarting] = useState<CalendarEvent | null>(null);

  // Load the persisted theme and apply `.dark` to <html> on startup.
  useTheme();

  // Create a fresh note row, then open the Meeting view bound to it.
  const openMeeting = useCallback(
    async (recording: boolean, opts?: { title?: string; source?: NoteSource }) => {
      try {
        const source = opts?.source ?? (recording ? "recorded" : "manual");
        const title = opts?.title ?? (recording ? "Untitled meeting" : "New note");
        const id = await commands.createNote(source, title);
        setMeetingNoteId(id);
        setMeetingRecording(recording);
        setPage("meeting");
      } catch (e) {
        console.error("could not create note", e);
      }
    },
    []
  );

  // Fire at a meeting's start: auto-record, or ask via the prompt.
  const onAuto = useCallback(
    (ev: CalendarEvent) => openMeeting(true, { title: ev.title, source: "calendar" }),
    [openMeeting]
  );
  const onAsk = useCallback((ev: CalendarEvent) => setStarting(ev), []);
  useMeetingScheduler(onAuto, onAsk);

  const recordingActive = useRecordingActive();

  // Open an existing saved note.
  function openNote(id: string) {
    setMeetingNoteId(id);
    setMeetingRecording(false);
    setPage("meeting");
  }

  return (
    <div className="grid grid-cols-[230px_1fr] h-screen">
      <Sidebar
        page={page}
        onNavigate={setPage}
        onRecord={() => openMeeting(true)}
        recordingActive={recordingActive}
        onReturnToRecording={() => meetingNoteId && setPage("meeting")}
      />
      <main className="overflow-y-auto h-screen">
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
              recording={meetingRecording}
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
