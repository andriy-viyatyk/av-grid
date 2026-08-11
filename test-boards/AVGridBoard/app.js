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

// `filterRows` on its own, because task 23's row-loop measurement times the filter pass without
// a grid in the way — a paint would swamp it and a frame cannot be awaited in a hidden webview.
import { AVGrid, Popover, VirtualList, filterRows } from "./lib/av-grid.js";

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

/**
 * Task 26. A priority order the values do not have on their own — alphabetically `archived` comes
 * first and `open` fourth, which is the wrong answer to "sort by status" in every board that has
 * one. The `Status` column carries this as its `sortValue`.
 */
const STATUS_RANK = { open: 0, pending: 1, draft: 2, closed: 3, archived: 4 };

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

    lastRowId = count;
    return { rows: out, ms: performance.now() - startedAt };
}

/** Highest `id` handed out, so `newRow` can keep going from there. */
let lastRowId = 0;

/** How many times the `joined` column's date editor was built and torn down. */
const editorStats = { built: 0, destroyed: 0 };

/** A `Date` as `<input type="date">` wants it: yyyy-mm-dd, in local time. */
function toDateInput(value) {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** How many times the Score column's range filter body was built and torn down. */
const filterStats = { built: 0, destroyed: 0 };

/**
 * Task 23. A filter type of the host's own: a numeric range, on `Score`.
 *
 * Written the way the docs tell a host to write one — the bounds are parsed **once**, in
 * `getValue`, so `match` is two comparisons against numbers rather than a `Number()` call per
 * row. `measureCustomFilter` is what holds that claim to a number.
 */
const scoreRangeFilter = {
    name: "numberRange",
    create: (ctx) => {
        const el = document.createElement("div");
        el.className = "range-filter";
        const applied = ctx.value ?? {};
        const field = (which, placeholder, value) => {
            const label = document.createElement("label");
            const input = document.createElement("input");
            input.type = "number";
            input.placeholder = placeholder;
            input.value = value ?? "";
            input.setAttribute(`data-${which}`, "");
            label.append(document.createTextNode(placeholder), input);
            // Enter applies, which is what `ctx.apply` exists for — the grid's Apply button is
            // still there and does exactly the same thing.
            input.addEventListener("keydown", (e) => {
                if (e.key === "Enter") ctx.apply(read());
            });
            return { label, input };
        };
        const from = field("min", "min", applied.min);
        const to = field("max", "max", applied.max);
        el.append(from.label, to.label);

        const read = () => {
            const min = from.input.value === "" ? undefined : Number(from.input.value);
            const max = to.input.value === "" ? undefined : Number(to.input.value);
            if (min === undefined && max === undefined) return undefined;
            // Both forms in the value: the readable one for the chip and persistence, and the
            // resolved bounds `match` compares against. Parsed here, once per apply.
            return {
                min,
                max,
                lo: min === undefined ? -Infinity : min,
                hi: max === undefined ? Infinity : max,
            };
        };

        filterStats.built++;
        return {
            element: el,
            getValue: read,
            focus: () => from.input.focus(),
            destroy: () => filterStats.destroyed++,
        };
    },
    label: (value) => `${value.min ?? "…"} – ${value.max ?? "…"}`,
    match: (value, row) => row.score >= value.lo && row.score <= value.hi,
    // `Infinity` does not survive `JSON.stringify`, so the bounds are rebuilt from the two
    // numbers that do rather than trusted from storage.
    serialize: (value) => ({ min: value.min, max: value.max }),
    deserialize: (stored) => ({
        ...stored,
        lo: stored?.min ?? -Infinity,
        hi: stored?.max ?? Infinity,
    }),
};

// ---------------------------------------------------------------------------
// The grid
// ---------------------------------------------------------------------------

/** One to five stars from a 0–1000 score. The `rating` column's only source of truth. */
const stars = (row) => Math.min(5, Math.max(1, Math.round(row.score / 200)));

/** Explicit columns, exercising every column feature the grid layer has so far. */
function columns() {
    return [
        { key: "id", name: "#", width: 70, align: "right", resizable: false, readonly: true },
        { key: "firstName", name: "First Name", width: 120 },
        { key: "lastName", name: "Last Name", width: 140 },
        { key: "team", name: "Team", width: 110 },
        {
            key: "full",
            name: "Full Name",
            width: 200,
            // Computed from two other columns, so there is nothing an edit could write to.
            readonly: true,
            // A computed column: no `full` property exists on any row.
            render: (c) => `${c.row.firstName} ${c.row.lastName}`,
            // And the plain-text form of the same thing, which is what makes the column
            // searchable and filterable. `render` is deliberately not called by the row
            // filter — it may build an element, and it would run 100,000 times a keystroke.
            formatValue: (_col, row) => `${row.firstName} ${row.lastName}`,
        },
        {
            key: "status",
            name: "Status",
            width: 110,
            // `options` gives the cell a dropdown editor — and this column also has a custom
            // `render`, so it proves the display renderer and the editor coexist.
            options: STATUS,
            // Task 26. Sorted by priority rather than alphabetically, in one line and with no
            // comparator: whatever this returns is compared the way the grid compares numbers.
            sortValue: (row) => STATUS_RANK[row.status] ?? 9,
            // An element renderer, to prove both return shapes work.
            render: (c) => {
                const span = document.createElement("span");
                span.textContent = c.value;
                span.style.opacity = c.value === "archived" ? "0.5" : "1";
                return span;
            },
        },
        {
            key: "score",
            name: "Score",
            width: 100,
            dataType: "number",
            // Task 21. A per-column class, decided per cell — this is the hook a host reaches
            // for instead of writing `if (column.key === "score")` inside `onCellClass`.
            cellClass: (c) => (c.value < 250 ? "low-score" : undefined),
            // And the constant-string form, on the header.
            headerClass: "score-header",
            // Task 23. The funnel on this column opens a min/max panel instead of a checklist —
            // which is the right body for a column whose 100,000 values are nearly all distinct.
            filter: scoreRangeFilter,
        },
        {
            key: "rating",
            name: "Rating",
            width: 110,
            readonly: true,
            // Task 24. The case `copyValue` exists for: what the cell *shows* is five glyphs, and
            // what a spreadsheet wants is the number behind them. Without `copyValue` this column
            // copies "★★★☆☆", which sorts and sums as nothing.
            render: (c) => {
                const n = stars(c.row);
                return `<span class="stars">${"★".repeat(n)}${"☆".repeat(5 - n)}</span>`;
            },
            copyValue: (c) => stars(c.row),
        },
        { key: "active", name: "Active", width: 80, dataType: "boolean" },
        {
            key: "joined",
            name: "Joined",
            width: 170,
            displayFormat: "dateTime",
            // Task 22. A date picker in place of the text box, which is the whole point of the
            // hook: a Date typed into a text box is the worst way to enter a date. The three
            // lines that matter are `setValue` on input, `commit` on blur, and nothing at all
            // for Escape or Tab — the grid binds those on whatever element this returns.
            editor: (ctx) => {
                const input = document.createElement("input");
                input.type = "date";
                input.value = toDateInput(ctx.value);
                input.addEventListener("input", () => {
                    ctx.setValue(input.value ? new Date(`${input.value}T00:00:00`) : undefined);
                });
                input.addEventListener("blur", () => ctx.commit());
                editorStats.built++;
                // The `CellEditor` form, so `destroy` can be counted: a real one would use it to
                // close a panel it put on `document.body`.
                return { element: input, destroy: () => editorStats.destroyed++ };
            },
        },
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
        // Task 21. There is no row element, so this lands on each of the row's cells — which is
        // why the tint reaches the full width including the checkbox column.
        rowClass: (r) => (r.row.active ? undefined : "inactive"),
        onSortChange: (sort) =>
            live(`sort: ${sort ? `${sort.key} ${sort.direction}` : "none"}`),
        onCellClick: (c) => live(`click: ${c.column.key} = ${String(c.value)}`),
        onColumnResize: (key, width) => live(`resize: ${key} → ${width}px`),
        onColumnsReorder: (from, to) => live(`reorder: ${from} → ${to}`),
        selectColumn: true,
        onSelectionChange: (keys) => live(`selected: ${keys.length} rows`),
        // Task 17. Takes no space until something is filtered, so it costs the other checks
        // nothing to leave it on.
        filterBar: true,
        editable: true,
        // The grid writes the value itself; this is the notification. The `#` column is
        // readonly and `full` is computed, so both refuse to open.
        onEdit: (e) =>
            live(`edit: ${e.columnKey} ${JSON.stringify(e.previousValue)} → ${JSON.stringify(e.value)}`),
        onInvalidEdit: (e) => live(`rejected: ${JSON.stringify(e.value)} in ${e.column.key}`),
        // Task 14. `newRow` because the board's rows carry an `id` the grid cannot invent a
        // number for, and a `firstName`/`lastName` pair that `full` is derived from.
        canAddRows: true,
        canDeleteRows: true,
        canAddColumns: true,
        canDeleteColumns: true,
        addRowLabel: "add person",
        newRow: () => ({
            id: ++lastRowId,
            firstName: "",
            lastName: "",
            team: "",
            status: "open",
            active: false,
            score: 0,
            joined: new Date(),
        }),
        onAddRows: (e) => live(`add: ${e.rows.length} row(s) at ${e.index}`),
        onDeleteRows: (e) => live(`delete: ${e.rows.length} row(s)`),
        onAddColumns: (e) => live(`add column: ${e.columns.map((c) => c.key).join(", ")}`),
        onDeleteColumns: (e) => live(`delete column: ${e.columnKeys.join(", ")}`),
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
/**
 * Search-word highlighting: what it costs, and that all four shapes actually land.
 *
 * The cost half is a full repaint and a scripted scroll with a search active against the same
 * two with none — the marking runs inside the per-cell loop, so this is where it would show up.
 * The correctness half is the pool trap in its usual form: a mark has to be *gone* once the
 * search that made it is cleared, not merely un-asked-for, and a cell that stops matching has
 * to fall back to a plain text node. Counting `.avg-search-match` after each change is that
 * test, against real elements.
 */
async function measureHighlight(search = "a") {
    const marked = () =>
        [...grid.element.querySelectorAll('[data-type="data-cell"]')].filter((c) =>
            c.querySelector(".avg-search-match"),
        ).length;
    const visible = () =>
        grid.element.querySelectorAll('[data-type="data-cell"]').length;

    grid.setSearchString(undefined);
    grid.setOptions({ highlightSearch: true });
    await settle(6);
    await scrollTo(0);
    const off = {
        repaint: await measureFullRepaint(),
        fps: await measureScrollFps(0),
        marked: marked(),
    };

    grid.setSearchString(search);
    await settle(6);
    await scrollTo(0);
    const on = {
        repaint: await measureFullRepaint(),
        fps: await measureScrollFps(0),
        marked: marked(),
        visible: visible(),
        rowsKept: grid.getState().rowCount,
    };

    // Each shape is the same one class per cell — only the root attribute differs, so switching
    // must not change what is marked, and must not cost a repaint.
    const shapes = {};
    for (const mode of ["text", "background", "both"]) {
        grid.setOptions({ highlightSearch: mode });
        await settle(6);
        const span = grid.element.querySelector(".avg-search-match");
        const cs = span ? getComputedStyle(span) : null;
        shapes[mode] = {
            attr: grid.element.getAttribute("data-search-highlight"),
            marked: marked(),
            color: cs?.color,
            background: cs?.backgroundColor,
        };
    }

    grid.setOptions({ highlightSearch: false });
    await settle(6);
    const disabled = { marked: marked(), rowsKept: grid.getState().rowCount };

    // Put the board back the way the rest of the harness expects it.
    grid.setOptions({ highlightSearch: true });
    grid.setSearchString(undefined);
    await settle(6);
    const cleared = marked();

    return {
        search,
        off,
        on,
        shapes,
        disabled,
        markedAfterClear: cleared,
        // The two that decide whether this shipped: a search costs nothing measurable on the
        // paint path, and no mark outlives the search that made it.
        freeRepaint: on.repaint.mutations === 0,
        clean: cleared === 0 && disabled.marked === 0,
    };
}

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
 * The task-21 check: what the four class hooks cost, and whether a class actually goes away.
 *
 * Two halves, and the second is the one that matters. **Cost** is a full repaint with all four
 * hooks live against the same repaint with every one of them removed — the hooks run inside the
 * per-cell loop, so this is where they would show up. **Correctness** is the pool trap: cells
 * arrive at their next occupant holding the previous one's classes, so a class that stops
 * applying has to be *absent* after the repaint, not merely un-asked-for. Removing the hooks and
 * counting again is exactly that test, run against real elements rather than happy-dom's.
 */
async function measureClassHooks() {
    const count = (cls) =>
        grid.element.querySelectorAll(`[data-type="data-cell"].${cls}`).length;
    const snapshot = () => ({
        flagged: count("flagged"),
        lowScore: count("low-score"),
        inactive: count("inactive"),
        scoreHeader: grid.element.querySelectorAll(
            '[data-type="header-cell"].score-header',
        ).length,
    });

    const withHooks = await measureFullRepaint();
    const applied = snapshot();

    // Take all four away. `setColumns` with the hooks stripped, and the two grid-wide callbacks
    // assigned `undefined` — which `setOptions` passes straight through.
    const original = grid.getColumns();
    const stripped = original.map((c) => {
        const { cellClass, headerClass, ...rest } = c;
        return rest;
    });
    grid.setOptions({ columns: stripped, onCellClass: undefined, rowClass: undefined });
    await settle(6);

    const withoutHooks = await measureFullRepaint();
    const remaining = snapshot();

    // Put the board back the way the rest of the harness expects it.
    grid.setOptions({
        columns: original,
        onCellClass: (c) => (c.row.status === "closed" ? "flagged" : undefined),
        rowClass: (r) => (r.row.active ? undefined : "inactive"),
    });
    await settle(6);
    const restored = snapshot();

    return {
        applied,
        remaining,
        restored,
        // The real answer: every class gone once its hook is, and back when it returns.
        cleared:
            remaining.flagged === 0 &&
            remaining.lowScore === 0 &&
            remaining.inactive === 0 &&
            remaining.scoreHeader === 0,
        withHooksMs: Number(withHooks.ms.toFixed(3)),
        withoutHooksMs: Number(withoutHooks.ms.toFixed(3)),
        ratio: Number((withHooks.ms / (withoutHooks.ms || 1)).toFixed(2)),
        withHooksMutations: withHooks.mutations,
        withoutHooksMutations: withoutHooks.mutations,
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

/**
 * The task-12 check: opening, typing in and committing an editor must cost one cell.
 *
 * The failure this is watching for is the one the invariant in `CLAUDE.md` describes. If a
 * repaint of the editing cell ever re-parents the editor — because the render path took a
 * pooled element instead of `previous` — the caret dies on the next hover, and the symptom
 * visible from here is DOM mutations during the edit. So the numbers to read are
 * `dirtyCellsOnOpen` (must be 1), `mutationsWhileEditing` (must be 0), and
 * `sameElementAfterRepaint` (must be true).
 */
async function measureEditing(row = 100) {
    const rowHeight = grid.getState().rowHeight;
    await scrollTo(Math.max(0, (row - 5) * rowHeight));
    // The first editable data column.
    const col = grid.model.data.columns.findIndex(
        (c) => !c.isStatusColumn && !c.readonly && !c.options && c.dataType !== "boolean",
    );

    grid.focusCell(row, col);
    grid.refresh();
    await settle(4);

    const model = grid.render.model;
    const originalUpdate = model.update;
    let dirty = 0;
    model.update = (info) => {
        if (!info || info.all) dirty = Infinity;
        else dirty += (info.cells?.length ?? 0) + (info.rows?.length ?? 0);
        return originalUpdate.call(model, info);
    };

    grid.render.resetStats();
    const openStartedAt = performance.now();
    grid.startEdit(row, col);
    const openMs = performance.now() - openStartedAt;
    const dirtyCellsOnOpen = dirty;
    await settle(3);

    const editorEl = grid.element.querySelector('[data-type="cell-editor"]');
    const cellOf = (el) => el?.closest('[data-type="data-cell"]');
    const cellBefore = cellOf(editorEl);

    // A repaint of the editing cell — what a hover or a selection change causes.
    grid.render.resetStats();
    grid.refresh();
    await settle(3);
    const editStats = grid.render.stats;
    const sameElementAfterRepaint =
        grid.element.querySelector('[data-type="cell-editor"]') === editorEl &&
        cellOf(editorEl) === cellBefore;

    dirty = 0;
    editorEl.value = `edited ${row}`;
    editorEl.dispatchEvent(new Event("input", { bubbles: true }));
    const commitStartedAt = performance.now();
    editorEl.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    const commitMs = performance.now() - commitStartedAt;
    const dirtyCellsOnCommit = dirty;
    await settle(3);

    model.update = originalUpdate;

    return {
        row,
        openMs,
        commitMs,
        dirtyCellsOnOpen,
        dirtyCellsOnCommit,
        mutationsWhileEditing: editStats.cellsAppended + editStats.cellsRemoved,
        sameElementAfterRepaint,
        committedValue: grid.model.data.rows[row][grid.model.data.columns[col].key],
        stillEditing: grid.isEditing(),
    };
}

/**
 * Task 22's gate: a **host-supplied** editor, held to task 12's numbers.
 *
 * The `joined` column's editor is an `<input type="date">` the board builds — see `columns()`.
 * What is being measured is not the picker: it is that nothing about the grid changes when the
 * editor is the host's. A full repaint of every visible cell while it is open must still mutate
 * zero DOM nodes and hand back the same element, which is only true because the render path
 * prefers `p.previous` and the editor is parented rather than rebuilt.
 *
 * The second half is teardown, and it is the half no happy-dom test can see. Scrolling the
 * editing row far out of view **evicts** the cell holding the editor — the pool removes the
 * element and gives the new coordinate a different one — so `releaseCell`, which only fires when
 * an element is *repainted* as another cell, never runs. `EditingModel.onViewportScrolled` is
 * what catches it, and `destroyed` reading 1 here is what says a popover-owning editor would
 * have been closed rather than left on `document.body`.
 */
async function measureCustomEditor(row = 100) {
    const rowHeight = grid.getState().rowHeight;
    await scrollTo(Math.max(0, (row - 5) * rowHeight));
    const col = grid.model.data.columns.findIndex((c) => c.key === "joined");
    if (col < 0) return { error: "no joined column — run createGrid() with columns" };

    grid.focusCell(row, col);
    grid.refresh();
    await settle(4);

    const before = { ...editorStats };
    const model = grid.render.model;
    const originalUpdate = model.update;
    let dirty = 0;
    model.update = (info) => {
        if (!info || info.all) dirty = Infinity;
        else dirty += (info.cells?.length ?? 0) + (info.rows?.length ?? 0);
        return originalUpdate.call(model, info);
    };

    dirty = 0;
    grid.startEdit(row, col);
    const dirtyOnOpen = dirty;
    await settle(3);

    const editorEl = grid.element.querySelector('[data-type="cell-editor"]');
    const cellOf = (e) => e?.closest('[data-type="data-cell"]');
    const cellBefore = cellOf(editorEl);
    const shape = {
        tag: editorEl?.tagName.toLowerCase(),
        type: editorEl?.getAttribute("type"),
        // The class the grid adds, which is what positions a host's element inside the cell.
        positioned: editorEl?.classList.contains("avg-cell-editor") ?? false,
        seededValue: editorEl?.value,
        built: editorStats.built - before.built,
    };

    // Task 12's gate, re-run against a host editor: a full repaint of every visible cell.
    // No timing here — `measureFullRepaint` owns that, and anything measured across `settle`
    // is three animation frames wide whatever the paint cost.
    grid.render.resetStats();
    grid.refresh();
    await settle(3);
    const stats = grid.render.stats;
    const sameElementAfterRepaint =
        grid.element.querySelector('[data-type="cell-editor"]') === editorEl &&
        cellOf(editorEl) === cellBefore;

    // Escape, which the editor does not handle: the grid binds it.
    editorEl.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }));
    await settle(2);
    const escape = {
        cancelled: !grid.isEditing(),
        destroyed: editorStats.destroyed - before.destroyed,
        valueUntouched: grid.model.data.rows[row].joined instanceof Date,
    };

    // Open again, write a date through `setValue`, and commit with Tab — also the grid's.
    const wasAt = grid.model.data.rows[row].joined.getTime();
    grid.startEdit(row, col);
    await settle(3);
    const second = grid.element.querySelector('[data-type="cell-editor"]');
    second.value = "2031-03-04";
    second.dispatchEvent(new Event("input", { bubbles: true }));
    second.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Tab" }));
    await settle(3);
    const committed = grid.model.data.rows[row].joined;
    const tab = {
        committed: committed instanceof Date && committed.getTime() !== wasAt,
        // Local, not `toISOString()`: the editor wrote local midnight, and UTC would report
        // the day before for any timezone behind it.
        value: committed instanceof Date ? toDateInput(committed) : String(committed),
        movedOn: grid.getFocus()?.columnKey,
        closed: !grid.isEditing(),
    };

    // Teardown by eviction: open it, then scroll a thousand rows away.
    const destroyedBeforeScroll = editorStats.destroyed;
    grid.startEdit(row, col);
    await settle(3);
    const openedForScroll = grid.isEditing();
    await scrollTo(Math.max(0, (row + 1000) * rowHeight));
    await settle(4);
    const eviction = {
        openedForScroll,
        closed: !grid.isEditing(),
        destroyed: editorStats.destroyed - destroyedBeforeScroll,
        editorLeftInDom: Boolean(grid.element.querySelector('[data-type="cell-editor"]')),
    };

    model.update = originalUpdate;

    return {
        row,
        shape,
        dirtyOnOpen,
        mutationsWhileEditing: stats.cellsAppended + stats.cellsRemoved,
        cellsRendered: stats.cellsRendered,
        sameElementAfterRepaint,
        escape,
        tab,
        eviction,
    };
}

/**
 * The task-13 check: copy and paste over a large selection.
 *
 * Copy is unavoidably O(selection) — it has to produce a string containing every selected
 * value, and 1,000 rows of it is the point. What must *not* scale with the selection is the
 * repaint: a paste marks the viewport once, so `dirtyOnPaste` reads 1 whether two cells were
 * pasted or two thousand, and `mutationsOnPaste` stays 0 because every visible cell is already
 * in place and only its text changes.
 *
 * Both events are genuine `ClipboardEvent`s with a real `DataTransfer`, so this exercises the
 * same path ctrl+C and ctrl+V take — not the programmatic API, which the sandbox's clipboard
 * permissions would block anyway.
 */
async function measureClipboard(row = 100, rowCount = 1000) {
    const rowHeight = grid.getState().rowHeight;
    await scrollTo(Math.max(0, (row - 5) * rowHeight));

    const editable = grid.model.data.columns
        .map((c, i) => ({ c, i }))
        .filter(
            ({ c }) =>
                !c.isStatusColumn && !c.readonly && !c.options && c.dataType !== "boolean",
        )
        .map(({ i }) => i);
    const [colStart, colEnd] = [editable[0], editable[1] ?? editable[0]];

    const lastRow = Math.min(row + rowCount - 1, grid.getVisibleRows().length - 1);
    grid.selectRange(row, colStart, lastRow, colEnd);
    await settle(3);

    const copyEvent = new ClipboardEvent("copy", {
        bubbles: true,
        cancelable: true,
        clipboardData: new DataTransfer(),
    });
    const copyStartedAt = performance.now();
    grid.element.dispatchEvent(copyEvent);
    const copyMs = performance.now() - copyStartedAt;
    const text = copyEvent.clipboardData.getData("text/plain");

    const model = grid.render.model;
    const originalUpdate = model.update;
    let dirty = 0;
    model.update = (info) => {
        dirty += 1;
        return originalUpdate.call(model, info);
    };

    const pasted = new DataTransfer();
    pasted.setData("text/plain", `pasted A\tpasted B\n`);
    grid.render.resetStats();
    const pasteStartedAt = performance.now();
    grid.element.dispatchEvent(
        new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: pasted,
        }),
    );
    const pasteMs = performance.now() - pasteStartedAt;
    const dirtyOnPaste = dirty;
    await settle(3);

    model.update = originalUpdate;
    const stats = grid.render.stats;
    const key = grid.model.data.columns[colStart].key;

    return {
        row,
        selectionRows: lastRow - row + 1,
        copyMs,
        copiedChars: text.length,
        copiedLines: text.split("\n").length - 1,
        copyPrevented: copyEvent.defaultPrevented,
        pasteMs,
        dirtyOnPaste,
        mutationsOnPaste: stats.cellsAppended + stats.cellsRemoved,
        // The paste tiled one clipboard row across the whole selection.
        firstPastedValue: grid.model.data.rows[row][key],
        lastPastedValue: grid.model.data.rows[lastRow][key],
    };
}

