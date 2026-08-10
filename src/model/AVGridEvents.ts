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
import type { Column, Filter } from "../types";

export interface CellEventData<R = any> {
    row: R;
    col: Column<R>;
    rowIndex: number;
    colIndex: number;
}

export interface CellMouseEventData<R = any> extends CellEventData<R> {
    e: MouseEvent;
}

export interface CellMouseDownEventData<R = any> extends CellMouseEventData<R> {
    /**
     * Was this cell already the focused one when the pointer went down?
     *
     * Resolved by the sender rather than by a listener, because `FocusModel` subscribes first
     * and moves the focus onto this very cell — by the time `EditingModel` is called the answer
     * is always yes. The reference got it free: its focus was a React prop, so it still held the
     * pre-click value while the handler ran.
     */
    wasFocused: boolean;
}

class CellEvents<R = any> {
    readonly onClick = new Subscription<CellMouseEventData<R>>();
    readonly onDoubleClick = new Subscription<CellMouseEventData<R>>();
    /** A pointer went down on a cell. Carries `shiftKey` and `button`, so it decides the anchor. */
    readonly onMouseDown = new Subscription<CellMouseDownEventData<R>>();
    readonly onContextMenu = new Subscription<CellMouseEventData<R>>();

    /**
     * The pointer moved onto a *different* cell while a range-selection drag is in flight.
     *
     * The reference used HTML5 drag-and-drop for this — `draggable` on every cell, a
     * transparent drag image, and a `dragenter` handler. Pointer events do the same job
     * without the drag image hack, without competing with the header's own reorder drag, and
     * without a per-cell attribute to keep in sync through recycling.
     */
    readonly onSelectMove = new Subscription<CellEventData<R>>();
    /** The drag ended, wherever the pointer was released. */
    readonly onSelectEnd = new Subscription<void>();
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

    /**
     * The applied filters changed, however that happened.
     *
     * The host has `onFiltersChange` for this; the filter bar cannot use it, because a host that
     * passes its own would find the bar had eaten it. So the bar listens here — this is the
     * internal bus, and there is no limit on how many things subscribe to it.
     */
    readonly onFiltersChanged = new Subscription<Filter[]>();

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
        this.onFiltersChanged.clear();
    }
}
