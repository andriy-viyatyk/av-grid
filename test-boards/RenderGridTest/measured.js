/**
 * Task 34 — measured row heights, in a real browser.
 *
 * happy-dom does no layout, so the unit tests for this layer can only check the plumbing:
 * which element is measured, when, and what is done with the number. Everything the layer
 * actually exists for — a row whose height is *unpredictable until it is laid out* — can only
 * be seen here.
 *
 * The data is deliberately hostile: wrapped text of wildly varying length, so no row height is
 * derivable from anything but the DOM.
 *
 *   window.measured.all()          every measurement below, in order
 *   window.measured.hints()        first paint from hints, then settling to the truth
 *   window.measured.extent()       the total scroll extent against the measured heights
 *   window.measured.fromRow()      rows after a changed one land at their new offsets
 *   window.measured.readmit()      a retained, hidden cell is remeasured on re-admission
 *   window.measured.cost()         measured path against fixed height, same rows, same host
 */

import { MeasuredRowGrid, RenderGrid } from "./lib/av-grid.js";

const WORDS = [
    "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta",
    "iota", "kappa", "lambda", "mu", "renderer", "virtualization", "offset",
    "geometry", "measurement", "observer", "debounce", "clamp", "viewport",
    "scrollback", "reconciliation", "invalidation", "pool",
];

/** Deterministic, so two runs of the same measurement compare. */
function makeTexts(count, seed = 7) {
    let s = seed;
    const rand = () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
    };
    const texts = [];
    for (let i = 0; i < count; i++) {
        const n = 2 + Math.floor(rand() * 70);
        const out = [];
        for (let w = 0; w < n; w++) out.push(WORDS[Math.floor(rand() * WORDS.length)]);
        texts.push(out.join(" "));
    }
    return texts;
}

function makeHost(height = 400, width = 560) {
    const host = document.createElement("div");
    host.className = "measured-host";
    // The board's body is a flex column, which would squash a plain block host to nothing.
    host.style.cssText =
        `position:absolute;right:8px;top:60px;z-index:50;height:${height}px;width:${width}px;` +
        `display:flex;background:var(--p-background, #1e1e1e);outline:1px solid #888;`;
    document.body.append(host);
    return host;
}

const frames = (n = 1) =>
    new Promise((resolve) => {
        let left = n;
        const step = () => (left-- <= 0 ? resolve() : requestAnimationFrame(step));
        step();
    });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Long enough for the 50 ms per-row debounce, the commit, and the paint it causes. */
const settled = async (rounds = 6) => {
    for (let i = 0; i < rounds; i++) {
        await sleep(60);
        await frames(2);
    }
};

/**
 * The renderer under test.
 *
 * The cell is sized by the engine from what it currently believes, so measuring *it* would
 * always report the belief back. The nominated `body` is laid out by its own content, which is
 * the height the row actually needs.
 */
function makeRenderer(texts, keyByRow = false) {
    return (p) => {
        // A reuse key of the row index is the documented way to get *the same element* back for
        // the same row, which is what makes `keepCellsAttached` preserve per-row DOM state.
        const key = keyByRow ? p.row : undefined;
        const cell =
            p.previous ?? p.recycle?.(key) ?? document.createElement("div");
        if (keyByRow) p.setReuseKey?.(cell, key);
        cell.dataset.type = "m-cell";
        cell.dataset.row = String(p.row);
        const s = cell.style;
        s.position = "absolute";
        s.left = `${p.style.left}px`;
        s.top = `${p.style.top}px`;
        s.width = `${p.style.width}px`;
        s.height = `${p.style.height}px`;
        s.overflow = "hidden";
        s.boxSizing = "border-box";

        let body = cell.firstElementChild;
        if (!body) {
            body = document.createElement("div");
            body.className = "m-body";
            body.style.cssText =
                "padding:4px 8px;font:12px/16px system-ui,sans-serif;white-space:normal;" +
                "word-break:break-word;box-sizing:border-box;border-bottom:1px solid #444;" +
                "color:#ddd;";
            cell.append(body);
        }
        body.textContent = `${p.row} · ${texts[p.row]}`;
        p.measure(body);
        return cell;
    };
}

