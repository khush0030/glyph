import { useCallback, useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { commands, type CredentialId, type CredentialStatus } from "./ipc";

/** Tracks which Keychain credentials are present (booleans only — never the
 *  secrets). Shared by the credentials editor and the integration rows. */
export function useCredentials() {
  const [status, setStatus] = useState<Record<string, boolean>>({});
  const inApp = isTauri();
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!inApp) return;
    try {
      const list: CredentialStatus[] = await commands.credentialStatus();
      setStatus(Object.fromEntries(list.map((s) => [s.id, s.present])));
      setError(null);
    } catch (e) {
      // In-app failure is a real error (e.g. locked Keychain), not "not Tauri".
      setError(String(e));
    }
  }, [inApp]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const isSet = useCallback((id: CredentialId) => !!status[id], [status]);

  return { status, isSet, refresh, inApp, error, available: inApp };
}
