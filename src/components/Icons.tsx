// SVG paths lifted verbatim from design/mockup.html. className controls size.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

export const DashboardIcon = (p: P) => (
  <svg className="ic" viewBox="0 0 24 24" {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
);

export const CalendarIcon = (p: P) => (
  <svg className="ic" viewBox="0 0 24 24" {...p}>
    <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
    <path d="M3 9h18M8 2.5v4M16 2.5v4" />
  </svg>
);

export const NotesIcon = (p: P) => (
  <svg className="ic" viewBox="0 0 24 24" {...p}>
    <path d="M5 3h11l4 4v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    <path d="M15 3v5h5M8 13h8M8 17h5" />
  </svg>
);

export const SettingsIcon = (p: P) => (
  <svg className="ic" viewBox="0 0 24 24" {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 13.5a1.6 1.6 0 0 0 .3 1.8 2 2 0 1 1-2.8 2.8 1.6 1.6 0 0 0-2.7 1.1 2 2 0 1 1-4 0 1.6 1.6 0 0 0-2.7-1.1 2 2 0 1 1-2.8-2.8 1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1A2 2 0 1 1 1.7 9.7a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8A2 2 0 1 1 5.7 4.1a1.6 1.6 0 0 0 1.8.3h.1A1.6 1.6 0 0 0 8.6 3 2 2 0 1 1 12.6 3a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3 2 2 0 1 1 2.8 2.8 1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1A2 2 0 1 1 21 13.6a1.6 1.6 0 0 0-1.6 0z" />
  </svg>
);

export const PlusIcon = (p: P) => (
  <svg className="ic" viewBox="0 0 24 24" {...p}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const RecordDotIcon = (p: P) => (
  <svg className="ic" viewBox="0 0 24 24" {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" />
  </svg>
);

export const ChevronRightIcon = (p: P) => (
  <svg className="ic" viewBox="0 0 24 24" {...p}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);

export const ChevronDownIcon = (p: P) => (
  <svg className="ic" viewBox="0 0 24 24" {...p}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

export const AsanaIcon = (p: P) => (
  <svg className="ic" viewBox="0 0 24 24" {...p}>
    <circle cx="12" cy="6.5" r="2.6" />
    <circle cx="6.5" cy="15" r="2.6" />
    <circle cx="17.5" cy="15" r="2.6" />
  </svg>
);

export const CheckIcon = (p: P) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="#fff"
    strokeWidth={3}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...p}
  >
    <path d="M5 12l5 5 9-10" />
  </svg>
);