/**
 * Task 24. What `copyValue` changes, and what it costs.
 *
 * The `rating` column renders five glyphs and carries `copyValue: (c) => stars(c.row)`, which is
 * the whole case for the hook: `withHook.rating` is a number a spreadsheet can sum and
 * `withoutHook.rating` is `★★★☆☆`, from the same cells, in the same browser.
 *
 * The cost is measured as alternating pairs rather than in blocks — a copy of 1,000 rows is a
 * couple of milliseconds and block ordering swamps the difference, which is the trap recorded
 * three times over in benchmark-results.md. Copy is O(selection) by definition; what this answers
 * is whether one extra host call per cell is visible next to building the CSV around it.
 */
async function measureCopyValue(rowCount = 1000, pairs = 20) {
    const cols = grid.model.data.columns;
    const ratingIndex = cols.findIndex((c) => String(c.key) === "rating");
    if (ratingIndex < 0) return { error: "no `rating` column — createGrid() with columns first" };

    const lastRow = Math.min(rowCount - 1, grid.getVisibleRows().length - 1);
    grid.selectRange(0, ratingIndex, lastRow, ratingIndex);
    await settle(2);

    /** One cell's copied text, so the two forms can be compared without reading 1,000 lines. */
    const oneCell = () => {
        grid.focusCell(0, ratingIndex);
        const value = grid.getSelectionText();
        grid.selectRange(0, ratingIndex, lastRow, ratingIndex);
        return value;
    };

    const original = columns();
    const stripped = columns().map((c) =>
        String(c.key) === "rating" ? { ...c, copyValue: undefined } : c,
    );

    const setColumns = (list) => {
        grid.setOptions({ columns: list });
        grid.selectRange(0, ratingIndex, lastRow, ratingIndex);
    };

    setColumns(original);
    const withHook = { rating: oneCell(), chars: grid.getSelectionText().length };
    setColumns(stripped);
    const withoutHook = { rating: oneCell(), chars: grid.getSelectionText().length };

    const time = () => {
        const startedAt = performance.now();
        grid.getSelectionText();
        return performance.now() - startedAt;
    };

    const alternating = () => {
        let hook = 0;
        let bare = 0;
        for (let i = 0; i < pairs; i++) {
            // The order inside the pair flips every iteration, so neither form is always second.
            if (i % 2 === 0) {
                setColumns(original);
                hook += time();
                setColumns(stripped);
                bare += time();
            } else {
                setColumns(stripped);
                bare += time();
                setColumns(original);
                hook += time();
            }
        }
        return { hookMs: hook / pairs, bareMs: bare / pairs };
    };

    const timings = alternating();
    setColumns(original);

    return {
        rows: lastRow + 1,
        withHook,
        withoutHook,
        ...timings,
        ratio: Number((timings.hookMs / timings.bareMs).toFixed(2)),
    };
}

