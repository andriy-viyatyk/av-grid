// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { AVGrid } from "../AVGrid";
import type { AVGridOptions } from "../options";
import type { RerenderInfo } from "../render/types";

/**
 * Focus, keyboard navigation and range selection.
 *
 * happy-dom does no layout, so the same `withLayout` trick as `AVGrid.test.ts` gives the shell
 * a viewport to compute against. What these tests can check is *behaviour and bookkeeping*:
 * which cell is focused after a key, which classes land on which element, and — the one that
 * matters most — exactly which cells a selection change marks dirty.
 *
 * What they cannot check is that a drag at row 99,000 is as fast as one at row 100. That is a
 * wall-clock question and it belongs to the board. See `test-boards/AVGridBoard`.
 */
function withLayout<T>(fn: () => T): T {
    const originalCreate = document.createElement.bind(document);
    document.createElement = ((tag: string) => {
        const el = originalCreate(tag) as HTMLElement;
        Object.defineProperties(el, {
            offsetWidth: { value: 600, configurable: true },
            offsetHeight: { value: 300, configurable: true },
            clientWidth: { value: 600, configurable: true },
            clientHeight: { value: 300, configurable: true },
        });
        return el;
    }) as typeof document.createElement;

    try {
        return fn();
    } finally {
        document.createElement = originalCreate;
    }
}

interface Row {
    id: number;
    name: string;
    score: number;
}

function rows(count: number): Row[] {
    return Array.from({ length: count }, (_, i) => ({
        id: i + 1,
        name: `Row ${i + 1}`,
        score: (i * 7) % 100,
    }));
}

const grids: AVGrid<any>[] = [];

function create<R>(options: AVGridOptions<R>): AVGrid<R> {
    const host = document.createElement("div");
    document.body.append(host);
    const grid = withLayout(() => AVGrid.create<R>(host, options));
    grids.push(grid);
    return grid;
}

function grid(count = 20, extra: Partial<AVGridOptions<Row>> = {}): AVGrid<Row> {
    return create<Row>({
        rows: rows(count),
        columns: [
            { key: "id", name: "ID", width: 60 },
            { key: "name", name: "Name", width: 120 },
            { key: "score", name: "Score", width: 80 },
        ],
        getRowKey: (r) => String(r.id),
        ...extra,
    });
}

function cellAt(g: AVGrid<Row>, row: number, col: number): HTMLElement | null {
    return g.element.querySelector(
        `[data-type="data-cell"][data-row="${row}"][data-col="${col}"]`,
    );
}

function classesAt(g: AVGrid<Row>, row: number, col: number): string[] {
    const el = cellAt(g, row, col);
    return el ? Array.from(el.classList) : [];
}

function key(g: AVGrid<Row>, k: string, init: KeyboardEventInit = {}): void {
    g.element.dispatchEvent(
        new KeyboardEvent("keydown", { key: k, bubbles: true, ...init }),
    );
}

function pointer(el: Element, type: string, init: MouseEventInit = {}): void {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, ...init }));
}

/**
 * Move the pointer over a cell mid-drag.
 *
 * The drag listens on `window` and resolves the cell by hit-testing the point, so that a drag
 * leaving the grid keeps extending the selection. happy-dom does no layout and cannot
 * hit-test, so the point is faked: `elementFromPoint` is pointed at the cell the test means.
 */
function dragOver(g: AVGrid<Row>, row: number, col: number): void {
    const target = cellAt(g, row, col);
    const original = document.elementFromPoint;
    document.elementFromPoint = () => target;
    try {
        window.dispatchEvent(
            new MouseEvent("pointermove", { bubbles: true, button: 0 }),
        );
    } finally {
        document.elementFromPoint = original;
    }
}

function releasePointer(): void {
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
}

/** happy-dom reports every rect as 0×0; give the scroll container a believable one. */
function stubViewportRect(g: AVGrid<Row>): void {
    const container = g.element.querySelector(
        '[data-type="render-grid-scroll"]',
    ) as HTMLElement;
    container.getBoundingClientRect = () =>
        ({
            left: 0,
            top: 0,
            right: 600,
            bottom: 300,
            width: 600,
            height: 300,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        }) as DOMRect;
}

