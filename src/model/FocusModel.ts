/**
 * Focus, keyboard navigation and range selection.
 *
 * Ported from `AVGrid/model/FocusModel.ts`. The reference had no React import and its logic
 * survives almost intact; what changes is who owns the state and how a change is reported to
 * the renderer.
 *
 * | Reference | Here |
 * |---|---|
 * | `props.focus` + `props.setFocus(updater)` — state lifted to the host | the model owns `focus`; the host reads `getFocus()` and hears `onFocusChange` |
 * | HTML5 drag-and-drop (`dragstart` / `dragenter` on every cell) | pointer events delegated from the root |
 * | `clsx({ focused, inSelection, … })` per cell | one integer bitmask per cell |
 * | `update({ all: true })`, or the whole old + new rectangles | the *symmetric difference*, clipped to the rendered window |
 *
 * That last row is the one this task exists for.
 *
 * The reference marks `cellsToUpdate(oldSelection)` plus `cellsToUpdate(newSelection)` on
 * every drag move — both *entire rectangles*, unclipped. Dragging a selection from row 0 down
 * to row 99,000 therefore builds a 100,000-entry array on each of 99,000 moves: quadratic, and
 * exactly the stall this project was written to avoid. It is invisible in the reference
 * because Persephone's grids are small.
 *
 * Here a selection change instead walks the *rendered* window — a few hundred cells, whatever
 * the row index — comparing each cell's old and new state bitmask and marking only those that
 * differ. Cost per drag move is therefore a function of the viewport, not of the selection, so
 * a drag at row 99,000 costs what a drag at row 100 costs. The mask also covers the four
 * selection *edge* classes, which a plain "is it in the rectangle" test would miss: a cell can
 * stay selected and still need repainting because the border moved off it.
 */

import { isPinnedLeft } from "../gridUtils";
import type { RenderCell, RerenderInfo } from "../render/types";
import type { CellFocus, Column } from "../types";
import type { AVGridDataChangeEvent } from "./AVGridData";
import type { AVGridModel } from "./AVGridModel";

/**
 * How the focus is moving. Purely about where the selection *anchor* ends up:
 *
 * - `click` — anchor moves to the clicked cell; the old selection is discarded.
 * - `shiftClick` — anchor stays; the selection extends to the new cell.
 * - `rightClick` — like `click`, except inside an existing selection, where it does nothing
 *   (so a context menu opens on the range rather than collapsing it).
 * - `drag` — like `shiftClick`, but ignored unless a drag is actually in flight.
 *
 * The reference had a fifth member, `startDrag`, which behaved as `click` *and* set
 * `isDragging`. Those are two different questions, so dragging is a separate flag here — which
 * is also what makes shift-drag extend a selection instead of resetting its anchor.
 */
export type SelectionType = "click" | "shiftClick" | "rightClick" | "drag";

export interface UpdateFocusOptions {
    /** Scroll the cell into view. Set by keyboard navigation, not by the pointer. */
    withScroll?: boolean;
    /** Begin a drag: subsequent `drag` updates extend the selection until it ends. */
    startDrag?: boolean;
}

/** The rows and columns a selection covers, plus the host row/column objects themselves. */
export interface GridSelection<R = any> {
    rows: R[];
    columns: Column<R>[];
    /** Indices of the focused cell — the end the selection grew towards. */
    focusRow: number;
    focusCol: number;
    /** `[first, last]`, always ascending, unlike the raw start/end on `CellFocus`. */
    rowRange: [number, number];
    colRange: [number, number];
}

export interface SelectedCount {
    rows: number;
    columns: number;
    minRow: number;
    minCol: number;
}

// ---------------------------------------------------------------------------
// The per-cell state mask
// ---------------------------------------------------------------------------

const IN_SELECTION = 1 << 0;
const SELECTION_TOP = 1 << 1;
const SELECTION_BOTTOM = 1 << 2;
const SELECTION_LEFT = 1 << 3;
const SELECTION_RIGHT = 1 << 4;
const FOCUSED = 1 << 5;

/**
 * The normalized focus, in indices.
 *
 * `CellFocus` carries start and end in the order the user dragged them, which may be
 * descending, and carries keys as well as indices. Both are right for *storage* — keys survive
 * a sort, and the drag direction decides which corner is the anchor. Neither is right for the
 * hot path, so the ordered form is derived once per focus change and read a few hundred times
 * per paint.
 */
