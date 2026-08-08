import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
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
