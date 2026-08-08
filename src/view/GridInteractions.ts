/**
 * Every pointer, mouse and drag listener the grid owns — all of them on the root element.
 *
 * The reference bound handlers per cell, which React made cheap by memoizing them. In a
 * pooled DOM grid that approach is not merely slower, it is unsound: an element that was a
 * header cell on one frame is a data cell on the next, so per-cell listeners would have to be
 * removed on every recycle and any one missed would fire against the wrong column. Delegating
 * from the root removes the problem rather than managing it — and costs nine listeners for
 * the whole grid instead of a dozen per visible cell.
 *
 * Every handler resolves its target the same way: find the nearest cell element, read
 * `data-row` / `data-col` off it, and go to the model from there. The DOM is the source of
 * truth for *where a pointer is*, which is the one thing it genuinely knows better than the
 * model does.
 */

import type { AVGridModel } from "../model/AVGridModel";
import type { RenderGrid } from "../render/RenderGrid";

/** How close to a header's right edge a pointer must be to start a resize. */
const RESIZE_GRIP_PX = 11;

const DRAG_MIME = "application/x-av-grid-column";

interface CellRef {
    el: HTMLElement;
    row: number;
    col: number;
}

export class GridInteractions<R> {
    private readonly model: AVGridModel<R>;
    private readonly grid: RenderGrid;
    private readonly root: HTMLElement;

    /** Set while a resize drag is in flight, so the click that ends it does not sort. */
    private resizing = false;
    private suppressClick = false;
    private resizeState?: {
        columnKey: string;
        pointerId: number;
        /** Distance from the pointer to the column's right edge when the drag started. */
        offset: number;
        left: number;
    };

    /** The cell the last selection drag move resolved to, so a move inside one cell is free. */
    private lastSelectCell = -1;

    constructor(model: AVGridModel<R>, grid: RenderGrid) {
        this.model = model;
        this.grid = grid;
        this.root = grid.root;

        // Keyboard navigation needs somewhere for focus to land, and the root is the only
        // element that survives every repaint — a cell is pooled and may belong to a different
        // coordinate on the next frame.
        this.root.tabIndex = 0;

        this.root.addEventListener("keydown", this.onKeyDown);
        this.root.addEventListener("pointerdown", this.onPointerDown);
        this.root.addEventListener("click", this.onClick);
        this.root.addEventListener("dblclick", this.onDoubleClick);
        this.root.addEventListener("contextmenu", this.onContextMenu);
        this.root.addEventListener("mousemove", this.onMouseMove);
        this.root.addEventListener("mouseleave", this.onMouseLeave);
        this.root.addEventListener("dragstart", this.onDragStart);
        this.root.addEventListener("dragover", this.onDragOver);
        this.root.addEventListener("drop", this.onDrop);
        this.root.addEventListener("dragend", this.onDragEnd);
    }

    destroy(): void {
        this.root.removeEventListener("keydown", this.onKeyDown);
        this.root.removeEventListener("pointerdown", this.onPointerDown);
        this.root.removeEventListener("click", this.onClick);
        this.root.removeEventListener("dblclick", this.onDoubleClick);
        this.root.removeEventListener("contextmenu", this.onContextMenu);
        this.root.removeEventListener("mousemove", this.onMouseMove);
        this.root.removeEventListener("mouseleave", this.onMouseLeave);
        this.root.removeEventListener("dragstart", this.onDragStart);
        this.root.removeEventListener("dragover", this.onDragOver);
        this.root.removeEventListener("drop", this.onDrop);
        this.root.removeEventListener("dragend", this.onDragEnd);
        this.endResize();
        this.endSelect();
    }

    // -----------------------------------------------------------------------
    // Target resolution
    // -----------------------------------------------------------------------

    private headerAt(target: EventTarget | null): CellRef | undefined {
        const el = (target as Element | null)?.closest?.(
            '[data-type="header-cell"]',
        ) as HTMLElement | null;
        if (!el || !this.root.contains(el)) return undefined;
        return { el, row: 0, col: Number(el.getAttribute("data-col")) };
    }

    private dataCellAt(target: EventTarget | null): CellRef | undefined {
        const el = (target as Element | null)?.closest?.(
            '[data-type="data-cell"]',
        ) as HTMLElement | null;
        if (!el || !this.root.contains(el)) return undefined;
        return {
            el,
            row: Number(el.getAttribute("data-row")),
            col: Number(el.getAttribute("data-col")),
        };
    }

    // -----------------------------------------------------------------------
    // Column resize
    // -----------------------------------------------------------------------

