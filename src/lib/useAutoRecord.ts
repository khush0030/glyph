import { useCallback, useEffect, useState } from "react";
import { commands } from "./ipc";

type Pref = "ask" | "auto";

/** Per-meeting auto-record preference, persisted in the settings table as
 *  `autorecord:<eventId>`, falling back to the global `auto_record` default. */
export function useAutoRecord() {
  const [map, setMap] = useState<Record<string, string>>({});
  const [globalDefault, setGlobalDefault] = useState<Pref>("ask");

  useEffect(() => {
    (async () => {
      try {
        const s = await commands.getSettings();
        setMap(s);
        if (s.auto_record === "auto" || s.auto_record === "ask") setGlobalDefault(s.auto_record);
      } catch {
        // not in app
      }
    })();
  }, []);

  const get = useCallback(
    (eventId: string): Pref => {
      const v = map[`autorecord:${eventId}`];
      if (v === "ask" || v === "auto") return v;
      return globalDefault;
    },
    [map, globalDefault]
  );

  const set = useCallback((eventId: string, value: Pref) => {
    const key = `autorecord:${eventId}`;
    setMap((m) => ({ ...m, [key]: value }));
    commands.setSettings({ [key]: value }).catch(() => {});
  }, []);

  return { get, set, globalDefault };
}
