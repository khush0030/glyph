// TaskExporter — action items → external tasks. Asana via OAuth (M6). Token in
// the macOS Keychain. One project per client + a single "Internal" project.

export interface AsanaProject {
  gid: string;
  name: string;
  type: "client" | "internal";
}

export interface AsanaUser {
  gid: string;
  name: string;
}

export interface ExportItem {
  text: string;
  /** Asana user gid for the assignee, if chosen. */
  assigneeGid?: string;
  /** ISO date (YYYY-MM-DD). */
  dueOn?: string;
}

export interface TaskExporter {
  connect(): Promise<void>;
  isConnected(): Promise<boolean>;
  projects(): Promise<AsanaProject[]>;
  users(): Promise<AsanaUser[]>;
  /** Create tasks for a note; returns created Asana task gids. */
  createTasks(input: {
    noteId: string;
    projectGid: string;
    items: ExportItem[];
  }): Promise<string[]>;
}
