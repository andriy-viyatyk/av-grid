import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
// No CSS import: the grid injects its own stylesheet on create. A consumer app would do the
// same — `import "av-grid/av-grid.css"` exists only for hosts that set `injectStyles: false`.

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
