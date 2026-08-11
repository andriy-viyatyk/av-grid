/**
 * Copy `package.json`'s version into the two constants that quote it in `src/`.
 *
 * The version lives in three places: `package.json`, `AVGrid.version`, and the `version` export.
 * The last two are `static readonly` string literals rather than a read of `package.json`, because
 * the library ships to a browser and must not depend on the manifest being resolvable at runtime.
 * A test asserts all three agree, which means a release that forgets this step fails the build
 * rather than shipping a bundle that lies about its own version.
 *
 * Run automatically by `npm version` — see the `version` lifecycle script in `package.json`, which
 * runs after the manifest is bumped and before the commit is made, so the sync lands in the same
 * commit as the bump. Also safe to run by hand.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const { version } = JSON.parse(
    readFileSync(resolve(root, "package.json"), "utf8"),
);

if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    console.error(`sync-version: "${version}" is not a valid semver version`);
    process.exit(1);
}

/** Each site is matched by the assignment, so the string itself can be anything. */
const sites = [
    {
        file: "src/AVGrid.ts",
        pattern: /(static readonly version = ")[^"]*(")/,
    },
    {
        file: "src/index.ts",
        pattern: /(export const version = ")[^"]*(")/,
    },
];

for (const { file, pattern } of sites) {
    const path = resolve(root, file);
    const source = readFileSync(path, "utf8");

    if (!pattern.test(source)) {
        console.error(`sync-version: no version assignment found in ${file}`);
        process.exit(1);
    }

    const next = source.replace(pattern, `$1${version}$2`);
    if (next !== source) {
        writeFileSync(path, next, "utf8");
        console.log(`sync-version: ${file} → ${version}`);
    } else {
        console.log(`sync-version: ${file} already ${version}`);
    }
}
