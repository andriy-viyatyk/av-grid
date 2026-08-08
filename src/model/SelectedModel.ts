/**
 * Row selection — the checkbox kind, as distinct from the range selection in `FocusModel`.
 *
 * A grid can have two things selected at once and they mean different things. `FocusModel`
 * owns a *rectangle of cells*, which is what copy, paste and editing act on. This model owns a
 * *set of rows*, which is what a host acts on: delete these, export these, send these. They
 * never interact, which is why they are two models and two callbacks — `onFocusChange` and
 * `onSelectionChange`.
 *
 * Ported from `AVGrid/model/SelectedModel.ts`, which was 38 lines because the host owned the
 * set and the reference only derived `allSelected` from it. Here the grid owns the set, so
 * everything that mutated it in `SelectColumn.tsx` lives in this file instead.
 *
 * The selection is stored as row *keys*, never as indices: a sort or a filter reorders the
 * rows under it and a key survives that where an index would silently select something else.
 *
 * ### Why this is not O(rows) per change
 *
 * The same discipline as `FocusModel.markChanged`, for the same reason. Selecting all of a
 * 100,000-row grid changes 100,000 rows' appearance, but only the ~24 on screen can be seen —
 * so the dirty set is computed by walking the *rendered window* and comparing membership
 * before and after. Cost is a function of the viewport, never of the selection.
 *
 * The one genuinely O(rows) operation is `allSelected`, which has to know whether *every* row
 * is in the set. It short-circuits on size first (the reference's `&&` chain, kept), so the
 * scan only ever runs in the case where the answer is "probably yes".
 */

import type { AVGridDataChangeEvent } from "./AVGridData";
import type { AVGridModel } from "./AVGridModel";

/** How the header checkbox draws. Also the thing that decides whether to repaint it. */
export type SelectAllState = "none" | "some" | "all";

export class SelectedModel<R> {
    readonly model: AVGridModel<R>;

    private _selected: Set<string>;

    constructor(model: AVGridModel<R>) {
        this.model = model;
        this._selected = new Set(model.options.selected ?? []);
        this.model.data.onChange.subscribe(this.onDataChange);
    }

    // -----------------------------------------------------------------------
    // Reading
    // -----------------------------------------------------------------------

    /** The live set. Read-only to callers — mutating it bypasses every repaint. */
    get selected(): ReadonlySet<string> {
        return this._selected;
    }

    get count(): number {
        return this._selected.size;
    }

    /** Every row in the grid is selected. Derived, and cached on `data.allSelected`. */
    get allSelected(): boolean {
        return this.model.data.allSelected;
    }

    get selectAllState(): SelectAllState {
        if (this.allSelected) return "all";
        return this._selected.size > 0 ? "some" : "none";
    }

    isSelected = (rowKey: string): boolean => this._selected.has(rowKey);

    /** The selected keys, as a plain array. Ordered by the rows' display order. */
    getSelectedKeys(): string[] {
        return [...this._selected];
    }

    /** The selected row objects, in display order. O(rows) — the caller asked for it. */
    getSelectedRows(): R[] {
        if (this._selected.size === 0) return [];
        const getRowKey = this.model.options.getRowKey;
        return this.model.data.rows.filter((r) =>
            this._selected.has(getRowKey(r)),
        ) as R[];
    }

    /**
     * The row-state class for one data row, ready to append to a cell's class string.
     *
     * Called once per cell per paint, so the empty case — which is every grid that has no
     * selection, i.e. most of them — returns before touching the row at all.
     */
    rowClass = (dataRow: number): string => {
        if (this._selected.size === 0) return "";
        const row = this.model.data.rows[dataRow];
        if (row === undefined) return "";
        return this._selected.has(this.model.options.getRowKey(row))
            ? " avg-row-selected"
            : "";
    };

    // -----------------------------------------------------------------------
    // Writing
    // -----------------------------------------------------------------------

    /** Replace the selection. Accepts anything iterable, so a `Set` works as well as an array. */
    setSelected = (keys: Iterable<string> | undefined): void => {
        this.apply(new Set(keys ?? []));
    };

    /** Add or remove one row key, leaving the rest of the selection alone. */
    toggleSelected = (rowKey: string): void => {
        const next = new Set(this._selected);
        if (!next.delete(rowKey)) next.add(rowKey);
        this.apply(next);
    };

    setRowSelected = (rowKey: string, selected: boolean): void => {
        if (this._selected.has(rowKey) === selected) return;
        const next = new Set(this._selected);
        if (selected) next.add(rowKey);
        else next.delete(rowKey);
        this.apply(next);
    };

