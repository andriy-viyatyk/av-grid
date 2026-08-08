/**
 * Rows and columns added and removed — changes to the grid's *shape* rather than its values.
 *
 * This is where `AVGridActions.ts` finally landed. The reference class was deferred twice
 * (tasks 10 and 12) because everything else on it turned out to be direct event wiring; what
 * was left was `addRows` / `addNewRow` / `addNewColumns` / `deleteRows` / `deleteColumns`, and
 * those five are this file. `AVGridActions` itself is not ported: the name says "actions"
 * without saying which, and half its members already live where they belong.
 *
 * The semantics diverge from the reference in the same way `onEdit` does, and for the same
 * reason. There, `onAddRows` was the host *producing* rows for a grid that owned none:
 *
 * ```ts
 * onAddRows: (count, insertIndex) => R[]     // reference — the host makes the rows
 * ```
 *
 * Here the grid owns its rows, so it makes them and the callback *observes*, with `false` to
 * refuse:
 *
 * ```js
 * onAddRows: (e) => { e.rows.forEach(fill); }        // fill them in
 * onDeleteRows: (e) => confirm(`Delete ${e.rows.length}?`)   // or refuse
 * ```
 *
 * Three things every path through here has to get right:
 *
 * 1. **Adding while sorted or filtered freezes the row order.** A blank row inserted into a
 *    sorted grid sorts to wherever an empty field belongs — usually the top or the bottom,
 *    never where the user put it — and a filtered grid drops it outright, so the user clicks
 *    *add row* and nothing appears. `freezeRows()` holds the order until the sort changes.
 * 2. **The index is a display index.** Everything public in this library counts displayed rows;
 *    `sourceIndex` translates once, at the boundary.
 * 3. **A deleted row is deselected.** Its key would otherwise sit in the checkbox selection
 *    matching nothing, and `getSelected().length` would stop agreeing with
 *    `getSelectedRows().length`.
 */

import type { Column } from "../types";
import { inferRowKeyProperty } from "../validate";
import type { AVGridModel } from "./AVGridModel";

export class StructureModel<R> {
    readonly model: AVGridModel<R>;

    /** Counter behind the default `newRow` / `newColumn` keys. Per grid, so it stays short. */
    private nextPlaceholder = 1;
    private rowKeyProperty?: string | null;

    constructor(model: AVGridModel<R>) {
        this.model = model;
        this.model.events.content.onKeyDown.subscribe(this.onContentKeyDown);
    }

    // -----------------------------------------------------------------------
    // Rows
    // -----------------------------------------------------------------------

    /**
     * Insert rows at a display index, or append when the index is omitted.
     *
     * Returns the rows that were inserted — empty when `onAddRows` refused them.
     */
    addRows = (rows: R[], index?: number, withFocus = false): R[] => {
        if (!rows.length) return [];

        const displayed = this.model.data.rows;
        const at =
            index === undefined
                ? displayed.length
                : Math.max(0, Math.min(index, displayed.length));

        if (this.model.options.onAddRows?.({ rows, index: at }) === false) return [];

        this.model.models.rows.freezeRows();

        const source = [...this.model.options.rows];
        source.splice(this.sourceIndex(at), 0, ...rows);
        this.model.options.rows = source;

        // Inserting above the focused row shifts its index, and `FocusModel` follows it — by
        // scrolling it back to *centre*, which yanks the viewport for a change the user did not
        // make. This flag is the reference's, and suppressing exactly one revalidation is what
        // it is for. Set before `updateRows`, which is what triggers the revalidation.
        this.model.flags.noScrollOnFocus = true;

        // Frozen rows are maintained through this event by `RowsModel`, which splices them in
        // at the same display index; unfrozen ones are recomputed by `updateRows` below.
        this.model.events.onRowsAdded.send({ rows, insertIndex: at });
        this.model.models.rows.updateRows();

        if (withFocus) {
            this.model.models.focus.focusNewRows(
                at,
                rows.length,
                this.model.models.focus.focus,
            );
            this.model.renderModel?.scrollToRow(
                this.model.dataRowToGridRow(at + rows.length - 1),
            );
        }

        return rows;
    };

    /** Insert `count` blank rows, built by `options.newRow`. */
    addBlankRows = (count = 1, index?: number, withFocus = true): R[] => {
        if (count < 1) return [];
        const displayed = this.model.data.rows;
        const at = index === undefined ? displayed.length : index;
        const rows = Array.from({ length: count }, (_, i) => this.blankRow(at + i));
        return this.addRows(rows, index, withFocus);
    };

