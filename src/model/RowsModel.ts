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

        this.clearFreeze();
        this.updateRows();
    };

    /**
     * Re-run the pipeline, ending any freeze first.
     *
     * What a filter, a search string or a sort change calls, because each of them *is* the
     * reason the freeze existed: the order the user asked to hold steady is the one they have
     * just replaced. Without this a filter cleared during an edit left the edited rows on
     * screen — `updateRows()` short-circuits into `updateFrozenRows()` while frozen, which
     * adopts new row objects in place and re-filters nothing. The reference unfreezes from a
     * `useEffect` on `[searchString, filters, sortColumn]`; this is that effect, called from
     * the three places those can change.
     */
    refilterRows = (): void => {
        this.clearFreeze();
        this.updateRows();
    };

    private clearFreeze = (): void => {
        if (!this.model.data.rowsFrozen) return;

        this.model.data.rowsFrozen = false;
        this.model.data.change();
        this.model.update({ rows: [0] });
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

    /**
     * `options.filters` is read, not owned: `FiltersModel` is the only thing that writes it,
     * and calls `updateRows()` when it does. This model's job is which rows survive, never
     * which filters are applied.
     */
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

        const sortValue = this.model.data.sortValue;
        let sorted: R[];
        if (sortValue) {
            sorted = this.sortByValue(rows, sortValue, rowCompare);
        } else {
            sorted = [...rows];
            sorted.sort(rowCompare);
        }
        // Sorting then reversing, rather than negating the comparator, is the reference's
        // choice and is kept: it makes a descending sort stable in the same way an ascending
        // one is, only mirrored.
        return direction === "desc" ? sorted.reverse() : sorted;
    };

    /**
     * Decorate, sort, undecorate — the classic transform, and the reason `Column.sortValue`
     * exists as well as `rowCompare`.
     *
     * `Array.sort` calls its comparator O(n log n) times, so a projection read *inside* one runs
     * about 1.7 million times on 100,000 rows. Read into a parallel array first and it runs n
     * times, and the comparisons that follow are over plain values. The cost is one wrapper object
     * per row, which is why this is not how an ordinary sort works: it is a trade that only pays
     * when the projection is host code.
     */
    private sortByValue = (
        rows: readonly R[],
        sortValue: (row: R) => any,
        rowCompare: (left: any, right: any) => number,
    ): R[] => {
        const decorated = rows.map((row) => ({ row, value: sortValue(row) }));
        decorated.sort((a, b) => rowCompare(a.value, b.value));
        return decorated.map((d) => d.row);
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
