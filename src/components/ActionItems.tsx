import { useState } from "react";
import AddActionItem from "./AddActionItem";
import { avatarFor } from "../lib/avatar";
import { isDevanagari } from "../lib/useTranscript";

export interface DisplayActionItem {
  text: string;
  assignee?: string;
  due?: string;
}

function Row({ item }: { item: DisplayActionItem }) {
  const av = item.assignee ? avatarFor(item.assignee) : null;
  return (
    <div className="flex items-center gap-3 px-[10px] py-[11px] rounded-[11px] transition-[0.12s] hover:bg-line-soft">
      <div className="w-[18px] h-[18px] rounded-[6px] border-[1.6px] border-line shrink-0 cursor-pointer" />
      <div className={`flex-1 text-[14px] font-medium ${isDevanagari(item.text) ? "dev" : ""}`}>
        {item.text}
      </div>
      {item.due && (
        <span className="text-[11.5px] text-muted">{item.due}</span>
      )}
      {av && (
        <span className="inline-flex items-center gap-[6px] text-[12px] font-semibold text-indigo-deep bg-indigo-soft pl-1 pr-[10px] py-[3px] rounded-[20px] cursor-pointer">
          <span
            className="w-[18px] h-[18px] rounded-full text-white grid place-items-center text-[9.5px] font-bold"
            style={{ background: av.color }}
          >
            {av.initial}
          </span>
          {item.assignee}
        </span>
      )}
    </div>
  );
}

export default function ActionItems({ items }: { items: DisplayActionItem[] }) {
  const [extra, setExtra] = useState<DisplayActionItem[]>([]);
  return (
    <div>
      {items.map((it, i) => (
        <Row key={i} item={it} />
      ))}
      {extra.map((it, i) => (
        <Row key={`x${i}`} item={it} />
      ))}
      <AddActionItem
        onAdd={(text) => setExtra((e) => [...e, { text, assignee: "Khush" }])}
      />
    </div>
  );
}
