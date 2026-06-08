// CalendarSource — upcoming events + video-link detection. Google Calendar via
// OAuth PKCE (M5). Token in the macOS Keychain.

export type AutoRecord = "ask" | "auto";

export interface CalendarEvent {
  id: string;
  title: string;
  startTs: number;
  endTs: number;
  /** Detected Meet/Zoom/Teams link, if any. */
  link?: string;
  /** "Google Meet" | "Zoom" | "Teams" | undefined (in person). */
  platform?: string;
  attendees: string[];
  autoRecord: AutoRecord;
}

export interface CalendarSource {
  /** Kick off OAuth (PKCE, system browser); resolves once token is stored. */
  connect(): Promise<void>;
  isConnected(): Promise<boolean>;
  /** Upcoming events in the next window, grouped/sorted by start. */
  upcoming(): Promise<CalendarEvent[]>;
  /** Per-meeting auto-record preference. */
  setAutoRecord(eventId: string, value: AutoRecord): Promise<void>;
}
