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

import { detectColumnWidth, widthForValues } from "./column-width";
import { columnDisplayValue, gatherByGroup, isChromeColumn, isPinnedLeft } from "./gridUtils";
import { isTextFilterOp, textFilterOpNeedsText, TEXT_FILTER_OPS } from "./textFilterOps";
import type { AVGridOptions, ResolvedOptions } from "./options";
import type {
    AnyFilter,
    Column,
    DisplayOption,
    Filter,
    FilterDefinition,
    PersistFiltersOptions,
    SortColumn,
    TextFilterValue,
} from "./types";

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

function available(keys: readonly string[]): string {
    if (!keys.length) return "the grid has no columns";
    return `Available columns: ${keys.join(", ")}.`;
}

/**
 * Does any row past the inference sample carry this key?
 *
 * The slow half of the unknown-column check, and it runs only on the branch that is about to
 * throw. Sparse data is the reason: a key that appears for the first time at row 5,000 is a
 * perfectly good column, and rejecting it would blank the grid over data that is merely
 * heterogeneous. Scanning every row on the happy path to find that out would make the common
 * case pay for the rare one, so the sample decides first and this only ever answers "wait, it
 * is there after all" — for a typo it is one pass with no early exit, once, at `create()`.
 */
function anyRowHasKey(rows: readonly any[], key: string, from: number): boolean {
    for (let i = from; i < rows.length; i++) {
        const row = rows[i];
        if (row && typeof row === "object" && key in row) return true;
    }
    return false;
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
    /** `externalFilter` — a filter definition may omit `match` while the host filters. */
    matchOptional?: boolean,
): Column<R>[] {
    if (!Array.isArray(columns)) {
        fail(
            `\`columns\` must be an array, but was ${describe(columns)}. ` +
                `Omit it entirely to infer the columns from the rows.`,
        );
    }

    const seen = new Set<string>();
    // The union over the inference sample, not the keys of the first row.
    //
    // One row is the wrong oracle for "does this key exist in the data": heterogeneous JSON is
    // ordinary, and `[{a:1},{a:2,b:3}]` with columns `[a, b]` is correct input that a row-0 check
    // rejects — a blank grid over good data, which is the failure this check exists to prevent.
    // Sampling the same 50 rows `inferColumns` samples also settles a self-contradiction: the grid
    // used to reject a column set it would have inferred itself, so `create({ rows })` and
    // `create({ rows, columns: inferColumns(rows) })` could disagree. They cannot now.
    const sampledKeys = sampleKeys(rows as readonly any[]);
    const sampled = new Set(sampledKeys);
    const hasSample = sampledKeys.length > 0;

    // Right pinning is positional: the pinned columns must be the *trailing* run of the
    // visible columns. Tracked across the loop below, over non-hidden columns only — a hidden
    // pinned column just shortens the run.
    let firstUnpinnedKey: string | undefined;
    let lastPinnedRightKey: string | undefined;

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

        const col = column as Column<R>;
        if (col.filter !== undefined) {
            validateFilterDefinition(col.filter, key, matchOptional);
        }

        if (
            col.pinned !== undefined &&
            col.pinned !== "left" &&
            col.pinned !== "right"
        ) {
            fail(
                `Column "${key}" has pinned: ${describe(col.pinned)}. ` +
                    `The only values are "left" and "right".`,
            );
        }
        if (col.pinned === "right" && col.isStatusColumn) {
            fail(
                `Column "${key}" has both isStatusColumn: true and pinned: "right". ` +
                    `isStatusColumn means pinned left — a column cannot be pinned to both edges.`,
            );
        }
        if (
            (col.pinned !== undefined || col.isStatusColumn) &&
            typeof col.width === "string"
        ) {
            fail(
                `Column "${key}" is pinned but has width: "${col.width}". ` +
                    `A pinned column needs a fixed width in pixels — a percentage is resolved ` +
                    `by stretching the scrolling columns to fit, which a pinned band is outside of.`,
            );
        }
        if (col.group !== undefined && typeof col.group !== "string") {
            fail(
                `Column "${key}" has group: ${describe(col.group)}. ` +
                    `A group is its label — a string shared by the columns under one group cell.`,
            );
        }
        if (col.group !== undefined && (col.pinned !== undefined || col.isStatusColumn)) {
            fail(
                `Column "${key}" is pinned and has group: "${col.group}". ` +
                    `Group cells live in the scrolling band, so a pinned column cannot be ` +
                    `grouped — unpin it, or drop the group.`,
            );
        }
        if (col.textFilterOps !== undefined) {
            validateTextFilterOps(col.textFilterOps, col, key);
        }

        if (!col.hidden) {
            if (col.pinned === "right") {
                lastPinnedRightKey = key;
            } else if (lastPinnedRightKey !== undefined) {
                fail(
                    `Column "${key}" follows the pinned: "right" column "${lastPinnedRightKey}" ` +
                        `but is not pinned itself. Right-pinned columns must be the trailing ` +
                        `columns — move "${key}" before them, or pin it too.`,
                );
            }
            // The mirror rule: left pinning is positional too, so the left-pinned columns
            // must be the LEADING run. An interleaved one would silently drag every column
            // before it into the sticky band (the band is "up to the last pinned-left index").
            if (isPinnedLeft(col)) {
                if (firstUnpinnedKey !== undefined) {
                    fail(
                        `Column "${key}" is pinned left but follows the unpinned column ` +
                            `"${firstUnpinnedKey}". Left-pinned columns (isStatusColumn or ` +
                            `pinned: "left") must be the leading columns — move "${key}" ` +
                            `before "${firstUnpinnedKey}", or unpin it.`,
                    );
                }
            } else if (firstUnpinnedKey === undefined && col.pinned !== "right") {
                firstUnpinnedKey = key;
            }
        }

        // A key that matches nothing in the data renders an empty column and looks like a
        // rendering bug. Two exemptions: computed columns never read the row property, and a
        // column being *added* is empty by definition — the data arrives when it is typed in.
        const computed = Boolean(col.render || col.formatValue || isChromeColumn(col));
        if (
            !computed &&
            !exemptKeys?.has(key) &&
            hasSample &&
            !sampled.has(key) &&
            !anyRowHasKey(rows as readonly any[], key, INFERENCE_SAMPLE)
        ) {
            fail(
                `Unknown column "${key}". ${available(sampledKeys)} ` +
                    `If the column is computed rather than read from the row, give it a \`render\` function.`,
            );
        }
    });

    return withDetectedWidths(columns as Column<R>[], rows);
}

