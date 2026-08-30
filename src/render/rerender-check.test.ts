import { describe, expect, it } from "vitest";
import { prepareRerender } from "./rerender-check";
import { calcRenderInfo, renderInfoInitialState } from "./renderInfo";
import type {
    CalcRenderInfoInput,
    RenderInput,
    RenderInputPrepared,
} from "./types";

function makeOld(over: Partial<CalcRenderInfoInput> = {}): RenderInputPrepared {
    const input: CalcRenderInfoInput = {
        offset: { x: 0, y: 0 },
        size: { width: 500, height: 200 },
        rowCount: 1000,
        columnCount: 10,
        rowHeight: 20,
        columnWidth: 100,
        renderCell: () => undefined,
        stickyTop: 1,
        stickyLeft: 1,
        stickyRight: 0,
        stickyBottom: 0,
        overscanColumn: 0,
        overscanRow: 0,
        scrollBarWidth: 0,
        scrollBarHeight: 0,
        fitToWidth: false,
        ...over,
    };
    return calcRenderInfo(renderInfoInitialState, input);
}

/** The same geometry the `old` was built from — i.e. "nothing changed". */
const sameInput = (old: RenderInputPrepared): RenderInput => ({ ...old.input });

const dirtyRows = (res: ReturnType<typeof prepareRerender>) =>
    Object.keys(res?.rows ?? {}).map(Number).sort((a, b) => a - b);

const dirtyColumns = (res: ReturnType<typeof prepareRerender>) =>
    Object.keys(res?.columns ?? {}).map(Number).sort((a, b) => a - b);

