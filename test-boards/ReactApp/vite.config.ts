import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `av-grid` resolves to the repository's live source, not to an installed package, so edits
// under ../../src hot-reload straight into this app with no build step in between. The
// packaged entry points (dist/react.js, the exports map, the optional peer deps) are exercised
// separately by examples/12-react.html, which imports the built dist/.
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: [
            { find: "av-grid/react", replacement: resolve(import.meta.dirname, "../../src/react/index.ts") },
            { find: "av-grid", replacement: resolve(import.meta.dirname, "../../src/index.ts") },
        ],
    },
});
