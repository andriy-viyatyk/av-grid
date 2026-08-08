/**
 * Option validation and inference.
 *
 * Two jobs, both in service of the same rule from `tasks/goal.md`: the API must be usable
 * without reading the docs.
 *
 * 1. **Inference** makes the minimum call work. `AVGrid.create(el, { rows })` has to render a
 *    real grid — columns, header labels, sensible widths and a row identity — because that is
 *    the call anyone writes first.
 *
 * 2. **Validation** makes a mistake self-correcting. Every message names the offending value
 *    *and* the fix, because the reader is usually an agent that will act on the message
 *    without going anywhere else:
 *
 *        Unknown column "nmae". Available columns: id, name, email.
 *
 *    Silence is the failure mode to avoid. A grid that renders blank because a key was
 *    misspelled costs far more than a thrown error.
 */

import { detectColumnWidth } from "./column-width";
import type { AVGridOptions, ResolvedOptions } from "./options";
import type { Column, SortColumn } from "./types";

/** Rows scanned when inferring columns and widths. Enough to be representative, not enough to cost. */
const INFERENCE_SAMPLE = 50;

export class AVGridError extends Error {
    override readonly name = "AVGridError";
}

function fail(message: string): never {
    throw new AVGridError(message);
}

function describe(value: unknown): string {
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (Array.isArray(value)) return `an array of ${value.length}`;
    return `a ${typeof value}`;
}

// ---------------------------------------------------------------------------
// Container
// ---------------------------------------------------------------------------

/**
 * Resolve the first argument of `AVGrid.create` to an element.
 *
 * A CSS selector is accepted as well as an element, because `AVGrid.create("#grid", …)` is
 * what people try, and failing that call teaches nothing.
 */
export function resolveContainer(container: unknown): HTMLElement {
    if (typeof container === "string") {
        if (typeof document === "undefined") {
            fail(
                `AVGrid.create("${container}", …) needs a document to resolve the selector. ` +
                    `Pass an element instead when running outside a browser.`,
            );
        }
        const found = document.querySelector(container);
        if (!found) {
            fail(
                `No element matches the selector "${container}". ` +
                    `Check the selector, or pass the element itself: AVGrid.create(document.getElementById("grid"), { rows }).`,
            );
        }
        return found as HTMLElement;
    }

    if (
        container &&
        typeof container === "object" &&
        typeof (container as HTMLElement).appendChild === "function"
    ) {
        return container as HTMLElement;
    }

    fail(
        `AVGrid.create(container, options): container must be an element or a CSS selector, but was ${describe(container)}. ` +
            `Pass the element the grid should fill, e.g. AVGrid.create(document.getElementById("grid"), { rows }).`,
    );
}

// ---------------------------------------------------------------------------
// Inference
// ---------------------------------------------------------------------------

function sampleKeys(rows: readonly any[]): string[] {
    const keys: string[] = [];
    const seen = new Set<string>();
    const limit = Math.min(rows.length, INFERENCE_SAMPLE);

    for (let i = 0; i < limit; i++) {
        const row = rows[i];
        if (!row || typeof row !== "object") continue;
        for (const key of Object.keys(row)) {
            if (!seen.has(key)) {
                seen.add(key);
                keys.push(key);
            }
        }
    }

    return keys;
}

/** Header labels an inferred column would otherwise spell out awkwardly. */
const ACRONYMS = new Set(["id", "url", "uri", "api", "ip", "sql", "css", "html"]);

/** `user_name` / `userName` / `user-name` → `User Name`; `id` → `ID`. */
function humanize(key: string): string {
    const spaced = key
        .replace(/[_-]+/g, " ")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .trim();
    if (!spaced) return key;

    return spaced
        .split(/\s+/)
        .map((word) =>
            ACRONYMS.has(word.toLowerCase())
                ? word.toUpperCase()
                : word.charAt(0).toUpperCase() + word.slice(1),
        )
        .join(" ");
}

/** The first non-nullish value in the sample, used to guess a column's data type. */
function sampleValues(rows: readonly any[], key: string): unknown[] {
    const out: unknown[] = [];
    const limit = Math.min(rows.length, INFERENCE_SAMPLE);
    for (let i = 0; i < limit; i++) {
        const v = rows[i]?.[key];
        if (v !== null && v !== undefined) out.push(v);
    }
    return out;
}

/**
 * Build a column set from the rows themselves.
 *
 * Array rows work too — the benchmark harness uses them — in which case the keys are the
 * indices and the headers are 1-based, which is what a spreadsheet-shaped dataset wants.
 */
