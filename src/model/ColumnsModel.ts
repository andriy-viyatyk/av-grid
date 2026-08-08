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
import type { Column } from "../types";
import type { AVGridModel } from "./AVGridModel";

export const defaultColumnWidth = 140;
/** Any narrower and the resize grip has nothing left to grab. Matches the reference. */
export const minColumnWidth = 20;

export class ColumnsModel<R> {
    readonly model: AVGridModel<R>;

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
            (c) => !c.readonly && !c.isStatusColumn,
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
        this.model.options.columns = columns;
        this.updateColumnsData(columns);
        this.model.options.onColumnsChange?.(columns);
    };

    updateColumns = (updateFunc: (columns: Column<R>[]) => Column<R>[]): void => {
        this.setColumns(updateFunc(this.model.options.columns));
    };

    /**
     * Recompute what the render layer sees: hidden columns dropped, and the index of the last
     * status column, which becomes the engine's `stickyLeft`.
     */
    updateColumnsData = (columns: Column<R>[]): void => {
        let lastIsStatusIndex = -1;
        columns.forEach((c, idx) => {
            if (c.isStatusColumn) lastIsStatusIndex = idx;
        });

        this.model.data.lastIsStatusIndex = lastIsStatusIndex;
        this.model.data.columns = columns.filter((c) => !c.hidden);
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