function makeGrid(texts, over = {}, hostHeight = 400) {
    const host = makeHost(hostHeight);
    const grid = new MeasuredRowGrid(host, {
        name: "measured-demo",
        // Exactly as for a bare `RenderGrid`: the root's height must be *definite*, and the
        // default is a visible-but-small 100px rather than the host's height.
        height: "100%",
        rowCount: () => texts.length,
        columnCount: 1,
        columnWidth: () => "100%",
        fitToWidth: true,
        minRowHeight: 20,
        renderCell: makeRenderer(texts),
        ...over,
    });
    return { grid, host };
}

/** The `top` the engine wrote for each currently rendered row. */
function renderedTops(grid) {
    const out = {};
    for (const el of grid.root.querySelectorAll("[data-row]:not([data-avg-pooled])")) {
        out[Number(el.dataset.row)] = Math.round(parseFloat(el.style.top));
    }
    return out;
}

const measuredRows = (grid, count) => {
    let n = 0;
    for (let i = 0; i < count; i++) if (grid.heights.heightOf(i) !== undefined) n++;
    return n;
};

// ---------------------------------------------------------------------------

/**
 * A hint gets the first paint close; the DOM then corrects it.
 *
 * The hints here are deliberately *wrong* by a constant factor, so "the hint was used" and
 * "the measurement replaced it" are separable.
 */
async function hints() {
    const texts = makeTexts(5000);
    const hint = (row) => 40 + (row % 5) * 10;
    const { grid, host } = makeGrid(texts, { getInitialRowHeight: hint }, 600);

    // Before any debounce has elapsed: geometry is entirely the hints.
    const firstTops = renderedTops(grid);
    const firstExtent = grid.model.renderInfo.current.innerSize.height;
    const hintedExtent = texts.reduce((acc, _t, i) => acc + hint(i), 0);
    const firstRowsPainted = Object.keys(firstTops).length;

    await settled();

    const settledTops = renderedTops(grid);
    const settledExtent = grid.model.renderInfo.current.innerSize.height;
    const heights = Object.keys(settledTops)
        .map(Number)
        .sort((a, b) => a - b)
        .map((r) => grid.heights.heightOf(r));

    const res = {
        firstRowsPainted,
        firstExtent,
        hintedExtentPlusSlack: hintedExtent + 20,
        // The first paint really did come from the hints, not from a uniform default.
        firstPaintUsedHints: firstExtent === hintedExtent + 20,
        firstTops,
        settledTops,
        measuredRows: measuredRows(grid, texts.length),
        distinctMeasuredHeights: new Set(heights).size,
        minMeasured: Math.min(...heights),
        maxMeasured: Math.max(...heights),
        settledExtent,
        extentMovedAfterMeasurement: settledExtent !== firstExtent,
    };

    grid.destroy();
    host.remove();
    return res;
}

/** The scrollable extent is the sum of what was measured, plus the trailing slack. */
async function extent() {
    const texts = makeTexts(400);
    const { grid, host } = makeGrid(texts);

    // Walk the whole list so every row is measured at least once.
    const scroller = grid.scrollElement;
    for (let pass = 0; pass < 3; pass++) {
        for (let y = 0; y < scroller.scrollHeight; y += 240) {
            scroller.scrollTop = y;
            await frames(2);
        }
        await settled(3);
    }
    await settled();

    let sum = 0;
    let unmeasured = 0;
    for (let i = 0; i < texts.length; i++) {
        const h = grid.heights.heightOf(i);
        if (h === undefined) unmeasured++;
        sum += h ?? grid.heights.rowHeight(i);
    }

    const res = {
        rows: texts.length,
        unmeasured,
        sumOfRowHeights: sum,
        innerHeight: grid.model.renderInfo.current.innerSize.height,
        scrollHeight: grid.scrollElement.scrollHeight,
        // `whiteSpace` is 20 by default and is the only thing between the two.
        extentMatchesMeasuredSum:
            grid.model.renderInfo.current.innerSize.height === sum + 20,
        maxScrollTop: grid.scrollElement.scrollHeight - grid.scrollElement.clientHeight,
    };

    grid.destroy();
    host.remove();
    return res;
}