interface Ranges {
    rowStart: number;
    rowEnd: number;
    colStart: number;
    colEnd: number;
    focusRow: number;
    focusCol: number;
}

const NO_RANGES: Ranges = {
    rowStart: -1,
    rowEnd: -1,
    colStart: -1,
    colEnd: -1,
    focusRow: -1,
    focusCol: -1,
};

/**
 * Do two focus values mean the same thing?
 *
 * Eleven field comparisons on a path that runs once per focus *change* — once per cell crossed
 * during a drag, not once per pointer move and never per cell painted. The identity check comes
 * first, which is the case every internal caller hits.
 */
function sameFocus(
    a: CellFocus<any> | undefined,
    b: CellFocus<any> | undefined,
): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    if (
        a.rowKey !== b.rowKey ||
        a.columnKey !== b.columnKey ||
        Boolean(a.isDragging) !== Boolean(b.isDragging)
    ) {
        return false;
    }
    const x = a.selection;
    const y = b.selection;
    if (x === y) return true;
    if (!x || !y) return false;
    return (
        x.rowStart === y.rowStart &&
        x.rowEnd === y.rowEnd &&
        x.colStart === y.colStart &&
        x.colEnd === y.colEnd &&
        x.rowKeyStart === y.rowKeyStart &&
        x.rowKeyEnd === y.rowKeyEnd &&
        x.colKeyStart === y.colKeyStart &&
        x.colKeyEnd === y.colKeyEnd
    );
}

function maskAt(r: Ranges, row: number, col: number): number {
    let mask = 0;
    if (
        row >= r.rowStart &&
        row <= r.rowEnd &&
        col >= r.colStart &&
        col <= r.colEnd
    ) {
        mask = IN_SELECTION;
        if (row === r.rowStart) mask |= SELECTION_TOP;
        if (row === r.rowEnd) mask |= SELECTION_BOTTOM;
        if (col === r.colStart) mask |= SELECTION_LEFT;
        if (col === r.colEnd) mask |= SELECTION_RIGHT;
    }
    if (row === r.focusRow && col === r.focusCol) mask |= FOCUSED;
    return mask;
}

/** Keys that move the focus. Anything else falls through to the host. */
const NAVIGATION_KEYS = new Set([
    "ArrowDown",
    "ArrowUp",
    "ArrowLeft",
    "ArrowRight",
    "Tab",
    "PageDown",
    "PageUp",
    "Home",
    "End",
]);

export class FocusModel<R> {
    readonly model: AVGridModel<R>;

    /**
     * Set by row-add and row-delete (task 14) to say "the focus keys are stale, re-derive the
     * focus from its indices on the next validation".
     */
    focusFromIndex = false;

    private _focus?: CellFocus<R>;
    private ranges: Ranges = NO_RANGES;

    constructor(model: AVGridModel<R>) {
        this.model = model;
        this.model.data.onChange.subscribe(this.onDataChange);
        this.model.events.cell.onMouseDown.subscribe(this.onCellMouseDown);
        this.model.events.cell.onSelectMove.subscribe(this.onCellSelectMove);
        this.model.events.cell.onSelectEnd.subscribe(this.onSelectEnd);
        this.model.events.content.onKeyDown.subscribe(this.onContentKeyDown);
    }

    // -----------------------------------------------------------------------
    // Reading
    // -----------------------------------------------------------------------

    get focus(): CellFocus<R> | undefined {
        return this._focus;
    }

    /** True while a range drag is in flight. */
    get isDragging(): boolean {
        return Boolean(this._focus?.isDragging);
    }

    /** The focused cell, as the row and column objects plus their indices. */
    getGridFocus():
        | { row: R; column: Column<R>; rowIndex: number; colIndex: number }
        | undefined {
        const { rows, columns } = this.model.data;
        const { focusRow: rowIndex, focusCol: colIndex } = this.ranges;
        if (rowIndex < 0 || colIndex < 0) return undefined;
        return {
            row: rows[rowIndex] as R,
            column: columns[colIndex] as Column<R>,
            rowIndex,
            colIndex,
        };
    }

    /** True when exactly one cell is selected — used by copy and by the editor. */
    get singleCellSelected(): boolean {
        const r = this.ranges;
        return (
            r.focusRow >= 0 &&
            r.rowStart === r.rowEnd &&
            r.colStart === r.colEnd
        );
    }

