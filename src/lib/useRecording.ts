import { useCallback, useEffect, useRef, useState } from "react";
import { commands, on, EVENTS } from "./ipc";

export interface RecordingState {
  recording: boolean;
  /** Live RMS level 0..1 from the sidecar, for the indicator. */
  level: number;
  /** Seconds elapsed since start. */
  elapsed: number;
  /** Saved WAV path after stop. */
  wavPath: string | null;
  error: string | null;
  start: () => Promise<void>;
  /** Stops and resolves with the saved WAV path (or null on error). */
  stop: () => Promise<string | null>;
}

/** Drives a real recording via the Tauri audio commands + events. Safe to call
 *  outside Tauri (e.g. plain vite) — start() just records an error then. */
export function useRecording(): RecordingState {
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [wavPath, setWavPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unlistenLevel = useRef<(() => void) | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    unlistenLevel.current?.();
    unlistenLevel.current = null;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setWavPath(null);
    try {
      const un = await on<{ rms: number }>(EVENTS.recordingLevel, (e) =>
        setLevel(e.payload.rms)
      );
      unlistenLevel.current = un;
      await commands.startRecording("manual");
      setRecording(true);
      setElapsed(0);
      timer.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch (e) {
      cleanup();
      setError(String(e));
    }
  }, [cleanup]);

  const stop = useCallback(async (): Promise<string | null> => {
    let path: string | null = null;
    try {
      path = await commands.stopRecording();
      setWavPath(path);
    } catch (e) {
      setError(String(e));
    } finally {
      cleanup();
      setRecording(false);
      setLevel(0);
    }
    return path;
  }, [cleanup]);

  useEffect(() => cleanup, [cleanup]);

  return { recording, level, elapsed, wavPath, error, start, stop };
}
