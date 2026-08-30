/**
 * A virtualized list whose row heights are **measured from the rendered DOM**.
 *
 * `RenderGrid` already accepts a row-height *function*, which covers every height that can be
 * computed — a constant, a lookup, arithmetic over the record. It does not cover a height that
 * is only knowable once the row exists: wrapped text of unpredictable length, a chat bubble, a
 * log entry with a stack trace in it, a comment with an image in it. This is that case.
 *
 * ```js
 * import { MeasuredRowGrid } from "av-grid";
 *
 * const grid = new MeasuredRowGrid(host, {
 *     rowCount: () => entries.length,
 *     columnCount: 1,
 *     columnWidth: () => "100%",
 *     fitToWidth: true,
 *     minRowHeight: 18,
 *     renderCell: (p) => {
 *         const cell = p.previous ?? p.recycle?.() ?? document.createElement("div");
 *         applyCellStyle(cell, p.style);            // as for any RenderGrid renderer
 *         const body = cell.firstElementChild ?? cell.appendChild(document.createElement("div"));
 *         body.textContent = entries[p.row].text;
 *         p.measure(body);                          // ← this row is as tall as `body`
 *         return cell;
 *     },
 * });
 *
 * grid.model.scrollToRow(entries.length - 1, "bottom");
 * ```
 *
 * ## Why a companion, and not options on `RenderGrid`
 *
 * Measuring is expensive and this layer is not: it is one `ResizeObserver`, a `WeakMap` or two,
 * and a debounce. Putting any of it inside the engine would put it on the scroll path of every
 * grid in the library, including the fixed-height one the 100,000-row benchmark measures — for
 * a feature most grids will never ask for. Composed on the outside, a host that does not
 * construct this class runs byte-for-byte the code it ran before this existed.
 *
 * The split inside the companion is the same idea one level down: {@link MeasuredRowHeights}
 * owns *policy* and touches no DOM, this class owns *observation* and adapts the engine beneath
 * it.
 *
 * ## The one thing a renderer must do differently
 *
 * Call `p.measure(element)` with the element whose natural height **is** the row's height —
 * normally a child of the cell, not the cell. The engine writes the cell's `height` from what
 * it currently believes, so a cell measures back exactly what it was told and never grows; a
 * child, laid out by its own content, measures what the row actually needs. A renderer that
 * nominates nothing falls back to measuring the cell, which is correct for a cell the renderer
 * left unsized and a no-op for one it sized.
 */

import { RenderGrid, type RenderGridShellOptions } from "../render/RenderGrid";
import type { RenderGridModel } from "../render/RenderGridModel";
import type { RenderGridStats } from "../render/RenderGrid";
import type { RenderCellParams, RenderCellFunc, RenderedCell } from "../render/types";
import {
    MeasuredRowHeights,
    type MeasuredRowHeightOptions,
} from "./MeasuredRowHeights";

/** `RenderCellParams` plus the one call this layer adds. */
export interface MeasuredRowCellParams extends RenderCellParams {
    /**
     * Nominate the element whose height is this row's height.
     *
     * Call it at most once per render; the last call wins. Nominating a different element than
     * last time un-observes the old one. Nominating nothing measures the cell itself.
     */
    measure: (element: HTMLElement) => void;
}

export type MeasuredRowCellFunc = (p: MeasuredRowCellParams) => RenderedCell;

export interface MeasuredRowGridOptions
    extends Omit<RenderGridShellOptions, "renderCell" | "rowHeight">,
        MeasuredRowHeightOptions {
    /** As `RenderGrid`'s, with `measure` added to the parameters. */
    renderCell: MeasuredRowCellFunc;
}

/**
 * The measured-height companion. Owns a `RenderGrid` and a {@link MeasuredRowHeights}.
 *
 * Everything a host needs from the engine is reachable: {@link MeasuredRowGrid.model} for
 * `update()` / `scrollToRow()`, {@link MeasuredRowGrid.grid} for the shell itself.
 */
export class MeasuredRowGrid {
    /** The height policy. Exposed so a host can read `heightOf(row)` and cache it. */
    readonly heights: MeasuredRowHeights;

    /** The engine underneath. Fully usable; this class only adds to it. */
    readonly grid: RenderGrid;

