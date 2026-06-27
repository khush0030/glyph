// Builds a clean, shareable PDF of a meeting's notes entirely in the webview,
// then returns it as standard base64 for the Rust side to save / attach. Vector
// text + shapes (not a screenshot) so it stays crisp and small. The layout is
// designed to be skimmed: a colored header band, at-a-glance stat cards, a
// highlighted summary, and tinted cards for decisions / questions / actions.
import { jsPDF } from "jspdf";
import type { NoteDetail } from "./ipc";

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtDuration(sec: number): string | null {
  if (!sec || sec < 1) return null;
  const m = Math.round(sec / 60);
  if (m < 1) return "<1 min";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h}h ${mm}m` : `${h}h`;
}

type RGB = [number, number, number];
const INDIGO: RGB = [79, 70, 229];
const INDIGO_DEEP: RGB = [70, 54, 174];
const MARK_BG: RGB = [36, 28, 69]; // logo tile (#241C45)
const INK: RGB = [26, 24, 35];
const MUTED: RGB = [108, 105, 121];
const LIME: RGB = [198, 242, 78];
const WHITE: RGB = [255, 255, 255];
const SURFACE: RGB = [244, 243, 248];
const INDIGO_TINT: RGB = [239, 237, 252];
const BORDER: RGB = [224, 222, 236];
const GREEN: RGB = [47, 158, 107];
const GREEN_TINT: RGB = [232, 246, 239];
const AMBER: RGB = [199, 125, 24];
const AMBER_TINT: RGB = [251, 241, 224];

const MARGIN = 56;
const PAGE_W = 595.28; // A4 pt
const PAGE_H = 841.89;
const CONTENT_W = PAGE_W - MARGIN * 2;
const HEADER_H = 104;

function modelLabel(model: string): string {
  if (model === "gpt-4o-mini") return "GPT-4o mini";
  if (model === "gpt-4o") return "GPT-4o";
  return model || "GPT-4o";
}

export function buildNotePdfBase64(note: NoteDetail): string {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const g = note.generated;
  let y = MARGIN;

  const ensure = (need: number) => {
    if (y + need > PAGE_H - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
  };

  // ---- Header band (full-bleed indigo) -----------------------------------
  doc.setFillColor(...INDIGO);
  doc.rect(0, 0, PAGE_W, HEADER_H, "F");
  // lime accent rule along the bottom of the band
  doc.setFillColor(...LIME);
  doc.rect(0, HEADER_H - 4, PAGE_W, 4, "F");

  // Wordmark, top-right.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...LIME);
  doc.text("GLYPH", PAGE_W - MARGIN, MARGIN - 14, { align: "right" });

  // Title (max 2 lines), white.
  doc.setTextColor(...WHITE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  const titleLines = doc
    .splitTextToSize(note.title.trim() || "Untitled meeting", CONTENT_W - 80)
    .slice(0, 2);
  let ty = MARGIN - 14;
  for (const line of titleLines) {
    doc.text(line, MARGIN, ty);
    ty += 24;
  }
  // Date, lighter.
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(214, 211, 248);
  doc.text(fmtDate(note.createdAt), MARGIN, ty + 2);

  y = HEADER_H + 26;

  // ---- Stat cards --------------------------------------------------------
  const stats: { v: string; l: string }[] = [];
  const dur = fmtDuration(note.durationSec);
  if (dur) stats.push({ v: dur, l: "Duration" });
  if (g) {
    stats.push({ v: String(g.keyPoints.length), l: g.keyPoints.length === 1 ? "Key point" : "Key points" });
    stats.push({ v: String(g.decisions.length), l: g.decisions.length === 1 ? "Decision" : "Decisions" });
  }
  stats.push({
    v: String(note.actionItems.length),
    l: note.actionItems.length === 1 ? "Action item" : "Action items",
  });
  const cards = stats.slice(0, 4);
  if (cards.length) {
    const gap = 12;
    const cardW = (CONTENT_W - gap * (cards.length - 1)) / cards.length;
    const cardH = 50;
    ensure(cardH + 10);
    cards.forEach((s, i) => {
      const x = MARGIN + i * (cardW + gap);
      doc.setFillColor(...SURFACE);
      doc.setDrawColor(...BORDER);
      doc.setLineWidth(0.5);
      doc.roundedRect(x, y, cardW, cardH, 7, 7, "FD");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.setTextColor(...INDIGO_DEEP);
      doc.text(s.v, x + cardW / 2, y + 24, { align: "center" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...MUTED);
      doc.text(s.l.toUpperCase(), x + cardW / 2, y + 39, { align: "center" });
    });
    y += cardH + 8;
  }

  // ---- Section heading (with lime accent tick) ---------------------------
  const heading = (label: string) => {
    ensure(40);
    y += 16;
    doc.setFillColor(...LIME);
    doc.roundedRect(MARGIN, y - 9, 4, 12, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...INK);
    doc.text(label, MARGIN + 12, y);
    y += 16;
  };

  const paragraph = (text: string, color: RGB = INK) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(text, CONTENT_W);
    for (const line of lines) {
      ensure(16);
      doc.text(line, MARGIN, y);
      y += 16;
    }
  };

  // Soft full-width callout box (used for the summary).
  const callout = (text: string) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    const innerW = CONTENT_W - 36;
    const lines = doc.splitTextToSize(text, innerW);
    const boxH = lines.length * 16 + 22;
    ensure(boxH + 4);
    doc.setFillColor(...INDIGO_TINT);
    doc.roundedRect(MARGIN, y, CONTENT_W, boxH, 8, 8, "F");
    doc.setFillColor(...INDIGO);
    doc.roundedRect(MARGIN, y, 5, boxH, 2, 2, "F");
    doc.setTextColor(...INK);
    let ly = y + 22;
    for (const line of lines) {
      doc.text(line, MARGIN + 20, ly);
      ly += 16;
    }
    y += boxH + 4;
  };

  // Plain bullets with an indigo dot (key points).
  const bullets = (items: string[]) => {
    doc.setFontSize(11);
    for (const item of items) {
      const lines = doc.splitTextToSize(item, CONTENT_W - 18);
      lines.forEach((line: string, i: number) => {
        ensure(16);
        if (i === 0) {
          doc.setFillColor(...INDIGO);
          doc.circle(MARGIN + 3, y - 3, 2, "F");
        }
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...INK);
        doc.text(line, MARGIN + 18, y);
        y += 16;
      });
      y += 4;
    }
  };

  // Tinted cards with a colored marker (decisions / open questions).
  const markerCards = (items: string[], accent: RGB, tint: RGB, mark: string) => {
    doc.setFontSize(11);
    for (const item of items) {
      const innerW = CONTENT_W - 46;
      const lines = doc.splitTextToSize(item, innerW);
      const boxH = lines.length * 15 + 16;
      ensure(boxH + 6);
      doc.setFillColor(...tint);
      doc.roundedRect(MARGIN, y, CONTENT_W, boxH, 7, 7, "F");
      // marker badge
      doc.setFillColor(...accent);
      doc.circle(MARGIN + 18, y + boxH / 2, 8, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(...WHITE);
      doc.text(mark, MARGIN + 18, y + boxH / 2 + 3.5, { align: "center" });
      // text
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.setTextColor(...INK);
      let ly = y + 17;
      for (const line of lines) {
        doc.text(line, MARGIN + 36, ly);
        ly += 15;
      }
      y += boxH + 6;
    }
  };

  // Small rounded pill, returns the x at which the next pill should start.
  const pill = (text: string, x: number, baseY: number, fg: RGB, bg: RGB): number => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    const w = doc.getTextWidth(text) + 14;
    doc.setFillColor(...bg);
    doc.roundedRect(x, baseY - 9, w, 13, 6, 6, "F");
    doc.setTextColor(...fg);
    doc.text(text, x + 7, baseY);
    return x + w + 6;
  };

  // Action items as a checklist with assignee / due pills.
  const checklist = (
    items: { text: string; assignee?: string; dueHint?: string }[]
  ) => {
    for (const a of items) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      const lines = doc.splitTextToSize(a.text, CONTENT_W - 26);
      const hasMeta = Boolean(a.assignee || a.dueHint);
      const blockH = lines.length * 15 + (hasMeta ? 18 : 0) + 8;
      ensure(blockH);
      // checkbox
      doc.setDrawColor(...INDIGO);
      doc.setLineWidth(1.2);
      doc.roundedRect(MARGIN, y - 9, 11, 11, 2, 2, "S");
      // text
      doc.setTextColor(...INK);
      lines.forEach((line: string) => {
        doc.text(line, MARGIN + 24, y);
        y += 15;
      });
      // meta pills
      if (hasMeta) {
        let px = MARGIN + 24;
        if (a.assignee) px = pill(a.assignee, px, y, WHITE, INDIGO);
        if (a.dueHint) pill(`Due ${a.dueHint}`, px, y, AMBER, AMBER_TINT);
        y += 18;
      }
      y += 8;
    }
  };

  // ---- Body --------------------------------------------------------------
  if (g?.summary) {
    heading("Summary");
    callout(g.summary);
  }
  if (g && g.keyPoints.length) {
    heading("Key points");
    bullets(g.keyPoints);
  }
  if (g && g.decisions.length) {
    heading("Decisions");
    markerCards(g.decisions, GREEN, GREEN_TINT, "D");
  }
  if (g && g.openQuestions.length) {
    heading("Open questions");
    markerCards(g.openQuestions, AMBER, AMBER_TINT, "?");
  }
  if (note.actionItems.length) {
    heading("Action items");
    checklist(note.actionItems);
  }
  if (note.scratch.trim()) {
    heading("Your notes");
    paragraph(note.scratch.trim(), MUTED);
  }

  // ---- Footer on every page ---------------------------------------------
  const foot = g?.model
    ? `Generated by Glyph · proofread & summarized by ${modelLabel(g.model)}`
    : "Generated by Glyph";
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, PAGE_H - 42, PAGE_W - MARGIN, PAGE_H - 42);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(foot, MARGIN, PAGE_H - 28);
    doc.setFont("helvetica", "normal");
    doc.text(`${p} / ${pages}`, PAGE_W - MARGIN, PAGE_H - 28, { align: "right" });
  }

  // datauristring → strip the "data:application/pdf;base64," prefix.
  const uri = doc.output("datauristring");
  return uri.slice(uri.indexOf(",") + 1);
}