/**
 * The one `fromRow` buys: a row changes height, and every row *after* it moves — while its
 * rendered content does not change at all.
 */
async function fromRow() {
    const texts = makeTexts(400);
    const { grid, host } = makeGrid(texts, {}, 800);
    await settled();

    const extentBefore = grid.model.renderInfo.current.innerSize.height;
    const rows = Object.keys(renderedTops(grid)).map(Number).sort((a, b) => a - b);
    const target = rows[1];
    const below = rows.filter((r) => r > target);

    const before = renderedTops(grid);
    const beforeHeight = grid.heights.heightOf(target);
    const beforeText = grid.root.querySelector(
        `[data-row="${below[0]}"] .m-body`,
    ).textContent;

    // Make one row much taller, and tell the engine only that its *content* changed. The height
    // change is discovered by measurement, and the geometry consequence is `{ fromRow }`.
    texts[target] = makeTexts(1, 99)[0] + " " + WORDS.join(" ").repeat(6);
    grid.model.update({ rows: [target] });
    await settled();

    const after = renderedTops(grid);
    const afterHeight = grid.heights.heightOf(target);
    const delta = afterHeight - beforeHeight;

    const shifted = below
        .filter((r) => after[r] !== undefined && before[r] !== undefined)
        .map((r) => ({ row: r, before: before[r], after: after[r], moved: after[r] - before[r] }));

    const res = {
        target,
        heightBefore: beforeHeight,
        heightAfter: afterHeight,
        delta,
        rowsAbove: rows.filter((r) => r < target).map((r) => ({
            row: r,
            moved: after[r] - before[r],
        })),
        rowsBelowCount: shifted.length,
        rowsBelowSample: shifted.slice(0, 6),
        // Every row after the changed one moved by exactly the height delta…
        allBelowMovedByDelta: shifted.length > 0 && shifted.every((s) => s.moved === delta),
        // …and none of them re-rendered into something different.
        contentBelowUnchanged:
            grid.root.querySelector(`[data-row="${below[0]}"] .m-body`).textContent ===
            beforeText,
        extentBefore,
        extentAfter: grid.model.renderInfo.current.innerSize.height,
        // The extent moves by more than `delta`, and that is the documented fallback rather
        // than a geometry error: with `preferMinHeightForNewRows` off, a row that has never
        // been measured is estimated at the *last* measured height, and the row just made 296
        // tall is now that. The rendered rows are the ones `fromRow` is accountable for.
        unmeasuredRowEstimate: grid.heights.rowHeight(texts.length - 1),
    };

    grid.destroy();
    host.remove();
    return res;
}

/**
 * A retained, hidden cell is remeasured when it comes back.
 *
 * This is the interaction most likely to be silently wrong: with `keepCellsAttached` the
 * element never leaves the DOM, so a layer that tied its bookkeeping to detachment would stop
 * measuring it — and a hidden element measures **zero**, so the stale value is what survives.
 */
