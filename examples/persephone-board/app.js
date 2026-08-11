/**
 * A Persephone board using av-grid.
 *
 * The point of this example is how little there is: the grid needs **no theming code at all**
 * on a board. Every `--avg-*` token falls back to its `--p-*` equivalent, Persephone injects
 * those on `<html>` before the first paint and keeps them live across theme switches, and
 * nothing in the library reads a colour — so a theme change costs zero paints and zero lines.
 *
 * `persephone.onThemeChange` is here only to prove that, and because a board with a chart or a
 * canvas alongside the grid *does* need it: anything coloured from JavaScript has to re-read
 * the palette on every fire and must never cache it across a switch.
 */

import { AVGrid } from "./lib/av-grid.js";

const el = (id) => document.getElementById(id);
const statusEl = el("status");

const TEAMS = ["platform", "infra", "data", "growth", "research"];
const STATUS = ["open", "pending", "closed", "archived"];

const rows = Array.from({ length: 2000 }, (_, i) => ({
    id: i + 1,
    name: `Row ${i + 1}`,
    team: TEAMS[i % TEAMS.length],
    status: STATUS[(i * 3) % STATUS.length],
    score: (i * 37) % 100,
    active: i % 2 === 0,
}));

const grid = AVGrid.create("#host", {
    rows,
    name: "board-grid",

    selectColumn: true,
    editable: true,
    canAddRows: true,
    canDeleteRows: true,
    filterBar: true,

    // Remember the filters across a board reload. A board reload is a real page load, so this
    // is the difference between the user's filters surviving a Reload click and not.
    persistFilters: { name: "av-grid-board" },

    columns: [
        { key: "id", name: "#", width: 70, align: "right", dataType: "number", readonly: true },
        { key: "name", name: "Name", width: 160 },
        { key: "team", name: "Team", width: 120, options: TEAMS },
        { key: "status", name: "Status", width: 120, options: STATUS },
        { key: "score", name: "Score", width: 80, align: "right", dataType: "number" },
        { key: "active", name: "Active", width: 80, dataType: "boolean" },
    ],

    onEdit: (e) => {
        // Where a board would write through to a backend script:
        //   await persephone.execute("node scripts/save.js").getJson()
        persephone.notify?.(`${e.columnKey} → ${JSON.stringify(e.value)}`, "info");
    },

    onSelectionChange: report,
    onFiltersChange: report,

    // A board's own context-menu items, above the grid's built-in ones.
    getContextMenuItems: (e) => [
        {
            label: "Open in a new page",
            onClick: () => persephone.openRawLink?.(`https://example.com/rows/${e.rowKey}`),
        },
    ],
});

function report() {
    const s = grid.getState();
    statusEl.textContent =
        `${s.rowCount} of ${s.sourceRowCount} rows · ` +
        `${s.selectedCount} selected · ${s.filters.length} filters`;
}

el("search").addEventListener("input", (e) => {
    grid.setSearchString(e.target.value);
    report();
});

el("add").addEventListener("click", () => grid.addRow());

el("copy").addEventListener("click", async () => {
    // The board frame is a secure context with clipboard permission granted, so this works.
    const ok = await grid.copySelection("copyWithHeaders");
    persephone.notify?.(ok ? "Copied" : "Nothing selected", ok ? "success" : "warning");
});

// Nothing below this line is needed to theme the grid — see the note at the top. It is what a
// JS-coloured component next to the grid would do.
persephone.onThemeChange?.(() => {
    // Read the live palette on every fire; never cache it across a switch.
    console.log("theme changed:", persephone.getTheme?.());
    // Re-apply it to whatever is coloured from JavaScript — a chart, a canvas, an SVG.
});

report();

/** So a session can be driven through browser_evaluate with no clicking. */
window.grid = grid;
