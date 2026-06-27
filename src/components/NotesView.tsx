import { useState, type ReactNode } from "react";
import ActionItems from "./ActionItems";
import { Btn, Seg } from "./ui";
import { AsanaIcon, ChevronDownIcon } from "./Icons";
import { isDevanagari } from "../lib/useTranscript";
import type { StoredActionItem, NotesDepth } from "../lib/ipc";

export interface GeneratedDisplay {
  summary: string;
  keyPoints: string[];
  decisions: string[];
  openQuestions: string[];
  model: string;
}

// Per-section accent: a small dot colour + a soft count-chip colour. Gives each
// section a glanceable identity (and a bit of life) without shouting. The full
// class literals live here so Tailwind picks them up.
const ACCENT = {
  key: { dot: "before:bg-indigo", chip: "bg-indigo-soft text-indigo-deep" },
  decisions: { dot: "before:bg-green", chip: "bg-green-soft text-green" },
  questions: { dot: "before:bg-amber", chip: "bg-amber-soft text-amber" },
  actions: { dot: "before:bg-indigo", chip: "bg-indigo-soft text-indigo-deep" },
} as const;

// The AI-cleaned notes, styled to read like a calm Granola-style document: a
// short summary leads (clamped if long), everything else lives in collapsible
// sections, and the page runs full-width (no sidebar) so the content breathes.
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
  scratch,
  onScratch,
  onRevealFiles,
  onRetranscribe,
  canRetranscribe,
  retranscribing,
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
  scratch: string;
  onScratch: (v: string) => void;
  onRevealFiles: () => void;
  onRetranscribe: () => void;
  canRetranscribe: boolean;
  retranscribing: boolean;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({
    key: true,
    decisions: false,
    questions: false,
    actions: true,
    scratch: scratch.trim().length > 0,
  });
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  const depthToggle = (
    <Seg
      title="How detailed the AI notes are"
      options={["Concise", "Detailed"]}
      value={depth === "detailed" ? 1 : 0}
      onChange={(i) => onSetDepth(i === 1 ? "detailed" : "concise")}
    />
  );

  const utilities = (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={onRevealFiles}
        className="text-[12px] font-semibold text-faint hover:text-ink"
      >
        Show files
      </button>
      {canRetranscribe && (
        <button
          type="button"
          onClick={onRetranscribe}
          disabled={retranscribing}
          className="text-[12px] font-semibold text-faint hover:text-ink disabled:opacity-40"
        >
          {retranscribing ? "Re-transcribing…" : "Re-transcribe ↻"}
        </button>
      )}
    </div>
  );

  // Your notes (scratch) — a collapsible block so it stops eating a whole
  // sidebar, but stays editable.
  const scratchBlock = (
    <div className="border-t border-line">
      <button
        type="button"
        onClick={() => toggle("scratch")}
        className="w-full flex items-center justify-between py-[15px] group text-left"
      >
        <span className="text-[13.5px] font-bold text-ink">Your notes</span>
        <ChevronDownIcon
          className={`w-4 h-4 text-faint group-hover:text-muted transition-transform ${
            open.scratch ? "" : "-rotate-90"
          }`}
        />
      </button>
      {open.scratch && (
        <textarea
          value={scratch}
          onChange={(e) => onScratch(e.target.value)}
          placeholder="Jot anything — it gets folded into the clean notes when you generate."
          className="w-full min-h-[120px] mb-[18px] border border-line rounded-[12px] px-[14px] py-3 font-sans text-[14px] leading-[1.55] text-ink resize-none outline-none bg-surface focus:border-indigo"
        />
      )}
    </div>
  );

  if (generating) {
    return (
      <div className="pt-1">
        <div className="inline-flex items-center gap-[7px] text-[12px] font-semibold text-indigo-deep mb-5">
          <span className="w-[6px] h-[6px] rounded-full bg-indigo animate-pulse-dot" />
          Proofreading &amp; summarizing…
        </div>
        <div className="space-y-3">
          {[96, 88, 92, 70].map((w, i) => (
            <div key={i} className="h-[12px] rounded bg-line-soft animate-pulse" style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="pt-1">
        <div className="text-[13.5px] text-rec mb-3">Couldn’t generate notes: {error}</div>
        <Btn onClick={onGenerate}>Try again</Btn>
      </div>
    );
  }

  if (!generated) {
    return (
      <div className="pt-[2px]">
        <div className="mb-7">
          <h3 className="text-[15px] font-bold mb-1">No AI notes yet</h3>
          <p className="text-[13.5px] text-muted mb-4 leading-[1.5]">
            {canGenerate
              ? "Fold the transcript and your scratch notes into a clean summary, key points, decisions, and action items."
              : "Record a meeting or jot some notes, then generate clean structured notes here."}
          </p>
          <Btn variant="primary" onClick={onGenerate}>Generate notes</Btn>
        </div>
        {scratchBlock}
      </div>
    );
  }

  const longSummary = generated.summary.length > 320;

  return (
    <div className="pt-[2px] animate-fade">
      <div className="flex items-center justify-end gap-4 mb-[18px]">
        <button
          type="button"
          onClick={onGenerate}
          className="text-[12px] font-semibold text-faint hover:text-indigo"
        >
          Regenerate
        </button>
        {depthToggle}
      </div>

      {/* Summary leads — labelled, larger, higher-contrast, clamped when long. */}
      {generated.summary && (
        <div className="mb-1">
          <h2 className="text-[15px] font-extrabold text-ink mb-[11px]">Summary</h2>
          <p
            className={`text-[16px] leading-[1.72] text-ink/90 ${
              !summaryExpanded && longSummary ? "line-clamp-4" : ""
            } ${isDevanagari(generated.summary) ? "dev" : ""}`}
          >
            {generated.summary}
          </p>
          {longSummary && (
            <button
              type="button"
              onClick={() => setSummaryExpanded((v) => !v)}
              className="mt-[7px] text-[12.5px] font-semibold text-indigo hover:text-indigo-deep"
            >
              {summaryExpanded ? "Show less" : "Show more"}
            </button>
          )}
        </div>
      )}

      <div className="mt-6">
        <CollapsibleSection
          label="Key points"
          count={generated.keyPoints.length}
          chip={ACCENT.key.chip}
          open={open.key}
          onToggle={() => toggle("key")}
        >
          <BulletList items={generated.keyPoints} dot={ACCENT.key.dot} />
        </CollapsibleSection>

        <CollapsibleSection
          label="Decisions"
          count={generated.decisions.length}
          chip={ACCENT.decisions.chip}
          open={open.decisions}
          onToggle={() => toggle("decisions")}
        >
          <BulletList items={generated.decisions} dot={ACCENT.decisions.dot} />
        </CollapsibleSection>

        <CollapsibleSection
          label="Open questions"
          count={generated.openQuestions.length}
          chip={ACCENT.questions.chip}
          open={open.questions}
          onToggle={() => toggle("questions")}
        >
          <BulletList items={generated.openQuestions} dot={ACCENT.questions.dot} />
        </CollapsibleSection>

        <CollapsibleSection
          label="Action items"
          count={actionItems.length}
          chip={ACCENT.actions.chip}
          open={open.actions}
          onToggle={() => toggle("actions")}
        >
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
            <div className="mt-3 flex justify-end">
              <Btn variant="lime" onClick={onOpenAsana}>
                <AsanaIcon className="w-[15px] h-[15px]" /> Send to Asana
              </Btn>
            </div>
          )}
        </CollapsibleSection>

        {scratchBlock}
      </div>

      <div className="mt-6 pt-4 border-t border-line-soft flex items-center justify-between gap-3">
        {utilities}
        <div className="flex items-center gap-2">
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
    </div>
  );
}