/** A drag move that hits no cell — the pointer has left the grid. */
function dragOutside(clientX: number, clientY: number): void {
    const original = document.elementFromPoint;
    document.elementFromPoint = () => null;
    try {
        window.dispatchEvent(
            new MouseEvent("pointermove", { bubbles: true, clientX, clientY }),
        );
    } finally {
        document.elementFromPoint = original;
    }
}

/** Collect every dirty set the grid produces while `fn` runs. */
function captureDirty(g: AVGrid<Row>, fn: () => void): RerenderInfo[] {
    const captured: RerenderInfo[] = [];
    const spy = vi
        .spyOn(g.render.model, "update")
        .mockImplementation((info?: RerenderInfo) => {
            captured.push(info ?? {});
        });
    try {
        fn();
    } finally {
        spy.mockRestore();
    }
    return captured;
}

afterEach(() => {
    while (grids.length) grids.pop()?.destroy();
    document.body.textContent = "";
});

describe("focus", () => {
    it("starts with nothing focused, and no cell carries a focus class", () => {
        const g = grid();
        expect(g.getFocus()).toBeUndefined();
        expect(g.getSelection()).toBeUndefined();
        expect(classesAt(g, 0, 0)).not.toContain("avg-focused");
    });

    it("focusCell focuses a cell and marks it in the DOM", async () => {
        const g = grid();
        g.focusCell(2, 1);
        await paint(g);

        expect(g.getFocus()?.rowKey).toBe("3");
        expect(g.getFocus()?.columnKey).toBe("name");
        expect(classesAt(g, 2, 1)).toContain("avg-focused");
        expect(classesAt(g, 2, 0)).not.toContain("avg-focused");
    });

    it("clearFocus removes the classes again", async () => {
        const g = grid();
        g.focusCell(2, 1);
        await paint(g);
        g.clearFocus();
        await paint(g);

        expect(g.getFocus()).toBeUndefined();
        expect(classesAt(g, 2, 1)).not.toContain("avg-focused");
    });

    it("reports through onFocusChange", () => {
        const onFocusChange = vi.fn();
        const g = grid(20, { onFocusChange });
        g.focusCell(1, 0);
        expect(onFocusChange).toHaveBeenCalledTimes(1);
        expect(onFocusChange.mock.calls[0][0].rowKey).toBe("2");

        g.clearFocus();
        expect(onFocusChange).toHaveBeenLastCalledWith(undefined);
    });

    it("appears in getState()", () => {
        const g = grid();
        g.focusCell(4, 2);
        expect(g.getState().focus?.rowKey).toBe("5");
    });
});

// ---------------------------------------------------------------------------
// The `focus` option
// ---------------------------------------------------------------------------

