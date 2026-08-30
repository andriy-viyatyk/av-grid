/**
 * A recycling bin for cell elements.
 *
 * Virtualization means a fixed number of cells serve an unbounded dataset — scrolling
 * 100,000 rows past a 20-row viewport evicts and admits cells continuously. Creating a fresh
 * element for every admission is where a naive DOM port loses the performance the engine was
 * written to preserve: `document.createElement` plus building the cell's inner structure,
 * dozens of times per frame.
 *
 * So evicted elements come here instead of being discarded, and the next admission takes one
 * back. At steady state the pool holds roughly one frame's worth of evictions and no new
 * element is ever allocated.
 *
 * ## The reuse contract
 *
 * `release()` does **not** reset the element. It arrives at its next occupant with the same
 * children, classes, attributes and event listeners it had before. Wiping it would throw away
 * the inner structure, which is most of what makes reuse worth doing — so a cell renderer
 * that recycles is responsible for overwriting everything it sets.
 *
 * ## Ordering
 *
 * Acquisition happens during `calcRenderInfo` (frame N) and release happens during the paint
 * (frame N). So a frame draws from what the *previous* frame released, which is exactly the
 * set of elements that just scrolled out. The pool never needs to be large.
 *
 * ## Reuse keys — for rows that are not all alike
 *
 * A data grid's cells are interchangeable, so any element will do and the pool is one bucket.
 * A *list* whose rows differ in structure — a log of text, tables, images and errors; a
 * notebook of mixed cells — is the case that breaks: an element built for one kind handed to a
 * row of another has to be torn down and rebuilt, which costs more than the allocation the
 * pool saved.
 *
 * So a renderer may stamp a cell with an opaque **reuse key** — whatever "same kind" means to
 * it — and ask for one back:
 *
 * ```js
 * const cell = previous ?? p.recycle?.(kind) ?? document.createElement("div");
 * p.setReuseKey?.(cell, kind);
 * ```
 *
 * A keyed request is served only from cells released under the same key, and misses rather
 * than returning something incompatible. An unkeyed request means "anything will do" and is
 * served from the untagged cells first, then from any other bucket.
 *
 * Keys are held in a `Map`, so they compare by SameValueZero — identity for objects and
 * symbols, value for strings and numbers. (The one wrinkle is that `-0` and `+0` are the same
 * key. A cell kind is not a number with a sign.)
 *
 * A pool that is never given a key is a single bucket and behaves exactly as it did before
 * keys existed, down to the hit/miss counts.
 */

import type { CellReuseKey } from "./types";

export interface CellPoolStats {
    /** Acquisitions served from the pool. */
    hits: number;
    /** Acquisitions that found nothing usable — each one costs a `createElement`. */
    misses: number;
    /** Elements released and kept. */
    released: number;
    /** Elements released and dropped because the pool was full. */
    discarded: number;
}

/** The bucket an element with no reuse key lives in. */
const UNTAGGED: CellReuseKey = undefined;

export class CellPool {
    /**
     * One array per reuse key, so a keyed acquisition is a lookup and a `pop` rather than a
     * search. A pool that is never keyed holds exactly one bucket.
     *
     * Empty buckets are deleted rather than left behind: a key may be an object, and a `Map`
     * holds its keys strongly.
     */
    private buckets = new Map<CellReuseKey, HTMLElement[]>();

    /** What each pooled element was last built for. Read on release to pick its bucket. */
    private keys = new WeakMap<HTMLElement, CellReuseKey>();

    /** Total across all buckets, tracked rather than summed — `size` is read per frame. */
    private count = 0;

    private _stats: CellPoolStats = { hits: 0, misses: 0, released: 0, discarded: 0 };

    /**
     * Cap on retained elements. A grid holds at most a viewport's worth of cells, so a pool
     * larger than that is memory kept for no reason — the default is generous enough that a
     * legitimate viewport never overflows it.
     */
    constructor(private readonly maxSize = 2000) {}

    /**
     * Take an element from the pool, or `undefined` if it holds nothing usable.
     *
     * With a `reuseKey`, only elements released under that same key are eligible — a miss is
     * correct, and cheaper than handing back a cell the renderer would have to rebuild.
     * Without one, any element will do.
     *
     * Bound as a field so it can be handed to the geometry as a bare function.
     */
    acquire = (reuseKey?: CellReuseKey): HTMLElement | undefined => {
        const element =
            this.takeFrom(reuseKey) ??
            (reuseKey === UNTAGGED ? this.takeFromAny() : undefined);

        if (!element) {
            this._stats.misses++;
            return undefined;
        }

        // Record the key it was asked for, including `undefined`. An element handed out as
        // untagged must not be released back into the bucket of the kind it used to be — that
        // is how it would reach a row it was not built for, which is what keys prevent.
        this.keys.set(element, reuseKey);
        this._stats.hits++;
        return element;
    };

    /**
     * Declare what an admitted cell was built for, so the pool can hand it back to a
     * compatible row later. Calling it with no key returns the cell to the untagged bucket.
     *
     * Bound as a field, like `acquire`, so the shell can forward it as a bare function.
     */
    setReuseKey = (element: HTMLElement, reuseKey?: CellReuseKey): void => {
        this.keys.set(element, reuseKey);
    };

    /**
     * Offer an evicted element for reuse. Returns whether the pool **kept** it.
     *
     * The caller must have taken it out of view first — either by removing it from the DOM, or
     * by hiding it (`RenderGrid`'s `keepCellsAttached`); a pooled element still on screen would
     * be handed out from under its occupant.
     *
     * The return value exists for the second of those. A caller that leaves evicted cells in
     * the document has to hear when the pool refused one: a refused cell is a cell nothing will
     * ever come back for, and leaving it hidden in the document forever is how a bounded pool
     * becomes an unbounded pile of nodes. The bound is the whole defence, so the caller leaning
     * on it needs to know when it is reached. A caller that detaches on eviction can go on
     * ignoring the result, as `keepCellsAttached: false` does.
     */
    release = (el: HTMLElement): boolean => {
        if (this.count >= this.maxSize) {
            this._stats.discarded++;
            return false;
        }
        const key = this.keys.get(el);
        let bucket = this.buckets.get(key);
        if (!bucket) {
            bucket = [];
            this.buckets.set(key, bucket);
        }
        bucket.push(el);
        this.count++;
        this._stats.released++;
        return true;
    };

    get size(): number {
        return this.count;
    }

    get stats(): Readonly<CellPoolStats> {
        return this._stats;
    }

    resetStats(): void {
        this._stats = { hits: 0, misses: 0, released: 0, discarded: 0 };
    }

    clear(): void {
        this.buckets.clear();
        this.count = 0;
    }

    /** Pop from one bucket, dropping the bucket when it empties. */
    private takeFrom(key: CellReuseKey): HTMLElement | undefined {
        const bucket = this.buckets.get(key);
        if (!bucket) return undefined;
        const element = bucket.pop();
        if (element) this.count--;
        if (!bucket.length) this.buckets.delete(key);
        return element;
    }

    /**
     * The fallback for an unkeyed request once the untagged bucket is empty: any element will
     * do, so borrow from a keyed one. Costs one step per *kind*, never per pooled element.
     */
    private takeFromAny(): HTMLElement | undefined {
        for (const key of this.buckets.keys()) {
            const element = this.takeFrom(key);
            if (element) return element;
        }
        return undefined;
    }
}
