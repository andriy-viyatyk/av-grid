import { describe, expect, it, vi } from "vitest";
import {
    buildLengthArray,
    buildStarts,
    calcRenderInfo,
    calcScrollOffsetX,
    calcScrollOffsetY,
    renderInfoInitialState,
} from "./renderInfo";
import type {
    CalcRenderInfoInput,
    RenderCellParams,
    RenderedCell,
    RenderInputPrepared,
} from "./types";

/**
 * Cells are opaque to the engine — it never inspects or touches them, which is exactly why
 * this file needs no DOM. A tagged plain object stands in for an HTMLElement so tests can
 * read back which coordinate each rendered cell came from.
 */
interface FakeCell {
    row: number;
    col: number;
    style: RenderCellParams["style"];
}

const asCell = (c: FakeCell) => c as unknown as HTMLElement;
const readCell = (c: RenderedCell) => c as unknown as FakeCell;

function trackingRenderCell() {
    const calls: Array<{ row: number; col: number }> = [];
    const renderCell = vi.fn((p: RenderCellParams): RenderedCell => {
        calls.push({ row: p.row, col: p.col });
        return asCell({ row: p.row, col: p.col, style: p.style });
    });
    return { renderCell, calls };
}

function makeInput(over: Partial<CalcRenderInfoInput> = {}): CalcRenderInfoInput {
    return {
        offset: { x: 0, y: 0 },
        size: { width: 500, height: 200 },
        rowCount: 1000,
        columnCount: 10,
        rowHeight: 20,
        columnWidth: 100,
        renderCell: trackingRenderCell().renderCell,
        stickyTop: 0,
        stickyLeft: 0,
        stickyRight: 0,
        stickyBottom: 0,
        overscanColumn: 0,
        overscanRow: 0,
        scrollBarWidth: 0,
        scrollBarHeight: 0,
        fitToWidth: false,
        ...over,
    };
}

const coords = (cells: RenderedCell[]) =>
    cells.map(readCell).map(({ row, col }) => `${row}_${col}`);

// ---------------------------------------------------------------------------

describe("buildLengthArray", () => {
    it("returns a uniform length unchanged, allocating no array", () => {
        expect(buildLengthArray(100_000, 24)).toBe(24);
    });

    it("builds a per-element array from a length function", () => {
        expect(buildLengthArray(4, (i) => 10 + i)).toEqual([10, 11, 12, 13]);
    });

    it("divides the remaining space across percentage entries", () => {
        // 100 fixed, 400 left to split 50/50.
        expect(
            buildLengthArray(3, (i) => (i === 0 ? 100 : "50%"), false, 500),
        ).toEqual([100, 200, 200]);
    });

    it("gives the rounding remainder to the last percentage entry", () => {
        // 100 / 3 does not divide evenly; the total must still land exactly on 100.
        const res = buildLengthArray(3, () => "33.3%", false, 100) as number[];
        expect(res.reduce((a, b) => a + b, 0)).toBe(100);
    });

    it("fits fixed widths to the available length when fitToLength is set", () => {
        expect(buildLengthArray(2, () => 100, true, 500)).toEqual([100, 100]);
    });
});

describe("buildStarts", () => {
    it("passes a uniform length straight through", () => {
        expect(buildStarts(24)).toBe(24);
    });

    it("accumulates per-element starts", () => {
        expect(buildStarts([10, 20, 30])).toEqual([0, 10, 30]);
    });
});

// ---------------------------------------------------------------------------

