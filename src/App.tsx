import { useState } from "react";
import Sidebar from "./components/Sidebar";
import Dashboard from "./screens/Dashboard";
import Calendar from "./screens/Calendar";
import Notes from "./screens/Notes";
import Meeting from "./screens/Meeting";
import Settings from "./screens/Settings";
import { commands } from "./lib/ipc";

export type Page = "dashboard" | "calendar" | "notes" | "meeting" | "settings";

export default function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [meetingNoteId, setMeetingNoteId] = useState<string | null>(null);
  const [meetingRecording, setMeetingRecording] = useState(false);

  // Create a fresh note row, then open the Meeting view bound to it.
  async function openMeeting(recording: boolean) {
    try {
      const id = await commands.createNote(
        recording ? "recorded" : "manual",
        recording ? "Untitled meeting" : "New note"
      );
      setMeetingNoteId(id);
      setMeetingRecording(recording);
      setPage("meeting");
    } catch (e) {
      console.error("could not create note", e);
    }
  }

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
    </div>
  );
}
