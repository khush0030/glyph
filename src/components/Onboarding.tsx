import { useCallback, useEffect, useState, type ReactNode } from "react";
import { commands, type Permissions } from "../lib/ipc";
import { CalendarIcon, CheckIcon } from "./Icons";
import Brand from "./Brand";

// First-run permission walk-through (M9). Records on this Mac need two OS
// permissions — microphone and system-audio (screen) recording — plus an
// optional Google Calendar connection. Every step is skippable: the user can
// always "Get started" and grant later from Settings (graceful denial).

const MicIcon = (p: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
  </svg>
);
const SpeakerIcon = (p: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
    <path d="M4 9v6h4l5 4V5L8 9H4z" strokeLinejoin="round" />
    <path d="M17 9a4 4 0 0 1 0 6" strokeLinecap="round" />
  </svg>
);

type StepState = "done" | "todo" | "blocked";

function Step({
  icon,
  title,
  desc,
  state,
  optional,
  action,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  state: StepState;
  optional?: boolean;
  action: ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 px-5 py-[18px] border-b border-line-soft last:border-b-0">
      <div
        className={`w-[38px] h-[38px] rounded-[11px] grid place-items-center shrink-0 ${
          state === "done" ? "bg-green-soft text-green" : "bg-indigo-soft text-indigo"
        }`}
      >
        {state === "done" ? <CheckIcon className="w-[18px] h-[18px]" /> : icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[14.5px] font-semibold">{title}</span>
          {optional && (
            <span className="text-[10px] font-bold uppercase tracking-[0.5px] text-faint border border-line rounded-[20px] px-[7px] py-[1px]">
              Optional
            </span>
          )}
        </div>
        <div className="text-[12.5px] text-muted mt-[2px] leading-[1.45]">{desc}</div>
      </div>
      <div className="shrink-0">
        {state === "done" ? (
          <span className="text-[12.5px] font-semibold text-green">Granted</span>
        ) : (
          action
        )}
      </div>
    </div>
  );
}

const pillBtn =
  "text-[12.5px] font-semibold rounded-[10px] px-[13px] py-[8px] transition-colors";

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const [perms, setPerms] = useState<Permissions>({ mic: "undetermined", screen: "denied" });
  const [calendar, setCalendar] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [p, cal] = await Promise.all([
        commands.checkPermissions(),
        commands.calendarConnected().catch(() => false),
      ]);
      setPerms(p);
      setCalendar(cal);
    } catch (e) {
      console.error("permission check failed", e);
    }
  }, []);

  useEffect(() => {
    refresh();
    // Screen-recording is granted in System Settings, so re-check when the
    // user returns to the app.
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  async function requestMic() {
    setBusy("mic");
    try {
      if (perms.mic === "undetermined") {
        setPerms(await commands.requestPermissions());
      } else {
        await commands.openPrivacySettings("microphone");
      }
    } finally {
      setBusy(null);
    }
  }

  async function connectCalendar() {
    setBusy("calendar");
    try {
      await commands.calendarConnect();
      await refresh();
    } catch (e) {
      console.error("calendar connect failed", e);
    } finally {
      setBusy(null);
    }
  }

  const micDone = perms.mic === "authorized";
  const screenDone = perms.screen === "granted";

  return (
    <div className="fixed inset-0 z-50 bg-bg grid place-items-center px-6 overflow-y-auto py-10">
      <div className="w-full max-w-[560px] animate-fade">
        <Brand />
        <h1 className="text-[26px] font-extrabold tracking-[-0.8px] mb-[6px]">
          Let&rsquo;s set up Glyph
        </h1>
        <p className="text-[14px] text-muted mb-[26px] leading-[1.5]">
          Two quick permissions and you&rsquo;re ready to record. Everything stays on this Mac.
        </p>

        <div className="bg-surface border border-line rounded-rl overflow-hidden">
          <Step
            icon={<MicIcon className="w-[19px] h-[19px]" />}
            title="Microphone"
            desc="Captures your voice in every meeting — in-person or on a call."
            state={micDone ? "done" : "todo"}
            action={
              <button
                type="button"
                disabled={busy === "mic"}
                onClick={requestMic}
                className={`${pillBtn} bg-indigo text-white hover:bg-indigo-deep disabled:opacity-60`}
              >
                {perms.mic === "denied" || perms.mic === "restricted"
                  ? "Open Settings"
                  : busy === "mic"
                    ? "Requesting…"
                    : "Enable"}
              </button>
            }
          />
          <Step
            icon={<SpeakerIcon className="w-[19px] h-[19px]" />}
            title="System audio"
            desc="Captures the other side of online calls. Enable “Screen & System Audio Recording” for Glyph in System Settings, then relaunch."
            state={screenDone ? "done" : "todo"}
            action={
              <button
                type="button"
                onClick={() => commands.openPermissionSettings()}
                className={`${pillBtn} border border-line hover:border-faint`}
              >
                Open Settings
              </button>
            }
          />
          <Step
            icon={<CalendarIcon className="w-[19px] h-[19px]" />}
            title="Google Calendar"
            desc="Pulls upcoming meetings so Glyph can auto-start recording. You can connect later in Settings."
            state={calendar ? "done" : "todo"}
            optional
            action={
              <button
                type="button"
                disabled={busy === "calendar"}
                onClick={connectCalendar}
                className={`${pillBtn} border border-line hover:border-faint disabled:opacity-60`}
              >
                {busy === "calendar" ? "Connecting…" : "Connect"}
              </button>
            }
          />
        </div>

        <div className="flex items-center justify-between mt-[26px]">
          <button
            type="button"
            onClick={onDone}
            className="text-[13px] font-semibold text-faint hover:text-muted"
          >
            Skip for now
          </button>
          <button
            type="button"
            onClick={onDone}
            className="bg-ink text-white font-semibold text-[14px] px-[22px] py-[12px] rounded-[13px] hover:-translate-y-[1px] transition-transform"
          >
            {micDone ? "Get started" : "Continue anyway"}
          </button>
        </div>
      </div>
    </div>
  );
}
