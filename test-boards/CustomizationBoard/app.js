/**
 * CustomizationBoard — the six host hooks of phase 6, live, and each documented claim checked.
 *
 * `AVGridBoard` measures what the hooks *cost*. This board asks the other question: does what
 * `docs/api.md` says about them actually happen in a browser? Every hook here is written the way
 * the docs' snippet writes it — copied, not paraphrased — and `checkAll()` returns one row per
 * documented claim with the value it was checked against.
 *
 * The hooks: `cellClass`, `headerClass`, `rowClass`, `editor`, `column.filter`, `copyValue`,
 * `sortValue`.
 *
 * Everything is on `window.custom`, so a session runs through browser_evaluate with no clicking.
 */

import { AVGrid } from "./lib/av-grid.js";

const el = (id) => document.getElementById(id);
const statusEl = el("status");
const liveEl = el("live");

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
async function settle(frames = 3) {
    for (let i = 0; i < frames; i++) await nextFrame();
}

// ── data ────────────────────────────────────────────────────────────────────────────────────
// ISO date strings, which sort and compare lexicographically and are what <input type="date">
// reads and writes. Nothing here parses a date.
const DAY = 86400000;
const iso = (offsetDays) =>
    new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
const today = iso(0);

const PRIORITIES = ["critical", "high", "normal", "low"];
const RANK = { critical: 0, high: 1, normal: 2, low: 3 };

function makeRows(count) {
    return Array.from({ length: count }, (_, i) => ({
        id: i + 1,
        task: `Task ${i + 1} — ${
            ["review the migration", "write the release note", "chase the failing test",
             "answer the ticket"][i % 4]
        }`,
        priority: PRIORITIES[i % 4],
        due: iso((i % 17) - 5),
        progress: i % 7 === 6 ? 100 : (i * 17) % 101,
    }));
}

// ── the custom filter type ──────────────────────────────────────────────────────────────────
// An object on the column: no registration call, and reuse across columns is this `const`.
let filterCreateCalls = 0;
let matchCalls = 0;

const dateRangeFilter = {
    name: "dateRange",

    create: (ctx) => {
        filterCreateCalls += 1;
        const element = document.createElement("div");
        element.className = "range-filter";
        element.innerHTML = `
            <label>From <input type="date" data-from></label>
            <label>To <input type="date" data-to></label>`;
        const from = element.querySelector("[data-from]");
        const to = element.querySelector("[data-to]");
        from.value = ctx.value?.from ?? "";
        to.value = ctx.value?.to ?? "";
        element.addEventListener("keydown", (e) => {
            if (e.key === "Enter") ctx.apply({ from: from.value, to: to.value });
        });
        return {
            element,
            // Nullish removes the filter, so an empty body means Clear.
            getValue: () =>
                from.value || to.value ? { from: from.value, to: to.value } : undefined,
        };
    },

    label: (value) => `${value.from || "…"} → ${value.to || "…"}`,

    // Once per row, on every filter pass — which is why the value carries what it needs.
    match: (value, row, column) => {
        matchCalls += 1;
        const v = row[column.key];
        return (!value.from || v >= value.from) && (!value.to || v <= value.to);
    },
};

// ── the hooks, and a switch to take them all off ────────────────────────────────────────────
// Removing them is the pool trap: a pooled cell comes back dirty, so a class its hook no longer
// asks for has to be *gone* on the next paint. No happy-dom test can see that.
let hooksOn = true;
let sortValueCalls = 0;
let editorsCreated = 0;
let editorsDestroyed = 0;

function columns() {
    return [
        { key: "id", name: "#", width: 60, align: "right", readonly: true },
        {
            key: "task",
            name: "Task",
            width: "35%",
            // A constant string builds no context object at all.
            cellClass: hooksOn ? "wrap" : undefined,
            headerClass: hooksOn ? "wrap" : undefined,
        },
        {
            key: "priority",
            name: "Priority",
            width: 120,
            options: PRIORITIES,
            sortValue: hooksOn
                ? (row) => {
                      sortValueCalls += 1;
                      return RANK[row.priority] ?? 9;
                  }
                : undefined,
            cellClass: hooksOn ? (c) => `p-${c.value}` : undefined,
        },
        {
            key: "due",
            name: "Due",
            width: 150,
            filter: hooksOn ? dateRangeFilter : undefined,
            editor: hooksOn
                ? (ctx) => {
                      editorsCreated += 1;
                      const input = document.createElement("input");
                      input.type = "date";
                      input.value = ctx.value ?? "";
                      input.addEventListener("input", () => ctx.setValue(input.value));
                      // Commit-on-blur is the editor's call, not the grid's. Right for a native
                      // date input, wrong for an editor that opens a panel of its own.
                      input.addEventListener("blur", () => ctx.commit());
                      return {
                          element: input,
                          destroy: () => {
                              editorsDestroyed += 1;
                          },
                      };
                  }
                : undefined,
        },
        {
            key: "progress",
            name: "Progress",
            width: 170,
            align: "left",
            readonly: true,
            render: (c) =>
                `<span class="progress-bar" style="width:${c.value}px"></span>` +
                `<span class="progress-num">${c.value}%</span>`,
            // Without this the column copies its bar's text ("52%"), which sums as nothing.
            copyValue: hooksOn ? (c) => c.value : undefined,
        },
    ];
}