/**
 * Give every column that omitted `width` one measured from its content.
 *
 * `docs/api.md` has always said "omitted, the width is detected from the content and the
 * header", and for a long time that was only true of *inferred* columns: naming the columns
 * yourself — which is what anyone does the moment they want a header label — silently opted
 * every one of them into a flat 140px. The first host to hit it re-ran `inferColumns()` over a
 * probe of display text purely to copy the widths back off it.
 *
 * Measured through `columnDisplayValue`, so `formatValue` and `displayFormat` are what gets
 * measured. That is stricter than the inferred path was on its own and fixes the same class of
 * mistake: a `Date` column sized to `toLocaleString()` rather than to the `displayFormat` the
 * cell will actually render.
 *
 * Columns are copied rather than written through — the array belongs to the host, and a grid
 * that mutated it would leak its defaults into whatever else that host does with it.
 */
function withDetectedWidths<R>(
    columns: Column<R>[],
    rows: readonly R[],
): Column<R>[] {
    if (!columns.some((c) => c.width === undefined)) return columns;

    const limit = Math.min(rows.length, INFERENCE_SAMPLE);
    return columns.map((column) => {
        if (column.width !== undefined) return column;

        const values: unknown[] = [];
        for (let i = 0; i < limit; i++) {
            const row = rows[i];
            if (row === null || row === undefined) continue;
            const value = columnDisplayValue(column, row);
            if (value !== null && value !== undefined) values.push(value);
        }

        // Nothing to measure — an empty grid, or the column `addColumns` has just created,
        // whose data arrives when it is typed in. Sizing those to the header alone would make
        // a new column the narrowest thing on screen at the moment it most needs room, so
        // leave `width` unset and let `defaultColumnWidth` answer.
        if (!values.length) return column;

        const name = column.name ?? String(column.key);
        return { ...column, width: widthForValues(values, name) };
    });
}