describe("the focus option", () => {
    it("focuses a cell at create, from keys alone", async () => {
        const g = grid(20, {
            focus: { rowKey: "3", columnKey: "name", isDragging: false },
        });
        await paint(g);

        expect(g.getFocus()?.rowKey).toBe("3");
        expect(classesAt(g, 2, 1)).toContain("avg-focused");
    });

    it("restores a whole range at create", async () => {
        const g = grid(20, {
            focus: {
                rowKey: "4",
                columnKey: "name",
                isDragging: false,
                selection: {
                    rowKeyStart: "2",
                    colKeyStart: "id",
                    rowStart: 1,
                    colStart: 0,
                    rowKeyEnd: "4",
                    colKeyEnd: "name",
                    rowEnd: 3,
                    colEnd: 1,
                },
            },
        });
        await paint(g);

        expect(g.getSelection()?.rowRange).toEqual([1, 3]);
        expect(classesAt(g, 2, 0)).toContain("avg-in-selection");
        expect(classesAt(g, 4, 0)).not.toContain("avg-in-selection");
    });

    it("does not report the focus it was handed at create", () => {
        const onFocusChange = vi.fn();
        grid(20, {
            focus: { rowKey: "3", columnKey: "name", isDragging: false },
            onFocusChange,
        });
        expect(onFocusChange).not.toHaveBeenCalled();
    });

    it("moves the focus through setOptions", async () => {
        const onFocusChange = vi.fn();
        const g = grid(20, { onFocusChange });

        g.setOptions({ focus: { rowKey: "5", columnKey: "score", isDragging: false } });
        await paint(g);

        expect(g.getFocus()?.rowKey).toBe("5");
        expect(classesAt(g, 4, 2)).toContain("avg-focused");
        expect(onFocusChange).toHaveBeenCalledTimes(1);
    });

    it("clears the focus when the option is set to undefined", () => {
        const g = grid();
        g.focusCell(2, 1);
        g.setOptions({ focus: undefined });
        expect(g.getFocus()).toBeUndefined();
    });

    /**
     * The property the whole thing rests on. A host that echoes `onFocusChange` back as the
     * `focus` option hands back an equal but *different* object; re-applying it would fire the
     * callback again, producing another object, for ever.
     */
    /**
     * The bug the browser found the first time `focus` was driven as a controlled prop, and the
     * reason `isDragging` is not host-writable. A host echoing `onFocusChange` back sends the
     * *previous* event's value: the one from `pointerdown`, which says a drag is in flight,
     * arriving after the `pointerup` that ended it. The grid must keep its own flag.
     */
    it("never lets a host-supplied focus change isDragging", () => {
        const g = grid();
        g.focusCell(2, 1);
        expect(g.getFocus()?.isDragging).toBe(false);

        const stale = { ...structuredClone(g.getFocus())!, isDragging: true };
        g.setOptions({ focus: stale });

        expect(g.getFocus()?.isDragging).toBe(false);
    });

    it("drops isDragging from a focus restored at create", () => {
        const g = grid(20, {
            focus: { rowKey: "3", columnKey: "name", isDragging: true },
        });
        expect(g.getFocus()?.isDragging).toBe(false);
    });

    it("keeps a live drag armed when the focus is echoed back mid-gesture", async () => {
        const g = grid();
        const cell = cellAt(g, 1, 1)!;
        pointer(cell, "pointerdown");
        await paint(g);
        expect(g.getFocus()?.isDragging).toBe(true);

        // What a controlled binding does on the commit after `pointerdown`.
        g.setOptions({ focus: structuredClone(g.getFocus()) });
        expect(g.getFocus()?.isDragging).toBe(true);

        window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
        expect(g.getFocus()?.isDragging).toBe(false);
    });

    it("ignores a focus that is equal in value but not in identity", () => {
        const onFocusChange = vi.fn();
        const g = grid(20, { onFocusChange });
        g.focusCell(2, 1);
        expect(onFocusChange).toHaveBeenCalledTimes(1);

        const echoed = structuredClone(g.getFocus());
        expect(echoed).not.toBe(g.getFocus());

        g.setOptions({ focus: echoed });
        g.setOptions({ focus: structuredClone(echoed) });

        expect(onFocusChange).toHaveBeenCalledTimes(1);
        expect(g.getFocus()?.rowKey).toBe("3");
    });

    it("still reports a focus that differs in only one field", () => {
        const onFocusChange = vi.fn();
        const g = grid(20, { onFocusChange });
        g.selectRange(1, 0, 3, 1);
        onFocusChange.mockClear();

        const wider = structuredClone(g.getFocus())!;
        wider.selection!.rowEnd = 4;
        wider.selection!.rowKeyEnd = "5";
        wider.rowKey = "5";
        g.setOptions({ focus: wider });

        expect(onFocusChange).toHaveBeenCalledTimes(1);
        expect(g.getSelection()?.rowRange).toEqual([1, 4]);
    });
});

