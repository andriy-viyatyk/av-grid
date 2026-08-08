/**
 * AVGrid board — the grid layer, in a real browser.
 *
 * `RenderGridTest` benchmarks the engine with a trivial cell renderer. This board runs the
 * *whole* grid: `AVGrid.create()`, inferred columns, header sorting, column resize and
 * reorder, custom renderers, and the injected stylesheet. It is where "does it actually look
 * like a grid" gets answered, because happy-dom does no layout and a green test suite can sit
 * on top of a blank box.
 *
 * Everything is on `window.avg`, so a whole session runs through browser_evaluate with no
 * clicking.
 */

import { AVGrid } from "./lib/av-grid.js";

const el = (id) => document.getElementById(id);
const statusEl = el("status");
const liveEl = el("live");
const resultsEl = el("results");

/** @type {AVGrid | undefined} */
let grid;
let rows = [];

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const FIRST = ["Ada", "Alan", "Grace", "Edsger", "Barbara", "Donald", "Ken", "Tony"];
const LAST = ["Lovelace", "Turing", "Hopper", "Dijkstra", "Liskov", "Knuth", "Thompson", "Hoare"];
const TEAMS = ["platform", "infra", "data", "growth", "research"];
const STATUS = ["open", "closed", "pending", "archived", "draft"];

/** Objects, not arrays — this board exercises the path a host actually writes. */
function buildRows(count) {
    const startedAt = performance.now();
    const out = new Array(count);
    const epoch = Date.UTC(2020, 0, 1);

    for (let i = 0; i < count; i++) {
        out[i] = {
            id: i + 1,
            firstName: FIRST[i % FIRST.length],
            lastName: LAST[(i * 3) % LAST.length],
            team: TEAMS[i % TEAMS.length],
            status: STATUS[(i * 7) % STATUS.length],
            score: ((i * 7919) % 100000) / 100,
            active: i % 3 !== 0,
            joined: new Date(epoch + i * 3_600_000),
        };
    }

    return { rows: out, ms: performance.now() - startedAt };
}

// ---------------------------------------------------------------------------
// The grid
// ---------------------------------------------------------------------------

/** Explicit columns, exercising every column feature the grid layer has so far. */
function columns() {
    return [
        { key: "id", name: "#", width: 70, align: "right", resizable: false },
        { key: "firstName", name: "First Name", width: 120 },
        { key: "lastName", name: "Last Name", width: 140 },
        { key: "team", name: "Team", width: 110 },
        {
            key: "full",
            name: "Full Name",
            width: 200,
            // A computed column: no `full` property exists on any row.
            render: (c) => `${c.row.firstName} ${c.row.lastName}`,
        },
        {
            key: "status",
            name: "Status",
            width: 110,
            // An element renderer, to prove both return shapes work.
            render: (c) => {
                const span = document.createElement("span");
                span.textContent = c.value;
                span.style.opacity = c.value === "archived" ? "0.5" : "1";
                return span;
            },
        },
        { key: "score", name: "Score", width: 100 },
        { key: "active", name: "Active", width: 80, dataType: "boolean" },
        { key: "joined", name: "Joined", width: 170, displayFormat: "dateTime" },
    ];
}

function createGrid(count = Number(el("rows").value) || 1000, useColumns = true) {
    grid?.destroy();
    const host = el("grid-host");
    host.textContent = "";

    const built = buildRows(count);
    rows = built.rows;

    const startedAt = performance.now();
    grid = AVGrid.create(host, {
        rows,
        columns: useColumns ? columns() : undefined,
        name: "avgrid-board",
        onCellClass: (c) => (c.row.status === "closed" ? "flagged" : undefined),
        onSortChange: (sort) =>
            live(`sort: ${sort ? `${sort.key} ${sort.direction}` : "none"}`),
        onCellClick: (c) => live(`click: ${c.column.key} = ${String(c.value)}`),
        onColumnResize: (key, width) => live(`resize: ${key} → ${width}px`),
        onColumnsReorder: (from, to) => live(`reorder: ${from} → ${to}`),
    });
    const firstPaintMs = performance.now() - startedAt;

    window.avg.grid = grid;
    status(
        `${count.toLocaleString()} rows · generated in ${built.ms.toFixed(1)}ms · ` +
            `first paint ${firstPaintMs.toFixed(1)}ms`,
    );

    return { firstPaintMs, generateMs: built.ms };
}

