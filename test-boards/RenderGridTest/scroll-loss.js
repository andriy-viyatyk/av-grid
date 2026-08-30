/**
 * Scroll-loss harness — the measurement rig for plan task 35 (EPIC-079 / US-1236).
 *
 * Two distinct defects share this file because they share a cause: something detaches or moves
 * a subtree, and Chromium silently throws away scroll state inside it without firing an event.
 *
 * **Face 1 — the host detaches the grid.** A host framework that re-renders a slot removes the
 * grid's subtree and puts it back. Chromium zeroes every scroller inside it and fires **no**
 * scroll event, so the model goes on painting rows at an offset the container no longer has and
 * the viewport sits blank until the user scrolls. `face1()` measures it.
 *
 * **Face 2 — the engine detaches its own cells.** `syncRegion` evicts with `removeChild`, which
 * destroys anything stateful living inside the cell — a nested scroller's position, an iframe's
 * whole document. `face2()` measures it, by element identity, across an eviction/re-admission
 * cycle.
 *
 * Everything hangs off `window.scrollLoss` so a session runs without clicking. The rig is a
 * board file rather than a pasted snippet because both faces have to be measured twice — once
 * before the fix and once after — and `board_refresh` wipes anything stored on `window`.
 */

import { RenderGrid } from "./lib/av-grid.js";

