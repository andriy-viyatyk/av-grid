// @vitest-environment happy-dom

/**
 * `externalFilter` / `externalSort` — the host owns the row set.
 *
 * The whole feature is a guard in `RowsModel.filter` and `RowsModel.sort`, so the assertions
 * here are mostly about what does **not** happen: rows do not move, rows do not disappear —
 * while everything around the row pass (chips, callbacks, `isFiltered`, arrows, `getSort`)
 * keeps working exactly as before.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { AVGrid } from "./AVGrid";
import type { AVGridOptions } from "./options";
import type { FilterDefinition } from "./types";

interface Row {
    id: number;
    name: string;
    status: string;
}

/** Deliberately not sorted by anything, so any reorder is visible. */
const rows: Row[] = [
    { id: 3, name: "Grace", status: "open" },
    { id: 1, name: "Ada", status: "open" },
    { id: 4, name: "Edsger", status: "done" },
    { id: 2, name: "Alan", status: "done" },
];

const grids: AVGrid<any>[] = [];

function create<R>(options: AVGridOptions<R>): AVGrid<R> {
    const host = document.createElement("div");
    document.body.append(host);
    const grid = AVGrid.create<R>(host, options);
    grids.push(grid);
    return grid;
}

const names = (grid: AVGrid<Row>): string[] =>
    grid.getVisibleRows().map((r) => r.name);

afterEach(() => {
    grids.splice(0).forEach((g) => g.destroy());
    document.body.innerHTML = "";
    vi.restoreAllMocks();
});

// =============================================================================================
// externalFilter
// =============================================================================================

describe("externalFilter", () => {
    it("keeps every row while the filter state and callback still work", () => {
        const seen: any[] = [];
        const grid = create<Row>({
            rows,
            externalFilter: true,
            onFiltersChange: (filters) => seen.push(filters),
        });

        grid.setFilters([{ columnKey: "status", value: ["open"] }]);

        // The row set is untouched — something upstream is expected to filter.
        expect(names(grid)).toEqual(["Grace", "Ada", "Edsger", "Alan"]);
        // But the filter is applied as state: chips, funnels and the host all see it.
        expect(grid.isFiltered("status")).toBe(true);
        expect(seen).toHaveLength(1);
        expect(seen[0][0].columnKey).toBe("status");
    });

    it("searchString still filters locally — it is a local row search by definition", () => {
        const grid = create<Row>({
            rows,
            externalFilter: true,
            filters: [{ columnKey: "status", value: ["open"] }],
            searchString: "a",
        });
        // The status filter is withheld (external), but "a" still narrows: Edsger has no "a".
        expect(names(grid)).toEqual(["Grace", "Ada", "Alan"]);
    });

    it("off (the default), the same filter narrows the rows", () => {
        const grid = create<Row>({
            rows,
            filters: [{ columnKey: "status", value: ["open"] }],
        });
        expect(names(grid)).toEqual(["Grace", "Ada"]);
    });

    it("a text filter is state too — the host reads { op, text } and the rows stay", () => {
        const grid = create<Row>({
            rows,
            externalFilter: true,
            columns: [
                { key: "name", filterType: "text" },
                { key: "id" },
                { key: "status" },
            ],
        });
        grid.setFilters([{ columnKey: "name", value: "smith" }]);
        expect(names(grid)).toHaveLength(4);
        expect(grid.getFilters()[0].value).toEqual({ op: "contains", text: "smith" });
    });

    it("accepts a filter definition with no `match` — the row test never runs", () => {
        const definition: FilterDefinition<Row> = {
            name: "serverRange",
            create: () => ({
                element: document.createElement("div"),
                getValue: () => undefined,
            }),
            label: (value) => String(value),
        };
        const grid = create<Row>({
            rows,
            externalFilter: true,
            columns: [{ key: "id", filter: definition }, { key: "name" }],
        });
        grid.setFilters([{ columnKey: "id", value: { from: 1, to: 2 } }]);
        expect(names(grid)).toHaveLength(4);
    });

    it("rejects that same definition without the flag, naming column and field", () => {
        const definition = {
            name: "serverRange",
            create: () => ({
                element: document.createElement("div"),
                getValue: () => undefined,
            }),
            label: (value: any) => String(value),
        } as FilterDefinition<Row>;
        expect(() =>
            create<Row>({
                rows,
                columns: [{ key: "id", filter: definition }, { key: "name" }],
            }),
        ).toThrow(/"id".*match/s);
    });
});

// =============================================================================================
// externalSort
// =============================================================================================

