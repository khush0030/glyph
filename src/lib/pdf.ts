// Builds a clean, shareable PDF of a meeting's notes entirely in the webview,
// then returns it as standard base64 for the Rust side to save / attach. Vector
// text + shapes (not a screenshot) so it stays crisp and small.
//
// Design language: editorial-minimal. A colored header band carries the brand
// lockup; the body uses generous whitespace, uppercase tracked section labels
// with hairline rules, one unified stat strip, a highlighted summary, and
// restrained left-accent cards for decisions / questions / action items.
import { jsPDF } from "jspdf";
import type { NoteDetail } from "./ipc";
import { avatarFor } from "./avatar";

// "#5A4BD4" → [90, 75, 212] for jsPDF's channel-based colour setters.
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

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
const MUTED: RGB = [122, 119, 138];
const FAINT: RGB = [150, 147, 165];
const LIME: RGB = [198, 242, 78];
const WHITE: RGB = [255, 255, 255];
const SURFACE: RGB = [247, 246, 251];
const INDIGO_TINT: RGB = [238, 236, 252];
const BORDER: RGB = [228, 226, 238];
const GREEN: RGB = [47, 158, 107];
const GREEN_TINT: RGB = [236, 247, 241];
const AMBER: RGB = [199, 125, 24];
const AMBER_TINT: RGB = [252, 244, 230];
const LILAC: RGB = [214, 211, 248];

const MARGIN = 54;
const PAGE_W = 595.28; // A4 pt
const PAGE_H = 841.89;
const CONTENT_W = PAGE_W - MARGIN * 2;
const HEADER_H = 122;

