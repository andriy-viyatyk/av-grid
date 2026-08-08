// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RenderGrid, type RenderGridShellOptions } from "./RenderGrid";
import type { RenderCellParams, RenderedCell } from "./types";

/**
 * happy-dom does no layout, so `offsetWidth`/`offsetHeight` are always 0 and the grid would
 * measure itself as having no viewport. Pinning them to fixed values gives the model a real
 * size to work with, which is all it reads.
 */
function giveLayout(el: HTMLElement, width: number, height: number, scrollBar = 0) {
    Object.defineProperties(el, {
        offsetWidth: { value: width, configurable: true },
        offsetHeight: { value: height, configurable: true },
        clientWidth: { value: width - scrollBar, configurable: true },
        clientHeight: { value: height - scrollBar, configurable: true },
    });
}

/**
 * Sizes the grid's own elements the moment they are created. RenderGrid measures during its
 * constructor, so the patch has to be in place before that — hence patching createElement
 * for the duration of construction.
 */
function createGrid(over: Partial<RenderGridShellOptions> = {}) {
    const created: HTMLElement[] = [];
    const calls: Array<{ row: number; col: number }> = [];
    const recycled: HTMLElement[] = [];

    const renderCell = (p: RenderCellParams): RenderedCell => {
        calls.push({ row: p.row, col: p.col });
        const reused = p.recycle?.();
        if (reused) recycled.push(reused);
        const el = reused ?? document.createElement("div");
        if (!reused) created.push(el);
        el.setAttribute("data-type", "cell");
        el.setAttribute("data-row", String(p.row));
        el.setAttribute("data-col", String(p.col));
        el.style.setProperty("position", "absolute");
        el.style.setProperty("left", `${p.style.left}px`);
        el.style.setProperty("top", `${p.style.top}px`);
        return el;
    };

    const host = document.createElement("div");
    document.body.append(host);

    const originalCreate = document.createElement.bind(document);
    const patched = ((tag: string) => {
        const el = originalCreate(tag) as HTMLElement;
        giveLayout(el, 500, 200);
        return el;
    }) as typeof document.createElement;
    document.createElement = patched;

    let grid: RenderGrid;
    try {
        grid = new RenderGrid(host, {
            rowCount: 1000,
            columnCount: 10,
            rowHeight: 20,
            columnWidth: 100,
            renderCell,
            ...over,
        });
    } finally {
        document.createElement = originalCreate;
    }

    return { grid, host, calls, created, recycled };
}

const cellsIn = (el: HTMLElement) =>
    Array.from(el.querySelectorAll(':scope > [data-type="cell"]'));

/**
 * Advance one full paint cycle.
 *
 * The chain is: scroll -> model recompute -> requestRepaint -> observable notify (microtask)
 * -> schedulePaint -> requestAnimationFrame. The microtasks have to be drained *before* the
 * frame is awaited, or the rAF callback is registered after the one being waited on and the
 * paint slips to the following frame.
 */
async function nextFrame() {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    await Promise.resolve();
}

let grids: RenderGrid[] = [];

beforeEach(() => {
    grids = [];
});

afterEach(() => {
    for (const g of grids) g.destroy();
    document.body.innerHTML = "";
});

function track(result: ReturnType<typeof createGrid>) {
    grids.push(result.grid);
    return result;
}

// ---------------------------------------------------------------------------

describe("structure", () => {
    it("builds the root, scroll container and render area", () => {
        const { grid, host } = track(createGrid());

        expect(host.querySelector('[data-type="render-grid"]')).toBe(grid.root);
        expect(grid.root.querySelector('[data-type="render-grid-scroll"]')).toBe(
            grid.container,
        );
        expect(grid.container.querySelector('[data-type="render-grid-area"]')).toBe(
            grid.area,
        );
    });

    it("puts a stable data-type on all nine regions", () => {
        const { grid } = track(createGrid({ stickyTop: 1, stickyLeft: 1 }));

        for (const type of [
            "render-grid-sticky-top",
            "render-grid-sticky-bottom",
            "render-grid-sticky-left",
            "render-grid-sticky-right",
            "render-grid-sticky-top-left",
            "render-grid-sticky-top-right",
            "render-grid-sticky-bottom-left",
            "render-grid-sticky-bottom-right",
        ]) {
            expect(grid.area.querySelector(`[data-type="${type}"]`)).not.toBeNull();
        }
    });

    it("emits data-name when given one, for disambiguating instances", () => {
        const { grid } = track(createGrid({ name: "left-grid" }));
        expect(grid.root.getAttribute("data-name")).toBe("left-grid");
    });

    it("sizes the render area to the full scrollable extent", () => {
        const { grid } = track(createGrid());
        // 1000 rows x 20px + 20px whitespace
        expect(grid.area.style.height).toBe("20020px");
        expect(grid.area.style.width).toBe("1020px");
    });

    it("hides sticky regions that have no cells", () => {
        const { grid } = track(createGrid());
        const top = grid.area.querySelector(
            '[data-type="render-grid-sticky-top"]',
        ) as HTMLElement;
        expect(top.style.display).toBe("none");
    });

    it("shows and sizes the sticky top band when configured", () => {
        const { grid } = track(createGrid({ stickyTop: 1 }));
        const top = grid.area.querySelector(
            '[data-type="render-grid-sticky-top"]',
        ) as HTMLElement;

        expect(top.style.display).not.toBe("none");
        expect(top.style.height).toBe("20px");
        expect(top.style.top).toBe("0px");
    });
});

// ---------------------------------------------------------------------------

