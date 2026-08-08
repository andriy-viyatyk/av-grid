/**
 * Sort state, and the comparator it resolves to.
 *
 * Ported from `AVGrid/model/SortColumnModel.ts`. The `useEffect` that recomputed the
 * comparator whenever the sort changed becomes a direct call at the end of every mutation —
 * there is exactly one place the sort can change, so there is nothing to synchronize.
 *
 * The model deliberately owns only *which* column sorts, not the sorted rows. `RowsModel`
 * owns those, and reacts to `data.rowCompare` changing. Keeping the split means task 15's
 * filters can join the same pipeline without either model learning about the other.
 */

import { defaultCompare } from "../gridUtils";
import type { RowCompare, SortColumn } from "../types";
import type { AVGridDataChangeEvent } from "./AVGridData";
import type { AVGridModel } from "./AVGridModel";

export class SortColumnModel<R> {
    readonly model: AVGridModel<R>;

    constructor(model: AVGridModel<R>) {
        this.model = model;
        this.model.data.onChange.subscribe(this.onDataChange);
        this.model.events.onSortColumn.subscribe(({ columnKey }) =>
            this.sortColumn(columnKey),
        );
    }

    get sort(): SortColumn | undefined {
        return this.model.state.get().sort;
    }

    /** Cycle one column: unsorted → ascending → descending → unsorted. */
    sortColumn = (columnKey: string | keyof R): void => {
        if (this.model.options.disableSorting) return;

        this.model.state.update((s) => {
            if (s.sort?.key === (columnKey as string)) {
                s.sort =
                    s.sort.direction === "desc"
                        ? undefined
                        : { key: columnKey as string, direction: "desc" };
            } else {
                s.sort = { key: columnKey as string, direction: "asc" };
            }
        });

        this.sortChanged();
    };

    /** Set the sort directly. `undefined` clears it. */
    setSort = (sort: SortColumn | undefined): void => {
        const current = this.model.state.get().sort;
        if (current?.key === sort?.key && current?.direction === sort?.direction) {
            return;
        }
        this.model.state.update((s) => {
            s.sort = sort;
        });
        this.sortChanged();
    };

    private sortChanged = (): void => {
        const before = this.model.data.rowCompare;
        this.updateRowCompare();

        // `defaultCompare` is memorized by key, so flipping asc → desc resolves to the *same*
        // comparator — `AVGridData` reports no change and `RowsModel` never hears about it.
        // The reference did not have this hole: its `useEffect` watched the sort object, not
        // the comparator, so any change to either re-ran the pipeline. Re-run it here for the
        // direction-only case, and leave the key-change case to the data event.
        if (this.model.data.rowCompare === before) {
            this.model.models.rows.updateRows();
        }

        this.model.options.onSortChange?.(this.model.state.get().sort);
        // The header cell of every column shows a sort indicator, so the whole header row is
        // dirty — one row, not the viewport.
        this.model.update({ rows: [0] });
    };

    private onDataChange = (e: AVGridDataChangeEvent): void => {
        // A new column set may carry a different `rowCompare` for the sorted column.
        if (e.columns) this.updateRowCompare();
    };

    /**
     * Resolve the sort to a comparator on `data.rowCompare`, which is what `RowsModel`
     * watches. `defaultCompare` is memorized by key, so re-resolving the same sort produces
     * the same function identity and `AVGridData` reports no change.
     */
    private updateRowCompare = (): void => {
        let rowCompare: RowCompare<R> | undefined;
        const sort = this.model.state.get().sort;

        if (sort) {
            const col = this.model.data.columns.find(
                (c) => String(c.key) === sort.key,
            );
            rowCompare = col?.rowCompare ?? defaultCompare(sort.key);
        }

        this.model.data.rowCompare = rowCompare;
        this.model.data.change();
    };
}
