// Small presentational primitives that map 1:1 to the mockup's CSS classes.
// Kept tiny on purpose — no abstraction beyond reusing Tailwind class strings.
import { useState, type ReactNode } from "react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-surface border border-line rounded-r shadow-card overflow-hidden ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionHead({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mt-[30px] mb-[14px]">
      <span className="text-[12px] font-bold tracking-[0.7px] uppercase text-faint">
        {title}
      </span>
      {action}
    </div>
  );
}

export function Tag({ type }: { type: "Client" | "Internal" }) {
  const cls =
    type === "Client"
      ? "bg-indigo-soft text-indigo-deep"
      : "bg-line-soft text-muted";
  return (
    <span
      className={`text-[10.5px] font-semibold px-[9px] py-[2.5px] rounded-[20px] ${cls}`}
    >
      {type}
    </span>
  );
}

export function Badge({
  color,
  children,
}: {
  color: string;
  children: ReactNode;
}) {
  return (
    <span className="text-[11px] font-semibold text-muted inline-flex items-center gap-[5px]">
      <span
        className="w-[6px] h-[6px] rounded-full"
        style={{ background: color }}
      />
      {children}
    </span>
  );
}

/** Segmented control. Uncontrolled by default; pass `value`+`onChange` to
 *  control it (e.g. persisted settings). */
export function Seg({
  options,
  initial = 0,
  title,
  value,
  onChange,
}: {
  options: ReactNode[];
  initial?: number;
  title?: string;
  value?: number;
  onChange?: (index: number) => void;
}) {
  const [internal, setInternal] = useState(initial);
  const on = value ?? internal;
  const select = (i: number) => {
    if (value === undefined) setInternal(i);
    onChange?.(i);
  };
  return (
    <span
      title={title}
      className="inline-flex bg-bg border border-line rounded-[9px] p-[2px]"
    >
      {options.map((label, i) => (
        <button
          key={i}
          type="button"
          onClick={() => select(i)}
          className={`border-none font-semibold text-[11.5px] px-[11px] py-[5px] rounded-[7px] cursor-pointer transition-[0.14s] ${
            on === i
              ? "bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,.05)]"
              : "bg-transparent text-muted"
          }`}
        >
          {label}
        </button>
      ))}
    </span>
  );
}

type BtnVariant = "default" | "primary" | "lime" | "ghost";
export function Btn({
  children,
  variant = "default",
  sm = false,
  onClick,
}: {
  children: ReactNode;
  variant?: BtnVariant;
  sm?: boolean;
  onClick?: () => void;
}) {
  const base =
    "font-semibold cursor-pointer transition-[0.15s] inline-flex items-center gap-2 whitespace-nowrap";
  const size = sm
    ? "text-[12.5px] px-[11px] py-[7px] rounded-[9px]"
    : "text-[13.5px] px-[15px] py-[10px] rounded-rs";
  const variants: Record<BtnVariant, string> = {
    default: "border border-line bg-surface text-ink hover:border-faint",
    primary: "border border-indigo bg-indigo text-white hover:bg-indigo-deep",
    lime: "border border-lime bg-lime text-lime-deep",
    ghost: "border border-transparent bg-line-soft text-ink",
  };
  return (
    <button onClick={onClick} className={`${base} ${size} ${variants[variant]}`}>
      {children}
    </button>
  );
}

/** Connected pill used on Calendar header & Settings. */
export function ConnPill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-green bg-green-soft px-3 py-[6px] rounded-[20px]">
      <span className="w-[7px] h-[7px] rounded-full bg-green" />
      {children}
    </span>
  );
}
