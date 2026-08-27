import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { Badge } from "./components/ui";
import { commands, on, EVENTS, type PromptPayload } from "./lib/ipc";
import { fmtClock } from "./lib/useCalendar";
import { useTheme } from "./lib/useTheme";

const AUTO_HIDE_MS = 60_000;
const PLATFORM_COLORS: Record<string, string> = {
  Zoom: "#2D8CFF",
  Teams: "#6264A7",
  "Google Meet": "#2F9E6B",
  "Web call": "#2F9E6B",
};

/** Root of the always-on-top `prompt` window. Shows the card pushed by Rust
 *  (`meeting://detected`), hides on Dismiss / Record / call end / 60 s. */
export default function PromptWindow() {
  useTheme();
  const [p, setP] = useState<PromptPayload | null>(null);

  // Frameless + transparent window: only the card itself paints. useLayoutEffect
  // so the background is set before paint — no flash of the default background.
  useLayoutEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  }, []);

  useEffect(() => {
    let alive = true;
    // Guards promptCurrent()'s resolution from clobbering a newer payload
    // already delivered by meeting://detected while the fetch was in flight.
    let gotEvent = false;
    const uns: Array<() => void> = [];

    commands
      .promptCurrent()
      .then((cur) => {
        if (!alive || gotEvent) return;
        if (cur) setP(cur);
      })
      .catch(() => {});

    on<PromptPayload>(EVENTS.meetingDetected, (e) => {
      gotEvent = true;
      setP(e.payload);
    }).then((u) => {
      if (!alive) {
        u();
        return;
      }
      uns.push(u);
    });
    on<void>(EVENTS.meetingEnded, () => setP(null)).then((u) => {
      if (!alive) {
        u();
        return;
      }
      uns.push(u);
    });

    return () => {
      alive = false;
      uns.forEach((u) => u());
    };
  }, []);

  const dismiss = useCallback(() => {
    setP(null);
    commands.promptDismiss().catch(() => {});
  }, []);

  const record = useCallback(() => {
    if (!p) return;
    const cur = p;
    setP(null);
    commands.promptRecord(cur).catch((e) => {
      console.error("prompt_record failed", e);
      setP(cur);
    });
  }, [p]);

  // Auto-hide is not a Dismiss: walking away from the desk shouldn't start the
  // 2-minute cooldown and suppress the next detection.
  const timeout = useCallback(() => {
    setP(null);
    commands.promptTimeout().catch(() => {});
  }, []);

  useEffect(() => {
    if (!p) return;
    const t = setTimeout(timeout, AUTO_HIDE_MS);
    return () => clearTimeout(t);
  }, [p, timeout]);

  if (!p) return <div className="h-screen w-screen" />;

  const when = p.startTs ? fmtClock(p.startTs) : null;
  const extra = p.attendees.length - 2;

  return (
    <div className="h-screen w-screen p-2">
      <div className="h-full bg-surface border border-line rounded-[16px] shadow-[0_24px_70px_rgba(26,24,35,.28)] p-[14px] flex flex-col animate-fade">
        <div className="flex items-center gap-[7px] mb-[6px]">
          <span className="w-[8px] h-[8px] rounded-full bg-rec animate-pulse-dot" />
          <span className="text-[11px] font-bold tracking-[0.6px] uppercase text-rec">
            {p.kind === "detected" ? "Meeting detected" : "Meeting starting"}
          </span>
        </div>
        <div className="text-[14.5px] font-bold truncate">{p.title}</div>
        <div className="text-[12px] text-muted truncate mb-auto">
          {p.platform && (
            <Badge color={PLATFORM_COLORS[p.platform] ?? "#70695F"}>{p.platform}</Badge>
          )}
          {when && <span> · {when.t} {when.ampm}</span>}
          {p.attendees.length > 0 && (
            <span>
              {" "}· {p.attendees.slice(0, 2).join(", ")}
              {extra > 0 && ` +${extra}`}
            </span>
          )}
        </div>
        <div className="flex gap-2 mt-[10px]">
          <button
            type="button"
            onClick={record}
            className="flex-1 flex items-center justify-center gap-[7px] bg-indigo text-white font-semibold text-[13px] py-[8px] rounded-[10px] hover:bg-indigo-deep transition-colors"
          >
            <span className="w-2 h-2 rounded-full bg-white" /> Record
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="font-semibold text-[13px] px-[14px] py-[8px] rounded-[10px] border border-line text-muted hover:border-faint"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
