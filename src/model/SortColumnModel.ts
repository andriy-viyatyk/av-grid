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
 *
 * **Arity follows `multiSort`** (task 48). With `multiSort: false` the state holds a single
 * `SortColumn` exactly as it always has, and every code path below the single-object branch is
 * the original one — RowsModel's sort-then-reverse for descending included. With
 * `multiSort: true` the state holds a non-empty `readonly SortColumn[]` (never an empty array —
 * unsorted is `undefined` internally, reported as `[]`), and the whole list resolves to **one
 * decorate tuple plus one composite comparator** with each level's direction folded in as a
 * sign. `RowsModel` needs no multi-sort knowledge: an array has no `.direction`, so its
 * reverse-for-descending step naturally does not fire, and the tuple rides the existing
 * `sortValue` decorate-sort-undecorate path — which is also what keeps `Column.sortValue`'s
 * O(n) contract in a multi-sort instead of degrading to O(n log n) calls per level.
 */

import { defaultCompare, sortAsList, sortEquals } from "../gridUtils";
import type { RowCompare, SortColumn, SortState } from "../types";
import type { AVGridDataChangeEvent } from "./AVGridData";
import type { AVGridModel } from "./AVGridModel";

export class SortColumnModel<R> {
    readonly model: AVGridModel<R>;

    constructor(model: AVGridModel<R>) {
        this.model = model;
        this.model.data.onChange.subscribe(this.onDataChange);
        this.model.events.onSortColumn.subscribe(({ columnKey, append }) =>
            this.sortColumn(columnKey, append),
        );
    }

    get sort(): SortState | undefined {
        return this.model.state.get().sort;
    }

    /** The sort as a list, whichever arity the state holds. `[]` when unsorted. */
    get sortList(): readonly SortColumn[] {
        return sortAsList(this.model.state.get().sort);
    }

    /**
     * A header click. Plain: reset the sort to this column, cycling
     * unsorted → ascending → descending → unsorted when it is already the *only* sorted
     * column — the exact original behavior. `append` (Ctrl/Cmd+click, honored only with
     * `multiSort` on): add this column ascending, cycle it to descending, then remove it from
     * the list, leaving the other sorted columns alone.
     */
    sortColumn = (columnKey: string | keyof R, append = false): void => {
        if (this.model.options.disableSorting) return;

        const key = String(columnKey);
        const list = this.sortList;
        let next: SortColumn[];

        if (append && this.model.options.multiSort) {
            next = [...list];
            const i = next.findIndex((s) => s.key === key);
            if (i < 0) next.push({ key, direction: "asc" });
            else if (next[i].direction === "asc")
                next[i] = { key, direction: "desc" };
            else next.splice(i, 1);
        } else if (list.length === 1 && list[0].key === key) {
            next =
                list[0].direction === "asc"
                    ? [{ key, direction: "desc" }]
                    : [];
        } else {
            next = [{ key, direction: "asc" }];
        }

        this.store(next);
        this.sortChanged();
    };

    /**
     * Set the sort directly. `undefined` (or `[]`) clears it. Guards on **value**, element by
     * element — the guard is what makes the host-state round trip terminate, in either arity.
     */
    setSort = (sort: SortState | undefined): void => {
        const current = this.model.state.get().sort;
        if (sortEquals(current, sort)) return;

        this.store(sortAsList(sort));
        this.sortChanged();
    };

    /**
     * What `onSortChange` reports and `getSort()` returns: arity-correct for the mode.
     * `multiSort` reports an array always (`[]` when unsorted); single mode reports the one
     * object or `undefined`, exactly as before the option existed.
     */
    get reported(): SortState | undefined {
        const sort = this.model.state.get().sort;
        return this.model.options.multiSort
            ? sortAsList(sort)
            : (sort as SortColumn | undefined);
    }

    /** Re-normalize the stored arity after a `setOptions({ multiSort })` flip. */
    normalizeArity = (): void => {
        this.store(this.sortList);
    };

    /** Store arity-correct: never an empty array, never an array in single mode. */
    private store = (list: readonly SortColumn[]): void => {
        const multi = Boolean(this.model.options.multiSort);
        this.model.state.update((s) => {
            s.sort =
                list.length === 0 ? undefined : multi ? list : list[0];
        });
    };

    private sortChanged = (): void => {
        const before = this.model.data.rowCompare;
        const beforeSortValue = this.model.data.sortValue;
        this.updateRowCompare();

        // `defaultCompare` is memorized by key, so flipping asc → desc resolves to the *same*
        // comparator — `AVGridData` reports no change and `RowsModel` never hears about it.
        // The reference did not have this hole: its `useEffect` watched the sort object, not
        // the comparator, so any change to either re-ran the pipeline. Re-run it here for the
        // direction-only case, and leave the key-change case to the data event.
        //
        // The projection has to be in the comparison for the same reason: two columns with a
        // `sortValue` both resolve to the *value* comparator, so the identity that moved is the
        // projection's, not the comparator's.
        //
        // (The multi-sort path builds fresh closures on every resolve, so its identity always
        // changes and this fallback never fires for it — harmless, but worth knowing.)
        if (
            this.model.data.rowCompare === before &&
            this.model.data.sortValue === beforeSortValue
        ) {
            this.model.models.rows.updateRows();
        }

        this.model.options.onSortChange?.(this.reported);
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
     * watches. `defaultCompare` is memorized by key, so re-resolving the same single-column
     * sort produces the same function identity and `AVGridData` reports no change.
     */
    private updateRowCompare = (): void => {
        let rowCompare: RowCompare<R> | undefined;
        let sortValue: ((row: R) => any) | undefined;
        const sort = this.model.state.get().sort;

        if (sort !== undefined && Array.isArray(sort)) {
            // Multi-sort: one decorate tuple, one composite comparator. Direction lives here
            // as a per-level sign — RowsModel sees no `.direction` on an array and never
            // reverses. A level with a `rowCompare` puts the *row* in its tuple slot, so the
            // pairwise contract holds; every other level pre-projects its value once per row.
            const compareValues = defaultCompare();
            const levels = (sort as readonly SortColumn[]).map(
                ({ key, direction }) => {
                    const col = this.model.data.columns.find(
                        (c) => String(c.key) === key,
                    );
                    return {
                        sign: direction === "desc" ? -1 : 1,
                        rowCompare: col?.rowCompare,
                        value:
                            col?.rowCompare
                                ? undefined
                                : (col?.sortValue ??
                                  ((row: R) => (row as any)[key])),
                    };
                },
            );
            sortValue = (row: R) =>
                levels.map((l) => (l.value ? l.value(row) : row));
            rowCompare = (a: any, b: any): number => {
                for (let i = 0; i < levels.length; i++) {
                    const l = levels[i];
                    const c = l.rowCompare
                        ? l.rowCompare(a[i], b[i])
                        : compareValues(a[i], b[i]);
                    if (c) return l.sign * c;
                }
                return 0;
            };
        } else if (sort) {
            const single = sort as SortColumn;
            const col = this.model.data.columns.find(
                (c) => String(c.key) === single.key,
            );
            if (col?.rowCompare) {
                rowCompare = col.rowCompare;
            } else if (col?.sortValue) {
                // `defaultCompare()` with no key compares the values handed to it, which is what
                // the projected sort values are. Memorized like the keyed form, so this identity
                // is stable across re-resolutions.
                sortValue = col.sortValue;
                rowCompare = defaultCompare();
            } else {
                rowCompare = defaultCompare(single.key);
            }
        }

        this.model.data.sortValue = sortValue;
        this.model.data.rowCompare = rowCompare;
        this.model.data.change();
    };
}