// ── the grid ────────────────────────────────────────────────────────────────────────────────
let grid = null;
let rows = [];

function createGrid(count = Number(el("rows").value) || 2000) {
    grid?.destroy();
    rows = makeRows(count);
    grid = AVGrid.create("#grid-host", {
        rows,
        editable: true,
        filterBar: true,
        columns: columns(),
        rowClass: hooksOn
            ? (r) =>
                  r.row.progress === 100 ? "done" : r.row.due < today ? "overdue" : undefined
            : undefined,
        onEdit: (e) => say(`onEdit ${e.columnKey} @ ${e.rowKey}: ${JSON.stringify(e.value)}`),
    });
    window.custom.grid = grid;
    statusEl.textContent = `${count.toLocaleString()} rows · hooks ${hooksOn ? "on" : "off"}`;
    return grid;
}

const say = (line) => (liveEl.textContent = line);

// ── the checks ──────────────────────────────────────────────────────────────────────────────
// Each returns { claim, ok, detail } — the documented sentence, whether it held, and the value
// it was checked against, so a failure says what it saw rather than only that it failed.

const cells = (sel = "") => document.querySelectorAll(`.avg-data-cell${sel}`);

function checkClassHooks() {
    const out = [];
    const critical = cells(".p-critical").length;
    const overdue = cells(".overdue").length;
    const header = document.querySelectorAll(".avg-header-cell.wrap").length;
    const constant = cells(".wrap").length;

    out.push({
        claim: "cellClass marks this column's data cells",
        ok: critical > 0,
        detail: `${critical} .p-critical cells`,
    });
    out.push({
        claim: "headerClass marks this column's header cell",
        ok: header === 1,
        detail: `${header} .avg-header-cell.wrap`,
    });
    out.push({
        claim: "a constant-string cellClass needs no context object",
        ok: constant > 0,
        detail: `${constant} .wrap data cells`,
    });
    out.push({
        claim: "rowClass lands on every cell of the row — there is no row element",
        ok: overdue > 0 && overdue % grid.getState().columnCount === 0,
        detail: `${overdue} cells, ${grid.getState().columnCount} columns per row`,
    });
    return out;
}

/**
 * The pool trap, and the only check here that needs a real browser twice over: it needs layout
 * to have cells at all, and it needs a *repaint* to prove the class went away rather than the
 * element.
 */
async function checkClassesGoAway() {
    const before = {
        cell: cells(".p-critical").length,
        row: cells(".overdue").length,
        header: document.querySelectorAll(".avg-header-cell.wrap").length,
    };
    hooksOn = false;
    grid.setOptions({ columns: columns(), rowClass: undefined });
    await settle(3);
    const after = {
        cell: cells(".p-critical").length,
        row: cells(".overdue").length,
        header: document.querySelectorAll(".avg-header-cell.wrap").length,
    };
    hooksOn = true;
    grid.setOptions({
        columns: columns(),
        rowClass: (r) =>
            r.row.progress === 100 ? "done" : r.row.due < today ? "overdue" : undefined,
    });
    await settle(3);
    const restored = {
        cell: cells(".p-critical").length,
        row: cells(".overdue").length,
        header: document.querySelectorAll(".avg-header-cell.wrap").length,
    };
    return [
        {
            claim: "a class disappears when its hook stops asking for it",
            ok: after.cell === 0 && after.row === 0 && after.header === 0,
            detail: `${before.cell}/${before.row}/${before.header} → ` +
                `${after.cell}/${after.row}/${after.header} → ` +
                `${restored.cell}/${restored.row}/${restored.header}`,
        },
    ];
}

function checkSortValue() {
    sortValueCalls = 0;
    grid.setSort({ key: "priority", direction: "asc" });
    const asc = grid.getVisibleRows().slice(0, 4).map((r) => r.priority);
    const callsAsc = sortValueCalls;

    grid.setSort({ key: "priority", direction: "desc" });
    const desc = grid.getVisibleRows().slice(0, 4).map((r) => r.priority);
    grid.setSort(undefined);

    return [
        {
            claim: "sortValue orders by the projection, not alphabetically",
            ok: asc[0] === "critical" && desc[0] === "low",
            detail: `asc ${asc.join(",")} · desc ${desc.join(",")}`,
        },
        {
            claim: "the projection is read once per row, not once per comparison",
            ok: callsAsc === rows.length,
            detail: `${callsAsc} calls for ${rows.length} rows`,
        },
    ];
}

