import { Btn } from "./ui";
import { AsanaIcon, ChevronDownIcon, CheckIcon } from "./Icons";
import { meetingActionItems } from "../lib/mock";

// Asana export modal (mockup #asanaModal). M0 is presentational; M6 wires the
// real project/assignee/due pickers and task creation.
export default function AsanaModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      onClick={(e) =>
        (e.target as HTMLElement).dataset.ov && onClose()
      }
      data-ov="1"
      className="fixed inset-0 bg-[rgba(26,24,35,.4)] flex items-center justify-center z-50 p-6 backdrop-blur-[2px]"
    >
      <div className="bg-surface rounded-rl w-[560px] max-w-full max-h-[86vh] overflow-auto shadow-[0_24px_70px_rgba(26,24,35,.28)]">
        <div className="flex items-center justify-between px-[22px] py-5 border-b border-line">
          <div className="text-[16.5px] font-bold flex items-center gap-[9px]">
            <AsanaIcon className="w-[18px] h-[18px] text-indigo" /> Send action
            items to Asana
          </div>
          <button
            onClick={onClose}
            className="border-none bg-line-soft w-[30px] h-[30px] rounded-[9px] cursor-pointer text-[17px] text-muted"
          >
            ×
          </button>
        </div>

        <div className="px-[22px] py-[18px]">
          <div className="text-[11.5px] font-bold tracking-[0.5px] uppercase text-faint mb-[7px]">
            Project
          </div>
          <div className="w-full border border-line rounded-[11px] px-[13px] py-[10px] text-[13.5px] font-semibold bg-bg flex items-center justify-between cursor-pointer">
            Sarthak Singapore (Client)
            <ChevronDownIcon className="w-[15px] h-[15px]" />
          </div>

          <div className="text-[11.5px] font-bold tracking-[0.5px] uppercase text-faint mt-[14px] mb-[7px]">
            Tasks to create
          </div>
          {meetingActionItems.map((t, i) => (
            <div
              key={i}
              className="flex items-center gap-[10px] px-3 py-[11px] border border-line rounded-[11px] mb-2"
            >
              <div className="w-[18px] h-[18px] rounded-[6px] bg-indigo shrink-0 grid place-items-center">
                <CheckIcon className="w-[11px] h-[11px]" />
              </div>
              <div className="flex-1 text-[13.5px] font-medium">{t.text}</div>
              <span className="text-[11.5px] font-semibold text-indigo-deep bg-indigo-soft px-[9px] py-[3px] rounded-[20px]">
                {t.assignee}
              </span>
              <span className="text-[11.5px] text-muted min-w-[30px] text-right">
                {t.due ?? "—"}
              </span>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between px-[22px] py-4 border-t border-line bg-bg">
          <div className="text-[12.5px] text-muted">
            {meetingActionItems.length} tasks · linked back to this meeting
          </div>
          <Btn variant="primary" onClick={onClose}>
            Create {meetingActionItems.length} tasks
          </Btn>
        </div>
      </div>
    </div>
  );
}
