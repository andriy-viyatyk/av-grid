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
        selectColumn: true,
        onSelectionChange: (keys) => live(`selected: ${keys.length} rows`),
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
    // Warm up first, then settle generously. Cells that scrolled out during a previous phase
    // stay attached until the next *full* recompute trims them — settling alone does not do
    // it, because nothing has asked for a recompute. Counting their removal here reads as
    // though the repaint had replaced them, which is where a spurious "36 DOM mutations"
    // (4 overscan rows × 9 columns) comes from.
    grid.refresh();
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

/**
 * The task-10 gate: dragging a range selection near row 99,000 must cost what it costs near
 * row 100.
 *
 * The selection is anchored at row 0 before the drag starts, so at row 99,000 the *live*
 * selection covers 99,000 rows against 100 at the top. That asymmetry is the whole point: the
 * reference marks both the old and the new rectangle dirty on every pointer move, unclipped,
 * so its cost per move is the size of the selection and this measurement would come back
 * roughly 990× worse at the bottom. Here the dirty set is clipped to the rendered window, so
 * both ends should report the same handful of cells per move.
 *
 * Returns wall time, paint stats, and — the number the plan actually asks for — the *dirty
 * cells per move*, read by instrumenting `update()` rather than by looking at the screen.
 */
async function measureRangeDrag(row, steps = 200) {
    const rowHeight = grid.getState().rowHeight;
    await scrollTo(Math.max(0, (row - 5) * rowHeight));

    // The first *data* column, which is not column 0 once the checkbox column is on: a
    // pointerdown on a status column is deliberately inert, so dragging from one measures
    // nothing at all — it silently reported 0 dirty cells per move until this was fixed.
    const col = grid.model.data.columns.findIndex((c) => !c.isStatusColumn);

    grid.selectRange(0, col, row, col);
    await settle(3);

    const cellAt = (dataRow) =>
        grid.element.querySelector(
            `[data-type="data-cell"][data-row="${dataRow}"][data-col="${col}"]`,
        );

    const a = cellAt(row);
    const b = cellAt(row + 1);
    if (!a || !b) throw new Error(`rows ${row}/${row + 1} are not on screen`);

    // Real client coordinates, because the drag resolves its target by hit-testing the point
    // — dispatching moves at (0, 0) would land outside the grid and trip the auto-scroll.
    const centre = (el) => {
        const r = el.getBoundingClientRect();
        return { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    };
    const at = [centre(b), centre(a)];

    // Shift, so the press extends the existing selection instead of re-anchoring it.
    a.dispatchEvent(
        new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            shiftKey: true,
            pointerId: 1,
            ...at[1],
        }),
    );

    // Count what each move marks dirty. `all: true` would be a failure, so it is recorded as
    // Infinity rather than quietly averaged away.
    const model = grid.render.model;
    const originalUpdate = model.update;
    let dirtyCells = 0;
    model.update = (info) => {
        if (info && info.all) dirtyCells = Infinity;
        else dirtyCells += (info && info.cells ? info.cells.length : 0);
        return originalUpdate(info);
    };

    const move = (i) =>
        window.dispatchEvent(
            new PointerEvent("pointermove", {
                bubbles: true,
                pointerId: 1,
                ...at[i % 2],
            }),
        );

    // Two loops, because one number cannot answer both halves of the question.
    //
    // 1. A *tight* loop with no frame wait, timing the model work alone — dispatch, the focus
    //    update, and building the dirty set. This is where a cost proportional to the
    //    selection would show up, so this is the number the gate rests on. Do not "fix" it by
    //    awaiting a frame per move: at 60Hz every move then costs 16.7 ms of waiting, the real
    //    work disappears under the display cadence, and the ratio comes back 1.00 whatever the
    //    implementation does.
    //
    //    Ten times as many iterations as the paced loop, for the same reason `measurePaintCost`
    //    samples 300 and not 40: a move costs ~15 microseconds, so 200 of them total 3 ms and
    //    the ratio swings on timer quantization alone.
    const modelSteps = steps * 10;
    const modelStartedAt = performance.now();
    for (let i = 0; i < modelSteps; i++) move(i);
    const modelMsPerMove = (performance.now() - modelStartedAt) / modelSteps;

    // 2. A frame-paced loop, for what each move costs to actually paint.
    await settle(3);
    grid.render.resetStats();
    dirtyCells = 0;
    for (let i = 0; i < steps; i++) {
        move(i);
        await nextFrame();
    }

    model.update = originalUpdate;
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));

    const s = grid.render.stats;
    return {
        row,
        steps,
        selectionRows: row + 1,
        modelMsPerMove,
        dirtyCellsPerMove: dirtyCells / steps,
        paints: s.paints,
        avgPaintMs: s.paints ? s.totalPaintMs / s.paints : 0,
        mutations: s.cellsAppended + s.cellsRemoved,
    };
}

