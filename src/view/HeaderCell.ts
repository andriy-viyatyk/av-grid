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

import type { RenderCellParams, RenderedCell } from "../render/types";
import type { AVGridModel } from "../model/AVGridModel";
import { filterIcon, sortAscIcon, sortDescIcon } from "./icons";
import { applyCellStyle, setText } from "./cellDom";

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
    if (el.className !== className) el.className = className;

    el.setAttribute("data-type", "header-cell");
    el.setAttribute("data-row", "0");
    el.setAttribute("data-col", String(p.col));
    el.setAttribute("data-column-key", key);

    const resizable = column.resizable !== false && !column.isStatusColumn;
    el.setAttribute("data-resizable", resizable ? "true" : "false");
    // Status columns are pinned in place; everything else can be dragged to reorder.
    el.draggable = !column.isStatusColumn;

    // --- sort indicator
    const sort = model.state.get().sort;
    if (sort && sort.key === String(column.key)) {
        el.setAttribute("data-sort", sort.direction);
        structure.sort.innerHTML =
            sort.direction === "asc" ? sortAscIcon : sortDescIcon;
    } else {
        el.removeAttribute("data-sort");
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

    // --- filter funnel (inert until task 16 wires the popover to it)
    const filterable =
        Boolean(column.filterType) && !model.options.disableFiltering;
    structure.filter.style.display = filterable ? "" : "none";
    const filtered = model.options.filters?.some(
        (f) => f.columnKey === String(column.key),
    );
    structure.filter.classList.toggle("avg-column-filtered", Boolean(filtered));

    applyCellStyle(el, p.style);
    return el;
}
