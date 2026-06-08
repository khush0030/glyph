import ActionItems from "./ActionItems";
import { Btn } from "./ui";
import { AsanaIcon } from "./Icons";
import { meetingActionItems } from "../lib/mock";

// The AI-cleaned notes body: Summary / Key points / Decisions, then the
// structured Action items panel and the Send-to-Asana action.
export default function NotesView({ onOpenAsana }: { onOpenAsana: () => void }) {
  return (
    <div className="bg-surface border border-line rounded-r shadow-card px-6 py-[22px]">
      <div className="inline-flex items-center gap-[7px] text-[11.5px] font-semibold text-indigo-deep bg-indigo-soft px-3 py-[5px] rounded-[20px] mb-[18px]">
        <span className="w-[6px] h-[6px] rounded-full bg-indigo" />
        Cleaned by Claude Haiku 4.5 · language preserved
      </div>

      <h3 className="text-[14.5px] font-bold mb-[10px]">Summary</h3>
      <p className="text-[14.5px] leading-[1.62] text-[#3b3850] mb-[9px]">
        Reviewed the Priya voice agent for Singapore Miracle. Main blocker is
        Devanagari pronunciation on the fast model tier. Agreed to lock the model
        choice this week and ship the Cal.com booking flow to a live test.
      </p>

      <h3 className="text-[14.5px] font-bold mt-6 mb-[10px]">Key points</h3>
      <ul className="list-none">
        {[
          {
            text: "Matra corruption still appears on the fastest model — needs the phonetic fallback layer.",
          },
          {
            text: "साइट विज़िट बुकिंग का flow Cal.com से जोड़ना है — टेस्ट इसी हफ़्ते।",
            dev: true,
          },
          {
            text: "Input-gain fix reduced PSTN background noise; acceptable for the demo.",
          },
        ].map((li, i) => (
          <li
            key={i}
            className={`text-[14.5px] leading-[1.55] text-[#3b3850] pl-[18px] relative mb-2 before:content-[''] before:absolute before:left-[3px] before:top-[9px] before:w-[5px] before:h-[5px] before:rounded-full before:bg-indigo ${
              li.dev ? "dev" : ""
            }`}
          >
            {li.text}
          </li>
        ))}
      </ul>

      <h3 className="text-[14.5px] font-bold mt-6 mb-2">Action items</h3>
      <ActionItems items={meetingActionItems} />

      <div className="mt-4 flex justify-end">
        <Btn variant="lime" onClick={onOpenAsana}>
          <AsanaIcon className="w-[15px] h-[15px]" /> Send action items to Asana
        </Btn>
      </div>
    </div>
  );
}