    private onPointerDown = (e: PointerEvent): void => {
        const header = this.headerAt(e.target);
        if (!header) {
            this.onCellPointerDown(e);
            return;
        }

        if (e.pointerType === "mouse" && e.buttons !== 1) return;
        if (header.el.getAttribute("data-resizable") !== "true") return;

        const rect = header.el.getBoundingClientRect();
        const offset = rect.right - e.clientX;
        if (offset > RESIZE_GRIP_PX) return;

        e.stopPropagation();
        e.preventDefault();

        this.resizing = true;
        this.suppressClick = true;
        this.resizeState = {
            columnKey: header.el.getAttribute("data-column-key") ?? "",
            pointerId: e.pointerId,
            offset,
            left: rect.left,
        };

        this.root.setPointerCapture(e.pointerId);
        this.root.addEventListener("pointermove", this.onResizeMove);
        this.root.addEventListener("pointerup", this.endResize);
        this.root.addEventListener("lostpointercapture", this.endResize);
    };

    private onResizeMove = (e: PointerEvent): void => {
        const state = this.resizeState;
        if (!state) return;
        e.preventDefault();

        const width = Math.round(e.clientX + state.offset - state.left);
        if (width > 0) {
            this.model.events.onColumnResize.send({
                columnKey: state.columnKey,
                width,
            });
        }
    };

    private endResize = (): void => {
        if (!this.resizeState) return;
        const { pointerId } = this.resizeState;
        this.resizeState = undefined;
        this.resizing = false;

        this.root.removeEventListener("pointermove", this.onResizeMove);
        this.root.removeEventListener("pointerup", this.endResize);
        this.root.removeEventListener("lostpointercapture", this.endResize);
        if (this.root.hasPointerCapture?.(pointerId)) {
            this.root.releasePointerCapture(pointerId);
        }
    };

    // -----------------------------------------------------------------------
    // Focus and range selection
    // -----------------------------------------------------------------------

    /**
     * A pointer went down on a data cell: focus the grid, move the cell focus, and — for the
     * primary button — arm a range drag.
     *
     * The reference did the drag with HTML5 drag-and-drop, which meant `draggable` on every
     * cell, a 1×1 transparent GIF as the drag image, and a `dragenter` handler per cell. All
     * three are avoidable here, and the last one is actively hostile to a pooled grid. Pointer
     * events also mean the header's column-reorder drag and the cells' selection drag no
     * longer share one event stream that each has to filter itself out of.
     */
    private onCellPointerDown = (e: PointerEvent): void => {
        const cell = this.dataCellAt(e.target);
        if (!cell) return;

        const context = this.model.cellContext(cell.row, cell.col);
        if (!context) return;

        // Focus the root rather than letting the browser do it: the cell under the pointer is
        // a pooled element and must never itself hold focus.
        this.root.focus({ preventScroll: true });

        this.model.events.cell.onMouseDown.send({
            e,
            row: context.row,
            col: context.column,
            rowIndex: cell.row,
            colIndex: cell.col,
        });

        if (e.button !== 0) return;

        this.lastSelectCell = cell.row * 1e6 + cell.col;
        this.root.addEventListener("pointermove", this.onSelectMove);
        // On `window`, so releasing outside the grid still ends the drag.
        window.addEventListener("pointerup", this.endSelect);
        window.addEventListener("pointercancel", this.endSelect);
    };

    private onSelectMove = (e: PointerEvent): void => {
        const cell = this.dataCellAt(e.target);
        if (!cell) return;

        // A drag emits ~60 moves a second and most of them stay inside one cell. Resolving
        // that here keeps the model from being asked the same question sixty times.
        const id = cell.row * 1e6 + cell.col;
        if (id === this.lastSelectCell) return;
        this.lastSelectCell = id;

        const context = this.model.cellContext(cell.row, cell.col);
        if (!context) return;

        this.model.events.cell.onSelectMove.send({
            row: context.row,
            col: context.column,
            rowIndex: cell.row,
            colIndex: cell.col,
        });
    };

    private endSelect = (): void => {
        if (this.lastSelectCell < 0) return;
        this.lastSelectCell = -1;

        this.root.removeEventListener("pointermove", this.onSelectMove);
        window.removeEventListener("pointerup", this.endSelect);
        window.removeEventListener("pointercancel", this.endSelect);

        this.model.events.cell.onSelectEnd.send();
    };

    // -----------------------------------------------------------------------
    // Keyboard
    // -----------------------------------------------------------------------

    /**
     * Every key the grid handles, on the root.
     *
     * Keys originating inside an editable control are left alone — task 12 puts an `<input>`
     * in a cell, and arrow keys there belong to the caret, not to the grid.
     */
    private onKeyDown = (e: KeyboardEvent): void => {
        const target = e.target as Element | null;
        if (
            target &&
            target !== this.root &&
            target.closest?.("input, textarea, select, [contenteditable='true']")
        ) {
            return;
        }
        this.model.events.content.onKeyDown.send(e);
    };

    // -----------------------------------------------------------------------
    // Click
    // -----------------------------------------------------------------------

