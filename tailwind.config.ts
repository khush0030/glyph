import type { Config } from "tailwindcss";

// Color tokens are CSS variables (space-separated RGB channels) so the same
// utility classes (`bg-bg`, `text-ink`, `border-line`…) flip between the light
// and dark palettes defined in src/index.css. Light values lifted verbatim from
// design/mockup.html :root — do not redesign.
const c = (v: string) => `rgb(var(${v}) / <alpha-value>)`;

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: c("--c-bg"),
        surface: c("--c-surface"),
        ink: c("--c-ink"),
        prose: c("--c-prose"),
        muted: c("--c-muted"),
        faint: c("--c-faint"),
        line: c("--c-line"),
        "line-soft": c("--c-line-soft"),
        indigo: c("--c-indigo"),
        "indigo-deep": c("--c-indigo-deep"),
        "indigo-soft": c("--c-indigo-soft"),
        lime: c("--c-lime"),
        "lime-deep": c("--c-lime-deep"),
        rec: c("--c-rec"),
        "rec-soft": c("--c-rec-soft"),
        green: c("--c-green"),
        "green-soft": c("--c-green-soft"),
        amber: c("--c-amber"),
        "amber-soft": c("--c-amber-soft"),
      },
      borderRadius: {
        r: "18px",
        rs: "11px",
        rl: "24px",
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', "sans-serif"],
        dev: ['"Noto Sans Devanagari"', "sans-serif"],
      },
      boxShadow: {
        card: "var(--shadow-card)",
      },
    },
  },
  plugins: [],
} satisfies Config;
