/**
 * The blank probe — how much of the viewport shows *nothing* while the grid is scrolled.
 *
 * Built for plan task 65. The complaint it exists to quantify: drag the scrollbar of a
 * 100,000-row grid and the viewport is empty the whole way down, filling in only once the drag
 * stops. Frame rate cannot see this — painting nothing is cheap, and the grid holds 60 fps
 * throughout — so the instrument has to ask a different question: **after this frame's scroll,
 * is there a cell under this pixel?**
 *
 * Two numbers come out of here, and they answer different questions.
 *
 * 1. `probe()` — **what the reader sees.** Per frame, move the scroll position, then
 *    immediately hit-test a column of points down the viewport. The sample is taken
 *    synchronously after the write because a `scrollTop` write is applied to layout at once:
 *    what the hit test finds is what that frame is about to composite.
 *
 * 2. `lag()` — **why.** Every paint is classified as *same-frame* (it ran in the animation-frame
 *    phase of the very frame whose scroll event triggered it) or *late* (it ran in a later
 *    frame). This is the number task 65 turns on, and it is the one thing the plan asserts
 *    without having measured it directly: painting eagerly from the scroll handler can only help
 *    if the scheduled paint is arriving a frame late. If every paint is already same-frame, the
 *    proposed fix is a no-op and the blank has another cause — the compositor scrolling the
 *    layer without waiting for the main thread at all.
 *
 * Each call builds its own grid in a scratch host and tears it down, so nothing here disturbs
 * `window.bench`.
 *
 *     await window.blank.all()            // the whole matrix, current build
 *     await window.blank.probe({ stepFraction: 1/4 })
 *     await window.blank.lag()
 *     await window.blank.onBench()        // the same probe against the benchmark's own grid
 */

import { RenderGrid } from "./lib/av-grid.js";

const raf = () => new Promise((resolve) => requestAnimationFrame(resolve));
const frames = async (n) => {
    for (let i = 0; i < n; i++) await raf();
};

const ROW_HEIGHT = 28;

// ---------------------------------------------------------------------------
// Cell content
// ---------------------------------------------------------------------------

const WORDS = [
    "alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel",
    "india", "juliet", "kilo", "lima", "mike", "november", "oscar", "papa",
];
const STATUSES = ["open", "closed", "pending", "archived", "draft"];

/**
 * What each column draws. A text-only cell is not what this measurement is about: the
 * measurement this task came from ran over cells with **content** — a coloured status pill, a
 * progress bar, a right-aligned signed number — and cell content is most of the paint.
 * Probing a grid of bare strings flatters the result and says nothing about a real one.
 *
 * Five kinds, cycling, so a 12-column viewport draws all of them at once.
 */
const KINDS = ["index", "text", "num", "pill", "bar"];
const kindOf = (col) => (col === 0 ? "index" : KINDS[1 + ((col - 1) % 4)]);

/**
 * Build a cell's children for its kind, once.
 *
 * **Why this is not a one-liner.** Cells are pooled and the pool hands them back dirty, so the
 * element arriving here may have been a progress bar in a column that has just scrolled out of
 * view. Rebuilding the children on every paint would be both wrong (it allocates per cell per
 * frame) and unrepresentative — the library's own `DataCell` keeps the markup and only rewrites
 * it when the *kind* changes (`claim(el, kind)`, task 62). This mirrors that, and the
 * `data-kind` attribute is the evidence it reads, exactly as `DataCell` reads `data-type`.
 */
function buildKind(el, kind) {
    if (el.getAttribute("data-kind") === kind) return;
    el.setAttribute("data-kind", kind);
    el.textContent = "";

    if (kind === "pill") {
        const pill = document.createElement("span");
        pill.className = "bp-pill";
        pill.appendChild(document.createTextNode(""));
        el.appendChild(pill);
        return;
    }
    if (kind === "bar") {
        const track = document.createElement("span");
        track.className = "bp-track";
        const fill = document.createElement("span");
        fill.className = "bp-fill";
        track.appendChild(fill);
        const label = document.createElement("span");
        label.className = "bp-bar-label";
        label.appendChild(document.createTextNode(""));
        el.appendChild(track);
        el.appendChild(label);
        return;
    }
    el.appendChild(document.createTextNode(""));
}