describe("externalSort", () => {
    it("keeps the handed-over order while the sort state and callback still work", () => {
        const seen: any[] = [];
        const grid = create<Row>({
            rows,
            externalSort: true,
            onSortChange: (sort) => seen.push(sort),
        });

        grid.setSort({ key: "name", direction: "asc" });

        expect(names(grid)).toEqual(["Grace", "Ada", "Edsger", "Alan"]);
        expect(grid.getSort()).toEqual({ key: "name", direction: "asc" });
        expect(seen).toEqual([{ key: "name", direction: "asc" }]);
    });

    it("off (the default), the same sort reorders", () => {
        const grid = create<Row>({
            rows,
            sort: { key: "name", direction: "asc" },
        });
        expect(names(grid)).toEqual(["Ada", "Alan", "Edsger", "Grace"]);
    });

    it("never calls sortValue or rowCompare", () => {
        const sortValue = vi.fn((row: Row) => row.name);
        const grid = create<Row>({
            rows,
            externalSort: true,
            columns: [{ key: "name", sortValue }, { key: "id" }, { key: "status" }],
            sort: { key: "name", direction: "asc" },
        });
        expect(names(grid)).toEqual(["Grace", "Ada", "Edsger", "Alan"]);
        expect(sortValue).not.toHaveBeenCalled();
        void grid;
    });

    it("holds arrays under multiSort, still without reordering", () => {
        const grid = create<Row>({
            rows,
            externalSort: true,
            multiSort: true,
            sort: [
                { key: "status", direction: "asc" },
                { key: "name", direction: "desc" },
            ],
        });
        expect(names(grid)).toEqual(["Grace", "Ada", "Edsger", "Alan"]);
        expect(grid.getSort()).toEqual([
            { key: "status", direction: "asc" },
            { key: "name", direction: "desc" },
        ]);
    });

    it("is independent of externalFilter: local filter over a server-ordered page", () => {
        const grid = create<Row>({
            rows,
            externalSort: true,
            filters: [{ columnKey: "status", value: ["done"] }],
            sort: { key: "name", direction: "asc" },
        });
        // Filtered locally, in the server's order.
        expect(names(grid)).toEqual(["Edsger", "Alan"]);
    });
});

// =============================================================================================
// setOptions — the runtime toggles
// =============================================================================================

describe("setOptions", () => {
    it("turning externalFilter on re-runs the pipeline and the rows come back", () => {
        const grid = create<Row>({
            rows,
            filters: [{ columnKey: "status", value: ["open"] }],
        });
        expect(names(grid)).toHaveLength(2);

        grid.setOptions({ externalFilter: true });
        expect(names(grid)).toHaveLength(4);

        grid.setOptions({ externalFilter: false });
        expect(names(grid)).toHaveLength(2);
    });

    it("turning externalSort on restores the handed-over order", () => {
        const grid = create<Row>({
            rows,
            sort: { key: "name", direction: "asc" },
        });
        expect(names(grid)).toEqual(["Ada", "Alan", "Edsger", "Grace"]);

        grid.setOptions({ externalSort: true });
        expect(names(grid)).toEqual(["Grace", "Ada", "Edsger", "Alan"]);

        grid.setOptions({ externalSort: false });
        expect(names(grid)).toEqual(["Ada", "Alan", "Edsger", "Grace"]);
    });

    it("turning externalFilter off throws — naming the column — over a match-less definition", () => {
        const definition: FilterDefinition<Row> = {
            name: "serverRange",
            create: () => ({
                element: document.createElement("div"),
                getValue: () => undefined,
            }),
            label: (value) => String(value),
        };
        const grid = create<Row>({
            rows,
            externalFilter: true,
            columns: [{ key: "id", filter: definition }, { key: "name" }],
        });

        expect(() => grid.setOptions({ externalFilter: false })).toThrow(/"id".*match/s);
        // The flag is unchanged: the grid cannot be left silently keeping every row.
        expect(names(grid)).toHaveLength(4);
        grid.setFilters([{ columnKey: "id", value: { from: 1 } }]);
        expect(names(grid)).toHaveLength(4);
    });

    it("swapping the columns and the flag in one call is judged on the new columns", () => {
        const matchless: FilterDefinition<Row> = {
            name: "serverRange",
            create: () => ({
                element: document.createElement("div"),
                getValue: () => undefined,
            }),
            label: (value) => String(value),
        };
        const grid = create<Row>({
            rows,
            externalFilter: true,
            columns: [{ key: "id", filter: matchless }, { key: "name" }],
        });

        // The old columns would fail, but the new ones — plain, no definition — are what will
        // be in effect, so the call succeeds.
        expect(() =>
            grid.setOptions({
                externalFilter: false,
                columns: [{ key: "id" }, { key: "name" }],
            }),
        ).not.toThrow();
    });

    it("setting the same value is a no-op — the echo terminates", () => {
        const grid = create<Row>({
            rows,
            externalFilter: true,
            filters: [{ columnKey: "status", value: ["open"] }],
        });
        const before = grid.getVisibleRows();
        grid.setOptions({ externalFilter: true, externalSort: false });
        // Same array identity: the pipeline was not re-run.
        expect(grid.getVisibleRows()).toBe(before);
    });
});

// =============================================================================================
// The editing freeze
// =============================================================================================

describe("the editing freeze", () => {
    it("a filter change still ends a freeze; the re-run pass keeps every row", () => {
        const grid = create<Row>({
            rows,
            editable: true,
            externalFilter: true,
            filters: [{ columnKey: "status", value: ["open"] }],
        });

        // Freeze the way editing does.
        (grid as any).model.models.rows.freezeRows();
        expect((grid as any).model.data.rowsFrozen).toBe(true);

        grid.setFilters([{ columnKey: "status", value: ["done"] }]);
        expect((grid as any).model.data.rowsFrozen).toBe(false);
        expect(names(grid)).toHaveLength(4);
    });
});