describe("range selection", () => {
    it("selectRange marks every cell in the rectangle", async () => {
        const g = grid();
        g.selectRange(1, 0, 3, 1);
        await paint(g);

        for (let row = 1; row <= 3; row++) {
            for (let col = 0; col <= 1; col++) {
                expect(classesAt(g, row, col)).toContain("avg-in-selection");
            }
        }
        expect(classesAt(g, 0, 0)).not.toContain("avg-in-selection");
        expect(classesAt(g, 1, 2)).not.toContain("avg-in-selection");
    });

    it("marks the four edges of the rectangle, and only those", async () => {
        const g = grid();
        g.selectRange(1, 0, 3, 2);
        await paint(g);

        expect(classesAt(g, 1, 1)).toContain("avg-in-selection-top");
        expect(classesAt(g, 2, 1)).not.toContain("avg-in-selection-top");
        expect(classesAt(g, 3, 1)).toContain("avg-in-selection-bottom");
        expect(classesAt(g, 2, 0)).toContain("avg-in-selection-left");
        expect(classesAt(g, 2, 2)).toContain("avg-in-selection-right");
        expect(classesAt(g, 2, 1)).not.toContain("avg-in-selection-left");
    });

    it("puts the focus on the end corner, whichever way the range was given", () => {
        const g = grid();
        g.selectRange(5, 2, 1, 0);

        const selection = g.getSelection()!;
        expect(selection.focusRow).toBe(1);
        expect(selection.focusCol).toBe(0);
        // The reported range is always ascending, whatever order it was dragged in.
        expect(selection.rowRange).toEqual([1, 5]);
        expect(selection.colRange).toEqual([0, 2]);
        expect(selection.rows.map((r) => r.id)).toEqual([2, 3, 4, 5, 6]);
        expect(selection.columns.map((c) => c.key)).toEqual(["id", "name", "score"]);
    });

    it("selects everything on ctrl+A", () => {
        const g = grid(20);
        g.focusCell(0, 0);
        key(g, "a", { code: "KeyA", ctrlKey: true });

        const selection = g.getSelection()!;
        expect(selection.rowRange).toEqual([0, 19]);
        expect(selection.colRange).toEqual([0, 2]);
    });
});