/**
 * The task-14 check: adding and deleting rows must not move the viewport or lose the focus.
 *
 * The numbers to read are `scrollKept` and `focusKept` — both must be true. Adding a row 90,000
 * rows down is a `{ all: true }` repaint of what is on screen, so `dirtyOnAdd` is 1 and
 * `mutationsOnAdd` is 0 for the same reason a paste is: the grid got taller, but the same
 * twenty-odd cells are still the ones being looked at.
 *
 * `addMs` is not a gate. It is dominated by the array copy behind the insert, which is O(rows)
 * by choice — see `StructureModel.sourceIndex`.
 */
async function measureStructure(row = 90000) {
    const rowHeight = grid.getState().rowHeight;
    await scrollTo(Math.max(0, (row - 5) * rowHeight));
    await settle(3);

    const col = grid.model.data.columns.findIndex(
        (c) => !c.isStatusColumn && !c.readonly && !c.options && c.dataType !== "boolean",
    );
    grid.focusCell(row, col);
    await settle(3);

    const model = grid.render.model;
    const originalUpdate = model.update;
    let dirty = 0;
    model.update = (info) => {
        dirty += 1;
        return originalUpdate.call(model, info);
    };

    const offsetBefore = grid.render.container.scrollTop;
    const focusBefore = grid.getFocus();
    const rowsBefore = grid.getVisibleRows().length;

    // Insert *above* the viewport, which is the case that would shift it if anything did.
    grid.render.resetStats();
    const addStartedAt = performance.now();
    grid.model.models.structure.addBlankRows(1, row - 1, false);
    const addMs = performance.now() - addStartedAt;
    const dirtyOnAdd = dirty;
    await settle(3);
    const addStats = grid.render.stats;

    dirty = 0;
    grid.render.resetStats();
    const addedKey = grid.model.options.getRowKey(grid.getVisibleRows()[row - 1]);
    const deleteStartedAt = performance.now();
    grid.model.models.structure.deleteRows([addedKey], false);
    const deleteMs = performance.now() - deleteStartedAt;
    const dirtyOnDelete = dirty;
    await settle(3);

    model.update = originalUpdate;
    const focusAfter = grid.getFocus();

    return {
        row,
        rowsBefore,
        rowsAfter: grid.getVisibleRows().length,
        addMs,
        deleteMs,
        dirtyOnAdd,
        dirtyOnDelete,
        mutationsOnAdd: addStats.cellsAppended + addStats.cellsRemoved,
        // The insert pushed the focused row down one, and the delete put it back — the focus
        // follows the row, because it is held by key rather than by index.
        focusKept:
            focusAfter?.rowKey === focusBefore?.rowKey &&
            focusAfter?.columnKey === focusBefore?.columnKey,
        scrollKept: grid.render.container.scrollTop === offsetBefore,
    };
}

