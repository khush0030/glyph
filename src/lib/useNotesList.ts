import { useCallback, useEffect, useState } from "react";
import { commands, type NoteSummary } from "./ipc";

export function useNotesList() {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setNotes(await commands.listNotes());
    } catch {
      // not in app / db unavailable
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { notes, loading, reload };
}

/** Group note summaries by a relative day label using updatedAt. */
export function groupNotesByDay(notes: NoteSummary[]): {
  label: string;
  items: NoteSummary[];
}[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const groups: { label: string; items: NoteSummary[] }[] = [];
  for (const n of notes) {
    const d = new Date(n.updatedAt);
    const day = new Date(d);
    day.setHours(0, 0, 0, 0);
    let label: string;
    if (day.getTime() === today.getTime()) label = "Today";
    else if (day.getTime() === yesterday.getTime()) label = "Yesterday";
    else label = d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(n);
    else groups.push({ label, items: [n] });
  }
  return groups;
}

export function noteTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