export function buildNotePdfBase64(note: NoteDetail): string {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const g = note.generated;
  let y = MARGIN;

  const ensure = (need: number) => {
    if (y + need > PAGE_H - MARGIN - 24) {
      doc.addPage();
      y = MARGIN + 6;
    }
  };

  // ---- Header band (full-bleed indigo) -----------------------------------
  doc.setFillColor(...INDIGO);
  doc.rect(0, 0, PAGE_W, HEADER_H, "F");
  doc.setFillColor(...LIME); // lime hairline along the bottom of the band
  doc.rect(0, HEADER_H - 3, PAGE_W, 3, "F");

  // Brand lockup, top-left: logo tile (rounded square + lime ring) + wordmark.
  const ms = 26;
  const mx = MARGIN;
  const my = 26;
  doc.setFillColor(...MARK_BG);
  doc.roundedRect(mx, my, ms, ms, 8, 8, "F");
  doc.setDrawColor(...LIME);
  doc.setLineWidth(2.4);
  doc.circle(mx + ms / 2, my + ms / 2, ms * 0.24, "S");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...WHITE);
  doc.text("Glyph", mx + ms + 10, my + ms - 8);

  // Eyebrow, top-right.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...LIME);
  doc.text("MEETING NOTES", PAGE_W - MARGIN, my + 12, { align: "right", charSpace: 1.6 });

  // Title (max 2 lines), white.
  doc.setTextColor(...WHITE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(19);
  const titleLines = doc
    .splitTextToSize(note.title.trim() || "Untitled meeting", CONTENT_W)
    .slice(0, 2);
  let ty = my + ms + 28;
  for (const line of titleLines) {
    doc.text(line, MARGIN, ty);
    ty += 22;
  }
  // Date, lighter.
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...LILAC);
  doc.text(fmtDate(note.createdAt), MARGIN, ty + 1);

  y = HEADER_H + 30;

  // ---- Stat strip (single unified bar with hairline dividers) ------------
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
    const h = 60;
    ensure(h + 8);
    doc.setFillColor(...SURFACE);
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.5);
    doc.roundedRect(MARGIN, y, CONTENT_W, h, 10, 10, "FD");
    const colW = CONTENT_W / cards.length;
    cards.forEach((s, i) => {
      const cx = MARGIN + colW * i + colW / 2;
      if (i > 0) {
        doc.setDrawColor(...BORDER);
        doc.setLineWidth(0.5);
        doc.line(MARGIN + colW * i, y + 16, MARGIN + colW * i, y + h - 16);
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.setTextColor(...INDIGO_DEEP);
      doc.text(s.v, cx, y + 30, { align: "center" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...MUTED);
      doc.text(s.l.toUpperCase(), cx, y + 45, { align: "center", charSpace: 1 });
    });
    y += h;
  }

  // ---- Section label: uppercase, tracked, with a trailing hairline rule ---
  // Reserve room for the label *and* the first slice of its content so a
  // section label never sits alone at the bottom of a page (widow).
  const heading = (label: string) => {
    y += 26;
    ensure(64);
    const up = label.toUpperCase();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...INDIGO);
    doc.text(up, MARGIN, y, { charSpace: 1.5 });
    const lw = doc.getTextWidth(up) + up.length * 1.5;
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.5);
    doc.line(MARGIN + lw + 12, y - 3, PAGE_W - MARGIN, y - 3);
    y += 18;
  };

  // Summary hero — light tint card with an indigo accent bar.
  const callout = (text: string) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11.5);
    const innerW = CONTENT_W - 36;
    const lines = doc.splitTextToSize(text, innerW);
    const boxH = lines.length * 16 + 26;
    ensure(boxH + 4);
    doc.setFillColor(...INDIGO_TINT);
    doc.roundedRect(MARGIN, y, CONTENT_W, boxH, 10, 10, "F");
    doc.setFillColor(...INDIGO);
    doc.rect(MARGIN + 1, y + 9, 3, boxH - 18, "F");
    doc.setTextColor(...INK);
    let ly = y + 25;
    for (const line of lines) {
      doc.text(line, MARGIN + 22, ly);
      ly += 16;
    }
    y += boxH;
  };

  // Key points — small indigo dot markers, generous line height.
  const bullets = (items: string[]) => {
    doc.setFontSize(11);
    for (const item of items) {
      doc.setFont("helvetica", "normal");
      const lines = doc.splitTextToSize(item, CONTENT_W - 20);
      // Reserve the whole item so a single key point never splits across a
      // page (which would leave its tail orphaned without a bullet dot).
      ensure(lines.length * 16 + 5);
      doc.setFillColor(...INDIGO);
      doc.circle(MARGIN + 3, y - 3, 2, "F");
      doc.setTextColor(...INK);
      lines.forEach((line: string) => {
        doc.text(line, MARGIN + 18, y);
        y += 16;
      });
      y += 5;
    }
  };

  // Decisions / open questions — restrained left-accent cards with a round
  // badge that names the card's role: a drawn check for decisions ("resolved"),
  // a "?" for open questions ("unresolved"). `badge: null` = plain text card.
  const accentCards = (
    items: string[],
    accent: RGB,
    tint: RGB,
    badge: "check" | "q" | null
  ) => {
    const padL = badge ? 40 : 22;
    for (const item of items) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      const lines = doc.splitTextToSize(item, CONTENT_W - padL - 16);
      const boxH = Math.max(lines.length * 15 + 16, badge ? 34 : 0);
      ensure(boxH + 8);
      doc.setFillColor(...tint);
      doc.roundedRect(MARGIN, y, CONTENT_W, boxH, 9, 9, "F");
      doc.setFillColor(...accent);
      doc.rect(MARGIN + 1, y + 8, 3, boxH - 16, "F");
      if (badge) {
        const cx = MARGIN + 23;
        const cy = y + boxH / 2;
        doc.setFillColor(...accent);
        doc.circle(cx, cy, 7.5, "F");
        if (badge === "check") {
          doc.setDrawColor(...WHITE);
          doc.setLineWidth(1.3);
          doc.lines([[2, 2.4], [3.6, -5]], cx - 2.6, cy + 0.4); // ✓ two strokes
        } else {
          doc.setFont("helvetica", "bold");
          doc.setFontSize(11);
          doc.setTextColor(...WHITE);
          doc.text("?", cx, cy + 3.6, { align: "center" });
        }
      }
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.setTextColor(...INK);
      let ly = y + 17;
      for (const line of lines) {
        doc.text(line, MARGIN + padL, ly);
        ly += 15;
      }
      y += boxH + 8;
    }
  };

  // Person avatar — filled initial circle in the person's deterministic colour
  // (same palette the app uses), so assignees look consistent everywhere.
  const drawAvatar = (name: string, cx: number, cy: number, r: number) => {
    const trimmed = name.trim();
    doc.setFillColor(...(trimmed ? hexToRgb(avatarFor(trimmed).color) : FAINT));
    doc.circle(cx, cy, r, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(r * 1.05);
    doc.setTextColor(...WHITE);
    doc.text(trimmed ? avatarFor(trimmed).initial : "?", cx, cy + r * 0.36, { align: "center" });
  };

  // Due chip — a light amber pill with a leading dot. Soft, not alarming.
  const dueChip = (text: string, x: number, baseY: number) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    const w = doc.getTextWidth(text) + 20;
    doc.setFillColor(...AMBER_TINT);
    doc.roundedRect(x, baseY - 9, w, 14, 7, 7, "F");
    doc.setFillColor(...AMBER);
    doc.circle(x + 8, baseY - 2, 2, "F");
    doc.setTextColor(...AMBER);
    doc.text(text, x + 14, baseY);
  };

  // Action items grouped by assignee — a clear "who does what" breakdown. Each
  // person is a header (avatar + name + task count); their tasks sit beneath as
  // checkboxes with optional due chips. Unassigned tasks come last.
  const actionsByPerson = (
    items: { text: string; assignee?: string; dueHint?: string }[]
  ) => {
    const UNASSIGNED = " unassigned";
    const order: string[] = [];
    const groups = new Map<string, { name: string; items: typeof items }>();
    for (const it of items) {
      const name = (it.assignee || "").trim();
      const key = name || UNASSIGNED;
      if (!groups.has(key)) {
        groups.set(key, { name, items: [] });
        order.push(key);
      }
      groups.get(key)!.items.push(it);
    }
    order.sort(
      (a, b) => (a === UNASSIGNED ? 1 : 0) - (b === UNASSIGNED ? 1 : 0)
    );

    order.forEach((key, gi) => {
      const grp = groups.get(key)!;
      const label = grp.name || "Unassigned";
      ensure(40);
      if (gi > 0) y += 8;

      // Person header: avatar + name + task count.
      const ar = 9;
      drawAvatar(grp.name, MARGIN + ar, y + 1, ar);
      const nameX = MARGIN + ar * 2 + 8;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11.5);
      doc.setTextColor(...INK);
      doc.text(label, nameX, y + 5);
      const labelW = doc.getTextWidth(label); // measure while still bold 11.5
      const n = grp.items.length;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...FAINT);
      doc.text(`${n} ${n === 1 ? "task" : "tasks"}`, nameX + labelW + 9, y + 5);
      y += 23;

      // Tasks, indented under the person.
      const tx = MARGIN + 16;
      grp.items.forEach((a) => {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(11);
        const lines = doc.splitTextToSize(a.text, CONTENT_W - 16 - 26);
        const hasDue = Boolean(a.dueHint);
        const blockH = lines.length * 15 + (hasDue ? 20 : 0) + 9;
        ensure(blockH);
        doc.setDrawColor(...INDIGO);
        doc.setLineWidth(1.2);
        doc.roundedRect(tx, y - 9, 11, 11, 3, 3, "S");
        doc.setTextColor(...INK);
        lines.forEach((line: string) => {
          doc.text(line, tx + 22, y);
          y += 15;
        });
        if (hasDue) {
          y += 5;
          dueChip(`Due ${a.dueHint}`, tx + 22, y);
          y += 9;
        }
        y += 9;
      });
    });
  };

  // Your notes — muted surface card (raw scratch, distinct from AI content).
  const noteCard = (text: string) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    const lines = doc.splitTextToSize(text, CONTENT_W - 32);
    const boxH = lines.length * 15 + 20;
    ensure(boxH);
    doc.setFillColor(...SURFACE);
    doc.roundedRect(MARGIN, y, CONTENT_W, boxH, 9, 9, "F");
    doc.setTextColor(...MUTED);
    let ly = y + 18;
    for (const line of lines) {
      doc.text(line, MARGIN + 16, ly);
      ly += 15;
    }
    y += boxH;
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
    accentCards(g.decisions, GREEN, GREEN_TINT, "check");
  }
  if (g && g.openQuestions.length) {
    heading("Open questions");
    accentCards(g.openQuestions, AMBER, AMBER_TINT, "q");
  }
  if (note.actionItems.length) {
    heading("Action items");
    actionsByPerson(note.actionItems);
  }
  if (note.scratch.trim()) {
    heading("Your notes");
    noteCard(note.scratch.trim());
  }
  if (!g && !note.actionItems.length && !note.scratch.trim()) {
    y += 30;
    doc.setFont("helvetica", "italic");
    doc.setFontSize(11);
    doc.setTextColor(...FAINT);
    doc.text("No notes were generated for this meeting.", MARGIN, y);
  }

  // ---- Footer on every page ---------------------------------------------
  const foot = "Generated by Glyph";
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, PAGE_H - 40, PAGE_W - MARGIN, PAGE_H - 40);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...FAINT);
    doc.text(foot, MARGIN, PAGE_H - 26);
    doc.text(`${p} / ${pages}`, PAGE_W - MARGIN, PAGE_H - 26, { align: "right" });
  }

  // datauristring → strip the "data:application/pdf;base64," prefix.
  const uri = doc.output("datauristring");
  return uri.slice(uri.indexOf(",") + 1);
}