/**
 * The task-15 gate: filtering 100k rows down and back up.
 *
 * Two numbers matter and they are different in kind. `filterMs` is the model cost — one pass
 * over every source row — and it is the one that scales with the data. The DOM cost is the
 * one that must *not*: narrowing 100,000 rows to 20,000 changes every visible cell, so it is
 * a full repaint, and a full repaint of a viewport-worth of cells is the same work whether
 * the grid behind it holds a hundred rows or a hundred thousand.
 */
async function measureFilter(count = 100000) {
    if (grid.getState().sourceRowCount !== count) createGrid(count);
    grid.clearFilters();
    grid.setSearchString(undefined);
    await scrollTo(0);
    await settle(4);

    const model = grid.render.model;
    const originalUpdate = model.update;
    let dirty = 0;
    model.update = (info) => {
        dirty += 1;
        return originalUpdate.call(model, info);
    };

    const time = async (fn) => {
        dirty = 0;
        grid.render.resetStats();
        const t0 = performance.now();
        fn();
        const ms = performance.now() - t0;
        await settle(3);
        const s = grid.render.stats;
        return {
            ms: Number(ms.toFixed(2)),
            dirty,
            paints: s.paints,
            mutations: s.cellsAppended + s.cellsRemoved,
            rows: grid.getState().rowCount,
        };
    };

    // Down: one column, two values out of five.
    const down = await time(() =>
        grid.applyFilter({ columnKey: "status", value: ["open", "pending"] }),
    );
    // And a second filter on top of the first, which is the AND path. `platform` rather than
    // any other team on purpose: the generator's status and team cycles are both mod 5, so
    // most pairs intersect in nothing at all and would measure an empty grid.
    const narrow = await time(() =>
        grid.applyFilter({ columnKey: "team", value: ["platform"] }),
    );
    // Back up.
    const up = await time(() => grid.clearFilters());

    // The free-text search, which now formats every column's displayed value per row — the
    // change task 15 made to close the computed-column gap. Measured on the same 100k rows.
    const search = await time(() => grid.setSearchString("hopper"));
    // And against the computed column specifically: `full` has no row property at all.
    const computed = await time(() => grid.setSearchString("ada lovelace"));
    await time(() => grid.setSearchString(undefined));

    model.update = originalUpdate;

    // Is a filtered grid still smooth? Filter it down and scroll what is left.
    grid.applyFilter({ columnKey: "status", value: ["open"] });
    await settle(4);
    const fps = await measureScrollFps(0);
    grid.clearFilters();
    await settle(3);

    return { count, down, narrow, up, search, computed, filteredFps: fps.fps };
}

/**
 * Task 23's gate: what does a **host's** `match` cost inside the 100,000-row filter pass, and
 * does a custom filter reach the grid by the same one-repaint, zero-mutation path the built-in
 * one does?
 *
 * Four measurements, and the last two are the interesting ones:
 *
 * - **grid** — `applyFilter` with a custom value, and the clear after it. Must read one repaint
 *   and zero DOM mutations, exactly as task 15's built-in filter does: the filter type decides
 *   which rows survive and nothing else, so it cannot change what the paint costs.
 * - **popover** — the Score funnel opened for real, its min/max typed into and applied. Reports
 *   what the grid behind it repainted, which must be the one header cell the funnel lives in.
 * - **rowLoop** — a host `match` against the built-in `"options"` test, on the same 100,000 rows
 *   at the same selectivity, **alternated within pairs** and then again with the order reversed.
 *   Timed in blocks this measurement lies; that trap has now been hit three times and is written
 *   up in `benchmark-results.md`.
 * - **parsing** — the same custom filter written the two ways the docs distinguish: bounds
 *   resolved once in `getValue`, against a `match` that parses per row. This is the number
 *   behind the warning, rather than an assertion that parsing is slow.
 */