    /** The selection's extent, and its top-left corner. */
    get selectedCount(): SelectedCount {
        const r = this.ranges;
        if (r.focusRow < 0) {
            return { rows: 0, columns: 0, minRow: 0, minCol: 0 };
        }
        return {
            rows: r.rowEnd - r.rowStart + 1,
            columns: r.colEnd - r.colStart + 1,
            minRow: r.rowStart,
            minCol: r.colStart,
        };
    }

    /**
     * The selected rows and columns themselves.
     *
     * `rows` is a slice, so selecting all of a 100k-row grid and reading this copies 100k
     * references — which is what the caller asked for. The grid never calls it internally.
     */
    getGridSelection(): GridSelection<R> | undefined {
        const r = this.ranges;
        if (r.focusRow < 0) return undefined;
        const { rows, columns } = this.model.data;
        return {
            rows: rows.slice(r.rowStart, r.rowEnd + 1) as R[],
            columns: columns.slice(r.colStart, r.colEnd + 1),
            focusRow: r.focusRow,
            focusCol: r.focusCol,
            rowRange: [r.rowStart, r.rowEnd],
            colRange: [r.colStart, r.colEnd],
        };
    }

    /** Is this cell inside the current selection? Two integer comparisons per axis. */
    inSelection(colIndex: number, rowIndex: number): boolean {
        const r = this.ranges;
        return (
            rowIndex >= r.rowStart &&
            rowIndex <= r.rowEnd &&
            colIndex >= r.colStart &&
            colIndex <= r.colEnd
        );
    }

    /**
     * The state classes for one cell, as a space-prefixed string ready to append.
     *
     * Called once per cell per paint, so it does no allocation until it has something to say —
     * an unfocused grid returns the same empty string every time.
     */
    focusClass = (colIndex: number, rowIndex: number): string => {
        const r = this.ranges;
        if (r.focusRow < 0) return "";

        const mask = maskAt(r, rowIndex, colIndex);
        if (mask === 0) return "";

        let out = "";
        if (mask & IN_SELECTION) out += " avg-in-selection";
        if (mask & SELECTION_TOP) out += " avg-in-selection-top";
        if (mask & SELECTION_BOTTOM) out += " avg-in-selection-bottom";
        if (mask & SELECTION_LEFT) out += " avg-in-selection-left";
        if (mask & SELECTION_RIGHT) out += " avg-in-selection-right";
        if (mask & FOCUSED) out += " avg-focused";
        return out;
    };

    // -----------------------------------------------------------------------
    // Writing
    // -----------------------------------------------------------------------

    /** Focus one cell, discarding any selection. Indices are into the *displayed* rows. */
    focusCell = (rowIndex: number, colIndex: number, withScroll?: boolean): void => {
        this.updateFocus(rowIndex, colIndex, "click", { withScroll });
    };

    /** Select a rectangle. The focus lands on the *end* corner, as it would after a drag. */
    selectRange = (
        startRowIndex: number,
        startColIndex: number,
        endRowIndex: number,
        endColIndex: number,
    ): void => {
        const { columns, rows } = this.model.data;
        const startCol = columns[startColIndex];
        const endCol = columns[endColIndex];
        const startRow = rows[startRowIndex];
        const endRow = rows[endRowIndex];
        if (!startCol || !endCol || startRow === undefined || endRow === undefined) {
            return;
        }
        const getRowKey = this.model.options.getRowKey;

        this.setFocus({
            columnKey: endCol.key,
            rowKey: getRowKey(endRow),
            isDragging: false,
            selection: {
                colKeyStart: startCol.key,
                rowKeyStart: getRowKey(startRow),
                colKeyEnd: endCol.key,
                rowKeyEnd: getRowKey(endRow),
                colStart: startColIndex,
                rowStart: startRowIndex,
                colEnd: endColIndex,
                rowEnd: endRowIndex,
            },
        });
    };

    /**
     * Select the rows just added, keeping whatever column span the old focus had.
     *
     * With nothing focused before, the fallback is the first column a value can be *typed*
     * into, not column 0 — on a grid with `selectColumn` that is the checkbox, which a click
     * cannot focus either. Landing there means the first keystroke after adding a row goes
     * nowhere, which reads as the add having failed.
     */
    focusNewRows = (
        startIndex: number,
        count: number,
        oldFocus?: CellFocus<R>,
    ): void => {
        const fallback =
            this.model.models.columns.firstEditable?.index ??
            this.model.data.columns.findIndex((c) => !isPinnedLeft(c));
        this.selectRange(
            startIndex,
            oldFocus?.selection?.colStart ?? Math.max(0, fallback),
            startIndex + count - 1,
            oldFocus?.selection?.colEnd ?? Math.max(0, fallback),
        );
    };

