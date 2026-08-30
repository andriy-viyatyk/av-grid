/**
 * After-paint scrolling and live shell layout — the measurement rig for plan tasks 36 and 37
 * (EPIC-079 / US-1240 and US-1241).
 *
 * Both are *timing and layout* defects, so happy-dom cannot see either of them: one is about
 * which frame a `scrollTop` write lands in, the other about geometry the tests never compute.
 * This rig measures both in a real engine, before and after the fix.
 *
 * **Gap 4 — after-paint scrolling.** `scrollTop` is clamped to the scrollable extent, and the
 * extent is `area.style.height`, which the paint writes. A caller that changes the row set and
 * scrolls in the same turn is therefore scrolling against the *old* extent: the request silently
 * clamps, the list then paints correctly at the wrong place, and nothing re-issues it.
 * `gap4({ via })` measures the landing offset for each entry point, including `setTimeout(0)`,
 * which the fork's comment claims is not enough — worth confirming rather than trusting.
 *
 * **Gap 5 — live shell layout.** `RenderGrid.setOptions` never reapplied `height`,
 * `growToHeight`, `growToWidth` or the overflow that follows `fitToWidth`, so a host that
 * changes its layout after construction — an autocomplete popup resizing as its filtered list
 * grows — got a stale shell. `gap5()` reads the geometry the shell actually ended up with.
 *
 * Everything hangs off `window.afterPaint`. Uses `scroll-loss.js`'s host and grid factories so
 * the two rigs cannot drift apart on how a scratch grid is built.
 */

import { RenderGrid } from "./lib/av-grid.js";