async function measureCustomFilter(count = 100000) {
    if (grid.getState().sourceRowCount !== count) createGrid(count);
    grid.clearFilters();
    grid.setSearchString(undefined);
    await scrollTo(0);
    await settle(4);

    const model = grid.render.model;
    const originalUpdate = model.update;
    let dirty = 0;
    model.update = (info) => {
        dirty += 1;
        return originalUpdate.call(model, info);
    };

    const time = async (fn) => {
        dirty = 0;
        grid.render.resetStats();
        const t0 = performance.now();
        fn();
        const ms = performance.now() - t0;
        await settle(3);
        const s = grid.render.stats;
        return {
            ms: Number(ms.toFixed(2)),
            dirty,
            paints: s.paints,
            mutations: s.cellsAppended + s.cellsRemoved,
            rows: grid.getState().rowCount,
        };
    };

    // Two thirds of the rows, which is what `active: true` keeps — see `rowLoop` below.
    const value = { min: 0, max: 666, lo: 0, hi: 666 };
    const down = await time(() => grid.applyFilter({ columnKey: "score", value }));
    // The number that is actually the gate. `down` mutates ten nodes and always will: it is the
    // first filter, so the bar appears, the grid loses 32px of height and one row of cells goes
    // with it. A *change* to a filter, with the bar already up, must cost nothing at all.
    const changed = await time(() =>
        grid.applyFilter({
            columnKey: "score",
            value: { min: 0, max: 300, lo: 0, hi: 300 },
        }),
    );
    // And a built-in filter on top of a custom one, which is the AND path across the two types.
    const both = await time(() =>
        grid.applyFilter({ columnKey: "status", value: ["open", "pending"] }),
    );
    const chip =
        grid.element.parentElement?.querySelector(
            '.avg-filter-chip[data-column-key="score"] .avg-filter-chip-values',
        )?.textContent ?? null;
    const chips = Array.from(document.querySelectorAll(".avg-filter-chip")).map((c) =>
        c.textContent.trim(),
    );
    const up = await time(() => grid.clearFilters());

    // The popover, opened the way the funnel opens it, and applied from its own inputs.
    const builtBefore = { ...filterStats };
    dirty = 0;
    grid.render.resetStats();
    const popoverPromise = grid.showFilterPopover("score");
    const dirtyOnOpen = dirty;
    await settle(3);
    const panel = document.querySelector(".avg-custom-filter-body");
    const minInput = document.querySelector(".avg-filter-popover [data-min]");
    const maxInput = document.querySelector(".avg-filter-popover [data-max]");
    if (minInput && maxInput) {
        minInput.value = "0";
        maxInput.value = "250";
        document
            .querySelector('.avg-filter-popover [data-action="apply"]')
            .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    const applied = await popoverPromise;
    await settle(3);
    const openStats = grid.render.stats;
    const popover = {
        bodyMounted: Boolean(panel),
        // No checklist was built at all — not built and hidden.
        checklist: Boolean(document.querySelector(".avg-filter-popover .avg-filter-list")),
        dirtyOnOpen,
        gridMutations: openStats.cellsAppended + openStats.cellsRemoved,
        appliedValue: applied ? `${applied.value.min} – ${applied.value.max}` : null,
        rowsKept: grid.getState().rowCount,
        built: filterStats.built - builtBefore.built,
        destroyed: filterStats.destroyed - builtBefore.destroyed,
    };
    grid.clearFilters();
    await settle(3);
    model.update = originalUpdate;

    // ---- the row loop -------------------------------------------------------
    const cols = grid.getColumns();
    const pass = (columns, filters) => {
        const t0 = performance.now();
        const kept = filterRows(rows, columns, undefined, filters);
        return { ms: performance.now() - t0, kept: kept.length };
    };

    /**
     * Alternate A and B within each pair, then do it again with the order inside the pair
     * reversed. Block timing put the *cheaper* configuration ahead twice before this harness
     * learned the lesson: whatever runs second inherits a warmed cache and a settled clock.
     */
    const alternating = (a, b, pairs = 20) => {
        let aMs = 0;
        let bMs = 0;
        for (let i = 0; i < pairs; i++) {
            aMs += pass(a.columns, a.filters).ms;
            bMs += pass(b.columns, b.filters).ms;
        }
        for (let i = 0; i < pairs; i++) {
            bMs += pass(b.columns, b.filters).ms;
            aMs += pass(a.columns, a.filters).ms;
        }
        return {
            aMs: Number((aMs / (pairs * 2)).toFixed(3)),
            bMs: Number((bMs / (pairs * 2)).toFixed(3)),
            ratio: Number((aMs / (bMs || 1)).toFixed(3)),
        };
    };

    const customPass = {
        columns: cols,
        filters: [{ columnKey: "score", type: "numberRange", value }],
    };
    // The built-in test, kept as close as the two can be: one option, one property read, and
    // ~66% of the rows surviving either way.
    const builtinPass = {
        columns: cols,
        filters: [
            { columnKey: "active", type: "options", value: [{ value: true, label: "true" }] },
        ],
    };
    const rowLoop = {
        customKept: pass(customPass.columns, customPass.filters).kept,
        builtinKept: pass(builtinPass.columns, builtinPass.filters).kept,
        ...alternating(customPass, builtinPass),
    };

    // ---- parsed once, or parsed per row ------------------------------------
    const joinedIndex = cols.findIndex((c) => c.key === "joined");
    const withDefinition = (definition) =>
        cols.map((c, i) => (i === joinedIndex ? { ...c, filter: definition } : c));
    const from = new Date(Date.UTC(2020, 6, 1));
    const to = new Date(Date.UTC(2024, 0, 1));

    const parsedColumns = withDefinition({
        name: "dateRangeParsed",
        create: () => ({ element: document.createElement("div"), getValue: () => undefined }),
        label: () => "range",
        // What the docs tell a host to write: the value arrives already resolved to numbers.
        match: (v, row) => {
            const ms = row.joined.getTime();
            return ms >= v.fromMs && ms <= v.toMs;
        },
    });
    const naiveColumns = withDefinition({
        name: "dateRangeNaive",
        create: () => ({ element: document.createElement("div"), getValue: () => undefined }),
        label: () => "range",
        // What a host writes first: the bounds re-parsed on every one of 100,000 rows.
        match: (v, row) => {
            const ms = Date.parse(row.joined);
            return ms >= Date.parse(v.from) && ms <= Date.parse(v.to);
        },
    });
    const parsing = alternating(
        {
            columns: parsedColumns,
            filters: [
                {
                    columnKey: "joined",
                    type: "dateRangeParsed",
                    value: { fromMs: from.getTime(), toMs: to.getTime() },
                },
            ],
        },
        {
            columns: naiveColumns,
            filters: [
                {
                    columnKey: "joined",
                    type: "dateRangeNaive",
                    value: { from: from.toISOString(), to: to.toISOString() },
                },
            ],
        },
        10,
    );

    return {
        count,
        grid: { down, changed, both, up },
        chip,
        chips,
        popover,
        rowLoop,
        parsing: { parsedMs: parsing.aMs, naiveMs: parsing.bMs, ratio: parsing.ratio },
    };
}

/**
 * The other half of the task-15 gate: do filters survive a reload, `Date` values included?
 *
 * Run against an injected in-memory store rather than `localStorage`, because the point of
 * the injection is that the library never assumes it may write to the host's storage — and a
 * board that quietly left keys behind would be proving the opposite.
 */
async function measureFilterStorage() {
    const map = new Map();
    const storage = {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, v),
        removeItem: (k) => map.delete(k),
    };
    const persistFilters = { name: "avgrid-board", storage };

    const host = el("grid-host");
    const make = () => {
        grid?.destroy();
        host.textContent = "";
        grid = AVGrid.create(host, { rows, columns: columns(), persistFilters });
        window.avg.grid = grid;
        return grid;
    };

    const joined = rows[10].joined;
    make();
    grid.setFilters([
        { columnKey: "status", value: ["open", "pending"] },
        { columnKey: "joined", value: [joined] },
    ]);
    await settle(3);
    const before = { rowCount: grid.getState().rowCount, filters: grid.getFilters() };
    const stored = map.get("Filters-avgrid-board");

    // Same page, new grid — the reload, without the reload.
    make();
    await settle(3);
    const after = { rowCount: grid.getState().rowCount, filters: grid.getFilters() };
    const restoredDate = after.filters.find((f) => f.columnKey === "joined")?.value[0]?.value;

    grid.clearFilters();
    await settle(2);
    createGrid(rows.length);

    return {
        storageKeys: [...map.keys()],
        storedBytes: stored ? stored.length : 0,
        rowCountBefore: before.rowCount,
        rowCountAfter: after.rowCount,
        roundTripped: before.rowCount === after.rowCount,
        dateIsDate: restoredDate instanceof Date,
        dateMatches: restoredDate instanceof Date && restoredDate.getTime() === joined.getTime(),
        // The reference threw the option object away on restore and kept only the Date; the
        // label has to survive too, or a restored chip has nothing to show.
        labelKept: Boolean(after.filters.find((f) => f.columnKey === "joined")?.value[0]?.label),
    };
}

/**
 * Task 16's gate: what does opening a filter popover over 100,000 rows cost, and does the
 * checklist inside it stay flat-cost when the column has tens of thousands of distinct values?
 *
 * Three measurements, because they fail for different reasons:
 *
 * - **open** — the default option provider makes one pass over every row to collect the
 *   distinct values, so this scales with the data and is expected to.
 * - **wide** — the same, on a column whose values are nearly all distinct (`score`), which is
 *   the case that would have put 100,000 rows in a popover before `VirtualList` existed. The
 *   DOM row count is the number that matters, not the option count.
 * - **grid** — how many cells the grid itself repainted while all this happened. Opening a
 *   popover marks the header once, for the funnel; the answer must not grow with the rows.
 */