/**
 * Check a column's `filter` definition at `create()`, where the column key is still in hand.
 *
 * A definition missing `match` would filter nothing and one missing `label` would draw a blank
 * chip — both silent, and silence is the failure mode this file exists to prevent. The message
 * names the column and the field, because it is usually read by whoever can fix it in one edit.
 *
 * `matchOptional` is `externalFilter`: with the host filtering the rows, `match` never runs and
 * requiring a `match: () => true` on every column would be the workaround that option exists to
 * remove. The flag is re-checked when `externalFilter` is toggled off at runtime, so a
 * definition accepted without one can never silently keep every row.
 */
function validateFilterDefinition(
    filter: unknown,
    columnKey: string,
    matchOptional?: boolean,
): void {
    if (!filter || typeof filter !== "object") {
        fail(
            `Column "${columnKey}" has a \`filter\` that is ${describe(filter)}. ` +
                `It must be a filter definition: { name, create, label, match }.`,
        );
    }

    const f = filter as FilterDefinition;
    if (typeof f.name !== "string" || !f.name.length) {
        fail(
            `Column "${columnKey}" has a \`filter\` with no \`name\`. ` +
                `The name identifies the filter type and is what persistence stores: ` +
                `{ name: "dateRange", create, label, match }.`,
        );
    }

    const required: [keyof FilterDefinition, string][] = [
        ["create", "create: (ctx) => ({ element, getValue })   // the popover body"],
        ["label", "label: (value, column) => String(value)     // the chip's text"],
    ];
    if (!matchOptional) {
        required.push([
            "match",
            "match: (value, row, column) => boolean      // keep the row?",
        ]);
    }
    for (const [field, example] of required) {
        if (typeof f[field] !== "function") {
            fail(
                `Column "${columnKey}" has a \`filter\` named "${f.name}" with no \`${field}\` ` +
                    `function (it was ${describe(f[field])}).` +
                    (field === "match" && !matchOptional
                        ? ` Without it the filter would keep every row. Add:\n    ${example}\n` +
                          `(\`match\` may be omitted only with \`externalFilter: true\`, where ` +
                          `the host filters the rows.)`
                        : ` Add:\n    ${example}`),
            );
        }
    }
    if (matchOptional && f.match !== undefined && typeof f.match !== "function") {
        fail(
            `Column "${columnKey}": \`filter.match\` must be a function when present, but was ` +
                `${describe(f.match)}.`,
        );
    }

    for (const field of ["serialize", "deserialize"] as const) {
        if (f[field] !== undefined && typeof f[field] !== "function") {
            fail(
                `Column "${columnKey}": \`filter.${field}\` must be a function, but was ` +
                    `${describe(f[field])}. Omit it unless the value is not JSON-shaped.`,
            );
        }
    }
}

export function validateSort<R>(
    sort: unknown,
    columns: readonly Column<R>[],
    multiSort?: boolean,
): SortColumn | readonly SortColumn[] | undefined {
    if (sort === undefined || sort === null) return undefined;

    if (Array.isArray(sort)) {
        if (!multiSort) {
            fail(
                `\`sort\` is an array, but \`multiSort\` is off. Pass a single ` +
                    `{ key, direction } object, or set \`multiSort: true\` to sort by several columns.`,
            );
        }
        const list = sort.map((s, i) => validateOneSort(s, columns, `sort[${i}]`));
        const seen = new Set<string>();
        for (const s of list) {
            if (seen.has(s.key)) {
                fail(
                    `Column "${s.key}" appears twice in \`sort\` — each column may sort once.`,
                );
            }
            seen.add(s.key);
        }
        return list;
    }

    return validateOneSort(sort, columns, "sort");
}

function validateOneSort<R>(
    sort: unknown,
    columns: readonly Column<R>[],
    label: string,
): SortColumn {
    if (typeof sort !== "object" || sort === null) {
        fail(
            `\`${label}\` must be an object like { key: "name", direction: "asc" }, but was ${describe(sort)}.`,
        );
    }

    const { key, direction } = sort as SortColumn;
    if (typeof key !== "string" || !key.length) {
        fail(`\`${label}.key\` must be a column key, but was ${describe(key)}.`);
    }
    if (!columns.some((c) => String(c.key) === key)) {
        fail(`Unknown column "${key}" in \`${label}\`. ${available(columns.map((c) => String(c.key)))}`);
    }
    if (direction !== "asc" && direction !== "desc") {
        fail(
            `\`${label}.direction\` must be "asc" or "desc", but was ${JSON.stringify(direction)}.`,
        );
    }

    return { key, direction };
}

