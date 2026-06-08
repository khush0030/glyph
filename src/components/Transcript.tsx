import { transcript } from "../lib/mock";

// Live/recorded transcript lines (mockup transcript tab). Devanagari lines keep
// their script via the .dev font — never translated.
export default function Transcript() {
  return (
    <div className="bg-surface border border-line rounded-r shadow-card px-6 py-[22px] max-w-[720px]">
      {transcript.map((l, i) => (
        <div
          key={i}
          className={`flex gap-[13px] ${i < transcript.length - 1 ? "mb-4" : ""}`}
        >
          <div
            className="w-[28px] h-[28px] rounded-[8px] text-white grid place-items-center text-[11px] font-bold shrink-0"
            style={{ background: l.color }}
          >
            {l.initial}
          </div>
          <div>
            <div className="text-[12px] text-faint mb-[2px]">
              {l.speaker} · {l.time}
            </div>
            <div
              className={`text-[#3b3850] ${
                l.lang === "dev"
                  ? "dev text-[14px] leading-[1.7]"
                  : "text-[14.5px] leading-[1.55]"
              }`}
            >
              {l.text}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
