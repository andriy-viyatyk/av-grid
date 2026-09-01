import { describe, expect, it } from "vitest";
import {
    AVGridError,
    inferColumns,
    inferGetRowKey,
    resolveOptions,
    validateColumns,
    validateSort,
} from "./validate";

const people = [
    { id: 1, firstName: "Ada", active: true, score: 10 },
    { id: 2, firstName: "Alan", active: false, score: 20 },
];

describe("inferColumns", () => {
    it("builds a column per key of the sampled rows", () => {
        const columns = inferColumns(people);
        expect(columns.map((c) => c.key)).toEqual([
            "id",
            "firstName",
            "active",
            "score",
        ]);
    });

    it("humanizes the key into a header label", () => {
        expect(inferColumns(people)[1].name).toBe("First Name");
        expect(inferColumns([{ user_name: "x" }])[0].name).toBe("User Name");
        // Acronyms read badly title-cased — "Id" is a typo, "ID" is a column.
        expect(inferColumns(people)[0].name).toBe("ID");
    });

    it("infers dataType from the sampled values", () => {
        const columns = inferColumns(people);
        expect(columns.find((c) => c.key === "active")?.dataType).toBe("boolean");
        expect(columns.find((c) => c.key === "score")?.dataType).toBe("number");
        expect(columns.find((c) => c.key === "firstName")?.dataType).toBeUndefined();
    });

    it("picks up keys that only later rows have", () => {
        const columns = inferColumns([{ a: 1 }, { a: 2, b: 3 }]);
        expect(columns.map((c) => c.key)).toEqual(["a", "b"]);
    });

    it("handles array rows, which the benchmark harness uses", () => {
        const columns = inferColumns([
            [1, "x"],
            [2, "y"],
        ]);
        expect(columns.map((c) => c.key)).toEqual(["0", "1"]);
        // 1-based labels, the way a spreadsheet numbers its columns.
        expect(columns.map((c) => c.name)).toEqual(["1", "2"]);
    });

    it("returns nothing for no rows rather than throwing", () => {
        expect(inferColumns([])).toEqual([]);
    });
});

describe("inferGetRowKey", () => {
    it("prefers an id-shaped property", () => {
        const getRowKey = inferGetRowKey(people);
        expect(getRowKey(people[0])).toBe("1");
        expect(getRowKey(people[1])).toBe("2");
    });

    it("assigns a stable identity when there is no id", () => {
        const rows = [{ a: 1 }, { a: 2 }];
        const getRowKey = inferGetRowKey(rows);
        const first = getRowKey(rows[0]);

        expect(getRowKey(rows[1])).not.toBe(first);
        // The identity must survive a re-sort, which reorders the same objects.
        expect(getRowKey(rows[0])).toBe(first);
    });
});

