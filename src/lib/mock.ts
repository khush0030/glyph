// Static data mirroring design/mockup.html. M0 renders from this; real data
// arrives via NotesStore/CalendarSource in later milestones.

export type MeetingType = "Client" | "Internal";

export interface UpcomingMeeting {
  time: string;
  ampm: string;
  title: string;
  type: MeetingType;
  platform: string;
  platformColor: string;
  attendees: string;
  duration?: string;
  autoRecord: "Ask" | "Auto";
  inPerson?: boolean;
}

export interface NoteRow {
  id: string;
  dot: string;
  title: string;
  type?: MeetingType;
  meta: string;
}

export interface DayGroup<T> {
  label: string;
  items: T[];
}

export const upcoming: UpcomingMeeting[] = [
  {
    time: "3:30",
    ampm: "PM",
    title: "Sarthak Singapore — Priya review",
    type: "Client",
    platform: "Google Meet",
    platformColor: "#2F9E6B",
    attendees: "Vineeth, Amaan",
    autoRecord: "Ask",
  },
  {
    time: "5:00",
    ampm: "PM",
    title: "Founders weekly sync",
    type: "Internal",
    platform: "Zoom",
    platformColor: "#4087E5",
    attendees: "Amaan, Vineeth, Khush",
    autoRecord: "Auto",
  },
];

export const recentNotes: NoteRow[] = [
  {
    id: "n1",
    dot: "#5A4BD4",
    title: "Darshak Desai — CRM scope call",
    meta: "Today, 11:30 AM · 6 action items",
  },
  {
    id: "n2",
    dot: "#2F9E6B",
    title: "Rise & Shine — demo walkthrough",
    meta: "Yesterday · 4 action items",
  },
  {
    id: "n3",
    dot: "#A4A1B2",
    title: "SIMCA Advertising — proposal review",
    meta: "Fri · 9 action items",
  },
];

export const calendarDays: DayGroup<UpcomingMeeting>[] = [
  {
    label: "Today · Mon 8 June",
    items: [
      {
        time: "3:30",
        ampm: "PM",
        title: "Sarthak Singapore — Priya review",
        type: "Client",
        platform: "Google Meet",
        platformColor: "#2F9E6B",
        attendees: "Vineeth, Amaan",
        duration: "30 min",
        autoRecord: "Ask",
      },
      {
        time: "5:00",
        ampm: "PM",
        title: "Founders weekly sync",
        type: "Internal",
        platform: "Zoom",
        platformColor: "#4087E5",
        attendees: "Amaan, Vineeth",
        duration: "45 min",
        autoRecord: "Auto",
      },
    ],
  },
  {
    label: "Tomorrow · Tue 9 June",
    items: [
      {
        time: "11:00",
        ampm: "AM",
        title: "Darshak Desai — CRM kickoff",
        type: "Client",
        platform: "Google Meet",
        platformColor: "#2F9E6B",
        attendees: "Darshak",
        duration: "60 min",
        autoRecord: "Ask",
      },
      {
        time: "4:00",
        ampm: "PM",
        title: "Rise & Shine — voice agent demo",
        type: "Client",
        platform: "No video link",
        platformColor: "#A4A1B2",
        attendees: "in person",
        duration: "30 min",
        autoRecord: "Ask",
        inPerson: true,
      },
    ],
  },
  {
    label: "Wed 10 June",
    items: [
      {
        time: "2:00",
        ampm: "PM",
        title: "SIMCA — platform scope review",
        type: "Client",
        platform: "Zoom",
        platformColor: "#4087E5",
        attendees: "",
        duration: "45 min",
        autoRecord: "Ask",
      },
    ],
  },
];

export const notesDays: DayGroup<NoteRow>[] = [
  {
    label: "Today",
    items: [
      {
        id: "n1",
        dot: "#5A4BD4",
        title: "Darshak Desai — CRM scope call",
        type: "Client",
        meta: "11:30 AM · 6 action items",
      },
    ],
  },
  {
    label: "Yesterday",
    items: [
      {
        id: "n2",
        dot: "#2F9E6B",
        title: "Rise & Shine — demo walkthrough",
        type: "Client",
        meta: "5:40 PM · 4 action items",
      },
      {
        id: "n3",
        dot: "#A4A1B2",
        title: "Internal — content planning",
        meta: "10:05 AM · 3 action items",
      },
    ],
  },
  {
    label: "Fri 5 June",
    items: [
      {
        id: "n4",
        dot: "#A4A1B2",
        title: "SIMCA Advertising — proposal review",
        type: "Client",
        meta: "2:00 PM · 9 action items",
      },
    ],
  },
];

export interface ActionItem {
  text: string;
  assignee: string;
  initial: string;
  color: string;
  due?: string;
  lang?: "dev";
}

export const meetingActionItems: ActionItem[] = [
  {
    text: "Finalise phonetic dictionary for English loanwords",
    assignee: "Khush",
    initial: "K",
    color: "#5A4BD4",
    due: "Wed",
  },
  {
    text: "Wire Cal.com booking + confirmation message",
    assignee: "Vineeth",
    initial: "V",
    color: "#2F9E6B",
    due: "Fri",
  },
  {
    text: "Share noise samples from last 3 live calls",
    assignee: "Amaan",
    initial: "A",
    color: "#C77D18",
  },
];

export interface TranscriptLine {
  initial: string;
  color: string;
  speaker: string;
  time: string;
  text: string;
  lang?: "dev";
}

export const transcript: TranscriptLine[] = [
  {
    initial: "K",
    color: "#5A4BD4",
    speaker: "Speaker 1",
    time: "2:14",
    text: "Okay so the main issue is still the pronunciation — the matras get dropped on the fast model.",
  },
  {
    initial: "V",
    color: "#2F9E6B",
    speaker: "Speaker 2",
    time: "2:31",
    text: 'हाँ, और जब वो "site visit" बोलती है तो ठीक से नहीं आता। हमें एक phonetic layer चाहिए loanwords के लिए।',
    lang: "dev",
  },
  {
    initial: "K",
    color: "#5A4BD4",
    speaker: "Speaker 1",
    time: "3:02",
    text: "Right — lock the bigger model for Hindi, keep the fast one only for English.",
  },
];