describe("keyboard navigation", () => {
    it("moves with the arrow keys", () => {
        const g = grid();
        g.focusCell(5, 1);

        key(g, "ArrowDown");
        expect(g.getFocus()?.rowKey).toBe("7");
        key(g, "ArrowUp");
        expect(g.getFocus()?.rowKey).toBe("6");
        key(g, "ArrowRight");
        expect(g.getFocus()?.columnKey).toBe("score");
        key(g, "ArrowLeft");
        expect(g.getFocus()?.columnKey).toBe("name");
    });

    it("stops at the edges rather than wrapping", () => {
        const g = grid(5);
        g.focusCell(0, 0);
        key(g, "ArrowUp");
        key(g, "ArrowLeft");
        expect(g.getSelection()!.focusRow).toBe(0);
        expect(g.getSelection()!.focusCol).toBe(0);

        g.focusCell(4, 2);
        key(g, "ArrowDown");
        key(g, "ArrowRight");
        expect(g.getSelection()!.focusRow).toBe(4);
        expect(g.getSelection()!.focusCol).toBe(2);
    });

    it("Home and End jump to the first and last row; ctrl adds the column", () => {
        const g = grid(30);
        g.focusCell(10, 1);

        key(g, "End");
        expect(g.getSelection()!.focusRow).toBe(29);
        expect(g.getSelection()!.focusCol).toBe(1);

        key(g, "Home");
        expect(g.getSelection()!.focusRow).toBe(0);

        key(g, "End", { ctrlKey: true });
        expect(g.getSelection()!.focusRow).toBe(29);
        expect(g.getSelection()!.focusCol).toBe(2);

        key(g, "Home", { ctrlKey: true });
        expect(g.getSelection()!.focusRow).toBe(0);
        expect(g.getSelection()!.focusCol).toBe(0);
    });

    it("ctrl+left and ctrl+right jump to the first and last column", () => {
        const g = grid();
        g.focusCell(3, 1);
        key(g, "ArrowRight", { ctrlKey: true });
        expect(g.getSelection()!.focusCol).toBe(2);
        key(g, "ArrowLeft", { ctrlKey: true });
        expect(g.getSelection()!.focusCol).toBe(0);
    });

    it("PageDown and PageUp move by a viewport, clamped to the ends", () => {
        const g = grid(200);
        g.focusCell(0, 0);
        const page = g.render.model.visibleRowCount;
        expect(page).toBeGreaterThan(1);

        key(g, "PageDown");
        expect(g.getSelection()!.focusRow).toBe(page);

        key(g, "PageUp");
        expect(g.getSelection()!.focusRow).toBe(0);

        key(g, "PageUp");
        expect(g.getSelection()!.focusRow).toBe(0);
    });

    it("ctrl+down and ctrl+up move by a viewport too", () => {
        const g = grid(200);
        g.focusCell(0, 0);
        const page = g.render.model.visibleRowCount;

        key(g, "ArrowDown", { ctrlKey: true });
        expect(g.getSelection()!.focusRow).toBe(page);
        key(g, "ArrowUp", { ctrlKey: true });
        expect(g.getSelection()!.focusRow).toBe(0);
    });

    it("Tab walks across then wraps to the next row; shift+Tab walks back", () => {
        const g = grid();
        g.focusCell(2, 1);

        key(g, "Tab");
        expect(g.getSelection()!.focusCol).toBe(2);
        key(g, "Tab");
        expect(g.getSelection()!.focusCol).toBe(0);
        expect(g.getSelection()!.focusRow).toBe(3);

        key(g, "Tab", { shiftKey: true });
        expect(g.getSelection()!.focusCol).toBe(2);
        expect(g.getSelection()!.focusRow).toBe(2);
    });

    it("shift+arrow extends the selection from its anchor", () => {
        const g = grid();
        g.focusCell(3, 1);

        key(g, "ArrowDown", { shiftKey: true });
        key(g, "ArrowDown", { shiftKey: true });
        key(g, "ArrowRight", { shiftKey: true });

        const selection = g.getSelection()!;
        expect(selection.rowRange).toEqual([3, 5]);
        expect(selection.colRange).toEqual([1, 2]);
        expect(selection.focusRow).toBe(5);
    });

    it("a plain arrow after a shift-extend collapses the selection again", () => {
        const g = grid();
        g.focusCell(3, 0);
        key(g, "ArrowDown", { shiftKey: true });
        expect(g.getSelection()!.rowRange).toEqual([3, 4]);

        key(g, "ArrowDown");
        expect(g.getSelection()!.rowRange).toEqual([5, 5]);
    });

    it("the first navigation key on an unfocused grid lands on the first cell", () => {
        const g = grid();
        key(g, "ArrowDown");
        expect(g.getSelection()!.focusRow).toBe(0);
        expect(g.getSelection()!.focusCol).toBe(0);
    });

    it("ignores keys that came from an editor inside a cell", () => {
        const g = grid();
        g.focusCell(3, 1);

        const input = document.createElement("input");
        cellAt(g, 3, 1)!.append(input);
        input.dispatchEvent(
            new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
        );

        expect(g.getSelection()!.focusRow).toBe(3);
    });

    it("leaves keys it does not handle to the host", () => {
        const g = grid();
        g.focusCell(1, 1);
        const e = new KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true });
        g.element.dispatchEvent(e);
        expect(e.defaultPrevented).toBe(false);
    });
});

