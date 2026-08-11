/**
 * The grid's derived data — everything computed *from* the options rather than passed in.
 *
 * Ported from `AVGrid/model/AVGridData.ts` unchanged in shape. Each field is a property whose
 * setter records that it changed; `change()` then sends one event describing everything that
 * moved since the last call. That batching is why a sort can update `rows`, `rowCompare` and
 * `rowsFrozen` and still produce a single notification.
 *
 * The setters compare by identity, so assigning the same value twice is free.
 */

import { Subscription } from "../core/events";
import type { Column, RowCompare } from "../types";

const defaultChangeEvent = {
    rows: false,
    columns: false,
    lastIsStatusIndex: false,
    rowCompare: false,
    allSelected: false,
    hovered: false,
    editTime: false,
    rowsFrozen: false,
    newRowKey: false,
};

export type AVGridDataChangeEvent = typeof defaultChangeEvent;

export class AVGridData<R> {
    readonly onChange = new Subscription<AVGridDataChangeEvent>();
    private _changeEvent: AVGridDataChangeEvent = { ...defaultChangeEvent };

    private _rows: readonly R[];
    private _columns: Column<R>[];
    private _lastIsStatusIndex = -1;
    private _rowCompare: RowCompare<R> | undefined;
    private _sortValue: ((row: R) => any) | undefined;
    private _allSelected = false;
    private _hovered = { row: -1, col: -1 };
    private _editTime = 0;
    private _rowsFrozen = false;
    private _newRowKey: string | undefined;

    constructor(rows: readonly R[], columns: Column<R>[]) {
        this._rows = rows;
        this._columns = columns;
    }

    change = (event?: Partial<AVGridDataChangeEvent>): void => {
        const changeEvent = { ...event, ...this._changeEvent };
        if (
            event ||
            Object.getOwnPropertyNames(changeEvent).some(
                (key) => (changeEvent as any)[key],
            )
        ) {
            this._changeEvent = { ...defaultChangeEvent };
            this.onChange.send(changeEvent as AVGridDataChangeEvent);
        }
    };

    /** The rows actually displayed — after filtering and sorting. */
    get rows(): readonly R[] {
        return this._rows;
    }

    set rows(value: readonly R[]) {
        if (this._rows === value) return;
        this._rows = value;
        this._changeEvent.rows = true;
    }

    /** The columns actually displayed — hidden ones removed. */
    get columns(): Column<R>[] {
        return this._columns;
    }

    set columns(value: Column<R>[]) {
        if (this._columns === value) return;
        this._columns = value;
        this._changeEvent.columns = true;
    }

    /** Index of the last status column; everything up to it is pinned left. */
    get lastIsStatusIndex(): number {
        return this._lastIsStatusIndex;
    }

    set lastIsStatusIndex(value: number) {
        if (this._lastIsStatusIndex === value) return;
        this._lastIsStatusIndex = value;
        this._changeEvent.lastIsStatusIndex = true;
    }

    get rowCompare(): RowCompare<R> | undefined {
        return this._rowCompare;
    }

    set rowCompare(value: RowCompare<R> | undefined) {
        if (this._rowCompare === value) return;
        this._rowCompare = value;
        this._changeEvent.rowCompare = true;
    }

    /**
     * The projection the sorted column supplies, when it has a `sortValue` rather than a
     * `rowCompare`. It shares `rowCompare`'s change flag deliberately: the two are one fact —
     * *how the rows are ordered* — and everything that reacts to one has to react to the other.
     * Without that, moving the sort between two columns that both have a `sortValue` would leave
     * `rowCompare` at the same memorized identity and report no change at all.
     */
    get sortValue(): ((row: R) => any) | undefined {
        return this._sortValue;
    }

    set sortValue(value: ((row: R) => any) | undefined) {
        if (this._sortValue === value) return;
        this._sortValue = value;
        this._changeEvent.rowCompare = true;
    }

    get allSelected(): boolean {
        return this._allSelected;
    }

    set allSelected(value: boolean) {
        if (this._allSelected === value) return;
        this._allSelected = value;
        this._changeEvent.allSelected = true;
    }

    get hovered(): { row: number; col: number } {
        return this._hovered;
    }

    set hovered(value: { row: number; col: number }) {
        if (this._hovered === value) return;
        this._hovered = value;
        this._changeEvent.hovered = true;
    }

    get editTime(): number {
        return this._editTime;
    }

    set editTime(value: number) {
        if (this._editTime === value) return;
        this._editTime = value;
        this._changeEvent.editTime = true;
    }

    /** While frozen, the displayed rows keep their order through edits. Task 12 uses it. */
    get rowsFrozen(): boolean {
        return this._rowsFrozen;
    }

    set rowsFrozen(value: boolean) {
        if (this._rowsFrozen === value) return;
        this._rowsFrozen = value;
        this._changeEvent.rowsFrozen = true;
    }

    get newRowKey(): string | undefined {
        return this._newRowKey;
    }

    set newRowKey(value: string | undefined) {
        if (this._newRowKey === value) return;
        this._newRowKey = value;
        this._changeEvent.newRowKey = true;
    }
}
