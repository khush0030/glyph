// NoteGenerator — transcript + scratch → structured markdown. Cloud: OpenAI
// GPT-4o (M3, two-pass: proofread then summarize). Local: Ollama (M8). Never
// translates lines.

import type { Segment } from "./Transcriber";

export type AnalysisModel = "gpt-4o-mini" | "gpt-4o";

export interface ActionItem {
  text: string;
  /** Inferred assignee name, mapped to an Asana user later. */
  assignee?: string;
  /** Natural-language due hint, e.g. "Fri", "next week". */
  dueHint?: string;
}

export interface GeneratedNote {
  /** Full markdown: Summary / Key points / Decisions / Action items. */
  markdown: string;
  /** Structured action items parsed out for Asana export. */
  actionItems: ActionItem[];
  model: AnalysisModel;
}

export interface NoteGenerator {
  generate(input: {
    segments: Segment[];
    scratch: string;
    model: AnalysisModel;
  }): Promise<GeneratedNote>;
}