const setText = (node, text) => {
    if (node.nodeValue !== text) node.nodeValue = text;
};

/**
 * The renderer, in the shape the whole project turns on: `previous ?? recycle() ?? create`,
 * every property the previous occupant may have set overwritten, and the position written from
 * `p.style` — the engine does not write it, the renderer does. A harness renderer that forgets
 * that stacks every cell at the top of the area, and every probe point then finds a cell on a
 * grid that is in fact blank.
 */
function renderCell(p) {
    const el = p.previous ?? p.recycle?.() ?? document.createElement("div");

    const style = el.style;
    style.left = `${p.style.left}px`;
    style.top = `${p.style.top}px`;
    style.width = `${p.style.width}px`;
    style.height = `${p.style.height}px`;

    el.setAttribute("data-row", String(p.row));
    el.setAttribute("data-col", String(p.col));

    if (p.row === 0) {
        buildKind(el, "head");
        if (el.className !== "avg-cell header") el.className = "avg-cell header";
        setText(el.firstChild, p.col === 0 ? "#" : `Column ${p.col}`);
        return el;
    }

    const row = p.row - 1;
    const kind = kindOf(p.col);
    buildKind(el, kind);

    let cls = "avg-cell bp-" + kind;
    if (row % 2) cls += " odd";

    switch (kind) {
        case "index":
            setText(el.firstChild, String(row + 1));
            break;
        case "text":
            setText(el.firstChild, `${WORDS[(row + p.col) % WORDS.length]} ${row % 997}`);
            break;
        case "num": {
            // Signed, and coloured by sign: a class change per cell per scroll is part of what
            // a real grid pays for.
            const value = (((row * 7919 + p.col * 104729) % 200000) - 100000) / 100;
            setText(el.firstChild, value.toFixed(2));
            cls += value < 0 ? " neg" : " pos";
            break;
        }
        case "pill": {
            const status = STATUSES[(row + p.col) % STATUSES.length];
            const pill = el.firstChild;
            const want = `bp-pill s-${status}`;
            if (pill.className !== want) pill.className = want;
            setText(pill.firstChild, status);
            break;
        }
        case "bar": {
            const pct = (row * 37 + p.col * 11) % 101;
            const fill = el.firstChild.firstChild;
            const want = `${pct}%`;
            if (fill.style.width !== want) fill.style.width = want;
            const band = pct < 34 ? "low" : pct < 67 ? "mid" : "high";
            const fillCls = `bp-fill b-${band}`;
            if (fill.className !== fillCls) fill.className = fillCls;
            setText(el.lastChild.firstChild, `${pct}%`);
            break;
        }
    }

    if (el.className !== cls) el.className = cls;
    return el;
}

// ---------------------------------------------------------------------------
// The grid under test
// ---------------------------------------------------------------------------

/**
 * A scratch host outside the benchmark's own.
 *
 * The board's `<body>` is a flex column, so a plain block host is squashed to nothing —
 * `position: absolute` keeps it out of flow while still being laid out, painted and scrollable.
 * It sits *over* the benchmark grid deliberately: an offscreen or clipped host is not
 * composited, and half of what this file measures is compositing.
 */
function makeHost(height, width) {
    const host = document.createElement("div");
    host.className = "blank-probe-host";
    host.style.cssText =
        `position:absolute;left:8px;top:60px;z-index:60;height:${height}px;width:${width}px;` +
        `display:flex;background:var(--p-background, #1e1e1e);outline:1px solid #888;`;
    document.body.append(host);
    return host;
}

/**
 * The grid this file measures: 100,000 rows by 12 columns of real cell content, a sticky header
 * and a sticky first column. The shape the original measurement was run on.
 */
