import { beforeEach, describe, expect, it, vi } from "vitest";
import { RenderGridModel, type RenderGridOptions } from "./RenderGridModel";
import { renderInfoInitialState } from "./renderInfo";
import type { RenderCellParams, RenderedCell, RerenderInfo } from "./types";

/**
 * Stand-in for an HTMLElement. The model reads six layout properties and sets two scroll
 * ones; nothing else. Stubbing them keeps these tests in a node environment — and proves the
 * model's DOM contact is as narrow as it looks.
 */
class FakeElement {
    scrollLeft = 0;
    scrollTop = 0;
    clientWidth: number;
    clientHeight: number;

    constructor(
        public offsetWidth: number,
        public offsetHeight: number,
        scrollBarWidth = 0,
        scrollBarHeight = 0,
    ) {
        this.clientWidth = offsetWidth - scrollBarWidth;
        this.clientHeight = offsetHeight - scrollBarHeight;
    }
}

const el = (...args: ConstructorParameters<typeof FakeElement>) =>
    new FakeElement(...args) as unknown as HTMLElement;

function tracker() {
    const calls: Array<{ row: number; col: number }> = [];
    const renderCell = (p: RenderCellParams): RenderedCell => {
        calls.push({ row: p.row, col: p.col });
        return { row: p.row, col: p.col } as unknown as HTMLElement;
    };
    return { renderCell, calls };
}

function makeOptions(over: Partial<RenderGridOptions> = {}): RenderGridOptions {
    return {
        rowCount: 1000,
        columnCount: 10,
        rowHeight: 20,
        columnWidth: 100,
        renderCell: tracker().renderCell,
        ...over,
    };
}

/** A model bound to stub elements and sized, i.e. one that has completed its first render. */
function mountedModel(over: Partial<RenderGridOptions> = {}) {
    const { renderCell, calls } = tracker();
    const model = new RenderGridModel(makeOptions({ renderCell, ...over }));
    const grid = el(500, 200);
    const container = el(500, 200);
    model.attach({ grid, container });
    return { model, calls, grid, container };
}

// ---------------------------------------------------------------------------

describe("inputChanged", () => {
    let model: RenderGridModel;

    beforeEach(() => {
        model = new RenderGridModel(makeOptions());
    });

    it("reports no change immediately after construction", () => {
        // The constructor establishes the baseline, so the first real check is honest.
        expect(model.inputChanged()).toBe(false);
    });

    it("does NOT report a change when only the scroll offset moved", () => {
        // The load-bearing assertion of this file. If the offset were compared here, every
        // scroll frame would trigger updateRenderInfo({ all: true }) and rebuild every
        // visible cell — which is precisely the lag this library exists to avoid.
        model.offset = { x: 0, y: 5_000 };
        expect(model.inputChanged()).toBe(false);

        model.offset = { x: 320, y: 19_820 };
        expect(model.inputChanged()).toBe(false);
    });

    it.each<[string, Partial<RenderGridOptions>]>([
        ["rowCount", { rowCount: 2000 }],
        ["columnCount", { columnCount: 12 }],
        ["rowHeight", { rowHeight: 30 }],
        ["columnWidth", { columnWidth: 150 }],
        ["renderCell", { renderCell: tracker().renderCell }],
        ["stickyTop", { stickyTop: 1 }],
        ["stickyLeft", { stickyLeft: 2 }],
        ["stickyRight", { stickyRight: 1 }],
        ["stickyBottom", { stickyBottom: 1 }],
        ["overscanColumn", { overscanColumn: 3 }],
        ["overscanRow", { overscanRow: 4 }],
        ["fitToWidth", { fitToWidth: true }],
    ])("recomputes everything when %s changes", (_name, patch) => {
        const m = new RenderGridModel(makeOptions());
        const spy = vi.spyOn(m, "updateRenderInfo");

        m.setOptions(patch);

        expect(spy).toHaveBeenCalledWith({ all: true });
        // The change was consumed, so an unchanged re-check is quiet again.
        expect(m.inputChanged()).toBe(false);
    });

    it("does not recompute when setOptions changes nothing", () => {
        const m = new RenderGridModel(makeOptions());
        const spy = vi.spyOn(m, "updateRenderInfo");

        m.setOptions({ rowCount: 1000 });

        expect(spy).not.toHaveBeenCalled();
    });

    it("does not recompute when only a non-geometry callback changes", () => {
        const m = new RenderGridModel(makeOptions());
        const spy = vi.spyOn(m, "updateRenderInfo");

        m.setOptions({ onResize: () => {} });

        expect(spy).not.toHaveBeenCalled();
    });

    it("reports a change when the measured size changes", () => {
        const m = new RenderGridModel(makeOptions());
        expect(m.inputChanged()).toBe(false);

        m.size = { width: 800, height: 400 };
        expect(m.inputChanged()).toBe(true);
        expect(m.inputChanged()).toBe(false);
    });

    it("evaluates a function rowCount on every check", () => {
        let count = 10;
        const m = new RenderGridModel(makeOptions({ rowCount: () => count }));
        expect(m.inputChanged()).toBe(false);

        count = 20;
        expect(m.inputChanged()).toBe(true);
    });
});