describe("calcRenderInfo — visible window", () => {
    it("computes the window at offset 0", () => {
        const info = calcRenderInfo(renderInfoInitialState, makeInput());

        // height 200 / rowHeight 20 -> rows 0..10, the last one partially visible.
        expect(info.visible).toEqual({ top: 0, bottom: 10, left: 0, right: 5 });
        expect(info.rendered).toEqual(info.visible);
    });

    it("computes the window mid-scroll", () => {
        const info = calcRenderInfo(
            renderInfoInitialState,
            makeInput({ offset: { x: 0, y: 1000 } }),
        );

        expect(info.visible.top).toBe(50);
        expect(info.visible.bottom).toBe(60);
    });

    it("clamps the window at the maximum scroll offset", () => {
        // innerSize.height = 1000 * 20 + 20 whitespace = 20020; max offset = 19820.
        const info = calcRenderInfo(
            renderInfoInitialState,
            makeInput({ offset: { x: 0, y: 19820 } }),
        );

        expect(info.visible.bottom).toBe(999);
        expect(info.visible.top).toBe(991);
    });

    it("clamps the horizontal window to the last column", () => {
        const info = calcRenderInfo(
            renderInfoInitialState,
            makeInput({ offset: { x: 5000, y: 0 } }),
        );

        expect(info.visible.right).toBe(9);
    });

    it("adds trailing whitespace only where there is no sticky band", () => {
        const plain = calcRenderInfo(renderInfoInitialState, makeInput());
        expect(plain.innerSize.height).toBe(1000 * 20 + 20);
        expect(plain.innerSize.width).toBe(10 * 100 + 20);

        const sticky = calcRenderInfo(
            renderInfoInitialState,
            makeInput({ stickyBottom: 1, stickyRight: 1 }),
        );
        expect(sticky.innerSize.height).toBe(1000 * 20);
        expect(sticky.innerSize.width).toBe(10 * 100);
    });

    it("handles variable row heights and column widths", () => {
        const info = calcRenderInfo(
            renderInfoInitialState,
            makeInput({
                rowCount: 5,
                columnCount: 4,
                rowHeight: (i) => (i === 0 ? 100 : 20),
                columnWidth: (i) => (i === 0 ? 300 : 50),
                size: { width: 400, height: 150 },
            }),
        );

        expect(info.rowLength).toEqual([100, 20, 20, 20, 20]);
        expect(info.rowStarts).toEqual([0, 100, 120, 140, 160]);
        expect(info.columnLength).toEqual([300, 50, 50, 50]);
        expect(info.columnStarts).toEqual([0, 300, 350, 400]);

        // 150px of height covers the 100px first row and part of the second.
        expect(info.visible.top).toBe(0);
        expect(info.visible.bottom).toBe(3);
    });

    it("resolves percentage widths against the viewport under fitToWidth", () => {
        const info = calcRenderInfo(
            renderInfoInitialState,
            makeInput({
                columnCount: 2,
                columnWidth: () => "50%",
                size: { width: 500, height: 200 },
                fitToWidth: true,
            }),
        );

        expect(info.columnLength).toEqual([250, 250]);
        // No trailing whitespace under fitToWidth — the columns already fill the width.
        expect(info.innerSize.width).toBe(500);
    });

    it("subtracts the scrollbar from the space percentages are fitted to", () => {
        const info = calcRenderInfo(
            renderInfoInitialState,
            makeInput({
                columnCount: 2,
                columnWidth: () => "50%",
                size: { width: 500, height: 200 },
                scrollBarWidth: 20,
                fitToWidth: true,
            }),
        );

        expect(info.columnLength).toEqual([240, 240]);
    });
});

