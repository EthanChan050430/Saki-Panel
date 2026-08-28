import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { applyPerformanceMode } from "./perf.js";
import "./styles.css";

applyPerformanceMode();
try {
  window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", () => applyPerformanceMode());
} catch {
  // Older browsers ignore live motion-preference changes.
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