    /**
     * One blank row at the end, as a side effect of navigating off it — ArrowDown or Tab past
     * the last cell.
     *
     * Marked as *the* new row, and no second one is offered until it has been edited. Without
     * that, holding ArrowDown at the bottom of the grid manufactures a hundred empty rows,
     * which is the reference's guard and worth keeping.
     */
    addTrailingRow = (): R[] => {
        if (!this.canAddRows || this.model.data.newRowKey) return [];
        const rows = this.addBlankRows(1, undefined, false);
        if (rows.length) {
            this.model.data.newRowKey = this.model.options.getRowKey(rows[0]);
            this.model.data.change();
        }
        return rows;
    };

    /** Delete rows by key. Returns whether anything went. */
    deleteRows = (rowKeys: string[], withFocus = false): boolean => {
        if (!rowKeys.length) return false;

        const keys = new Set(rowKeys);
        const getRowKey = this.model.options.getRowKey;

        // One pass, not two: `getRowKey` is a host callback and the source array is however
        // long the host's data is. Splitting it into "what goes" and "what stays" here means a
        // 100k-row delete calls it 100k times rather than 200k.
        const rows: R[] = [];
        const kept: R[] = [];
        for (const row of this.model.options.rows) {
            (keys.has(getRowKey(row)) ? rows : kept).push(row);
        }
        if (!rows.length) return false;

        if (
            this.model.options.onDeleteRows?.({
                rows,
                rowKeys: rows.map(getRowKey),
            }) === false
        ) {
            return false;
        }

        // Read before the rows go, so the focus can land where the deleted block was.
        const { minRow, minCol } = this.model.models.focus.selectedCount;

        // An open editor on a row that is about to stop existing would commit into it on blur.
        if (this.model.models.editing.isEditing) {
            this.model.models.editing.cancelEdit();
        }

        this.model.options.rows = kept;
        if (this.model.data.newRowKey && keys.has(this.model.data.newRowKey)) {
            this.model.data.newRowKey = undefined;
        }
        this.model.models.selected.deselect(rowKeys);
        this.model.events.onRowsDeleted.send({ rowKeys });
        // As in `addRows`: the surviving focus must not drag the viewport after it.
        this.model.flags.noScrollOnFocus = true;
        this.model.models.rows.updateRows();

        if (withFocus) {
            const left = this.model.data.rows.length;
            if (!left) this.model.models.focus.clearFocus();
            else this.model.models.focus.focusCell(Math.min(minRow, left - 1), minCol);
        }

        return true;
    };

    /** Delete whatever the cell selection covers — what ctrl+Delete does. */
    deleteSelectedRows = (): boolean => {
        const selection = this.model.models.focus.getGridSelection();
        if (!selection?.rows.length) return false;
        const getRowKey = this.model.options.getRowKey;
        return this.deleteRows(selection.rows.map(getRowKey), true);
    };

    // -----------------------------------------------------------------------
    // Columns
    // -----------------------------------------------------------------------

    /** Insert columns at an index into `grid.getColumns()`, or append. */
    addColumns = (columns: Column<R>[], index?: number): Column<R>[] => {
        if (!columns.length) return [];

        const existing = this.model.options.columns;
        const at =
            index === undefined
                ? existing.length
                : Math.max(0, Math.min(index, existing.length));

        if (this.model.options.onAddColumns?.({ columns, index: at }) === false) {
            return [];
        }

        const next = [...existing];
        next.splice(at, 0, ...columns);
        this.model.models.columns.setColumns(next);
        this.model.update({ all: true });
        return columns;
    };

    /** Insert `count` blank columns, built by `options.newColumn`. */
    addBlankColumns = (count = 1, index?: number): Column<R>[] => {
        if (count < 1) return [];
        const columns = Array.from({ length: count }, () => this.blankColumn());
        return this.addColumns(columns, index);
    };

    deleteColumns = (columnKeys: string[]): boolean => {
        if (!columnKeys.length) return false;

        const keys = new Set(columnKeys);
        const existing = this.model.options.columns;
        const columns = existing.filter((c) => keys.has(String(c.key)));
        if (!columns.length) return false;

        if (
            this.model.options.onDeleteColumns?.({
                columns,
                columnKeys: columns.map((c) => String(c.key)),
            }) === false
        ) {
            return false;
        }

        if (this.model.models.editing.isEditing) this.model.models.editing.cancelEdit();

        this.model.models.columns.setColumns(
            existing.filter((c) => !keys.has(String(c.key))),
        );
        this.model.update({ all: true });
        return true;
    };

