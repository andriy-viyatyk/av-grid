/**
 * Which rows are displayed, in what order.
 *
 * Ported from `AVGrid/model/RowsModel.ts`. The two `useEffect`s that re-ran the pipeline when
 * `rows`, `searchString`, `filters` or the sort changed become one method, `updateRows()`,
 * called from the places those things can actually change.
 *
 * The pipeline is filter → sort, and it always starts from `options.rows` rather than from
 * the previous result, so removing a filter restores rows that a previous pass dropped.
 *
 * `filterRows` returns the *same array* when there is nothing to apply, so an unsorted,
 * unfiltered `setRows()` on 100k rows copies nothing.
 */

import { filterRows } from "../gridUtils";
import type { SortDirection } from "../types";
import type { AVGridDataChangeEvent } from "./AVGridData";
import type { AVGridModel } from "./AVGridModel";

export class RowsModel<R> {
    readonly model: AVGridModel<R>;

    constructor(model: AVGridModel<R>) {
        this.model = model;
        this.model.data.onChange.subscribe(this.onDataChange);
        this.model.events.onRowsAdded.subscribe(this.onRowsAdded);
        this.model.events.onRowsDeleted.subscribe(this.onRowsDeleted);
    }

    /** +1 for the header, which the engine renders as grid row 0. */
    get rowCount(): number {
        return this.model.data.rows.length + 1;
    }

    /**
     * Hold the current row order steady while the user edits.
     *
     * Without it, editing the cell a grid is sorted or filtered by makes the row jump out
     * from under the cursor. Task 12 turns this on during an edit; nothing calls it yet.
     */
    freezeRows = (): void => {
        const { searchString, filters } = this.model.options;
        const sort = this.model.state.get().sort;

        if (!sort && !searchString?.length && !filters?.length) {
            // Nothing reorders the rows, so there is nothing to freeze.
            return;
        }

        this.model.data.rowsFrozen = true;
        this.model.data.change();
        this.model.update({ rows: [0] });
    };

    unfreezeRows = (): void => {
        if (!this.model.data.rowsFrozen) return;

        this.model.data.rowsFrozen = false;
        this.model.data.change();
        this.model.update({ rows: [0] });
        this.updateRows();
    };

    /** Re-run filter → sort and hand the result to the render layer. */
    updateRows = (): void => {
        if (this.model.data.rowsFrozen) {
            this.updateFrozenRows();
            return;
        }

        const direction = this.model.state.get().sort?.direction;
        let rows: readonly R[] = this.model.options.rows;
        rows = this.filter(rows);
        rows = this.sort(rows, direction);

        const changed = rows !== this.model.data.rows;
        this.model.data.rows = rows;
        this.model.data.change();
        this.model.update({ all: true });

        // `renderModel` is null only during the first pass, which runs inside the AVGridModel
        // constructor — before `create()` has returned, so nobody could have subscribed yet.
        if (changed && this.model.renderModel) {
            this.model.options.onVisibleRowsChange?.(rows);
        }
    };

    private filter = (rows: readonly R[]): readonly R[] =>
        filterRows(
            rows,
            this.model.data.columns,
            this.model.options.searchString,
            this.model.options.filters,
        );

    private sort = (
        rows: readonly R[],
        direction?: SortDirection,
    ): readonly R[] => {
        const rowCompare = this.model.data.rowCompare;
        if (!rowCompare) return rows;

        const sorted = [...rows];
        sorted.sort(rowCompare);
        // Sorting then reversing, rather than negating the comparator, is the reference's
        // choice and is kept: it makes a descending sort stable in the same way an ascending
        // one is, only mirrored.
        return direction === "desc" ? sorted.reverse() : sorted;
    };

    private onDataChange = (e: AVGridDataChangeEvent): void => {
        if (e.rowCompare) {
            // A new sort invalidates the frozen order, then re-runs the pipeline.
            if (this.model.data.rowsFrozen) this.unfreezeRows();
            else this.updateRows();
        }

        if (e.columns) {
            // Column changes matter because the search string is matched against the
            // *displayed* value of every column.
            this.updateRows();
        }

        if (e.rows) {
            this.model.requestRepaint();
        }
    };

    /**
     * While frozen, new row *objects* are adopted in place — same order, same positions — so
     * an edit updates the cell without the row moving.
     */
    private updateFrozenRows = (): void => {
        if (!this.model.data.rowsFrozen) return;

        const getRowKey = this.model.options.getRowKey;
        const visibleRowsKeys = this.model.data.rows.reduce(
            (acc, row, idx) => {
                acc[getRowKey(row)] = idx;
                return acc;
            },
            {} as Record<string, number>,
        );

        const newRows = [...this.model.data.rows];
        this.model.options.rows.forEach((row) => {
            const idx = visibleRowsKeys[getRowKey(row)];
            if (idx !== undefined) newRows[idx] = row;
        });

        this.model.data.rows = newRows;
        this.model.data.change();
        this.model.update({ all: true });
    };

    /**
     * While frozen, added rows are placed by hand — the pipeline is not going to re-run and
     * put them anywhere. At the display index the caller asked for, so a row inserted in the
     * middle of a sorted grid appears where it was inserted rather than at the end.
     */
    private onRowsAdded = ({
        rows,
        insertIndex,
    }: {
        rows: R[];
        insertIndex?: number;
    }): void => {
        if (!this.model.data.rowsFrozen) return;
        const next = [...this.model.data.rows];
        next.splice(insertIndex ?? next.length, 0, ...rows);
        this.model.data.rows = next;
    };

    private onRowsDeleted = ({ rowKeys }: { rowKeys: string[] }): void => {
        if (!this.model.data.rowsFrozen) return;
        const getRowKey = this.model.options.getRowKey;
        this.model.data.rows = this.model.data.rows.filter(
            (row) => !rowKeys.includes(getRowKey(row)),
        );
    };
}
