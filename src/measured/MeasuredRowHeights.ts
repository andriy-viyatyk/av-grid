/**
 * Row-height **policy** for rows whose height is only known once they are rendered.
 *
 * This half owns no DOM. It is handed heights by whoever measured them, decides what the
 * geometry should believe, and tells the engine when that belief changed.
 * {@link MeasuredRowGrid} is the other half: it owns the `ResizeObserver`, the cell lifecycle
 * and the engine underneath. Keeping the split is deliberate — the policy is the part worth
 * unit-testing without a browser, and the part a host might want to drive itself.
 *
 * Three things here are load bearing, and each is easy to lose in a rewrite:
 *
 * 1. **`rowHeight` has one identity for the lifetime of this object.** `RenderGridModel`
 *    compares `rowHeight` by identity in `inputChanged()`, so handing it a fresh closure on
 *    every prop change would turn every update into a full geometry invalidation and a repaint
 *    of every visible cell. Updating policy therefore *mutates* `props`; it never replaces the
 *    function.
 * 2. **A measurement is committed on a 50 ms per-row debounce**, not immediately. A cell settles
 *    over several frames — fonts load, images decode, a `ResizeObserver` fires two or three
 *    times — and committing each of those writes geometry the engine then has to repaint from.
 * 3. **A commit marks `{ fromRow: row }`, never `{ rows: [row] }`.** Changing a row's height
 *    moves every row below it and changes the total scrollable height; it does not change what
 *    any of them draws. See `RerenderInfo.fromRow`.
 */

import { debounce } from "../core/utils";
import { defaultRowHeight } from "../render/RenderGridModel";
import type { ElementLength, RerenderInfo } from "../render/types";

/** Milliseconds a row's measurements are coalesced for before the geometry is told. */
export const MEASURED_ROW_DEBOUNCE_MS = 50;

/** The floor applied when no `minRowHeight` is given. */
export const DEFAULT_MIN_ROW_HEIGHT = 24;

/** A debounced, cancellable per-row commit. */
type RowUpdater = (() => void) & { cancel: () => void };

/**
 * The engine seam this layer needs — deliberately just the one method.
 *
 * `RenderGridModel` satisfies it, and so does anything else that can invalidate geometry, which
 * is what makes the policy testable with a two-line stub.
 */
export interface MeasuredRowGeometry {
    update(rerender?: RerenderInfo): void;
}

export interface MeasuredRowHeightOptions {
    /**
     * The height a row is assumed to have before anything is known about it — used only as the
     * last fallback, once the hint and the last measured height have both come up empty. A
     * function is accepted for signature compatibility with `RenderGridOptions.rowHeight`, but
     * only a number is read; a caller that has a per-row function does not need this layer.
     */
    rowHeight?: ElementLength;
    /** Floor for every height, measured or hinted. Defaults to 24. */
    minRowHeight?: number;
    /** Ceiling for every height, measured or hinted. Unbounded when absent. */
    maxRowHeight?: number;
    /**
     * A height already known for a row from somewhere other than the DOM — a cached measurement
     * from the last time the list was shown, a value stored with the record. Used until the row
     * has actually been measured, so the first geometry is close instead of uniform.
     */
    getInitialRowHeight?: (row: number) => number | undefined;
    /**
     * Assume a never-measured row is as **short** as it may be, rather than as tall as the last
     * measured one. Right for a list that appends short entries to a tail the user is watching
     * (a log), because guessing tall overshoots the scroll extent and the view jumps back.
     */
    preferMinHeightForNewRows?: boolean;
}

export class MeasuredRowHeights {
    /** Committed heights, by row index. What `rowHeight` reads. */
    private readonly committed: number[] = [];

    /**
     * The newest measurement for each row, held apart from `committed` until its debounce
     * elapses. Separate so a burst of measurements never moves the geometry mid-burst.
     */
    private readonly pending: number[] = [];

    /** One debouncer per row, created on demand. */
    private readonly updaters = new Map<number, RowUpdater>();

    private props: MeasuredRowHeightOptions;
    private geometry: MeasuredRowGeometry | null = null;
    private lastHeight = 0;
    private live = true;
    private isDisposed = false;

    constructor(props: MeasuredRowHeightOptions) {
        this.props = props;
    }

