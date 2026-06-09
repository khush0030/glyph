import { isDevanagari, type Segment } from "../lib/useTranscript";

function fmtTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Live transcript: committed segments from Scribe v2 plus the in-progress
// partial. Devanagari lines keep their script via the .dev font — never
// translated. When there are no live segments yet, shows a hint.
export default function Transcript({
  segments,
  partial,
  recording,
}: {
  segments: Segment[];
  partial: string;
  recording: boolean;
}) {
  const empty = segments.length === 0 && !partial;

  return (
    <div className="bg-surface border border-line rounded-r shadow-card px-6 py-[22px] max-w-[720px]">
      {empty && (
        <div className="text-[13.5px] text-faint">
          {recording
            ? "Recording… the transcript is generated on this Mac when you stop."
            : "No transcript yet. Start recording — it's transcribed locally when you stop."}
        </div>
      )}

      {segments.map((seg, i) => (
        <div key={i} className="flex gap-[13px] mb-4">
          <div className="text-[12px] text-faint w-[40px] shrink-0 pt-[1px] tabular-nums">
            {fmtTime(seg.startMs)}
          </div>
          <div
            className={`text-prose ${
              isDevanagari(seg.text)
                ? "dev text-[14px] leading-[1.7]"
                : "text-[14.5px] leading-[1.55]"
            }`}
          >
            {seg.text}
          </div>
        </div>
      ))}

      {partial && (
        <div className="flex gap-[13px]">
          <div className="text-[12px] text-faint w-[40px] shrink-0 pt-[1px]">·</div>
          <div
            className={`text-faint ${
              isDevanagari(partial)
                ? "dev text-[14px] leading-[1.7]"
                : "text-[14.5px] leading-[1.55]"
            }`}
          >
            {partial}
          </div>
        </div>
      )}
    </div>
  );
}