/**
 * The task-11 gate: select-all on 100k rows must not stall.
 *
 * Two costs, because they fail differently. The *model* cost is one O(rows) pass to build the
 * key set plus one to answer "is everything selected" — unavoidable, and the thing that would
 * stall if it were accidentally quadratic. The *dirty set* is what a naive implementation gets
 * wrong instead: marking 100,000 rows dirty is correct and useless, because only two dozen are
 * on screen. That number must be a function of the viewport.
 */
async function measureSelectAll() {
    grid.clearSelected();
    // Same warm-up as `measureFullRepaint`, for the same reason: cells that scrolled out
    // during an earlier phase stay attached until the next full *recompute* trims them, and
    // settling alone never asks for one. Without this their removal is counted here.
    grid.refresh();
    await settle(4);

    const model = grid.render.model;
    const originalUpdate = model.update;
    let dirtyRows = 0;
    model.update = (info) => {
        if (!info || info.all) dirtyRows = Infinity;
        else dirtyRows += (info.rows?.length ?? 0) + (info.cells?.length ?? 0);
        return originalUpdate.call(model, info);
    };

    grid.render.resetStats();
    const startedAt = performance.now();
    grid.selectAll();
    const selectAllMs = performance.now() - startedAt;

    await settle(3);
    const afterSelect = grid.render.stats;
    const selectPaints = afterSelect.paints;
    const selectMutations = afterSelect.cellsAppended + afterSelect.cellsRemoved;

    const selectedCount = grid.getState().selectedCount;
    const clearDirtyBefore = dirtyRows;
    const clearStartedAt = performance.now();
    grid.clearSelected();
    const clearMs = performance.now() - clearStartedAt;
    await settle(3);

    model.update = originalUpdate;

    return {
        selectAllMs,
        clearMs,
        selectedCount,
        dirtyRowsOnSelectAll: clearDirtyBefore,
        dirtyRowsOnClear: dirtyRows - clearDirtyBefore,
        paints: selectPaints,
        mutations: selectMutations,
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

    status("measuring a range drag near the top…");
    const dragTop = await measureRangeDrag(100);

    status("measuring a range drag near row 99,000…");
    const dragBottom = await measureRangeDrag(count - 1000);

    status("measuring select-all on 100k rows…");
    const selectAll = await measureSelectAll();

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
        dragTop,
        dragBottom,
        dragRatio: dragTop.modelMsPerMove
            ? dragBottom.modelMsPerMove / dragTop.modelMsPerMove
            : 0,
        selectAll,
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
        ${row(
            "Range drag at row 100",
            `${r.dragTop.modelMsPerMove.toFixed(4)} ms/move`,
            `${r.dragTop.dirtyCellsPerMove.toFixed(1)} cells marked · selection ${r.dragTop.selectionRows.toLocaleString()} rows`,
        )}
        ${row(
            "Range drag near the bottom",
            `${r.dragBottom.modelMsPerMove.toFixed(4)} ms/move`,
            `${r.dragBottom.dirtyCellsPerMove.toFixed(1)} cells marked · selection ${r.dragBottom.selectionRows.toLocaleString()} rows`,
        )}
        ${row("Range-drag ratio", `${r.dragRatio.toFixed(2)}×`, "gate: ≈ 1.0")}
        ${row(
            "Select all 100k rows",
            `${r.selectAll.selectAllMs.toFixed(1)} ms`,
            `${r.selectAll.dirtyRowsOnSelectAll} rows marked · ${r.selectAll.mutations} DOM mutations`,
        )}
        ${row(
            "Clear the selection",
            `${r.selectAll.clearMs.toFixed(1)} ms`,
            `${r.selectAll.dirtyRowsOnClear} rows marked`,
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
    measureRangeDrag,
    measureSelectAll,
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
