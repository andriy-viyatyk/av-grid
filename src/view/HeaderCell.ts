/**
 * The header cell — label, sort indicator, resize grip, filter funnel.
 *
 * A rewrite of `HeaderCell.tsx`, not a transliteration. Two things change shape:
 *
 * 1. **No per-cell listeners.** The reference attached a dozen handlers to every header. Here
 *    the root delegates (see `GridInteractions.ts`), so a header cell carries data attributes
 *    and nothing else. That is not a micro-optimization: cells are *pooled*, so an element
 *    that was a header a moment ago may be a data cell now. Listeners bound to a cell would
 *    have to be unbound on every recycle, and any one missed would fire for the wrong column.
 *
 * 2. **The element is updated in place, never rebuilt.** `p.previous` is the element already
 *    at this coordinate; reusing it means a repaint does no DOM insertion at all. See the
 *    contract in `RenderCellParams`.
 */

import { isPinnedLeft, sortAsList } from "../gridUtils";
import type { RenderCellParams, RenderedCell } from "../render/types";
import type { AVGridModel } from "../model/AVGridModel";
import { filterIcon, sortAscIcon, sortDescIcon } from "./icons";
import { appendClass, applyCellStyle, setText } from "./cellDom";

interface HeaderParts {
    sort: HTMLSpanElement;
    title: HTMLSpanElement;
    space: HTMLSpanElement;
    filter: HTMLButtonElement;
}

const parts = new WeakMap<HTMLElement, HeaderParts>();

function build(el: HTMLElement): HeaderParts {
    // A recycled element arrives in whatever state its last occupant left it.
    el.textContent = "";
    el.removeAttribute("style");

    const sort = document.createElement("span");
    sort.className = "avg-sort-icon";

    const title = document.createElement("span");
    title.className = "avg-header-title";
    title.appendChild(document.createTextNode(""));

    const space = document.createElement("span");
    space.className = "avg-flex-space";

    const filter = document.createElement("button");
    filter.className = "avg-filter-button";
    filter.type = "button";
    filter.tabIndex = -1;
    filter.setAttribute("data-type", "filter-button");
    filter.innerHTML = filterIcon;

    el.append(sort, title, space, filter);

    const built = { sort, title, space, filter };
    parts.set(el, built);
    return built;
}