// ---------------------------------------------------------------------------

describe("mergeRerenders", () => {
    const model = new RenderGridModel(makeOptions());

    it("returns undefined when both sides are empty", () => {
        expect(model.mergeRerenders(undefined, undefined)).toBeUndefined();
    });

    it("passes a single side through", () => {
        expect(model.mergeRerenders({ rows: [1] }, undefined)).toEqual({
            all: false,
            cells: [],
            rows: [1],
            columns: [],
        });
    });

    it("unions rows, columns and cells", () => {
        const merged = model.mergeRerenders(
            { rows: [1], columns: [2], cells: [{ row: 3, col: 4 }] },
            { rows: [5], columns: [6], cells: [{ row: 7, col: 8 }] },
        );

        expect(merged).toEqual({
            all: false,
            rows: [1, 5],
            columns: [2, 6],
            cells: [
                { row: 3, col: 4 },
                { row: 7, col: 8 },
            ],
        });
    });

    it("takes the lower fromRow, because it names the first row that moved", () => {
        expect(model.mergeRerenders({ fromRow: 40 }, { fromRow: 12 })?.fromRow).toBe(12);
        expect(model.mergeRerenders({ fromRow: 12 }, { fromRow: 40 })?.fromRow).toBe(12);
        expect(model.mergeRerenders({ fromRow: 7 }, { rows: [1] })?.fromRow).toBe(7);
        expect(model.mergeRerenders({ rows: [1] }, { fromRow: 7 })?.fromRow).toBe(7);
        expect(model.mergeRerenders({ rows: [1] }, { rows: [2] })?.fromRow).toBeUndefined();
        // Zero is a row, not an absence.
        expect(model.mergeRerenders({ fromRow: 0 }, { fromRow: 5 })?.fromRow).toBe(0);
    });

    it("lets all win from either side", () => {
        expect(model.mergeRerenders({ all: true }, { rows: [1] })?.all).toBe(true);
        expect(model.mergeRerenders({ rows: [1] }, { all: true })?.all).toBe(true);
    });

    it("keeps entries marked alongside all, since all short-circuits downstream", () => {
        const merged = model.mergeRerenders({ all: true }, { rows: [1] });
        expect(merged?.all).toBe(true);
        expect(merged?.rows).toEqual([1]);
    });
});

// ---------------------------------------------------------------------------

describe("update", () => {
    it("coalesces two calls in one tick into a single recompute carrying the union", async () => {
        const { model, calls } = mountedModel();
        calls.length = 0;

        const seen: Array<RerenderInfo | undefined> = [];
        const original = model.updateRenderInfo;
        model.updateRenderInfo = vi.fn((rerender, direction, inRender) => {
            seen.push(model.mergeRerenders(rerender, undefined));
            original(rerender, direction, inRender);
        });

        model.update({ cells: [{ row: 2, col: 1 }] });
        model.update({ cells: [{ row: 3, col: 1 }] });
        model.update({ rows: [4] });

        expect(model.updateRenderInfo).not.toHaveBeenCalled();
        await Promise.resolve();
        await Promise.resolve();

        expect(model.updateRenderInfo).toHaveBeenCalledTimes(1);

        // All three markings survived the merge into one recompute.
        const rendered = new Set(calls.map((c) => `${c.row}_${c.col}`));
        expect(rendered.has("2_1")).toBe(true);
        expect(rendered.has("3_1")).toBe(true);
        // Row 4 was marked wholesale, so every column of it repainted.
        expect(calls.filter((c) => c.row === 4).length).toBe(6);
    });

    it("recomputes synchronously when force is set", () => {
        const { model } = mountedModel();
        const spy = vi.spyOn(model, "updateRenderInfo");

        model.update({ rows: [2], force: true });

        expect(spy).toHaveBeenCalledTimes(1);
    });

    it("repaints everything when all is set", async () => {
        const { model, calls } = mountedModel();
        const firstPass = calls.length;
        expect(firstPass).toBeGreaterThan(0);
        calls.length = 0;

        model.update({ all: true });
        await Promise.resolve();
        await Promise.resolve();

        expect(calls.length).toBe(firstPass);
    });

    it("does nothing after dispose", async () => {
        const { model, calls } = mountedModel();
        calls.length = 0;

        model.dispose();
        model.update({ all: true });
        await Promise.resolve();
        await Promise.resolve();

        expect(calls).toEqual([]);
    });
});