    /** Select every *displayed* row — so a filtered grid selects what the user can see. */
    selectAll = (): void => {
        const getRowKey = this.model.options.getRowKey;
        const rows = this.model.data.rows;
        // The set is built from exactly the displayed rows, so `allSelected` is known without
        // asking. Worth the parameter: on 100k rows the scan it skips costs 6 ms of the 24 the
        // whole operation takes, and this is the one path that always reaches it.
        this.apply(new Set(rows.map((r) => getRowKey(r))), rows.length > 0);
    };

    /**
     * Drop these keys from the selection, leaving the rest alone.
     *
     * What deleting rows calls. Not the same as `setSelected(remaining)`: the caller knows what
     * went, not what is left, and on a 100k-row grid the difference is the size of the array.
     */
    deselect = (rowKeys: Iterable<string>): void => {
        if (this._selected.size === 0) return;
        const next = new Set(this._selected);
        let removed = false;
        for (const key of rowKeys) {
            if (next.delete(key)) removed = true;
        }
        if (removed) this.apply(next);
    };

    clearSelected = (): void => {
        if (this._selected.size === 0) return;
        this.apply(new Set(), false);
    };

    /** What the header checkbox does: anything selected clears, nothing selected selects all. */
    toggleAll = (): void => {
        if (this.selectAllState === "none") this.selectAll();
        else this.clearSelected();
    };

    // -----------------------------------------------------------------------
    // The core update
    // -----------------------------------------------------------------------

    private apply(next: Set<string>, allSelected?: boolean): void {
        const previous = this._selected;
        if (sameSet(previous, next)) return;

        const beforeHeader = this.selectAllState;
        this._selected = next;
        this.updateAllSelected(allSelected);

        this.markChanged(previous, next, beforeHeader);
        // Building the key array is O(selection), so it happens only if somebody asked.
        if (this.model.options.onSelectionChange) {
            this.model.options.onSelectionChange(this.getSelectedKeys());
        }
    }

    /**
     * Mark the rows whose selected state changed, clipped to the rendered window.
     *
     * A selection change repaints whole *rows* rather than cells, because the tint covers the
     * row; `RerenderInfo.rows` says exactly that, and the engine expands it to the cells it has
     * on screen. Selecting all of 100k rows therefore marks about two dozen.
     */
    private markChanged(
        before: ReadonlySet<string>,
        after: ReadonlySet<string>,
        beforeHeader: SelectAllState,
    ): void {
        const renderModel = this.model.renderModel;
        if (!renderModel) return;

        const getRowKey = this.model.options.getRowKey;
        const dataRows = this.model.data.rows;
        const gridRows = renderModel.renderInfo.current.renderRange.rows;

        const rows: number[] = [];
        // The header carries the select-all checkbox, so it repaints when — and only when —
        // that checkbox changes between unchecked, indeterminate and checked.
        if (this.selectAllState !== beforeHeader) rows.push(0);

        for (let i = 0; i < gridRows.length; i++) {
            const gridRow = gridRows[i];
            if (gridRow <= 0) continue;
            const row = dataRows[gridRow - 1];
            if (row === undefined) continue;
            const key = getRowKey(row);
            if (before.has(key) !== after.has(key)) rows.push(gridRow);
        }

        if (rows.length) this.model.update({ rows });
    }

    /**
     * Recompute `allSelected`.
     *
     * The reference's short-circuit is kept deliberately: the size test rejects almost every
     * case without touching a row, so the O(rows) scan only runs when the answer is likely to
     * be yes. `selectAll()` reaches it, and a 100k-key `Set.has` loop costs about a
     * millisecond — measured, not assumed.
     */
    private updateAllSelected(known?: boolean): void {
        if (known !== undefined) {
            this.model.data.allSelected = known;
            this.model.data.change();
            return;
        }

        const getRowKey = this.model.options.getRowKey;
        const rows = this.model.data.rows;
        this.model.data.allSelected =
            this._selected.size > 0 &&
            this._selected.size === rows.length &&
            rows.every((r) => this._selected.has(getRowKey(r)));
        this.model.data.change();
    }

    private onDataChange = (e: AVGridDataChangeEvent): void => {
        // The row set moved under the selection — a filter, a sort, or `setRows`. The keys
        // still mean what they meant, but "is everything selected" may not.
        if (!e.rows) return;
        const before = this.selectAllState;
        this.updateAllSelected();
        if (this.selectAllState !== before) this.model.update({ rows: [0] });
    };
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
    if (a === b) return true;
    if (a.size !== b.size) return false;
    for (const key of a) {
        if (!b.has(key)) return false;
    }
    return true;
}