export function renderHeaderCell<R>(
    model: AVGridModel<R>,
    p: RenderCellParams,
): RenderedCell {
    const column = model.data.columns[p.col];
    if (!column) return undefined;

    const el =
        p.previous ?? p.recycle?.() ?? document.createElement("div");

    // Reuse the structure only if this element is already a header cell — the pool is shared
    // with data cells, whose children are laid out differently.
    let structure = parts.get(el);
    if (!structure || el.getAttribute("data-type") !== "header-cell") {
        structure = build(el);
    }

    const key = String(column.key);
    let className = "avg-header-cell";
    if (model.flags.dragColumnKey === key) className += " avg-drag-source";
    if (model.flags.dragOverColumnKey === key) className += " avg-drag-over";
    // Additive, exactly as `cellClass` is on a data cell, and reassigned whole on every paint so
    // a class that stops applying goes away with it.
    const headerClass = column.headerClass;
    if (typeof headerClass === "string") className += ` ${headerClass}`;
    else if (headerClass) {
        className = appendClass(
            className,
            headerClass({ column, colIndex: p.col }),
        );
    }
    if (el.className !== className) el.className = className;

    el.setAttribute("data-type", "header-cell");
    el.setAttribute("data-row", "0");
    el.setAttribute("data-col", String(p.col));
    el.setAttribute("data-column-key", key);
    el.setAttribute("role", "columnheader");
    el.setAttribute("aria-colindex", String(p.col + 1));

    const pinnedLeft = isPinnedLeft(column);
    // The trailing right-pinned run. A right-pinned header keeps every affordance — it is a
    // data column that happens to be sticky — but its resize grip moves to its *left* edge,
    // because its right edge is anchored to the viewport. `data-pinned` carries that to the
    // stylesheet and to the hit-test in `GridInteractions`.
    const pinnedRight =
        p.col >= model.data.columns.length - model.data.stickyRightCount;
    if (pinnedRight) el.setAttribute("data-pinned", "right");
    else if (pinnedLeft) el.setAttribute("data-pinned", "left");
    else el.removeAttribute("data-pinned");

    const resizable = column.resizable !== false && !pinnedLeft;
    el.setAttribute("data-resizable", resizable ? "true" : "false");
    // Left-pinned columns are chrome, fixed in place; everything else can be dragged to
    // reorder — a right-pinned column only within its own band (`GridInteractions` refuses
    // a drop that would cross the boundary). While column groups are shown, reordering is
    // off for every column: a grouped order is a prepared view (see `Column.group`).
    el.draggable = !pinnedLeft && !model.data.hasGroups;

    // --- sort indicator
    const sortList = sortAsList(model.state.get().sort);
    const sortIndex = sortList.findIndex((s) => s.key === key);
    if (sortIndex >= 0) {
        const direction = sortList[sortIndex].direction;
        el.setAttribute("data-sort", direction);
        // On the primary column only — ARIA recommends a single `aria-sort` per grid even
        // when the data is sorted by several columns.
        if (sortIndex === 0) {
            el.setAttribute(
                "aria-sort",
                direction === "asc" ? "ascending" : "descending",
            );
        } else {
            el.removeAttribute("aria-sort");
        }
        // The position number appears only when two or more columns sort — with one, the
        // header is pixel-identical to the single-sort look.
        const position =
            sortList.length > 1
                ? `<span class="avg-sort-pos">${sortIndex + 1}</span>`
                : "";
        structure.sort.innerHTML =
            (direction === "asc" ? sortAscIcon : sortDescIcon) + position;
    } else {
        el.removeAttribute("data-sort");
        el.removeAttribute("aria-sort");
        if (structure.sort.firstChild) structure.sort.textContent = "";
    }

    // --- label
    const custom = column.headerRender?.({ column, colIndex: p.col });
    if (custom === undefined || custom === null) {
        setText(structure.title, column.name ?? String(column.key));
        el.title = column.name ?? String(column.key);
    } else if (typeof custom === "string") {
        structure.title.innerHTML = custom;
        el.removeAttribute("title");
    } else {
        structure.title.textContent = "";
        structure.title.appendChild(custom);
        el.removeAttribute("title");
    }

    // --- filter funnel
    // Filterable by default: `filterType: null` takes the funnel off one column, and
    // `disableFiltering` off all of them. Status columns — the checkbox — have nothing to
    // filter by.
    const filterable =
        column.filterType !== null &&
        !pinnedLeft &&
        !model.options.disableFiltering;
    structure.filter.style.display = filterable ? "" : "none";
    const filtered = model.options.filters?.some(
        (f) => f.columnKey === String(column.key),
    );
    structure.filter.classList.toggle("avg-column-filtered", Boolean(filtered));
    // Lit while its own popover is open, so a user who scrolled sideways can still see which
    // column they are filtering. On the model, never set by the click handler — a repaint
    // reassigns `className`, and a class set on the element would vanish with the next frame.
    structure.filter.classList.toggle(
        "avg-filter-open",
        model.flags.filterPopover?.columnKey === key,
    );

    // Two-row header: with groups active, row 0 is doubled and a *grouped* column's header
    // occupies its lower half — the group band (`GroupHeader.ts`) draws the upper. An
    // ungrouped column keeps the whole slot as one tall cell, which is what a label column
    // wants anyway.
    let style = p.style;
    if (model.data.hasGroups && column.group !== undefined) {
        const band = model.options.rowHeight;
        style = { ...style, top: style.top + band, height: style.height - band };
    }
    applyCellStyle(el, style);
    return el;
}