    private props: MeasuredRowGridOptions;
    private observer?: ResizeObserver;

    /** Which row each observed element stands for. */
    private rowByElement = new WeakMap<HTMLElement, number>();

    /** Which element each cell nominated. Also the "is this cell still mine" check. */
    private nominatedByCell = new WeakMap<HTMLElement, HTMLElement>();

    /** Frames booked for an after-layout measurement, so disposal can cancel them. */
    private readonly pendingFrames = new Set<number>();

    /** Set before anything is torn down, so a callback already in flight stands down. */
    private inert = false;

    constructor(host: HTMLElement, options: MeasuredRowGridOptions) {
        this.props = options;
        this.heights = new MeasuredRowHeights(options);

        // Before the grid: `RenderGrid`'s constructor paints synchronously, so the first cells
        // are rendered — and want observing — before it returns.
        if (typeof ResizeObserver !== "undefined") {
            this.observer = new ResizeObserver(this.onResize);
        }

        this.grid = new RenderGrid(host, this.gridOptions(options));

        // After the grid, necessarily. Nothing is lost by being late: the first paint's
        // measurements are held on a 50 ms debounce, which has not elapsed yet.
        this.heights.setGeometry(this.grid.model);
    }

    get model(): RenderGridModel {
        return this.grid.model;
    }

    get root(): HTMLElement {
        return this.grid.root;
    }

    /** The scrolling element, for a host that needs to read or drive the scroll directly. */
    get scrollElement(): HTMLElement {
        return this.grid.container;
    }

    get stats(): RenderGridStats {
        return this.grid.stats;
    }

    /** See `RenderGrid.addOverlay`. */
    addOverlay(el: HTMLElement, region: "content" | "header" = "content"): void {
        this.grid.addOverlay(el, region);
    }

    /** See `RenderGrid.revalidate`. */
    revalidate(): void {
        this.grid.revalidate();
    }

    /**
     * Replace some or all options.
     *
     * The height policy is **mutated** rather than rebuilt, and the wrapped `renderCell` and
     * `rowHeight` handed to the engine are the same two functions as before — so a change to,
     * say, `maxRowHeight` does not read to `RenderGridModel.inputChanged()` as a new geometry
     * input and does not repaint every visible cell. See `MeasuredRowHeights`.
     */
    setOptions(options: Partial<MeasuredRowGridOptions>): void {
        if (this.inert) return;
        this.props = { ...this.props, ...options };
        this.heights.setProps(this.props);
        this.grid.setOptions(this.gridOptions(this.props));
    }

    /**
     * Tear down, in the order the pieces depend on each other.
     *
     * Inert first — a delayed measurement may already be queued — then the frames, then the
     * observer, then the policy, and the engine last, because destroying it evicts every cell
     * and each eviction runs `onCellReleased`.
     */
    destroy(): void {
        if (this.inert) return;
        this.inert = true;

        for (const frame of this.pendingFrames) cancelAnimationFrame(frame);
        this.pendingFrames.clear();

        this.observer?.disconnect();
        this.observer = undefined;
        this.rowByElement = new WeakMap<HTMLElement, number>();
        this.nominatedByCell = new WeakMap<HTMLElement, HTMLElement>();

        this.heights.dispose();
        this.grid.destroy();
    }

    // -----------------------------------------------------------------------
    // The wrapped renderer
    // -----------------------------------------------------------------------

    /**
     * Bound once. Its identity is what `RenderGridModel.inputChanged()` compares, so it must
     * survive every `setOptions` — the consumer's own renderer is reached through `this.props`.
     */
    private readonly renderCell: RenderCellFunc = (p) => {
        let nominated: HTMLElement | undefined;
        const cell = this.props.renderCell({
            ...p,
            measure: (element) => {
                nominated = element;
            },
        });
        if (!cell) return undefined;

        const previous = this.nominatedByCell.get(cell);
        const target = nominated ?? cell;
        // A pooled cell arrives holding its last occupant's nomination. Replacing it has to
        // un-observe the old element, or a stale target keeps reporting into a row it no longer
        // belongs to.
        if (previous && previous !== target) {
            this.observer?.unobserve(previous);
            this.rowByElement.delete(previous);
        }

        // Rewritten on every render, for `previous` cells as well as pooled ones. This layer
        // deliberately keeps no per-row record of its own beyond these two maps, so it never has
        // to agree with whatever bookkeeping the consumer keeps about its cells.
        this.nominatedByCell.set(cell, target);
        this.rowByElement.set(target, p.row);
        this.observer?.observe(target);
        this.heights.setRowHeight(p.row, target.clientHeight);
        return cell;
    };