    /**
     * Replace the focus wholesale. The host-facing setter behind `grid.setFocus()` and the
     * `focus` option.
     *
     * **`isDragging` is the pointer's, never the host's**, so the incoming one is discarded and
     * the live value kept. It is transient interaction state that happens to travel inside
     * `CellFocus`, and letting a host write it breaks two ways round: a focus echoed back from
     * a host's state arrives one event late and would re-arm a drag the release had just ended,
     * and a focus restored from storage would come back with a drag in flight that no pointer
     * is driving. Neither is hypothetical — the first is what a React `focus={focus}` binding
     * does on every click, and it is how this was found.
     */
    setFocus = (focus: CellFocus<R> | undefined): void => {
        this.applyFocus((previous) => {
            const dragging = Boolean(previous?.isDragging);
            if (!focus || Boolean(focus.isDragging) === dragging) return focus;
            return { ...focus, isDragging: dragging };
        });
    };

    /**
     * The `focus` option, applied once at `create()`.
     *
     * Separate from `setFocus` because nothing has *changed* yet: firing `onFocusChange` while
     * the host is still inside `AVGrid.create()` would report a value it has this moment
     * supplied, back to a callback it may not have finished wiring up. `SelectedModel` treats
     * the `selected` option the same way.
     *
     * Called late in the grid's construction, once the rows and columns exist, because a focus
     * carrying keys only has to look its indices up in them.
     */
    initFocus = (focus: CellFocus<R> | undefined): void => {
        if (!focus) return;
        // Nothing can be dragging before the grid has had a pointer on it, whatever a restored
        // value claims.
        this._focus = focus.isDragging ? { ...focus, isDragging: false } : focus;
        this.ranges = this.deriveRanges(this._focus);
    };

    clearFocus = (): void => {
        this.applyFocus(() => undefined);
    };

    // -----------------------------------------------------------------------
    // The core update
    // -----------------------------------------------------------------------

    /**
     * Apply an update to the focus, mark exactly the cells whose appearance changed, and
     * report the new value.
     *
     * The updater form is the reference's, and it earns its keep: several of the callers need
     * to inspect the *previous* focus before deciding what the next one is, and one of them
     * (`drag`) decides not to change it at all.
     */
    private applyFocus(
        updater: (previous: CellFocus<R> | undefined) => CellFocus<R> | undefined,
    ): void {
        const previous = this._focus;
        const next = updater(previous);
        // By value, not by identity. Identity alone was enough while every caller was internal
        // and returned the previous object when it meant "no change" — `validateFocus` still
        // does. It stops being enough the moment a host echoes the focus back as an option: the
        // object that comes back is equal but new, and re-applying it would repaint, re-fire
        // `onFocusChange`, and hand the host another new object to echo. That is a loop.
        if (sameFocus(next, previous)) return;

        const oldRanges = this.ranges;
        this._focus = next;
        this.ranges = this.deriveRanges(next);

        this.markChanged(oldRanges, this.ranges);
        // An open editor belongs to the cell it was opened on. This is the reference's
        // `useModel()` effect, called from the one place the focus can actually move instead of
        // on every React render.
        this.model.models.editing.onFocusMoved();
        this.model.options.onFocusChange?.(next);
        // Last, so the host has seen the new focus before the row that the focus just left
        // disappears from under it. Does nothing unless an untouched trailing row exists.
        this.model.models.structure.dropUntouchedTrailingRow();
    }

    private deriveRanges(focus: CellFocus<R> | undefined): Ranges {
        if (!focus) return NO_RANGES;

        const selection = focus.selection;
        if (selection) {
            const rowStart = Math.min(selection.rowStart, selection.rowEnd);
            const rowEnd = Math.max(selection.rowStart, selection.rowEnd);
            const colStart = Math.min(selection.colStart, selection.colEnd);
            const colEnd = Math.max(selection.colStart, selection.colEnd);
            return {
                rowStart,
                rowEnd,
                colStart,
                colEnd,
                focusRow: selection.rowEnd,
                focusCol: selection.colEnd,
            };
        }

        // A focus set by the host may carry keys only. Resolving them costs one pass over the
        // rows, which is why every focus the grid produces itself carries indices too.
        const getRowKey = this.model.options.getRowKey;
        const rowIndex = this.model.data.rows.findIndex(
            (r) => getRowKey(r) === focus.rowKey,
        );
        const colIndex = this.model.data.columns.findIndex(
            (c) => c.key === focus.columnKey,
        );
        if (rowIndex < 0 || colIndex < 0) return NO_RANGES;
        return {
            rowStart: rowIndex,
            rowEnd: rowIndex,
            colStart: colIndex,
            colEnd: colIndex,
            focusRow: rowIndex,
            focusCol: colIndex,
        };
    }