function CollapsibleSection({
  label,
  count,
  chip,
  open,
  onToggle,
  children,
}: {
  label: string;
  count: number;
  chip: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="border-t border-line first:border-t-0">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between py-[15px] group text-left"
      >
        <span className="flex items-center gap-[10px]">
          <span className="text-[13.5px] font-bold text-ink">{label}</span>
          <span
            className={`text-[11px] font-bold rounded-full min-w-[19px] h-[19px] px-[6px] inline-flex items-center justify-center ${chip}`}
          >
            {count}
          </span>
        </span>
        <ChevronDownIcon
          className={`w-4 h-4 text-faint group-hover:text-muted transition-transform ${
            open ? "" : "-rotate-90"
          }`}
        />
      </button>
      {open && <div className="pb-[20px] -mt-[2px]">{children}</div>}
    </div>
  );
}

function BulletList({ items, dot }: { items: string[]; dot: string }) {
  return (
    <ul className="list-none">
      {items.map((t, i) => (
        <li
          key={i}
          className={`text-[14.5px] leading-[1.62] text-prose pl-[20px] relative mb-[10px] last:mb-0 before:content-[''] before:absolute before:left-[1px] before:top-[8px] before:w-[6px] before:h-[6px] before:rounded-full ${dot} ${
            isDevanagari(t) ? "dev" : ""
          }`}
        >
          {t}
        </li>
      ))}
    </ul>
  );
}
