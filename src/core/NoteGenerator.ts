// NoteGenerator — transcript + scratch → structured markdown. Cloud: Claude
// Haiku 4.5 / Sonnet 4.6 (M3). Local: Ollama (M8). Never translates lines.

import type { Segment } from "./Transcriber";

export type AnalysisModel = "claude-haiku-4-5" | "claude-sonnet-4-6";

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