describe("first paint", () => {
    it("renders synchronously, so the grid is on screen when the constructor returns", () => {
        const { grid } = track(createGrid());
        expect(cellsIn(grid.area).length).toBe(11 * 6);
    });

    it("positions cells absolutely from the geometry", () => {
        const { grid } = track(createGrid());
        const cell = grid.area.querySelector(
            '[data-row="2"][data-col="3"]',
        ) as HTMLElement;

        expect(cell.style.top).toBe("40px");
        expect(cell.style.left).toBe("300px");
    });

    it("routes cells into their sticky region rather than the centre", () => {
        const { grid } = track(createGrid({ stickyTop: 1, stickyLeft: 1 }));

        const top = grid.area.querySelector(
            '[data-type="render-grid-sticky-top"]',
        ) as HTMLElement;
        const corner = grid.area.querySelector(
            '[data-type="render-grid-sticky-top-left"]',
        ) as HTMLElement;

        expect(cellsIn(corner).map((c) => c.getAttribute("data-row"))).toEqual(["0"]);
        expect(cellsIn(top).length).toBeGreaterThan(0);
        expect(
            cellsIn(grid.area).every((c) => c.getAttribute("data-row") !== "0"),
        ).toBe(true);
    });
});

// ---------------------------------------------------------------------------

describe("scrolling and the cell pool", () => {
    it("removes only the departed row and appends only the arrived one", async () => {
        const { grid } = track(createGrid());
        const before = grid.stats;

        grid.container.scrollTop = 21;
        grid.container.dispatchEvent(new Event("scroll"));
        await nextFrame();

        const delta = {
            removed: grid.stats.cellsRemoved - before.cellsRemoved,
            appended: grid.stats.cellsAppended - before.cellsAppended,
        };

        // Row 0 leaves, row 11 arrives — six columns each. Nothing else is touched.
        expect(delta).toEqual({ removed: 6, appended: 6 });
        expect(cellsIn(grid.area).length).toBe(11 * 6);
    });

    it("stops allocating cell elements once the pool has warmed", async () => {
        const { grid, created, recycled } = track(createGrid());
        expect(created.length).toBe(11 * 6);

        const scrollTo = async (y: number) => {
            grid.container.scrollTop = y;
            grid.container.dispatchEvent(new Event("scroll"));
            await nextFrame();
        };

        // The first scroll still allocates: the pool is empty until a paint has evicted
        // something, so whatever this frame admits has to be created.
        await scrollTo(41);
        const warm = created.length;
        expect(recycled.length).toBe(0);

        // From here on, every admitted cell must come out of the pool.
        for (let i = 1; i <= 30; i++) {
            await scrollTo(41 + i * 20);
        }

        expect(recycled.length).toBeGreaterThan(0);
        expect(created.length).toBe(warm);
        expect(grid.stats.pool.misses).toBe(warm);
        expect(grid.stats.pool.hits).toBeGreaterThan(150);
    });

    it("keeps the pool bounded while scrolling a long way", async () => {
        const { grid } = track(createGrid());

        for (let i = 1; i <= 40; i++) {
            grid.container.scrollTop = i * 40;
            grid.container.dispatchEvent(new Event("scroll"));
            await nextFrame();
        }

        // Steady state: the pool holds about one frame's evictions, not a growing backlog.
        expect(grid.pool.size).toBeLessThanOrEqual(12);
        expect(cellsIn(grid.area).length).toBe(11 * 6);
    });

    it("never hands out an element that is still in the DOM", async () => {
        const { grid } = track(createGrid());

        for (let i = 1; i <= 5; i++) {
            grid.container.scrollTop = i * 60;
            grid.container.dispatchEvent(new Event("scroll"));
            await nextFrame();
        }

        const attached = cellsIn(grid.area);
        expect(new Set(attached).size).toBe(attached.length);
    });

    it("does not repaint when the scroll stays inside the rendered band", async () => {
        const { grid } = track(createGrid());
        const before = grid.stats.paints;

        grid.container.scrollTop = 15;
        grid.container.dispatchEvent(new Event("scroll"));
        await nextFrame();

        expect(grid.stats.paints).toBe(before);
    });
});

// ---------------------------------------------------------------------------

describe("paint scheduling", () => {
    it("coalesces several model updates into one paint", async () => {
        const { grid } = track(createGrid());
        const before = grid.stats.paints;

        grid.model.update({ rows: [1] });
        grid.model.update({ rows: [2] });
        grid.model.update({ rows: [3] });
        await nextFrame();

        expect(grid.stats.paints).toBe(before + 1);
    });

    it("stops painting after destroy", async () => {
        const { grid } = track(createGrid());
        const before = grid.stats.paints;

        grid.destroy();
        grid.model.update({ all: true });
        await nextFrame();

        expect(grid.stats.paints).toBe(before);
    });
});

// ---------------------------------------------------------------------------

describe("destroy", () => {
    it("removes the root from the host and disposes the model", () => {
        const { grid, host } = createGrid();

        grid.destroy();

        expect(host.children.length).toBe(0);
        expect(grid.model.disposed).toBe(true);
        expect(grid.pool.size).toBe(0);
    });

    it("is safe to call twice", () => {
        const { grid } = createGrid();
        grid.destroy();
        expect(() => grid.destroy()).not.toThrow();
    });

    it("detaches the scroll listener", () => {
        const { grid } = createGrid();
        const spy = vi.spyOn(grid.model, "onScroll");

        grid.destroy();
        grid.container.dispatchEvent(new Event("scroll"));

        expect(spy).not.toHaveBeenCalled();
    });

    it("leaves other grids on the page untouched", () => {
        const a = track(createGrid());
        const b = track(createGrid());

        a.grid.destroy();

        expect(b.host.querySelector('[data-type="render-grid"]')).toBe(b.grid.root);
        expect(cellsIn(b.grid.area).length).toBe(11 * 6);
    });
});