    /**
     * Mark the cells whose state actually changed — and nothing else.
     *
     * Walks the rendered window rather than either selection rectangle, so the cost is a
     * function of the viewport and never of the selection. That is the whole reason a drag at
     * row 99,000 costs what a drag at row 100 costs.
     *
     * Comparing masks rather than membership matters: extending a selection downwards leaves
     * the old bottom row still selected but no longer the *bottom* of the selection, so its
     * border has to be repainted even though "is it selected" did not change.
     */
    private markChanged(before: Ranges, after: Ranges): void {
        if (before === after) return;

        const renderModel = this.model.renderModel;
        if (!renderModel) return;

        const { rows: gridRows, columns: cols } =
            renderModel.renderInfo.current.renderRange;

        const cells: RenderCell[] = [];
        for (let i = 0; i < gridRows.length; i++) {
            const gridRow = gridRows[i];
            // Grid row 0 is the header; it has no selection state.
            if (gridRow <= 0) continue;
            const dataRow = gridRow - 1;
            for (let j = 0; j < cols.length; j++) {
                const col = cols[j];
                if (maskAt(before, dataRow, col) !== maskAt(after, dataRow, col)) {
                    cells.push({ row: gridRow, col });
                }
            }
        }

        if (cells.length) {
            const rerender: RerenderInfo = { cells };
            this.model.update(rerender);
        }
    }

    /**
     * Move the focus to a cell.
     *
     * A near-verbatim port of the reference's `updateFocus`, minus the row-marking it did for
     * the hover highlight — `markChanged` already reports precisely the cells that moved, so
     * marking whole rows on top of it would repaint cells that did not change.
     */
    private updateFocus(
        rowIndex: number,
        colIndex: number,
        selType: SelectionType,
        options?: UpdateFocusOptions,
    ): void {
        const { rows, columns } = this.model.data;
        const row = rows[rowIndex];
        const column = columns[colIndex];
        if (row === undefined || column === undefined) return;

        const getRowKey = this.model.options.getRowKey;

        this.applyFocus((previous) => {
            // A move with no button down is not a selection.
            if (selType === "drag" && !previous?.isDragging) return previous;

            // Right-clicking inside a selection opens a menu on the range rather than
            // collapsing it to one cell.
            if (selType === "rightClick" && this.inSelection(colIndex, rowIndex)) {
                return previous;
            }

            // A drag that has not left its cell yet. Bailing here keeps `onFocusChange` from
            // firing on every pointer move.
            if (
                selType === "drag" &&
                previous?.selection?.rowEnd === rowIndex &&
                previous.selection.colEnd === colIndex
            ) {
                return previous;
            }

            const end = {
                rowKeyEnd: getRowKey(row),
                colKeyEnd: column.key,
                rowEnd: rowIndex,
                colEnd: colIndex,
            };

            const start =
                selType === "click" ||
                selType === "rightClick" ||
                !previous?.selection
                    ? {
                          rowKeyStart: getRowKey(row),
                          colKeyStart: column.key,
                          rowStart: rowIndex,
                          colStart: colIndex,
                      }
                    : {
                          rowKeyStart: previous.selection.rowKeyStart,
                          colKeyStart: previous.selection.colKeyStart,
                          rowStart: previous.selection.rowStart,
                          colStart: previous.selection.colStart,
                      };

            return {
                rowKey: end.rowKeyEnd,
                columnKey: end.colKeyEnd,
                isDragging: Boolean(options?.startDrag || previous?.isDragging),
                selection: { ...end, ...start },
            };
        });

        if (options?.withScroll) {
            void this.model.renderModel?.scrollTo(
                this.model.dataRowToGridRow(rowIndex),
                colIndex,
            );
        }
    }

    // -----------------------------------------------------------------------
    // Keeping the focus valid across data changes
    // -----------------------------------------------------------------------