describe("validateColumns", () => {
    it("names the fix when a key matches nothing in the data", () => {
        expect(() => validateColumns([{ key: "nmae" }], people)).toThrow(
            /Unknown column "nmae"\. Available columns: id, firstName, active, score\./,
        );
    });

    it("accepts a key that only some rows carry", () => {
        // Heterogeneous JSON is ordinary, and this is the shape that used to blank the grid: the
        // check read row 0 alone, so a correct column set was rejected over valid data.
        expect(() =>
            validateColumns([{ key: "a" }, { key: "b" }], [{ a: 1 }, { a: 2, b: 3 }]),
        ).not.toThrow();
    });

    it("accepts a key that first appears past the sample window", () => {
        // The failure-path scan. The sample stops at 50 rows, so this key is unknown to it and
        // only the full scan can tell a sparse column from a typo.
        const rows = Array.from({ length: 300 }, (_, i) =>
            i === 200 ? { a: i, late: "here" } : { a: i },
        );
        expect(() =>
            validateColumns([{ key: "a" }, { key: "late" }], rows),
        ).not.toThrow();
    });

    it("still rejects a key no row carries", () => {
        const rows = Array.from({ length: 300 }, (_, i) => ({ a: i }));
        expect(() => validateColumns([{ key: "nmae" }], rows)).toThrow(
            /Unknown column "nmae"\. Available columns: a\./,
        );
    });

    it("never rejects a column set it would have inferred itself", () => {
        // The invariant the shared 50-row sample buys: `create({ rows })` and
        // `create({ rows, columns: inferColumns(rows) })` cannot disagree.
        const sparse = [{ a: 1 }, { b: 2 }, { c: 3 }];
        expect(() => validateColumns(inferColumns(sparse), sparse)).not.toThrow();
    });

    it("allows a key absent from the data when the column is computed", () => {
        expect(() =>
            validateColumns([{ key: "total", render: () => "x" }], people),
        ).not.toThrow();
    });

    it("detects a width for a column that omitted one", () => {
        // The whole point: naming your own columns used to opt every one of them out of width
        // detection and into a flat 140px, while the docs promised otherwise.
        const rows = [{ note: "x" }, { note: "a considerably longer note" }];
        const [column] = validateColumns([{ key: "note", name: "Note" }], rows);
        expect(column.width).toBe("a considerably longer note".length * 8 + 20);
    });

    it("measures what the cell will show, not the raw value", () => {
        const rows = [{ when: new Date("2020-01-02T03:04:05Z") }];
        const [raw] = validateColumns([{ key: "when" }], rows);
        const [formatted] = validateColumns(
            [{ key: "when", formatValue: () => "1/2/20" }],
            rows,
        );
        // `formatValue` is six characters; the date's own string is far wider.
        expect(formatted.width).toBeLessThan(raw.width as number);
        expect(formatted.width).toBe("1/2/20".length * 8 + 20);
    });

    it("leaves an explicit width alone, and copies rather than mutates", () => {
        const given = [{ key: "note", width: 42 }, { key: "id" }];
        const out = validateColumns(given, [{ note: "x", id: 1 }]);
        expect(out[0].width).toBe(42);
        expect(out[0]).toBe(given[0]); // untouched columns keep their identity
        expect(given[1].width).toBeUndefined(); // the host's object is not written through
    });

    it("leaves the width unset when there is nothing to measure", () => {
        // An empty grid, or the column `addColumns` just made. Sizing those to the header
        // alone would make a new column the narrowest thing on screen.
        expect(validateColumns([{ key: "note" }], [])[0].width).toBeUndefined();
        expect(
            validateColumns([{ key: "note" }], [{ note: null }])[0].width,
        ).toBeUndefined();
    });

    it("rejects a duplicate key", () => {
        expect(() =>
            validateColumns([{ key: "id" }, { key: "id" }], people),
        ).toThrow(/Duplicate column key "id"/);
    });

    it("rejects a column with no key, and says what one looks like", () => {
        expect(() => validateColumns([{ name: "ID" } as any], people)).toThrow(
            /columns\[0\] has no `key`.*\{ key: "name", name: "Name" \}/s,
        );
    });

    it("throws AVGridError, so a host can catch it specifically", () => {
        expect(() => validateColumns("nope", people)).toThrow(AVGridError);
    });
});

describe("validateColumns: pinned", () => {
    const pinnable = [{ a: 1, b: 2, total: 3, actions: 4 }];

    it("accepts a trailing pinned-right run", () => {
        expect(() =>
            validateColumns(
                [
                    { key: "a" },
                    { key: "b" },
                    { key: "total", pinned: "right" },
                    { key: "actions", pinned: "right" },
                ],
                pinnable,
            ),
        ).not.toThrow();
    });

    it("raises on a pinned-right column followed by an unpinned one, naming both", () => {
        expect(() =>
            validateColumns(
                [{ key: "a" }, { key: "total", pinned: "right" }, { key: "b" }],
                pinnable,
            ),
        ).toThrow(/Column "b" follows the pinned: "right" column "total"/);
    });

    it("ignores hidden columns when checking the trailing run", () => {
        // A hidden column after the run is not rendered, so it cannot break the band.
        expect(() =>
            validateColumns(
                [
                    { key: "a" },
                    { key: "total", pinned: "right" },
                    { key: "b", hidden: true },
                ],
                pinnable,
            ),
        ).not.toThrow();
    });

    it("raises on a percentage width for a pinned column", () => {
        expect(() =>
            validateColumns(
                [{ key: "a" }, { key: "total", pinned: "right", width: "30%" }],
                pinnable,
            ),
        ).toThrow(/pinned but has width: "30%"/);
        // Both spellings of left, too — the fit arithmetic is the same trap on either edge.
        expect(() =>
            validateColumns(
                [{ key: "a", isStatusColumn: true, width: "30%" }, { key: "b" }],
                pinnable,
            ),
        ).toThrow(/pinned but has width/);
    });

    it("raises when one column claims both edges", () => {
        expect(() =>
            validateColumns(
                [{ key: "a", isStatusColumn: true, pinned: "right" }, { key: "b" }],
                pinnable,
            ),
        ).toThrow(/cannot be pinned to both edges/);
    });

    it("raises on a pinned value that is neither edge", () => {
        expect(() =>
            validateColumns([{ key: "a", pinned: "top" as any }], pinnable),
        ).toThrow(/The only values are "left" and "right"/);
    });

    it("exempts an isStatusColumn from the unknown-key check; a pinned-left DATA column is checked", () => {
        // Chrome never reads the row property.
        expect(() =>
            validateColumns(
                [{ key: "rowNo", isStatusColumn: true }, { key: "a" }],
                pinnable,
            ),
        ).not.toThrow();
        // A column that is merely pinned left is data (task 53) — a key no row has is the
        // same rendering bug it is anywhere else.
        expect(() =>
            validateColumns([{ key: "rowNo", pinned: "left" }, { key: "a" }], pinnable),
        ).toThrow(/rowNo/);
        // With a real key, pinned left is an ordinary data column.
        expect(() =>
            validateColumns([{ key: "a", pinned: "left" }, { key: "b" }], pinnable),
        ).not.toThrow();
    });

    it("requires left-pinned columns to be the leading run", () => {
        expect(() =>
            validateColumns([{ key: "a" }, { key: "b", pinned: "left" }], pinnable),
        ).toThrow(/"b".*leading/s);
        expect(() =>
            validateColumns(
                [{ key: "a" }, { key: "rowNo", isStatusColumn: true, render: () => "" }],
                pinnable,
            ),
        ).toThrow(/"rowNo".*leading/s);
        // A hidden column in between does not break the run — runs are over visible columns.
        expect(() =>
            validateColumns(
                [
                    { key: "a", pinned: "left" },
                    { key: "b", hidden: true },
                    { key: "total", pinned: "left" },
                    { key: "actions" },
                ],
                pinnable,
            ),
        ).not.toThrow();
    });
});