/**
 * Check a filter list and return it normalized — `columnName` and `type` filled in from the
 * column, and an options filter's bare values expanded into `{ value, label }`.
 *
 * Everything downstream (the row filter, the chips, the popover) reads the normalized form, so
 * this runs on every path a filter can enter by: `create()`, `setFilters()`, `applyFilter()`
 * and the restore from storage.
 */
export function validateFilters<R>(
    filters: unknown,
    columns: readonly Column<R>[],
): Filter[] {
    if (filters === undefined || filters === null) return [];

    if (!Array.isArray(filters)) {
        fail(
            `\`filters\` must be an array, but was ${describe(filters)}. ` +
                `Pass an empty array to clear the filters.`,
        );
    }

    return filters.map((filter, index) => {
        if (!filter || typeof filter !== "object") {
            fail(
                `\`filters[${index}]\` must be an object like ` +
                    `{ columnKey: "status", value: ["open"] }, but was ${describe(filter)}.`,
            );
        }

        const f = filter as AnyFilter;
        const columnKey = f.columnKey;
        if (typeof columnKey !== "string" || !columnKey.length) {
            fail(
                `\`filters[${index}].columnKey\` must be a column key, but was ${describe(columnKey)}.`,
            );
        }

        const column = columns.find((c) => String(c.key) === columnKey);
        if (!column) {
            fail(
                `Unknown column "${columnKey}" in \`filters[${index}]\`. ${available(columns.map((c) => String(c.key)))}`,
            );
        }

        // The column's own definition decides the type, not the filter: a filter is written by
        // hand — `{ columnKey, value }` — and having to name the type as well would be a second
        // place to get it wrong.
        const definition = column.filter;
        const type = definition ? definition.name : (f.type ?? column.filterType ?? "options");
        if (!definition && type !== "options" && type !== "text") {
            fail(
                `\`filters[${index}].type\` is ${JSON.stringify(type)}, but column ` +
                    `"${columnKey}" has no \`filter\` definition of that name — so nothing knows ` +
                    `how to match it. Either give the column a \`filter\`, or use a built-in ` +
                    `type: "options" (a checklist) or "text" (contains / equals / starts with).`,
            );
        }
        if (definition && f.type !== undefined && f.type !== definition.name) {
            fail(
                `\`filters[${index}].type\` is ${JSON.stringify(f.type)}, but column ` +
                    `"${columnKey}" is filtered by "${definition.name}". Omit \`type\` — it is ` +
                    `taken from the column.`,
            );
        }

        const normalized: AnyFilter = {
            ...f,
            columnKey,
            columnName: f.columnName ?? column.name ?? columnKey,
            type,
            displayFormat: f.displayFormat ?? column.displayFormat,
            value: f.value,
        };

        // A custom filter's value is whatever its own `getValue` returns — an object, a pair of
        // numbers, a regexp. Only the built-in types have a shape to normalize.
        if (definition) return normalized;

        if (type === "text") {
            normalized.value = normalizeTextValue(normalized.value, index);
            return normalized;
        }

        if (normalized.value !== undefined && normalized.value !== null) {
            if (!Array.isArray(normalized.value)) {
                fail(
                    `\`filters[${index}].value\` must be an array of the values to keep, but was ` +
                        `${describe(normalized.value)}. For example: value: ["open", "closed"]. ` +
                        `Omit it — or pass an empty array — to remove the filter.`,
                );
            }
            normalized.value = normalized.value.map((option: any) =>
                option !== null && typeof option === "object" && "value" in option
                    ? (option as DisplayOption)
                    : { value: option, label: String(option ?? "") },
            );
        }

        return normalized;
    });
}

/**
 * `Column.textFilterOps`: the chips the text popover offers. A non-empty list of known operators,
 * no duplicates, and only where the built-in `"text"` filter will read it — on any other column
 * the field would render nothing, and an agent that set it expects chips.
 */