describe("calcRenderInfo — overscan", () => {
    it("extends the rendered range downwards only when scrolling down", () => {
        const info = calcRenderInfo(
            renderInfoInitialState,
            makeInput({
                offset: { x: 0, y: 1000 },
                overscanRow: 5,
                direction: { x: 0, y: 1 },
            }),
        );

        expect(info.visible.top).toBe(50);
        expect(info.visible.bottom).toBe(60);
        expect(info.rendered.top).toBe(50); // not extended against the direction of travel
        expect(info.rendered.bottom).toBe(65);
    });

    it("extends upwards only when scrolling up", () => {
        const info = calcRenderInfo(
            renderInfoInitialState,
            makeInput({
                offset: { x: 0, y: 1000 },
                overscanRow: 5,
                direction: { x: 0, y: -1 },
            }),
        );

        expect(info.rendered.top).toBe(45);
        expect(info.rendered.bottom).toBe(60);
    });

    it("clamps overscan at the dataset bounds", () => {
        const top = calcRenderInfo(
            renderInfoInitialState,
            makeInput({
                offset: { x: 0, y: 0 },
                overscanRow: 50,
                direction: { x: 0, y: -1 },
            }),
        );
        expect(top.rendered.top).toBe(0);

        const bottom = calcRenderInfo(
            renderInfoInitialState,
            makeInput({
                offset: { x: 0, y: 19820 },
                overscanRow: 50,
                direction: { x: 0, y: 1 },
            }),
        );
        expect(bottom.rendered.bottom).toBe(999);
    });

    it("extends columns in the direction of horizontal travel", () => {
        const info = calcRenderInfo(
            renderInfoInitialState,
            makeInput({
                columnCount: 50,
                offset: { x: 500, y: 0 },
                overscanColumn: 2,
                direction: { x: 1, y: 0 },
            }),
        );

        expect(info.rendered.right).toBe(info.visible.right + 2);
        expect(info.rendered.left).toBe(info.visible.left);
    });

    it("lets onAdjustRenderRange widen the rendered range", () => {
        const info = calcRenderInfo(
            renderInfoInitialState,
            makeInput({
                offset: { x: 0, y: 1000 },
                onAdjustRenderRange: (r) => {
                    r.top = Math.max(0, r.top - 3);
                },
            }),
        );

        expect(info.visible.top).toBe(50);
        expect(info.rendered.top).toBe(47);
    });
});

describe("calcRenderInfo — sticky bands", () => {
    const stickyInput = (over: Partial<CalcRenderInfoInput> = {}) =>
        makeInput({
            rowCount: 20,
            columnCount: 8,
            rowHeight: 20,
            columnWidth: 100,
            size: { width: 400, height: 200 },
            stickyTop: 1,
            stickyLeft: 1,
            stickyRight: 1,
            stickyBottom: 1,
            ...over,
        });

    it("routes each cell to exactly one region", () => {
        const info = calcRenderInfo(renderInfoInitialState, stickyInput());

        expect(coords(info.stickyTopLeft)).toEqual(["0_0"]);
        expect(coords(info.stickyTopRight)).toEqual(["0_7"]);
        expect(coords(info.stickyBottomLeft)).toEqual(["19_0"]);
        expect(coords(info.stickyBottomRight)).toEqual(["19_7"]);

        // The top and bottom bands span the scrolling columns only. Columns 1..4 are
        // rendered: the sticky-right band is treated as transparent, so the right edge is
        // not reduced by its width.
        expect(coords(info.stickyTop)).toEqual(["0_1", "0_2", "0_3", "0_4"]);
        expect(coords(info.stickyBottom)).toEqual(["19_1", "19_2", "19_3", "19_4"]);

        // The left and right bands span the scrolling rows only.
        expect(readCell(info.stickyLeft[0]).row).toBe(1);
        expect(info.stickyLeft.every((c) => readCell(c).col === 0)).toBe(true);
        expect(info.stickyRight.every((c) => readCell(c).col === 7)).toBe(true);

        // The centre excludes every sticky row and column.
        const centre = info.cells.map(readCell);
        expect(centre.every((c) => c.row >= 1 && c.row <= 18)).toBe(true);
        expect(centre.every((c) => c.col >= 1 && c.col <= 6)).toBe(true);
    });

    it("renders no cell twice across the nine regions", () => {
        const info = calcRenderInfo(renderInfoInitialState, stickyInput());

        const all = [
            ...info.cells,
            ...info.stickyTop,
            ...info.stickyBottom,
            ...info.stickyLeft,
            ...info.stickyRight,
            ...info.stickyTopLeft,
            ...info.stickyTopRight,
            ...info.stickyBottomLeft,
            ...info.stickyBottomRight,
        ];
        const keys = coords(all);

        expect(new Set(keys).size).toBe(keys.length);
    });

    it("measures each band's extent", () => {
        const info = calcRenderInfo(renderInfoInitialState, stickyInput());

        expect(info.innerSize.stickyTopHeight).toBe(20);
        expect(info.innerSize.stickyBottomHeight).toBe(20);
        expect(info.innerSize.stickyLeftWidth).toBe(100);
        expect(info.innerSize.stickyRightWidth).toBe(100);
    });

    it("positions sticky-band cells relative to their own band origin", () => {
        const info = calcRenderInfo(renderInfoInitialState, stickyInput());

        // The bottom-left corner is row 19, but sits at the top of its own band.
        expect(readCell(info.stickyBottomLeft[0]).style.top).toBe(0);
        // The top-right corner is column 7, but sits at the left of its own band.
        expect(readCell(info.stickyTopRight[0]).style.left).toBe(0);
        // A centre cell keeps absolute coordinates.
        const centreCell = info.cells.map(readCell).find((c) => c.row === 5 && c.col === 2);
        expect(centreCell?.style.top).toBe(100);
        expect(centreCell?.style.left).toBe(200);
    });

    it("renders only the sticky header when there are no data rows", () => {
        const info = calcRenderInfo(
            renderInfoInitialState,
            makeInput({ rowCount: 1, columnCount: 3, stickyTop: 1 }),
        );

        expect(coords(info.stickyTop)).toEqual(["0_0", "0_1", "0_2"]);
        expect(info.cells).toEqual([]);
    });
});

