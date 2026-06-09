import { useCallback, useEffect, useState } from "react";
import { useRecording } from "./useRecording";
import { useSettings } from "./useSettings";
import { commands, on, EVENTS, type AnalysisModelId, type NotesDepth } from "./ipc";

/** App-level recording controller. Owns the full lifecycle — start, the live
 *  session, and stop → local transcribe → save → notes — so it survives page
 *  navigation. Any screen can show the active recording and stop it. */
export interface RecordingController {
  recording: boolean;
  elapsed: number;
  error: string | null;
  transcribing: boolean;
  statusMsg: string;
  /** The note currently being recorded (or transcribed), if any. */
  activeNoteId: string | null;
  /** Bumps each time a recording finishes, so the open note can reload. */
  finishedToken: number;
  start: (noteId: string) => Promise<void>;
  stop: () => Promise<void>;
}

export function useRecordingController(): RecordingController {
  const rec = useRecording();
  const { values: settings } = useSettings();
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [finishedToken, setFinishedToken] = useState(0);

  // Backend transcription status (model download %, transcribing).
  useEffect(() => {
    let un: (() => void) | undefined;
    on<{ state: string; pct?: number }>(EVENTS.recordingStatus, (e) => {
      const p = e.payload;
      if (p.state === "downloading_model")
        setStatusMsg(`Downloading speech model… ${p.pct ?? 0}%`);
      else if (p.state === "transcribing") setStatusMsg("Transcribing…");
      else setStatusMsg("");
    }).then((u) => (un = u));
    return () => un?.();
  }, []);

  const start = useCallback(
    async (noteId: string) => {
      setActiveNoteId(noteId);
      await rec.start();
    },
    [rec]
  );

  const stop = useCallback(async () => {
    const id = activeNoteId;
    if (!id) return;
    setTranscribing(true);
    const wav = await rec.stop();
    try {
      const segs = wav ? await commands.transcribeRecording(wav) : [];
      await commands.saveSegments(id, segs);
      await commands.setRecordingResult(id, wav ?? null, rec.elapsed);
      if (segs.length > 0 && settings.audio_retention === "delete") {
        await commands.deleteAudio(id).catch(() => {});
      }
      // Fold into notes from the freshly-saved transcript + scratch.
      const note = await commands.getNote(id);
      const text = note.segments.map((s) => s.text).join("\n");
      if (text.trim() || note.scratch.trim()) {
        const g = await commands.generateNotes(
          text,
          note.scratch,
          settings.analysis_model as AnalysisModelId,
          settings.notes_depth as NotesDepth
        );
        await commands.saveGenerated(id, g);
      }
    } catch (e) {
      console.error("stop/transcribe failed", e);
    } finally {
      setTranscribing(false);
      setStatusMsg("");
      setActiveNoteId(null);
      setFinishedToken((t) => t + 1);
    }
  }, [activeNoteId, rec, settings.audio_retention, settings.analysis_model, settings.notes_depth]);

  return {
    recording: rec.recording,
    elapsed: rec.elapsed,
    error: rec.error,
    transcribing,
    statusMsg,
    activeNoteId,
    finishedToken,
    start,
    stop,
  };
}