describe("prepareRerender", () => {
    it("returns null when nothing changed and nothing was marked", () => {
        const old = makeOld();
        expect(
            prepareRerender(undefined, old, sameInput(old), old.columnLength, old.rowLength),
        ).toBeNull();
    });

    it("expands a single dirty cell into a lookup map and nothing else", () => {
        const old = makeOld();
        const res = prepareRerender(
            { cells: [{ row: 3, col: 2 }] },
            old,
            sameInput(old),
            old.columnLength,
            old.rowLength,
        );

        expect(res).not.toBeNull();
        expect(res!.all).toBe(false);
        expect(res!.cells).toEqual({ "3_2": true });
        // The cell's row and column must NOT be marked — that is the whole discipline.
        expect(res!.rows).toEqual({});
        expect(res!.columns).toEqual({});
    });

    it("keeps two dirty cells separate, as a growing range selection produces", () => {
        const old = makeOld();
        const res = prepareRerender(
            {
                cells: [
                    { row: 3, col: 2 },
                    { row: 3, col: 3 },
                ],
            },
            old,
            sameInput(old),
            old.columnLength,
            old.rowLength,
        );

        expect(res!.cells).toEqual({ "3_2": true, "3_3": true });
        expect(res!.rows).toEqual({});
    });

    it("drops dirty entries outside the rendered window", () => {
        const old = makeOld();
        expect(old.rendered.bottom).toBeLessThan(500);

        const res = prepareRerender(
            {
                cells: [
                    { row: 500, col: 2 },
                    { row: 4, col: 2 },
                ],
                rows: [700],
            },
            old,
            sameInput(old),
            old.columnLength,
            old.rowLength,
        );

        // Only the on-screen entry survives; marking row 700 costs nothing.
        expect(res!.cells).toEqual({ "4_2": true });
        expect(res!.rows).toEqual({});
    });

    it("returns null when every marked entry was off screen", () => {
        const old = makeOld();
        const res = prepareRerender(
            { rows: [900] },
            old,
            sameInput(old),
            old.columnLength,
            old.rowLength,
        );

        expect(res).toBeNull();
    });

    it("does not filter out-of-bounds indices, which read as sticky-band members", () => {
        // `rowInRange` ends with `r >= rowCount - stickyBottom`; with stickyBottom 0 that is
        // `r >= rowCount`, which every out-of-bounds index satisfies. Reference behavior,
        // and harmless — no region loop ever reaches such a row, so nothing is painted — but
        // it does cost one unnecessary recompute. Callers should mark real row indices only.
        const old = makeOld({ stickyBottom: 0 });
        const res = prepareRerender(
            { rows: [80_000] },
            old,
            sameInput(old),
            old.columnLength,
            old.rowLength,
        );

        expect(res).not.toBeNull();
        expect(dirtyRows(res)).toEqual([80_000]);
    });

    it("keeps off-screen entries that live in a sticky band", () => {
        // Rows 0 (sticky header) and columns 0 (sticky left) are always rendered, so they
        // survive the range filter even though the rendered window starts past them.
        const old = makeOld({ offset: { x: 0, y: 4000 } });
        expect(old.rendered.top).toBeGreaterThan(1);

        const res = prepareRerender(
            { cells: [{ row: 0, col: 0 }] },
            old,
            sameInput(old),
            old.columnLength,
            old.rowLength,
        );

        expect(res!.cells).toEqual({ "0_0": true });
    });

    it("passes an explicit all straight through", () => {
        const old = makeOld();
        const res = prepareRerender(
            { all: true },
            old,
            sameInput(old),
            old.columnLength,
            old.rowLength,
        );

        expect(res!.all).toBe(true);
    });

    describe("geometry changes imply their own dirty entries", () => {
        it("marks everything when the viewport width changes under fitToWidth", () => {
            const old = makeOld({ fitToWidth: true });
            const res = prepareRerender(
                undefined,
                old,
                { ...old.input, size: { width: 800, height: 200 } },
                old.columnLength,
                old.rowLength,
            );

            expect(res!.all).toBe(true);
        });

        it("does not mark everything on a width change without fitToWidth", () => {
            const old = makeOld();
            const res = prepareRerender(
                undefined,
                old,
                { ...old.input, size: { width: 800, height: 200 } },
                old.columnLength,
                old.rowLength,
            );

            expect(res?.all ?? false).toBe(false);
        });

        it("marks everything on a width change when a percentage width did the fitting", () => {
            const old = makeOld();
            const res = prepareRerender(
                undefined,
                old,
                { ...old.input, size: { width: 800, height: 200 } },
                old.columnLength,
                old.rowLength,
                true, // columnsFitted — `fitToWidth` is off, a "50%" column is not
            );

            expect(res!.all).toBe(true);
        });

        it("marks the sticky bottom band under both counts when the row count changes", () => {
            const old = makeOld({ stickyBottom: 1 });
            const res = prepareRerender(
                undefined,
                old,
                { ...old.input, rowCount: 1001 },
                old.columnLength,
                old.rowLength,
            );

            // The band is addressed from the end, so both the old and new last row move.
            expect(dirtyRows(res)).toEqual([999, 1000]);
        });

        it("marks the sticky right band when the column count changes", () => {
            const old = makeOld({ stickyRight: 1 });
            const res = prepareRerender(
                undefined,
                old,
                { ...old.input, columnCount: 11 },
                old.columnLength,
                old.rowLength,
            );

            expect(dirtyColumns(res)).toEqual([9, 10]);
        });

        it("marks from the resized column rightwards, and no further left", () => {
            const old = makeOld({ columnWidth: () => 100 });
            const widened = [...(old.columnLength as number[])];
            widened[3] = 180;

            const res = prepareRerender(
                undefined,
                old,
                sameInput(old),
                widened,
                old.rowLength,
            );

            // Columns 0..2 keep their position and are not repainted; 0 is the sticky-left
            // band, which is marked separately only when the change reaches it.
            expect(dirtyColumns(res)).toEqual([3, 4, 5]);
        });

        it("marks the sticky-left band when the resized column is inside it", () => {
            const old = makeOld({ stickyLeft: 2, columnWidth: () => 100 });
            const widened = [...(old.columnLength as number[])];
            widened[0] = 180;

            const res = prepareRerender(
                undefined,
                old,
                sameInput(old),
                widened,
                old.rowLength,
            );

            expect(dirtyColumns(res)).toContain(0);
            expect(dirtyColumns(res)).toContain(1);
        });

        it("returns null when the length arrays are equal", () => {
            const old = makeOld({ columnWidth: () => 100 });
            const identical = [...(old.columnLength as number[])];

            const res = prepareRerender(
                undefined,
                old,
                sameInput(old),
                identical,
                old.rowLength,
            );

            expect(res).toBeNull();
        });

        it("marks the visible rows when a uniform row height changes", () => {
            const old = makeOld();
            const res = prepareRerender(
                undefined,
                old,
                sameInput(old),
                old.columnLength,
                30,
            );

            expect(dirtyRows(res)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        });

        it("marks the visible rows when the axis switches from uniform to per-row", () => {
            const old = makeOld();
            const perRow = Array.from({ length: 1000 }, () => 20);

            const res = prepareRerender(
                undefined,
                old,
                sameInput(old),
                old.columnLength,
                perRow,
            );

            // Same heights, but a different representation — the engine cannot assume the
            // rendered output is unaffected, so the window is marked.
            expect(dirtyRows(res).length).toBeGreaterThan(0);
        });

        it("marks the affected rows when a sticky band's size changes", () => {
            const old = makeOld({ stickyTop: 1 });
            const res = prepareRerender(
                undefined,
                old,
                { ...old.input, stickyTop: 2 },
                old.columnLength,
                old.rowLength,
            );

            expect(dirtyRows(res)).toContain(1);
        });
    });
});

// ---------------------------------------------------------------------------
// Task 34 — `fromRow`, geometry invalidation
// ---------------------------------------------------------------------------

describe("fromRow", () => {
    it("marks every rendered row from there down, and nothing above it", () => {
        const old = makeOld();
        const res = prepareRerender(
            { fromRow: 4 },
            old,
            sameInput(old),
            old.columnLength,
            old.rowLength,
        );

        const rows = dirtyRows(res);
        expect(rows[0]).toBe(4);
        expect(rows[rows.length - 1]).toBe(old.rendered.bottom);
        expect(rows).toEqual(
            Array.from({ length: old.rendered.bottom - 3 }, (_, i) => i + 4),
        );
        // Geometry only: no column and no individual cell is implicated.
        expect(dirtyColumns(res)).toEqual([]);
        expect(res!.cells).toEqual({});
        expect(res!.all).toBe(false);
    });

    it("clamps to the top of the rendered window rather than marking off-screen rows", () => {
        const old = makeOld({ offset: { x: 0, y: 4000 } });
        const res = prepareRerender(
            { fromRow: 0 },
            old,
            sameInput(old),
            old.columnLength,
            old.rowLength,
        );

        const rows = dirtyRows(res);
        // A row 200 rows above the viewport moving must cost a viewport, not a dataset.
        expect(rows.length).toBeLessThan(40);
        expect(Math.min(...rows)).toBeGreaterThanOrEqual(
            Math.min(old.rendered.top, old.input.stickyTop),
        );
    });

    it("marks nothing when the changed row is below the rendered window", () => {
        const old = makeOld();
        const res = prepareRerender(
            { fromRow: 900 },
            old,
            sameInput(old),
            old.columnLength,
            old.rowLength,
        );
        // Nothing on screen moved; only the total extent did, which the caller recomputes
        // regardless. Reporting rows here would repaint a viewport for no visible change.
        expect(res).toBeNull();
    });

    it("reaches the sticky bottom band, which sits past the rendered window", () => {
        const old = makeOld({ stickyBottom: 2 });
        const res = prepareRerender(
            { fromRow: 995 },
            old,
            sameInput(old),
            old.columnLength,
            old.rowLength,
        );
        expect(dirtyRows(res)).toEqual([998, 999]);
    });

    it("behaves exactly as before when absent", () => {
        const old = makeOld();
        const withField = prepareRerender(
            { rows: [3], fromRow: undefined },
            old,
            sameInput(old),
            old.columnLength,
            old.rowLength,
        );
        const without = prepareRerender(
            { rows: [3] },
            old,
            sameInput(old),
            old.columnLength,
            old.rowLength,
        );
        expect(withField).toEqual(without);
        expect(dirtyRows(withField)).toEqual([3]);
    });
});