function makeGrid({
    rowCount = 100_000,
    columnCount = 12,
    overscanRow = 4,
    height = 600,
    width = 980,
    onCellAttached,
} = {}) {
    const host = makeHost(height, width);
    const grid = new RenderGrid(host, {
        name: "blank-probe",
        rowCount: () => rowCount + 1,
        columnCount: () => columnCount,
        rowHeight: ROW_HEIGHT,
        columnWidth: (i) => (i === 0 ? 70 : kindOf(i) === "bar" ? 150 : 120),
        renderCell,
        stickyTop: 1,
        stickyLeft: 1,
        overscanRow,
        overscanColumn: 1,
        height: "100%",
        onCellAttached,
    });
    return {
        grid,
        host,
        destroy: () => {
            grid.destroy();
            host.remove();
        },
    };
}

// ---------------------------------------------------------------------------
// The probe
// ---------------------------------------------------------------------------

/**
 * Hit-test a column of points down the viewport and report how many found no cell.
 *
 * **The x coordinate matters.** The sticky-left band is painted at every scroll position, so a
 * probe over it reports a covered viewport on a grid that is entirely blank. The points sit in
 * the scrolling centre region, clear of both sticky bands.
 *
 * **What this can and cannot see.** `elementFromPoint` hit-tests the main thread's layout, which
 * is what that thread has drawn — the compositor may still be showing something older. So a
 * blank reported here is certainly blank on screen, while a covered point may still have looked
 * blank for a frame. The number is a floor, not a ceiling, which is the honest direction for a
 * defect measurement.
 */
function sample(grid, points, expectedRow) {
    const view = grid.container.getBoundingClientRect();
    const x = view.left + 200; // clear of the 70px sticky-left column
    const top = view.top + ROW_HEIGHT; // clear of the sticky header row
    const usable = view.bottom - top;

    let blank = 0;
    let wrongRow = 0;
    for (let i = 0; i < points; i++) {
        const y = top + (usable * (i + 0.5)) / points;
        const hit = document.elementFromPoint(x, y);
        const cell = hit?.closest?.("[data-row]");
        if (!cell) {
            blank++;
            continue;
        }
        if (expectedRow) {
            const want = expectedRow(y - top);
            const got = Number(cell.getAttribute("data-row"));
            if (Math.abs(got - want) > 1) wrongRow++;
        }
    }
    return { blank, wrongRow };
}

/**
 * Scroll frame by frame and sample what each frame shows.
 *
 * `drive` picks how the scroll is produced, and the three are not interchangeable:
 *
 * - **`"raw"`** (default) — write `scrollTop` once per frame and let the browser fire the real
 *   scroll event, asynchronously, as it does for a user. Closest to a scrollbar drag: the
 *   position jumps by a fixed distance every frame.
 * - **`"synthetic"`** — the same write followed by a synthetic `Event("scroll")` dispatched in
 *   the same task. This is what `window.bench` does, and it is a *control*: it takes the
 *   browser's event timing out of the measurement, so a difference between it and `"raw"` is
 *   the event delivery rather than the grid.
 * - **`"smooth"`** — one `scrollTo({ behavior: "smooth" })`, then watch. The only mode here
 *   where the browser owns the scroll end to end, compositor included; the per-frame distance
 *   is the browser's to choose and the mean is reported back.
 */