async function checkCustomFilter() {
    const all = grid.getState().rowCount;
    matchCalls = 0;
    grid.applyFilter({ columnKey: "due", value: { from: today, to: iso(7) } });
    await settle(2);

    const filtered = grid.getState().rowCount;
    const chip = document.querySelector(".avg-filter-chip")?.textContent ?? "";
    const stored = grid.getState().filters[0];

    grid.setFilters([]);
    await settle(2);

    return [
        {
            claim: "a host match narrows the rows and is called once per row",
            ok: filtered < all && matchCalls === all,
            detail: `${all} → ${filtered} rows, ${matchCalls} match calls`,
        },
        {
            claim: "the filter's type is filled in from the column, not written by the host",
            ok: stored?.type === "dateRange",
            detail: JSON.stringify(stored?.value ?? null) + ` type=${stored?.type}`,
        },
        {
            claim: "the chip reads the definition's label",
            ok: chip.includes(`${today} → ${iso(7)}`),
            detail: chip || "(no chip)",
        },
        {
            claim: "clearing restores every row",
            ok: grid.getState().rowCount === all,
            detail: `${grid.getState().rowCount} rows`,
        },
    ];
}

/** The funnel opens the host's body rather than the checklist, and the grid draws Apply/Clear. */
async function checkFilterPopover() {
    filterCreateCalls = 0;
    const funnel = [...document.querySelectorAll(".avg-header-cell")]
        .find((h) => h.dataset.columnKey === "due")
        ?.querySelector("[data-type='filter-button']");
    funnel?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }));
    funnel?.click();
    await settle(3);

    const body = document.querySelector(".avg-popover .range-filter");
    const buttons = [...document.querySelectorAll(".avg-popover button")].map((b) =>
        b.textContent.trim(),
    );
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await settle(2);

    return [
        {
            claim: "the funnel opens the host's element instead of the checklist",
            ok: !!body && filterCreateCalls === 1,
            detail: `create() called ${filterCreateCalls}×, checklist ${
                document.querySelector(".avg-popover .avg-list") ? "present" : "absent"
            }`,
        },
        {
            claim: "the grid draws Apply and Clear around it",
            ok: buttons.includes("Apply") && buttons.includes("Clear"),
            detail: buttons.join(", ") || "(none)",
        },
    ];
}

/**
 * The editor, driven the way a pointer drives it: two presses with a frame between them, because
 * the first settles the focus and the second opens the edit. `element.click()` reaches neither —
 * the grid resolves a press on `pointerdown`.
 */
async function pressCell(rowIndex, colIndex) {
    const cell = document.querySelector(
        `.avg-data-cell[data-row="${rowIndex}"][data-col="${colIndex}"]`,
    );
    if (!cell) return null;
    const r = cell.getBoundingClientRect();
    const o = {
        clientX: r.x + r.width / 2,
        clientY: r.y + r.height / 2,
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        button: 0,
        buttons: 1,
        isPrimary: true,
    };
    cell.dispatchEvent(new PointerEvent("pointerdown", o));
    cell.dispatchEvent(new PointerEvent("pointerup", { ...o, buttons: 0 }));
    cell.dispatchEvent(new MouseEvent("click", o));
    await settle(2);
    return cell;
}

async function checkEditor() {
    const out = [];
    const dueCol = grid.getState().columns.findIndex((c) => c.key === "due");
    editorsCreated = 0;
    editorsDestroyed = 0;

    await pressCell(2, dueCol);
    await pressCell(2, dueCol);

    const input = document.querySelector("input.avg-cell-editor");
    out.push({
        claim: "the column's editor opens, positioned by avg-cell-editor",
        ok: !!input && input.type === "date",
        detail: input ? input.outerHTML : "(no editor)",
    });
    out.push({
        claim: "the grid keeps its own keys and clipboard out of it",
        ok: input?.dataset.type === "cell-editor",
        detail: `data-type=${input?.dataset.type}`,
    });

    // Escape cancels without the editor handling it.
    input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await settle(2);
    out.push({
        claim: "Escape cancels, and destroy() runs",
        ok: !grid.getState().editing && editorsDestroyed === editorsCreated,
        detail: `${editorsCreated} created, ${editorsDestroyed} destroyed`,
    });

    // Reopen and commit a value through setValue + Tab, which the grid binds for the editor.
    await pressCell(2, dueCol);
    await pressCell(2, dueCol);
    const second = document.querySelector("input.avg-cell-editor");
    const key = grid.getVisibleRows()[2]?.id;
    second.value = "2026-12-24";
    second.dispatchEvent(new Event("input", { bubbles: true }));
    second.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    await settle(2);
    out.push({
        claim: "Tab commits and moves on, with nothing special-cased for the editor",
        ok: rows.find((r) => r.id === key)?.due === "2026-12-24" && !grid.getState().editing,
        detail: `row ${key} due = ${rows.find((r) => r.id === key)?.due}`,
    });

    // The fifth way an edit ends: the row is scrolled far enough out that the pool *evicts* the
    // cell, so nothing repaints it and `releaseCell` never fires.
    await pressCell(2, dueCol);
    await pressCell(2, dueCol);
    const scroller = grid.element.querySelector('[data-type="render-grid-scroll"]');
    scroller.scrollTop = 20000;
    await settle(3);
    out.push({
        claim: "an edit closes when its row is evicted by a long scroll",
        ok: !grid.getState().editing && !document.querySelector("input.avg-cell-editor"),
        detail: `editing = ${JSON.stringify(grid.getState().editing ?? null)}`,
    });
    scroller.scrollTop = 0;
    await settle(2);
    return out;
}

