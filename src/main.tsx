import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import PromptWindow from "./PromptWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
// Self-hosted fonts (bundled into the app) — a desktop webview can't be relied
// on to fetch Google Fonts over the network, so ship the weights we use.
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";
import "@fontsource/plus-jakarta-sans/800.css";
import "@fontsource/noto-sans-devanagari/400.css";
import "@fontsource/noto-sans-devanagari/500.css";
import "@fontsource/noto-sans-devanagari/600.css";
import "./index.css";

// The same bundle serves both Tauri windows; pick the root by window label.
// Outside Tauri (plain browser during UI work) getCurrentWindow throws → App.
const isPromptWindow = (() => {
  try {
    return getCurrentWindow().label === "prompt";
  } catch {
    return false;
  }
})();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{isPromptWindow ? <PromptWindow /> : <App />}</React.StrictMode>
);
