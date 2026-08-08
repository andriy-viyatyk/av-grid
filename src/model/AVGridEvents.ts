/**
 * The grid's internal event bus.
 *
 * Ported from `AVGrid/model/AVGridEvents.ts` with React's synthetic events replaced by DOM
 * events. It is what keeps the views (`DataCell`, `HeaderCell`) from knowing about the
 * models: a cell sends, a model listens.
 *
 * Internal — the *public* callbacks live on the options object.
 */

import { Subscription } from "../core/events";
import type { Column } from "../types";

export interface CellEventData<R = any> {
    row: R;
    col: Column<R>;
    rowIndex: number;
    colIndex: number;
}

export interface CellMouseEventData<R = any> extends CellEventData<R> {
    e: MouseEvent;
}

export interface CellDragEventData<R = any> extends CellEventData<R> {
    e: DragEvent;
}

class CellEvents<R = any> {
    readonly onClick = new Subscription<CellMouseEventData<R>>();
    readonly onDoubleClick = new Subscription<CellMouseEventData<R>>();
    readonly onMouseDown = new Subscription<CellMouseEventData<R>>();
    readonly onContextMenu = new Subscription<CellMouseEventData<R>>();
    readonly onDragStart = new Subscription<CellDragEventData<R>>();
    readonly onDragEnter = new Subscription<CellDragEventData<R>>();
    readonly onDragEnd = new Subscription<CellDragEventData<R>>();
}

class ContentEvents {
    readonly onMouseLeave = new Subscription<MouseEvent>();
    readonly onKeyDown = new Subscription<KeyboardEvent>();
    readonly onContextMenu = new Subscription<MouseEvent>();
    readonly onBlur = new Subscription<FocusEvent>();
}

export class AVGridEvents<R> {
    readonly cell = new CellEvents<R>();
    readonly content = new ContentEvents();

    readonly onColumnResize = new Subscription<{
        columnKey: string;
        width: number;
    }>();
    readonly onColumnsReorder = new Subscription<{
        sourceKey: string;
        targetKey: string;
    }>();
    readonly onRowsAdded = new Subscription<{ rows: R[]; insertIndex?: number }>();
    readonly onRowsDeleted = new Subscription<{ rowKeys: string[] }>();
    readonly onSortColumn = new Subscription<{ columnKey: string }>();

    /** Drop every listener. Called from `grid.destroy()`. */
    clear(): void {
        for (const group of [this.cell, this.content] as unknown as Array<
            Record<string, { clear: () => void }>
        >) {
            for (const value of Object.values(group)) {
                value.clear();
            }
        }
        this.onColumnResize.clear();
        this.onColumnsReorder.clear();
        this.onRowsAdded.clear();
        this.onRowsDeleted.clear();
        this.onSortColumn.clear();
    }
}
