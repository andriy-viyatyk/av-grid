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
    SetReuseKeyFunc,
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
    /**
     * Supplied by the DOM shell alongside `recycle`, for a `renderCell` whose rows differ in
     * structure. Like `recycle`, it is forwarded verbatim and deliberately absent from
     * `inputChanged()`: the shell binds it once, so its identity never moves.
     */
    setReuseKey?: SetReuseKeyFunc;
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
    /**
     * The container's scroll position is gone and ours is the real one.
     *
     * Armed when the grid stops being rendered — which in practice means its subtree was
     * **detached**. See `onFrameResize` for why that, and not `display: none`, is the case
     * this exists for, and `restoreScroll` for why it has to survive until a container that
     * can actually accept the write turns up.
     */
    private scrollLost = false;

    /**
     * How many scroll events the container has delivered.
     *
     * Not a statistic. It is the one thing that separates a position the browser *moved* from
     * one it silently *discarded*: every scroll, user or programmatic, is followed by an
     * event, and a detachment reset is followed by none. `revalidateScroll` reads it as a
     * veto — see there.
     */
    private scrollEventCount = 0;

    /**
     * The one scroll request waiting for a paint. See `scrollToRowAfterPaint`.
     *
     * **One slot, last-wins.** It is overwritten rather than appended to, so a burst of
     * requests issued while the extent is unknown collapses to the newest and a stale row is
     * discarded by construction — which is what a caller means: the last row it asked for is
     * the one it wants to see. `scrollToRow`'s unmeasured fallback shares this slot rather
     * than keeping a second one, so the two can never disagree about which row is wanted.
     */
    private pendingScrollRow?: { row: number; align: RowAlign };

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

    /**
     * Does the grid have a real layout box yet — i.e. is a `scrollTop` write meaningful?
     *
     * Both halves matter. A root with no measured size means the geometry was computed from a
     * zero viewport, so `calcScrollOffsetY` has nothing to align against; a container with no
     * layout box has no scroll box either, so a write to it is clamped to zero and discarded.
     * A grid built inside a popover that lays out later is both, for its first few frames.
     */
    get measured(): boolean {
        if (!this.size.width || !this.size.height) return false;
        const container = this.containerRef.current;
        return !!container && !!(container.offsetHeight || container.offsetWidth);
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
        // A grid that is never measured and then disposed never runs its queued scroll. That
        // is correct; the slot is cleared so a retained model reference cannot resurrect it.
        this.pendingScrollRow = undefined;
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

        // A grid measuring nothing is not being rendered: it was hidden, or — the case that
        // matters — its subtree was detached.
        //
        // The comment that used to be here said `display: none` zeroes the container's
        // scrollTop. **That was measured false**, twice: a hidden element merely *reports* 0
        // because it has no scroll box, and Chromium hands the real value straight back on
        // show. Verified here across a synchronous hide and a 900 ms one — 20000 before,
        // 20000 immediately after, no frame needed. So hiding never needed this flag.
        //
        // **Detachment does.** Chromium resets every scroller inside a removed subtree, keeps
        // it reset when the subtree is put back, and fires **no scroll event** either way — so
        // nothing downstream can notice, and the grid paints rows at an offset the container
        // no longer has until the user scrolls. Measured: 20000 → 0, no event, the whole
        // viewport unpainted.
        //
        // Both look identical from here — 0x0 with a non-zero offset — so both arm the flag,
        // and the hide case simply rewrites the value the browser already restored. This flag
        // is the *only* thing that licenses that write: see `restoreScroll`.
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

        const { all = false, cells = [], rows = [], columns = [], fromRow } = one || {};
        const {
            all: oldAll = false,
            cells: oldCells = [],
            rows: oldRows = [],
            columns: oldColumns = [],
            fromRow: oldFromRow,
        } = two || {};

        return {
            all: all || oldAll,
            cells: [...cells, ...oldCells],
            rows: [...rows, ...oldRows],
            columns: [...columns, ...oldColumns],
            // The *lower* of the two wins, because `fromRow` names the first row that moved:
            // if row 40 shifted and then row 12 did, everything from 12 down is invalid. Taking
            // the newer or the larger would leave the rows between them drawn at stale offsets.
            fromRow:
                fromRow === undefined
                    ? oldFromRow
                    : oldFromRow === undefined
                      ? fromRow
                      : Math.min(fromRow, oldFromRow),
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

        // Guard against the initial-state trap documented in tasks/plan-done-01.md: the initial
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
                setReuseKey: this.options.setReuseKey,
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

        // Ignore scroll events fired while hidden — a container with no scroll box reports 0,
        // and acting on that would lose the user's position. Counted before the bail-out all
        // the same: `revalidateScroll` needs to know an event arrived, not what it said.
        this.scrollEventCount++;
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
        const container = this.containerRef.current;
        if (!container) return;

        // **The flag is cleared only by a write that can actually land**, and that is the whole
        // repair. Before this guard the sequence went: the host detaches the subtree → the
        // ResizeObserver reports 0x0 → the flag arms → the size change forces a recompute and
        // a paint → the paint calls this → the offset is written to a *detached* container,
        // where it does nothing, and the flag is cleared. By the time the subtree came back
        // there was nothing left to say the position had been lost, so the grid painted rows
        // at an offset the container did not have and sat blank.
        //
        // Measured, and worth stating because the epic guessed otherwise: the flag was never
        // failing to arm. It armed, and was then spent one frame too early.
        if (!container.offsetHeight && !container.offsetWidth) return;

        this.scrollLost = false;
        if (this.offset.x !== 0 || this.offset.y !== 0) {
            container.scrollLeft = this.offset.x;
            container.scrollTop = this.offset.y;
        }
    };

    /**
     * Ask whether the container's scroll position is still the one the model believes in, and
     * put it back if it is not.
     *
     * This exists for the case the size-based detector above cannot see. A host that removes
     * the grid's subtree and re-inserts it **within one task** — which is exactly what a
     * framework does when it moves a node during a commit — still gets its scroller reset by
     * Chromium, but no `ResizeObserver` ever observes a 0x0: observers sample at the end of a
     * frame, and by then the subtree is back at full size. Measured: `scrollTop` 20000 → 0,
     * `resizeObserverSaw0x0: false`.
     *
     * **The naive form of this is wrong**, and `restoreScroll` says why: a scroll event is
     * delivered a frame after the scroll it reports, so "the container disagrees with the
     * model" is the normal state of affairs during a user scroll, and writing the model back
     * there undoes the scroll — the list that scrolls half the time.
     *
     * What separates the two is not the disagreement, it is what follows it. A scroll the
     * browser performed is *always* followed by a scroll event; a position the browser
     * discarded is followed by none. So a disagreement is not acted on immediately: it is
     * carried across two frames, and any scroll event arriving in that window vetoes it. Two
     * rather than one because the documented lag is "a frame, sometimes after that frame's
     * rAF callbacks".
     */
    revalidateScroll = (): void => {
        if (this._disposed) return;
        const container = this.containerRef.current;
        if (!container) return;

        if (container.scrollLeft === this.offset.x && container.scrollTop === this.offset.y) {
            return;
        }

        const seen = this.scrollEventCount;
        const settle = (): void => {
            if (this._disposed) return;
            // The user scrolled after all. Their position is the newer one; leave it alone.
            if (this.scrollEventCount !== seen) return;
            // **A queued scroll outranks this.** Both want to write `scrollTop`, and they mean
            // different things: this is repairing a position the browser discarded, while the
            // register holds a position the *host explicitly asked for* — and asked for later.
            // Restoring first would write the stale offset, fire a scroll event of its own, and
            // then be overwritten by the flush a frame later: a visible jump to the old place
            // and back, and, because that event is what vetoes a reconciliation, a race with
            // whatever runs next. So the newer request wins outright, and it repairs the same
            // damage on its way past — `flushPendingScroll` clears `scrollLost` because a
            // landed scroll leaves nothing to restore.
            if (this.pendingScrollRow) return;
            this.scrollLost = true;
            this.restoreScroll();
        };

        if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(() => requestAnimationFrame(settle));
        } else {
            settle();
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

    /**
     * Scroll `row` into view, or remember the request until the grid has a usable size.
     *
     * Awaiting the container and the render info is not enough on its own: `renderInfo.async`
     * resolves on the *first* computation, which for a grid built inside a popover that lays
     * out later is the one taken with a height of 0. `calcScrollOffsetY` then works from a zero
     * viewport, the browser clamps the result, and nothing re-issues the scroll when the
     * `ResizeObserver` finally delivers the real size — the target row ends up pinned near the
     * top. Measured before this guard existed: a request for row 1,500 landed at 0.
     *
     * So an unmeasured request goes into the same one-slot register `scrollToRowAfterPaint`
     * uses, and is drained by the same `flushPendingScroll()`.
     */
    async scrollToRow(row: number, rowAlign: RowAlign = "nearest"): Promise<void> {
        if (this._disposed) return;

        const container = await this.containerRef.async;
        const info = await this.renderInfo.async;
        // Both awaits can resolve after teardown; writing scrollTop on a detached container is
        // harmless but pointless.
        if (this._disposed) return;

        // Checked *after* the awaits, not before: a caller that scrolls before `attach()` is
        // relying on the await to hold the request until the grid exists, and that has always
        // worked. Only a grid that is attached and still unmeasurable needs the register.
        if (!this.measured) {
            this.pendingScrollRow = { row, align: rowAlign };
            // The flush happens at the end of a paint, so make sure one is coming. `update()`
            // usually has already scheduled it; this makes the call safe on its own.
            this.requestRepaint();
            return;
        }
        this.pendingScrollRow = undefined;

        const newOffset = calcScrollOffsetY(row, info, this.offset, rowAlign);
        if (container) {
            container.scrollTop = newOffset.y;
        }
    }

    /**
     * Queue a scroll for the end of the next paint.
     *
     * Use this — not `scrollToRow` — when the caller has just changed the row set. `scrollTop`
     * is clamped to the scrollable extent, and the extent is the sizer's height, which the
     * paint writes. Scrolling before that frame silently clamps to the **old** extent: the list
     * then renders correctly and is simply scrolled to the wrong place, with nothing re-issuing
     * the request.
     *
     * Measured here, on a grid grown from 20 rows to 3,000 in one turn and asked for row 2,000:
     * the request should land at 48,000 and lands at **100**, the entire old extent. A
     * `setTimeout(0)` does not help — it lands after the microtask that recomputes `renderInfo`
     * but before the animation frame that applies it — and neither does a single
     * `requestAnimationFrame`, which is registered before the paint's own frame. Both measured
     * at 100 alongside the direct call.
     *
     * Shares the one-slot, last-wins register with `scrollToRow`'s unmeasured fallback, and is
     * drained by the same `flushPendingScroll()`.
     */
    scrollToRowAfterPaint(row: number, rowAlign: RowAlign = "nearest"): void {
        if (this._disposed) return;
        this.pendingScrollRow = { row, align: rowAlign };
        // The reference required the caller to have scheduled a paint. Requesting one here
        // instead makes the call correct on its own, which is what an API meant to be used
        // without reading docs has to be — and a repaint that finds nothing changed is the
        // early-return branch of `paint()`, which flushes too.
        this.requestRepaint();
    }

    /**
     * Run the queued scroll, if there is one and the grid can now accept it.
     *
     * Called by the shell at the end of a paint, and deliberately **not** from `onFrameResize`.
     * The resize callback knows the grid *root* has a size, which is not the same as the scroll
     * container having a layout box: the write does stick, but the scroll event it fires is
     * delivered while the container still measures 0x0, so `onScroll`'s hidden-guard discards
     * it and the model's offset stays behind the DOM — a container scrolled to row 4,000 with
     * row 0 still painted at the top. By the end of a paint the container is live (the paint has
     * already read its scrollbar thickness), so the event lands on the normal path.
     *
     * Consumed exactly once: flushing on every paint would drag the user back to the queued row
     * every time they scrolled away from it.
     */
    flushPendingScroll(): void {
        if (this._disposed || !this.pendingScrollRow || !this.measured) return;

        const pending = this.pendingScrollRow;
        this.pendingScrollRow = undefined;

        // A queued scroll that lands *is* a restore: it writes a fresh, deliberate offset to a
        // container that can accept it, which is everything `restoreScroll` was going to do
        // with a staler number. Leaving the flag armed would have the next paint overwrite this
        // scroll with the old offset.
        this.scrollLost = false;

        void this.scrollToRow(pending.row, pending.align);
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