describe("pointer drag", () => {
    it("selects a range from press to release", () => {
        const g = grid();
        pointer(cellAt(g, 1, 0)!, "pointerdown");
        expect(g.getSelection()!.rowRange).toEqual([1, 1]);

        dragOver(g, 4, 2);
        expect(g.getSelection()!.rowRange).toEqual([1, 4]);
        expect(g.getSelection()!.colRange).toEqual([0, 2]);

        releasePointer();

        // Moving after the release does nothing.
        dragOver(g, 6, 2);
        expect(g.getSelection()!.rowRange).toEqual([1, 4]);
    });

    it("keeps extending to the edge row while the pointer is outside the grid", () => {
        const g = grid(200);
        stubViewportRect(g);

        pointer(cellAt(g, 5, 0)!, "pointerdown");

        // Below the grid: the pointer hits nothing, so the target comes from the geometry
        // instead and the selection runs to the last visible row rather than stalling.
        dragOutside(300, 1000);
        const lastVisible = g.render.model.renderInfo.current.visible.bottom - 1;
        expect(lastVisible).toBeGreaterThan(5);
        expect(g.getSelection()!.rowRange).toEqual([5, lastVisible]);

        // Above it, over the sticky header, the same rule runs the other way.
        dragOutside(300, -50);
        const firstVisible = g.render.model.renderInfo.current.visible.top - 1;
        expect(g.getSelection()!.rowRange).toEqual([Math.max(0, firstVisible), 5]);

        releasePointer();
    });

    it("shift-clicking extends from the existing anchor", () => {
        const g = grid();
        pointer(cellAt(g, 2, 0)!, "pointerdown");
        releasePointer();

        pointer(cellAt(g, 5, 2)!, "pointerdown", { shiftKey: true });
        expect(g.getSelection()!.rowRange).toEqual([2, 5]);
        expect(g.getSelection()!.colRange).toEqual([0, 2]);
    });

    it("a right-click inside a selection leaves it alone", () => {
        const g = grid();
        g.selectRange(1, 0, 4, 2);

        pointer(cellAt(g, 2, 1)!, "pointerdown", { button: 2 });
        expect(g.getSelection()!.rowRange).toEqual([1, 4]);

        pointer(cellAt(g, 8, 1)!, "pointerdown", { button: 2 });
        expect(g.getSelection()!.rowRange).toEqual([8, 8]);
    });

    it("focuses the grid root, never a pooled cell", () => {
        const g = grid();
        pointer(cellAt(g, 1, 0)!, "pointerdown");
        expect(document.activeElement).toBe(g.element);
    });
});

describe("the dirty set", () => {
    it("marks only the cells whose selection state changed", () => {
        const g = grid(200);
        g.selectRange(0, 0, 3, 2);

        // Extend by exactly one row. Rows 0–3 stay selected; row 3 loses the bottom border and
        // row 4 gains it — so 6 cells, not the 15 the whole rectangle would be.
        const dirty = captureDirty(g, () => g.selectRange(0, 0, 4, 2));

        const cells = dirty.flatMap((d) => d.cells ?? []);
        expect(dirty.every((d) => !d.all)).toBe(true);
        expect(new Set(cells.map((c) => c.row))).toEqual(new Set([4, 5]));
        expect(cells).toHaveLength(6);
    });

    it("marks nothing at all when the selection does not move", () => {
        const g = grid();
        g.selectRange(1, 0, 3, 2);
        const dirty = captureDirty(g, () => g.selectRange(1, 0, 3, 2));
        expect(dirty.flatMap((d) => d.cells ?? [])).toHaveLength(0);
    });

    it("costs the same at row 99,000 as at row 100", () => {
        const g = grid(100_000);

        const near = countDirty(g, 100);
        const far = countDirty(g, 99_000);

        // Not "similar" — identical. The dirty set is a function of the viewport, and the
        // viewport does not know what row it is looking at.
        expect(far).toBe(near);
        expect(far).toBeGreaterThan(0);
    });

    /** Cells marked by extending a selection one row further down, starting at `from`. */
    function countDirty(g: AVGrid<Row>, from: number): number {
        // Scroll `from` to the top of the viewport. happy-dom does not dispatch a scroll event
        // for an assignment to scrollTop, so drive the model directly.
        g.render.model.offset = { x: 0, y: from * 24 };
        g.render.model.updateRenderInfo({ all: true });

        g.selectRange(from, 0, from + 10, 2);
        const dirty = captureDirty(g, () => g.selectRange(from, 0, from + 11, 2));
        return dirty.flatMap((d) => d.cells ?? []).length;
    }
});

