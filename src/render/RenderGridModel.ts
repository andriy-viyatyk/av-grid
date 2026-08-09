/**
 * Scroll handling, sizing, and dirty-set merging — the stateful half of the engine.
 *
 * Ported from `RenderGrid/RenderGridModel.ts` with the React lifecycle removed. The logic
 * was already framework-free; what changes is how it is driven:
 *
 * | Reference | Here |
 * |---|---|
 * | `extends TComponentModel` | `extends Model` (task 1's observable) |
 * | `mapProps` / `setProps` on every React render | `setOptions(partial)`, called explicitly |
 * | `isFirstUse` + `setTimeout(checkSize, 200)` | a `ResizeObserver` attached in `attach()` |
 * | `isLive` | `disposed` |
 * | `rerender()` bumps state so React repaints | `requestRepaint()` notifies subscribers |
 * | `React.UIEvent` | `Event` |
 *
 * Everything the reference kept out of this file — block styles, class names, extra
 * elements — stays out: those are the DOM shell's business (task 4), not the model's.
 *
 * **The one line that must not change** is in `inputChanged()`: the scroll offset is
 * deliberately excluded from the comparison. Including it would report a change on every
 * scroll frame, which would call `updateRenderInfo({ all: true })` and rebuild every visible
 * cell. See the comment there.
 */

import { Model } from "../core/observable";
import { AsyncRef } from "../core/AsyncRef";
import {
    calcRenderInfo,
    calcScrollOffset,
    calcScrollOffsetX,
    calcScrollOffsetY,
    renderInfoInitialState,
} from "./renderInfo";
import type {
    AdjustRenderRangeFunc,
    ElementLength,
    RenderCellFunc,
    RenderInnerSize,
    RenderInputPrepared,
    RenderPoint,
    RenderSizeOptional,
    RecycleFunc,
    RerenderInfo,
    RowAlign,
} from "./types";

export const defaultRowHeight = 24;
export const defaultColumnWidth = 120;
const defaultOverscanColumns = 0;

/** The inputs whose change forces a full recompute. Compared field by field, minus offset. */
export interface RenderGridModelInput {
    rowCount: number;
    columnCount: number;
    rowHeight: ElementLength;
    columnWidth: ElementLength;
    renderCell: RenderCellFunc;
    stickyTop: number;
    stickyLeft: number;
    stickyRight: number;
    stickyBottom: number;
    overscanColumn: number;
    overscanRow: number;
    fitToWidth: boolean;
    size?: RenderSizeOptional;
    offset: RenderPoint;
    scrollBarWidth: number;
    scrollBarHeight: number;
}

export interface RenderGridOptions {
    /** Debug label, emitted as `data-name` on the root element. Never used for styling. */
    name?: string;
    /** A count, or a function returning one — so a changing row count needs no re-set. */
    rowCount: number | (() => number);
    columnCount: number | (() => number);
    rowHeight?: ElementLength;
    columnWidth: ElementLength;
    renderCell: RenderCellFunc;
    /** Supplied by the DOM shell so `renderCell` can reuse a scrolled-out element. */
    recycle?: RecycleFunc;
    stickyTop?: number;
    stickyLeft?: number;
    stickyRight?: number;
    stickyBottom?: number;
    overscanColumn?: number;
    overscanRow?: number;
    fitToWidth?: boolean;
    whiteSpaceX?: number;
    whiteSpaceY?: number;
    onInnerSizeChange?: (size: RenderInnerSize) => void;
    onAdjustRenderRange?: AdjustRenderRangeFunc;
    onResize?: (size: RenderSizeOptional) => void;
}

export interface RenderGridState {
    /** Bumped whenever the view should repaint from `renderInfo.current`. */
    renderDt: number;
}

export const defaultRenderGridState: RenderGridState = { renderDt: 0 };

export interface RenderGridElements {
    /** The outer element, measured for the viewport size. */
    grid: HTMLElement;
    /** The scrolling element, measured for scrollbar thickness and listened to for scroll. */
    container: HTMLElement;
}