/** The rule-4 call from goal.md: rows and nothing else. */
function minimalGrid() {
    grid?.destroy();
    const host = el("grid-host");
    host.textContent = "";

    grid = AVGrid.create(host, { rows: buildRows(200).rows });
    window.avg.grid = grid;
    status("minimum call — columns, labels, widths and row keys all inferred");
    return grid.getState();
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

const nextFrame = () => new Promise((r) => requestAnimationFrame(r));

async function settle(frames = 3) {
    for (let i = 0; i < frames; i++) await nextFrame();
}

function scrollEl() {
    return grid.element.querySelector('[data-type="render-grid-scroll"]');
}

async function scrollTo(y) {
    scrollEl().scrollTop = y;
    await settle();
}

/**
 * Average paint cost over `steps` one-row scrolls starting at `y`. Counts only paints that
 * did work — the engine skips the rest.
 *
 * 300 steps, not 40: a paint costs well under a millisecond, so a 40-step sample is dominated
 * by timer noise and the top-to-bottom ratio swings between 0.99× and 1.31× run to run. At
 * 300 it settles to within a percent or two, which is the number worth recording.
 */
async function measurePaintCost(y, steps = 300) {
    const rowHeight = grid.getState().rowHeight;
    await scrollTo(y);
    grid.render.resetStats();

    for (let i = 0; i < steps; i++) {
        scrollEl().scrollTop = y + i * rowHeight;
        await nextFrame();
    }

    const { paints, totalPaintMs } = grid.render.stats;
    return { paints, avgMs: paints ? totalPaintMs / paints : 0 };
}

/** Scripted scroll for `ms`, timing rAF boundaries. Percentiles, because an average hides stutter. */
async function measureScrollFps(startY, ms = 2000, pxPerFrame = 40) {
    await scrollTo(startY);
    const frames = [];
    let last = performance.now();
    const until = last + ms;

    while (performance.now() < until) {
        scrollEl().scrollTop += pxPerFrame;
        await nextFrame();
        const now = performance.now();
        frames.push(now - last);
        last = now;
    }

    frames.sort((a, b) => a - b);
    const at = (p) => frames[Math.min(frames.length - 1, Math.floor(frames.length * p))];
    const mean = frames.reduce((a, b) => a + b, 0) / frames.length;

    return {
        fps: 1000 / mean,
        medianMs: at(0.5),
        p95Ms: at(0.95),
        worstMs: frames[frames.length - 1],
    };
}

/** A full repaint — the path sorting, filtering and setRows all take. */
async function measureFullRepaint() {
    // Settle generously first: cells that scrolled out during the previous phase are still
    // attached until the next paint, and counting their removal here would read as though the
    // repaint had replaced them.
    await settle(6);
    grid.render.resetStats();
    grid.refresh();
    await settle();
    const s = grid.render.stats;
    return {
        ms: s.lastPaintMs,
        mutations: s.cellsAppended + s.cellsRemoved,
    };
}

async function measureSort() {
    await settle();
    const startedAt = performance.now();
    grid.setSort({ key: "score", direction: "asc" });
    const modelMs = performance.now() - startedAt;
    await settle();
    grid.setSort(undefined);
    await settle();
    return { modelMs };
}

/**
 * The task-5 gate, re-run through the whole grid rather than through the engine alone. The
 * numbers must land within noise of `tasks/benchmark-results.md`.
 */
async function runBenchmark(count = 100000) {
    status("building 100k rows…");
    el("rows").value = String(count);
    const { firstPaintMs, generateMs } = createGrid(count);
    await settle(5);

    status("measuring paint cost near the top…");
    const top = await measurePaintCost(2000);

    status("measuring paint cost near the bottom…");
    const bottomY = (count - 1000) * grid.getState().rowHeight;
    const bottom = await measurePaintCost(bottomY);

    status("measuring scroll fps at the top…");
    const fpsTop = await measureScrollFps(0);

    status("measuring scroll fps near the bottom…");
    const fpsBottom = await measureScrollFps(bottomY);

    status("measuring a full repaint…");
    await scrollTo(2000);
    await settle(6);
    const repaint = await measureFullRepaint();

    status("measuring a sort of 100k rows…");
    const sort = await measureSort();

    const results = {
        rows: count,
        generateMs,
        firstPaintMs,
        paintTopMs: top.avgMs,
        paintBottomMs: bottom.avgMs,
        flatRatio: top.avgMs ? bottom.avgMs / top.avgMs : 0,
        fpsTop,
        fpsBottom,
        fullRepaint: repaint,
        sortMs: sort.modelMs,
    };

    window.avg.lastResults = results;
    renderResults(results);
    status("benchmark complete");
    return results;
}

// ---------------------------------------------------------------------------
// Readout
// ---------------------------------------------------------------------------

function renderResults(r) {
    const row = (label, value, note = "") =>
        `<tr><td>${label}</td><td class="num">${value}</td><td>${note}</td></tr>`;

    resultsEl.innerHTML = `<table><tbody>
        ${row("Rows", r.rows.toLocaleString())}
        ${row("Data generation", `${r.generateMs.toFixed(1)} ms`)}
        ${row("Time to first paint", `${r.firstPaintMs.toFixed(1)} ms`, "gate: &lt; 100 ms")}
        ${row("Paint cost at row 100", `${r.paintTopMs.toFixed(3)} ms`)}
        ${row("Paint cost near the bottom", `${r.paintBottomMs.toFixed(3)} ms`)}
        ${row("Flat-cost ratio", `${r.flatRatio.toFixed(2)}×`, "gate: ≈ 1.0")}
        ${row(
            "Scroll from the top",
            `${r.fpsTop.fps.toFixed(1)} fps`,
            `median ${r.fpsTop.medianMs.toFixed(1)} ms · p95 ${r.fpsTop.p95Ms.toFixed(1)} ms`,
        )}
        ${row(
            "Scroll near the bottom",
            `${r.fpsBottom.fps.toFixed(1)} fps`,
            `median ${r.fpsBottom.medianMs.toFixed(1)} ms · p95 ${r.fpsBottom.p95Ms.toFixed(1)} ms`,
        )}
        ${row(
            "Full repaint",
            `${r.fullRepaint.ms.toFixed(3)} ms`,
            `${r.fullRepaint.mutations} DOM mutations`,
        )}
        ${row("Sort 100k rows (model)", `${r.sortMs.toFixed(1)} ms`)}
    </tbody></table>`;
    resultsEl.hidden = false;
}

function status(text) {
    statusEl.textContent = text;
}

function live(text) {
    liveEl.textContent = text;
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

el("rebuild").addEventListener("click", () => createGrid());
el("bench").addEventListener("click", () => runBenchmark());
el("minimal").addEventListener("click", () => minimalGrid());
el("search").addEventListener("input", (e) => grid?.setSearchString(e.target.value));

window.avg = {
    AVGrid,
    createGrid,
    minimalGrid,
    runBenchmark,
    measurePaintCost,
    measureScrollFps,
    measureFullRepaint,
    measureSort,
    scrollTo,
    settle,
    get grid() {
        return grid;
    },
    set grid(g) {
        grid = g;
    },
    get rows() {
        return rows;
    },
};

createGrid();
