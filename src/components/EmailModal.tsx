import { useEffect, useState } from "react";
import { Btn } from "./ui";
import { commands, type NoteDetail } from "../lib/ipc";
import { buildNotePdfBase64 } from "../lib/pdf";

// Emails the meeting notes (PDF attached) to attendees via Gmail. Recipients are
// prefilled from the linked calendar event when we can match it by title, and
// freely editable. Sending uses the same Google connection as Calendar.
export default function EmailModal({
  note,
  onClose,
}: {
  note: NoteDetail;
  onClose: () => void;
}) {
  const title = note.title.trim() || "Untitled meeting";
  const [recipients, setRecipients] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [subject, setSubject] = useState(`Notes — ${title}`);
  const [body, setBody] = useState(
    `Hi,\n\nPlease find the notes from "${title}" attached as a PDF.${
      note.generated?.summary ? `\n\n${note.generated.summary}` : ""
    }\n\nBest,`
  );
  const [loadingAttendees, setLoadingAttendees] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Best-effort prefill from the calendar (past/upcoming title match).
  useEffect(() => {
    let live = true;
    commands
      .calendarAttendees(title)
      .then((emails) => {
        if (live && emails.length) setRecipients((r) => dedupe([...r, ...emails]));
      })
      .catch(() => {})
      .finally(() => live && setLoadingAttendees(false));
    return () => {
      live = false;
    };
  }, [title]);

  function addDraft() {
    const parts = draft
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter((s) => s.includes("@"));
    if (parts.length) setRecipients((r) => dedupe([...r, ...parts]));
    setDraft("");
  }

  function remove(email: string) {
    setRecipients((r) => r.filter((e) => e !== email));
  }

  async function send() {
    const to = dedupe([...recipients, ...draft.split(/[,\s]+/).map((s) => s.trim())]).filter((s) =>
      s.includes("@")
    );
    if (to.length === 0) {
      setError("Add at least one recipient email.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const pdf = buildNotePdfBase64(note);
      const filename = `${slug(title)}-notes.pdf`;
      await commands.gmailSend(to, subject, body, pdf, filename);
      setDone(true);
      setTimeout(onClose, 1100);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onClick={(e) => (e.target as HTMLElement).dataset.ov && onClose()}
      data-ov="1"
      className="fixed inset-0 bg-[rgba(26,24,35,.4)] flex items-center justify-center z-50 p-6 backdrop-blur-[2px]"
    >
      <div className="bg-surface rounded-rl w-[600px] max-w-full max-h-[86vh] overflow-auto shadow-[0_24px_70px_rgba(26,24,35,.28)]">
        <div className="flex items-center justify-between px-[22px] py-5 border-b border-line">
          <div className="text-[16.5px] font-bold">Email notes to attendees</div>
          <button
            type="button"
            onClick={onClose}
            className="border-none bg-line-soft w-[30px] h-[30px] rounded-[9px] cursor-pointer text-[17px] text-muted"
          >
            ×
          </button>
        </div>

        <div className="px-[22px] py-[18px]">
          <div className="text-[11.5px] font-bold tracking-[0.5px] uppercase text-faint mb-[7px]">
            Recipients
          </div>
          <div className="flex flex-wrap items-center gap-[6px] border border-line rounded-[11px] px-[10px] py-2 bg-bg focus-within:border-indigo mb-1">
            {recipients.map((e) => (
              <span
                key={e}
                className="inline-flex items-center gap-[6px] text-[12.5px] font-medium bg-indigo-soft text-indigo-deep rounded-[20px] pl-[10px] pr-[6px] py-[3px]"
              >
                {e}
                <button
                  type="button"
                  onClick={() => remove(e)}
                  className="text-indigo-deep/70 hover:text-indigo-deep text-[14px] leading-none"
                  aria-label={`Remove ${e}`}
                >
                  ×
                </button>
              </span>
            ))}
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addDraft();
                }
              }}
              onBlur={addDraft}
              placeholder={recipients.length ? "Add another…" : "name@company.com"}
              className="flex-1 min-w-[140px] bg-transparent border-none outline-none py-[5px] text-[13px] text-ink"
            />
          </div>
          <div className="text-[11.5px] text-faint mb-[14px] h-[14px]">
            {loadingAttendees ? "Checking your calendar for attendees…" : "Press Enter or comma to add."}
          </div>

          <div className="text-[11.5px] font-bold tracking-[0.5px] uppercase text-faint mb-[7px]">
            Subject
          </div>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full border border-line rounded-[11px] px-[13px] py-[10px] text-[13.5px] bg-bg outline-none focus:border-indigo mb-[14px]"
          />

          <div className="text-[11.5px] font-bold tracking-[0.5px] uppercase text-faint mb-[7px]">
            Message
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="w-full min-h-[120px] border border-line rounded-[11px] px-[13px] py-[10px] text-[13.5px] leading-[1.5] bg-bg outline-none focus:border-indigo resize-none"
          />

          <div className="flex items-center gap-2 mt-3 text-[12.5px] text-muted">
            <span className="inline-flex items-center gap-[6px] bg-line-soft rounded-[8px] px-[9px] py-[5px] font-medium">
              📎 {slug(title)}-notes.pdf
            </span>
            <span>attached automatically</span>
          </div>

          {error && <div className="text-[12.5px] text-rec mt-3">{error}</div>}
        </div>

        <div className="flex items-center justify-between px-[22px] py-4 border-t border-line bg-bg">
          <div className="text-[12.5px] text-muted">
            Sent from your connected Gmail account.
          </div>
          <Btn variant="primary" onClick={send}>
            {done ? "Sent ✓" : busy ? "Sending…" : "Send via Gmail"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean)));
}

function slug(title: string): string {
  const s = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "meeting";
}
