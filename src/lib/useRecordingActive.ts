import { useEffect, useRef, useState } from "react";
import { on, EVENTS } from "./ipc";

/** App-level "is a recording happening" signal, derived from the level
 *  heartbeat (≈10/sec while recording) so a recording indicator can be shown
 *  on any page — consent rule (CLAUDE.md #6). */
export function useRecordingActive(): boolean {
  const [active, setActive] = useState(false);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let unLevel: (() => void) | undefined;
    let unStatus: (() => void) | undefined;
    (async () => {
      unLevel = await on(EVENTS.recordingLevel, () => {
        setActive(true);
        if (clearTimer.current) clearTimeout(clearTimer.current);
        // No level for 1.5s ⇒ recording has stopped.
        clearTimer.current = setTimeout(() => setActive(false), 1500);
      });
      unStatus = await on<{ state?: string }>(EVENTS.recordingStatus, (e) => {
        if (e.payload?.state === "stopped") setActive(false);
      });
    })();
    return () => {
      unLevel?.();
      unStatus?.();
      if (clearTimer.current) clearTimeout(clearTimer.current);
    };
  }, []);

  return active;
}