export class RenderGridModel extends Model<RenderGridState> {
    readonly gridRef = new AsyncRef<HTMLElement | undefined>(undefined);
    readonly containerRef = new AsyncRef<HTMLElement | undefined>(undefined);
    readonly renderInfo = new AsyncRef<RenderInputPrepared>(renderInfoInitialState);

    offset: RenderPoint = { x: 0, y: 0 };
    size: RenderSizeOptional = { width: undefined, height: undefined };

    private options: RenderGridOptions;
    private oldInput?: RenderGridModelInput;
    private pendingRerender?: RerenderInfo;
    private updateScheduled = false;
    private resizeObserver?: ResizeObserver;
    private _disposed = false;
    /** The container was hidden, so its scroll position is gone and ours is the real one. */
    private scrollLost = false;

    constructor(options: RenderGridOptions) {
        super({ ...defaultRenderGridState });
        this.options = options;
        // Establish the input baseline so the first setOptions does not report a false change.
        this.inputChanged();
    }

    get disposed(): boolean {
        return this._disposed;
    }

    // -----------------------------------------------------------------------
    // Options
    // -----------------------------------------------------------------------

    getOptions(): Readonly<RenderGridOptions> {
        return this.options;
    }

    /**
     * Replace some or all of the options.
     *
     * The reference did this from `setProps` on every React render; here it is an explicit
     * call, which is the same work without the surrounding framework.
     *
     * Note the reference passed `inRender: true` at this point to avoid a setState during
     * React's render phase — React was about to repaint regardless. Nothing repaints on its
     * own here, so the notification must actually be sent.
     */
    setOptions = (options: Partial<RenderGridOptions>): void => {
        if (this._disposed) return;
        this.options = { ...this.options, ...options };

        if (this.inputChanged()) {
            this.updateRenderInfo({ all: true });
        }
    };

    // -----------------------------------------------------------------------
    // Resolved option accessors
    // -----------------------------------------------------------------------

    get rowCount(): number {
        return typeof this.options.rowCount === "function"
            ? this.options.rowCount()
            : this.options.rowCount;
    }

    get columnCount(): number {
        return typeof this.options.columnCount === "function"
            ? this.options.columnCount()
            : this.options.columnCount;
    }

    /** Thickness of the horizontal scrollbar, measured from the container. */
    get scrollBarWidth(): number {
        const c = this.containerRef.current;
        return c ? c.offsetWidth - c.clientWidth : 0;
    }

    get scrollBarHeight(): number {
        const c = this.containerRef.current;
        return c ? c.offsetHeight - c.clientHeight : 0;
    }

    get visibleRowCount(): number {
        const visible = this.renderInfo.current.visible;
        return visible ? visible.bottom - visible.top + 1 : 0;
    }

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    /**
     * Bind the model to its elements and start observing size.
     *
     * Replaces the reference's `setTimeout(() => this.checkSize(), 200)` on first mount — a
     * poll that both delayed the first paint and missed every later resize.
     */
    attach = ({ grid, container }: RenderGridElements): void => {
        if (this._disposed) return;

        this.gridRef.ref(grid);
        this.containerRef.ref(container);

        if (typeof ResizeObserver !== "undefined") {
            this.resizeObserver = new ResizeObserver(() => this.checkSize());
            this.resizeObserver.observe(grid);
        }

        this.checkSize();
    };

    override dispose(): void {
        this._disposed = true;
        this.resizeObserver?.disconnect();
        this.resizeObserver = undefined;
        super.dispose();
    }

    /** Notify subscribers that the view should repaint from `renderInfo.current`. */
    requestRepaint = (): void => {
        if (this._disposed) return;
        this.state.update((s) => {
            s.renderDt = Date.now();
        });
    };

    checkSize = (): void => {
        if (!this._disposed) this.onFrameResize();
    };