    // -----------------------------------------------------------------------
    // Observation
    // -----------------------------------------------------------------------

    private readonly onResize = (entries: ResizeObserverEntry[]): void => {
        if (this.inert) return;
        for (const entry of entries) {
            const target = entry.target;
            if (!(target instanceof HTMLElement)) continue;
            // The element was released, or re-nominated, between the observation and this
            // callback. Its row mapping is gone and the entry means nothing.
            const row = this.rowByElement.get(target);
            if (row === undefined) continue;
            this.heights.setRowHeight(row, target.clientHeight);
        }
    };

    /**
     * A cell entered the active set. Measure it now, and once more after layout.
     *
     * Twice, because the two answer different questions. The synchronous read is what the row
     * looked like the last time it was laid out, which for a re-admitted cell is usually right
     * and is available immediately. The frame-later read is the only one that can see the layout
     * this admission caused — a cell that was retained and hidden measured **zero** while it
     * waited, and a cell built from scratch has not been laid out at all yet.
     */
    private readonly onCellAttached = (element: HTMLElement): void => {
        if (this.inert) return;
        const target = this.nominatedByCell.get(element);
        if (!target) return;
        const row = this.rowByElement.get(target);
        if (row === undefined) return;

        this.heights.setRowHeight(row, target.clientHeight);

        if (typeof requestAnimationFrame !== "function") return;
        const frame = requestAnimationFrame(() => {
            this.pendingFrames.delete(frame);
            // Four guards, and each covers a real race: the layer was disposed; the cell was
            // recycled to another row and nominated something else; the target was re-mapped;
            // the cell was released. A stale measurement here writes a height to the wrong row.
            if (this.inert) return;
            if (this.nominatedByCell.get(element) !== target) return;
            if (this.rowByElement.get(target) !== row) return;
            this.heights.setRowHeight(row, target.clientHeight);
        });
        this.pendingFrames.add(frame);
    };

    /**
     * A cell left the active set.
     *
     * **Not the same as leaving the DOM.** With `keepCellsAttached` the element is still in the
     * document, hidden, and it is still released — which is exactly why the bookkeeping is
     * dropped here rather than on a detach that may never come. A hidden element measures zero,
     * so leaving it observed would feed zeroes in (they are ignored, but the mapping would also
     * outlive the row).
     */
    private readonly onCellReleased = (element: HTMLElement): void => {
        const target = this.nominatedByCell.get(element) ?? element;
        this.observer?.unobserve(target);
        this.rowByElement.delete(target);
        this.nominatedByCell.delete(element);
        this.props.onCellReleased?.(element);
    };

    private readonly onCellAttachedForwarding = (element: HTMLElement): void => {
        this.onCellAttached(element);
        this.props.onCellAttached?.(element);
    };

    // -----------------------------------------------------------------------
    // Options
    // -----------------------------------------------------------------------

    /**
     * Translate this layer's options into the engine's.
     *
     * The five measured-only fields are dropped — the policy has them — and the three functions
     * the engine must see are this object's own bound fields, never the consumer's. `height`,
     * `growToHeight` and the rest pass through untouched, so they mean here exactly what they
     * mean on a bare `RenderGrid`.
     */
    private gridOptions(props: MeasuredRowGridOptions): RenderGridShellOptions {
        const {
            renderCell: _renderCell,
            rowHeight: _rowHeight,
            minRowHeight: _minRowHeight,
            maxRowHeight: _maxRowHeight,
            getInitialRowHeight: _getInitialRowHeight,
            preferMinHeightForNewRows: _preferMinHeightForNewRows,
            ...rest
        } = props;

        return {
            ...rest,
            rowHeight: this.heights.rowHeight,
            renderCell: this.renderCell,
            onCellAttached: this.onCellAttachedForwarding,
            onCellReleased: this.onCellReleased,
        };
    }
}
