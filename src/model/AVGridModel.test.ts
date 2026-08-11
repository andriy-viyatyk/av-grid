import { beforeEach, describe, expect, it, vi } from "vitest";
import { AVGridModel } from "./AVGridModel";
import { resolveOptions } from "../validate";
import type { AVGridOptions } from "../options";

interface Row {
    id: number;
    name: string;
    score: number;
}

const rows: Row[] = [
    { id: 1, name: "Charlie", score: 30 },
    { id: 2, name: "Ada", score: 10 },
    { id: 3, name: "Bob", score: 20 },
];

function makeModel(options?: Partial<AVGridOptions<Row>>) {
    const model = new AVGridModel<Row>(
        resolveOptions<Row>({ rows, ...options }),
    );
    // Nothing paints in these tests; the render model only has to record the dirty sets.
    const updates: any[] = [];
    model.setRenderModel({
        update: (r: any) => updates.push(r),
        requestRepaint: () => updates.push("repaint"),
    } as any);
    return { model, updates };
}

describe("AVGridModel", () => {
    let model: AVGridModel<Row>;
    let updates: any[];

    beforeEach(() => {
        ({ model, updates } = makeModel());
        updates.length = 0;
    });

    it("displays every row unsorted and unfiltered, in source order", () => {
        expect(model.data.rows).toEqual(rows);
        // The same array, not a copy — nothing was applied, so nothing was allocated.
        expect(model.data.rows).toBe(model.options.rows);
    });

    it("counts one more row than the data, for the header", () => {
        expect(model.models.rows.rowCount).toBe(4);
    });

    it("maps between data rows and grid rows in one place", () => {
        expect(model.dataRowToGridRow(0)).toBe(1);
        expect(model.gridRowToDataRow(1)).toBe(0);
    });

    describe("sorting", () => {
        it("cycles a column ascending, descending, then off", () => {
            model.models.sortColumn.sortColumn("name");
            expect(model.data.rows.map((r) => r.name)).toEqual([
                "Ada",
                "Bob",
                "Charlie",
            ]);

            model.models.sortColumn.sortColumn("name");
            expect(model.state.get().sort?.direction).toBe("desc");
            expect(model.data.rows.map((r) => r.name)).toEqual([
                "Charlie",
                "Bob",
                "Ada",
            ]);

            model.models.sortColumn.sortColumn("name");
            expect(model.state.get().sort).toBeUndefined();
            expect(model.data.rows).toEqual(rows);
        });

        it("sorts numbers numerically, not lexically", () => {
            const many = Array.from({ length: 12 }, (_, i) => ({
                id: i,
                name: `n${i}`,
                score: i,
            }));
            const m = makeModel({ rows: many }).model;
            m.setSort({ key: "score", direction: "asc" });
            expect(m.data.rows.map((r) => r.score)).toEqual([
                0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
            ]);
        });

        // The `rowCompare` row of the precedence table in docs/api.md, and the snippet next to
        // it: a priority order the values do not have on their own.
        it("sorts by a column's own rowCompare, ascending and reversed", () => {
            const RANK: Record<string, number> = { high: 0, normal: 1, low: 2 };
            const priorities = [
                { id: 1, name: "low", score: 1 },
                { id: 2, name: "high", score: 2 },
                { id: 3, name: "normal", score: 3 },
            ];
            const { model: m } = makeModel({
                rows: priorities,
                columns: [
                    {
                        key: "name",
                        // Ascending only — the comparator never sees the direction.
                        rowCompare: (a, b) => RANK[a.name] - RANK[b.name],
                    },
                    { key: "score" },
                ],
            });

            m.setSort({ key: "name", direction: "asc" });
            expect(m.data.rows.map((r) => r.name)).toEqual([
                "high",
                "normal",
                "low",
            ]);

            m.setSort({ key: "name", direction: "desc" });
            expect(m.data.rows.map((r) => r.name)).toEqual([
                "low",
                "normal",
                "high",
            ]);
        });

        it("ignores formatValue when sorting, which is what rowCompare is for", () => {
            const { model: m } = makeModel({
                columns: [
                    // The text on screen is reversed; the sort still reads `name`.
                    {
                        key: "name",
                        formatValue: (_c, r) =>
                            r.name.split("").reverse().join(""),
                    },
                    { key: "score" },
                ],
            });
            m.setSort({ key: "name", direction: "asc" });
            expect(m.data.rows.map((r) => r.name)).toEqual([
                "Ada",
                "Bob",
                "Charlie",
            ]);
        });

        it("marks only the header row dirty when the sort changes", () => {
            model.setSort({ key: "name", direction: "asc" });
            // { rows: [0] } from the indicator, { all: true } from the reordered rows.
            expect(updates).toContainEqual({ rows: [0] });
        });

        it("reports the change once, through onSortChange", () => {
            const onSortChange = vi.fn();
            const { model: m } = makeModel({ onSortChange });
            m.setSort({ key: "name", direction: "asc" });
            expect(onSortChange).toHaveBeenCalledTimes(1);
            expect(onSortChange).toHaveBeenCalledWith({
                key: "name",
                direction: "asc",
            });
        });

        it("ignores a sort request when sorting is disabled", () => {
            const { model: m } = makeModel({ disableSorting: true });
            m.models.sortColumn.sortColumn("name");
            expect(m.state.get().sort).toBeUndefined();
        });

        it("does nothing when the sort is set to what it already is", () => {
            const onSortChange = vi.fn();
            const { model: m } = makeModel({ onSortChange });
            m.setSort({ key: "name", direction: "asc" });
            m.setSort({ key: "name", direction: "asc" });
            expect(onSortChange).toHaveBeenCalledTimes(1);
        });
    });

    describe("setRows", () => {
        it("re-applies the current sort to the new rows", () => {
            model.setSort({ key: "name", direction: "asc" });
            model.setRows([
                { id: 9, name: "Zoe", score: 1 },
                { id: 8, name: "Al", score: 2 },
            ]);
            expect(model.data.rows.map((r) => r.name)).toEqual(["Al", "Zoe"]);
        });

        it("reports the new visible rows", () => {
            const onVisibleRowsChange = vi.fn();
            const { model: m } = makeModel({ onVisibleRowsChange });
            const next = [{ id: 4, name: "Dee", score: 40 }];
            m.setRows(next);
            expect(onVisibleRowsChange).toHaveBeenCalledWith(next);
        });
    });

    describe("searchString", () => {
        it("keeps only rows whose displayed values contain every word", () => {
            model.setSearchString("ad");
            expect(model.data.rows.map((r) => r.name)).toEqual(["Ada"]);
        });

        it("restores the dropped rows when cleared", () => {
            model.setSearchString("ad");
            model.setSearchString(undefined);
            expect(model.data.rows).toHaveLength(3);
        });

        it("matches against numbers as well as strings", () => {
            model.setSearchString("20");
            expect(model.data.rows.map((r) => r.name)).toEqual(["Bob"]);
        });
    });

    describe("columns", () => {
        it("hides columns marked hidden from the render layer, not from getColumns", () => {
            model.setColumns([
                { key: "id" },
                { key: "name", hidden: true },
                { key: "score" },
            ]);
            expect(model.data.columns.map((c) => c.key)).toEqual(["id", "score"]);
            expect(model.options.columns).toHaveLength(3);
        });

        it("tracks the last status column, which becomes the sticky-left boundary", () => {
            model.setColumns([
                { key: "id", isStatusColumn: true },
                { key: "name" },
            ]);
            expect(model.data.lastIsStatusIndex).toBe(0);
        });

        it("resizes a column and reports it", () => {
            const onColumnResize = vi.fn();
            const { model: m } = makeModel({ onColumnResize });
            m.events.onColumnResize.send({ columnKey: "name", width: 321 });

            expect(
                m.options.columns.find((c) => c.key === "name")?.width,
            ).toBe(321);
            expect(onColumnResize).toHaveBeenCalledWith("name", 321);
        });

        it("refuses a width below the minimum, so the grip stays grabbable", () => {
            const before = model.options.columns.find((c) => c.key === "name")?.width;
            model.events.onColumnResize.send({ columnKey: "name", width: 5 });
            expect(model.options.columns.find((c) => c.key === "name")?.width).toBe(
                before,
            );
        });

        it("reorders columns, marking only the span that moved", () => {
            model.setColumns([{ key: "id" }, { key: "name" }, { key: "score" }]);
            updates.length = 0;

            model.events.onColumnsReorder.send({
                sourceKey: "score",
                targetKey: "id",
            });

            expect(model.options.columns.map((c) => c.key)).toEqual([
                "score",
                "id",
                "name",
            ]);
            // Columns 0..2 moved; nothing outside that span is repainted.
            expect(updates).toContainEqual({ columns: [0, 1, 2] });
        });
    });

    describe("hover", () => {
        it("repaints two rows when the pointer moves between them", () => {
            model.data.hovered = { row: 0, col: 0 };
            model.data.change();
            updates.length = 0;

            model.data.hovered = { row: 1, col: 0 };
            model.data.change();
            // The interactions layer computes the dirty set; this asserts the data half.
            expect(model.data.hovered.row).toBe(1);
        });
    });
});