async function readmit() {
    const texts = makeTexts(400);
    const { grid, host } = makeGrid(texts, {
        keepCellsAttached: true,
        renderCell: makeRenderer(texts, true),
    });
    await settled();

    const row = 0;
    const originalHeight = grid.heights.heightOf(row);
    const cell = grid.root.querySelector(`[data-row="${row}"]`);

    const scroller = grid.scrollElement;
    scroller.scrollTop = 4000;
    await frames(3);
    await settled(2);

    const whileHidden = {
        stillInDocument: cell.isConnected,
        display: cell.style.display,
        pooledMarker: cell.hasAttribute("data-avg-pooled"),
        bodyClientHeight: cell.firstElementChild.clientHeight,
        committedHeight: grid.heights.heightOf(row),
    };

    // Change what the row will say, so a remeasurement is distinguishable from a stale value.
    texts[row] = WORDS.join(" ").repeat(8);

    scroller.scrollTop = 0;
    await frames(3);
    await settled();

    const backCell = grid.root.querySelector(`[data-row="${row}"]`);
    const res = {
        originalHeight,
        whileHidden,
        // The zero it reported while hidden was ignored, not committed.
        zeroWhileHiddenIgnored: whileHidden.committedHeight === originalHeight,
        sameElementCameBack: backCell === cell,
        visibleAgain: backCell.style.display !== "none",
        bodyClientHeightNow: backCell.firstElementChild.clientHeight,
        committedHeightNow: grid.heights.heightOf(row),
        remeasured: grid.heights.heightOf(row) !== originalHeight,
        matchesLayout:
            grid.heights.heightOf(row) === backCell.firstElementChild.clientHeight,
    };

    grid.destroy();
    host.remove();
    return res;
}

/**
 * What the measured path costs, against the same rows through the fixed-height engine.
 *
 * Honest comparison: same host, same row count, same renderer shape — the fixed grid simply
 * takes a constant `rowHeight` and nominates nothing.
 */
async function cost(rows = 5000, passes = 60) {
    const texts = makeTexts(rows);

    async function drive(grid, scroller) {
        await settled(4);
        grid.grid ? grid.grid.resetStats() : grid.resetStats();
        const stats = () => (grid.grid ? grid.grid.stats : grid.stats);
        const max = scroller.scrollHeight - scroller.clientHeight;
        const startedAt = performance.now();
        for (let i = 0; i < passes; i++) {
            scroller.scrollTop = Math.round((max * i) / passes);
            await frames(1);
        }
        const wall = performance.now() - startedAt;
        const s = stats();
        return {
            paints: s.paints,
            avgPaintMs: Number((s.totalPaintMs / Math.max(1, s.paints)).toFixed(3)),
            totalPaintMs: Number(s.totalPaintMs.toFixed(1)),
            wallMs: Number(wall.toFixed(1)),
            fps: Number((passes / (wall / 1000)).toFixed(1)),
            poolHits: s.pool.hits,
            poolMisses: s.pool.misses,
        };
    }

    const { grid: m, host: mh } = makeGrid(texts, {}, 400);
    const measuredRun = await drive(m, m.scrollElement);
    const measuredRowsSeen = measuredRows(m, rows);
    m.destroy();
    mh.remove();

    const fh = makeHost(400);
    const fixed = new RenderGrid(fh, {
        name: "fixed-demo",
        height: "100%",
        rowCount: () => texts.length,
        columnCount: 1,
        columnWidth: () => "100%",
        fitToWidth: true,
        rowHeight: 48,
        renderCell: (p) => {
            const r = makeRenderer(texts);
            return r({ ...p, measure: () => {} });
        },
    });
    const fixedRun = await drive(fixed, fixed.container);
    fixed.destroy();
    fh.remove();

    return {
        rows,
        passes,
        measured: measuredRun,
        measuredRowsSeen,
        fixed: fixedRun,
        paintRatio: Number((measuredRun.avgPaintMs / fixedRun.avgPaintMs).toFixed(2)),
    };
}

async function all() {
    const out = {};
    out.hints = await hints();
    out.extent = await extent();
    out.fromRow = await fromRow();
    out.readmit = await readmit();
    out.cost = await cost();
    return out;
}

window.measured = {
    all,
    hints,
    extent,
    fromRow,
    readmit,
    cost,
    makeGrid,
    makeTexts,
    makeHost,
    renderedTops,
    frames,
    sleep,
    settled,
};
