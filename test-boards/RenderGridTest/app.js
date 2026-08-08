/**
 * av-grid RenderGrid benchmark harness.
 *
 * Drives the virtualization engine against a 100,000-row dataset and reports the four numbers
 * task 5 of tasks/plan.md gates on: time to first paint, sustained scroll FPS, paint cost near
 * the top, and paint cost near the bottom. The last two existing to prove the flat-cost
 * property — dragging or scrolling at row 99,000 must cost what it costs at row 100.
 *
 * Everything is also reachable from `window.bench` so an agent can drive it with
 * browser_evaluate instead of clicking.
 */

import { RenderGrid } from "./lib/av-grid.js";

const el = (id) => document.getElementById(id);
const statusEl = el("status");
const liveEl = el("live");
const resultsEl = el("results");

/** @type {import("./lib/av-grid.js").RenderGrid | undefined} */
let grid;
let rows = [];
let columns = [];
let lastResults = null;

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const WORDS = [
    "alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel",
    "india", "juliet", "kilo", "lima", "mike", "november", "oscar", "papa",
    "quebec", "romeo", "sierra", "tango", "uniform", "victor", "whiskey",
    "xray", "yankee", "zulu",
];
const STATUSES = ["open", "closed", "pending", "archived", "draft"];

/**
 * Build a realistic dataset: one array per row, mixed value types, strings drawn from a small
 * interned pool so generation time and memory stay honest rather than dominating the run.
 */
function buildRows(rowCount, columnCount) {
    const startedAt = performance.now();
    const out = new Array(rowCount);

    for (let r = 0; r < rowCount; r++) {
        const row = new Array(columnCount);
        row[0] = r + 1;
        for (let c = 1; c < columnCount; c++) {
            switch (c % 4) {
                case 0:
                    row[c] = WORDS[(r + c) % WORDS.length];
                    break;
                case 1:
                    row[c] = ((r * 7919 + c * 104729) % 1000000) / 100;
                    break;
                case 2:
                    row[c] = STATUSES[(r + c) % STATUSES.length];
                    break;
                default:
                    row[c] = (r * 31 + c) % 100000;
            }
        }
        out[r] = row;
    }

    return { rows: out, ms: performance.now() - startedAt };
}

function buildColumns(columnCount) {
    const out = new Array(columnCount);
    out[0] = { name: "#", width: 80, numeric: true };
    for (let c = 1; c < columnCount; c++) {
        out[c] = {
            name: `Column ${c}`,
            width: c % 3 === 0 ? 160 : 120,
            numeric: c % 4 === 1 || c % 4 === 3,
        };
    }
    return out;
}

// ---------------------------------------------------------------------------
// Cell rendering
// ---------------------------------------------------------------------------

/**
 * Produce one cell, reusing a scrolled-out element whenever the pool has one.
 *
 * This is the shape task 9's DataCell has to keep: recycle first, then overwrite every
 * property the previous occupant may have set — the pool deliberately hands elements back
 * dirty. Text goes through the existing text node rather than `textContent`, which would
 * allocate a fresh one on every cell every frame.
 */
function renderCell(p) {
    // previous first: re-rendering a dirty cell in place costs no DOM insertion at all, and
    // keeps whatever lives on the element. recycle() only for cells that just scrolled in.
    const el = p.previous ?? p.recycle?.() ?? document.createElement("div");
    const column = columns[p.col];

    // Row 0 is the sticky header; data rows are offset by one.
    const isHeader = p.row === 0;
    const dataRow = p.row - 1;

    let text;
    let cls = "avg-cell";
    if (isHeader) {
        text = column.name;
        cls += " header";
    } else {
        const row = rows[dataRow];
        const value = row ? row[p.col] : "";
        text = typeof value === "number" ? String(value) : value;
        if (column.numeric) cls += " num";
        if (dataRow % 2 === 1) cls += " odd";
    }

    if (el.className !== cls) el.className = cls;

    const style = el.style;
    style.left = `${p.style.left}px`;
    style.top = `${p.style.top}px`;
    style.width = `${p.style.width}px`;
    style.height = `${p.style.height}px`;

    if (el.firstChild) {
        if (el.firstChild.nodeValue !== text) el.firstChild.nodeValue = text;
    } else {
        el.appendChild(document.createTextNode(text));
    }

    el.setAttribute("data-row", String(p.row));
    el.setAttribute("data-col", String(p.col));
    return el;
}

// ---------------------------------------------------------------------------
// Grid lifecycle
// ---------------------------------------------------------------------------