    private onClick = (e: MouseEvent): void => {
        // A resize ends with a click on the header it resized. Swallow exactly that one.
        if (this.suppressClick) {
            this.suppressClick = false;
            return;
        }
        if (this.resizing) return;

        const header = this.headerAt(e.target);
        if (header) {
            const filterButton = (e.target as Element | null)?.closest?.(
                '[data-type="filter-button"]',
            );
            // The funnel opens a popover in task 16; until then it must not sort the column
            // out from under the click.
            if (filterButton) {
                e.stopPropagation();
                return;
            }
            const key = header.el.getAttribute("data-column-key");
            if (key) this.model.events.onSortColumn.send({ columnKey: key });
            return;
        }

        const cell = this.dataCellAt(e.target);
        if (cell) {
            const context = this.model.cellContext(cell.row, cell.col);
            if (context) {
                this.model.events.cell.onClick.send({
                    e,
                    row: context.row,
                    col: context.column,
                    rowIndex: cell.row,
                    colIndex: cell.col,
                });
                this.model.options.onCellClick?.(context, e);
            }
        }
    };

    private onDoubleClick = (e: MouseEvent): void => {
        const cell = this.dataCellAt(e.target);
        if (!cell) return;
        const context = this.model.cellContext(cell.row, cell.col);
        if (!context) return;

        this.model.events.cell.onDoubleClick.send({
            e,
            row: context.row,
            col: context.column,
            rowIndex: cell.row,
            colIndex: cell.col,
        });
        this.model.options.onCellDoubleClick?.(context, e);
    };

    private onContextMenu = (e: MouseEvent): void => {
        const cell = this.dataCellAt(e.target);
        if (!cell) return;
        const context = this.model.cellContext(cell.row, cell.col);
        if (!context) return;

        this.model.events.cell.onContextMenu.send({
            e,
            row: context.row,
            col: context.column,
            rowIndex: cell.row,
            colIndex: cell.col,
        });
        this.model.options.onCellContextMenu?.(context, e);
    };

    // -----------------------------------------------------------------------
    // Row hover
    // -----------------------------------------------------------------------

    /**
     * Row hover is the smallest honest test of the dirty-set discipline: moving the pointer
     * down one row must repaint two rows, not the viewport. `mousemove` rather than
     * `mouseover` because pooled elements do not reliably fire enter/leave pairs.
     */
    private onMouseMove = (e: MouseEvent): void => {
        const cell = this.dataCellAt(e.target);
        this.setHovered(cell ? cell.row : -1, cell ? cell.col : -1);
    };

    private onMouseLeave = (): void => {
        this.setHovered(-1, -1);
    };

    private setHovered(row: number, col: number): void {
        const current = this.model.data.hovered;
        if (current.row === row && current.col === col) return;

        const previousRow = current.row;
        this.model.data.hovered = { row, col };
        this.model.data.change();

        const rows: number[] = [];
        if (previousRow >= 0) rows.push(this.model.dataRowToGridRow(previousRow));
        if (row >= 0) rows.push(this.model.dataRowToGridRow(row));
        if (rows.length) this.model.update({ rows });
    }

    // -----------------------------------------------------------------------
    // Column reorder
    // -----------------------------------------------------------------------

    private onDragStart = (e: DragEvent): void => {
        const header = this.headerAt(e.target);
        if (!header || this.resizing) {
            e.preventDefault();
            return;
        }
        const key = header.el.getAttribute("data-column-key");
        if (!key) return;

        e.dataTransfer?.setData(DRAG_MIME, key);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        this.model.flags.dragColumnKey = key;
        this.repaintHeader();
    };

    private onDragOver = (e: DragEvent): void => {
        if (!this.model.flags.dragColumnKey) return;
        const header = this.headerAt(e.target);
        const key = header?.el.getAttribute("data-column-key") ?? undefined;

        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";

        if (this.model.flags.dragOverColumnKey !== key) {
            this.model.flags.dragOverColumnKey = key;
            this.repaintHeader();
        }
    };

    private onDrop = (e: DragEvent): void => {
        e.preventDefault();
        const sourceKey =
            e.dataTransfer?.getData(DRAG_MIME) || this.model.flags.dragColumnKey;
        const header = this.headerAt(e.target);
        const targetKey = header?.el.getAttribute("data-column-key");

        this.clearDragState();

        if (sourceKey && targetKey && sourceKey !== targetKey) {
            this.model.events.onColumnsReorder.send({ sourceKey, targetKey });
        }
    };

    private onDragEnd = (): void => {
        this.clearDragState();
    };

    private clearDragState(): void {
        if (
            this.model.flags.dragColumnKey === undefined &&
            this.model.flags.dragOverColumnKey === undefined
        ) {
            return;
        }
        this.model.flags.dragColumnKey = undefined;
        this.model.flags.dragOverColumnKey = undefined;
        this.repaintHeader();
    }

    /** The header is grid row 0 — one row, never the viewport. */
    private repaintHeader(): void {
        this.model.update({ rows: [0] });
    }

    /** Exposed for the shell's `destroy()`; the pool belongs to the grid, not to this class. */
    get owner(): RenderGrid {
        return this.grid;
    }
}
