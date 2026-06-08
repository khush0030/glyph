import { useState } from "react";
import Sidebar from "./components/Sidebar";
import Dashboard from "./screens/Dashboard";
import Calendar from "./screens/Calendar";
import Notes from "./screens/Notes";
import Meeting from "./screens/Meeting";
import Settings from "./screens/Settings";

export type Page = "dashboard" | "calendar" | "notes" | "meeting" | "settings";

export default function App() {
  const [page, setPage] = useState<Page>("dashboard");
  // Whether the meeting view was opened in a recording state (vs manual note).
  const [meetingRecording, setMeetingRecording] = useState(false);

  function openMeeting(recording: boolean) {
    setMeetingRecording(recording);
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
            <Dashboard onNavigate={setPage} onOpenMeeting={openMeeting} />
          )}
          {page === "calendar" && <Calendar onNavigate={setPage} />}
          {page === "notes" && <Notes onOpenMeeting={openMeeting} />}
          {page === "meeting" && <Meeting recording={meetingRecording} />}
          {page === "settings" && <Settings />}
        </div>
      </main>
    </div>
  );
}