    onFrameResize = (): void => {
        const grid = this.gridRef.current;
        const newSize: RenderSizeOptional = {
            width: grid != null ? grid.offsetWidth : undefined,
            height: grid != null ? grid.offsetHeight : undefined,
        };

        // A grid measuring nothing has been hidden — `display: none` zeroes the container's
        // scrollTop while the model keeps the real offset, so the position has to be put back
        // when it reappears. This flag is the *only* thing that licenses that write: see
        // `restoreScroll`.
        if (!newSize.width && !newSize.height && (this.offset.x || this.offset.y)) {
            this.scrollLost = true;
        }

        if (
            this.size.width !== newSize.width ||
            this.size.height !== newSize.height ||
            this.scrollBarWidth !== this.oldInput?.scrollBarWidth
        ) {
            this.size = newSize;
            // A size change invalidates the geometry, so recompute rather than only
            // repainting — the reference relied on React re-running setProps to do this.
            if (this.inputChanged()) {
                this.updateRenderInfo({ all: true });
            } else {
                this.requestRepaint();
            }
            if (this.options.onResize) {
                const cb = this.options.onResize;
                Promise.resolve().then(() => cb(newSize));
            }
        }
    };

    // -----------------------------------------------------------------------
    // Change detection
    // -----------------------------------------------------------------------

    inputChanged(): boolean {
        const newInput: RenderGridModelInput = {
            rowCount: this.rowCount,
            columnCount: this.columnCount,
            rowHeight: this.options.rowHeight ?? defaultRowHeight,
            columnWidth: this.options.columnWidth,
            renderCell: this.options.renderCell,
            stickyTop: this.options.stickyTop ?? 0,
            stickyLeft: this.options.stickyLeft ?? 0,
            stickyRight: this.options.stickyRight ?? 0,
            stickyBottom: this.options.stickyBottom ?? 0,
            overscanColumn: this.options.overscanColumn ?? defaultOverscanColumns,
            overscanRow: this.options.overscanRow ?? 0,
            fitToWidth: this.options.fitToWidth ?? false,
            size: this.size,
            offset: this.offset,
            scrollBarWidth: this.scrollBarWidth,
            scrollBarHeight: this.scrollBarHeight,
        };
        const oldInput: Partial<RenderGridModelInput> = this.oldInput || {};
        this.oldInput = newInput;

        // The scroll offset is carried on `newInput` but is deliberately NOT compared.
        //
        // Scroll is handled by onScroll -> updateRenderInfo(undefined, direction), which
        // renders only the newly-exposed cells. Comparing the offset here would report a
        // change on every scroll frame, forcing updateRenderInfo({ all: true }) and
        // rebuilding every visible cell 60 times a second.
        //
        // This is the single most important line in the port. Do not "fix" it by adding the
        // offset for symmetry.
        return (
            newInput.rowCount !== oldInput.rowCount ||
            newInput.columnCount !== oldInput.columnCount ||
            newInput.rowHeight !== oldInput.rowHeight ||
            newInput.columnWidth !== oldInput.columnWidth ||
            newInput.renderCell !== oldInput.renderCell ||
            newInput.stickyTop !== oldInput.stickyTop ||
            newInput.stickyLeft !== oldInput.stickyLeft ||
            newInput.stickyRight !== oldInput.stickyRight ||
            newInput.stickyBottom !== oldInput.stickyBottom ||
            newInput.overscanColumn !== oldInput.overscanColumn ||
            newInput.overscanRow !== oldInput.overscanRow ||
            newInput.fitToWidth !== oldInput.fitToWidth ||
            !newInput.size ||
            !oldInput.size ||
            newInput.size.width !== oldInput.size.width ||
            newInput.size.height !== oldInput.size.height ||
            newInput.scrollBarWidth !== oldInput.scrollBarWidth ||
            newInput.scrollBarHeight !== oldInput.scrollBarHeight
        );
    }

    // -----------------------------------------------------------------------
    // Dirty-set merging
    // -----------------------------------------------------------------------

    /**
     * Union of two dirty sets. `all` wins over anything; the coordinate lists concatenate.
     *
     * No deduplication: `prepareRerender` builds lookup maps from these, so a repeated entry
     * costs one extra map assignment and nothing else. Deduplicating here would cost more
     * than it saves on the hot path.
     */
    mergeRerenders = (
        one?: RerenderInfo,
        two?: RerenderInfo,
    ): RerenderInfo | undefined => {
        if (!one && !two) {
            return undefined;
        }

        const { all = false, cells = [], rows = [], columns = [] } = one || {};
        const {
            all: oldAll = false,
            cells: oldCells = [],
            rows: oldRows = [],
            columns: oldColumns = [],
        } = two || {};

        return {
            all: all || oldAll,
            cells: [...cells, ...oldCells],
            rows: [...rows, ...oldRows],
            columns: [...columns, ...oldColumns],
        };
    };

