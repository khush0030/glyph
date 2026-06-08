import ActionItems from "./ActionItems";
import { Btn } from "./ui";
import { AsanaIcon } from "./Icons";
import { isDevanagari } from "../lib/useTranscript";
import type { GeneratedNote } from "../lib/ipc";

// The AI-cleaned notes body. Renders a generated note (Summary / Key points /
// Decisions / structured Action items), or a generate CTA / progress / error.
export default function NotesView({
  note,
  generating,
  error,
  canGenerate,
  onGenerate,
  onOpenAsana,
}: {
  note: GeneratedNote | null;
  generating: boolean;
  error: string | null;
  canGenerate: boolean;
  onGenerate: () => void;
  onOpenAsana: () => void;
}) {
  const card =
    "bg-surface border border-line rounded-r shadow-card px-6 py-[22px]";

  if (generating) {
    return (
      <div className={card}>
        <div className="inline-flex items-center gap-[7px] text-[11.5px] font-semibold text-indigo-deep bg-indigo-soft px-3 py-[5px] rounded-[20px] mb-[18px]">
          <span className="w-[6px] h-[6px] rounded-full bg-indigo animate-pulse-dot" />
          Cleaning with Claude…
        </div>
        <div className="space-y-3">
          {[90, 80, 95, 60].map((w, i) => (
            <div
              key={i}
              className="h-[12px] rounded bg-line-soft animate-pulse"
              style={{ width: `${w}%` }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={card}>
        <div className="text-[13.5px] text-rec mb-3">Couldn’t generate notes: {error}</div>
        <Btn onClick={onGenerate}>Try again</Btn>
      </div>
    );
  }

  if (!note) {
    return (
      <div className={card}>
        <h3 className="text-[15px] font-bold mb-1">No notes yet</h3>
        <p className="text-[13.5px] text-muted mb-4 leading-[1.5]">
          {canGenerate
            ? "Fold the transcript and your scratch notes into a clean summary, key points, decisions, and action items."
            : "Record a meeting or jot some notes, then generate clean structured notes here."}
        </p>
        <Btn variant="primary" onClick={onGenerate} >
          Generate notes
        </Btn>
      </div>
    );
  }

  return (
    <div className={card}>
      <div className="inline-flex items-center gap-[7px] text-[11.5px] font-semibold text-indigo-deep bg-indigo-soft px-3 py-[5px] rounded-[20px] mb-[18px]">
        <span className="w-[6px] h-[6px] rounded-full bg-indigo" />
        Cleaned by {modelLabel(note.model)} · language preserved
      </div>

      {note.summary && (
        <>
          <h3 className="text-[14.5px] font-bold mb-[10px]">Summary</h3>
          <p
            className={`text-[14.5px] leading-[1.62] text-[#3b3850] mb-[9px] ${
              isDevanagari(note.summary) ? "dev" : ""
            }`}
          >
            {note.summary}
          </p>
        </>
      )}

      {note.keyPoints.length > 0 && (
        <>
          <h3 className="text-[14.5px] font-bold mt-6 mb-[10px]">Key points</h3>
          <ul className="list-none">
            {note.keyPoints.map((p, i) => (
              <Bullet key={i} text={p} />
            ))}
          </ul>
        </>
      )}

      {note.decisions.length > 0 && (
        <>
          <h3 className="text-[14.5px] font-bold mt-6 mb-[10px]">Decisions</h3>
          <ul className="list-none">
            {note.decisions.map((d, i) => (
              <Bullet key={i} text={d} />
            ))}
          </ul>
        </>
      )}

      <div className="flex items-center justify-between mt-6 mb-2">
        <h3 className="text-[14.5px] font-bold">Action items</h3>
        <button
          onClick={onGenerate}
          className="text-[12px] font-semibold text-indigo hover:text-indigo-deep"
        >
          Regenerate
        </button>
      </div>
      <ActionItems
        items={note.actionItems.map((a) => ({
          text: a.text,
          assignee: a.assignee,
          due: a.dueHint,
        }))}
      />

      {note.actionItems.length > 0 && (
        <div className="mt-4 flex justify-end">
          <Btn variant="lime" onClick={onOpenAsana}>
            <AsanaIcon className="w-[15px] h-[15px]" /> Send action items to Asana
          </Btn>
        </div>
      )}
    </div>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <li
      className={`text-[14.5px] leading-[1.55] text-[#3b3850] pl-[18px] relative mb-2 before:content-[''] before:absolute before:left-[3px] before:top-[9px] before:w-[5px] before:h-[5px] before:rounded-full before:bg-indigo ${
        isDevanagari(text) ? "dev" : ""
      }`}
    >
      {text}
    </li>
  );
}

function modelLabel(model: string): string {
  if (model.includes("sonnet")) return "Claude Sonnet 4.6";
  if (model.includes("haiku")) return "Claude Haiku 4.5";
  return model || "Claude";
}
