import type { Config } from "tailwindcss";

// Tokens lifted verbatim from design/mockup.html :root — do not redesign.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#FAFAFC",
        surface: "#FFFFFF",
        ink: "#1A1823",
        muted: "#6C6979",
        faint: "#A4A1B2",
        line: "#EDECF2",
        "line-soft": "#F4F3F8",
        indigo: "#5A4BD4",
        "indigo-deep": "#4636AE",
        "indigo-soft": "#EFEDFC",
        lime: "#C6F24E",
        "lime-deep": "#3F5807",
        rec: "#E5484D",
        "rec-soft": "#FCEEEE",
        green: "#2F9E6B",
        "green-soft": "#E8F6EF",
        amber: "#C77D18",
        "amber-soft": "#FBF1E0",
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
        card: "0 1px 2px rgba(26,24,35,.03),0 4px 16px rgba(26,24,35,.04)",
      },
    },
  },
  plugins: [],
} satisfies Config;
