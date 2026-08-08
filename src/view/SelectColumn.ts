/**
 * The row-selection checkbox column.
 *
 * A rewrite of `SelectColumn.tsx`, which was two React components wrapping UIKit's
 * `IconButton`. Here it is what the public API already offers a host: an ordinary `Column`
 * whose `render` and `headerRender` hooks return markup. Nothing about it is privileged, and a
 * host could write the same column by hand — which is the honest test of whether those two
 * hooks are good enough.
 *
 * Two departures from the reference, both forced by pooling and both already established for
 * every other cell:
 *
 * - **No listeners on the checkbox.** The reference put `onClick` on each `IconButton`. Here
 *   `GridInteractions` resolves a click on this column by its `data-column-key` and calls the
 *   model. A pooled element that was a checkbox one frame is a text cell the next.
 * - **No state on the element.** Checked-ness comes from `SelectedModel` on every paint, so a
 *   repaint can never show a stale box.
 *
 * The reference also filtered `r.isRestricted` out of select-all. That is a Persephone row
 * shape, not a grid concept, so it is not ported: a host that needs it calls `setSelected()`
 * with the rows it will accept.
 */

import type { Column } from "../types";
import type { AVGridModel } from "../model/AVGridModel";
import { checkedIcon, indeterminateIcon, uncheckedIcon } from "./icons";

/**
 * The select column's key. Deliberately not a valid property name, so it can never collide
 * with a real column, and stable so a host can recognise it in `getColumns()` or skip it in an
 * `onCellClick`. Same value as the reference.
 */
export const SELECT_COLUMN_KEY = "--select-column--";

const CHECKED = `<span class="avg-select-box avg-checked">${checkedIcon}</span>`;
const UNCHECKED = `<span class="avg-select-box">${uncheckedIcon}</span>`;
const INDETERMINATE = `<span class="avg-select-box avg-checked">${indeterminateIcon}</span>`;

/**
 * Build the column bound to one grid.
 *
 * Created once per grid and reused, so the column's identity is stable across every
 * `updateColumnsData` — a new object each time would make `AVGridData` report a column change
 * on every repaint.
 */
export function createSelectColumn<R>(model: AVGridModel<R>): Column<R> {
    return {
        key: SELECT_COLUMN_KEY,
        name: "",
        width: 32,
        isStatusColumn: true,
        resizable: false,
        readonly: true,
        align: "center",

        headerRender: () => {
            switch (model.models.selected.selectAllState) {
                case "all":
                    return CHECKED;
                case "some":
                    return INDETERMINATE;
                default:
                    return UNCHECKED;
            }
        },

        render: (cell) =>
            model.models.selected.isSelected(cell.rowKey) ? CHECKED : UNCHECKED,
    };
}