const frames = (n) =>
    new Promise((resolve) => {
        const tick = () => (--n <= 0 ? resolve() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
    });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * How much of the container's viewport has no painted cell over it, in px.
 *
 * The number that matters for face 1: `scrollTop: 0` with a model that still thinks it is at
 * row 834 does not merely look wrong, it paints *nothing* over the visible band.
 */
function unpaintedPx(grid) {
    const container = grid.container;
    const view = container.getBoundingClientRect();
    const spans = [];
    for (const el of container.querySelectorAll("[data-row]")) {
        const r = el.getBoundingClientRect();
        if (r.height === 0) continue;
        const a = Math.max(view.top, r.top);
        const b = Math.min(view.bottom, r.bottom);
        if (b > a) spans.push([a, b]);
    }
    spans.sort((p, q) => p[0] - q[0]);
    let covered = 0;
    let cursor = view.top;
    for (const [a, b] of spans) {
        if (b <= cursor) continue;
        covered += b - Math.max(a, cursor);
        cursor = Math.max(cursor, b);
    }
    return Math.round(view.height - covered);
}

// ---------------------------------------------------------------------------
// Hosts and grids
// ---------------------------------------------------------------------------

/** A scratch host outside the benchmark's own, so a measurement never disturbs `window.bench`. */
function makeHost(height = 400) {
    const host = document.createElement("div");
    host.className = "scroll-loss-host";
    // The board's body is a flex column, which would squash a plain block host to nothing.
    // Absolute takes it out of flow while keeping it laid out, painted and scrollable.
    host.style.cssText =
        `position:absolute;right:8px;top:60px;z-index:50;height:${height}px;width:600px;` +
        `display:flex;background:var(--p-background, #1e1e1e);outline:1px solid #888;`;
    document.body.append(host);
    return host;
}

/** A plain text grid, for face 1: the defect is about the container, not the cells. */
function makePlainGrid(host, rowCount = 3000, options = {}) {
    return new RenderGrid(host, {
        rowCount,
        columnCount: 4,
        rowHeight: 24,
        columnWidth: 140,
        height: "100%",
        renderCell: (p) => {
            const el = p.previous ?? p.recycle?.() ?? document.createElement("div");
            if (!el.firstChild) el.append(document.createTextNode(""));
            el.firstChild.nodeValue = `r${p.row}c${p.col}`;
            el.className = "avg-cell";
            const st = el.style;
            st.left = `${p.style.left}px`;
            st.top = `${p.style.top}px`;
            st.width = `${p.style.width}px`;
            st.height = `${p.style.height}px`;
            el.setAttribute("data-row", String(p.row));
            el.setAttribute("data-col", String(p.col));
            return el;
        },
        ...options,
    });
}

/**
 * A grid whose cells own something: a nested horizontal scroller and an iframe.
 *
 * The renderer never touches either after building it, which is what a real consumer does —
 * a log row's `<pre>` keeps whatever position the user left it at. So any state that goes
 * missing went missing because the *engine* moved the element, not because the renderer
 * overwrote it.
 */
function makeStatefulGrid(host, rowCount = 400, options = {}, { keyByRow = false } = {}) {
    const built = new WeakSet();
    return new RenderGrid(host, {
        rowCount,
        columnCount: 1,
        rowHeight: 60,
        columnWidth: 560,
        height: "100%",
        renderCell: (p) => {
            // A reuse key per row is what makes retention *useful*: it is how a renderer asks
            // for the element this row was using, rather than whichever one fell off the pool
            // last. `keepCellsAttached` keeps the element alive; the key routes it home.
            const key = keyByRow ? p.row : undefined;
            const el = p.previous ?? p.recycle?.(key) ?? document.createElement("div");
            if (keyByRow) p.setReuseKey?.(el, key);
            if (!built.has(el)) {
                built.add(el);
                el.innerHTML =
                    '<div class="nested" style="overflow-x:auto;width:200px;height:24px;white-space:nowrap">' +
                    '<span style="display:inline-block;width:2000px">wide content</span></div>' +
                    '<iframe class="frame" style="width:120px;height:28px;border:0" ' +
                    'srcdoc="frame"></iframe>';
                // Inline script inside a srcdoc frame is blocked by the board's CSP, so a
                // reload is counted from the frame element's own `load` event instead — which
                // is exactly what fires when a detached iframe is put back in the document.
                const frame = el.querySelector(".frame");
                frame.__loads = 0;
                frame.addEventListener("load", () => frame.__loads++);
            }
            el.className = "avg-cell";
            const st = el.style;
            st.left = `${p.style.left}px`;
            st.top = `${p.style.top}px`;
            st.width = `${p.style.width}px`;
            st.height = `${p.style.height}px`;
            el.setAttribute("data-row", String(p.row));
            el.setAttribute("data-col", String(p.col));
            return el;
        },
        ...options,
    });
}

/** The generation stamped into a cell's iframe document; changes iff the frame reloaded. */
function frameGeneration(cell) {
    const frame = cell.querySelector(".frame");
    if (!frame) return { supported: false, reason: "no iframe element" };
    return { supported: true, loads: frame.__loads, hasWindow: !!frame.contentWindow };
}

// ---------------------------------------------------------------------------
// Face 1 — the host detaches the grid's subtree
// ---------------------------------------------------------------------------

/**
 * Scroll a large grid, detach its host subtree, re-append it, and report what survived.
 *
 * `detachHost` is what a host framework does on a slot re-render. Nothing else changes: no
 * resize, no option change, no scroll gesture.
 */
async function face1({ rowCount = 3000, scrollTop = 20000, hiddenFrames = 2, grid } = {}) {
    const own = !grid;
    const host = own ? makeHost() : grid.root.parentElement;
    if (own) grid = makePlainGrid(host, rowCount);
    await frames(6);

    grid.container.scrollTop = scrollTop;
    await frames(6);
    const before = {
        scrollTop: grid.container.scrollTop,
        modelOffsetY: grid.model.offset.y,
        unpaintedPx: unpaintedPx(grid),
    };

    let scrollEvents = 0;
    const onScroll = () => scrollEvents++;
    grid.container.addEventListener("scroll", onScroll);

    const anchor = host.nextSibling;
    const parent = host.parentElement;
    host.remove();
    await frames(hiddenFrames);
    parent.insertBefore(host, anchor);
    await frames(12);

    const after = {
        scrollTop: grid.container.scrollTop,
        modelOffsetY: grid.model.offset.y,
        unpaintedPx: unpaintedPx(grid),
        scrollEventsFired: scrollEvents,
    };
    grid.container.removeEventListener("scroll", onScroll);

    const result = {
        viewportHeight: grid.container.clientHeight,
        contentHeight: grid.container.scrollHeight,
        before,
        after,
    };
    if (own) {
        grid.destroy();
        host.remove();
    }
    return result;
}

/**
 * The premise `scrollLost` rests on: does `display: none` *lose* the container's scrollTop, or
 * merely stop reporting it? Measured across a synchronous hide and a 900 ms one.
 */
async function hidePremise({ rowCount = 3000, scrollTop = 20000 } = {}) {
    const host = makeHost();
    const grid = makePlainGrid(host, rowCount);
    await frames(6);
    const out = {};

    grid.container.scrollTop = scrollTop;
    await frames(6);
    out.start = grid.container.scrollTop;

    host.style.display = "none";
    out.syncHide = {
        whileHidden: grid.container.scrollTop,
        offsetHeight: grid.container.offsetHeight,
    };
    host.style.display = "";
    out.syncHide.afterShowImmediate = grid.container.scrollTop;
    await frames(4);
    out.syncHide.afterShowSettled = grid.container.scrollTop;
    out.syncHide.unpaintedPx = unpaintedPx(grid);

    grid.container.scrollTop = scrollTop;
    await frames(6);
    host.style.display = "none";
    await sleep(900);
    out.longHide = { whileHidden: grid.container.scrollTop };
    host.style.display = "";
    out.longHide.afterShowImmediate = grid.container.scrollTop;
    await frames(4);
    out.longHide.afterShowSettled = grid.container.scrollTop;
    out.longHide.unpaintedPx = unpaintedPx(grid);

    grid.destroy();
    host.remove();
    return out;
}

// ---------------------------------------------------------------------------
// Face 2 — the engine detaches its own cells
// ---------------------------------------------------------------------------

/**
 * Follow one cell element through an eviction and back, by identity.
 *
 * Set a nested scroller's position on it, scroll it far out of the window so it is evicted,
 * scroll back so it is re-admitted from the pool, then ask whether that same element still
 * holds what it held. A detaching eviction answers no.
 */
async function face2({ rowCount = 400, awayTo = 6000, keep = false } = {}) {
    const host = makeHost();
    const grid = makeStatefulGrid(
        host,
        rowCount,
        keep ? { keepCellsAttached: true } : {},
        { keyByRow: keep },
    );
    await frames(8);

    const cell = grid.container.querySelector('[data-row="2"]');
    if (!cell) {
        grid.destroy();
        host.remove();
        return { error: "row 2 never painted" };
    }
    const nested = cell.querySelector(".nested");
    nested.scrollLeft = 300;
    // Let the frame's first load land, so the load counter has a baseline to compare against.
    await sleep(200);
    await frames(2);

    const before = {
        nestedScrollLeft: nested.scrollLeft,
        frame: frameGeneration(cell),
        attached: !!cell.parentElement,
    };

    grid.container.scrollTop = awayTo;
    await frames(10);
    const away = {
        cellStillAttached: !!cell.parentElement,
        cellDisplay: cell.style.display || "(none set)",
        cellsRemoved: grid.stats.cellsRemoved,
        nestedScrollLeftWhileAway: nested.scrollLeft,
        frameWhileAway: frameGeneration(cell),
    };

    grid.container.scrollTop = 0;
    await frames(12);
    const after = {
        cellReadmitted: !!cell.parentElement,
        cellVisible: cell.style.display !== "none",
        cellPaintingRow: cell.getAttribute("data-row"),
        nestedScrollLeft: nested.scrollLeft,
        frame: frameGeneration(cell),
        poolHits: grid.stats.pool.hits,
        poolMisses: grid.stats.pool.misses,
    };

    grid.destroy();
    host.remove();
    return {
        before,
        away,
        after,
        nestedSurvived: before.nestedScrollLeft > 0 && after.nestedScrollLeft === before.nestedScrollLeft,
        // A frame that never reloaded is a frame whose document survived.
        frameSurvived:
            before.frame.supported && after.frame.supported && after.frame.loads === before.frame.loads,
    };
}

/** A genuine user scroll to the very top must still land at the top. The regression to watch. */
async function userScrollToTop({ rowCount = 3000, from = 20000 } = {}) {
    const host = makeHost();
    const grid = makePlainGrid(host, rowCount);
    await frames(6);

    grid.container.scrollTop = from;
    await frames(8);
    const mid = { scrollTop: grid.container.scrollTop, modelOffsetY: grid.model.offset.y };

    // Exactly what a wheel or a Home key does: the container's own scrollTop moves, and the
    // event arrives a frame later.
    grid.container.scrollTop = 0;
    await frames(12);
    const top = {
        scrollTop: grid.container.scrollTop,
        modelOffsetY: grid.model.offset.y,
        unpaintedPx: unpaintedPx(grid),
        firstRowPainted: !!grid.container.querySelector('[data-row="0"]'),
    };

    // And a small scroll back down, to be sure nothing is now pinned at 0.
    grid.container.scrollTop = 480;
    await frames(10);
    const back = { scrollTop: grid.container.scrollTop, modelOffsetY: grid.model.offset.y };

    grid.destroy();
    host.remove();
    return { mid, top, back, ok: top.scrollTop === 0 && top.modelOffsetY === 0 && back.scrollTop === 480 };
}

/**
 * The harder half of face 1: a host that removes and re-inserts the subtree in **one task**.
 *
 * Chromium resets the scroller all the same, but no `ResizeObserver` ever sees a 0x0 — they
 * sample at the end of a frame, and by then the subtree is back at full size. So the size-based
 * detector cannot fire and something that records mutations rather than sampling state has to.
 */
async function face1Sync({ rowCount = 3000, scrollTop = 20000, watchHost = true } = {}) {
    const host = makeHost();
    const grid = makePlainGrid(host, rowCount, { watchHost });
    await frames(8);
    grid.container.scrollTop = scrollTop;
    await frames(8);

    let sawZero = false;
    const ro = new ResizeObserver((entries) => {
        for (const e of entries) {
            if (!e.contentRect.width && !e.contentRect.height) sawZero = true;
        }
    });
    ro.observe(grid.root);

    let scrollEvents = 0;
    const onScroll = () => scrollEvents++;
    grid.container.addEventListener("scroll", onScroll);

    const anchor = host.nextSibling;
    const parent = host.parentElement;
    host.remove();
    parent.insertBefore(host, anchor); // same task — no await between the two
    const immediate = { scrollTop: grid.container.scrollTop };
    await frames(14);

    const settled = {
        scrollTop: grid.container.scrollTop,
        modelOffsetY: grid.model.offset.y,
        unpaintedPx: unpaintedPx(grid),
        resizeObserverSaw0x0: sawZero,
        scrollEventsFired: scrollEvents,
    };
    grid.container.removeEventListener("scroll", onScroll);
    ro.disconnect();
    grid.destroy();
    host.remove();
    return { immediate, settled };
}

/** The manual escape hatch, with the automatic watcher deliberately off. */
async function manualRevalidate({ rowCount = 3000, scrollTop = 20000 } = {}) {
    const host = makeHost();
    const grid = makePlainGrid(host, rowCount, { watchHost: false });
    await frames(8);
    grid.container.scrollTop = scrollTop;
    await frames(8);

    const anchor = host.nextSibling;
    const parent = host.parentElement;
    host.remove();
    parent.insertBefore(host, anchor);
    await frames(10);
    const beforeCall = { scrollTop: grid.container.scrollTop, unpaintedPx: unpaintedPx(grid) };

    grid.revalidate();
    await frames(10);
    const afterCall = {
        scrollTop: grid.container.scrollTop,
        modelOffsetY: grid.model.offset.y,
        unpaintedPx: unpaintedPx(grid),
    };

    grid.destroy();
    host.remove();
    return { beforeCall, afterCall };
}

/** Everything, in one call. */
async function all() {
    return {
        face1: await face1(),
        face1Sync: await face1Sync(),
        manualRevalidate: await manualRevalidate(),
        hidePremise: await hidePremise(),
        face2Detaching: await face2({ keep: false }),
        face2Retaining: await face2({ keep: true }),
        userScrollToTop: await userScrollToTop(),
    };
}

window.scrollLoss = {
    all,
    face1,
    face1Sync,
    manualRevalidate,
    face2,
    hidePremise,
    userScrollToTop,
    unpaintedPx,
    makeHost,
    makePlainGrid,
    makeStatefulGrid,
    frames,
    sleep,
};