    /**
     * The function to hand `RenderGridModel` as its `rowHeight`.
     *
     * **Its identity never changes.** Read the class comment before touching this.
     */
    readonly rowHeight = (row: number): number => {
        const measured = this.committed[row];
        if (measured !== undefined) return measured;

        const hint = this.props.getInitialRowHeight?.(row);
        // Hints go through the same clamp as measurements: a caller's cached value from a
        // narrower viewport must not be able to produce a row shorter than `minRowHeight`.
        if (hint !== undefined) return this.clamp(hint);

        if (this.props.preferMinHeightForNewRows) {
            return this.props.minRowHeight || this.fallbackHeight;
        }
        return this.lastHeight || this.fallbackHeight;
    };

    get disposed(): boolean {
        return this.isDisposed;
    }

    /** The committed height for a row, or `undefined` if it has never been measured. */
    heightOf(row: number): number | undefined {
        return this.committed[row];
    }

    /**
     * Replace the policy inputs.
     *
     * Mutates rather than rebuilding, so `rowHeight` keeps its identity. Already-committed
     * heights are kept: they are measurements, and a new `minRowHeight` does not un-measure
     * them — the next measurement of each row applies the new clamp.
     */
    setProps(props: MeasuredRowHeightOptions): void {
        if (this.isDisposed) return;
        this.props = props;
    }

    setGeometry(geometry: MeasuredRowGeometry | null): void {
        if (this.isDisposed) return;
        this.geometry = geometry;
    }

    /**
     * Offer a measurement for a row.
     *
     * A zero is ignored rather than committed: an element that is hidden, detached or not yet
     * laid out reports zero, and none of those mean "this row is zero tall". Committing one
     * would collapse the row and, through `fromRow`, shift everything below it — and it would
     * happen on exactly the frames where the measurement is least trustworthy.
     */
    setRowHeight(row: number, height: number): void {
        if (!this.live || height === 0) return;

        const applied = this.clamp(height);
        if (this.pending[row] === applied) return;

        this.pending[row] = applied;
        this.updaterFor(row)();
    }

    dispose(): void {
        if (this.isDisposed) return;
        this.live = false;
        this.isDisposed = true;
        this.geometry = null;
        for (const updater of this.updaters.values()) updater.cancel();
        this.updaters.clear();
    }

    private get fallbackHeight(): number {
        return typeof this.props.rowHeight === "number"
            ? this.props.rowHeight
            : defaultRowHeight;
    }

    /**
     * The per-row debouncer.
     *
     * A plain `Map` rather than the shared `memorize` helper, which keys its cache on
     * `JSON.stringify(args)` and says in its own comment that it is not for a hot path. This one
     * is: it is reached from every `ResizeObserver` entry and every render of a measured cell.
     * A number-keyed `Map` is the same memoization without the serialization.
     */
    private updaterFor(row: number): RowUpdater {
        let updater = this.updaters.get(row);
        if (!updater) {
            updater = debounce(
                () => {
                    if (this.live) this.commit(row);
                },
                MEASURED_ROW_DEBOUNCE_MS,
                // `debounce` re-arms itself while `canRun` is false, so this must go true on
                // disposal or a disposed layer would keep a timer alive forever. `dispose()`
                // cancels every updater as well; this is the belt to that pair of braces.
                () => this.live || this.isDisposed,
            );
            this.updaters.set(row, updater);
        }
        return updater;
    }

    private commit(row: number): void {
        const height = this.pending[row];
        if (height === undefined || this.committed[row] === height) return;

        this.lastHeight = height;
        this.committed[row] = height;
        // Geometry, not content. Every row below this one now starts somewhere else.
        this.geometry?.update({ fromRow: row });
    }

    /**
     * Ceiling first, then floor.
     *
     * The order is the contract, not an accident: applying the floor first would let a
     * `maxRowHeight` below `minRowHeight` win, and a row shorter than the minimum is the case
     * this exists to prevent. So the minimum has the last word.
     */
    private clamp(height: number): number {
        const capped = this.props.maxRowHeight
            ? Math.min(height, this.props.maxRowHeight)
            : height;
        return Math.max(capped, this.props.minRowHeight || DEFAULT_MIN_ROW_HEIGHT);
    }
}