// ---------------------------------------------------------------------------

describe("attach and sizing", () => {
    it("measures the grid and performs the first render", () => {
        const { model, calls } = mountedModel();

        expect(model.size).toEqual({ width: 500, height: 200 });
        // rows 0..10 x columns 0..5
        expect(calls.length).toBe(11 * 6);
        expect(model.renderInfo.current).not.toBe(renderInfoInitialState);
    });

    it("subtracts the container's scrollbar from the usable width", () => {
        const { renderCell } = tracker();
        const model = new RenderGridModel(makeOptions({ renderCell }));
        model.attach({ grid: el(500, 200), container: el(500, 200, 17, 17) });

        expect(model.scrollBarWidth).toBe(17);
        expect(model.scrollBarHeight).toBe(17);
    });

    it("recomputes when the measured size changes", () => {
        const { model, calls, grid } = mountedModel();
        calls.length = 0;

        (grid as unknown as FakeElement).offsetHeight = 400;
        model.checkSize();

        // A taller viewport shows more rows.
        expect(model.renderInfo.current.visible.bottom).toBe(20);
        expect(calls.length).toBeGreaterThan(0);
    });

    it("ignores a resize that did not change anything", () => {
        const { model, calls } = mountedModel();
        calls.length = 0;

        model.checkSize();

        expect(calls).toEqual([]);
    });

    it("reports a resize to the host asynchronously", async () => {
        const onResize = vi.fn();
        const model = new RenderGridModel(makeOptions({ onResize }));
        model.attach({ grid: el(500, 200), container: el(500, 200) });

        expect(onResize).not.toHaveBeenCalled();
        await Promise.resolve();

        expect(onResize).toHaveBeenCalledWith({ width: 500, height: 200 });
    });

    it("reports inner-size changes through onInnerSizeChange", async () => {
        const onInnerSizeChange = vi.fn();
        const model = new RenderGridModel(makeOptions({ onInnerSizeChange }));
        model.attach({ grid: el(500, 200), container: el(500, 200) });

        // notifyChanges runs after renderInfoChanged awaits the container, so the callback
        // lands a microtask later — reference behavior, preserved.
        await Promise.resolve();
        await Promise.resolve();

        expect(onInnerSizeChange).toHaveBeenCalledTimes(1);
        expect(onInnerSizeChange.mock.calls[0][0].height).toBe(1000 * 20 + 20);
    });
});

// ---------------------------------------------------------------------------