function validateTextFilterOps<R>(ops: unknown, col: Column<R>, key: string): void {
    const where = `Column "${key}" has \`textFilterOps\``;
    if (col.filter !== undefined || col.filterType !== "text") {
        const actual = col.filter
            ? `the custom "${col.filter.name}" definition`
            : `filterType: ${JSON.stringify(col.filterType ?? "options")}`;
        fail(
            `${where} but its filter is ${actual}. The operator chips belong to the built-in ` +
                `text filter — set filterType: "text" on this column, or drop textFilterOps.`,
        );
    }
    if (!Array.isArray(ops) || !ops.length) {
        fail(
            `${where}: ${describe(ops)}. It must be a non-empty array of operators, ` +
                `for example ["contains", "equals", "blank"]. Omit it for the default three.`,
        );
    }
    const seen = new Set<string>();
    for (const op of ops) {
        if (!isTextFilterOp(op)) {
            fail(
                `${where} containing ${JSON.stringify(op)}. The operators are ` +
                    `${TEXT_FILTER_OPS.map((o) => `"${o}"`).join(", ")}.`,
            );
        }
        if (seen.has(op)) {
            fail(`${where} listing "${op}" twice.`);
        }
        seen.add(op);
    }
}

/**
 * Normalize a `"text"` filter's value to `{ op, text }` (or `{ op }` for a text-free operator),
 * or to `undefined` — the shape the row test, the chips and persistence all read.
 *
 * A bare string is the shortest thing a caller can write, so it is accepted and given the
 * default operator; `op` alone may be omitted for the same reason. The text is trimmed — a
 * trailing space silently failing `equals` is the kind of bug nobody can see — and trimmed-empty
 * text means no filter at all, the same nullish rule the checklist follows.
 *
 * `blank` / `notBlank` carry no text: a `text` supplied beside one is dropped rather than
 * rejected, so a host toggling the op on a value it holds need not strip the field. Every
 * operator is accepted on every text column — the popover's chip list is not consulted here.
 */
function normalizeTextValue(value: unknown, index: number): TextFilterValue | undefined {
    if (value === undefined || value === null) return undefined;

    if (typeof value === "string") {
        const text = value.trim();
        return text.length ? { op: "contains", text } : undefined;
    }

    if (typeof value !== "object") {
        fail(
            `\`filters[${index}].value\` on a "text" filter must be a string or ` +
                `{ op, text }, but was ${describe(value)}. ` +
                `For example: value: "smith", or value: { op: "startsWith", text: "smi" }.`,
        );
    }

    const v = value as { op?: unknown; text?: unknown };
    const op = v.op ?? "contains";
    if (!isTextFilterOp(op)) {
        fail(
            `\`filters[${index}].value.op\` must be one of ` +
                `${TEXT_FILTER_OPS.map((o) => `"${o}"`).join(", ")}, but was ${describe(v.op)}.`,
        );
    }
    if (!textFilterOpNeedsText(op)) {
        return { op } as TextFilterValue;
    }
    if (typeof v.text !== "string") {
        fail(
            `\`filters[${index}].value.text\` must be a string, but was ${describe(v.text)}. ` +
                `Omit the value entirely to remove the filter.`,
        );
    }

    const text = v.text.trim();
    return text.length ? ({ op, text } as TextFilterValue) : undefined;
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

    if (o.footerRows !== undefined && !Array.isArray(o.footerRows)) {
        fail(
            `\`footerRows\` must be an array of rows, but was ${describe(o.footerRows)}. ` +
                `For example: footerRows: [{ label: "Total", spend: 4812500 }]. ` +
                `Omit it for no footer.`,
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
            : // Same-group columns are gathered together up front, so the model is built on
              // the normalized order — `ColumnsModel.setColumns` does the same for later sets.
              gatherByGroup(
                  validateColumns<R>(
                      o.columns,
                      o.rows,
                      undefined,
                      Boolean(o.externalFilter),
                  ),
              );

    // Validated for its own sake; the resolved value is read from the model, not from here.
    validateSort(o.sort, columns, Boolean(o.multiSort));

    if (o.persistFilters !== undefined) {
        const p = o.persistFilters as PersistFiltersOptions;
        if (!p || typeof p !== "object" || typeof p.name !== "string" || !p.name.length) {
            fail(
                `\`persistFilters\` must be an object like { name: "orders" }, but was ` +
                    `${describe(o.persistFilters)}. The name becomes the storage key.`,
            );
        }
    }

    return {
        ...o,
        columns,
        // Normalized here so the models never see a half-written filter, whichever way it
        // arrived — the option, `setFilters()`, or a restore from storage.
        filters: validateFilters<R>(o.filters, columns),
        getRowKey: o.getRowKey ?? inferGetRowKey(o.rows),
        rowHeight: o.rowHeight ?? 24,
    };
}
