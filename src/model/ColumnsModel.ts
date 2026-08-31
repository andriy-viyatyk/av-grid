/**
 * Column state: what is displayed, how wide, in what order.
 *
 * Ported from `AVGrid/model/ColumnsModel.ts`. One structural change, the same one made in
 * every model in this directory: the reference pushed a column change *up* to the host
 * (`props.setColumns`) and waited for it to come back down through `useEffect`. Here the grid
 * owns its columns, mutates them, and *reports* the change. A host that wants control calls
 * `grid.setColumns()`; the code path is identical either way.
 */

import { range } from "../core/utils";
import { gatherByGroup, isPinnedLeft, trailingPinnedRight } from "../gridUtils";
import type { Column } from "../types";
import { createSelectColumn } from "../view/SelectColumn";
import type { AVGridModel } from "./AVGridModel";

export const defaultColumnWidth = 140;
/** Any narrower and the resize grip has nothing left to grab. Matches the reference. */
export const minColumnWidth = 20;

export class ColumnsModel<R> {
    readonly model: AVGridModel<R>;

    /**
     * The checkbox column, built on first use and then kept.
     *
     * Stable identity matters: `AVGridData.columns` compares by identity, so a fresh object
     * per `updateColumnsData` would report a column change — and therefore re-run the row
     * pipeline — every time anything touched the column set. Lazy because the column's hooks
     * read `model.models.selected`, which does not exist yet while this constructor runs.
     */
    private _selectColumn?: Column<R>;

    constructor(model: AVGridModel<R>) {
        this.model = model;
        this.model.events.onColumnResize.subscribe(this.onColumnResize);
        this.model.events.onColumnsReorder.subscribe(this.onColumnsReorder);
    }

    get columnCount(): number {
        return this.model.data.columns.length;
    }

    /** The first column an edit can land in — skips read-only and status columns. */
    get firstEditable(): { col: Column<R>; index: number } | undefined {
        const index = this.model.data.columns.findIndex(
            (c) => !c.readonly && !isPinnedLeft(c),
        );
        return index === -1
            ? undefined
            : { col: this.model.data.columns[index], index };
    }

    getColumnWidth = (idx: number): number | `${number}%` => {
        const width = this.model.data.columns[idx]?.width;
        return width ?? defaultColumnWidth;
    };

    indexOfKey = (columnKey: string): number =>
        this.model.data.columns.findIndex((c) => String(c.key) === columnKey);

    /** Replace the column set. The single funnel every column change goes through. */
    setColumns = (columns: Column<R>[]): void => {
        // Same-group columns are gathered together, stably — the grouped order *is* the
        // column order, so `getColumns()`, `onColumnsChange` and the render all agree on it.
        columns = gatherByGroup(columns);
        this.model.options.columns = columns;
        this.updateColumnsData(columns);
        this.model.options.onColumnsChange?.(columns);
    };

    updateColumns = (updateFunc: (columns: Column<R>[]) => Column<R>[]): void => {
        this.setColumns(updateFunc(this.model.options.columns));
    };

    get selectColumn(): Column<R> {
        if (!this._selectColumn) {
            this._selectColumn = createSelectColumn<R>(this.model);
        }
        return this._selectColumn;
    }

    /**
     * Recompute what the render layer sees: the checkbox column prepended when the option is
     * on, hidden columns dropped, and the index of the last status column, which becomes the
     * engine's `stickyLeft`.
     *
     * The checkbox is added *here* rather than in `setColumns`, so it never reaches
     * `options.columns`. A host therefore sees only its own columns in `getColumns()` and
     * cannot accidentally duplicate or delete the grid's, whatever it passes to
     * `setColumns()`.
     */
    updateColumnsData = (columns: Column<R>[]): void => {
        const all = this.model.options.selectColumn
            ? [this.selectColumn, ...columns]
            : columns;

        // Pin runs are computed over the *visible* columns, because the counts become the
        // engine's sticky band sizes and those index into what is rendered. A hidden pinned
        // column simply shortens its run.
        const visible = all.filter((c) => !c.hidden);

        let lastIsStatusIndex = -1;
        visible.forEach((c, idx) => {
            if (isPinnedLeft(c)) lastIsStatusIndex = idx;
        });

        this.model.data.lastIsStatusIndex = lastIsStatusIndex;
        this.model.data.stickyRightCount = trailingPinnedRight(visible);
        this.model.data.hasGroups = visible.some((c) => c.group !== undefined);
        this.model.data.columns = visible;
        this.model.data.change();
    };

    private onColumnResize = ({
        columnKey,
        width,
    }: {
        columnKey: string;
        width: number;
    }): void => {
        if (width < minColumnWidth) return;

        this.updateColumns((columns) =>
            columns.map((c) =>
                String(c.key) === columnKey ? { ...c, width } : c,
            ),
        );
        this.model.options.onColumnResize?.(columnKey, width);
    };

    private onColumnsReorder = ({
        sourceKey,
        targetKey,
    }: {
        sourceKey: string;
        targetKey: string;
    }): void => {
        if (sourceKey === targetKey) return;

        this.updateColumns((columns) => {
            const sourceColumnIndex = columns.findIndex(
                (c) => String(c.key) === sourceKey,
            );
            const targetColumnIndex = columns.findIndex(
                (c) => String(c.key) === targetKey,
            );
            if (sourceColumnIndex < 0 || targetColumnIndex < 0) return columns;

            const reordered = [...columns];
            reordered.splice(
                targetColumnIndex,
                0,
                reordered.splice(sourceColumnIndex, 1)[0],
            );

            // Only the columns between source and target actually moved — everything outside
            // that span keeps its index and must not be repainted.
            this.model.update({
                columns: range(sourceColumnIndex, targetColumnIndex),
            });

            return reordered;
        });
        this.model.options.onColumnsReorder?.(sourceKey, targetKey);
    };
}
