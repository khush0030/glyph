import { useCallback, useEffect, useState } from "react";
import { commands, type CalendarEvent } from "./ipc";

export interface CalendarState {
  connected: boolean;
  events: CalendarEvent[];
  loading: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  refresh: () => Promise<void>;
}

/** Google Calendar connection + upcoming events (M5). */
export function useCalendar(): CalendarState {
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const isConn = await commands.calendarConnected();
      setConnected(isConn);
      if (isConn) setEvents(await commands.calendarUpcoming());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const connect = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await commands.calendarConnect(); // resolves after the browser sign-in
      setConnected(true);
      setEvents(await commands.calendarUpcoming());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await commands.calendarDisconnect();
    } finally {
      setConnected(false);
      setEvents([]);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { connected, events, loading, error, connect, disconnect, refresh };
}

/** Group events by local day label for the Calendar page. */
export function groupByDay(events: CalendarEvent[]): {
  label: string;
  items: CalendarEvent[];
}[] {
  const groups: { label: string; items: CalendarEvent[] }[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  for (const ev of events) {
    const d = new Date(ev.startTs);
    const day = new Date(d);
    day.setHours(0, 0, 0, 0);
    let label: string;
    if (day.getTime() === today.getTime()) {
      label = `Today · ${d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}`;
    } else if (day.getTime() === tomorrow.getTime()) {
      label = `Tomorrow · ${d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}`;
    } else {
      label = d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
    }
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(ev);
    else groups.push({ label, items: [ev] });
  }
  return groups;
}

export function fmtClock(ts: number): { t: string; ampm: string } {
  const d = new Date(ts);
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return { t: `${h}:${m.toString().padStart(2, "0")}`, ampm };
}
