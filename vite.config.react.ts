/*
 * The `av-grid/react` bundle.
 *
 * A separate config because Vite's lib mode takes one entry per build, and this one is nothing
 * like the core's: ESM only, and — the point of the file — **the core is external**. Bundling it
 * would ship the grid twice to anyone importing both entries, and give them two module instances
 * whose injected stylesheets and `instanceof` checks disagree.
 *
 * `output.paths` rewrites the bare `av-grid` specifier to `./av-grid.js`, so the published
 * `dist/react.js` imports its sibling instead of resolving the package by name — which would
 * otherwise send a bundler back through `exports` and, in a monorepo or with a duplicated
 * install, potentially to a different copy.
 */

import { defineConfig } from "vite";
import { resolve } from "node:path";

const external = ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "av-grid"];

export default defineConfig({
    build: {
        lib: {
            entry: resolve(import.meta.dirname, "src/react/index.ts"),
            fileName: () => "react.js",
            formats: ["es"],
        },
        // Never wipe the core artifacts this build runs after.
        emptyOutDir: false,
        rollupOptions: {
            external,
            output: {
                paths: { "av-grid": "./av-grid.js" },
            },
        },
        sourcemap: true,
        target: "es2022",
    },
});
