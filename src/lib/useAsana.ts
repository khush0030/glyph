import { useCallback, useEffect, useState } from "react";
import { commands, type AsanaIdName, type AsanaUser } from "./ipc";

export interface AsanaData {
  workspace: AsanaIdName | null;
  projects: AsanaIdName[];
  users: AsanaUser[];
  loading: boolean;
  error: string | null;
}

/** Loads the user's first Asana workspace, then its projects + members. */
export function useAsana(active: boolean): AsanaData {
  const [workspace, setWorkspace] = useState<AsanaIdName | null>(null);
  const [projects, setProjects] = useState<AsanaIdName[]>([]);
  const [users, setUsers] = useState<AsanaUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ws = await commands.asanaWorkspaces();
      if (ws.length === 0) {
        setError("No Asana workspace found for this token.");
        return;
      }
      const w = ws[0];
      setWorkspace(w);
      const [projs, members] = await Promise.all([
        commands.asanaProjects(w.gid),
        commands.asanaUsers(w.gid),
      ]);
      setProjects(projs);
      setUsers(members);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  return { workspace, projects, users, loading, error };
}

/** Best-effort match of an AI-suggested assignee name to an Asana user gid. */
export function matchUser(name: string | undefined, users: AsanaUser[]): string {
  if (!name) return "";
  const lower = name.trim().toLowerCase();
  const exact = users.find((u) => u.name.toLowerCase() === lower);
  if (exact) return exact.gid;
  const partial = users.find(
    (u) => u.name.toLowerCase().includes(lower) || lower.includes(u.name.toLowerCase().split(" ")[0])
  );
  return partial?.gid ?? "";
}