    /**
     * Queue a repaint of the named cells.
     *
     * Calls coalesce onto a microtask, so a burst of model changes in one tick produces one
     * recompute carrying the union of everything marked. `force` bypasses the queue and
     * recomputes synchronously.
     */
    update = (rerender?: RerenderInfo): void => {
        if (this._disposed) return;

        this.pendingRerender = this.mergeRerenders(rerender, this.pendingRerender);

        if (rerender && rerender.force) {
            this.updateRenderInfo();
        } else if (!this.updateScheduled) {
            this.updateScheduled = true;
            Promise.resolve().then(() => {
                this.updateScheduled = false;
                if (!this._disposed && this.pendingRerender) {
                    this.updateRenderInfo();
                }
            });
        }
    };

    // -----------------------------------------------------------------------
    // Recompute
    // -----------------------------------------------------------------------

    updateRenderInfo = (
        rerender?: RerenderInfo,
        direction?: RenderPoint,
        inRender?: boolean,
    ): void => {
        if (this._disposed) return;

        const {
            rowHeight = defaultRowHeight,
            columnWidth,
            renderCell,
            stickyTop,
            stickyLeft,
            stickyRight,
            stickyBottom,
            overscanColumn = defaultOverscanColumns,
            overscanRow,
            fitToWidth = false,
            onAdjustRenderRange,
        } = this.options;

        const mergedRerender = this.mergeRerenders(rerender, this.pendingRerender);

        // Guard against the initial-state trap documented in tasks/plan.md: the initial
        // render info has an all-zero visibleOffset, so a *directional* call at offset (0,0)
        // would match it and return having rendered nothing, leaving the grid blank. Scrolling
        // back to the very top before anything has rendered would otherwise do exactly that.
        const safeDirection =
            this.renderInfo.current === renderInfoInitialState ? undefined : direction;

        const newInfo = calcRenderInfo(
            this.renderInfo.current,
            {
                rowCount: this.rowCount,
                columnCount: this.columnCount,
                rowHeight,
                columnWidth,
                renderCell,
                recycle: this.options.recycle,
                stickyTop: stickyTop ?? 0,
                stickyLeft: stickyLeft ?? 0,
                stickyRight: stickyRight ?? 0,
                stickyBottom: stickyBottom ?? 0,
                overscanColumn,
                overscanRow: overscanRow ?? 0,
                fitToWidth,
                size: {
                    width: this.size.width || 0,
                    height: this.size.height || 0,
                },
                offset: this.offset,
                scrollBarWidth: this.scrollBarWidth,
                scrollBarHeight: this.scrollBarHeight,
                rerender: mergedRerender,
                direction: safeDirection,
                onAdjustRenderRange,
            },
            this.options.whiteSpaceY,
            this.options.whiteSpaceX,
        );

        // The content shrank to less than a viewport while scrolled down — snap to the top
        // and recompute, or the grid would show empty space below the last row.
        if (newInfo.innerSize.height < (this.size.height ?? 0) && this.offset.y > 0) {
            this.offset.y = 0;
            this.updateRenderInfo(rerender, direction, inRender);
            return;
        }

        this.pendingRerender = undefined;

        // `calcRenderInfo` returns the identical object when there is nothing to do.
        if (newInfo !== this.renderInfo.current) {
            const oldInfo = this.renderInfo.current;
            this.renderInfo.ref(newInfo);
            void this.renderInfoChanged(inRender, oldInfo, newInfo);
        }
    };

    async renderInfoChanged(
        inRender: boolean | undefined,
        oldInfo: RenderInputPrepared,
        newInfo: RenderInputPrepared,
    ): Promise<void> {
        if (!inRender) this.requestRepaint();

        const container = await this.containerRef.async;

        // Painting may have introduced or removed a scrollbar, which changes the usable
        // viewport — repaint once more so the geometry settles.
        if (
            !this._disposed &&
            container &&
            (this.renderInfo.current.input.scrollBarWidth !== this.scrollBarWidth ||
                this.renderInfo.current.input.scrollBarHeight !== this.scrollBarHeight)
        ) {
            this.requestRepaint();
        }

        this.notifyChanges(oldInfo, newInfo);
    }