describe("validateSort", () => {
    const columns = [{ key: "id" }, { key: "name" }];

    it("accepts a valid sort", () => {
        expect(validateSort({ key: "id", direction: "asc" }, columns)).toEqual({
            key: "id",
            direction: "asc",
        });
    });

    it("names the available columns for an unknown key", () => {
        expect(() =>
            validateSort({ key: "nmae", direction: "asc" }, columns),
        ).toThrow(/Unknown column "nmae" in `sort`\. Available columns: id, name\./);
    });

    it("rejects a direction that is not asc or desc", () => {
        expect(() =>
            validateSort({ key: "id", direction: "up" as any }, columns),
        ).toThrow(/must be "asc" or "desc"/);
    });

    it("treats null and undefined as unsorted", () => {
        expect(validateSort(undefined, columns)).toBeUndefined();
        expect(validateSort(null, columns)).toBeUndefined();
    });

    it("rejects an array without multiSort, naming the fix", () => {
        expect(() =>
            validateSort([{ key: "id", direction: "asc" }], columns),
        ).toThrow(/multiSort: true/);
    });

    it("accepts an array with multiSort, validating each element", () => {
        expect(
            validateSort(
                [
                    { key: "id", direction: "asc" },
                    { key: "name", direction: "desc" },
                ],
                columns,
                true,
            ),
        ).toEqual([
            { key: "id", direction: "asc" },
            { key: "name", direction: "desc" },
        ]);

        expect(() =>
            validateSort([{ key: "nmae", direction: "asc" }], columns, true),
        ).toThrow(/Unknown column "nmae" in `sort\[0\]`/);
    });

    it("rejects a column that appears twice in the list", () => {
        expect(() =>
            validateSort(
                [
                    { key: "id", direction: "asc" },
                    { key: "id", direction: "desc" },
                ],
                columns,
                true,
            ),
        ).toThrow(/appears twice/);
    });
});

describe("resolveOptions", () => {
    it("fills in every default from just rows", () => {
        const resolved = resolveOptions({ rows: people });
        expect(resolved.rowHeight).toBe(24);
        expect(resolved.columns).toHaveLength(4);
        expect(resolved.getRowKey(people[0])).toBe("1");
    });

    it("tells the caller what the minimum call looks like", () => {
        expect(() => resolveOptions(undefined)).toThrow(
            /AVGrid\.create\(el, \{ rows: \[\{ id: 1, name: "Ada" \}\] \}\)/,
        );
    });

    it("suggests an empty array rather than a missing one", () => {
        expect(() => resolveOptions({ rows: undefined })).toThrow(
            /`rows` must be an array.*AVGrid\.create\(el, \{ rows: \[\] \}\)/s,
        );
    });

    it("rejects a non-positive rowHeight", () => {
        expect(() => resolveOptions({ rows: [], rowHeight: 0 })).toThrow(
            /`rowHeight` must be a positive number/,
        );
    });

    it("shows the expected shape when getRowKey is not a function", () => {
        expect(() =>
            resolveOptions({ rows: people, getRowKey: "id" as any }),
        ).toThrow(/getRowKey: \(row\) => String\(row\.id\)/);
    });

    it("keeps an explicitly supplied getRowKey", () => {
        const getRowKey = (row: any) => `k${row.id}`;
        expect(resolveOptions({ rows: people, getRowKey }).getRowKey).toBe(getRowKey);
    });
});
