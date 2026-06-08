import { useEffect, useRef, useState } from "react";
import { Seg } from "../components/ui";
import RecordButton from "../components/RecordButton";
import NotesView from "../components/NotesView";
import Transcript from "../components/Transcript";
import AsanaModal from "../components/AsanaModal";
import { ChevronDownIcon } from "../components/Icons";
import { useRecording } from "../lib/useRecording";
import { useTranscript } from "../lib/useTranscript";

type Tab = "notes" | "transcript";

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function Meeting({ recording }: { recording: boolean }) {
  const [tab, setTab] = useState<Tab>("notes");
  const [asanaOpen, setAsanaOpen] = useState(false);
  const [title, setTitle] = useState("Sarthak Singapore — Priya review");

  const rec = useRecording();
  const tx = useTranscript(true);
  // Auto-start a real recording when the meeting is opened in record mode.
  const started = useRef(false);
  useEffect(() => {
    if (recording && !started.current) {
      started.current = true;
      tx.reset();
      rec.start();
    }
  }, [recording, rec, tx]);

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
                <span
                  className="text-rec font-semibold"
                  style={{ opacity: 0.5 + Math.min(0.5, rec.level * 6) }}
                >
                  ● Recording {fmt(rec.elapsed)}
                </span>{" "}
                · mic + system audio
              </>
            ) : rec.error ? (
              <span className="text-rec">Couldn’t start recording: {rec.error}</span>
            ) : rec.wavPath ? (
              <>Saved · {rec.wavPath}</>
            ) : (
              "Manual note · not recording"
            )}
          </div>
        </div>
        <div className="flex items-center gap-[9px] shrink-0">
          <Seg
            title="Language"
            options={["Auto", <span className="dev">हिं</span>, "EN"]}
          />
          <Seg title="Engine" options={["Cloud", "Private"]} />
          {rec.recording && <RecordButton onStop={rec.stop} />}
        </div>
      </div>

      <div className="flex gap-[26px] border-b border-line mb-[22px]">
        {(["notes", "transcript"] as Tab[]).map((t) => (
          <div
            key={t}
            onClick={() => setTab(t)}
            className={`text-[14px] font-semibold pb-3 px-[2px] cursor-pointer border-b-2 transition-[0.14s] flex items-center gap-[7px] ${
              tab === t
                ? "text-ink border-indigo"
                : "text-faint border-transparent"
            }`}
          >
            {t === "notes" ? "Notes" : "Transcript"}
            {t === "notes" && (
              <span className="text-[10px] bg-indigo-soft text-indigo-deep rounded-[20px] px-[7px] py-[1px] font-bold">
                AI
              </span>
            )}
            {t === "transcript" && tx.segments.length > 0 && (
              <span className="text-[10px] bg-line-soft text-muted rounded-[20px] px-[7px] py-[1px] font-bold">
                {tx.segments.length}
              </span>
            )}
          </div>
        ))}
      </div>

      {tab === "notes" ? (
        <div className="grid grid-cols-[1fr_312px] gap-[22px] items-start">
          <NotesView onOpenAsana={() => setAsanaOpen(true)} />
          <aside>
            <div className="bg-surface border border-line rounded-r shadow-card px-[18px] py-4 mb-[18px]">
              <div className="text-[11px] font-bold tracking-[0.6px] uppercase text-faint mb-[9px]">
                Your notes
              </div>
              <textarea
                placeholder={
                  "Jot anything — it gets folded into the clean notes.\n\n– lock model choice this week\n– Cal.com test before Fri"
                }
                className="w-full min-h-[120px] border border-line rounded-[12px] px-[14px] py-3 font-sans text-[14px] leading-[1.55] text-ink resize-none outline-none bg-bg focus:border-indigo focus:bg-surface"
              />
            </div>
            <div className="bg-surface border border-line rounded-r shadow-card p-[18px]">
              <div className="text-[13px] font-bold mb-[3px]">
                Linked Asana project
              </div>
              <div className="text-[12.5px] text-muted leading-[1.5] mb-[13px]">
                Action items route here when sent.
              </div>
              <div className="w-full border border-line rounded-[11px] px-[13px] py-[10px] text-[13.5px] font-semibold bg-bg flex items-center justify-between cursor-pointer mb-3">
                Sarthak Singapore
                <ChevronDownIcon className="w-[15px] h-[15px]" />
              </div>
              {[
                ["Type", "Client"],
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

      {asanaOpen && <AsanaModal onClose={() => setAsanaOpen(false)} />}
    </div>
  );
}