    notifyChanges(oldInfo: RenderInputPrepared, newInfo: RenderInputPrepared): void {
        if (
            this.options.onInnerSizeChange &&
            (oldInfo.innerSize.height !== newInfo.innerSize.height ||
                oldInfo.innerSize.width !== newInfo.innerSize.width)
        ) {
            this.options.onInnerSizeChange(newInfo.innerSize);
        }
    }

    // -----------------------------------------------------------------------
    // Scrolling
    // -----------------------------------------------------------------------

    onScroll = (e?: Event): void => {
        const container = this.containerRef.current;
        if (!container) return;
        if (e && e.target !== container) return;

        // Ignore scroll events fired while hidden — `display: none` resets scrollTop to 0,
        // and acting on that would lose the user's position.
        if (!container.offsetHeight && !container.offsetWidth) return;

        const { scrollLeft: x, scrollTop: y } = container;
        const direction = {
            x: x - this.offset.x,
            y: y - this.offset.y,
        };
        this.offset = { x, y };
        this.updateRenderInfo(undefined, direction);
    };

    /**
     * Does the container need its scroll position put back?
     *
     * True only after the grid was hidden, which is the one case where the container's own
     * scrollTop is *wrong* rather than merely newer than the model's.
     */
    get scrollNeedsRestore(): boolean {
        return this.scrollLost;
    }

    /**
     * Re-apply the model's offset to the container after it was hidden and reshown.
     *
     * **Never call this to reconcile a mismatch.** A scroll event is delivered a frame after
     * the scroll it reports — a programmatic `scrollTop` write is reported at the next frame,
     * sometimes after that frame's rAF callbacks — so a paint routinely runs while the
     * container is ahead of the model. Writing the model's older offset back there does not
     * "restore" anything: it undoes the user's scroll, and because the write fires a scroll
     * event of its own the two take turns, which reads as a list that scrolls half the time and
     * shows a blank band the rest of it. `scrollLost` exists so this can tell the two apart.
     */
    restoreScroll = (): void => {
        this.scrollLost = false;
        const container = this.containerRef.current;
        if (container && (this.offset.x !== 0 || this.offset.y !== 0)) {
            container.scrollLeft = this.offset.x;
            container.scrollTop = this.offset.y;
        }
    };

    async scrollTo(row: number, col: number): Promise<void> {
        const container = await this.containerRef.async;
        const info = await this.renderInfo.async;

        const newOffset = calcScrollOffset(row, col, info, this.offset);
        if (container) {
            container.scrollLeft = newOffset.x;
            container.scrollTop = newOffset.y;
        }
    }

    async scrollToRow(row: number, rowAlign: RowAlign = "nearest"): Promise<void> {
        const container = await this.containerRef.async;
        const info = await this.renderInfo.async;

        const newOffset = calcScrollOffsetY(row, info, this.offset, rowAlign);
        if (container) {
            container.scrollTop = newOffset.y;
        }
    }

    async scrollToCol(col: number): Promise<void> {
        const container = await this.containerRef.async;
        const info = await this.renderInfo.async;

        const newOffset = calcScrollOffsetX(col, info, this.offset);
        if (container) {
            container.scrollLeft = newOffset.x;
        }
    }

    async scrollBy({ x = 0, y = 0 }: { x?: number; y?: number }): Promise<void> {
        const container = await this.containerRef.async;
        const info = await this.renderInfo.async;

        const maxOffsetX =
            info.innerSize.width - info.input.size.width + info.input.scrollBarWidth;
        const maxOffsetY =
            info.innerSize.height - info.input.size.height + info.input.scrollBarHeight;

        if (x !== 0 && container) {
            container.scrollLeft = Math.min(maxOffsetX, container.scrollLeft + x);
        }
        if (y !== 0 && container) {
            container.scrollTop = Math.min(maxOffsetY, container.scrollTop + y);
        }
    }
}