describe("scrolling", () => {
    it("renders only the newly exposed row on a one-row scroll", () => {
        const { model, calls, container } = mountedModel();
        calls.length = 0;

        // 21px, not 20: the render stays valid across the whole band it covers, and 20 is
        // still inside it.
        (container as unknown as FakeElement).scrollTop = 21;
        model.onScroll();

        expect(model.offset).toEqual({ x: 0, y: 21 });
        expect(model.renderInfo.current.visible).toMatchObject({ top: 1, bottom: 11 });

        // Rows 1..10 were carried over; only row 11 is new.
        expect(calls.every((c) => c.row === 11)).toBe(true);
        expect(calls.length).toBe(6);
    });

    it("does nothing while the scroll stays inside the rendered band", () => {
        const { model, calls, container } = mountedModel();
        calls.length = 0;

        (container as unknown as FakeElement).scrollTop = 15;
        model.onScroll();

        expect(calls).toEqual([]);
    });

    it("ignores scroll events fired while the container is hidden", () => {
        const { model, container } = mountedModel();
        const fake = container as unknown as FakeElement;

        fake.scrollTop = 400;
        fake.offsetHeight = 0;
        fake.offsetWidth = 0;
        model.onScroll();

        // display:none resets scrollTop to 0; acting on it would lose the user's position.
        expect(model.offset).toEqual({ x: 0, y: 0 });
    });

    it("ignores scroll events from another element", () => {
        const { model, container } = mountedModel();
        (container as unknown as FakeElement).scrollTop = 400;

        model.onScroll({ target: el(10, 10) } as unknown as Event);

        expect(model.offset).toEqual({ x: 0, y: 0 });
    });

    it("renders on a first directional call at offset 0 rather than coming up blank", () => {
        // Guards the initial-state trap found in task 2: the initial render info has an
        // all-zero visibleOffset, so a directional call at (0,0) would match it and return
        // having rendered nothing.
        const { renderCell, calls } = tracker();
        const model = new RenderGridModel(makeOptions({ renderCell }));
        model.gridRef.ref(el(500, 200));
        model.containerRef.ref(el(500, 200));
        model.size = { width: 500, height: 200 };

        model.updateRenderInfo(undefined, { x: 0, y: -50 });

        expect(calls.length).toBe(11 * 6);
    });

    it("scrollToRow sets the container's scrollTop", async () => {
        const { model, container } = mountedModel();

        await model.scrollToRow(50, "top");

        expect((container as unknown as FakeElement).scrollTop).toBe(1000);
    });

    it("scrollTo awaits the container, so it works before attach", async () => {
        const { renderCell } = tracker();
        const model = new RenderGridModel(makeOptions({ renderCell }));
        const container = el(500, 200);

        const pending = model.scrollToRow(10, "top");
        model.attach({ grid: el(500, 200), container });
        await pending;

        expect((container as unknown as FakeElement).scrollTop).toBe(200);
    });

    it("scrollBy clamps at the maximum offset", async () => {
        const { model, container } = mountedModel();

        await model.scrollBy({ y: 1_000_000 });

        // innerSize.height 20020 - viewport 200 = 19820
        expect((container as unknown as FakeElement).scrollTop).toBe(19_820);
    });

    it("restoreScroll re-applies the model's offset", () => {
        const { model, container } = mountedModel();
        model.offset = { x: 30, y: 300 };

        model.restoreScroll();

        expect((container as unknown as FakeElement).scrollTop).toBe(300);
        expect((container as unknown as FakeElement).scrollLeft).toBe(30);
    });

    it("snaps to the top when the content shrinks below one viewport", () => {
        const { model, container } = mountedModel();
        (container as unknown as FakeElement).scrollTop = 400;
        model.onScroll();
        expect(model.offset.y).toBe(400);

        model.setOptions({ rowCount: 2 });

        expect(model.offset.y).toBe(0);
    });
});

// ---------------------------------------------------------------------------