    private onDataChange = (e: AVGridDataChangeEvent): void => {
        if (e.rows || e.columns) this.validateFocus();
    };

    /**
     * Re-anchor the focus after the rows or columns moved under it.
     *
     * Keys are the source of truth here: a sort reorders the same rows, so the focused cell
     * follows its row rather than staying at an index. When the keys have gone entirely — a
     * filter hid the row, or `setRows` replaced it — the focus falls back to the index it had,
     * clamped into range, which is what keeps the grid usable after a filter.
     */
    validateFocus = (): void => {
        const getRowKey = this.model.options.getRowKey;
        const { rows, columns } = this.model.data;

        this.applyFocus((oldFocus) => {
            if (!oldFocus) return oldFocus;

            const rowIndex = rows.findIndex((r) => getRowKey(r) === oldFocus.rowKey);
            const colIndex = columns.findIndex((c) => c.key === oldFocus.columnKey);

            if (rowIndex < 0 || colIndex < 0 || this.focusFromIndex) {
                this.focusFromIndex = false;
                if (!rows.length || !columns.length) return undefined;

                const rIdx = Math.min(
                    oldFocus.selection?.rowEnd ?? 0,
                    rows.length - 1,
                );
                const cIdx = Math.min(
                    oldFocus.selection?.colEnd ?? 0,
                    columns.length - 1,
                );
                const rowKey = getRowKey(rows[rIdx]);
                const columnKey = columns[cIdx].key;
                return {
                    columnKey,
                    rowKey,
                    isDragging: false,
                    selection: {
                        colStart: cIdx,
                        colKeyStart: columnKey,
                        rowStart: rIdx,
                        rowKeyStart: rowKey,
                        colEnd: cIdx,
                        colKeyEnd: columnKey,
                        rowEnd: rIdx,
                        rowKeyEnd: rowKey,
                    },
                };
            }

            const oldSelection = oldFocus.selection;
            if (!oldSelection) return oldFocus;

            const startRowIndex = rows.findIndex(
                (r) => getRowKey(r) === oldSelection.rowKeyStart,
            );
            const startColIndex = columns.findIndex(
                (c) => c.key === oldSelection.colKeyStart,
            );

            if (
                startRowIndex === oldSelection.rowStart &&
                startColIndex === oldSelection.colStart &&
                rowIndex === oldSelection.rowEnd &&
                colIndex === oldSelection.colEnd
            ) {
                return oldFocus;
            }

            // The rows moved. A multi-cell selection cannot survive that meaningfully — the
            // rows it covered are no longer adjacent — so it collapses onto the focused cell,
            // which is followed to wherever it went.
            if (this.model.flags.noScrollOnFocus) {
                this.model.flags.noScrollOnFocus = false;
            } else {
                void this.model.renderModel?.scrollToRow(
                    this.model.dataRowToGridRow(rowIndex),
                    "center",
                );
            }

            return {
                ...oldFocus,
                selection: {
                    ...oldSelection,
                    rowStart: rowIndex,
                    colStart: colIndex,
                    rowEnd: rowIndex,
                    colEnd: colIndex,
                },
            };
        });
    };

    // -----------------------------------------------------------------------
    // Pointer
    // -----------------------------------------------------------------------

    private onCellMouseDown = (data: {
        e: MouseEvent;
        rowIndex: number;
        colIndex: number;
    }): void => {
        const primary = data.e.button === 0;
        this.updateFocus(
            data.rowIndex,
            data.colIndex,
            data.e.shiftKey ? "shiftClick" : primary ? "click" : "rightClick",
            // Shift-drag extends the selection rather than re-anchoring it, which the
            // reference could not do: its `dragstart` always reset the anchor.
            { startDrag: primary },
        );
    };

    private onCellSelectMove = (data: { rowIndex: number; colIndex: number }): void => {
        this.updateFocus(data.rowIndex, data.colIndex, "drag");
    };

    private onSelectEnd = (): void => {
        // Only the flag changes, and nothing renders from it — so no cell is marked.
        if (!this._focus?.isDragging) return;
        this._focus = { ...this._focus, isDragging: false };
    };

    // -----------------------------------------------------------------------
    // Keyboard
    // -----------------------------------------------------------------------

