import { useCallback, useEffect, useState } from "react";
import { commands, type CredentialId, type CredentialStatus } from "./ipc";

/** Tracks which Keychain credentials are present (booleans only — never the
 *  secrets). Shared by the credentials editor and the integration rows. */
export function useCredentials() {
  const [status, setStatus] = useState<Record<string, boolean>>({});
  const [available, setAvailable] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const list: CredentialStatus[] = await commands.credentialStatus();
      setStatus(Object.fromEntries(list.map((s) => [s.id, s.present])));
    } catch {
      setAvailable(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const isSet = useCallback((id: CredentialId) => !!status[id], [status]);

  return { status, isSet, refresh, available };
}
