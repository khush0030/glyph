// Glyph brand mark — the dark indigo gradient square + lime ring + wordmark,
// matching design/glyph-logo.svg and the mockup .brand block.
export default function Brand() {
  return (
    <div className="flex items-center gap-[10px] px-2 pt-[2px] pb-[26px]">
      <div
        className="w-[30px] h-[30px] rounded-[9px] grid place-items-center shrink-0"
        style={{ background: "linear-gradient(150deg,#241C45,#48368E)" }}
      >
        <div className="w-[15px] h-[15px] rounded-full border-[2.5px] border-lime" />
      </div>
      <h1 className="text-[19px] font-extrabold tracking-[-0.6px]">glyph</h1>
    </div>
  );
}