describe("keeping focus valid", () => {
    it("follows its row through a sort", () => {
        const g = grid(10);
        g.focusCell(0, 1);
        expect(g.getFocus()?.rowKey).toBe("1");

        g.setSort({ key: "id", direction: "desc" });

        // Same row, new position: last instead of first.
        expect(g.getFocus()?.rowKey).toBe("1");
        expect(g.getSelection()!.focusRow).toBe(9);
    });

    it("collapses a multi-cell selection when the rows move under it", () => {
        const g = grid(10);
        g.selectRange(0, 0, 3, 2);
        g.setSort({ key: "id", direction: "desc" });

        const selection = g.getSelection()!;
        expect(selection.rowRange[0]).toBe(selection.rowRange[1]);
    });

    it("falls back to the index when the focused row is filtered away", () => {
        const g = grid(10);
        g.focusCell(4, 1);
        expect(g.getFocus()?.rowKey).toBe("5");

        g.setSearchString("Row 1");

        // "Row 5" is gone; the focus lands on whatever is at the old index, clamped.
        const focus = g.getFocus()!;
        expect(g.getVisibleRows().some((r) => String(r.id) === focus.rowKey)).toBe(true);
    });

    it("drops the focus entirely when every row is filtered away", () => {
        const g = grid(10);
        g.focusCell(4, 1);
        g.setSearchString("nothing matches this");
        expect(g.getFocus()).toBeUndefined();
    });
});

/** Let the microtask-coalesced dirty set and the rAF paint both run. */
function paint(g: AVGrid<Row>): Promise<void> {
    return new Promise((resolve) => {
        void Promise.resolve().then(() => {
            g.render.model.updateRenderInfo();
            requestAnimationFrame(() => resolve());
        });
    });
}

/**
 * `focus.isDragging` announces a drag on the press, and two presses never start one.
 *
 * `cell.onMouseDown` is sent as the first statement of the pointerdown handler — before the
 * button check and before either early return — so `FocusModel` sets the flag for every primary
 * press. Only `onSelectEnd` clears it, and it is sent from `endSelect`, which returns unless a
 * drag was armed. So the checkbox press and the press on an open editor used to leave the flag
 * on for the rest of the grid's life, and `updateFocus` preserved it on every later focus move.
 *
 * These two are the reason a host cannot use `isDragging` as a "suppress while dragging" gate
 * unless it is honest, so they assert the flag is *false* after each press rather than asserting
 * some visible effect.
 */
describe("isDragging does not latch", () => {
    interface BoolRow {
        id: number;
        done: boolean;
        name: string;
    }

    function boolGrid(): AVGrid<BoolRow> {
        return create<BoolRow>({
            rows: [
                { id: 1, done: false, name: "one" },
                { id: 2, done: true, name: "two" },
            ],
            columns: [
                { key: "done", name: "Done", width: 60, dataType: "boolean" },
                { key: "name", name: "Name", width: 120 },
            ],
            getRowKey: (r) => String(r.id),
            editable: true,
        });
    }

    it("clears after a boolean checkbox press, which never arms a drag", () => {
        const g = boolGrid();
        const cell = g.element.querySelector(
            '[data-type="data-cell"][data-row="0"][data-col="0"]',
        )!;
        const toggle = cell.querySelector('[data-type="bool-toggle"]');
        expect(toggle).not.toBeNull();

        pointer(toggle!, "pointerdown");

        // The press did its job…
        expect(g.getRows()[0]!.done).toBe(true);
        // …and did not leave a drag announced.
        expect(g.getFocus()?.isDragging ?? false).toBe(false);
    });

    it("clears after a press on the cell that already holds an open editor", () => {
        const g = boolGrid();
        g.focusCell(0, 1);
        g.startEdit(0, 1);
        expect(g.isEditing()).toBe(true);

        const cell = g.element.querySelector(
            '[data-type="data-cell"][data-row="0"][data-col="1"]',
        )!;
        pointer(cell, "pointerdown");

        expect(g.getFocus()?.isDragging ?? false).toBe(false);
    });

    it("stays true for the press that really does start a drag, until the release", () => {
        const g = boolGrid();
        const cell = g.element.querySelector(
            '[data-type="data-cell"][data-row="1"][data-col="1"]',
        )!;

        pointer(cell, "pointerdown");
        expect(g.getFocus()?.isDragging).toBe(true);

        releasePointer();
        expect(g.getFocus()?.isDragging).toBe(false);
    });
});
