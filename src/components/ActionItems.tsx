import AddActionItem from "./AddActionItem";
import { avatarFor } from "../lib/avatar";
import { isDevanagari } from "../lib/useTranscript";

export interface DisplayActionItem {
  id?: string;
  text: string;
  assignee?: string;
  dueHint?: string;
}

function Row({
  item,
  onDelete,
}: {
  item: DisplayActionItem;
  onDelete?: () => void;
}) {
  const av = item.assignee ? avatarFor(item.assignee) : null;
  return (
    <div className="group flex items-center gap-3 px-[10px] py-[11px] rounded-[11px] transition-[0.12s] hover:bg-line-soft">
      <div className="w-[18px] h-[18px] rounded-[6px] border-[1.6px] border-line shrink-0 cursor-pointer" />
      <div className={`flex-1 text-[14px] font-medium ${isDevanagari(item.text) ? "dev" : ""}`}>
        {item.text}
      </div>
      {item.dueHint && <span className="text-[11.5px] text-muted">{item.dueHint}</span>}
      {av && (
        <span className="inline-flex items-center gap-[6px] text-[12px] font-semibold text-indigo-deep bg-indigo-soft pl-1 pr-[10px] py-[3px] rounded-[20px]">
          <span
            className="w-[18px] h-[18px] rounded-full text-white grid place-items-center text-[9.5px] font-bold"
            style={{ background: av.color }}
          >
            {av.initial}
          </span>
          {item.assignee}
        </span>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 text-faint hover:text-rec text-[16px] leading-none px-1 transition-opacity"
          aria-label="Delete action item"
        >
          ×
        </button>
      )}
    </div>
  );
}

export default function ActionItems({
  items,
  onAdd,
  onDelete,
}: {
  items: DisplayActionItem[];
  onAdd: (text: string) => void;
  onDelete?: (id: string) => void;
}) {
  return (
    <div>
      {items.map((it, i) => (
        <Row
          key={it.id ?? i}
          item={it}
          onDelete={it.id && onDelete ? () => onDelete(it.id!) : undefined}
        />
      ))}
      <AddActionItem onAdd={onAdd} />
    </div>
  );
}
