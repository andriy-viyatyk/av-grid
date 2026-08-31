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

import { isPinnedLeft } from "../gridUtils";
import type { AVGridModel } from "../model/AVGridModel";
import type { RenderGrid } from "../render/RenderGrid";
import { SELECT_COLUMN_KEY } from "./SelectColumn";
import { showFilterPopover } from "./FilterPopover";
import { gridContextMenuEvent, showGridContextMenu } from "./ContextMenu";

/** How close to a header's right edge a pointer must be to start a resize. */
const RESIZE_GRIP_PX = 11;

const DRAG_MIME = "application/x-av-grid-column";

/**
 * How near an edge of the data area a range drag starts scrolling, and how fast it can go.
 *
 * The zone reaches *inside* the grid by two thirds of a row, so the scroll begins as the
 * pointer arrives at the last visible row rather than only once it has left the grid — which
 * is what makes dragging to row 99,000 feel continuous instead of requiring the pointer to be
 * parked outside the window.
 */
const AUTO_SCROLL_EDGE_PX = 16;
const AUTO_SCROLL_MIN_PX = 2;
const AUTO_SCROLL_MAX_PX = 48;

/** Pixels to scroll this frame, from how far past the edge zone the pointer is. */
function autoScrollStep(overflow: number): number {
    if (overflow === 0) return 0;
    const speed = Math.min(
        AUTO_SCROLL_MAX_PX,
        Math.max(AUTO_SCROLL_MIN_PX, Math.abs(overflow) * 0.5),
    );
    return overflow < 0 ? -speed : speed;
}

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
        /**
         * A right-pinned column resizes from its *left* edge — its right edge is anchored to
         * the viewport, so a right-edge drag would chase a moving target. The width is then
         * the starting width plus how far left the pointer moved.
         */
        fromLeftEdge?: { startX: number; startWidth: number };
    };

    /** The cell the last selection drag move resolved to, so a move inside one cell is free. */
    private selecting = false;
    private lastSelectRow = -1;
    private lastSelectCol = -1;
    /** Where the pointer was on the last move — the auto-scroll loop reads it every frame. */
    private pointerX = 0;
    private pointerY = 0;
    private autoScrollRaf?: number;

    /** Whether `pointerX/Y` describe a pointer that is actually over the grid. */
    private hasPointer = false;
    private hoverRaf?: number;

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
        this.root.addEventListener("pointermove", this.onPointerMove);
        this.root.addEventListener("pointerleave", this.onPointerLeave);
        this.grid.container.addEventListener("scroll", this.onScrolled, { passive: true });
        this.root.addEventListener("dragstart", this.onDragStart);
        this.root.addEventListener("dragover", this.onDragOver);
        this.root.addEventListener("drop", this.onDrop);
        this.root.addEventListener("dragend", this.onDragEnd);
        this.root.addEventListener("copy", this.onCopy);
        this.root.addEventListener("cut", this.onCut);
        this.root.addEventListener("paste", this.onPaste);
    }

    destroy(): void {
        this.root.removeEventListener("keydown", this.onKeyDown);
        this.root.removeEventListener("pointerdown", this.onPointerDown);
        this.root.removeEventListener("click", this.onClick);
        this.root.removeEventListener("dblclick", this.onDoubleClick);
        this.root.removeEventListener("contextmenu", this.onContextMenu);
        this.root.removeEventListener("pointermove", this.onPointerMove);
        this.root.removeEventListener("pointerleave", this.onPointerLeave);
        this.grid.container.removeEventListener("scroll", this.onScrolled);
        this.root.removeEventListener("dragstart", this.onDragStart);
        this.root.removeEventListener("dragover", this.onDragOver);
        this.root.removeEventListener("drop", this.onDrop);
        this.root.removeEventListener("dragend", this.onDragEnd);
        this.root.removeEventListener("copy", this.onCopy);
        this.root.removeEventListener("cut", this.onCut);
        this.root.removeEventListener("paste", this.onPaste);
        this.endResize();
        this.endSelect();
        if (this.hoverRaf !== undefined) {
            cancelAnimationFrame(this.hoverRaf);
            this.hoverRaf = undefined;
        }
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

    /**
     * Put DOM focus on the root, so the keys the grid handles reach it.
     *
     * On *every* press inside the grid, not only on a data cell. The keyboard is only alive
     * while the root holds focus, and until this was hoisted out of `onCellPointerDown` a
     * press that resolved to anything else — a header, the empty area past the last row or
     * right of the last column, the space a status column occupies — left focus wherever it
     * had been. Sorting by clicking a header therefore killed the arrow keys, and in a fresh
     * page where nothing had been focused yet they had never worked at all.
     *
     * The root rather than the element under the pointer, because a cell is pooled and may
     * belong to a different coordinate on the next frame — see the third invariant.
     *
     * Two things are left alone. A press on a control that takes focus itself — an open
     * editor's input, a host's own button rendered into a cell — belongs to that control;
     * stealing it here would close the editor the press was opening. And `preventScroll`,
     * because focusing an element the browser considers off-screen otherwise scrolls the grid
     * to it, which is the one thing a click must never do.
     */
    private focusRoot(target: EventTarget | null): void {
        const el = target as Element | null;
        if (
            el?.closest?.(
                "input, textarea, select, button, a, [contenteditable='true']",
            )
        ) {
            return;
        }
        this.root.focus({ preventScroll: true });
    }

    // -----------------------------------------------------------------------
    // Column resize
    // -----------------------------------------------------------------------

    private onPointerDown = (e: PointerEvent): void => {
        this.focusRoot(e.target);

        const header = this.headerAt(e.target);
        if (!header) {
            this.onCellPointerDown(e);
            return;
        }

        if (e.pointerType === "mouse" && e.buttons !== 1) return;
        if (header.el.getAttribute("data-resizable") !== "true") return;

        const rect = header.el.getBoundingClientRect();
        const pinnedRight = header.el.getAttribute("data-pinned") === "right";
        const offset = pinnedRight ? e.clientX - rect.left : rect.right - e.clientX;
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
            fromLeftEdge: pinnedRight
                ? { startX: e.clientX, startWidth: rect.width }
                : undefined,
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

        const width = state.fromLeftEdge
            ? Math.round(
                  state.fromLeftEdge.startWidth + state.fromLeftEdge.startX - e.clientX,
              )
            : Math.round(e.clientX + state.offset - state.left);
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

        // A status column — the checkbox, a row number — is chrome, not data. Clicking one
        // must not move the cell focus or start a range drag, which is also how the reference
        // behaved, there by simply not binding those handlers to those cells. The click that
        // follows is still delivered, and is what toggles the checkbox.
        if (isPinnedLeft(context.column)) return;

        // Read before sending: `FocusModel` listens too, and moves the focus onto this cell.
        const focus = this.model.models.focus.focus;
        const wasFocused = Boolean(
            focus &&
                focus.rowKey === context.rowKey &&
                String(focus.columnKey) === String(context.column.key),
        );

        this.model.events.cell.onMouseDown.send({
            e,
            row: context.row,
            col: context.column,
            rowIndex: cell.row,
            colIndex: cell.col,
            wasFocused,
        });

        if (e.button !== 0) return;

        // Without this the browser starts a text selection that follows the drag out of the
        // grid and highlights whatever is around it. The grid's own cells set `user-select:
        // none`, but the page outside them does not.
        e.preventDefault();

        // The checkbox in an editable boolean cell, resolved on the press rather than on the
        // click — because by the time the click arrives the box is often a different element.
        // A real press holds the button for ~100ms, and the focus this press just moved (plus
        // the hover glyph swap) repaints the cell in between, rewriting its content. The
        // browser then dispatches `click` on the nearest surviving ancestor, the cell itself,
        // and the box is nowhere in the event's path. The second click worked because by then
        // nothing was left to change. In a pooled grid the press is the only reliable signal.
        const toggle = (e.target as Element | null)?.closest?.(
            '[data-type="bool-toggle"]',
        );
        if (toggle && this.root.contains(toggle)) {
            this.model.models.editing.toggleBooleanCell(cell.row, cell.col);
            this.endDragThatNeverStarted();
            return;
        }

        // That press opened an editor on the cell that already had focus. Arming a range drag
        // now would extend the selection under the pointer while the user is placing a caret in
        // the input that is about to appear beneath it.
        if (this.model.models.editing.isEditingCell(cell.row, cell.col)) {
            this.endDragThatNeverStarted();
            return;
        }

        this.selecting = true;
        this.lastSelectRow = cell.row;
        this.lastSelectCol = cell.col;
        this.pointerX = e.clientX;
        this.pointerY = e.clientY;

        // On `window`, not on the root: a drag that leaves the grid must keep being heard,
        // both to extend the selection and to end it wherever the button is released. Pointer
        // capture would do the same, but it retargets the events to the root and this class
        // resolves everything by hit-testing the point instead.
        window.addEventListener("pointermove", this.onSelectMove);
        window.addEventListener("pointerup", this.endSelect);
        window.addEventListener("pointercancel", this.endSelect);
    };

    private onSelectMove = (e: PointerEvent): void => {
        this.pointerX = e.clientX;
        this.pointerY = e.clientY;
        // The hover is not refreshed here. This fires on `window`, but the root's own
        // `pointermove` fires too whenever the pointer is over the grid, and `pointerleave`
        // clears it when the drag goes outside — so an `elementFromPoint` per move, which
        // forces layout, would buy nothing.
        this.extendSelection();
        this.updateAutoScroll();
    };

    /**
     * Clear `focus.isDragging` on a press that set it and then took an early exit.
     *
     * `cell.onMouseDown` is sent as the *first* thing this handler does — before the button
     * check, before either early return — because a host's `onMouseDown` must see every press.
     * `FocusModel` reads it and sets `isDragging` for a primary press, and only `onSelectEnd`
     * clears it again. But two presses never reach `this.selecting = true`: the boolean-checkbox
     * toggle and a press on the cell that already holds an open editor. Neither installs the
     * `pointerup` listener, so `endSelect` never runs, so nothing ever clears the flag — and
     * `updateFocus` deliberately *preserves* it across later focus moves, because a `drag` update
     * must not clear a drag that is still in progress. The flag therefore latched on for the rest
     * of the grid's life: tick one checkbox, and `getFocus().isDragging` reads true forever.
     *
     * Sending the end event on those two paths is the fix rather than making the flag
     * non-sticky, because the stickiness is correct — the bug is a drag that was announced and
     * never finished.
     */
    private endDragThatNeverStarted(): void {
        if (this.model.models.focus.isDragging) {
            this.model.events.cell.onSelectEnd.send();
        }
    }

    private endSelect = (): void => {
        if (!this.selecting) return;
        this.selecting = false;
        this.lastSelectRow = -1;
        this.lastSelectCol = -1;
        this.stopAutoScroll();

        window.removeEventListener("pointermove", this.onSelectMove);
        window.removeEventListener("pointerup", this.endSelect);
        window.removeEventListener("pointercancel", this.endSelect);

        this.model.events.cell.onSelectEnd.send();
    };

    /** Extend the selection to whatever cell the pointer is now over, or points towards. */
    private extendSelection(): void {
        const target = this.selectionTarget();
        if (!target) return;

        // A drag emits ~60 moves a second and most stay inside one cell. Resolving that here
        // keeps the model from being asked the same question sixty times.
        if (target.row === this.lastSelectRow && target.col === this.lastSelectCol) return;
        this.lastSelectRow = target.row;
        this.lastSelectCol = target.col;

        const context = this.model.cellContext(target.row, target.col);
        if (!context) return;

        this.model.events.cell.onSelectMove.send({
            row: context.row,
            col: context.column,
            rowIndex: target.row,
            colIndex: target.col,
        });
    }

    /**
     * The cell a drag is currently pointing at.
     *
     * Two paths, and the second one is the reason this is not simply a hit test:
     *
     * 1. **Over a cell** — hit-test the point. This is the only thing that resolves the sticky
     *    bands correctly, since a sticky cell overlaps a scrolling one.
     * 2. **Off the data area** — read the edge row and column out of the *geometry*. Clamping
     *    the point back inside and hit-testing that would look equivalent and is not: during
     *    an auto-scroll the DOM is a frame behind the scroll offset, so it would keep
     *    returning the cell that was at the edge before this frame's scroll and the selection
     *    would stall one row short forever.
     */
    private selectionTarget(): { row: number; col: number } | undefined {
        const hit = this.dataCellAt(
            this.root.ownerDocument.elementFromPoint(this.pointerX, this.pointerY),
        );
        if (hit) return { row: hit.row, col: hit.col };

        const { x, y } = this.edgeOverflow();
        const { visible } = this.grid.model.renderInfo.current;

        let row = this.lastSelectRow;
        let col = this.lastSelectCol;
        if (y > 0) row = this.model.gridRowToDataRow(visible.bottom);
        else if (y < 0) row = this.model.gridRowToDataRow(visible.top);
        if (x > 0) col = visible.right;
        else if (x < 0) col = visible.left;

        row = Math.max(0, row);
        col = Math.max(0, col);
        if (row >= this.model.data.rows.length || col >= this.model.data.columns.length) {
            return undefined;
        }
        return { row, col };
    }

    /** The scrolling part of the viewport, in client coordinates — sticky bands excluded. */
    private dataAreaRect(): {
        left: number;
        top: number;
        right: number;
        bottom: number;
    } {
        const rect = this.grid.container.getBoundingClientRect();
        const { innerSize } = this.grid.model.renderInfo.current;
        return {
            left: rect.left + innerSize.stickyLeftWidth,
            top: rect.top + innerSize.stickyTopHeight,
            right: rect.right - innerSize.stickyRightWidth - this.grid.model.scrollBarWidth,
            bottom:
                rect.bottom -
                innerSize.stickyBottomHeight -
                this.grid.model.scrollBarHeight,
        };
    }

    /** Signed distance past the edge zone on each axis; `0` means "not near an edge". */
    private edgeOverflow(): { x: number; y: number } {
        const area = this.dataAreaRect();
        const past = (p: number, min: number, max: number): number => {
            const lo = min + AUTO_SCROLL_EDGE_PX;
            const hi = max - AUTO_SCROLL_EDGE_PX;
            if (p < lo) return p - lo;
            if (p > hi) return p - hi;
            return 0;
        };
        return {
            x: past(this.pointerX, area.left, area.right),
            y: past(this.pointerY, area.top, area.bottom),
        };
    }

    private updateAutoScroll(): void {
        if (this.autoScrollRaf !== undefined) return;
        const { x, y } = this.edgeOverflow();
        if (x === 0 && y === 0) return;
        this.autoScrollRaf = requestAnimationFrame(this.autoScrollTick);
    }

    /**
     * Scroll one frame's worth towards the pointer, then extend the selection to the new edge.
     *
     * This is what the reference got for free from HTML5 drag-and-drop, whose auto-scroll is
     * the browser's. Doing it explicitly costs this function and buys three things the
     * browser's version does not give: all four edges, a speed that responds to how far past
     * the edge the pointer is, and scrolling that continues while the pointer sits still
     * outside the grid.
     */
    private autoScrollTick = (): void => {
        this.autoScrollRaf = undefined;
        if (!this.selecting) return;

        const overflow = this.edgeOverflow();
        const dx = autoScrollStep(overflow.x);
        const dy = autoScrollStep(overflow.y);
        if (dx === 0 && dy === 0) return;

        const container = this.grid.container;
        const beforeX = container.scrollLeft;
        const beforeY = container.scrollTop;
        container.scrollLeft += dx;
        container.scrollTop += dy;

        // Recompute the geometry now instead of waiting for the scroll event, so the target
        // below is resolved against where the grid *is* rather than where it was. The real
        // scroll event arrives later, sees an unchanged offset, and costs nothing.
        this.grid.model.onScroll();

        this.extendSelection();

        // Both axes hit the end of the content: nothing moved, and nothing more will until
        // the pointer does — at which point `onSelectMove` restarts the loop.
        if (container.scrollLeft === beforeX && container.scrollTop === beforeY) return;

        this.autoScrollRaf = requestAnimationFrame(this.autoScrollTick);
    };

    private stopAutoScroll(): void {
        if (this.autoScrollRaf === undefined) return;
        cancelAnimationFrame(this.autoScrollRaf);
        this.autoScrollRaf = undefined;
    }

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
        if (this.fromEditableControl(e.target)) return;
        // Alt+↓ opens the focused column's filter popover — the Excel gesture, and the one
        // way the funnel is reachable without a pointer. Anchored to the column's header
        // when it is on screen, so it lands where a click would have put it.
        if (e.altKey && e.key === "ArrowDown" && !this.model.options.disableFiltering) {
            const focus = this.model.models.focus.focus;
            const columnKey = focus ? String(focus.columnKey) : undefined;
            const column = columnKey
                ? this.model.data.columns.find((c) => String(c.key) === columnKey)
                : undefined;
            if (column && column.filterType !== null && !isPinnedLeft(column)) {
                e.preventDefault();
                e.stopPropagation();
                const anchor =
                    this.root.querySelector<HTMLElement>(
                        `[data-type="header-cell"][data-column-key="${CSS.escape(String(column.key))}"]`,
                    ) ?? this.root;
                void showFilterPopover(this.model, String(column.key), { anchor });
                return;
            }
        }
        this.model.events.content.onKeyDown.send(e);
    };

    /**
     * Did this event come from inside a control that handles its own keys and clipboard?
     *
     * The open cell editor is exactly that: its arrow keys belong to the caret and its ctrl+C
     * to the text the user selected inside it, not to the grid's cell range.
     */
    private fromEditableControl(target: EventTarget | null): boolean {
        const el = target as Element | null;
        return Boolean(
            el &&
                el !== this.root &&
                el.closest?.("input, textarea, select, [contenteditable='true']"),
        );
    }

    // -----------------------------------------------------------------------
    // Clipboard
    // -----------------------------------------------------------------------

    /**
     * The native clipboard events, which is where ctrl+C / ctrl+X / ctrl+V arrive.
     *
     * Riding the event rather than calling `navigator.clipboard` from a keydown is what keeps
     * paste working without a permission prompt, and copy working outside a secure context.
     * `preventDefault` only when something was actually written, so a ctrl+C the grid has no
     * answer for still copies whatever the browser would have copied.
     */
    private onCopy = (e: ClipboardEvent): void => {
        if (!this.model.models.copyPaste.enabled) return;
        if (this.fromEditableControl(e.target)) return;
        if (this.model.models.copyPaste.writeToEvent(e)) e.preventDefault();
    };

    private onCut = (e: ClipboardEvent): void => {
        if (!this.model.models.copyPaste.enabled) return;
        if (this.fromEditableControl(e.target)) return;
        if (!this.model.models.copyPaste.writeToEvent(e)) return;
        e.preventDefault();
        if (this.model.options.editable) this.model.models.editing.deleteRange();
    };

    private onPaste = (e: ClipboardEvent): void => {
        if (!this.model.models.copyPaste.enabled) return;
        if (this.fromEditableControl(e.target)) return;
        if (this.model.models.copyPaste.pasteFromEvent(e)) e.preventDefault();
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

        // The add-row and add-column buttons. They are overlays rather than cells, but they are
        // still resolved from the root — one place that knows what a click can mean, and one
        // teardown. See the third invariant in `CLAUDE.md`.
        const action = (e.target as Element | null)?.closest?.("[data-avg-action]");
        if (action && this.root.contains(action)) {
            const structure = this.model.models.structure;
            if (action.getAttribute("data-avg-action") === "add-row") {
                structure.addBlankRows(1);
            } else {
                structure.addBlankColumns(1);
            }
            this.root.focus({ preventScroll: true });
            return;
        }

        const header = this.headerAt(e.target);
        if (header) {
            // The select column's header is a checkbox, not a sort control.
            if (header.el.getAttribute("data-column-key") === SELECT_COLUMN_KEY) {
                this.model.models.selected.toggleAll();
                return;
            }

            const filterButton = (e.target as Element | null)?.closest?.(
                '[data-type="filter-button"]',
            );
            // The funnel opens the filter popover, and must not sort the column out from under
            // the click on its way there.
            if (filterButton) {
                e.stopPropagation();
                const columnKey = header.el.getAttribute("data-column-key");
                // A second click on the funnel of the popover already open closes it, rather
                // than reopening it — `Popover` exempts its own anchor from outside-dismissal
                // precisely so this decision is made here.
                if (columnKey) {
                    if (this.model.flags.filterPopover?.columnKey === columnKey) {
                        this.model.flags.filterPopover.close();
                    } else {
                        void showFilterPopover(this.model, columnKey, {
                            anchor: filterButton,
                        });
                    }
                }
                return;
            }
            const key = header.el.getAttribute("data-column-key");
            if (key) {
                // Ctrl+click appends to the sort in `multiSort` mode; Cmd+click means the same
                // on macOS, where Ctrl+click is the context-menu gesture and never gets here.
                this.model.events.onSortColumn.send({
                    columnKey: key,
                    append: e.ctrlKey || e.metaKey,
                });
            }
            return;
        }

        const cell = this.dataCellAt(e.target);
        if (cell) {
            const context = this.model.cellContext(cell.row, cell.col);
            if (context) {
                if (String(context.column.key) === SELECT_COLUMN_KEY) {
                    this.model.models.selected.toggleSelected(context.rowKey);
                    return;
                }
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

    /**
     * Right-click: notify, then show the menu.
     *
     * The order matters. `onCellContextMenu` is a notification and fires whatever happens next,
     * including when the platform menu is the one that appears — a host listening for
     * right-clicks should hear all of them, not only the ones the grid drew a menu for.
     */
    private onContextMenu = (e: MouseEvent): void => {
        let cell = this.dataCellAt(e.target);
        // A keyboard-invoked menu (the Menu key; Shift+F10 where the platform maps it) fires
        // on the focused element — the root — not on a cell. Resolve it to the focused cell
        // when one is rendered, so the keyboard opens the same menu the pointer would there —
        // anchored at that cell, not at whatever coordinates the synthetic event carries.
        let keyboardAnchor: DOMRect | undefined;
        if (!cell && e.target === this.root) {
            const focused = this.model.models.focus.getGridFocus();
            const el = focused
                ? this.root.querySelector<HTMLElement>(
                      `[data-type="data-cell"][data-row="${focused.rowIndex}"][data-col="${focused.colIndex}"]`,
                  )
                : null;
            if (focused && el) {
                cell = { el, row: focused.rowIndex, col: focused.colIndex };
                keyboardAnchor = el.getBoundingClientRect();
            }
        }
        if (cell) {
            const context = this.model.cellContext(cell.row, cell.col);
            if (context) {
                this.model.events.cell.onContextMenu.send({
                    e,
                    row: context.row,
                    col: context.column,
                    rowIndex: cell.row,
                    colIndex: cell.col,
                });
                this.model.options.onCellContextMenu?.(context, e);
            }
        }

        if (this.model.options.disableContextMenu) return;

        // An open editor, or any input the grid put on screen, keeps the platform's own menu:
        // Cut, Paste, Undo and the spelling suggestions are things only the browser can offer,
        // and a text field without them is a worse text field.
        const target = e.target as Element | null;
        if (
            this.model.models.editing.isEditing &&
            (target?.tagName === "INPUT" ||
                target?.tagName === "TEXTAREA" ||
                Boolean(target?.closest?.(".avg-editing")))
        ) {
            return;
        }

        const header = this.headerAt(e.target);
        const hit = cell
            ? ({ target: "cell", rowIndex: cell.row, colIndex: cell.col } as const)
            : header
              ? ({ target: "header", colIndex: header.col } as const)
              : ({ target: "grid" } as const);

        const event = gridContextMenuEvent(this.model, e, hit);
        if (keyboardAnchor) {
            event.x = keyboardAnchor.left + 4;
            event.y = keyboardAnchor.bottom - 2;
        }
        // Only when something was actually shown — an empty menu over an empty grid should leave
        // the browser's own alone rather than swallow the gesture.
        if (showGridContextMenu(this.model, event)) e.preventDefault();
    };

    // -----------------------------------------------------------------------
    // Row hover
    // -----------------------------------------------------------------------

    /**
     * Row hover is the smallest honest test of the dirty-set discipline: moving the pointer
     * down one row must repaint two rows, not the viewport. `pointermove` rather than
     * `mouseover` because pooled elements do not reliably fire enter/leave pairs — and rather
     * than `mousemove`, which looks equivalent and is not: `onCellPointerDown` calls
     * `preventDefault()` to stop the browser starting a text selection, and per the Pointer
     * Events spec that suppresses the compatibility mouse events for the rest of that pointer's
     * stream. So a range drag produced no `mousemove` at all, the highlight stayed on the cell
     * the drag started from, and it jumped to the pointer only when the button came up and the
     * compat events resumed.
     */
    private onPointerMove = (e: PointerEvent): void => {
        this.pointerX = e.clientX;
        this.pointerY = e.clientY;
        this.hasPointer = true;
        const cell = this.dataCellAt(e.target);
        this.setHovered(cell ? cell.row : -1, cell ? cell.col : -1);
    };

    private onPointerLeave = (): void => {
        this.hasPointer = false;
        this.setHovered(-1, -1);
    };

    /**
     * Re-resolve the hover from where the pointer *is*, for the two cases where the row under
     * it changes without the pointer moving: the grid scrolled beneath it, or a drag is in
     * flight and no move event is being delivered to the root.
     */
    private refreshHoverFromPoint(): void {
        if (!this.hasPointer && !this.selecting) return;
        const hit = this.dataCellAt(
            this.root.ownerDocument.elementFromPoint(this.pointerX, this.pointerY),
        );
        this.setHovered(hit ? hit.row : -1, hit ? hit.col : -1);
    }

    /**
     * A wheel tick moves rows under a stationary pointer, so the highlight has to be recomputed
     * even though nothing pointer-shaped happened. It has to happen *after* the paint, or the
     * hit test reads the row that was there before the scroll: `RenderGrid` paints on rAF, and
     * its scroll listener is bound before this one, so a frame requested here runs behind it.
     */
    private onScrolled = (): void => {
        // Before the pointer gate below, and cheap for the same reason: it returns on one
        // comparison unless an editor is open. An editing row scrolled out of view takes its
        // editor's element out of the DOM with it, and the model has to hear about it.
        this.model.models.editing.onViewportScrolled();
        // Nothing to recompute with no pointer over the grid, which is every programmatic
        // scroll and every scrollbar drag that started outside it. Checking here rather than
        // only in the callback keeps a `scrollTo` from queueing a frame per event.
        if (!this.hasPointer && !this.selecting) return;
        if (this.hoverRaf !== undefined) return;
        this.hoverRaf = requestAnimationFrame(() => {
            this.hoverRaf = undefined;
            this.refreshHoverFromPoint();
        });
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
        // No reordering while column groups are shown — a grouped order is a prepared view
        // (`HeaderCell` also stops setting `draggable`; this catches a drag already primed
        // when the groups appeared mid-gesture).
        if (!header || this.resizing || this.model.data.hasGroups) {
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

    /**
     * Which sticky band a column lives in. A reorder may not cross bands: a drop that would
     * move an unpinned column into the pinned tail — or a pinned one out of it — is refused
     * *during* the drag (no drop indicator, no drop), never fixed up after the event.
     */
    private columnBand(key: string): "left" | "scroll" | "right" | undefined {
        const idx = this.model.models.columns.indexOfKey(key);
        if (idx < 0) return undefined;
        const data = this.model.data;
        if (idx <= data.lastIsStatusIndex) return "left";
        if (idx >= data.columns.length - data.stickyRightCount) return "right";
        return "scroll";
    }

    private reorderAllowed(sourceKey: string, targetKey: string | undefined): boolean {
        if (targetKey === undefined) return false;
        // Groups that appeared while a drag was in flight refuse its drop, too.
        if (this.model.data.hasGroups) return false;
        return this.columnBand(sourceKey) === this.columnBand(targetKey);
    }

    private onDragOver = (e: DragEvent): void => {
        const sourceKey = this.model.flags.dragColumnKey;
        if (!sourceKey) return;
        const header = this.headerAt(e.target);
        const key = header?.el.getAttribute("data-column-key") ?? undefined;
        const allowed = key === undefined || this.reorderAllowed(sourceKey, key);

        // No `preventDefault()` over a refused target: the browser then shows the no-drop
        // cursor and will not deliver a drop there.
        if (allowed) {
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        }

        const over = allowed ? key : undefined;
        if (this.model.flags.dragOverColumnKey !== over) {
            this.model.flags.dragOverColumnKey = over;
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

        if (
            sourceKey &&
            targetKey &&
            sourceKey !== targetKey &&
            this.reorderAllowed(sourceKey, targetKey)
        ) {
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
