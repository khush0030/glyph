import { useCallback, useEffect, useRef, useState } from "react";
import { on, EVENTS } from "./ipc";

export interface Segment {
  text: string;
  lang: string;
  startMs: number;
  endMs: number;
  isFinal: boolean;
}

export interface TranscriptState {
  /** Committed (final) segments, in arrival order. */
  segments: Segment[];
  /** The current in-progress partial hypothesis, if any. */
  partial: string;
  reset: () => void;
}

/** Subscribes to transcript://partial + transcript://final from Scribe. */
export function useTranscript(active: boolean): TranscriptState {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [partial, setPartial] = useState("");
  const unlisten = useRef<Array<() => void>>([]);

  const reset = useCallback(() => {
    setSegments([]);
    setPartial("");
  }, []);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    (async () => {
      const u1 = await on<Segment>(EVENTS.transcriptFinal, (e) => {
        setSegments((s) => [...s, e.payload]);
        setPartial("");
      });
      const u2 = await on<Segment>(EVENTS.transcriptPartial, (e) => {
        setPartial(e.payload.text);
      });
      if (!alive) {
        u1();
        u2();
        return;
      }
      unlisten.current = [u1, u2];
    })();
    return () => {
      alive = false;
      unlisten.current.forEach((u) => u());
      unlisten.current = [];
    };
  }, [active]);

  return { segments, partial, reset };
}

/** Heuristic: does the text contain Devanagari? Drives the .dev font so Hindi
 *  keeps its script (never romanized, never translated). */
export function isDevanagari(text: string): boolean {
  return /[ऀ-ॿ]/.test(text);
}
