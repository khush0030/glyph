import type { ReactNode } from "react";

// The .ph block: big title + sub on the left, actions on the right.
export default function PageHeader({
  title,
  sub,
  right,
}: {
  title: string;
  sub?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-5 mb-[28px]">
      <div>
        <div className="text-[26px] font-extrabold tracking-[-0.8px]">
          {title}
        </div>
        {sub && <div className="text-[13.5px] text-faint mt-1">{sub}</div>}
      </div>
      {right && <div className="flex gap-[10px]">{right}</div>}
    </div>
  );
}