async function measureFilterPopover(count = 100000) {
    if (grid.getState().sourceRowCount !== count) createGrid(count);
    grid.clearFilters();
    await scrollTo(0);
    await settle(4);

    const model = grid.render.model;
    const originalUpdate = model.update;
    let dirty = 0;
    model.update = (info) => {
        dirty += 1;
        return originalUpdate.call(model, info);
    };

    const listRows = () =>
        document.querySelectorAll(".avg-filter-popover .avg-list-item[data-index]").length;

    const openOn = async (columnKey) => {
        dirty = 0;
        grid.render.resetStats();
        const t0 = performance.now();
        const closed = grid.showFilterPopover(columnKey);
        const ms = performance.now() - t0;
        await settle(3);
        const result = {
            ms: Number(ms.toFixed(2)),
            domRows: listRows(),
            gridDirty: dirty,
            gridMutations: grid.render.stats.cellsAppended + grid.render.stats.cellsRemoved,
        };
        document.querySelector('.avg-filter-popover [data-action="clear"]').click();
        await closed;
        await settle(2);
        return result;
    };

    // Five distinct values over 100k rows.
    const open = await openOn("status");
    // ~100k distinct values over the same rows — the case the virtualized list exists for.
    const wide = await openOn("score");

    // Typing in the search box re-asks the provider and re-renders the list. Measured on the
    // wide column, which is where it is expensive.
    const closed = grid.showFilterPopover("score");
    await settle(3);
    const search = document.querySelector(".avg-filter-popover .avg-list-search");
    const t0 = performance.now();
    search.value = "123";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    const searchMs = performance.now() - t0;
    await settle(3);
    const searchRows = listRows();
    document.querySelector('.avg-filter-popover [data-action="clear"]').click();
    await closed;

    model.update = originalUpdate;
    await settle(2);

    return {
        count,
        open,
        wide,
        search: { ms: Number(searchMs.toFixed(2)), domRows: searchRows },
    };
}

/**
 * Task 17 — the filter bar.
 *
 * Two questions, and only the second is a number. **Does the bar cost the grid anything?** It
 * lives outside the grid root, so applying a filter from a chip must repaint exactly what
 * applying it from the API repaints, and no more. **Does it land where it says?** The popover a
 * chip opens is anchored to the chip, which is the one thing no unit test can check — happy-dom
 * gives every element a zero rect, so all 32 of them run on stubbed geometry.
 */
async function measureFilterBar(count = 100000) {
    if (grid.getState().sourceRowCount !== count) createGrid(count);
    grid.clearFilters();
    await settle(3);

    const bar = grid.getFilterBar().element;
    const chips = () => Array.from(bar.querySelectorAll(".avg-filter-chip"));

    // Hidden with nothing filtered, and taking no height from the grid.
    const hidden = {
        chips: chips().length,
        barHeight: bar.getBoundingClientRect().height,
    };

    grid.render.resetStats();
    const t0 = performance.now();
    grid.setFilters([
        { columnKey: "status", value: ["open"] },
        { columnKey: "team", value: ["platform"] },
    ]);
    const applyMs = performance.now() - t0;
    await settle(3);

    const shown = {
        chips: chips().length,
        labels: chips().map((c) => c.querySelector(".avg-filter-chip-values").textContent),
        barHeight: Number(bar.getBoundingClientRect().height.toFixed(1)),
        applyMs: Number(applyMs.toFixed(2)),
        gridMutations: grid.render.stats.cellsAppended + grid.render.stats.cellsRemoved,
    };

    // Open the first chip's popover and check it landed under the chip it belongs to.
    const body = chips()[0].querySelector(".avg-filter-chip-body");
    body.click();
    await settle(4);
    const popover = document.querySelector(".avg-filter-popover");
    const chipRect = body.getBoundingClientRect();
    const popRect = popover?.getBoundingClientRect();
    const anchored = popRect
        ? {
              below: Number((popRect.top - chipRect.bottom).toFixed(1)),
              alignedLeft: Number((popRect.left - chipRect.left).toFixed(1)),
              insideViewport:
                  popRect.left >= 0 &&
                  popRect.top >= 0 &&
                  popRect.right <= window.innerWidth &&
                  popRect.bottom <= window.innerHeight,
              chipLit: chips()[0].classList.contains("avg-filter-chip-open"),
          }
        : null;
    grid.model.flags.filterPopover?.close();
    await settle(3);

    // The remove-all button, from the bar rather than from the API.
    grid.render.resetStats();
    const t1 = performance.now();
    bar.querySelector('[data-action="clear-all"]').click();
    const clearMs = performance.now() - t1;
    await settle(3);

    const cleared = {
        chips: chips().length,
        rows: grid.getVisibleRows().length,
        clearMs: Number(clearMs.toFixed(2)),
        gridMutations: grid.render.stats.cellsAppended + grid.render.stats.cellsRemoved,
    };

    return { count, hidden, shown, anchored, cleared };
}

/**
 * Task 17a — the cell dropdown, rebuilt on `Popover` + `VirtualList`.
 *
 * The gate is the one the plan states: a column with 10,000 options opens instantly. What makes
 * that true is the same thing that makes the filter popover true — the list is virtualized — so
 * the number to read is `domRows`, not `ms`. Two other things are checked because they are what
 * the native `<select>` could not do and no unit test can see:
 *
 * - **themed** — the list is this library's DOM, so it inherits the board's `--p-*` tokens. The
 *   check is that the popover's background is the board's, not the platform's white.
 * - **anchored** — the list opens flush under the cell it edits, and inside the viewport, which
 *   happy-dom's zero rects cannot answer.
 *
 * `gridMutations` is the same question `measureFilterPopover` asks: opening a dropdown must not
 * make the grid behind it rebuild anything.
 */
async function measureCellSelect(count = 100000, optionCount = 10000) {
    if (grid.getState().sourceRowCount !== count) createGrid(count);
    grid.clearFilters();
    await scrollTo(0);
    await settle(4);

    const col = grid.model.data.columns.findIndex((c) => c.key === "status");
    const column = grid.model.data.columns[col];
    const smallOptions = column.options;

    const listRows = () =>
        document.querySelectorAll(".avg-cell-select-popover .avg-list-item[data-index]").length;

    const openAt = async (row) => {
        grid.render.resetStats();
        const t0 = performance.now();
        grid.startEdit(row, col);
        await settle(4);
        const ms = performance.now() - t0;

        const popover = document.querySelector(".avg-cell-select-popover");
        const editor = grid.element.querySelector(".avg-cell-select");
        const cellRect = editor?.getBoundingClientRect();
        const popRect = popover?.getBoundingClientRect();

        return {
            ms: Number(ms.toFixed(2)),
            domRows: listRows(),
            gridMutations: grid.render.stats.cellsAppended + grid.render.stats.cellsRemoved,
            anchored: popRect
                ? {
                      below: Number((popRect.top - cellRect.bottom).toFixed(1)),
                      alignedLeft: Number((popRect.left - cellRect.left).toFixed(1)),
                      insideViewport:
                          popRect.left >= 0 &&
                          popRect.top >= 0 &&
                          popRect.right <= window.innerWidth &&
                          popRect.bottom <= window.innerHeight,
                  }
                : null,
            themed: popover
                ? {
                      background: getComputedStyle(popover).backgroundColor,
                      boardBackground: getComputedStyle(document.body).backgroundColor,
                      fontFamily: getComputedStyle(popover).fontFamily.split(",")[0],
                  }
                : null,
        };
    };

    // The enumeration case — what a status column really holds.
    const small = await openAt(10);
    grid.cancelEdit();
    await settle(3);

    // The gate: ten thousand options behind one cell.
    column.options = Array.from({ length: optionCount }, (_v, i) => `option ${i}`);
    const wide = await openAt(11);

    // Picking, from the list rather than from the API.
    const before = grid.model.data.rows[11].status;
    const rowEl = document.querySelector(
        '.avg-cell-select-popover .avg-list-item[data-index="4"]',
    );
    const pickedLabel = rowEl?.textContent;
    grid.render.resetStats();
    rowEl?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle(3);

    const picked = {
        label: pickedLabel,
        wrote: grid.model.data.rows[11].status,
        changed: grid.model.data.rows[11].status !== before,
        stillEditing: grid.isEditing(),
        popoverGone: !document.querySelector(".avg-cell-select-popover"),
        gridMutations: grid.render.stats.cellsAppended + grid.render.stats.cellsRemoved,
    };

    column.options = smallOptions;
    grid.model.data.rows[11].status = before;
    grid.refresh();
    await settle(3);

    return { count, optionCount, small, wide, picked };
}

/**
 * The context menu's gate, which is the same question `measureFilterPopover` asks one level
 * out: opening a menu over 100,000 rows must cost the grid behind it nothing.
 *
 * Two openings, because the selection is what the items are built from: one cell, and then all
 * 100,000 rows selected — where a careless implementation reads `getGridSelection()` and copies
 * 100,000 row references before it can draw a single label.
 */
