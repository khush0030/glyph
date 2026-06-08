import { useCallback, useEffect, useState } from "react";
import { commands } from "./ipc";

// App settings persisted in the SQLite `settings` table via get/set_settings.
export type SettingsMap = Record<string, string>;

export const DEFAULTS: SettingsMap = {
  engine: "cloud",
  analysis_model: "claude-haiku-4-5",
  language: "auto",
  auto_record: "ask",
  audio_retention: "delete",
};

export function useSettings() {
  const [values, setValues] = useState<SettingsMap>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const stored = await commands.getSettings();
        setValues({ ...DEFAULTS, ...stored });
      } catch {
        setAvailable(false);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const set = useCallback(
    async (key: string, value: string) => {
      setValues((v) => ({ ...v, [key]: value }));
      try {
        await commands.setSettings({ [key]: value });
      } catch {
        setAvailable(false);
      }
    },
    []
  );

  return { values, set, loaded, available };
}
