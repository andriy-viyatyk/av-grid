// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeasuredRowGrid, type MeasuredRowGridOptions } from "./MeasuredRowGrid";
import { MEASURED_ROW_DEBOUNCE_MS } from "./MeasuredRowHeights";
import type { RerenderInfo } from "../render/types";

/**
 * happy-dom does no layout, so every measurement this layer exists to take reads 0. The row's
 * intended height is therefore *declared* on the element and read back through a patched
 * `clientHeight`. That tests the plumbing — which element is measured, when, and what is done
 * with the number — and cannot test layout itself; the board does that.
 */
function setMeasuredHeight(el: HTMLElement, height: number): void {
    Object.defineProperty(el, "clientHeight", {
        value: height,
        configurable: true,
    });
}

function giveLayout(el: HTMLElement, width: number, height: number) {
    Object.defineProperties(el, {
        offsetWidth: { value: width, configurable: true },
        offsetHeight: { value: height, configurable: true },
        clientWidth: { value: width, configurable: true },
        clientHeight: { value: height, configurable: true },
    });
}

interface Harness {
    grid: MeasuredRowGrid;
    host: HTMLElement;
    /** The element each row nominated for measurement, by row. */
    bodies: Map<number, HTMLElement>;
    heightOfRow: (row: number) => number;
    setRowContentHeight: (row: number, height: number) => void;
}

let rowContentHeight: Map<number, number>;

function createGrid(over: Partial<MeasuredRowGridOptions> = {}): Harness {
    rowContentHeight = new Map();
    const bodies = new Map<number, HTMLElement>();
    const heightOfRow = (row: number) => rowContentHeight.get(row) ?? 30;

    const host = document.createElement("div");
    document.body.append(host);

    const originalCreate = document.createElement.bind(document);
    const patched = ((tag: string) => {
        const el = originalCreate(tag) as HTMLElement;
        giveLayout(el, 400, 200);
        return el;
    }) as typeof document.createElement;
    document.createElement = patched;

    let grid: MeasuredRowGrid;
    try {
        grid = new MeasuredRowGrid(host, {
            rowCount: 1000,
            columnCount: 1,
            columnWidth: 400,
            minRowHeight: 10,
            renderCell: (p) => {
                const cell =
                    p.previous ?? p.recycle?.() ?? document.createElement("div");
                cell.setAttribute("data-type", "cell");
                cell.setAttribute("data-row", String(p.row));
                cell.style.setProperty("position", "absolute");
                cell.style.setProperty("top", `${p.style.top}px`);
                cell.style.setProperty("height", `${p.style.height}px`);

                let body = cell.firstElementChild as HTMLElement | null;
                if (!body) {
                    body = originalCreate("div") as HTMLElement;
                    cell.append(body);
                    // A *live* height, as a real browser's is: it follows whichever row the
                    // cell currently stands for, and reads zero while the cell is hidden —
                    // which is the case re-admission has to survive.
                    Object.defineProperty(body, "clientHeight", {
                        configurable: true,
                        get: () =>
                            cell.style.display === "none"
                                ? 0
                                : heightOfRow(Number(cell.getAttribute("data-row"))),
                    });
                }
                bodies.set(p.row, body);
                p.measure(body);
                return cell;
            },
            ...over,
        });
    } finally {
        document.createElement = originalCreate;
    }

    return {
        grid,
        host,
        bodies,
        heightOfRow,
        setRowContentHeight: (row, height) => {
            rowContentHeight.set(row, height);
        },
    };
}

async function nextFrame() {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    await Promise.resolve();
}

/** Let the 50 ms per-row debounce elapse, then let the resulting paint run. */
async function settle() {
    await new Promise((resolve) => setTimeout(resolve, MEASURED_ROW_DEBOUNCE_MS + 5));
    await nextFrame();
    await nextFrame();
}

let grids: MeasuredRowGrid[] = [];

beforeEach(() => {
    grids = [];
});

afterEach(() => {
    for (const g of grids) g.destroy();
    document.body.innerHTML = "";
});

function track(result: Harness): Harness {
    grids.push(result.grid);
    return result;
}

// ---------------------------------------------------------------------------

describe("construction", () => {
    it("mounts a RenderGrid in the host and exposes it", () => {
        const { grid, host } = track(createGrid());
        expect(host.querySelector('[data-type="render-grid"]')).toBe(grid.root);
        expect(grid.model).toBe(grid.grid.model);
        expect(grid.scrollElement).toBe(grid.grid.container);
    });

    it("hands the engine the policy's stable rowHeight function", () => {
        const { grid } = track(createGrid());
        expect(grid.model.getOptions().rowHeight).toBe(grid.heights.rowHeight);
    });

    it("measures on the very first render, before any observer has fired", () => {
        const { grid } = track(createGrid());
        // Synchronous during `renderCell`, so the first debounce is already armed.
        expect(grid.heights.heightOf(0)).toBeUndefined();
    });
});