async function measureContextMenu(count = 100000) {
    if (grid.getState().sourceRowCount !== count) createGrid(count);
    grid.clearFilters();
    await scrollTo(0);
    await settle(4);

    const model = grid.render.model;
    const originalUpdate = model.update;
    let dirty = 0;
    model.update = (info) => {
        dirty += 1;
        return originalUpdate.call(model, info);
    };

    const openAt = async (row, col) => {
        const cell = Array.from(
            grid.element.querySelectorAll('[data-type="data-cell"]'),
        ).find(
            (c) =>
                c.getAttribute("data-row") === String(row) &&
                c.getAttribute("data-col") === String(col),
        );
        const r = cell.getBoundingClientRect();
        dirty = 0;
        grid.render.resetStats();
        const t0 = performance.now();
        cell.dispatchEvent(
            new MouseEvent("pointerdown", {
                bubbles: true,
                button: 2,
                buttons: 2,
                clientX: r.left + 10,
                clientY: r.top + 8,
            }),
        );
        cell.dispatchEvent(
            new MouseEvent("contextmenu", {
                bubbles: true,
                cancelable: true,
                clientX: r.left + 10,
                clientY: r.top + 8,
            }),
        );
        const ms = performance.now() - t0;
        await settle(3);
        const result = {
            ms: Number(ms.toFixed(2)),
            items: document.querySelectorAll('[data-type="menu-item"]').length,
            gridDirty: dirty,
            gridMutations:
                grid.render.stats.cellsAppended + grid.render.stats.cellsRemoved,
        };
        grid.model.flags.contextMenu?.close();
        await settle(2);
        return result;
    };

    // One cell — and note the right-click itself moves the focus, so the first opening pays for
    // a focus change the second does not.
    grid.focusCell(4, 2);
    await settle(2);
    const single = await openAt(4, 2);

    // Every row selected. The labels say "Delete 100000 rows" and nothing was copied to
    // find that out.
    grid.selectRange(0, 1, count - 1, 3);
    await settle(2);
    const all = await openAt(4, 2);

    grid.focusCell(0, 1);
    model.update = originalUpdate;
    await settle(2);

    return { count, single, all };
}

/**
 * Task 18's gate: create and destroy a grid `cycles` times and watch the heap.
 *
 * Every grid gets the full surface — filter bar, checkbox column, add buttons, an applied
 * filter, a focused cell, an open editor — so anything that keeps a listener, an observer, a
 * popover or a pooled cell alive has somewhere to hide.
 *
 * **`heapKb` is the weakest number here and is reported last on purpose.** Without a forced
 * GC — which needs `--js-flags=--expose-gc` — `usedJSHeapSize` measures garbage that has not
 * been swept, so it sawtooths: consecutive runs of this very function have come back at
 * +45 KB and −15 KB a cycle. It is a smoke signal, not evidence.
 *
 * The two numbers that *are* evidence:
 *
 * - **`domNodes`** — exact, no flag needed. Anything the library left attached shows up.
 * - **`collected`** — a `WeakRef` is kept to every destroyed grid, then the heap is put under
 *   real allocation pressure to provoke a collection. A grid still reachable from anywhere —
 *   a document listener, a pending frame, a module-level registry — cannot be collected, so
 *   this counts what actually became garbage rather than what the allocator happens to hold.
 */
async function measureTeardown(cycles = 100, rowCount = 2000) {
    const built = buildRows(rowCount);
    const host = el("grid-host");
    grid?.destroy();
    host.textContent = "";

    const gc = window.gc ?? null;
    const heap = () => performance.memory?.usedJSHeapSize ?? 0;
    const nodes = () => document.querySelectorAll("*").length;

    const make = () => {
        const g = AVGrid.create(host, {
            rows: built.rows,
            editable: true,
            filterBar: true,
            selectColumn: true,
            canAddRows: true,
            canAddColumns: true,
        });
        g.applyFilter({ columnKey: "status", value: ["open"] });
        g.focusCell(0, 1);
        g.startEdit(0, 1);
        return g;
    };

    // One full cycle before the baseline: the first grid injects the shared stylesheet and
    // warms every module-level cache, and counting that as growth would be a false positive.
    make().destroy();
    await settle(3);
    gc?.();
    await settle(2);

    const startNodes = nodes();
    const startHeap = heap();
    const startedAt = performance.now();

    const refs = [];
    let latest = null;
    for (let i = 0; i < cycles; i++) {
        latest = make();
        latest.destroy();
        refs.push(new WeakRef(latest));
    }
    // **This line is load-bearing.** Without it the last grid stays reachable from this
    // binding and `collected` reads 99/100 forever — a harness artefact that looks exactly
    // like a one-object leak, and cost a while to tell apart from one.
    latest = null;

    const ms = performance.now() - startedAt;
    await settle(3);
    gc?.();

    // Heap first, before the pressure loop below allocates hundreds of megabytes of its own
    // and makes the number meaningless.
    const endNodes = nodes();
    const endHeap = heap();

    // No --expose-gc in a board, so provoke a collection the only way a page can: allocate
    // enough that the engine has to sweep. ~60 × 8 MB, released as it goes.
    if (!gc) {
        for (let i = 0; i < 60; i++) {
            const junk = new Array(1e6).fill(i);
            if (junk[999999] === -1) console.log("unreachable");
            await nextFrame();
        }
    }
    await settle(2);

    const collected = refs.filter((r) => r.deref() === undefined).length;

    grid = null;
    createGrid();

    return {
        cycles,
        rowCount,
        msPerCycle: Number((ms / cycles).toFixed(3)),
        domNodes: { start: startNodes, end: endNodes, leaked: endNodes - startNodes },
        collected: `${collected}/${cycles}`,
        heapKb: heap()
            ? {
                  start: Math.round(startHeap / 1024),
                  end: Math.round(endHeap / 1024),
                  growthPerCycleKb: Number(
                      ((endHeap - startHeap) / 1024 / cycles).toFixed(2),
                  ),
                  gcForced: Boolean(gc),
              }
            : "unavailable — run Chrome with --enable-precise-memory-info",
    };
}

/**
 * Task 26. `sortValue` against the same order written as a `rowCompare`.
 *
 * The `Status` column sorts by `STATUS_RANK` rather than alphabetically, which is the ask this hook
 * came from. The comparison is the point: both forms produce the *same* order, so what is left is
 * how many times the host's projection runs — n for `sortValue`, O(n log n) inside a comparator.
 * `calls` counts it rather than trusting the arithmetic.
 *
 * Alternating pairs with the order flipped every iteration, as everything on this board is now
 * measured; and `document.hidden` must be false or every number here is 8× too large.
 */
async function measureSortValue(pairs = 6) {
    const cases = {
        // A table lookup — the shape the docs' snippet uses, and about as cheap as a projection
        // gets, so this is the case where the transform's own allocation is most visible.
        rank: {
            columnKey: "status",
            project: (row) => STATUS_RANK[row.status] ?? 9,
            compare: (a, b) =>
                (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9),
        },
        // A projection that actually does work: two lowercase conversions and a concat, compared
        // with `localeCompare`. The comparator form runs all of it twice per comparison.
        text: {
            columnKey: "full",
            project: (row) =>
                `${row.lastName}`.toLowerCase() + "|" + `${row.firstName}`.toLowerCase(),
            compare: (a, b) =>
                (`${a.lastName}`.toLowerCase() + "|" + `${a.firstName}`.toLowerCase())
                    .localeCompare(
                        `${b.lastName}`.toLowerCase() + "|" + `${b.firstName}`.toLowerCase(),
                    ),
        },
    };

    const results = {};

    for (const [name, spec] of Object.entries(cases)) {
        let projectionCalls = 0;
        let comparatorCalls = 0;

        const withSortValue = columns().map((c) =>
            String(c.key) === spec.columnKey
                ? {
                      ...c,
                      sortValue: (row) => {
                          projectionCalls += 1;
                          return spec.project(row);
                      },
                  }
                : c,
        );
        const withRowCompare = columns().map((c) =>
            String(c.key) === spec.columnKey
                ? {
                      ...c,
                      rowCompare: (a, b) => {
                          comparatorCalls += 2;
                          return spec.compare(a, b);
                      },
                  }
                : c,
        );

        // The columns are swapped with the sort *off*, so only the sort itself is timed.
        const timeSort = async (list) => {
            grid.setSort(undefined);
            grid.setOptions({ columns: list });
            await settle(2);
            const startedAt = performance.now();
            grid.setSort({ key: spec.columnKey, direction: "asc" });
            const ms = performance.now() - startedAt;
            await settle(2);
            return ms;
        };

        let projected = 0;
        let compared = 0;
        let projectedOrder;
        let comparedOrder;
        for (let i = 0; i < pairs; i++) {
            // The order inside the pair flips every iteration, so neither form is always second.
            if (i % 2 === 0) {
                projected += await timeSort(withSortValue);
                projectedOrder = firstKeys(spec.columnKey);
                compared += await timeSort(withRowCompare);
                comparedOrder = firstKeys(spec.columnKey);
            } else {
                compared += await timeSort(withRowCompare);
                comparedOrder = firstKeys(spec.columnKey);
                projected += await timeSort(withSortValue);
                projectedOrder = firstKeys(spec.columnKey);
            }
        }

        results[name] = {
            sortValueMs: Number((projected / pairs).toFixed(2)),
            rowCompareMs: Number((compared / pairs).toFixed(2)),
            ratio: Number((projected / compared).toFixed(2)),
            // Per sort, so the two are comparable: n against O(n log n).
            callsPerSort: {
                sortValue: Math.round(projectionCalls / pairs),
                rowCompare: Math.round(comparatorCalls / pairs),
            },
            // The two forms must agree, or this is a comparison between two different sorts.
            sameOrder: projectedOrder === comparedOrder,
            firstThree: projectedOrder,
        };
    }

    grid.setSort(undefined);
    grid.setOptions({ columns: columns() });
    await settle(2);

    return { rows: grid.getVisibleRows().length, hidden: document.hidden, ...results };
}

