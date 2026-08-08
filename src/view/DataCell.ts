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
 *   `formatValue` or `onCellClass` hook actually needs one — the default path never
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
import { checkIcon } from "./icons";
import { applyCellStyle, setText } from "./cellDom";

type ContentMode = "text" | "bool" | "html" | "node";

const mode = new WeakMap<HTMLElement, ContentMode>();

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

    // `onCellClass` and `render` are the only two hooks that need a context object; when
    // neither is set, the default path allocates nothing at all.
    let context: CellContext<R> | undefined;
    if (column.render || model.options.onCellClass) {
        context = {
            value,
            row,
            column,
            rowIndex: dataRow,
            colIndex: p.col,
            rowKey: model.options.getRowKey(row),
        };
    }

    if (model.options.onCellClass && context) {
        const extra = model.options.onCellClass(context);
        if (extra) className += ` ${extra}`;
    }

    if (el.className !== className) el.className = className;

    el.setAttribute("data-type", "data-cell");
    el.setAttribute("data-row", String(dataRow));
    el.setAttribute("data-col", String(p.col));
    el.setAttribute("data-column-key", String(column.key));

    // --- content -----------------------------------------------------------
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
        // A boolean column shows a check or nothing — never the word "false".
        setMode(el, "bool");
        const checked = gridBoolean(value);
        const wanted = checked ? checkIcon : "";
        if (el.innerHTML !== wanted) el.innerHTML = wanted;
        if (checked) {
            (el.firstElementChild as HTMLElement | null)?.classList.add(
                "avg-check-icon",
            );
        }
    } else {
        setMode(el, "text");
        setText(el, displayText(column, row, value));
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