const frames = (n) =>
    new Promise((resolve) => {
        const tick = () => (--n <= 0 ? resolve() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
    });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A scratch host outside the benchmark's own, so a measurement never disturbs `window.bench`. */
function makeHost(height = 400) {
    const host = document.createElement("div");
    host.className = "after-paint-host";
    // The board's body is a flex column, which would squash a plain block host to nothing.
    host.style.cssText =
        `position:absolute;right:8px;top:60px;z-index:50;height:${height}px;width:600px;` +
        `display:flex;background:var(--p-background, #1e1e1e);outline:1px solid #888;`;
    document.body.append(host);
    return host;
}

const ROW_HEIGHT = 24;

/** A plain text grid whose row count is read from a mutable box, so the row set can change. */
function makeGrowableGrid(host, box, options = {}) {
    return new RenderGrid(host, {
        rowCount: () => box.rows,
        columnCount: 4,
        rowHeight: ROW_HEIGHT,
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

/** The row painted at the very top of the container's viewport — what the user actually sees. */
function topPaintedRow(grid) {
    const view = grid.container.getBoundingClientRect();
    let best = null;
    for (const el of grid.container.querySelectorAll("[data-row]")) {
        const r = el.getBoundingClientRect();
        if (r.height === 0 || r.bottom <= view.top + 1) continue;
        const row = Number(el.getAttribute("data-row"));
        if (best === null || row < best) best = row;
    }
    return best;
}

// ---------------------------------------------------------------------------
// Gap 4 — after-paint scrolling
// ---------------------------------------------------------------------------

/**
 * Change the row set and scroll to a far row **in the same turn**, then report where it landed.
 *
 * `via` picks the entry point:
 *
 * - `"now"`      — `model.scrollToRow(target)` straight away. The broken case.
 * - `"timeout"`  — the same call inside `setTimeout(0)`. The fork claims this is not enough.
 * - `"raf"`      — inside one `requestAnimationFrame`, for completeness.
 * - `"afterPaint"` — `model.scrollToRowAfterPaint(target)`. The fix. Absent before it exists.
 *
 * The grid starts small so the old extent is *tiny*: 20 rows in a 400px viewport is 80px of
 * scrollable extent against the 48,000px the request wants, which makes a clamp unmistakable
 * rather than a near miss.
 */
async function gap4({ via = "now", smallRows = 20, bigRows = 3000, target = 2000 } = {}) {
    const host = makeHost();
    const box = { rows: smallRows };
    const grid = makeGrowableGrid(host, box);
    await frames(8);

    const expected = target * ROW_HEIGHT;
    const before = {
        rows: box.rows,
        areaHeight: grid.area.style.height,
        scrollHeight: grid.container.scrollHeight,
        maxScrollTop: grid.container.scrollHeight - grid.container.clientHeight,
    };

    // The two things a caller does together, in one turn — a filter cleared, a tree expanded.
    box.rows = bigRows;
    grid.model.update({ all: true });

    let unsupported = false;
    if (via === "now") {
        void grid.model.scrollToRow(target, "top");
    } else if (via === "timeout") {
        setTimeout(() => void grid.model.scrollToRow(target, "top"), 0);
    } else if (via === "raf") {
        requestAnimationFrame(() => void grid.model.scrollToRow(target, "top"));
    } else if (via === "afterPaint") {
        if (typeof grid.model.scrollToRowAfterPaint !== "function") unsupported = true;
        else grid.model.scrollToRowAfterPaint(target, "top");
    }

    await frames(20);
    await sleep(50);
    await frames(6);

    const after = {
        rows: box.rows,
        areaHeight: grid.area.style.height,
        scrollHeight: grid.container.scrollHeight,
        scrollTop: grid.container.scrollTop,
        modelOffsetY: grid.model.offset.y,
        topPaintedRow: topPaintedRow(grid),
    };

    grid.destroy();
    host.remove();

    return {
        via,
        unsupported,
        target,
        expectedScrollTop: expected,
        before,
        after,
        landedCorrectly: !unsupported && after.scrollTop === expected,
        clampedToOldExtent: after.scrollTop === before.maxScrollTop && expected > before.maxScrollTop,
    };
}

/** All four entry points, so the `setTimeout(0)` claim is measured beside the others. */
async function gap4All(opts = {}) {
    return {
        now: await gap4({ ...opts, via: "now" }),
        timeout: await gap4({ ...opts, via: "timeout" }),
        raf: await gap4({ ...opts, via: "raf" }),
        afterPaint: await gap4({ ...opts, via: "afterPaint" }),
    };
}

/**
 * The other half of the shared slot: a `scrollToRow` issued while the grid has no usable size.
 *
 * A grid built inside a popover that lays out later computes its first geometry at height 0, so
 * `calcScrollOffsetY` works from a zero viewport and the browser clamps the result to nothing.
 * The request has to survive until the grid is measurable.
 */
async function gap4Unmeasured({ rows = 3000, target = 1500 } = {}) {
    const host = makeHost();
    host.style.display = "none"; // laid out nowhere — the popover that has not opened yet
    const box = { rows };
    const grid = makeGrowableGrid(host, box);
    await frames(4);

    const whileHidden = {
        rootHeight: grid.root.offsetHeight,
        measured: grid.model.measured === undefined ? "(no such getter)" : grid.model.measured,
    };

    void grid.model.scrollToRow(target, "top");
    await frames(4);
    const beforeShow = { scrollTop: grid.container.scrollTop };

    host.style.display = "flex";
    await frames(16);
    await sleep(50);
    await frames(4);

    const afterShow = {
        scrollTop: grid.container.scrollTop,
        modelOffsetY: grid.model.offset.y,
        topPaintedRow: topPaintedRow(grid),
    };

    grid.destroy();
    host.remove();
    return {
        target,
        expectedScrollTop: target * ROW_HEIGHT,
        whileHidden,
        beforeShow,
        afterShow,
        landedCorrectly: afterShow.scrollTop === target * ROW_HEIGHT,
    };
}

/**
 * The conflict task 35 makes possible: a queued scroll and the causal reconciliation both
 * wanting to write in the same window.
 *
 * The host moves the grid (which arms `revalidateScroll`) in the same turn as a row-set change
 * and an after-paint scroll. The queued scroll is the newer, explicit request and must win; the
 * reconciliation is repairing a position that is about to be replaced anyway.
 */
async function gap4VsRevalidate({ rows = 3000, from = 20000, target = 1200 } = {}) {
    const host = makeHost();
    const box = { rows };
    const grid = makeGrowableGrid(host, box);
    await frames(8);

    grid.container.scrollTop = from;
    await frames(8);
    const before = { scrollTop: grid.container.scrollTop, modelOffsetY: grid.model.offset.y };

    // Detach and re-insert in one task — Chromium resets the scroller, no event fires — and in
    // the same turn ask for a new row.
    const anchor = host.nextSibling;
    const parent = host.parentElement;
    host.remove();
    parent.insertBefore(host, anchor);
    if (typeof grid.model.scrollToRowAfterPaint === "function") {
        grid.model.scrollToRowAfterPaint(target, "top");
    } else {
        void grid.model.scrollToRow(target, "top");
    }

    await frames(20);
    await sleep(60);
    await frames(6);

    const after = {
        scrollTop: grid.container.scrollTop,
        modelOffsetY: grid.model.offset.y,
        topPaintedRow: topPaintedRow(grid),
    };

    grid.destroy();
    host.remove();
    return {
        before,
        after,
        expectedScrollTop: target * ROW_HEIGHT,
        // The queued scroll wins: neither the old 20000 nor a half-way compromise.
        queuedScrollWon: after.scrollTop === target * ROW_HEIGHT,
        restoredStaleOffset: after.scrollTop === from,
    };
}

// ---------------------------------------------------------------------------
// Gap 5 — setOptions applies shell layout
// ---------------------------------------------------------------------------

/** The geometry a host cares about, read from the live DOM rather than from the options. */
function shellGeometry(grid) {
    return {
        rootHeightPx: Math.round(grid.root.getBoundingClientRect().height),
        rootStyleHeight: grid.root.style.height,
        rootMaxHeight: grid.root.style.maxHeight,
        containerMaxHeight: grid.container.style.maxHeight,
        containerMaxWidth: grid.container.style.maxWidth,
        containerOverflowX: grid.container.style.overflowX,
    };
}

/**
 * Construct a grid, then change its layout through `setOptions`, and read what the shell did.
 *
 * The sequence is an autocomplete popup's: it opens full height, the user types, the filtered
 * list is short, so the popup caps itself — then the filter is cleared and it grows back.
 */
async function gap5({ rows = 3000 } = {}) {
    const host = makeHost(400);
    const box = { rows };
    const grid = makeGrowableGrid(host, box, { height: "100%" });
    await frames(8);

    const atConstruction = shellGeometry(grid);

    grid.setOptions({ height: undefined, growToHeight: "150px" });
    await frames(8);
    const afterGrowTo150 = shellGeometry(grid);

    grid.setOptions({ growToHeight: "260px" });
    await frames(8);
    const afterGrowTo260 = shellGeometry(grid);

    grid.setOptions({ growToWidth: "320px", fitToWidth: true });
    await frames(8);
    const afterWidth = shellGeometry(grid);

    grid.setOptions({ height: "100%", growToHeight: undefined, growToWidth: undefined, fitToWidth: false });
    await frames(8);
    const backToFill = shellGeometry(grid);

    grid.destroy();
    host.remove();

    return {
        atConstruction,
        afterGrowTo150,
        afterGrowTo260,
        afterWidth,
        backToFill,
        heightFollowed:
            afterGrowTo150.rootHeightPx === 150 &&
            afterGrowTo260.rootHeightPx === 260 &&
            backToFill.rootHeightPx === 400,
        widthFollowed:
            afterWidth.containerMaxWidth === "320px" && afterWidth.containerOverflowX === "hidden",
    };
}

/**
 * A grid whose viewport grows must render into the new space, not just resize its box.
 *
 * The shell change has to reach the engine — a taller root means more visible rows — which is
 * the part a pure style write would miss.
 */
async function gap5Renders({ rows = 3000 } = {}) {
    const host = makeHost(400);
    const box = { rows };
    const grid = makeGrowableGrid(host, box, { height: undefined, growToHeight: "100px" });
    await frames(10);
    const small = {
        rootHeightPx: Math.round(grid.root.getBoundingClientRect().height),
        visibleRowCount: grid.model.visibleRowCount,
        paintedCells: grid.container.querySelectorAll("[data-row]").length,
    };

    grid.setOptions({ growToHeight: "360px" });
    await frames(14);
    const big = {
        rootHeightPx: Math.round(grid.root.getBoundingClientRect().height),
        visibleRowCount: grid.model.visibleRowCount,
        paintedCells: grid.container.querySelectorAll("[data-row]").length,
    };

    grid.destroy();
    host.remove();
    return { small, big, grew: big.visibleRowCount > small.visibleRowCount };
}

/** Everything, in one call. */
async function all() {
    return {
        gap4: await gap4All(),
        gap4Unmeasured: await gap4Unmeasured(),
        gap4VsRevalidate: await gap4VsRevalidate(),
        gap5: await gap5(),
        gap5Renders: await gap5Renders(),
    };
}

window.afterPaint = {
    all,
    gap4,
    gap4All,
    gap4Unmeasured,
    gap4VsRevalidate,
    gap5,
    gap5Renders,
    makeHost,
    makeGrowableGrid,
    topPaintedRow,
    frames,
    sleep,
};
