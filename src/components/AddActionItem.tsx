import { useState } from "react";
import { PlusIcon } from "./Icons";

// Manual action-item entry (mockup .addai). M0 keeps added items in local
// state; M4 persists them with source='manual'.
export default function AddActionItem({
  onAdd,
}: {
  onAdd: (text: string) => void;
}) {
  const [active, setActive] = useState(false);
  const [value, setValue] = useState("");

  function commit() {
    const t = value.trim();
    if (t) {
      onAdd(t);
      setValue("");
    }
  }

  return (
    <div
      onClick={() => setActive(true)}
      className="flex items-center gap-[10px] p-[10px] border border-dashed border-line rounded-[11px] mt-[6px] cursor-text"
    >
      {active ? (
        <>
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && commit()}
            placeholder="Type a task and press Enter…"
            className="border-none bg-transparent font-sans text-[14px] text-ink outline-none flex-1"
          />
          <span className="inline-flex items-center gap-[6px] text-[12px] font-semibold text-indigo-deep bg-indigo-soft pl-1 pr-[10px] py-[3px] rounded-[20px]">
            <span className="w-[18px] h-[18px] rounded-full bg-indigo text-white grid place-items-center text-[9.5px] font-bold">
              K
            </span>
            Khush
          </span>
        </>
      ) : (
        <span className="text-faint text-[14px] flex items-center gap-[9px]">
          <PlusIcon className="w-4 h-4" /> Add an action item manually
        </span>
      )}
    </div>
  );
}