export function inferColumns<R>(rows: readonly R[]): Column<R>[] {
    const first = rows.find((r) => r !== null && r !== undefined);
    if (first === undefined) return [];

    if (Array.isArray(first)) {
        let width = first.length;
        const limit = Math.min(rows.length, INFERENCE_SAMPLE);
        for (let i = 0; i < limit; i++) {
            const row = rows[i] as unknown as unknown[];
            if (Array.isArray(row) && row.length > width) width = row.length;
        }
        return Array.from({ length: width }, (_, i) => ({
            key: String(i),
            name: String(i + 1),
            width: detectColumnWidth(
                rows as readonly Record<string, unknown>[],
                String(i),
                String(i + 1),
            ),
        }));
    }

    if (typeof first !== "object") {
        fail(
            `Cannot infer columns from rows of type ${typeof first}. ` +
                `Rows must be objects or arrays — or pass \`columns\` explicitly.`,
        );
    }

    return sampleKeys(rows as readonly any[]).map((key) => {
        const name = humanize(key);
        const values = sampleValues(rows as readonly any[], key);
        const allBoolean =
            values.length > 0 && values.every((v) => typeof v === "boolean");
        const allNumber =
            values.length > 0 && values.every((v) => typeof v === "number");
        const allDate =
            values.length > 0 && values.every((v) => v instanceof Date);

        const column: Column<R> = {
            key,
            name,
            width: detectColumnWidth(
                rows as readonly Record<string, unknown>[],
                key,
                name,
            ),
            resizable: true,
        };
        if (allBoolean) column.dataType = "boolean";
        else if (allNumber) column.dataType = "number";
        else if (allDate) column.displayFormat = "dateTime";
        return column;
    });
}

/**
 * Which property `inferGetRowKey` would read, if any.
 *
 * Task 14 needs the answer separately: a blank row has to be given a unique value for that
 * property, or every added row would share the key `"undefined"` and selection, focus and
 * editing would all address the same one.
 */
export function inferRowKeyProperty<R>(rows: readonly R[]): string | undefined {
    const first = rows.find((r) => r !== null && r !== undefined) as any;
    if (!first || typeof first !== "object" || Array.isArray(first)) return undefined;

    return ["id", "key", "_id", "uuid", "rowKey"].find(
        (candidate) =>
            candidate in first &&
            first[candidate] !== null &&
            first[candidate] !== undefined,
    );
}

/**
 * A stable row identity when the host did not supply one.
 *
 * Prefers an `id`-shaped property, because a host that has one expects it to be the key — it
 * is what `getState()` will show and what `onEdit` will report. Failing that, a key is
 * assigned per row *object* and remembered in a `WeakMap`, which survives sorting and
 * filtering (they reorder the same objects) but not a `setRows()` that rebuilds them.
 */