async function probe({
    stepFraction = 1 / 4,
    drive = "raw",
    frameCount = 60,
    points = 9,
    overscanRow = 4,
    height = 600,
    startFraction = 0.2,
    grid: given,
    ...rest
} = {}) {
    const built = given ? null : makeGrid({ overscanRow, height, ...rest });
    const grid = given ?? built.grid;
    try {
        const container = grid.container;
        const viewportPx = container.clientHeight;
        const extent = container.scrollHeight - viewportPx;
        const step =
            stepFraction === "range"
                ? Math.floor(extent / 30)
                : Math.round(viewportPx * stepFraction);

        let y = Math.round(extent * startFraction);
        container.scrollTop = y;
        await frames(6);

        const rowHeight = grid.model.getOptions?.().rowHeight ?? ROW_HEIGHT;
        const expectedRow = (offsetInView) =>
            Math.floor((container.scrollTop + offsetInView) / rowHeight) + 1;

        let blankFrames = 0;
        let blankPoints = 0;
        let wrongRowPoints = 0;
        let sampled = 0;
        const steps = [];

        if (drive === "smooth") {
            let last = container.scrollTop;
            container.scrollTo({
                top: Math.min(extent, y + step * frameCount),
                behavior: "smooth",
            });
            for (let i = 0; i < frameCount; i++) {
                await raf();
                const now = container.scrollTop;
                if (now === last && i > 2) break; // arrived
                steps.push(now - last);
                last = now;
                const s = sample(grid, points, expectedRow);
                sampled += points;
                blankPoints += s.blank;
                wrongRowPoints += s.wrongRow;
                if (s.blank > 0) blankFrames++;
            }
        } else {
            for (let i = 0; i < frameCount; i++) {
                y = Math.min(extent, y + step);
                container.scrollTop = y;
                if (drive === "synthetic") container.dispatchEvent(new Event("scroll"));
                steps.push(step);
                // Synchronous on purpose: the write is already in layout, so this is the frame
                // the reader is about to be shown.
                const s = sample(grid, points, expectedRow);
                sampled += points;
                blankPoints += s.blank;
                wrongRowPoints += s.wrongRow;
                if (s.blank > 0) blankFrames++;
                await raf();
            }
        }

        const n = steps.length || 1;
        return {
            drive,
            stepFraction: stepFraction === "range" ? "range/30" : Number(stepFraction.toFixed(4)),
            overscanRow,
            viewportPx,
            stepPx: Math.round(steps.reduce((a, b) => a + b, 0) / n),
            overscanPx: overscanRow * ROW_HEIGHT,
            frames: n,
            blankFramesPct: Math.round((blankFrames / n) * 100),
            blankPointsPct: Math.round((blankPoints / Math.max(1, sampled)) * 100),
            wrongRowPointsPct: Math.round((wrongRowPoints / Math.max(1, sampled)) * 100),
        };
    } finally {
        built?.destroy();
    }
}

// ---------------------------------------------------------------------------
// The lag accounting — the number task 65 turns on
// ---------------------------------------------------------------------------

/**
 * Classify every paint as same-frame or late.
 *
 * **How a frame is identified without counting frames.** A standing `requestAnimationFrame` loop
 * is registered before the scroll starts, so its callback is the first of each frame's animation
 * callbacks — the grid's own paint callback is registered later, from the scroll event, and runs
 * after it. The order within one frame is therefore:
 *
 *     [browser fires the scroll event] -> [this loop's callback] -> [the grid's paint callback]
 *
 * The scroll listener raises a flag; the loop copies it and clears it; the paint reads the copy.
 * A paint that reads `true` ran in the same frame as the scroll event that caused it. A paint
 * that reads `false` is a frame or more behind the scroll it is drawing — which is the premise
 * of task 65, and the thing to establish before writing a line of the fix.
 *
 * The paint is observed through `onCellAttached`, the engine's own lifecycle seam, deduped to
 * one count per frame. A paint that attaches no cell attaches nothing to observe and does not
 * appear here; during a scroll that outruns the overscan, every paint attaches cells.
 *
 * **What the `"synthetic"` control does and does not prove.** A synthetic event dispatched from
 * this file's own loop is dispatched *during* the animation-frame phase, after the standing tick
 * has already run, so its paint necessarily lands in the following frame and is still counted
 * same-frame. That is not a bug in the accounting: in both readings the statement it supports is
 * the same one — **the paint runs at the first rendering opportunity after the scroll event**,
 * never later. The `"raw"` and `"smooth"` modes, where the browser fires the event itself in the
 * scroll steps before the frame's animation callbacks, are the ones that could have shown a late
 * paint, and the mode to quote.
 */
