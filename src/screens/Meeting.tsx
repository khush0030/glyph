import { useCallback, useEffect, useRef, useState } from "react";
import { Seg } from "../components/ui";
import RecordButton from "../components/RecordButton";
import NotesView from "../components/NotesView";
import Transcript from "../components/Transcript";
import AsanaModal from "../components/AsanaModal";
import { useRecording } from "../lib/useRecording";
import { useTranscript } from "../lib/useTranscript";
import { commands, type GeneratedNote } from "../lib/ipc";

type Tab = "notes" | "transcript";

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function Meeting({ recording }: { recording: boolean }) {
  const [tab, setTab] = useState<Tab>("notes");
  const [asanaOpen, setAsanaOpen] = useState(false);
  const [title, setTitle] = useState("Untitled meeting");
  const [scratch, setScratch] = useState("");

  const [note, setNote] = useState<GeneratedNote | null>(null);
  const [generating, setGenerating] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  const rec = useRecording();
  const tx = useTranscript(true);

  const transcriptText = tx.segments.map((s) => s.text).join("\n");
  const canGenerate = transcriptText.trim().length > 0 || scratch.trim().length > 0;

  const generate = useCallback(async () => {
    setGenerating(true);
    setNoteError(null);
    try {
      const g = await commands.generateNotes(transcriptText, scratch);
      setNote(g);
      setTab("notes");
    } catch (e) {
      setNoteError(String(e));
    } finally {
      setGenerating(false);
    }
  }, [transcriptText, scratch]);

  // Auto-start a real recording when opened in record mode.
  const started = useRef(false);
  useEffect(() => {
    if (recording && !started.current) {
      started.current = true;
      tx.reset();
      rec.start();
    }
  }, [recording, rec, tx]);

  // Stop recording, then fold the transcript + scratch into notes.
  const handleStop = useCallback(async () => {
    await rec.stop();
    if (tx.segments.length > 0 || scratch.trim()) {
      generate();
    }
  }, [rec, tx.segments.length, scratch, generate]);

  return (
    <div className="animate-fade">
      <div className="flex items-start justify-between gap-5 mb-[22px]">
        <div className="flex-1">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            spellCheck={false}
            aria-label="Meeting title"
            className="text-[24px] font-extrabold tracking-[-0.7px] border-none bg-transparent text-ink w-full outline-none"
          />
          <div className="text-[13px] text-faint mt-[5px]">
            {rec.recording ? (
              <>
                <span className="text-rec font-semibold">
                  ● Recording {fmt(rec.elapsed)}
                </span>{" "}
                · mic + system audio
              </>
            ) : rec.error ? (
              <span className="text-rec">Couldn’t start recording: {rec.error}</span>
            ) : rec.wavPath ? (
              <>Saved · audio on this Mac</>
            ) : (
              "Manual note · not recording"
            )}
          </div>
        </div>
        <div className="flex items-center gap-[9px] shrink-0">
          <Seg title="Language" options={["Auto", <span className="dev">हिं</span>, "EN"]} />
          <Seg title="Engine" options={["Cloud", "Private"]} />
          {rec.recording && <RecordButton onStop={handleStop} />}
        </div>
      </div>

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
            {t === "notes" && note && (
              <span className="text-[10px] bg-indigo-soft text-indigo-deep rounded-[20px] px-[7px] py-[1px] font-bold">
                AI
              </span>
            )}
            {t === "transcript" && tx.segments.length > 0 && (
              <span className="text-[10px] bg-line-soft text-muted rounded-[20px] px-[7px] py-[1px] font-bold">
                {tx.segments.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "notes" ? (
        <div className="grid grid-cols-[1fr_312px] gap-[22px] items-start">
          <NotesView
            note={note}
            generating={generating}
            error={noteError}
            canGenerate={canGenerate}
            onGenerate={generate}
            onOpenAsana={() => setAsanaOpen(true)}
          />
          <aside>
            <div className="bg-surface border border-line rounded-r shadow-card px-[18px] py-4 mb-[18px]">
              <div className="text-[11px] font-bold tracking-[0.6px] uppercase text-faint mb-[9px]">
                Your notes
              </div>
              <textarea
                value={scratch}
                onChange={(e) => setScratch(e.target.value)}
                placeholder={"Jot anything — it gets folded into the clean notes."}
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
                <div
                  key={k}
                  className="flex items-center justify-between text-[13px] py-[9px] border-b border-line-soft last:border-b-0"
                >
                  <span className="text-muted">{k}</span>
                  <span className="font-semibold">{v}</span>
                </div>
              ))}
            </div>
          </aside>
        </div>
      ) : (
        <Transcript
          segments={tx.segments}
          partial={tx.partial}
          recording={rec.recording}
        />
      )}

      {asanaOpen && (
        <AsanaModal
          items={note?.actionItems ?? []}
          onClose={() => setAsanaOpen(false)}
        />
      )}
    </div>
  );
}