/**
 * Copy, through a real `ClipboardEvent` — the path ctrl+C takes. The programmatic
 * `copySelection()` is permission-gated in the sandbox; this is not.
 */
function checkCopyValue() {
    const progressCol = grid.getState().columns.findIndex((c) => c.key === "progress");
    grid.selectRange(0, progressCol, 4, progressCol);
    const event = new ClipboardEvent("copy", {
        bubbles: true,
        cancelable: true,
        clipboardData: new DataTransfer(),
    });
    grid.element.dispatchEvent(event);
    const text = event.clipboardData.getData("text/plain").trim();
    const expected = grid
        .getVisibleRows()
        .slice(0, 5)
        .map((r) => String(r.progress))
        .join("\n");
    return [
        {
            claim: "copyValue wins over the text of render, on the ctrl+C path",
            ok: text === expected && !text.includes("%"),
            detail: text.replace(/\n/g, " · "),
        },
    ];
}

/**
 * The bug this board's own example found: an edit freezes the row order, and clearing a filter
 * has to end that freeze — otherwise the rows the filter dropped stay on screen.
 */
async function checkFreezeEnds() {
    grid.applyFilter({ columnKey: "due", value: { from: today, to: iso(7) } });
    await settle(2);
    const filtered = grid.getState().rowCount;

    const dueCol = grid.getState().columns.findIndex((c) => c.key === "due");
    await pressCell(1, dueCol);
    await pressCell(1, dueCol);
    const input = document.querySelector("input.avg-cell-editor");
    input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await settle(2);

    grid.setFilters([]);
    await settle(2);
    const cleared = grid.getState().rowCount;

    return [
        {
            claim: "a filter cleared after an edit ends the freeze and re-runs the pipeline",
            ok: cleared === rows.length,
            detail: `${filtered} filtered → ${cleared} of ${rows.length} after clear`,
        },
    ];
}

async function checkAll() {
    const results = [
        ...checkClassHooks(),
        ...(await checkClassesGoAway()),
        ...checkSortValue(),
        ...(await checkCustomFilter()),
        ...(await checkFilterPopover()),
        ...(await checkEditor()),
        ...checkCopyValue(),
        ...(await checkFreezeEnds()),
    ];
    show(results);
    return {
        passed: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results,
    };
}

// A detail is often a fragment of DOM (`input.outerHTML`), so it is escaped rather than parsed —
// otherwise the results table renders the very editor it is reporting on.
const escape = (s) =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function show(results) {
    const box = el("results");
    box.hidden = false;
    box.innerHTML =
        "<table><tr><th>ok</th><th>claim</th><th>checked against</th></tr>" +
        results
            .map(
                (r) =>
                    `<tr><td class="${r.ok ? "pass" : "fail"}">${r.ok ? "✔" : "✘"}</td>` +
                    `<td>${escape(r.claim)}</td><td>${escape(r.detail)}</td></tr>`,
            )
            .join("") +
        "</table>";
    statusEl.textContent = `${results.filter((r) => r.ok).length}/${results.length} checks passed`;
}

// ── wiring ──────────────────────────────────────────────────────────────────────────────────
window.custom = {
    createGrid,
    checkAll,
    checkClassHooks,
    checkClassesGoAway,
    checkSortValue,
    checkCustomFilter,
    checkFilterPopover,
    checkEditor,
    checkCopyValue,
    checkFreezeEnds,
    pressCell,
    settle,
    get grid() {
        return grid;
    },
    set grid(g) {
        grid = g;
    },
};

el("rebuild").addEventListener("click", () => createGrid());
el("runAll").addEventListener("click", () => checkAll());
el("hooks").addEventListener("click", () => {
    hooksOn = !hooksOn;
    el("hooks").textContent = `Hooks: ${hooksOn ? "on" : "off"}`;
    createGrid();
});

createGrid();
