import ActionItems from "./ActionItems";
import { Btn, Seg } from "./ui";
import { AsanaIcon } from "./Icons";
import { isDevanagari } from "../lib/useTranscript";
import type { StoredActionItem, NotesDepth } from "../lib/ipc";

export interface GeneratedDisplay {
  summary: string;
  keyPoints: string[];
  decisions: string[];
  openQuestions: string[];
  model: string;
}

// The AI-cleaned notes body. Renders the persisted generated note (Summary /
// Key points / Decisions) plus the action items (AI + manual), or a generate
// CTA / progress / error.
export default function NotesView({
  generated,
  actionItems,
  generating,
  error,
  canGenerate,
  depth,
  onSetDepth,
  onGenerate,
  onAddActionItem,
  onDeleteActionItem,
  onOpenAsana,
  onExportPdf,
  onEmail,
  exporting,
}: {
  generated: GeneratedDisplay | null;
  actionItems: StoredActionItem[];
  generating: boolean;
  error: string | null;
  canGenerate: boolean;
  depth: NotesDepth;
  onSetDepth: (d: NotesDepth) => void;
  onGenerate: () => void;
  onAddActionItem: (text: string) => void;
  onDeleteActionItem: (id: string) => void;
  onOpenAsana: () => void;
  onExportPdf: () => void;
  onEmail: () => void;
  exporting: boolean;
}) {
  const depthToggle = (
    <Seg
      title="How detailed the AI notes are"
      options={["Concise", "Detailed"]}
      value={depth === "detailed" ? 1 : 0}
      onChange={(i) => onSetDepth(i === 1 ? "detailed" : "concise")}
    />
  );
  const card = "bg-surface border border-line rounded-r shadow-card px-6 py-[22px]";

  if (generating) {
    return (
      <div className={card}>
        <div className="inline-flex items-center gap-[7px] text-[11.5px] font-semibold text-indigo-deep bg-indigo-soft px-3 py-[5px] rounded-[20px] mb-[18px]">
          <span className="w-[6px] h-[6px] rounded-full bg-indigo animate-pulse-dot" />
          Proofreading & summarizing…
        </div>
        <div className="space-y-3">
          {[90, 80, 95, 60].map((w, i) => (
            <div key={i} className="h-[12px] rounded bg-line-soft animate-pulse" style={{ width: `${w}%` }} />
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

  return (
    <div className={card}>
      <div className="flex items-center justify-end mb-[14px]">{depthToggle}</div>
      {generated ? (
        <>
          <div className="inline-flex items-center gap-[7px] text-[11.5px] font-semibold text-indigo-deep bg-indigo-soft px-3 py-[5px] rounded-[20px] mb-[18px]">
            <span className="w-[6px] h-[6px] rounded-full bg-indigo" />
            Proofread & summarized by {modelLabel(generated.model)}
          </div>

          {generated.summary && (
            <>
              <h3 className="text-[14.5px] font-bold mb-[10px]">Summary</h3>
              <p className={`text-[14.5px] leading-[1.62] text-prose mb-[9px] ${isDevanagari(generated.summary) ? "dev" : ""}`}>
                {generated.summary}
              </p>
            </>
          )}

          {generated.keyPoints.length > 0 && (
            <>
              <h3 className="text-[14.5px] font-bold mt-6 mb-[10px]">Key points</h3>
              <ul className="list-none">
                {generated.keyPoints.map((p, i) => <Bullet key={i} text={p} />)}
              </ul>
            </>
          )}

          {generated.decisions.length > 0 && (
            <>
              <h3 className="text-[14.5px] font-bold mt-6 mb-[10px]">Decisions</h3>
              <ul className="list-none">
                {generated.decisions.map((d, i) => <Bullet key={i} text={d} />)}
              </ul>
            </>
          )}

          {generated.openQuestions.length > 0 && (
            <>
              <h3 className="text-[14.5px] font-bold mt-6 mb-[10px]">Open questions</h3>
              <ul className="list-none">
                {generated.openQuestions.map((q, i) => <Bullet key={i} text={q} />)}
              </ul>
            </>
          )}
        </>
      ) : (
        <div className="mb-2">
          <h3 className="text-[15px] font-bold mb-1">No AI notes yet</h3>
          <p className="text-[13.5px] text-muted mb-4 leading-[1.5]">
            {canGenerate
              ? "Fold the transcript and your scratch notes into a clean summary, key points, decisions, and action items."
              : "Record a meeting or jot some notes, then generate clean structured notes here."}
          </p>
          <Btn variant="primary" onClick={onGenerate}>Generate notes</Btn>
        </div>
      )}

      <div className="flex items-center justify-between mt-6 mb-2">
        <h3 className="text-[14.5px] font-bold">Action items</h3>
        {generated && (
          <button type="button" onClick={onGenerate} className="text-[12px] font-semibold text-indigo hover:text-indigo-deep">
            Regenerate
          </button>
        )}
      </div>
      <ActionItems
        items={actionItems.map((a) => ({
          id: a.id,
          text: a.text,
          assignee: a.assignee,
          dueHint: a.dueHint,
          sent: !!a.asanaGid,
        }))}
        onAdd={onAddActionItem}
        onDelete={onDeleteActionItem}
      />

      {actionItems.length > 0 && (
        <div className="mt-4 flex justify-end">
          <Btn variant="lime" onClick={onOpenAsana}>
            <AsanaIcon className="w-[15px] h-[15px]" /> Send action items to Asana
          </Btn>
        </div>
      )}

      {generated && (
        <div className="mt-6 pt-[18px] border-t border-line-soft flex items-center justify-between gap-3">
          <div className="text-[12.5px] text-muted leading-[1.45]">
            Share these notes — export a PDF or email it to the attendees.
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onExportPdf}
              disabled={exporting}
              className="text-[12.5px] font-semibold border border-line rounded-[10px] px-[13px] py-[9px] hover:border-faint disabled:opacity-40"
            >
              {exporting ? "Exporting…" : "Export PDF"}
            </button>
            <Btn variant="primary" onClick={onEmail}>
              Email attendees
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <li className={`text-[14.5px] leading-[1.55] text-prose pl-[18px] relative mb-2 before:content-[''] before:absolute before:left-[3px] before:top-[9px] before:w-[5px] before:h-[5px] before:rounded-full before:bg-indigo ${isDevanagari(text) ? "dev" : ""}`}>
      {text}
    </li>
  );
}

function modelLabel(model: string): string {
  if (model === "gpt-4o-mini") return "GPT-4o mini";
  if (model === "gpt-4o") return "GPT-4o";
  return model || "GPT-4o";
}
