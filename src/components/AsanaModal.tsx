import { useEffect, useMemo, useState } from "react";
import { Btn } from "./ui";
import { AsanaIcon, CheckIcon } from "./Icons";
import { isDevanagari } from "../lib/useTranscript";
import { useAsana, matchUser } from "../lib/useAsana";
import { commands, type StoredActionItem, type AsanaTaskIn } from "../lib/ipc";

interface RowState {
  assigneeGid: string;
  dueOn: string;
  include: boolean;
}

// Asana export modal (SPEC §9). Fetches the workspace's projects + members,
// lets the user pick a project and per-item assignee + due date, then creates
// tasks. Already-sent items (asanaGid set) are shown as sent and skipped.
export default function AsanaModal({
  noteId,
  items,
  onClose,
  onSent,
}: {
  noteId: string;
  items: StoredActionItem[];
  onClose: () => void;
  onSent: () => void;
}) {
  const { workspace, projects, users, loading, error } = useAsana(true);
  const [projectGid, setProjectGid] = useState("");
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const pending = useMemo(() => items.filter((i) => !i.asanaGid), [items]);
  const sent = items.filter((i) => i.asanaGid);

  // Default project + per-item assignee once data loads.
  useEffect(() => {
    if (projects.length && !projectGid) setProjectGid(projects[0].gid);
  }, [projects, projectGid]);
  useEffect(() => {
    if (!users.length) return;
    setRows((prev) => {
      const next = { ...prev };
      for (const it of pending) {
        if (!next[it.id]) {
          next[it.id] = { assigneeGid: matchUser(it.assignee, users), dueOn: "", include: true };
        }
      }
      return next;
    });
  }, [users, pending]);

  function update(id: string, patch: Partial<RowState>) {
    setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));
  }

  const selected = pending.filter((i) => rows[i.id]?.include);

  async function create() {
    if (!workspace || !projectGid || selected.length === 0) return;
    setBusy(true);
    setSendError(null);
    try {
      const payload: AsanaTaskIn[] = selected.map((i) => ({
        actionItemId: i.id,
        text: i.text,
        assigneeGid: rows[i.id]?.assigneeGid || undefined,
        dueOn: rows[i.id]?.dueOn || undefined,
      }));
      await commands.asanaCreateTasks(noteId, projectGid, workspace.gid, payload);
      onSent();
      onClose();
    } catch (e) {
      setSendError(String(e));
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
          <div className="text-[16.5px] font-bold flex items-center gap-[9px]">
            <AsanaIcon className="w-[18px] h-[18px] text-indigo" /> Send action items to Asana
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border-none bg-line-soft w-[30px] h-[30px] rounded-[9px] cursor-pointer text-[17px] text-muted"
          >
            ×
          </button>
        </div>

        <div className="px-[22px] py-[18px]">
          {error ? (
            <div className="text-[13px] text-rec bg-rec-soft rounded-[10px] px-3 py-3">
              {error.includes("No Asana token")
                ? "Add your Asana token in Settings → API keys to enable export."
                : error}
            </div>
          ) : loading ? (
            <div className="text-[13px] text-muted py-4">Loading your Asana projects…</div>
          ) : (
            <>
              <div className="text-[11.5px] font-bold tracking-[0.5px] uppercase text-faint mb-[7px]">
                Project
              </div>
              <select
                aria-label="Asana project"
                value={projectGid}
                onChange={(e) => setProjectGid(e.target.value)}
                className="w-full border border-line rounded-[11px] px-[13px] py-[10px] text-[13.5px] font-semibold bg-bg outline-none focus:border-indigo mb-[14px]"
              >
                {projects.length === 0 && <option value="">No projects found</option>}
                {projects.map((p) => (
                  <option key={p.gid} value={p.gid}>
                    {p.name}
                  </option>
                ))}
              </select>

              <div className="text-[11.5px] font-bold tracking-[0.5px] uppercase text-faint mb-[7px]">
                Tasks to create
              </div>

              {pending.length === 0 && sent.length === 0 && (
                <div className="text-[13px] text-muted py-2">No action items on this note yet.</div>
              )}

              {pending.map((it) => {
                const r = rows[it.id] ?? { assigneeGid: "", dueOn: "", include: true };
                return (
                  <div key={it.id} className="border border-line rounded-[11px] px-3 py-[11px] mb-2">
                    <div className="flex items-center gap-[10px]">
                      <input
                        type="checkbox"
                        aria-label="Include this task"
                        checked={r.include}
                        onChange={(e) => update(it.id, { include: e.target.checked })}
                        className="w-[16px] h-[16px] accent-indigo"
                      />
                      <div className={`flex-1 text-[13.5px] font-medium ${isDevanagari(it.text) ? "dev" : ""}`}>
                        {it.text}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-2 pl-[26px]">
                      <select
                        aria-label="Assignee"
                        value={r.assigneeGid}
                        onChange={(e) => update(it.id, { assigneeGid: e.target.value })}
                        className="flex-1 border border-line rounded-[9px] px-[10px] py-[7px] text-[12.5px] bg-bg outline-none focus:border-indigo"
                      >
                        <option value="">Unassigned</option>
                        {users.map((u) => (
                          <option key={u.gid} value={u.gid}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="date"
                        aria-label="Due date"
                        value={r.dueOn}
                        onChange={(e) => update(it.id, { dueOn: e.target.value })}
                        className="border border-line rounded-[9px] px-[10px] py-[6px] text-[12.5px] bg-bg outline-none focus:border-indigo"
                      />
                    </div>
                  </div>
                );
              })}

              {sent.map((it) => (
                <div key={it.id} className="flex items-center gap-[10px] px-3 py-[11px] border border-line rounded-[11px] mb-2 opacity-70">
                  <div className="w-[18px] h-[18px] rounded-[6px] bg-green shrink-0 grid place-items-center">
                    <CheckIcon className="w-[11px] h-[11px]" />
                  </div>
                  <div className="flex-1 text-[13.5px] font-medium">{it.text}</div>
                  <span className="text-[11px] font-semibold text-green bg-green-soft px-[9px] py-[2px] rounded-[20px]">
                    Sent
                  </span>
                </div>
              ))}

              {sendError && <div className="text-[12.5px] text-rec mt-2">{sendError}</div>}
            </>
          )}
        </div>

        <div className="flex items-center justify-between px-[22px] py-4 border-t border-line bg-bg">
          <div className="text-[12.5px] text-muted">
            {selected.length} task{selected.length === 1 ? "" : "s"}
            {sent.length > 0 && ` · ${sent.length} already sent`}
          </div>
          <Btn
            variant="primary"
            onClick={create}
          >
            {busy ? "Creating…" : `Create ${selected.length} task${selected.length === 1 ? "" : "s"}`}
          </Btn>
        </div>
      </div>
    </div>
  );
}
