import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
    // `src/react/` imports the core by the package's own name, the specifier its published
    // declarations carry. Tests and dev builds resolve that back to source; the react bundle
    // (vite.config.react.ts) leaves it external instead.
    resolve: {
        alias: {
            "av-grid": resolve(import.meta.dirname, "src/index.ts"),
        },
    },
    build: {
        lib: {
            entry: resolve(import.meta.dirname, "src/index.ts"),
            name: "AVGrid",
            fileName: (format) =>
                format === "es" ? "av-grid.js" : "av-grid.umd.cjs",
            formats: ["es", "umd"],
        },
        // No runtime dependencies — nothing is external, everything is bundled.
        rollupOptions: {},
        sourcemap: true,
        target: "es2022",
    },
});