function createGrid() {
    const rowCount = Math.max(1, Number(el("rows").value) || 1);
    const columnCount = Math.max(1, Number(el("cols").value) || 1);

    grid?.destroy();
    const host = el("grid-host");
    host.innerHTML = "";

    columns = buildColumns(columnCount);
    const built = buildRows(rowCount, columnCount);
    rows = built.rows;

    const startedAt = performance.now();
    grid = new RenderGrid(host, {
        name: "benchmark",
        // +1 for the sticky header row.
        rowCount: () => rows.length + 1,
        columnCount: () => columns.length,
        rowHeight: 24,
        columnWidth: (i) => columns[i].width,
        renderCell,
        stickyTop: 1,
        stickyLeft: 1,
        overscanRow: 4,
        overscanColumn: 1,
        growToHeight: "100%",
    });
    const firstPaintMs = performance.now() - startedAt;

    window.grid = grid;
    setStatus(
        `${rowCount.toLocaleString()} rows x ${columnCount} cols - ` +
            `data ${built.ms.toFixed(0)}ms, first paint ${firstPaintMs.toFixed(1)}ms`,
    );

    return { rowCount, columnCount, dataMs: built.ms, firstPaintMs };
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

const raf = () => new Promise((resolve) => requestAnimationFrame(resolve));

/** Let the engine settle: scrolling is async through microtask -> rAF. */
async function settle(frames = 3) {
    for (let i = 0; i < frames; i++) await raf();
}

async function scrollTo(y) {
    grid.container.scrollTop = y;
    await settle(2);
}

/**
 * Scroll one row at a time from `startY` and report the average cost of the paints that
 * actually did work. Paints that the engine skipped (nothing changed) are excluded, so this
 * measures the real per-frame cost rather than being diluted by free frames.
 */
async function measurePaintCost(startY, steps = 40, rowHeight = 24) {
    await scrollTo(startY);
    await settle(4);

    grid.resetStats();

    for (let i = 1; i <= steps; i++) {
        grid.container.scrollTop = startY + i * rowHeight;
        grid.container.dispatchEvent(new Event("scroll"));
        await raf();
        await raf();
    }

    const s = grid.stats;
    return {
        paints: s.paints,
        avgPaintMs: s.paints ? s.totalPaintMs / s.paints : 0,
        cellsAppended: s.cellsAppended,
        poolHits: s.pool.hits,
        poolMisses: s.pool.misses,
    };
}

/**
 * Scripted continuous scroll: advance a fixed distance every frame for `durationMs` and time
 * every frame boundary. Reports the frame rate actually achieved and the worst frame seen.
 */
async function measureScrollFps(startY, durationMs = 2000, pxPerFrame = 60) {
    await scrollTo(startY);
    await settle(4);

    grid.resetStats();

    const frames = [];
    let y = startY;
    let last = performance.now();
    const endAt = last + durationMs;

    while (performance.now() < endAt) {
        y += pxPerFrame;
        grid.container.scrollTop = y;
        grid.container.dispatchEvent(new Event("scroll"));
        await raf();
        const now = performance.now();
        frames.push(now - last);
        last = now;
    }

    frames.sort((a, b) => a - b);
    const total = frames.reduce((a, b) => a + b, 0);
    const p = (q) => frames[Math.min(frames.length - 1, Math.floor(frames.length * q))] ?? 0;

    return {
        frames: frames.length,
        fps: frames.length / (total / 1000),
        medianFrameMs: p(0.5),
        p95FrameMs: p(0.95),
        worstFrameMs: frames[frames.length - 1] ?? 0,
        avgPaintMs: grid.stats.paints ? grid.stats.totalPaintMs / grid.stats.paints : 0,
        poolMisses: grid.stats.pool.misses,
    };
}

/** The full gate: the four numbers task 5 stops on. */
async function runBenchmark() {
    setBusy(true);
    try {
        setStatus("rebuilding…");
        const build = createGrid();
        await settle(5);

        const rowHeight = 24;
        const maxY = grid.model.renderInfo.current.innerSize.height - grid.root.offsetHeight;
        const nearBottomY = Math.max(0, Math.min(maxY, 99_000 * rowHeight));

        setStatus("measuring paint cost near the top…");
        const top = await measurePaintCost(100 * rowHeight, 40, rowHeight);

        setStatus("measuring paint cost near row 99,000…");
        const bottom = await measurePaintCost(nearBottomY, 40, rowHeight);

        setStatus("measuring scroll fps…");
        const fps = await measureScrollFps(0, 2000, 60);

        setStatus("measuring scroll fps near the bottom…");
        const fpsBottom = await measureScrollFps(nearBottomY, 2000, 60);

        const ratio = top.avgPaintMs > 0 ? bottom.avgPaintMs / top.avgPaintMs : 0;

        lastResults = { build, top, bottom, fps, fpsBottom, ratio };
        renderResults(lastResults);
        setStatus("done");
        return lastResults;
    } finally {
        setBusy(false);
    }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function setStatus(text) {
    statusEl.textContent = text;
}

function setBusy(busy) {
    for (const id of ["rebuild", "run", "clear"]) el(id).disabled = busy;
}

const ms = (n) => `${n.toFixed(2)} ms`;

function renderResults(r) {
    const flat = r.ratio > 0 && r.ratio < 1.5;
    const smooth = r.fps.fps > 55 && r.fpsBottom.fps > 55;

    const rowsHtml = [
        ["Dataset", `${r.build.rowCount.toLocaleString()} rows x ${r.build.columnCount} columns`],
        ["Data generation", ms(r.build.dataMs)],
        ["Time to first paint", ms(r.build.firstPaintMs)],
        ["&nbsp;", ""],
        ["Paint cost at row 100", `${ms(r.top.avgPaintMs)} over ${r.top.paints} paints`],
        ["Paint cost at row 99,000", `${ms(r.bottom.avgPaintMs)} over ${r.bottom.paints} paints`],
        [
            "Flat-cost ratio (bottom / top)",
            `<span class="${flat ? "verdict-pass" : "verdict-fail"}">${r.ratio.toFixed(2)}x ` +
                `${flat ? "PASS" : "FAIL"}</span>`,
        ],
        ["&nbsp;", ""],
        [
            "Scroll from the top",
            `${r.fps.fps.toFixed(1)} fps - median ${ms(r.fps.medianFrameMs)}, ` +
                `p95 ${ms(r.fps.p95FrameMs)}, worst ${ms(r.fps.worstFrameMs)}`,
        ],
        [
            "Scroll near row 99,000",
            `${r.fpsBottom.fps.toFixed(1)} fps - median ${ms(r.fpsBottom.medianFrameMs)}, ` +
                `p95 ${ms(r.fpsBottom.p95FrameMs)}, worst ${ms(r.fpsBottom.worstFrameMs)}`,
        ],
        [
            "Sustained 60fps",
            `<span class="${smooth ? "verdict-pass" : "verdict-fail"}">` +
                `${smooth ? "PASS" : "FAIL"}</span>`,
        ],
        ["&nbsp;", ""],
        [
            "Cell allocations while scrolling",
            `${r.fps.poolMisses} misses (0 means the pool served every cell)`,
        ],
        ["Pool reuse near the bottom", `${r.bottom.poolHits} hits / ${r.bottom.poolMisses} misses`],
    ];

    resultsEl.innerHTML =
        "<table><tbody>" +
        rowsHtml
            .map(([k, v]) => `<tr><th>${k}</th><td class="num">${v}</td></tr>`)
            .join("") +
        "</tbody></table>";
    resultsEl.hidden = false;
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

el("rebuild").addEventListener("click", () => {
    setBusy(true);
    try {
        createGrid();
    } finally {
        setBusy(false);
    }
});

el("run").addEventListener("click", () => {
    runBenchmark().catch((err) => {
        setStatus(`failed: ${err.message}`);
        console.error(err);
        persephone?.notify?.(String(err), "error");
    });
});

el("clear").addEventListener("click", () => {
    resultsEl.hidden = true;
    resultsEl.innerHTML = "";
});

// A live readout of what the engine is doing, so the grid can be eyeballed while scrolling.
setInterval(() => {
    if (!grid) return;
    const s = grid.stats;
    const v = grid.model.renderInfo.current.visible;
    liveEl.textContent =
        `rows ${v.top}-${v.bottom} | paints ${s.paints} | last ${s.lastPaintMs.toFixed(2)}ms | ` +
        `pool ${grid.pool.size} (${s.pool.hits} hits / ${s.pool.misses} misses)`;
}, 250);

/** The agent-facing surface: everything the benchmark can do, without clicking. */
window.bench = {
    createGrid,
    runBenchmark,
    measurePaintCost,
    measureScrollFps,
    scrollTo,
    settle,
    get grid() {
        return grid;
    },
    get results() {
        return lastResults;
    },
};

createGrid();
