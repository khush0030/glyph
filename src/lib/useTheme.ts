import { useEffect, useState } from "react";
import { commands } from "./ipc";

// Theme preference persisted in the SQLite `settings` table under "theme".
// "system" tracks the OS appearance. Light values live in src/index.css :root,
// dark values under `.dark` on <html> — toggled here.
export type Theme = "light" | "dark" | "system";

const KEY = "theme";

// Module-level state so every useTheme() consumer (App applies it on load,
// Settings drives the toggle) shares one source of truth, no Redux.
let current: Theme = "system";
let loaded = false;
const subs = new Set<(t: Theme) => void>();

const mql = () => window.matchMedia("(prefers-color-scheme: dark)");

function apply(t: Theme) {
  const dark = t === "dark" || (t === "system" && mql().matches);
  document.documentElement.classList.toggle("dark", dark);
}

function emit() {
  for (const s of subs) s(current);
}

// Follow the OS while in "system" mode (re-apply and notify consumers so a
// sidebar toggle reflecting the resolved light/dark state stays in sync).
mql().addEventListener("change", () => {
  if (current === "system") {
    apply(current);
    emit();
  }
});

function resolveDark(t: Theme) {
  return t === "dark" || (t === "system" && mql().matches);
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(current);

  useEffect(() => {
    const cb = (t: Theme) => setThemeState(t);
    subs.add(cb);

    if (!loaded) {
      loaded = true;
      commands
        .getSettings()
        .then((s) => {
          current = ((s?.[KEY] as Theme) || "system");
          apply(current);
          emit();
        })
        .catch(() => apply(current));
    } else {
      setThemeState(current);
    }

    return () => {
      subs.delete(cb);
    };
  }, []);

  const setTheme = (t: Theme) => {
    current = t;
    apply(t);
    emit();
    commands.setSettings({ [KEY]: t }).catch(() => {});
  };

  const isDark = resolveDark(theme);
  // Flip to the opposite of whatever is showing (collapses "system" to explicit).
  const toggle = () => setTheme(isDark ? "light" : "dark");

  return { theme, setTheme, isDark, toggle };
}