// ---------------------------------------------------------------------------

describe("calcRenderInfo — reuse", () => {
    it("returns the identical object for a scroll inside the rendered band", () => {
        const first = calcRenderInfo(renderInfoInitialState, makeInput());

        const second = calcRenderInfo(
            first,
            makeInput({ offset: { x: 0, y: 5 }, direction: { x: 0, y: 1 } }),
        );

        // Identity, not equality — the caller detects "nothing to do" by reference.
        expect(second).toBe(first);
    });

    it("recomputes once the scroll leaves the band", () => {
        const first = calcRenderInfo(renderInfoInitialState, makeInput());

        const second = calcRenderInfo(
            first,
            makeInput({ offset: { x: 0, y: 300 }, direction: { x: 0, y: 1 } }),
        );

        expect(second).not.toBe(first);
        expect(second.visible.top).toBe(15);
    });

    it("returns the identical object when the new window is already covered", () => {
        const initial = calcRenderInfo(renderInfoInitialState, makeInput());
        const overscanned = calcRenderInfo(
            initial,
            makeInput({
                offset: { x: 0, y: 300 },
                overscanRow: 10,
                direction: { x: 0, y: 1 },
            }),
        );
        expect(overscanned.rendered.bottom).toBe(overscanned.visible.bottom + 10);

        // No direction, so the offset fast path is skipped and the containment check runs.
        const second = calcRenderInfo(
            overscanned,
            makeInput({ offset: { x: 0, y: 305 } }),
        );

        expect(second).toBe(overscanned);
    });

    it("treats a directional first call at offset 0 as already covered", () => {
        // The initial state's visibleOffset is all zeros, so an offset of exactly (0,0)
        // falls inside it and the fast path returns the initial state having rendered
        // nothing. Reference behavior, preserved — but it means the first call of a grid's
        // life must not carry a scroll direction, or the grid comes up blank.
        const first = calcRenderInfo(
            renderInfoInitialState,
            makeInput({ direction: { x: 0, y: 1 } }),
        );

        expect(first).toBe(renderInfoInitialState);
        expect(first.cells).toEqual([]);
    });

    it("re-renders only the cell a dirty set names", () => {
        const first = calcRenderInfo(renderInfoInitialState, makeInput());

        const { renderCell, calls } = trackingRenderCell();
        const second = calcRenderInfo(
            first,
            makeInput({ renderCell, rerender: { cells: [{ row: 2, col: 3 }] } }),
        );

        // Exactly one call — not the row, not the column, not the window.
        expect(calls).toEqual([{ row: 2, col: 3 }]);

        // Every other cell is carried over by reference.
        const reused = Object.keys(first.map).filter(
            (k) => k !== "2_3" && second.map[k as keyof typeof second.map],
        );
        expect(reused.length).toBeGreaterThan(50);
        for (const key of reused) {
            expect(second.map[key as keyof typeof second.map]).toBe(
                first.map[key as keyof typeof first.map],
            );
        }
    });

    it("re-renders a whole row when the dirty set names the row", () => {
        const first = calcRenderInfo(renderInfoInitialState, makeInput());

        const { renderCell, calls } = trackingRenderCell();
        calcRenderInfo(first, makeInput({ renderCell, rerender: { rows: [2] } }));

        expect(calls.length).toBe(6); // columns 0..5
        expect(calls.every((c) => c.row === 2)).toBe(true);
    });

    it("re-renders everything when the dirty set says all", () => {
        const first = calcRenderInfo(renderInfoInitialState, makeInput());

        const { renderCell, calls } = trackingRenderCell();
        calcRenderInfo(first, makeInput({ renderCell, rerender: { all: true } }));

        expect(calls.length).toBe(Object.keys(first.map).length);
    });

    it("ignores dirty entries outside the rendered window", () => {
        const first = calcRenderInfo(renderInfoInitialState, makeInput());

        const { renderCell, calls } = trackingRenderCell();
        calcRenderInfo(
            first,
            makeInput({
                renderCell,
                // Row 500 is nowhere near the viewport; marking it must cost nothing.
                rerender: { cells: [{ row: 500, col: 3 }] },
            }),
        );

        expect(calls).toEqual([]);
    });
});

