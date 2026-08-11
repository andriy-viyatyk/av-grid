/**
 * The data cell — the hot path.
 *
 * A rewrite of `DataCell.tsx` and its `DefaultCellFormater` / `DefaultCellBoolean` helpers.
 * The behaviour is the reference's; the construction is not, because this function runs for
 * every cell of every repaint and a React component's allocations per call would show up
 * directly in the benchmark.
 *
 * What that costs in discipline:
 *
 * - **No listeners.** The root delegates. See `GridInteractions.ts`.
 * - **No object literals per cell.** `CellContext` is built only when a custom `render`,
 *   `formatValue`, `cellClass` or `onCellClass` hook actually needs one — the default path never
 *   allocates.
 * - **The class name is assembled into one string and assigned once**, rather than through
 *   `classList.add/remove` calls that each touch the class list.
 * - **Text goes through the existing text node** (`setText`), not `textContent`.
 *
 * The four content shapes an element can hold — plain text, a boolean icon, host HTML, a host
 * element — are tracked per element, so switching between them clears up after the last one.
 */

import type { RenderCellParams, RenderedCell } from "../render/types";
import type { AVGridModel } from "../model/AVGridModel";
import type { CellContext, Column } from "../types";
import { columnDisplayValue, formatDisplayValue, gridBoolean } from "../gridUtils";
import { checkedIcon, checkIcon, uncheckedIcon } from "./icons";
import { appendClass, applyCellStyle, setText } from "./cellDom";
import { highlightMarkup } from "../highlight";

type ContentMode = "text" | "bool" | "html" | "node" | "editor" | "match";

/**
 * The shapes a boolean cell takes, as constant markup.
 *
 * A boolean shows a tick or nothing — never the word "false". On an **editable** column the tick
 * is wrapped in a checkbox, which is the only way to change a boolean with the pointer: there is
 * no text editor to open. Under the pointer the wrapper shows a framed box instead, so the thing
 * to click is visible before it is clicked.
 *
 * **The box is in the DOM whether or not the cell is hovered, and that is the whole point.** The
 * first version emitted it only for the hovered cell, which meant the hit target did not exist
 * until the frame *after* the pointer arrived — so clicking a checkbox the moment you reached it
 * landed on an empty cell, and marking a column of records cost two clicks each: one to conjure
 * the box, one to use it. Only the glyph inside the wrapper is hovered now. An unchecked cell at
 * rest is therefore an empty 16×16 wrapper: invisible, and already under the pointer.
 *
 * `data-type` is what `GridInteractions` resolves the click by; the element carries no listener
 * of its own, because it is pooled.
 */
const TICK = `<span class="avg-check-icon">${checkIcon}</span>`;
const BOX_ON = `<span class="avg-bool-box avg-checked" data-type="bool-toggle">${TICK}</span>`;
const BOX_OFF = `<span class="avg-bool-box" data-type="bool-toggle"></span>`;
const BOX_ON_HOVERED = `<span class="avg-bool-box avg-checked" data-type="bool-toggle">${checkedIcon}</span>`;
const BOX_OFF_HOVERED = `<span class="avg-bool-box" data-type="bool-toggle">${uncheckedIcon}</span>`;

const mode = new WeakMap<HTMLElement, ContentMode>();
/** The highlighted markup last written to an element, so the paint can skip an unchanged one. */
const marked = new WeakMap<HTMLElement, string>();

/** Reset an element's children when the content shape changes under it. */
function setMode(el: HTMLElement, next: ContentMode): boolean {
    const current = mode.get(el);
    if (current === next && el.getAttribute("data-type") === "data-cell") {
        return false;
    }
    el.textContent = "";
    mode.set(el, next);
    return true;
}

/**
 * The alignment rules from the reference, in order: an explicit `align` wins; otherwise
 * booleans centre and numbers right-align, because that is what makes a column of them
 * readable.
 */
function alignClass<R>(column: Column<R>, value: unknown): string {
    if (column.align === "center") return " avg-align-center";
    if (column.align === "right") return " avg-align-right";
    if (column.align === "left") return "";

    if (
        typeof value === "boolean" ||
        (column.dataType === "boolean" && !value)
    ) {
        return " avg-align-center";
    }
    if (typeof value === "number") return " avg-align-right";
    return "";
}