export function inferGetRowKey<R>(rows: readonly R[]): (row: R) => string {
    const candidate = inferRowKeyProperty(rows);
    if (candidate !== undefined) {
        return (row: R) => String((row as any)?.[candidate]);
    }

    const assigned = new WeakMap<object, string>();
    let next = 0;
    return (row: R): string => {
        if (row === null || row === undefined) return "";
        if (typeof row !== "object") return String(row);
        let key = assigned.get(row as object);
        if (key === undefined) {
            key = `r${next++}`;
            assigned.set(row as object, key);
        }
        return key;
    };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function available(columns: readonly Column<any>[]): string {
    if (!columns.length) return "the grid has no columns";
    return `Available columns: ${columns.map((c) => String(c.key)).join(", ")}.`;
}

export function validateColumns<R>(
    columns: unknown,
    rows: readonly R[],
    /**
     * Keys allowed to match nothing in the data.
     *
     * The "unknown column" check catches a typo at `create()`, where the host's word is all the
     * grid has. Once columns can be *added*, that same check would reject the normal case — a
     * column exists before anything has been typed into it — so `addColumns` exempts what it is
     * adding and `setColumns` exempts the columns the grid already has.
     */
    exemptKeys?: ReadonlySet<string>,
): Column<R>[] {
    if (!Array.isArray(columns)) {
        fail(
            `\`columns\` must be an array, but was ${describe(columns)}. ` +
                `Omit it entirely to infer the columns from the rows.`,
        );
    }

    const seen = new Set<string>();
    const sample = rows.find((r) => r !== null && r !== undefined) as any;

    columns.forEach((column, index) => {
        if (!column || typeof column !== "object") {
            fail(
                `columns[${index}] must be an object like { key: "name" }, but was ${describe(column)}.`,
            );
        }
        const key = (column as Column<R>).key;
        if (typeof key !== "string" || !key.length) {
            fail(
                `columns[${index}] has no \`key\`. Every column needs one: { key: "name", name: "Name" }. ` +
                    `The key is the property read from each row, and the column's identity everywhere in the API.`,
            );
        }
        if (seen.has(key)) {
            fail(
                `Duplicate column key "${key}" at columns[${index}]. ` +
                    `Column keys must be unique — they identify the column in sort, filters, focus and events.`,
            );
        }
        seen.add(key);

        // A key that matches nothing in the data renders an empty column and looks like a
        // rendering bug. Two exemptions: computed columns never read the row property, and a
        // column being *added* is empty by definition — the data arrives when it is typed in.
        const col = column as Column<R>;
        const computed = Boolean(col.render || col.formatValue || col.isStatusColumn);
        if (
            !computed &&
            !exemptKeys?.has(key) &&
            sample &&
            typeof sample === "object" &&
            !(key in sample)
        ) {
            fail(
                `Unknown column "${key}". ${available(
                    Object.keys(sample).map((k) => ({ key: k })),
                )} ` +
                    `If the column is computed rather than read from the row, give it a \`render\` function.`,
            );
        }
    });

    return columns as Column<R>[];
}

export function validateSort<R>(
    sort: unknown,
    columns: readonly Column<R>[],
): SortColumn | undefined {
    if (sort === undefined || sort === null) return undefined;

    if (typeof sort !== "object") {
        fail(
            `\`sort\` must be an object like { key: "name", direction: "asc" }, but was ${describe(sort)}.`,
        );
    }

    const { key, direction } = sort as SortColumn;
    if (typeof key !== "string" || !key.length) {
        fail(`\`sort.key\` must be a column key, but was ${describe(key)}.`);
    }
    if (!columns.some((c) => String(c.key) === key)) {
        fail(`Unknown column "${key}" in \`sort\`. ${available(columns)}`);
    }
    if (direction !== "asc" && direction !== "desc") {
        fail(
            `\`sort.direction\` must be "asc" or "desc", but was ${JSON.stringify(direction)}.`,
        );
    }

    return { key, direction };
}

/**
 * Check every option, fill in every default, and return the resolved form the models use.
 *
 * Called from `create()` and again from `setOptions()`, so a bad value passed later fails the
 * same way as a bad value passed up front.
 */
export function resolveOptions<R>(options: unknown): ResolvedOptions<R> {
    if (!options || typeof options !== "object") {
        fail(
            `AVGrid.create(container, options): options is required and must be an object, but was ${describe(options)}. ` +
                `The minimum call is AVGrid.create(el, { rows: [{ id: 1, name: "Ada" }] }).`,
        );
    }

    const o = options as AVGridOptions<R>;

    if (!Array.isArray(o.rows)) {
        fail(
            `\`rows\` must be an array, but was ${describe(o.rows)}. ` +
                `Pass an empty array to render an empty grid: AVGrid.create(el, { rows: [] }).`,
        );
    }

    if (o.rowHeight !== undefined) {
        if (typeof o.rowHeight !== "number" || !(o.rowHeight > 0)) {
            fail(
                `\`rowHeight\` must be a positive number of pixels, but was ${describe(o.rowHeight)}. ` +
                    `Omit it for the default of 24.`,
            );
        }
    }

    if (o.getRowKey !== undefined && typeof o.getRowKey !== "function") {
        fail(
            `\`getRowKey\` must be a function taking a row and returning a string, but was ${describe(o.getRowKey)}. ` +
                `For example: getRowKey: (row) => String(row.id). Omit it to infer one.`,
        );
    }

    // The commonest way to get this wrong is to pass row *objects*, or indices, because
    // "selected rows" sounds like it means rows. It means what `getRowKey` returns.
    if (o.selected !== undefined) {
        if (!Array.isArray(o.selected)) {
            fail(
                `\`selected\` must be an array of row keys, but was ${describe(o.selected)}. ` +
                    `For example: selected: rows.slice(0, 3).map(getRowKey).`,
            );
        }
        const bad = o.selected.find((k) => typeof k !== "string");
        if (bad !== undefined) {
            fail(
                `\`selected\` must contain row keys as strings, but contained ${describe(bad)}. ` +
                    `A row key is what getRowKey returns — not a row object or a row index.`,
            );
        }
    }

    const columns =
        o.columns === undefined
            ? inferColumns<R>(o.rows)
            : validateColumns<R>(o.columns, o.rows);

    // Validated for its own sake; the resolved value is read from the model, not from here.
    validateSort(o.sort, columns);

    return {
        ...o,
        columns,
        getRowKey: o.getRowKey ?? inferGetRowKey(o.rows),
        rowHeight: o.rowHeight ?? 24,
    };
}
