import { Tag } from "./ui";
import type { NoteRow } from "../lib/mock";

// One clickable note row (.nrow) used on Dashboard "Recent" and the Notes page.
export default function NotesList({
  rows,
  onOpen,
}: {
  rows: NoteRow[];
  onOpen: () => void;
}) {
  return (
    <>
      {rows.map((n) => (
        <div
          key={n.id}
          onClick={onOpen}
          className="flex items-center gap-[14px] px-[18px] py-[14px] border-b border-line-soft last:border-b-0 cursor-pointer transition-[0.12s] hover:bg-line-soft"
        >
          <div
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: n.dot }}
          />
          <div className="flex-1 text-[14px] font-semibold flex items-center gap-[6px]">
            {n.title}
            {n.type && <Tag type={n.type} />}
          </div>
          <div className="text-[12px] text-faint">{n.meta}</div>
        </div>
      ))}
    </>
  );
}
