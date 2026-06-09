import type { RecordingController } from "../lib/useRecordingController";

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** App-wide recording status bar — visible on every page while a recording is
 *  active or transcribing, so it can always be seen and stopped. */
export default function RecordingBar({
  ctl,
  onView,
}: {
  ctl: RecordingController;
  onView: () => void;
}) {
  if (!ctl.recording && !ctl.transcribing) return null;

  return (
    <div className="flex items-center gap-3 px-5 py-[10px] bg-rec text-white text-[13px] font-semibold shadow-card">
      {ctl.recording ? (
        <>
          <span className="w-2 h-2 rounded-full bg-white animate-pulse-dot shrink-0" />
          <span>Recording {fmt(ctl.elapsed)}</span>
          <span className="opacity-80 font-normal">· mic + system audio</span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onView}
            className="font-semibold underline/30 hover:opacity-90 px-2 py-1"
          >
            View
          </button>
          <button
            type="button"
            onClick={ctl.stop}
            className="font-bold bg-white text-rec rounded-[8px] px-3 py-[5px] hover:opacity-90"
          >
            ■ Stop
          </button>
        </>
      ) : (
        <>
          <span className="w-2 h-2 rounded-full bg-white animate-pulse-dot shrink-0" />
          <span>{ctl.statusMsg || "Transcribing on this Mac…"}</span>
          <div className="flex-1" />
          <button type="button" onClick={onView} className="font-semibold hover:opacity-90 px-2 py-1">
            View
          </button>
        </>
      )}
    </div>
  );
}