async function lag({
    stepFraction = 1 / 4,
    drive = "raw",
    frameCount = 60,
    overscanRow = 4,
    height = 600,
    startFraction = 0.2,
    ...rest
} = {}) {
    let scrollThisFrame = false;
    let sawScrollThisFrame = false;
    let frameId = 0;
    let lastPaintFrame = -1;

    let sameFrame = 0;
    let late = 0;
    let scrollEvents = 0;

    let running = true;
    const tick = () => {
        if (!running) return;
        frameId++;
        sawScrollThisFrame = scrollThisFrame;
        scrollThisFrame = false;
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    const onCellAttached = () => {
        if (lastPaintFrame === frameId) return; // one count per frame
        lastPaintFrame = frameId;
        if (sawScrollThisFrame) sameFrame++;
        else late++;
    };

    const built = makeGrid({ overscanRow, height, onCellAttached, ...rest });
    const { grid } = built;
    const container = grid.container;
    const onScroll = () => {
        scrollThisFrame = true;
        scrollEvents++;
    };

    try {
        const viewportPx = container.clientHeight;
        const extent = container.scrollHeight - viewportPx;
        const step =
            stepFraction === "range"
                ? Math.floor(extent / 30)
                : Math.round(viewportPx * stepFraction);

        let y = Math.round(extent * startFraction);
        container.scrollTop = y;
        await frames(8);

        // Registered after the grid's own listener, so the model has already recomputed by the
        // time this runs. It only has to say that an event arrived in this frame.
        container.addEventListener("scroll", onScroll, { passive: true });
        sameFrame = 0;
        late = 0;
        scrollEvents = 0;
        grid.resetStats?.();

        if (drive === "smooth") {
            container.scrollTo({
                top: Math.min(extent, y + step * frameCount),
                behavior: "smooth",
            });
            await frames(frameCount);
        } else {
            for (let i = 0; i < frameCount; i++) {
                y = Math.min(extent, y + step);
                container.scrollTop = y;
                if (drive === "synthetic") container.dispatchEvent(new Event("scroll"));
                await raf();
            }
        }
        await frames(3);

        const stats = grid.stats;
        return {
            drive,
            stepFraction: stepFraction === "range" ? "range/30" : Number(stepFraction.toFixed(4)),
            scrollEvents,
            paintsObserved: sameFrame + late,
            paintsSameFrameAsScroll: sameFrame,
            paintsLate: late,
            latePct: Math.round((late / Math.max(1, sameFrame + late)) * 100),
            paints: stats.paints,
            avgPaintMs: stats.paints ? Number((stats.totalPaintMs / stats.paints).toFixed(3)) : 0,
        };
    } finally {
        running = false;
        container.removeEventListener("scroll", onScroll);
        built.destroy();
    }
}

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

/** The benchmark's own 100,000-row grid, probed in place — no scratch grid, no teardown. */
async function onBench(options = {}) {
    const grid = window.bench?.grid;
    if (!grid) return { error: "window.bench.grid is not up yet" };
    const before = grid.container.scrollTop;
    try {
        return await probe({ ...options, grid });
    } finally {
        grid.container.scrollTop = before;
    }
}

/**
 * The three per-frame distances the finding was reported at, against two overscan settings, plus
 * the lag accounting that says whether an eager paint can help at all.
 */
async function all({ frameCount = 60 } = {}) {
    const out = { probe: [], lag: [] };
    for (const overscanRow of [4, 20]) {
        for (const stepFraction of [1 / 16, 1 / 4, "range"]) {
            out.probe.push(await probe({ stepFraction, overscanRow, frameCount }));
            await frames(2);
        }
    }
    out.probe.push(await probe({ stepFraction: 1 / 4, drive: "smooth", frameCount }));
    out.probe.push(await probe({ stepFraction: 1 / 4, drive: "synthetic", frameCount }));

    for (const drive of ["raw", "smooth", "synthetic"]) {
        out.lag.push(await lag({ drive, stepFraction: 1 / 4, frameCount }));
        await frames(2);
    }
    return out;
}

window.blank = { all, probe, lag, onBench, makeGrid, sample };
