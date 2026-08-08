/**
 * Emit `dist/av-grid.css` from the stylesheet's single source of truth.
 *
 * The sheet lives in `src/styles/av-grid.css.ts` as an exported string, because the library
 * injects it at runtime — a grid created with one line of JavaScript has to look like a grid,
 * with no CSS import to remember. Hosts that prefer to link a stylesheet get this file, which
 * is generated from the same string so the two can never drift.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(root, "src/styles/av-grid.css.ts"), "utf8");

const match = source.match(/export const css = `([\s\S]*?)`;/);
if (!match) {
    console.error(
        "build-css: could not find `export const css = \\`…\\`;` in src/styles/av-grid.css.ts",
    );
    process.exit(1);
}

const banner =
    "/* av-grid — generated from src/styles/av-grid.css.ts. Do not edit. */\n";

const out = resolve(root, "dist/av-grid.css");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, banner + match[1].trimStart(), "utf8");

console.log(`build-css: wrote ${out}`);