// ---------------------------------------------------------------------------

describe("scroll offsets", () => {
    const info: RenderInputPrepared = calcRenderInfo(
        renderInfoInitialState,
        makeInput({ stickyTop: 1, stickyLeft: 1 }),
    );

    it("leaves the offset alone when the row is already visible", () => {
        const res = calcScrollOffsetY(5, info, { x: 0, y: 0 });
        expect(res.y).toBe(0);
    });

    it("scrolls the minimum distance to reveal a row below (nearest)", () => {
        const res = calcScrollOffsetY(20, info, { x: 0, y: 0 });
        // Row 20 ends at 420; the visible height is 200.
        expect(res.y).toBe(220);
    });

    it("puts the row at the top when asked", () => {
        const res = calcScrollOffsetY(20, info, { x: 0, y: 0 }, "top");
        // Row 20 starts at 400, less the 20px sticky header.
        expect(res.y).toBe(380);
    });

    it("puts the row at the bottom when asked", () => {
        const res = calcScrollOffsetY(20, info, { x: 0, y: 0 }, "bottom");
        expect(res.y).toBe(220);
    });

    it("scrolls to the very bottom for the last row, whatever the alignment", () => {
        const maxOffset = info.innerSize.height - info.input.size.height;
        expect(calcScrollOffsetY(999, info, { x: 0, y: 0 }, "top").y).toBe(maxOffset);
        expect(calcScrollOffsetY(999, info, { x: 0, y: 0 }, "nearest").y).toBe(
            maxOffset,
        );
    });

    it("scrolls horizontally past the sticky-left band", () => {
        const res = calcScrollOffsetX(9, info, { x: 0, y: 0 });
        // Column 9 ends at 1000; the visible width is 500.
        expect(res.x).toBe(500);
    });

    it("leaves the horizontal offset alone when the column is visible", () => {
        expect(calcScrollOffsetX(2, info, { x: 0, y: 0 }).x).toBe(0);
    });
});