    private onContentKeyDown = (e: KeyboardEvent): void => {
        const { rows, columns } = this.model.data;

        if (e.ctrlKey && e.code === "KeyA" && rows.length && columns.length) {
            e.preventDefault();
            e.stopPropagation();
            this.selectRange(0, 0, rows.length - 1, columns.length - 1);
            return;
        }

        if (!NAVIGATION_KEYS.has(e.key)) return;
        if (!rows.length || !columns.length) return;

        e.preventDefault();
        e.stopPropagation();

        let rowIndex = this.ranges.focusRow;
        let columnIndex = this.ranges.focusCol;

        // The first column the focus can live in: pinned-left chrome (the checkbox, a row
        // number) is not focusable by pointer — `onCellPointerDown` returns early for it — so
        // the keyboard must not be the one way in either.
        const firstColumn = Math.min(
            columns.length - 1,
            this.model.data.lastIsStatusIndex + 1,
        );

        // Nothing focused yet — the first navigation key lands on the first data cell. The
        // reference did nothing at all here, which makes a freshly tabbed-into grid feel
        // broken.
        if (rowIndex < 0 || columnIndex < 0) {
            this.updateFocus(0, firstColumn, "click", { withScroll: true });
            return;
        }

        // One viewport, in rows. Falls back to 1 so the keys still work before first layout.
        const page = this.model.renderModel?.visibleRowCount || 1;
        let lastRow = rows.length - 1;
        let lastColumn = columns.length - 1;

        /**
         * Grow the grid by one row off the bottom, or one column off the right.
         *
         * The three navigation keys that can do it are the reference's, and the shape is the
         * one thing worth calling out: the grid grows *first*, then the ordinary movement below
         * runs against the new bounds. Trying to move and then grow gets the clamping wrong.
         */
        const growRow = (): boolean => {
            if (!this.model.models.structure.addTrailingRow().length) return false;
            lastRow = this.model.data.rows.length - 1;
            return true;
        };

        switch (e.key) {
            case "ArrowDown":
                if (rowIndex === lastRow && !e.ctrlKey && !e.shiftKey) growRow();
                rowIndex = e.ctrlKey
                    ? Math.min(lastRow, rowIndex + page)
                    : Math.min(lastRow, rowIndex + 1);
                break;
            case "ArrowUp":
                rowIndex = e.ctrlKey
                    ? Math.max(0, rowIndex - page)
                    : Math.max(0, rowIndex - 1);
                break;
            case "PageDown":
                rowIndex = Math.min(lastRow, rowIndex + page);
                break;
            case "PageUp":
                rowIndex = Math.max(0, rowIndex - page);
                break;
            case "End":
                rowIndex = lastRow;
                if (e.ctrlKey) columnIndex = lastColumn;
                break;
            case "Home":
                rowIndex = 0;
                if (e.ctrlKey) columnIndex = firstColumn;
                break;
            case "ArrowLeft":
                columnIndex = e.ctrlKey
                    ? firstColumn
                    : Math.max(firstColumn, columnIndex - 1);
                break;
            case "ArrowRight":
                // ctrl+→ on the last column adds one, rather than doing nothing twice.
                if (
                    e.ctrlKey &&
                    columnIndex === lastColumn &&
                    this.model.models.structure.canAddColumns &&
                    this.model.models.structure.addBlankColumns(1).length
                ) {
                    lastColumn = this.model.data.columns.length - 1;
                }
                columnIndex = e.ctrlKey
                    ? lastColumn
                    : Math.min(lastColumn, columnIndex + 1);
                break;
            case "Tab":
                if (e.shiftKey) {
                    if (columnIndex > firstColumn) {
                        columnIndex--;
                    } else {
                        columnIndex = lastColumn;
                        rowIndex = Math.max(0, rowIndex - 1);
                    }
                } else {
                    columnIndex =
                        columnIndex < lastColumn ? columnIndex + 1 : firstColumn;
                    // Tabbing off the last cell of the last row wraps onto a new one, which is
                    // how a row gets filled in without touching the mouse.
                    if (columnIndex === firstColumn && rowIndex === lastRow) growRow();
                    if (columnIndex === firstColumn && rowIndex < lastRow) rowIndex++;
                }
                break;
            default:
                break;
        }

        this.updateFocus(
            rowIndex,
            columnIndex,
            // Shift extends the selection, exactly as shift-clicking does. Tab is excluded:
            // shift+Tab is "go back one cell", not "extend".
            e.shiftKey && e.key !== "Tab" ? "shiftClick" : "click",
            { withScroll: true },
        );
    };
}
