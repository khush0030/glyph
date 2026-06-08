import type { ReactNode } from "react";

// Calm empty state for areas with no real data yet (no persistence/calendar
// until M4/M5). Replaces the mockup's placeholder rows.
export default function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="bg-surface border border-dashed border-line rounded-r px-6 py-10 flex flex-col items-center text-center">
      {icon && <div className="text-faint mb-3">{icon}</div>}
      <div className="text-[14.5px] font-semibold">{title}</div>
      {body && (
        <div className="text-[13px] text-muted mt-1 max-w-[340px] leading-[1.5]">
          {body}
        </div>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