    /** Delete the columns the cell selection covers — ctrl+shift+Delete. */
    deleteSelectedColumns = (): boolean => {
        const selection = this.model.models.focus.getGridSelection();
        if (!selection?.columns.length) return false;
        // The checkbox column is the grid's, not the host's, and ctrl+A selects it too.
        const keys = selection.columns
            .filter((c) => !c.isStatusColumn)
            .map((c) => String(c.key));
        return this.deleteColumns(keys);
    };

    // -----------------------------------------------------------------------
    // What the user is allowed to do
    // -----------------------------------------------------------------------

    get canAddRows(): boolean {
        return Boolean(this.model.options.canAddRows);
    }
    get canDeleteRows(): boolean {
        return Boolean(this.model.options.canDeleteRows);
    }
    get canAddColumns(): boolean {
        return Boolean(this.model.options.canAddColumns);
    }
    get canDeleteColumns(): boolean {
        return Boolean(this.model.options.canDeleteColumns);
    }

    // -----------------------------------------------------------------------
    // Keyboard
    // -----------------------------------------------------------------------

    /**
     * The four structural chords. The *navigation* ones — ArrowDown and Tab off the end of the
     * grid, ctrl+→ off the last column — live in `FocusModel`, next to the movement they are a
     * continuation of.
     */
    private onContentKeyDown = (e: KeyboardEvent): void => {
        if (!e.ctrlKey) return;

        // NumLock makes Numpad0 and NumpadDecimal type digits. The reference checked this and
        // it matters: without it, ctrl+0 in a numeric keypad layout inserts a row.
        const numLock = e.getModifierState?.("NumLock") ?? false;

        if (e.code === "Insert" || (e.code === "Numpad0" && !numLock)) {
            if (e.shiftKey ? !this.canAddColumns : !this.canAddRows) return;
            e.preventDefault();
            const { rows, columns, minRow, minCol } =
                this.model.models.focus.selectedCount;
            if (e.shiftKey) this.addBlankColumns(columns || 1, this.hostIndex(minCol));
            else this.addBlankRows(rows || 1, minRow);
            return;
        }

        if (e.code === "Delete" || (e.code === "NumpadDecimal" && !numLock)) {
            if (e.shiftKey ? !this.canDeleteColumns : !this.canDeleteRows) return;
            e.preventDefault();
            if (e.shiftKey) this.deleteSelectedColumns();
            else this.deleteSelectedRows();
        }
    };

    // -----------------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------------

    /**
     * Where a display index falls in `options.rows`.
     *
     * `indexOf` is O(rows), which on 100k rows is a fraction of a millisecond and happens once
     * per insert — as against keeping a permanent index that every sort and filter would have
     * to maintain.
     */
    private sourceIndex(displayIndex: number): number {
        const displayed = this.model.data.rows;
        const source = this.model.options.rows;
        if (displayIndex >= displayed.length) return source.length;
        const at = source.indexOf(displayed[displayIndex]);
        return at < 0 ? source.length : at;
    }

    /** A `data.columns` index as an index into the host's own columns. */
    private hostIndex(dataColIndex: number): number | undefined {
        const column = this.model.data.columns[dataColIndex];
        if (!column) return undefined;
        const at = this.model.options.columns.indexOf(column);
        return at < 0 ? undefined : at;
    }

    private blankRow(index: number): R {
        const custom = this.model.options.newRow;
        if (custom) return custom(index);

        const row: any = {};
        // Every added row needs its own key. With no key property to fill, `inferGetRowKey`
        // hands out identities per object and `{}` is already unique.
        const property = this.keyProperty();
        if (property) row[property] = `new-${this.nextPlaceholder++}`;
        return row as R;
    }

    private keyProperty(): string | undefined {
        if (this.rowKeyProperty === undefined) {
            this.rowKeyProperty =
                inferRowKeyProperty(this.model.options.rows) ?? null;
        }
        return this.rowKeyProperty ?? undefined;
    }

    private blankColumn(): Column<R> {
        const custom = this.model.options.newColumn;
        const index = this.model.options.columns.length;
        if (custom) return custom(index);

        let n = this.nextPlaceholder++;
        const taken = new Set(this.model.options.columns.map((c) => String(c.key)));
        while (taken.has(`column${n}`)) n = this.nextPlaceholder++;
        return { key: `column${n}`, name: `Column ${n}` };
    }
}
