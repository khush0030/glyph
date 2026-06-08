import Brand from "./Brand";
import {
  DashboardIcon,
  CalendarIcon,
  NotesIcon,
  SettingsIcon,
} from "./Icons";
import type { Page } from "../App";

const NAV: { page: Page; label: string; Icon: typeof DashboardIcon }[] = [
  { page: "dashboard", label: "Dashboard", Icon: DashboardIcon },
  { page: "calendar", label: "Calendar", Icon: CalendarIcon },
  { page: "notes", label: "Notes", Icon: NotesIcon },
  { page: "settings", label: "Settings", Icon: SettingsIcon },
];

export default function Sidebar({
  page,
  onNavigate,
  onRecord,
  recordingActive,
  onReturnToRecording,
}: {
  page: Page;
  onNavigate: (p: Page) => void;
  onRecord: () => void;
  recordingActive?: boolean;
  onReturnToRecording?: () => void;
}) {
  // Meeting view is reached via actions, not nav — no nav item highlights then.
  const navActive = NAV.some((n) => n.page === page) ? page : null;
  return (
    <aside className="bg-surface border-r border-line flex flex-col px-[14px] py-[22px]">
      <Brand />
      <nav className="flex flex-col gap-[3px]">
        {NAV.map(({ page: p, label, Icon }) => {
          const on = navActive === p;
          return (
            <button
              key={p}
              onClick={() => onNavigate(p)}
              className={`flex items-center gap-3 border-none font-sans text-[14px] px-3 py-[10px] rounded-[10px] cursor-pointer transition-[0.14s] w-full text-left ${
                on
                  ? "bg-indigo-soft text-indigo-deep font-semibold"
                  : "bg-transparent text-muted font-medium hover:bg-line-soft hover:text-ink"
              }`}
            >
              <Icon className="w-[18px] h-[18px] shrink-0" />
              {label}
            </button>
          );
        })}
      </nav>

      {recordingActive ? (
        <button
          type="button"
          onClick={onReturnToRecording}
          className="mt-auto flex items-center justify-center gap-[9px] bg-rec text-white border-none font-sans text-[14px] font-semibold p-[13px] rounded-[13px] cursor-pointer transition-[0.18s] hover:-translate-y-[1px]"
        >
          <span className="w-2 h-2 rounded-full bg-white animate-pulse-dot" /> Recording — view
        </button>
      ) : (
        <button
          type="button"
          onClick={onRecord}
          className="mt-auto flex items-center justify-center gap-[9px] bg-ink text-white border-none font-sans text-[14px] font-semibold p-[13px] rounded-[13px] cursor-pointer transition-[0.18s] hover:-translate-y-[1px]"
        >
          <span className="w-2 h-2 rounded-full bg-rec" /> Start recording
        </button>
      )}

      <div className="flex items-center gap-[10px] px-2 pt-4 mt-4 border-t border-line">
        <div className="w-[30px] h-[30px] rounded-full bg-indigo text-white grid place-items-center text-[12px] font-bold">
          K
        </div>
        <div>
          <div className="text-[13px] font-semibold">Khush</div>
          <div className="text-[11px] text-faint">OltaFlock AI</div>
        </div>
      </div>
    </aside>
  );
}
