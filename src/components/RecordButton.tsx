// The red Stop pill shown while recording (mockup .recbtn). In M0 it just
// toggles local state; real start/stop wiring lands in M1/M4.
export default function RecordButton({ onStop }: { onStop: () => void }) {
  return (
    <button
      onClick={onStop}
      className="flex items-center gap-[9px] border-none cursor-pointer bg-rec text-white font-sans text-[13.5px] font-semibold px-[17px] py-[10px] rounded-[12px] transition-[0.18s]"
    >
      <span className="w-[9px] h-[9px] rounded-full bg-white animate-pulse-dot" />
      Stop
    </button>
  );
}