/** The first three displayed values of one column, as a string, for an order comparison. */
function firstKeys(columnKey) {
    const column = grid.model.data.columns.find((c) => String(c.key) === columnKey);
    return grid
        .getVisibleRows()
        .slice(0, 3)
        .map((r) => (column?.formatValue ? column.formatValue(column, r) : r[columnKey]))
        .join(" · ");
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

    status("measuring an edit…");
    const editing = await measureEditing(count - 1000);

    status("measuring copy and paste over 1,000 rows…");
    const clipboard = await measureClipboard(count - 1000);

    status("measuring an add and a delete above the viewport…");
    const structure = await measureStructure(count - 10000);

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
        editing,
        clipboard,
        structure,
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
        ${row(
            "Open an editor",
            `${r.editing.openMs.toFixed(3)} ms`,
            `${r.editing.dirtyCellsOnOpen} cell marked · ${r.editing.mutationsWhileEditing} DOM mutations on repaint`,
        )}
        ${row(
            "Commit the edit",
            `${r.editing.commitMs.toFixed(3)} ms`,
            `${r.editing.dirtyCellsOnCommit} row marked · editor survived repaint: ${r.editing.sameElementAfterRepaint}`,
        )}
        ${row(
            "Copy 1,000 rows × 2 columns",
            `${r.clipboard.copyMs.toFixed(1)} ms`,
            `${r.clipboard.copiedChars.toLocaleString()} chars · ${r.clipboard.copiedLines.toLocaleString()} lines`,
        )}
        ${row(
            "Paste into 1,000 rows",
            `${r.clipboard.pasteMs.toFixed(1)} ms`,
            `${r.clipboard.dirtyOnPaste} repaint marked · ${r.clipboard.mutationsOnPaste} DOM mutations`,
        )}
        ${row(
            "Add a row above the viewport",
            `${r.structure.addMs.toFixed(1)} ms`,
            `${r.structure.dirtyOnAdd} repaint marked · ${r.structure.mutationsOnAdd} DOM mutations`,
        )}
        ${row(
            "Delete it again",
            `${r.structure.deleteMs.toFixed(1)} ms`,
            `scroll kept: ${r.structure.scrollKept} · focus kept: ${r.structure.focusKept}`,
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

/**
 * Task 14a — the popover, in a browser that actually lays things out.
 *
 * happy-dom returns a zero rect for everything, so every placement test in the suite runs on
 * stubbed geometry. This is the only place the arithmetic meets a real viewport. Pass a
 * selector or `{x, y}` to anchor it, and `tall: true` for content that cannot fit — which is
 * what makes it flip and cap its height.
 */
let popover = null;

function showPopover({ anchor = ".avg-header-cell", tall = false, ...rest } = {}) {
    closePopover();
    const target =
        typeof anchor === "string" ? document.querySelector(anchor) : anchor;
    if (!target) return { error: `no element matches ${anchor}` };

    popover = new Popover({ anchor: target, resizable: true, minWidth: 120, minHeight: 80, ...rest });
    const body = document.createElement("div");
    body.style.cssText = "padding:8px;display:flex;flex-direction:column;gap:4px;min-width:200px";
    for (let i = 0; i < (tall ? 60 : 4); i++) {
        const row = document.createElement("div");
        row.textContent = `option ${i}`;
        body.appendChild(row);
    }
    popover.content.appendChild(body);
    // Compared before clearing: the previous popover's promise resolves *after* this one has
    // been assigned, so an unconditional `popover = null` here drops the live reference and
    // leaks the panel. A harness bug, but exactly the shape a caller could hit.
    const opened = popover;
    void opened.show().then(() => {
        if (popover === opened) popover = null;
    });
    return popoverGeometry();
}

function popoverGeometry() {
    if (!popover) return { open: false };
    const r = popover.root.getBoundingClientRect();
    return {
        open: true,
        placement: popover.root.getAttribute("data-placement"),
        top: Math.round(r.top),
        left: Math.round(r.left),
        width: Math.round(r.width),
        height: Math.round(r.height),
        // Both must hold, or the popover is hanging off the screen.
        insideViewport:
            r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
        contentScrolls: popover.content.scrollHeight > popover.content.clientHeight,
    };
}

function closePopover(result) {
    popover?.close(result);
    popover = null;
}

/**
 * Task 14b — the virtualized list, against a real viewport.
 *
 * The task's gate: a list of 100,000 options has to mount and scroll like the grid does, not
 * like a popover full of DOM. Opened inside a real `Popover`, because that is where it will
 * live and because a list whose container has no definite height renders nothing at all.
 */
let listPopover = null;
let list = null;

async function measureList(count = 100000, ms = 1500) {
    closeList();
    const items = Array.from({ length: count }, (_v, i) => ({
        value: i,
        label: `option ${i.toString(36)}`,
    }));

    listPopover = new Popover({
        anchor: document.querySelectorAll(".avg-header-cell")[1],
        resizable: true,
        size: { width: 260, height: 320 },
    });
    listPopover.show();

    // Mount cost only — construction plus the synchronous first paint, the same thing the
    // grid's `firstPaintMs` measures. Settling afterwards would fold in three frames of
    // waiting and report the display refresh rate instead.
    const t0 = performance.now();
    list = new VirtualList({ items, selectAll: true });
    listPopover.content.appendChild(list.element);
    list.measure();
    const mountMs = performance.now() - t0;
    await settle();

    const body = list.element.querySelector('[data-type="render-grid-scroll"]');
    const rowsInDom = () => list.element.querySelectorAll(".avg-list-item[data-index]").length;

    // Flat cost, the thesis this project exists to defend: a paint at option 99,000 must cost
    // what a paint at option 0 costs.
    const paintAt = async (top) => {
        body.scrollTop = top;
        await settle(2);
        list.render.resetStats();
        for (let i = 0; i < 60; i++) {
            body.scrollTop += 24;
            await nextFrame();
        }
        const s = list.render.stats;
        return s.paints ? s.totalPaintMs / s.paints : 0;
    };
    const atTop = await paintAt(0);
    const atEnd = await paintAt(24 * (count - 200));

    // Scroll it the same way the grid is scrolled, and read the frame times.
    const frames = [];
    let last = performance.now();
    const until = last + ms;
    while (performance.now() < until) {
        body.scrollTop += 40;
        await new Promise((r) => requestAnimationFrame(r));
        const now = performance.now();
        frames.push(now - last);
        last = now;
    }
    frames.sort((a, b) => a - b);
    const mean = frames.reduce((a, b) => a + b, 0) / frames.length;

    // Select-all over 100,000 options: one mark for the whole operation.
    const t1 = performance.now();
    list.element.querySelector(".avg-list-all").click();
    const selectAllMs = performance.now() - t1;
    await settle();

    return {
        count,
        mountMs: Number(mountMs.toFixed(2)),
        rowsInDom: rowsInDom(),
        fps: Number((1000 / mean).toFixed(1)),
        p95Ms: Number(frames[Math.floor(frames.length * 0.95)].toFixed(2)),
        worstMs: Number(frames[frames.length - 1].toFixed(2)),
        paintTopMs: Number(atTop.toFixed(3)),
        paintEndMs: Number(atEnd.toFixed(3)),
        flatRatio: Number((atEnd / atTop).toFixed(2)),
        selectAllMs: Number(selectAllMs.toFixed(2)),
        selectedCount: list.getSelected().length,
        scrolledTo: Math.round(body.scrollTop),
    };
}

function closeList() {
    list?.destroy();
    list = null;
    listPopover?.close();
    listPopover = null;
}

window.avg = {
    AVGrid,
    Popover,
    VirtualList,
    filterRows,
    scoreRangeFilter,
    measureList,
    closeList,
    get list() {
        return list;
    },
    showPopover,
    popoverGeometry,
    closePopover,
    createGrid,
    minimalGrid,
    runBenchmark,
    measurePaintCost,
    measureScrollFps,
    measureFullRepaint,
    measureClassHooks,
    measureRangeDrag,
    measureSelectAll,
    measureEditing,
    measureCustomEditor,
    measureClipboard,
    measureCopyValue,
    measureStructure,
    measureFilter,
    measureCustomFilter,
    measureFilterStorage,
    measureFilterPopover,
    measureFilterBar,
    measureCellSelect,
    measureContextMenu,
    measureTeardown,
    measureSort,
    measureSortValue,
    measureHighlight,
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
