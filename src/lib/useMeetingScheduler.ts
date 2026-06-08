import { useEffect, useRef } from "react";
import { useCalendar } from "./useCalendar";
import { useAutoRecord } from "./useAutoRecord";
import type { CalendarEvent } from "./ipc";

const FIRE_WINDOW_MS = 5 * 60 * 1000; // fire if start is within the last 5 min
const TICK_MS = 30 * 1000;
const REFRESH_MS = 5 * 60 * 1000;

/** At a meeting's start time (calendar event with a video link), fire either a
 *  silent auto-record (onAuto) or an ask-first prompt (onAsk), per the
 *  per-meeting setting. Each event fires at most once per session. */
export function useMeetingScheduler(
  onAuto: (ev: CalendarEvent) => void,
  onAsk: (ev: CalendarEvent) => void
) {
  const cal = useCalendar();
  const auto = useAutoRecord();
  const handled = useRef<Set<string>>(new Set());
  const cbs = useRef({ onAuto, onAsk });
  cbs.current = { onAuto, onAsk };

  useEffect(() => {
    if (!cal.connected) return;

    const tick = () => {
      const now = Date.now();
      for (const ev of cal.events) {
        if (!ev.link || handled.current.has(ev.id)) continue;
        if (now >= ev.startTs && now < ev.startTs + FIRE_WINDOW_MS) {
          handled.current.add(ev.id);
          if (auto.get(ev.id) === "auto") cbs.current.onAuto(ev);
          else cbs.current.onAsk(ev);
        }
      }
    };

    tick();
    const t = setInterval(tick, TICK_MS);
    const r = setInterval(() => cal.refresh(), REFRESH_MS);
    return () => {
      clearInterval(t);
      clearInterval(r);
    };
  }, [cal.connected, cal.events, cal, auto]);
}