describe("measuring", () => {
    it("commits the nominated element's height and marks geometry from that row", async () => {
        const marks: RerenderInfo[] = [];
        const { grid, setRowContentHeight } = track(createGrid());
        const realUpdate = grid.model.update;
        grid.model.update = ((r?: RerenderInfo) => {
            if (r) marks.push(r);
            return realUpdate(r);
        }) as typeof grid.model.update;

        setRowContentHeight(0, 91);
        setRowContentHeight(1, 47);
        grid.model.update({ rows: [0, 1] });
        await settle();

        expect(grid.heights.heightOf(0)).toBe(91);
        expect(grid.heights.heightOf(1)).toBe(47);
        expect(marks.some((m) => m.fromRow === 0)).toBe(true);
        expect(marks.some((m) => m.fromRow === 1)).toBe(true);
    });

    it("moves every following row's start offset, not just the changed row's", async () => {
        const { grid, setRowContentHeight } = track(createGrid());
        await settle();

        const topOf = (row: number) =>
            parseFloat(
                (
                    grid.root.querySelector(`[data-row="${row}"]`) as HTMLElement
                ).style.top,
            );
        const before = topOf(2);

        setRowContentHeight(0, 120);
        grid.model.update({ rows: [0] });
        await settle();

        // This is what `fromRow` buys: row 2 renders the same content and sits somewhere else.
        expect(topOf(2)).toBeGreaterThan(before);
    });

    it("measures the cell itself when the renderer nominates nothing", async () => {
        const { grid } = track(
            createGrid({
                renderCell: (p) => {
                    const cell =
                        p.previous ?? p.recycle?.() ?? document.createElement("div");
                    cell.setAttribute("data-row", String(p.row));
                    setMeasuredHeight(cell, 55);
                    return cell;
                },
            }),
        );
        await settle();
        expect(grid.heights.heightOf(0)).toBe(55);
    });

    it("ignores a measurement for a row whose mapping has gone", async () => {
        const { grid, bodies } = track(createGrid());
        await settle();
        const orphan = document.createElement("div");
        setMeasuredHeight(orphan, 400);
        // Nothing maps this element to a row; the observer path must drop it silently.
        expect(bodies.get(0)).not.toBe(orphan);
        expect(grid.heights.heightOf(0)).toBe(30);
    });
});

describe("re-admission of a retained cell", () => {
    it("remeasures a cell that was hidden and measured zero", async () => {
        const { grid, setRowContentHeight } = track(
            createGrid({ keepCellsAttached: true }),
        );
        await settle();
        expect(grid.heights.heightOf(0)).toBe(30);

        grid.scrollElement.scrollTop = 4000;
        grid.scrollElement.dispatchEvent(new Event("scroll"));
        await settle();

        // Row 0's cell is retained, hidden, and now reports zero — which must not be committed.
        expect(grid.heights.heightOf(0)).toBe(30);

        setRowContentHeight(0, 140);
        grid.scrollElement.scrollTop = 0;
        grid.scrollElement.dispatchEvent(new Event("scroll"));
        await settle();

        // `onCellAttached` fired again even though `parentElement` never changed.
        expect(grid.heights.heightOf(0)).toBe(140);
    });

    it("drops the row mapping on release, retained or not", async () => {
        const released: HTMLElement[] = [];
        const { grid } = track(
            createGrid({
                keepCellsAttached: true,
                onCellReleased: (el) => released.push(el),
            }),
        );
        await settle();

        grid.scrollElement.scrollTop = 4000;
        grid.scrollElement.dispatchEvent(new Event("scroll"));
        await settle();

        // The consumer's own callback still runs — the layer forwards rather than swallows.
        expect(released.length).toBeGreaterThan(0);
        expect(released[0].isConnected).toBe(true);
    });
});

describe("setOptions", () => {
    it("keeps rowHeight and renderCell identity, so a policy change is not a geometry change", () => {
        const { grid } = track(createGrid());
        const rowHeight = grid.model.getOptions().rowHeight;
        const renderCell = grid.model.getOptions().renderCell;

        grid.setOptions({ maxRowHeight: 400, minRowHeight: 12 });

        expect(grid.model.getOptions().rowHeight).toBe(rowHeight);
        expect(grid.model.getOptions().renderCell).toBe(renderCell);
    });

    it("routes a replaced consumer renderer through the same wrapper", async () => {
        const { grid } = track(createGrid());
        const renderCell = grid.model.getOptions().renderCell;
        let calls = 0;

        grid.setOptions({
            renderCell: (p) => {
                calls++;
                const cell = p.previous ?? document.createElement("div");
                cell.setAttribute("data-row", String(p.row));
                setMeasuredHeight(cell, 66);
                return cell;
            },
        });
        grid.model.update({ all: true });
        await settle();

        expect(grid.model.getOptions().renderCell).toBe(renderCell);
        expect(calls).toBeGreaterThan(0);
        expect(grid.heights.heightOf(0)).toBe(66);
    });

    it("still lets a shell layout field through to the engine", () => {
        const { grid } = track(createGrid());
        grid.setOptions({ growToHeight: "150px" });
        expect(grid.root.style.maxHeight).toBe("150px");
    });
});

describe("disposal", () => {
    it("destroys the engine, disposes the policy and cancels pending frames", () => {
        const cancel = vi.spyOn(globalThis, "cancelAnimationFrame");
        const { grid, host } = createGrid();
        grid.destroy();

        expect(grid.heights.disposed).toBe(true);
        expect(host.querySelector('[data-type="render-grid"]')).toBeNull();
        expect(cancel).toHaveBeenCalled();
        // Idempotent, like every other destroy in the library.
        expect(() => grid.destroy()).not.toThrow();
        cancel.mockRestore();
    });

    it("commits nothing after disposal", async () => {
        const { grid, setRowContentHeight } = createGrid();
        setRowContentHeight(0, 300);
        grid.destroy();
        await settle();
        expect(grid.heights.heightOf(0)).toBeUndefined();
    });
});
