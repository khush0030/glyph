import { useCallback, useEffect, useRef, useState } from "react";
import { Seg } from "../components/ui";
import RecordButton from "../components/RecordButton";
import NotesView from "../components/NotesView";
import Transcript from "../components/Transcript";
import AsanaModal from "../components/AsanaModal";
import { useRecording } from "../lib/useRecording";
import { useTranscript, type Segment } from "../lib/useTranscript";
import { useSettings } from "../lib/useSettings";
import { commands, type NoteDetail, type AnalysisModelId, type NotesDepth } from "../lib/ipc";

type Tab = "notes" | "transcript";

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function Meeting({
  noteId,
  recording,
  onDeleted,
}: {
  noteId: string;
  recording: boolean;
  onDeleted: () => void;
}) {
  const [tab, setTab] = useState<Tab>(recording ? "transcript" : "notes");
  const [asanaOpen, setAsanaOpen] = useState(false);
  const [note, setNote] = useState<NoteDetail | null>(null);
  const [title, setTitle] = useState("");
  const [scratch, setScratch] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const rec = useRecording();
  const tx = useTranscript(true);
  const { values: settings, set: setSetting } = useSettings();
  const disclosureOn = settings.auto_disclosure === "on";
  const depth = (settings.notes_depth as NotesDepth) ?? "concise";

  const reload = useCallback(async () => {
    const n = await commands.getNote(noteId);
    setNote(n);
    return n;
  }, [noteId]);

  // Load the note once.
  useEffect(() => {
    (async () => {
      const n = await reload();
      setTitle(n.title);
      setScratch(n.scratch);
    })();
  }, [reload]);

  // Debounced autosave of title + scratch.
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scratchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onTitle(v: string) {
    setTitle(v);
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => commands.updateTitle(noteId, v).catch(() => {}), 500);
  }
  function onScratch(v: string) {
    setScratch(v);
    if (scratchTimer.current) clearTimeout(scratchTimer.current);
    scratchTimer.current = setTimeout(() => commands.saveScratch(noteId, v).catch(() => {}), 500);
  }

  // Live transcript while recording; saved segments once loaded.
  const liveSegments = tx.segments;
  const displaySegments: Segment[] = liveSegments.length
    ? liveSegments
    : (note?.segments ?? []).map((s) => ({ ...s, isFinal: true }));

  const transcriptText = displaySegments.map((s) => s.text).join("\n");
  const canGenerate = transcriptText.trim().length > 0 || scratch.trim().length > 0;

  const generate = useCallback(
    async (depthOverride?: NotesDepth) => {
      setGenerating(true);
      setGenError(null);
      try {
        const model = settings.analysis_model as AnalysisModelId;
        const useDepth = depthOverride ?? (settings.notes_depth as NotesDepth);
        const g = await commands.generateNotes(transcriptText, scratch, model, useDepth);
        await commands.saveGenerated(noteId, g);
        await reload();
        setTab("notes");
      } catch (e) {
        setGenError(String(e));
      } finally {
        setGenerating(false);
      }
    },
    [transcriptText, scratch, noteId, reload, settings.analysis_model, settings.notes_depth]
  );

  // Switch concise/detailed; persist it and re-run if notes already exist.
  const onSetDepth = useCallback(
    (d: NotesDepth) => {
      setSetting("notes_depth", d);
      if (note?.generated) generate(d);
    },
    [setSetting, note?.generated, generate]
  );

  // Auto-start a real recording when opened in record mode.
  const started = useRef(false);
  useEffect(() => {
    if (recording && !started.current) {
      started.current = true;
      tx.reset();
      rec.start();
    }
  }, [recording, rec, tx]);

  // Stop → persist audio + segments, then fold into notes.
  const handleStop = useCallback(async () => {
    const wav = await rec.stop().then(() => rec.wavPath).catch(() => null);
    const segs = tx.segments.map((s) => ({
      text: s.text,
      lang: s.lang,
      startMs: s.startMs,
      endMs: s.endMs,
    }));
    try {
      await commands.saveSegments(noteId, segs);
      await commands.setRecordingResult(noteId, rec.wavPath ?? wav ?? null, rec.elapsed);
      // Retention rule: transcript is the keepsake — drop the audio file once
      // segments are saved if the user opted to delete after transcription.
      if (settings.audio_retention === "delete") {
        await commands.deleteAudio(noteId).catch(() => {});
      }
    } catch (e) {
      console.error("persist recording failed", e);
    }
    if (segs.length > 0 || scratch.trim()) generate();
    else reload();
  }, [rec, tx.segments, noteId, scratch, generate, reload, settings.audio_retention]);

  async function addActionItem(text: string) {
    await commands.addActionItem(noteId, text).catch(() => {});
    reload();
  }
  async function deleteActionItem(id: string) {
    await commands.deleteActionItem(id).catch(() => {});
    reload();
  }
  async function remove() {
    await commands.deleteNote(noteId).catch(() => {});
    onDeleted();
  }


  return (
    <div className="animate-fade">
      <div className="flex items-start justify-between gap-5 mb-[22px]">
        <div className="flex-1">
          <input
            value={title}
            onChange={(e) => onTitle(e.target.value)}
            spellCheck={false}
            aria-label="Meeting title"
            className="text-[24px] font-extrabold tracking-[-0.7px] border-none bg-transparent text-ink w-full outline-none"
          />
          <div className="text-[13px] text-faint mt-[5px]">
            {rec.recording ? (
              <>
                <span className="text-rec font-semibold">● Recording {fmt(rec.elapsed)}</span>{" "}
                · mic + system audio
              </>
            ) : rec.error ? (
              <span className="text-rec">Couldn’t start recording: {rec.error}</span>
            ) : note?.audioPath ? (
              <>Saved · audio on this Mac</>
            ) : (
              "Saved on this Mac"
            )}
          </div>
        </div>
        <div className="flex items-center gap-[9px] shrink-0">
          <Seg title="Language" options={["Auto", <span className="dev">हिं</span>, "EN"]} />
          {rec.recording ? (
            <RecordButton onStop={handleStop} />
          ) : (
            <button
              type="button"
              onClick={remove}
              className="text-[12.5px] font-semibold text-faint hover:text-rec px-2 py-2"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {rec.recording && disclosureOn && (
        <div className="flex items-center gap-[9px] mb-[18px] px-[14px] py-[10px] rounded-[11px] bg-rec-soft border border-rec/30 text-[12.5px] text-rec font-semibold">
          <span className="w-2 h-2 rounded-full bg-rec animate-pulse-dot shrink-0" />
          This call is being recorded &amp; transcribed.
        </div>
      )}

      <div className="flex gap-[26px] border-b border-line mb-[22px]">
        {(["notes", "transcript"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`text-[14px] font-semibold pb-3 px-[2px] cursor-pointer border-b-2 transition-[0.14s] flex items-center gap-[7px] bg-transparent ${
              tab === t ? "text-ink border-indigo" : "text-faint border-transparent"
            }`}
          >
            {t === "notes" ? "Notes" : "Transcript"}
            {t === "notes" && note?.generated && (
              <span className="text-[10px] bg-indigo-soft text-indigo-deep rounded-[20px] px-[7px] py-[1px] font-bold">AI</span>
            )}
            {t === "transcript" && displaySegments.length > 0 && (
              <span className="text-[10px] bg-line-soft text-muted rounded-[20px] px-[7px] py-[1px] font-bold">
                {displaySegments.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "notes" ? (
        <div className="grid grid-cols-[1fr_312px] gap-[22px] items-start">
          <NotesView
            generated={note?.generated ?? null}
            actionItems={note?.actionItems ?? []}
            generating={generating}
            error={genError}
            canGenerate={canGenerate}
            depth={depth}
            onSetDepth={onSetDepth}
            onGenerate={() => generate()}
            onAddActionItem={addActionItem}
            onDeleteActionItem={deleteActionItem}
            onOpenAsana={() => setAsanaOpen(true)}
          />
          <aside>
            <div className="bg-surface border border-line rounded-r shadow-card px-[18px] py-4 mb-[18px]">
              <div className="text-[11px] font-bold tracking-[0.6px] uppercase text-faint mb-[9px]">Your notes</div>
              <textarea
                value={scratch}
                onChange={(e) => onScratch(e.target.value)}
                placeholder="Jot anything — it gets folded into the clean notes."
                className="w-full min-h-[120px] border border-line rounded-[12px] px-[14px] py-3 font-sans text-[14px] leading-[1.55] text-ink resize-none outline-none bg-bg focus:border-indigo focus:bg-surface"
              />
            </div>
            <div className="bg-surface border border-line rounded-r shadow-card p-[18px]">
              <div className="text-[13px] font-bold mb-[3px]">Linked Asana project</div>
              <div className="text-[12.5px] text-muted leading-[1.5] mb-[13px]">
                Connect Asana in Settings to route action items.
              </div>
              {[
                ["Engine", "Cloud · Scribe v2"],
                ["Saved", "On this Mac"],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between text-[13px] py-[9px] border-b border-line-soft last:border-b-0">
                  <span className="text-muted">{k}</span>
                  <span className="font-semibold">{v}</span>
                </div>
              ))}
              <button
                type="button"
                onClick={() => commands.revealNoteFiles(noteId).catch(() => {})}
                className="mt-[11px] w-full text-[12.5px] font-semibold text-indigo hover:text-indigo-deep text-left"
              >
                Show local files (transcript + notes) →
              </button>
            </div>
          </aside>
        </div>
      ) : (
        <Transcript segments={displaySegments} partial={tx.partial} recording={rec.recording} />
      )}

      {asanaOpen && note && (
        <AsanaModal
          noteId={noteId}
          items={note.actionItems}
          onClose={() => setAsanaOpen(false)}
          onSent={reload}
        />
      )}
    </div>
  );
}
