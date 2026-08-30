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
        // The shape a real cell renderer uses: update in place when the cell is already
        // there, take a pooled element when it just scrolled in, allocate only as a last
        // resort.
        if (p.previous) {
            p.previous.setAttribute("data-row", String(p.row));
            p.previous.setAttribute("data-col", String(p.col));
            return p.previous;
        }
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

    it("does not write its own offset back over a scroll it has not been told about", async () => {
        const { grid } = track(createGrid());

        grid.container.scrollTop = 40;
        grid.container.dispatchEvent(new Event("scroll"));
        await nextFrame();

        // The scroll the paint has not heard about yet. A real one arrives exactly like this:
        // the event is delivered a frame after the position changed, sometimes after that
        // frame's rAF callbacks — so a paint runs with the container ahead of the model.
        grid.container.scrollTop = 200;
        grid.model.requestRepaint();
        await nextFrame();

        // The user's position stands. Putting the model's older offset back here undoes the
        // scroll, and since that write fires a scroll event of its own the two take turns:
        // a list that scrolls every other frame and shows a blank band in between.
        expect(grid.container.scrollTop).toBe(200);
    });

    it("puts the position back after the grid was hidden and reshown", async () => {
        const { grid, host } = track(createGrid());

        grid.container.scrollTop = 200;
        grid.container.dispatchEvent(new Event("scroll"));
        await nextFrame();

        // `display: none` zeroes the container's scrollTop behind the model's back — the one
        // case where the container is wrong and the model is right.
        giveLayout(host.firstElementChild as HTMLElement, 0, 0);
        grid.model.checkSize();
        grid.container.scrollTop = 0;

        giveLayout(host.firstElementChild as HTMLElement, 500, 200);
        grid.model.checkSize();
        await nextFrame();

        expect(grid.container.scrollTop).toBe(200);
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

    it("re-renders a dirty cell in place, touching no DOM structure", async () => {
        const { grid } = track(createGrid());
        const target = grid.area.querySelector(
            '[data-row="4"][data-col="2"]',
        ) as HTMLElement;
        const before = grid.stats;

        grid.model.update({ cells: [{ row: 4, col: 2 }] });
        await nextFrame();

        // Same element, still in place: no insertion, no removal, nothing pooled. This is
        // what lets a focused cell or an open editor survive being marked dirty.
        expect(grid.area.querySelector('[data-row="4"][data-col="2"]')).toBe(target);
        expect(grid.stats.cellsAppended).toBe(before.cellsAppended);
        expect(grid.stats.cellsRemoved).toBe(before.cellsRemoved);
    });

    it("re-renders every cell in place on a full repaint", async () => {
        const { grid, created } = track(createGrid());
        const allocatedBefore = created.length;
        const before = grid.stats;

        grid.model.update({ all: true });
        await nextFrame();

        expect(grid.stats.paints).toBe(before.paints + 1);
        expect(grid.stats.cellsAppended).toBe(before.cellsAppended);
        expect(grid.stats.cellsRemoved).toBe(before.cellsRemoved);
        expect(created.length).toBe(allocatedBefore);
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

// ---------------------------------------------------------------------------

describe("keyed pooling", () => {
    /**
     * A list whose rows are not all alike — the case a data grid never hits and a log view or
     * a notebook hits on every frame. `kind` is the consumer's own notion of "same shape"; the
     * engine only carries it.
     */
    function createHeterogeneousGrid() {
        const kinds = ["text", "table", "image"];
        const kindOf = new WeakMap<HTMLElement, string>();
        const builds: string[] = [];
        /** Every time a pooled element was reused for a kind it was not built for. */
        const wrongKind: string[] = [];

        const renderCell = (p: RenderCellParams): RenderedCell => {
            const kind = kinds[p.row % kinds.length];

            // `previous` stays the preferred path — but only when it is the right shape.
            const previous =
                p.previous && kindOf.get(p.previous) === kind ? p.previous : undefined;
            const cell = previous ?? p.recycle?.(kind) ?? document.createElement("div");
            p.setReuseKey?.(cell, kind);

            // The renderer rebuilds the inner structure only when the element it got is not
            // already the right shape. That is the whole point of the key: a correctly keyed
            // recycle skips this.
            const was = kindOf.get(cell);
            if (was !== kind) {
                if (was !== undefined) wrongKind.push(`${was}->${kind}`);
                builds.push(kind);
                cell.replaceChildren(document.createTextNode(kind));
                kindOf.set(cell, kind);
            }

            cell.setAttribute("data-type", "cell");
            cell.setAttribute("data-row", String(p.row));
            cell.setAttribute("data-col", String(p.col));
            cell.setAttribute("data-kind", kind);
            cell.style.setProperty("position", "absolute");
            cell.style.setProperty("left", `${p.style.left}px`);
            cell.style.setProperty("top", `${p.style.top}px`);
            return cell;
        };

        return { ...createGrid({ renderCell }), builds, wrongKind, kindOf };
    }

    it("passes setReuseKey to every renderCell call", () => {
        const seen: Array<boolean> = [];
        track(
            createGrid({
                renderCell: (p: RenderCellParams): RenderedCell => {
                    seen.push(typeof p.setReuseKey === "function");
                    const el = p.previous ?? p.recycle?.() ?? document.createElement("div");
                    el.setAttribute("data-type", "cell");
                    el.style.setProperty("position", "absolute");
                    return el;
                },
            }),
        );

        expect(seen.length).toBeGreaterThan(0);
        expect(seen.every(Boolean)).toBe(true);
    });

    it("never recycles a cell of one kind into a row of another", async () => {
        const h = track(createHeterogeneousGrid()) as ReturnType<
            typeof createHeterogeneousGrid
        >;

        for (let i = 1; i <= 40; i++) {
            h.grid.container.scrollTop = i * 40;
            h.grid.container.dispatchEvent(new Event("scroll"));
            await nextFrame();
        }

        expect(h.wrongKind).toEqual([]);
        expect(h.grid.stats.pool.hits).toBeGreaterThan(0);

        // Every painted cell shows the content its row asked for.
        for (const el of cellsIn(h.grid.area) as HTMLElement[]) {
            expect(el.textContent).toBe(el.getAttribute("data-kind"));
        }
    });

    it("still reuses across frames — a keyed pool is not a disabled pool", async () => {
        const h = track(createHeterogeneousGrid()) as ReturnType<
            typeof createHeterogeneousGrid
        >;
        const warm = h.builds.length;
        const warmMisses = h.grid.stats.pool.misses;

        for (let i = 1; i <= 30; i++) {
            h.grid.container.scrollTop = i * 20;
            h.grid.container.dispatchEvent(new Event("scroll"));
            await nextFrame();
        }

        // Every element the pool hands back is already the right shape, so the only rebuilds
        // left are the ones the pool could not serve at all. Builds after warm-up equal
        // misses after warm-up, exactly: not one reuse cost a rebuild.
        expect(h.grid.stats.pool.hits).toBeGreaterThan(100);
        expect(h.builds.length - warm).toBe(h.grid.stats.pool.misses - warmMisses);
        expect(h.wrongKind).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Task 35 — the two faces of scroll loss
// ---------------------------------------------------------------------------

describe("keepCellsAttached", () => {
    it("hides evicted cells instead of detaching them, and restores them on admission", async () => {
        const { grid } = track(createGrid({ keepCellsAttached: true }));
        const first = grid.area.querySelector('[data-row="0"]') as HTMLElement;
        expect(first).toBeTruthy();

        grid.container.scrollTop = 2000;
        grid.container.dispatchEvent(new Event("scroll"));
        await nextFrame();

        // Still in the document — that is the whole point. A detached cell loses its iframe's
        // document and every nested scroll position inside it.
        expect(first.isConnected).toBe(true);
        expect(first.parentElement).toBe(grid.area);
        expect(first.style.display).toBe("none");

        grid.container.scrollTop = 0;
        grid.container.dispatchEvent(new Event("scroll"));
        await nextFrame();

        // Whatever was re-admitted is visible again: nothing may come back still hidden. The
        // cells still parked in the area are the pooled ones, which are meant to stay hidden
        // and are marked as such — and, crucially, no longer answer to a coordinate.
        const live = grid.area.querySelectorAll(
            ':scope > [data-type="cell"]:not([data-avg-pooled])',
        );
        expect(live.length).toBeGreaterThan(0);
        for (const el of live) {
            expect((el as HTMLElement).style.display).not.toBe("none");
        }
        for (const el of grid.area.querySelectorAll(":scope > [data-avg-pooled]")) {
            expect(el.hasAttribute("data-row")).toBe(false);
        }
        // Exactly one element claims the cell at 0,0 — a hidden cell must not shadow it.
        expect(
            grid.area.querySelectorAll('[data-row="0"][data-col="0"]').length,
        ).toBe(1);
    });

    it("detaches on pool overflow — the one eviction path that still removes a cell", async () => {
        const { grid } = track(createGrid({ keepCellsAttached: true }));
        // A pool that will not take anything forces every eviction down the overflow path.
        (grid.pool as unknown as { maxSize: number }).maxSize = 0;

        const first = grid.area.querySelector('[data-row="0"]') as HTMLElement;
        grid.container.scrollTop = 2000;
        grid.container.dispatchEvent(new Event("scroll"));
        await nextFrame();

        // Bounded means bounded: a cell the pool refuses has nothing left to preserve it for,
        // and leaving it hidden in the document forever is the leak the bound exists to stop.
        expect(first.isConnected).toBe(false);
        expect(grid.stats.pool.discarded).toBeGreaterThan(0);
    });

    it("does not re-append a cell that is already in its region", async () => {
        const { grid } = track(createGrid({ keepCellsAttached: true }));
        grid.container.scrollTop = 200;
        grid.container.dispatchEvent(new Event("scroll"));
        await nextFrame();

        const readmitted = grid.area.querySelector("[data-row]") as HTMLElement;
        const spy = vi.spyOn(grid.area, "append");
        grid.container.scrollTop = 220;
        grid.container.dispatchEvent(new Event("scroll"));
        await nextFrame();

        // `append` on an existing child is a *move* — remove plus insert — and a move resets
        // every scroller nested in the subtree. Anything already in place must be left alone.
        for (const call of spy.mock.calls) {
            for (const node of call) expect(node).not.toBe(readmitted);
        }
        spy.mockRestore();
    });

    it("leaves the default path detaching, exactly as before", async () => {
        const { grid } = track(createGrid());
        const first = grid.area.querySelector('[data-row="0"]') as HTMLElement;

        grid.container.scrollTop = 2000;
        grid.container.dispatchEvent(new Event("scroll"));
        await nextFrame();

        expect(first.isConnected).toBe(false);
        expect(first.style.display).toBe("");
    });
});

describe("scroll recovery", () => {
    it("exposes revalidate(), and it is safe after destroy", () => {
        const { grid } = track(createGrid());
        expect(() => grid.revalidate()).not.toThrow();
        grid.destroy();
        expect(() => grid.revalidate()).not.toThrow();
    });

    it("watches the host by default and stops watching on destroy", () => {
        const { grid } = track(createGrid());
        const observer = (grid as unknown as { hostObserver?: MutationObserver }).hostObserver;
        expect(observer).toBeDefined();
        const spy = vi.spyOn(observer as MutationObserver, "disconnect");
        grid.destroy();
        expect(spy).toHaveBeenCalled();
    });

    it("does not watch the host when asked not to", () => {
        const { grid } = track(createGrid({ watchHost: false }));
        expect(
            (grid as unknown as { hostObserver?: MutationObserver }).hostObserver,
        ).toBeUndefined();
    });
});

describe("setOptions applies shell layout", () => {
    it("reapplies height and growToHeight, which were read once and never again", () => {
        const { grid } = track(createGrid({ height: "100%" }));

        expect(grid.root.style.height).toBe("100%");
        expect(grid.root.style.maxHeight).toBe("unset");

        grid.setOptions({ height: undefined, growToHeight: "150px" });

        // Before this, all three stayed exactly as constructed: measured in the browser, a
        // grid asked to cap itself at 150px sat at its original 400.
        expect(grid.root.style.height).toBe("unset");
        expect(grid.root.style.maxHeight).toBe("150px");
        expect(grid.container.style.maxHeight).toBe("150px");

        grid.setOptions({ growToHeight: "260px" });
        expect(grid.root.style.maxHeight).toBe("260px");
        expect(grid.container.style.maxHeight).toBe("260px");
    });

    it("reapplies growToWidth and the overflow that follows fitToWidth", () => {
        const { grid } = track(createGrid());

        expect(grid.container.style.maxWidth).toBe("unset");
        expect(grid.container.style.overflowX).toBe("auto");

        grid.setOptions({ growToWidth: "320px", fitToWidth: true });

        expect(grid.container.style.maxWidth).toBe("320px");
        expect(grid.container.style.overflowX).toBe("hidden");
    });

    it("goes back to filling when the layout fields are cleared", () => {
        const { grid } = track(
            createGrid({ height: undefined, growToHeight: "150px", growToWidth: "320px" }),
        );
        expect(grid.root.style.maxHeight).toBe("150px");

        grid.setOptions({ height: "100%", growToHeight: undefined, growToWidth: undefined });

        expect(grid.root.style.height).toBe("100%");
        expect(grid.root.style.maxHeight).toBe("unset");
        expect(grid.container.style.maxHeight).toBe("unset");
        expect(grid.container.style.maxWidth).toBe("unset");
    });

    it("repaints so the geometry follows the new box, not just the styles", async () => {
        const { grid } = track(createGrid({ height: "100%" }));
        await nextFrame();
        const before = grid.stats.paints;

        grid.setOptions({ growToHeight: "260px" });
        await nextFrame();

        // `applyLayout` reads growTo* for the container's own sizing and only runs on a paint
        // whose geometry changed, so the change has to force one.
        expect(grid.stats.paints).toBeGreaterThan(before);
        expect(grid.container.style.height).toBe("unset");
    });

    it("moves no cells when only the layout changed", async () => {
        const { grid } = track(createGrid({ height: "100%" }));
        await nextFrame();
        grid.resetStats();

        grid.setOptions({ growToHeight: "260px" });
        await nextFrame();

        // The forced paint is a layout pass, not a repaint: the region sync is set arithmetic
        // over the same elements, so it appends nothing and removes nothing.
        expect(grid.stats.cellsAppended).toBe(0);
        expect(grid.stats.cellsRemoved).toBe(0);
    });

    it("a setOptions that touches no layout field leaves the shell alone", async () => {
        const { grid } = track(createGrid({ height: "100%" }));
        await nextFrame();
        const before = grid.stats.paints;

        grid.setOptions({ className: "custom" });
        await nextFrame();

        expect(grid.root.className).toBe("custom");
        expect(grid.root.style.height).toBe("100%");
        expect(grid.stats.paints).toBe(before);
    });
});

describe("after-paint scrolling reaches the shell", () => {
    it("a queued scroll is drained by the paint", async () => {
        const { grid } = track(createGrid({ height: "100%" }));
        await nextFrame();

        grid.model.scrollToRowAfterPaint(50, "top");
        expect(grid.container.scrollTop).toBe(0);

        await nextFrame();
        await nextFrame();

        expect(grid.container.scrollTop).toBe(1000);
    });

    it("a queued scroll is drained even by a paint with nothing to draw", async () => {
        const { grid } = track(createGrid({ height: "100%" }));
        await nextFrame();
        await nextFrame();
        const settled = grid.stats.paints;

        // Nothing about the geometry changes, so the model hands back the identical render
        // info and the paint takes its early return — the branch a late-laid-out grid reaches.
        grid.model.scrollToRowAfterPaint(30, "top");
        await nextFrame();
        await nextFrame();

        expect(grid.stats.paints).toBe(settled);
        expect(grid.container.scrollTop).toBe(600);
    });
});

// ---------------------------------------------------------------------------
// Task 34 — the cell lifecycle seam
// ---------------------------------------------------------------------------

describe("onCellAttached / onCellReleased", () => {
    it("reports every admission and every eviction, and attaches before releasing nothing", async () => {
        const attached: HTMLElement[] = [];
        const released: HTMLElement[] = [];
        const { grid } = track(
            createGrid({
                onCellAttached: (el) => attached.push(el),
                onCellReleased: (el) => released.push(el),
            }),
        );

        // The constructor paints synchronously, so the first window is already reported.
        expect(attached.length).toBe(cellsIn(grid.area).length);
        expect(released.length).toBe(0);
        for (const el of attached) expect(el.isConnected).toBe(true);

        grid.container.scrollTop = 2000;
        grid.container.dispatchEvent(new Event("scroll"));
        await nextFrame();

        expect(released.length).toBeGreaterThan(0);
        expect(attached.length).toBeGreaterThan(cellsIn(grid.area).length);
    });

    it("fires attach again when a retained hidden cell is re-admitted", async () => {
        const attached: HTMLElement[] = [];
        const released: HTMLElement[] = [];
        const { grid } = track(
            createGrid({
                keepCellsAttached: true,
                onCellAttached: (el) => attached.push(el),
                onCellReleased: (el) => released.push(el),
            }),
        );

        const first = grid.area.querySelector('[data-row="0"]') as HTMLElement;
        grid.container.scrollTop = 2000;
        grid.container.dispatchEvent(new Event("scroll"));
        await nextFrame();

        // Released while staying in the document: "left the active set", not "detached".
        expect(released).toContain(first);
        expect(first.isConnected).toBe(true);
        expect(first.style.display).toBe("none");

        attached.length = 0;
        grid.container.scrollTop = 0;
        grid.container.dispatchEvent(new Event("scroll"));
        await nextFrame();

        // The whole reason the callback is not tied to `parentElement`: this element never
        // left the DOM, measured zero the whole time it was hidden, and must be looked at again.
        const back = grid.area.querySelector(
            '[data-row="0"][data-col="0"]',
        ) as HTMLElement;
        expect(attached).toContain(back);
        for (const el of attached) expect(el.style.display).not.toBe("none");
    });

    it("releases a cell the pool then refuses, before it is detached", async () => {
        const releasedWhileConnected: boolean[] = [];
        const { grid } = track(
            createGrid({
                keepCellsAttached: true,
                onCellReleased: (el) => releasedWhileConnected.push(el.isConnected),
            }),
        );
        (grid.pool as unknown as { maxSize: number }).maxSize = 0;

        grid.container.scrollTop = 2000;
        grid.container.dispatchEvent(new Event("scroll"));
        await nextFrame();

        // The contract must not depend on the pool's overflow limit: every release is reported
        // while the element is still where it was.
        expect(releasedWhileConnected.length).toBeGreaterThan(0);
        expect(releasedWhileConnected.every(Boolean)).toBe(true);
    });

    it("costs nothing when neither callback is given", async () => {
        const { grid, calls } = track(createGrid());
        const before = calls.length;
        grid.container.scrollTop = 100;
        grid.container.dispatchEvent(new Event("scroll"));
        await nextFrame();
        expect(calls.length).toBeGreaterThan(before);
    });
});