export function renderDataCell<R>(
    model: AVGridModel<R>,
    p: RenderCellParams,
): RenderedCell {
    const column = model.data.columns[p.col];
    const dataRow = model.gridRowToDataRow(p.row);
    const row = model.data.rows[dataRow];
    if (!column || row === undefined) return undefined;

    const el = p.previous ?? p.recycle?.() ?? document.createElement("div");

    const value = (row as any)[column.key];

    // --- classes -----------------------------------------------------------
    let className = "avg-data-cell" + alignClass(column, value);
    if (model.data.hovered.row === dataRow) className += " avg-row-hovered";
    // Two integer comparisons per cell, so a grid with no open editor — every grid, nearly all
    // the time — pays almost nothing for the feature.
    const editing = model.models.editing;
    const isEditing = editing.isEditingCell(dataRow, p.col);
    if (isEditing) className += " avg-editing";
    // Both return "" — the identical empty string — for a grid with nothing selected, which
    // is the default state and allocates nothing.
    className += model.models.selected.rowClass(dataRow);
    className += model.models.focus.focusClass(p.col, dataRow);

    // A context object is built only for the hooks that need one — `render`, `onCellClass`, and a
    // functional `cellClass`. A string `cellClass` needs nothing, and a grid with none of them
    // allocates nothing at all per cell.
    const cellClass = column.cellClass;
    const onCellClass = model.options.onCellClass;
    let context: CellContext<R> | undefined;
    if (column.render || onCellClass || typeof cellClass === "function") {
        context = {
            value,
            row,
            column,
            rowIndex: dataRow,
            colIndex: p.col,
            rowKey: model.options.getRowKey(row),
            // A reference, not a closure: `highlightText` is built once per grid.
            highlight: model.highlightText,
        };
    }

    // The column's own class first, then the grid-wide hook, then the row's: narrowest to
    // widest, all additive. Nothing has to be removed — `className` is assembled from scratch on
    // every paint and assigned once, so a class that stops applying is simply not in the next
    // string. That matters more here than it looks: pooled cells arrive holding their last
    // occupant's classes.
    if (typeof cellClass === "string") className += ` ${cellClass}`;
    else if (cellClass && context) {
        className = appendClass(className, cellClass(context));
    }

    if (onCellClass && context) {
        className = appendClass(className, onCellClass(context));
    }

    const rowClass = model.options.rowClass;
    if (rowClass) {
        // A second small object, and only when the hook exists. It cannot be the cell context —
        // a row hook has no column, and handing it one invites a rule that reads it.
        className = appendClass(
            className,
            rowClass({
                row,
                rowIndex: dataRow,
                rowKey: model.options.getRowKey(row),
            }),
        );
    }

    if (el.className !== className) el.className = className;

    el.setAttribute("data-type", "data-cell");
    el.setAttribute("data-row", String(dataRow));
    el.setAttribute("data-col", String(p.col));
    el.setAttribute("data-column-key", String(column.key));

    // --- content -----------------------------------------------------------
    if (isEditing) {
        const editor = editing.editorElement();
        if (editor) {
            // Only when it is not already here: re-parenting an input is what would destroy
            // the caret, the text selection and any IME composition in flight. A repaint of
            // the editing cell — a hover, a selection change — must be free.
            if (editor.parentElement !== el) {
                setMode(el, "editor");
                el.appendChild(editor);
                editing.editorMounted();
            }
            applyCellStyle(el, p.style);
            return el;
        }
    } else if (editing.ownsCell(el)) {
        // This element held the open editor and is now being painted as a different cell —
        // it was recycled while the edit was open, which happens when the editing row is
        // scrolled far out of view. Commit rather than leave an editor nobody can reach.
        editing.releaseCell();
    }

    if (column.render && context) {
        const rendered = column.render(context);
        if (rendered === null || rendered === undefined) {
            setMode(el, "text");
            setText(el, "");
        } else if (typeof rendered === "string") {
            setMode(el, "html");
            if (el.innerHTML !== rendered) el.innerHTML = rendered;
        } else {
            setMode(el, "node");
            el.textContent = "";
            el.appendChild(rendered);
        }
    } else if (column.dataType === "boolean") {
        setMode(el, "bool");
        const checked = gridBoolean(value);
        // The glyph is chosen per *cell*, not per row: a row-wide swap would frame a box in every
        // boolean column at once when only one of them is under the pointer. `hovered.col` is
        // already tracked and the hovered row is already repainted on every hover move, so this
        // costs two comparisons rather than a repaint. Every branch is a constant, so a cell
        // whose state did not change compares equal and is not touched at all.
        let wanted: string;
        // A column with its own editor gets a tick and no box, even when editable: the box's
        // press is intercepted by `GridInteractions` and toggles, which would make the editor
        // unreachable by pointer.
        if (!editing.canEdit(column) || column.editor) {
            wanted = checked ? TICK : "";
        } else if (
            model.data.hovered.row === dataRow &&
            model.data.hovered.col === p.col
        ) {
            wanted = checked ? BOX_ON_HOVERED : BOX_OFF_HOVERED;
        } else {
            wanted = checked ? BOX_ON : BOX_OFF;
        }
        if (el.innerHTML !== wanted) el.innerHTML = wanted;
    } else {
        const text = displayText(column, row, value);
        // The search words are already split and lowercased on `data` — this is a length check
        // per cell, so a grid with no search pays for the feature exactly once per paint.
        const words = model.data.searchWords;
        const markup = words.length ? highlightMarkup(text, words) : null;
        if (markup === null) {
            setMode(el, "text");
            setText(el, text);
        } else {
            // `marked` rather than reading `innerHTML` back: the getter serialises the subtree,
            // and it would re-escape what we wrote, so the comparison would have to survive a
            // round trip it is not worth designing for. What we last assigned is known.
            if (setMode(el, "match")) marked.delete(el);
            if (marked.get(el) !== markup) {
                el.innerHTML = markup;
                marked.set(el, markup);
            }
        }
    }

    applyCellStyle(el, p.style);
    return el;
}

/** The reference's `DefaultCellFormater`, reduced to the string it ends up producing. */
function displayText<R>(column: Column<R>, row: R, value: unknown): string {
    if (column.formatValue || column.displayFormat) {
        const formatted = columnDisplayValue(column, row);
        return formatted === null || formatted === undefined
            ? ""
            : String(formatted);
    }
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    if (value instanceof Date) return formatDisplayValue(value);
    return String(value);
}