describe("repaint notification", () => {
    it("notifies subscribers once per batch of changes", async () => {
        const { model } = mountedModel();
        // Let the notification from the first render settle before subscribing.
        model.state.flush();

        const listener = vi.fn();
        model.state.subscribe(listener);

        model.update({ rows: [2] });
        model.update({ rows: [3] });
        await Promise.resolve();
        await Promise.resolve();
        model.state.flush();

        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("stops notifying after dispose", async () => {
        const { model } = mountedModel();
        const listener = vi.fn();
        model.state.subscribe(listener);

        model.dispose();
        model.requestRepaint();
        await Promise.resolve();

        expect(listener).not.toHaveBeenCalled();
        expect(model.disposed).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Task 35 — losing, and recovering, the container's scroll position
// ---------------------------------------------------------------------------

describe("scroll loss and recovery", () => {
    /** Hand-driven frames, so the two-frame veto window can be measured rather than waited on. */
    function withFrames() {
        const queue: FrameRequestCallback[] = [];
        const original = globalThis.requestAnimationFrame;
        globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
            queue.push(cb);
            return queue.length;
        }) as typeof globalThis.requestAnimationFrame;
        return {
            flush(times = 1) {
                for (let i = 0; i < times; i++) {
                    const due = queue.splice(0, queue.length);
                    for (const cb of due) cb(0);
                }
            },
            restore() {
                globalThis.requestAnimationFrame = original;
            },
        };
    }

    /** Put the model at an offset and then take the grid's size away, as a detach does. */
    function detached(over: Partial<RenderGridOptions> = {}) {
        const parts = mountedModel(over);
        const { model, grid, container } = parts;
        (container as unknown as FakeElement).scrollTop = 400;
        model.onScroll();
        expect(model.offset.y).toBe(400);

        const g = grid as unknown as FakeElement;
        const c = container as unknown as FakeElement;
        g.offsetWidth = 0;
        g.offsetHeight = 0;
        c.offsetWidth = 0;
        c.offsetHeight = 0;
        // Chromium zeroes a detached scroller and fires no event.
        c.scrollTop = 0;
        model.checkSize();
        return parts;
    }

    it("arms when the grid stops being rendered while scrolled", () => {
        const { model } = detached();
        expect(model.scrollNeedsRestore).toBe(true);
    });

    it("keeps the flag when the container cannot take the write yet", () => {
        const { model, container } = detached();

        // This is the paint that used to spend the flag for nothing: the subtree is still
        // detached, so the write lands nowhere and the fact that the position was lost has to
        // survive until there is a container able to hold it.
        model.restoreScroll();

        expect((container as unknown as FakeElement).scrollTop).toBe(0);
        expect(model.scrollNeedsRestore).toBe(true);
    });

    it("restores and clears once the subtree is back", () => {
        const { model, grid, container } = detached();
        model.restoreScroll();

        const g = grid as unknown as FakeElement;
        const c = container as unknown as FakeElement;
        g.offsetWidth = 500;
        g.offsetHeight = 200;
        c.offsetWidth = 500;
        c.offsetHeight = 200;

        model.restoreScroll();

        expect(c.scrollTop).toBe(400);
        expect(model.scrollNeedsRestore).toBe(false);
    });

    it("revalidateScroll restores a silent reset — no scroll event ever arrives", () => {
        const frames = withFrames();
        try {
            const { model, container } = mountedModel();
            const c = container as unknown as FakeElement;
            c.scrollTop = 400;
            model.onScroll();

            c.scrollTop = 0; // the browser discarded it; no event follows
            model.revalidateScroll();
            frames.flush(2);

            expect(c.scrollTop).toBe(400);
        } finally {
            frames.restore();
        }
    });

    it("revalidateScroll is vetoed by a scroll event — the user really did scroll", () => {
        const frames = withFrames();
        try {
            const { model, container } = mountedModel();
            const c = container as unknown as FakeElement;
            c.scrollTop = 400;
            model.onScroll();

            // The user scrolls to the top. The container is at 0 and the model still says 400,
            // because the event that reports it is a frame behind — which is exactly what a
            // silent reset looks like, and is why the disagreement alone cannot be acted on.
            c.scrollTop = 0;
            model.revalidateScroll();
            model.onScroll(); // the lagging event lands inside the window
            frames.flush(2);

            // Their position stands. Writing 400 back here is the list that scrolls half the
            // time.
            expect(c.scrollTop).toBe(0);
            expect(model.offset.y).toBe(0);
        } finally {
            frames.restore();
        }
    });

    it("revalidateScroll does nothing when the container and the model agree", () => {
        const frames = withFrames();
        try {
            const { model, container } = mountedModel();
            const c = container as unknown as FakeElement;
            c.scrollTop = 400;
            model.onScroll();

            model.revalidateScroll();
            frames.flush(2);

            expect(c.scrollTop).toBe(400);
            expect(model.scrollNeedsRestore).toBe(false);
        } finally {
            frames.restore();
        }
    });
});

describe("RenderGridModel — after-paint scrolling", () => {
    /** Hand-driven `requestAnimationFrame`, so a two-frame settle can be stepped exactly. */
    function withFrames() {
        const queue: FrameRequestCallback[] = [];
        const original = globalThis.requestAnimationFrame;
        globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
            queue.push(cb);
            return queue.length;
        }) as typeof globalThis.requestAnimationFrame;
        return {
            flush(times = 1) {
                for (let i = 0; i < times; i++) {
                    const due = queue.splice(0, queue.length);
                    for (const cb of due) cb(0);
                }
            },
            restore() {
                globalThis.requestAnimationFrame = original;
            },
        };
    }

    /** `scrollToRow` awaits the container and the render info, so let the microtasks run. */
    const settle = async () => {
        for (let i = 0; i < 4; i++) await Promise.resolve();
    };

    /**
     * A grid whose root is measured but whose scroll container has no layout box — a list
     * inside a popover that has not opened. The one state where a `scrollTop` write is silently
     * clamped to nothing.
     */
    function unmeasuredModel() {
        const { renderCell, calls } = tracker();
        const model = new RenderGridModel(makeOptions({ renderCell }));
        const grid = el(500, 200);
        const container = el(0, 0);
        model.attach({ grid, container });
        return { model, calls, grid, container };
    }

    it("measured is false until both the root and the container have a box", () => {
        const bare = new RenderGridModel(makeOptions());
        expect(bare.measured).toBe(false);

        expect(unmeasuredModel().model.measured).toBe(false);
        expect(mountedModel().model.measured).toBe(true);
    });

    it("scrollToRowAfterPaint writes nothing until the paint flushes it", async () => {
        const { model, container } = mountedModel();
        const c = container as unknown as FakeElement;

        model.scrollToRowAfterPaint(50, "top");
        await settle();
        // The whole point: the extent is written by the paint, so the write waits for it.
        expect(c.scrollTop).toBe(0);

        model.flushPendingScroll();
        await settle();
        expect(c.scrollTop).toBe(1000);
    });

    it("the register holds one request, and the newest wins", async () => {
        const { model, container } = mountedModel();
        const c = container as unknown as FakeElement;

        model.scrollToRowAfterPaint(50, "top");
        model.scrollToRowAfterPaint(10, "top");
        model.scrollToRowAfterPaint(80, "top");

        model.flushPendingScroll();
        await settle();
        // 80 * 20, not 50 and not 10: a burst collapses rather than queueing three scrolls.
        expect(c.scrollTop).toBe(1600);
    });

    it("a flushed request is consumed exactly once", async () => {
        const { model, container } = mountedModel();
        const c = container as unknown as FakeElement;

        model.scrollToRowAfterPaint(50, "top");
        model.flushPendingScroll();
        await settle();
        expect(c.scrollTop).toBe(1000);

        // The user scrolls away. A second paint must not drag them back to row 50.
        c.scrollTop = 200;
        model.onScroll();
        model.flushPendingScroll();
        await settle();
        expect(c.scrollTop).toBe(200);
    });

    it("scrollToRow queues instead of writing while the container has no scroll box", async () => {
        const { model, container } = unmeasuredModel();
        const c = container as unknown as FakeElement;

        await model.scrollToRow(50, "top");
        // Written now, it would be clamped to 0 and lost with nothing to re-issue it.
        expect(c.scrollTop).toBe(0);

        // The popover opens: the container gets a box, and the next paint drains the register.
        c.offsetHeight = 200;
        c.clientHeight = 200;
        model.flushPendingScroll();
        await settle();
        expect(c.scrollTop).toBe(1000);
    });

    it("flushPendingScroll stays queued while the grid is still unmeasurable", async () => {
        const { model, container } = unmeasuredModel();
        const c = container as unknown as FakeElement;

        model.scrollToRowAfterPaint(50, "top");
        model.flushPendingScroll();
        await settle();
        expect(c.scrollTop).toBe(0);

        c.offsetHeight = 200;
        c.clientHeight = 200;
        model.flushPendingScroll();
        await settle();
        expect(c.scrollTop).toBe(1000);
    });

    it("a queued scroll outranks the reconciliation, rather than racing it", async () => {
        const frames = withFrames();
        try {
            const { model, container } = mountedModel();
            const c = container as unknown as FakeElement;
            c.scrollTop = 400;
            model.onScroll();

            // The host moves the grid: the browser discards the position, no event follows.
            c.scrollTop = 0;
            model.revalidateScroll();
            // …and in the same turn the host asks for a different row.
            model.scrollToRowAfterPaint(50, "top");

            frames.flush(2);
            await settle();
            // The stale 400 is never written back — it would jump and then be overwritten.
            expect(c.scrollTop).toBe(0);

            model.flushPendingScroll();
            await settle();
            expect(c.scrollTop).toBe(1000);
            // A landed scroll leaves nothing to restore.
            expect(model.scrollNeedsRestore).toBe(false);
        } finally {
            frames.restore();
        }
    });

    it("the reconciliation still runs once the register is empty", async () => {
        const frames = withFrames();
        try {
            const { model, container } = mountedModel();
            const c = container as unknown as FakeElement;
            c.scrollTop = 400;
            model.onScroll();

            model.scrollToRowAfterPaint(50, "top");
            model.flushPendingScroll();
            await settle();
            expect(c.scrollTop).toBe(1000);
            model.onScroll();

            c.scrollTop = 0;
            model.revalidateScroll();
            frames.flush(2);
            expect(c.scrollTop).toBe(1000);
        } finally {
            frames.restore();
        }
    });

    it("dispose drops a queued scroll rather than leaving it to resurrect", async () => {
        const { model, container } = mountedModel();
        const c = container as unknown as FakeElement;

        model.scrollToRowAfterPaint(50, "top");
        model.dispose();
        model.flushPendingScroll();
        await settle();

        expect(c.scrollTop).toBe(0);
    });
});
