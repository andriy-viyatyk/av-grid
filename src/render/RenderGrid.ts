/**
 * The DOM shell — a rewrite of `RenderGrid.tsx`, not a transliteration of it.
 *
 * Builds the scroll container, the inner sizer, and the nine render regions, then keeps their
 * children in sync with whatever `RenderGridModel` most recently computed.
 *
 * Three things make the paint cheap:
 *
 * 1. **Cells are absolutely positioned, so DOM order is irrelevant.** Syncing a region is
 *    therefore pure set arithmetic — remove what left, append what arrived — with no
 *    reordering, no `insertBefore`, and no keyed reconciliation. A one-row scroll touches
 *    twelve nodes regardless of how many are on screen.
 *
 * 2. **Evicted elements go to a `CellPool`** and are handed back to the next cell that needs
 *    one, so scrolling settles into allocating nothing at all.
 *
 * 3. **One paint per frame, on `requestAnimationFrame`.** Scroll events and model changes
 *    both coalesce into it. The model has usually already decided there is nothing to do —
 *    `calcRenderInfo` returns the identical object — in which case the paint returns early.
 *
 *    **With one exception: a drag of the grid's own scrollbar.** That paints from the strip's
 *    scroll event itself, so the viewport's offset and the cells belonging at it are written
 *    before the handler yields — see {@link RenderGrid.onStripScroll}, which is the whole of
 *    task 65.
 *
 * Styling here is deliberately limited to *structure*: sizes and offsets that follow from the
 * geometry. Appearance belongs to the stylesheet introduced in task 9.
 */

import { CellPool } from "./CellPool";
import { whiteSpace } from "./renderInfo";
import {
    RenderGridModel,
    type RenderGridOptions,
    type RenderGridState,
} from "./RenderGridModel";
import type {
    CellReuseKey,
    RenderedCell,
    RenderInputPrepared,
} from "./types";
import type { Unsubscribe } from "../core/observable";

export interface RenderGridShellOptions extends RenderGridOptions {
    /** Extra class on the root element, for host styling. */
    className?: string;
    /**
     * Explicit CSS height for the root element.
     *
     * The grid measures its own root to decide what is visible, so that height has to be
     * *definite* — a root whose height depends on its content has none, and the grid renders
     * nothing at all. `AVGrid` sets this for you: `100%` when the container has a height of
     * its own, a pixel fallback when it does not.
     */
    height?: string;
    /** Cap the root's height and let it grow to its content below that, instead of filling. */
    growToHeight?: string;
    growToWidth?: string;
    /**
     * Watch the host for structural changes that would silently reset the scroll position, and
     * put it back. **Default `true`.**
     *
     * Chromium resets every scroller inside a detached subtree, keeps it reset when the subtree
     * is re-inserted, and fires no scroll event — so a host framework that re-renders the slot
     * the grid lives in leaves it painting rows at an offset the container no longer has, and
     * the viewport sits blank until someone scrolls. Nothing in the grid can notice on its own.
     *
     * So the grid watches the child lists of its own ancestors. They are nodes it never touches
     * itself, so in a page that never moves the grid this observes nothing and costs nothing;
     * when one of them changes, the grid checks its scroll position and repairs it.
     *
     * Turn it off if the host would rather call {@link RenderGrid.revalidate} itself.
     */
    watchHost?: boolean;
    /**
     * Keep evicted cells in the document, hidden, instead of detaching them. **Default
     * `false`.**
     *
     * Ordinary scrolling removes a cell from the DOM the moment it leaves the render window,
     * and that destroys whatever the cell owned: an iframe's document is torn down and reloaded
     * on re-admission, a nested scroller's position is gone, a playing media element stops.
     * Measured on a cell holding both — nested `scrollLeft` 300 → 0, and the frame's `load`
     * event firing a second time.
     *
     * With this on, an evicted cell is hidden and left where it is, so the element survives
     * intact and a renderer that hands the same element back to the same row gets its state
     * back with it — a reuse key per row is the easy way (see `setReuseKey`). Cells are still
     * detached when the pool overflows, which bounds how many hidden elements can accumulate.
     *
     * Off by default because it trades DOM nodes for state: a grid whose cells own nothing
     * gains nothing and would rather keep the document small.
     */
    keepCellsAttached?: boolean;
    /**
     * A cell has **entered the active render set** and is attached to its region.
     *
     * Fires for every admission, including the re-admission of a cell that
     * {@link RenderGridShellOptions.keepCellsAttached} left in the document — a retained cell
     * is hidden while it waits, and an element with no box measures zero, so a re-admitted cell
     * needs a fresh look even though its `parentElement` never changed. The callback runs after
     * the element is attached and after any hiding has been undone, so it is the first moment a
     * measurement is meaningful.
     *
     * Its counterpart is `onCellReleased`. The pair is a lifecycle seam for a layer built *over*
     * the engine — the measured-row companion is what it exists for — and neither is needed by
     * an ordinary renderer, which hears about a cell through `renderCell`.
     */
    onCellAttached?: (element: HTMLElement) => void;
    /**
     * A cell has **left the active render set** and is about to enter the pool.
     *
     * "Released" means "no longer stands for a coordinate", **not** "detached from the DOM".
     * With `keepCellsAttached` the element stays in the document, hidden, and is still released;
     * with the pool full it is detached *after* this callback. Tying the meaning to detachment
     * would make it depend on the pool's overflow limit and would skip retained cells entirely.
     *
     * Not a cleanup hook: an element is released and re-admitted constantly while scrolling, so
     * anything torn down here is rebuilt within a frame. It is for bookkeeping a layer keeps
     * *about* the cell — an observer registration, a row mapping.
     */
    onCellReleased?: (element: HTMLElement) => void;
}

const px = (n: number) => `${n}px`;

/**
 * How wide a strip is drawn when the platform's own scrollbars take no space — overlay
 * scrollbars, which float over the content instead of displacing it (task 65).
 */
const OVERLAY_STRIP_PX = 12;

/**
 * How much room a native scrollbar takes from the content, measured once (task 65).
 *
 * **This is the space to reserve, not the width to draw**, and on an overlay-scrollbar platform
 * the two differ: the honest answer there is 0, because that is what the browser itself
 * reserves, and the strip floats over the content edge exactly as the platform's own bar does.
 * Drawing follows {@link OVERLAY_STRIP_PX} in that case, so there is still something to grab.
 *
 * An earlier version applied that floor here instead, to the reserved space, and it was wrong
 * twice over: it made every grid 12px narrower under a DOM that lays nothing out, and it would
 * have displaced content on macOS that the platform does not displace.
 */
const barSizeByDocument = new WeakMap<Document, number>();

function measureScrollBar(doc: Document): number {
    const cached = barSizeByDocument.get(doc);
    if (cached !== undefined) return cached;

    const probe = doc.createElement("div");
    probe.style.cssText =
        "position:absolute;visibility:hidden;width:100px;height:100px;overflow:scroll;";
    doc.body.appendChild(probe);
    const size = probe.offsetWidth - probe.clientWidth;
    probe.remove();

    // Attaching a probe and measuring it costs a layout, and a page that builds several grids
    // would pay it once each for an answer that cannot differ within one document.
    const resolved = size > 0 ? size : 0;
    barSizeByDocument.set(doc, resolved);
    return resolved;
}

/** Write a style only when it actually differs — a redundant write can force layout. */
function setStyle(el: HTMLElement, prop: string, value: string): void {
    if (el.style.getPropertyValue(prop) !== value) {
        el.style.setProperty(prop, value);
    }
}

function div(dataType: string, className?: string): HTMLDivElement {
    const el = document.createElement("div");
    el.setAttribute("data-type", dataType);
    // A fixed class besides the data-type, so host CSS has something ordinary to select — the
    // scrollbar, the header band. Part of the DOM contract in docs/api.md; never reassigned.
    if (className) el.className = className;
    return el;
}

/** The nine regions, in the order they are appended and synced. */
type RegionKey =
    | "cells"
    | "stickyTop"
    | "stickyBottom"
    | "stickyLeft"
    | "stickyRight"
    | "stickyTopLeft"
    | "stickyTopRight"
    | "stickyBottomLeft"
    | "stickyBottomRight";

/** Regions laid out as inline-flex, so `toggleRegion` restores the right display value. */
const INLINE_FLEX_REGIONS: ReadonlySet<RegionKey> = new Set<RegionKey>([
    "stickyLeft",
    "stickyRight",
    "stickyTopLeft",
    "stickyTopRight",
    "stickyBottomLeft",
    "stickyBottomRight",
]);

export interface RenderGridStats {
    paints: number;
    /**
     * Of those paints, how many ran synchronously from a scroll handler rather than from the
     * scheduler — i.e. how many were driven by a drag of the grid's own scrollbar, which paints
     * inside the event so the offset and the cells cannot end up a frame apart.
     */
    syncPaints: number;
    cellsAppended: number;
    cellsRemoved: number;
    /** Wall time of the most recent paint, in milliseconds. */
    lastPaintMs: number;
    /** Cumulative paint time, so a benchmark can average over a run. */
    totalPaintMs: number;
    pool: Readonly<import("./CellPool").CellPoolStats>;
}

export class RenderGrid {
    readonly model: RenderGridModel;
    readonly pool = new CellPool();

    readonly root: HTMLDivElement;
    readonly container: HTMLDivElement;
    readonly area: HTMLDivElement;

    private readonly regions: Record<RegionKey, HTMLDivElement>;

    /**
     * Cells currently attached to each region. Only ever holds cells this class appended, so
     * the sync can never remove a region's structural children.
     */
    private readonly attached: Record<RegionKey, Set<HTMLElement>>;

    private unsubscribe?: Unsubscribe;
    private rafId?: number;
    private paintScheduled = false;
    private destroyed = false;

    /**
     * **The grid's own scrollbars (task 65).** One per axis, at the right and bottom edges,
     * each an *empty* box holding a single spacer and no cells.
     *
     * There are two scroll inputs and they are deliberately not treated alike:
     *
     * - **A strip** is the scrollbar the user drags. Its event writes the viewport's offset,
     *   recomputes and paints **in one task**, so the offset and the cells that belong at it
     *   can never be a frame apart. This is the case the whole task was about: a drag exposes a
     *   viewport sharing no row with the last one, and no overscan can cover that. Because a
     *   strip holds nothing, the browser scrolling it exposes nothing.
     * - **The wheel and the trackpad** are left entirely alone. The viewport is still a real
     *   scroller, so the browser scrolls it on the compositor with its own animation and the
     *   grid follows through the ordinary scroll path. The frame of lag that leaves is what
     *   `overscanRow` covers.
     *
     * **Taking the wheel was tried twice and was worse both times.** Forwarding a notch to a
     * strip needs `preventDefault`, which throws away the browser's ~100ms easing; replacing it
     * with a smooth `scrollTo` restores the motion on paper — measured: sixteen distinct
     * positions in sixteen frames on a real ease-in curve — and still reads as sluggish beside
     * the native scroll. The browser's wheel animation is not reproducible from script, so it
     * is not reproduced.
     *
     * The viewport therefore stays `overflow: auto` with `scrollbar-width: none`, which also
     * keeps `position: sticky` on the nine regions working untouched. Measured, because it
     * decides the design: a written `scrollTop` keeps a sticky header at the top of the
     * viewport, and a `transform` on the area takes it 500px off the top along with the footer
     * band and the pinned columns.
     *
     * `growToHeight` / `growToWidth` are supported: the viewport sizes itself to its content
     * there, so it is not narrowed to make room and the strip overlays its edge instead.
     */
    private readonly stripY: HTMLDivElement;
    private readonly stripX: HTMLDivElement;
    private readonly spacerY: HTMLDivElement;
    private readonly spacerX: HTMLDivElement;
    /** Native scrollbar thickness, measured once. */
    private barSize = 0;
    /** The thickness each axis currently reserves — 0 when that strip is not shown. */
    private barW = 0;
    private barH = 0;
    /**
     * True while this class is writing a strip's position, so the scroll event that write
     * causes is not read back as a gesture. The echo arrives with the next frame's scroll
     * steps, ahead of its animation callbacks, so a `requestAnimationFrame` clears it.
     */
    private writingStrip = false;
    /**
     * The offset the strips were last put on. Compared against the *model's* offset, which is a
     * plain object — asking the DOM instead would force a layout inside every paint.
     *
     * Starts at the origin because that is where a fresh strip and a fresh model both are: a
     * sentinel here would make the constructor's own first paint write the thumbs, and arm the
     * echo guard, so the very first gesture after construction would be swallowed.
     */
    private syncedX = 0;
    private syncedY = 0;
    /** A queued thumb write, so a burst of paints moves the thumbs once. */
    private syncRaf?: number;

    /** Watches the ancestors' child lists for the host moving the grid. See `watchHost`. */
    private hostObserver?: MutationObserver;
    /** The ancestors currently observed, so a re-bind can tell whether the chain moved. */
    private observedAncestors: HTMLElement[] = [];

    /**
     * The inline `display` an evicted cell had before it was hidden, so admission can put back
     * exactly what the renderer set rather than guessing at `""`. Only used when
     * `keepCellsAttached` is on. A `WeakMap` rather than an expando so a cell the grid forgets
     * about is collectable.
     */
    private readonly hiddenDisplay = new WeakMap<HTMLElement, string>();

    /**
     * Cells the pool has handed to `renderCell` since the last paint.
     *
     * `renderCell` runs during the *model's* recompute, not during the paint, and a frame can
     * hold more than one recompute — two scroll events, or two state writes landing in
     * separate microtasks. Only the last render info survives to be painted; the passes before
     * it are dropped. Their cells are not: each one came out of the pool, and with
     * `keepCellsAttached` a pooled cell is still a child of its region, which the renderer has
     * just un-hidden and repositioned. `attached` never saw them, so `syncRegion` has nothing
     * to evict them from and they stay on screen for the life of the grid — stale rows below
     * the real content. This set is how the paint finds them again. See `reclaimLoaned`.
     */
    private readonly loaned = new Set<HTMLElement>();

    private lastInfo?: RenderInputPrepared;
    private lastScrollBarWidth = -1;
    private lastScrollBarHeight = -1;

    private _stats = {
        paints: 0,
        syncPaints: 0,
        cellsAppended: 0,
        cellsRemoved: 0,
        lastPaintMs: 0,
        totalPaintMs: 0,
    };

    constructor(
        private readonly host: HTMLElement,
        private readonly options: RenderGridShellOptions,
    ) {
        this.root = div("render-grid");
        if (options.name) this.root.setAttribute("data-name", options.name);
        if (options.className) this.root.className = options.className;

        this.container = div("render-grid-scroll", "avg-viewport");
        // Focusable so keyboard navigation has somewhere to land, but not in the tab order.
        this.container.tabIndex = -1;

        this.area = div("render-grid-area", "avg-cells-area");

        this.regions = {
            cells: this.area,
            stickyTop: div("render-grid-sticky-top", "avg-sticky-top"),
            stickyBottom: div("render-grid-sticky-bottom", "avg-sticky-bottom"),
            stickyLeft: div("render-grid-sticky-left", "avg-sticky-left"),
            stickyRight: div("render-grid-sticky-right", "avg-sticky-right"),
            stickyTopLeft: div("render-grid-sticky-top-left", "avg-sticky-top-left"),
            stickyTopRight: div("render-grid-sticky-top-right", "avg-sticky-top-right"),
            stickyBottomLeft: div("render-grid-sticky-bottom-left", "avg-sticky-bottom-left"),
            stickyBottomRight: div("render-grid-sticky-bottom-right", "avg-sticky-bottom-right"),
        };

        this.attached = {
            cells: new Set(),
            stickyTop: new Set(),
            stickyBottom: new Set(),
            stickyLeft: new Set(),
            stickyRight: new Set(),
            stickyTopLeft: new Set(),
            stickyTopRight: new Set(),
            stickyBottomLeft: new Set(),
            stickyBottomRight: new Set(),
        };

        // Corners nest inside their band, matching the reference's stacking.
        this.regions.stickyTop.append(
            this.regions.stickyTopLeft,
            this.regions.stickyTopRight,
        );
        this.regions.stickyBottom.append(
            this.regions.stickyBottomLeft,
            this.regions.stickyBottomRight,
        );
        this.area.append(
            this.regions.stickyTop,
            this.regions.stickyBottom,
            this.regions.stickyLeft,
            this.regions.stickyRight,
        );
        this.container.append(this.area);
        this.root.append(this.container);

        this.barSize = measureScrollBar(host.ownerDocument);
        this.spacerY = div("render-grid-scrollbar-spacer");
        this.stripY = div("render-grid-scrollbar-y", "avg-scrollbar-y");
        this.stripY.append(this.spacerY);
        this.spacerX = div("render-grid-scrollbar-spacer");
        this.stripX = div("render-grid-scrollbar-x", "avg-scrollbar-x");
        this.stripX.append(this.spacerX);
        this.root.append(this.stripY, this.stripX);

        this.applyStaticStyles();
        this.host.append(this.root);

        this.model = new RenderGridModel({
            ...options,
            recycle: this.acquireCell,
            setReuseKey: this.pool.setReuseKey,
            // The viewport measures no scrollbar — it has none. The space is the strips',
            // and the geometry still has to reserve it.
            scrollBarSize: () => ({ width: this.barW, height: this.barH }),
        });

        // The viewport carries the wheel and the trackpad, which are left to the browser.
        this.container.addEventListener("scroll", this.onScroll, {
            passive: true,
        });
        this.stripY.addEventListener("scroll", this.onStripScroll, { passive: true });
        this.stripX.addEventListener("scroll", this.onStripScroll, { passive: true });

        this.unsubscribe = this.model.state.subscribe(this.onModelChanged);

        // Measure and compute. The model is now in the document, so offsetWidth is real.
        this.model.attach({ grid: this.root, container: this.container });

        // Paint synchronously so the grid is on screen when the constructor returns, rather
        // than a frame later. Everything after this goes through requestAnimationFrame.
        this.paint();

        if (this.options.watchHost !== false) this.watchHost();
    }

    /**
     * Re-check the scroll position against the model, and repair it if the browser discarded
     * it.
     *
     * Call this after moving the grid in the DOM. Chromium resets every scroller inside a
     * detached subtree and fires no scroll event, so a host that re-parents the grid — which is
     * what a framework does when it re-renders the slot the grid sits in — otherwise leaves it
     * painting rows at an offset the container no longer has, blank until someone scrolls.
     *
     * With the default `watchHost` the grid notices this by itself and there is nothing to
     * call. This is here for a host that turned that off, or that moves the grid in a way no
     * observer can attribute to it.
     *
     * Safe to call at any time, including during a scroll: a disagreement between container and
     * model is only acted on if no scroll event follows it. See `revalidateScroll`.
     */
    revalidate(): void {
        if (this.destroyed) return;
        this.model.revalidateScroll();
    }

    /**
     * Observe the child lists of the grid's own ancestors.
     *
     * Those are nodes the grid never touches — it mutates inside `container` and nothing above
     * `root` — so on a page that leaves the grid where it is, this observes nothing and records
     * nothing. When one of them does change, the grid was quite possibly moved, and that is the
     * one event that silently discards its scroll position.
     *
     * `childList` without `subtree`, deliberately: `subtree` on an ancestor would deliver a
     * record for every cell the grid appends on every scroll frame, which is the render path
     * paying for a defect that happens once.
     *
     * Chosen over a `ResizeObserver` because the hardest case produces no resize at all. A host
     * that removes and re-inserts the subtree **within one task** still gets its scroller reset,
     * but observers sample at the end of a frame and by then the subtree is back at full size —
     * measured, `resizeObserverSaw0x0: false`. A `MutationObserver` records mutations rather
     * than sampling state, so it sees both halves of that round trip.
     */
    private watchHost(): void {
        if (typeof MutationObserver === "undefined") return;

        this.hostObserver ??= new MutationObserver(this.onHostMutated);
        const ancestors: HTMLElement[] = [];
        for (let el = this.root.parentElement; el; el = el.parentElement) {
            ancestors.push(el);
        }

        const unchanged =
            ancestors.length === this.observedAncestors.length &&
            ancestors.every((el, i) => el === this.observedAncestors[i]);
        if (unchanged) return;

        this.hostObserver.disconnect();
        for (const el of ancestors) {
            this.hostObserver.observe(el, { childList: true });
        }
        this.observedAncestors = ancestors;
    }

    private onHostMutated = (): void => {
        if (this.destroyed) return;
        // The chain itself may be what moved, so re-bind before checking.
        this.watchHost();
        this.model.revalidateScroll();
    };

    get stats(): RenderGridStats {
        return { ...this._stats, pool: this.pool.stats };
    }

    /**
     * Attach an element that is not a cell — an add-row button, an empty-state message.
     *
     * Safe against the paint because `syncRegion` only ever removes elements it appended
     * itself: `attached` holds exactly the pooled cells, so anything put here is invisible to
     * the reconciliation and is never recycled out from under its listeners.
     *
     * `"content"` sits in the scrolling area, below the last row and inside the trailing
     * whitespace; `"header"` sits in the sticky top band, which scrolls horizontally with the
     * columns but stays put vertically.
     */
    addOverlay(el: HTMLElement, region: "content" | "header" = "content"): void {
        this.regions[region === "header" ? "stickyTop" : "cells"].append(el);
    }

    /**
     * Replace some or all options; the model decides whether a recompute is needed.
     *
     * **The shell's own layout fields are live.** `height`, `growToHeight`, `growToWidth` and
     * the overflow that follows `fitToWidth` are re-applied here through the exact call the
     * constructor uses, so a host whose layout changes after construction — an autocomplete
     * popup that resizes as its filtered list grows, a panel the user drags — gets a shell that
     * follows rather than a stale one. Before this they were read once and never again:
     * measured, a `setOptions({ growToHeight: "150px" })` left the root at its original 400px
     * with `max-height: unset`.
     *
     * ```js
     * grid.setOptions({ height: undefined, growToHeight: `${Math.min(rows * 24, 300)}px` });
     * ```
     *
     * Re-applying rather than restating is the point: `applyStaticStyles` stays the one place
     * that knows what these fields mean, so the construction path and the update path cannot
     * drift apart. Every write goes through `setStyle`, which skips a value that has not
     * changed, so a `setOptions` that touches no layout field costs nothing.
     */
    setOptions(options: Partial<RenderGridShellOptions>): void {
        const layoutChanged =
            ("height" in options && options.height !== this.options.height) ||
            ("growToHeight" in options &&
                options.growToHeight !== this.options.growToHeight) ||
            ("growToWidth" in options &&
                options.growToWidth !== this.options.growToWidth) ||
            ("fitToWidth" in options && options.fitToWidth !== this.options.fitToWidth);

        Object.assign(this.options, options);
        this.model.setOptions(options);
        if (options.className !== undefined) {
            this.root.className = options.className;
        }

        if (layoutChanged) {
            this.applyStaticStyles();
            // `applyLayout` reads `growTo*` too — they decide whether the container sizes itself
            // to the measured viewport or to its content — and it only runs on a paint whose
            // geometry changed. Dropping `lastInfo` forces the next paint through its body. It
            // is not a repaint of the cells: the region sync is set arithmetic over the same
            // elements, so it removes nothing and appends nothing.
            this.lastInfo = undefined;
            this.schedulePaint();
        }
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;

        this.container.removeEventListener("scroll", this.onScroll);
        this.stripY.removeEventListener("scroll", this.onStripScroll);
        this.stripX.removeEventListener("scroll", this.onStripScroll);
        this.hostObserver?.disconnect();
        this.hostObserver = undefined;
        this.observedAncestors = [];
        this.unsubscribe?.();
        this.unsubscribe = undefined;

        if (this.rafId !== undefined) {
            cancelAnimationFrame(this.rafId);
            this.rafId = undefined;
        }
        if (this.syncRaf !== undefined) {
            cancelAnimationFrame(this.syncRaf);
            this.syncRaf = undefined;
        }

        this.model.dispose();
        this.pool.clear();

        this.loaned.clear();

        for (const key of Object.keys(this.attached) as RegionKey[]) {
            this.attached[key].clear();
        }

        this.root.remove();
    }

    // -----------------------------------------------------------------------
    // Paint scheduling
    // -----------------------------------------------------------------------

    private onModelChanged = (_state: RenderGridState): void => {
        this.schedulePaint();
    };

    private schedulePaint(): void {
        if (this.destroyed || this.paintScheduled) return;
        this.paintScheduled = true;
        this.rafId = requestAnimationFrame(() => {
            this.rafId = undefined;
            this.paintScheduled = false;
            this.paint();
        });
    }

    /**
     * The container's scroll listener — the model's recompute, and then task 65's eager paint.
     *
     * **Why this is a wrapper and not `model.onScroll` directly.** The recompute is the model's
     * and is unchanged; what is new is the decision that follows it, which is the *shell's*,
     * because only the shell knows what it last painted.
     *
     * **The condition is coverage, not distance.** It fires when the rows and columns now visible
     * are not inside the band the last paint rendered — which is exactly when a reader would
     * otherwise be shown pixels nobody has drawn. The plan proposed the narrower "the ranges do
     * not overlap at all", but that is the *pool's* condition rather than the reader's: at a
     * quarter of a viewport per frame the ranges still overlap and a quarter of the probes still
     * come back blank. Comparing windows rather than pixel deltas is also what keeps the answer
     * right under measured row heights, where a delta means nothing.
     *
     * **Three things it must not do**, each a real trap rather than a precaution:
     *
     * - **Never take the early-return branch of `paint()`.** That branch calls `restoreScroll()`
     *   and `flushPendingScroll()`, both of which write `scrollTop`; doing that from inside a
     *   scroll handler is the "list that scrolls half the time" failure documented on
     *   `RenderGridModel.restoreScroll`. Hence the `info === this.lastInfo` guard: this path
     *   paints only when there is something new to draw, and leaves every other case to the
     *   scheduler.
     * - **At most one synchronous paint per frame.** A second scroll event in the same frame
     *   falls back to the scheduled path. The frame is identified by a one-shot
     *   `requestAnimationFrame`, not by a timestamp — a clock cannot tell two events in one
     *   frame from two events in two.
     * - **Leave the scheduler consistent.** A paint already queued for this frame is cancelled,
     *   because it would otherwise repaint the same state. The notify that `model.onScroll`
     *   raises is a *microtask*, so the `schedulePaint` it causes lands after this returns and
     *   queues a paint that finds nothing to do — which is the ordinary no-op paint, in its
     *   ordinary frame.
     */
    /**
     * A strip moved — so move the content, recompute and paint, all in this one task.
     *
     * This is the half of the scrolling that this class owns: the drag. The viewport's offset and the
     * cells that belong at that offset are written by the same code before it yields, so there
     * is no frame in which one has moved and the other has not. `model.onScroll()` is called
     * without an event on purpose: it reads the container, which the line above has already
     * written, and a `scrollTop` write lands in layout synchronously.
     *
     * The container's own scroll event follows a frame later, carrying the offset this just
     * wrote. It finds nothing to do, which is the cheapest paint there is.
     */
    private onStripScroll = (): void => {
        if (this.writingStrip || this.destroyed) return;
        const y = this.stripY.scrollTop;
        const x = this.stripX.scrollLeft;
        this.container.scrollTop = y;
        this.container.scrollLeft = x;
        // The thumbs are already here — the user put them here. Recording it keeps the paint
        // that follows from writing them back.
        this.syncedX = x;
        this.syncedY = y;
        this.model.onScroll();
        this.paintNow();
    };

    /** Move the strips without hearing the echo as a gesture. */
    private writeStrips(x: number, y: number): void {
        this.syncedX = x;
        this.syncedY = y;
        this.writingStrip = true;
        this.stripY.scrollTop = y;
        this.stripX.scrollLeft = x;
        requestAnimationFrame(() => {
            this.writingStrip = false;
        });
    }

    /**
     * Put the strips back on the offset the container actually has.
     *
     * Everything that scrolls the grid without a gesture — `scrollToRow`, the queued scroll
     * flushed after a paint, the repair of a position the browser discarded — writes the
     * container, because that is where the model has always written. The thumbs follow from
     * here rather than every one of those call sites learning about strips.
     */
    /**
     * Put the thumbs where the content is — **on the next frame, never inside the paint**.
     *
     * Writing `scrollTop` forces a synchronous layout, and the paint has just dirtied the very
     * boxes that layout has to do: the cell area and the strip's spacer are both a couple of
     * million pixels tall at 100,000 rows. Measured on the gate, doing it inline took the paint
     * from **0.20ms to 1.00ms** — a five-fold cost that nothing but the benchmark would have
     * caught, since the frame rate never moved. Deferring it to a frame where layout is clean
     * makes the same write cheap, and a thumb one frame behind the rows it describes is not
     * something an eye can see.
     *
     * The guard is against the *model*, which is a plain object and answers for free. On a
     * strip-driven scroll the thumb is already where the user put it, so the common case
     * schedules nothing at all.
     */
    private syncStrips(): void {
        if (this.syncRaf !== undefined) return;
        const { x, y } = this.model.offset;
        if (x === this.syncedX && y === this.syncedY) return;

        this.syncRaf = requestAnimationFrame(() => {
            this.syncRaf = undefined;
            if (this.destroyed) return;
            const now = this.model.offset;
            if (now.x === this.syncedX && now.y === this.syncedY) return;
            this.writeStrips(now.x, now.y);
        });
    }

    /** Paint now, dropping a paint already queued for this frame. */
    private paintNow(): void {
        if (this.rafId !== undefined) {
            cancelAnimationFrame(this.rafId);
            this.rafId = undefined;
            this.paintScheduled = false;
        }
        this._stats.syncPaints++;
        this.paint();
    }

    /**
     * The viewport scrolled — the wheel, the trackpad, touch, or a `scrollTop` written by the
     * model. The browser moved the content and is telling us afterwards, so this takes the
     * ordinary scheduled path; the frame of lag it leaves is what `overscanRow` covers.
     */
    private onScroll = (e: Event): void => {
        this.model.onScroll(e);
    };

    // -----------------------------------------------------------------------
    // Paint
    // -----------------------------------------------------------------------

    private paint(): void {
        if (this.destroyed) return;

        const info = this.model.renderInfo.current;
        const scrollBarWidth = this.model.scrollBarWidth;
        const scrollBarHeight = this.model.scrollBarHeight;

        // The model hands back the identical object when nothing changed. Scrollbar
        // thickness is checked too, because it can appear after a paint without the geometry
        // itself having moved.
        if (
            info === this.lastInfo &&
            scrollBarWidth === this.lastScrollBarWidth &&
            scrollBarHeight === this.lastScrollBarHeight
        ) {
            // Nothing to draw — and that is exactly the paint a re-appended subtree produces.
            // It comes back the same size with the same geometry, so the model returns the
            // identical render info, while the container's scroll position is the one thing
            // that did change. Behind an unconditional `return` the restore below was
            // unreachable in the only case that needed it. The layout is already current here
            // (nothing moved), so the offset has somewhere real to land.
            if (this.model.scrollNeedsRestore) {
                this.model.restoreScroll();
            }
            // Nothing was drawn, but the container may have just become scrollable — and a
            // queued scroll must not wait for a geometry change that may never come. A grid
            // that was laid out late reaches its first usable size on exactly this paint.
            this.model.flushPendingScroll();
            this.syncStrips();
            return;
        }

        this.lastInfo = info;
        this.lastScrollBarWidth = scrollBarWidth;
        this.lastScrollBarHeight = scrollBarHeight;
        this._stats.paints++;

        const startedAt = performance.now();

        this.applyLayout(info, scrollBarWidth, scrollBarHeight);

        // Every cell any region will hold after this paint. A cell can *migrate* between
        // regions in one paint — a column pinned or unpinned moves its live element from one
        // band's set to another's — and the region losing it must not evict it: in one sync
        // order that is a `removeChild` against the wrong parent, in the other it releases an
        // element that is still on screen into the pool, which then hands it to the next
        // renderer as a recycle. The union is what "still on screen" means.
        const active = new Set<HTMLElement>();
        for (const region of [
            info.cells,
            info.stickyTop,
            info.stickyBottom,
            info.stickyLeft,
            info.stickyRight,
            info.stickyTopLeft,
            info.stickyTopRight,
            info.stickyBottomLeft,
            info.stickyBottomRight,
        ]) {
            for (const cell of region) if (cell) active.add(cell);
        }

        this.syncRegion("cells", info.cells, active);
        this.syncRegion("stickyTop", info.stickyTop, active);
        this.syncRegion("stickyBottom", info.stickyBottom, active);
        this.syncRegion("stickyLeft", info.stickyLeft, active);
        this.syncRegion("stickyRight", info.stickyRight, active);
        this.syncRegion("stickyTopLeft", info.stickyTopLeft, active);
        this.syncRegion("stickyTopRight", info.stickyTopRight, active);
        this.syncRegion("stickyBottomLeft", info.stickyBottomLeft, active);
        this.syncRegion("stickyBottomRight", info.stickyBottomRight, active);

        // After the admits: a loaned cell this paint claimed is attached by now, and what is
        // left in the set is what nothing on screen stands for.
        this.reclaimLoaned(active);

        // Hiding the container resets its scrollTop to 0 while the model keeps the real
        // offset; put it back once the content is there to scroll. Only then — a container
        // whose position merely differs from the model's is a container the user has just
        // scrolled, whose event has not been delivered yet, and writing our offset back there
        // undoes the scroll. See `restoreScroll`.
        if (this.model.scrollNeedsRestore) {
            this.model.restoreScroll();
        }

        // Last, and after the restore deliberately. Both write `scrollTop`; a queued scroll is
        // the newer and explicitly requested of the two, so within a paint it wins by running
        // second, and across frames it wins by `revalidateScroll` standing down while the
        // register is loaded. This is also the first moment the write can land correctly: the
        // sizer's height — the scrollable extent every `scrollTop` is clamped against — was
        // written by `applyLayout` a few lines above.
        this.model.flushPendingScroll();

        this.syncStrips();

        this._stats.lastPaintMs = performance.now() - startedAt;
        this._stats.totalPaintMs += this._stats.lastPaintMs;
    }

    /** Zero the counters, so a benchmark can measure one phase in isolation. */
    resetStats(): void {
        this._stats = {
            paints: 0,
            syncPaints: 0,
            cellsAppended: 0,
            cellsRemoved: 0,
            lastPaintMs: 0,
            totalPaintMs: 0,
        };
        this.pool.resetStats();
    }

    /**
     * Reconcile one region's children against the cells the geometry produced.
     *
     * Set arithmetic, not diffing: absolute positioning means order carries no meaning, so
     * an element that stays on screen is never touched even if its neighbours change.
     */
    private syncRegion(
        key: RegionKey,
        cells: Array<RenderedCell>,
        active: ReadonlySet<HTMLElement>,
    ): void {
        const parent = this.regions[key];
        const prev = this.attached[key];

        const next = new Set<HTMLElement>();
        for (const cell of cells) {
            if (cell) next.add(cell);
        }

        for (const el of prev) {
            // Still in `active` means the cell migrated to another region this paint; that
            // region's admit re-parents it, and evicting it here would double-own the element.
            if (!next.has(el) && !active.has(el)) this.evictCell(parent, el);
        }

        for (const el of next) {
            if (!prev.has(el)) this.admitCell(parent, el);
        }

        this.attached[key] = next;
    }

    /**
     * The `recycle` the renderer is given: the pool's `acquire`, plus a note that this cell is
     * out on loan until a paint accounts for it. See `loaned`.
     */
    private acquireCell = (reuseKey?: CellReuseKey): HTMLElement | undefined => {
        const el = this.pool.acquire(reuseKey);
        if (el) this.loaned.add(el);
        return el;
    };

    /**
     * Re-park every cell that went out on loan and did not end up in the painted render info.
     *
     * Two kinds of cell land here: one the renderer took and then dropped, and — the reason
     * this exists — one rendered by a pass that a later recompute superseded before the frame's
     * paint. Both are cells standing for no coordinate, which is exactly what eviction is for.
     * Cells that *are* in `active` were admitted by the sync above and need nothing.
     */
    private reclaimLoaned(active: ReadonlySet<HTMLElement>): void {
        if (!this.loaned.size) return;

        for (const el of this.loaned) {
            if (active.has(el)) continue;
            // No parent means retention is off: the cell was never attached, so there is
            // nothing to hide and only the pool entry to give back.
            const parent = el.parentElement;
            if (parent) this.evictCell(parent, el);
            else this.pool.release(el);
        }

        this.loaned.clear();
    }

    /**
     * Retire a cell: detach it, or — with `keepCellsAttached` — hide it where it stands.
     *
     * Detaching is the cheaper default and is right for a grid, whose cells are inert. It is
     * wrong for a cell that owns something: removing a subtree destroys an iframe's document
     * and discards every nested scroll position inside it, and neither comes back when the
     * element is re-admitted.
     */
    private evictCell(parent: HTMLElement, el: HTMLElement): void {
        this._stats.cellsRemoved++;

        // First, and before either branch: the cell has left the active set, and that is what
        // this reports. Whether it is then hidden, detached, pooled or dropped is the engine's
        // business and must not change what a listener is told.
        this.options.onCellReleased?.(el);

        if (!this.options.keepCellsAttached) {
            parent.removeChild(el);
            this.pool.release(el);
            return;
        }

        // Hidden, not removed. A cell with no box contributes no layout and paints nothing, so
        // this costs what a detached cell costs everywhere except the node count — and the node
        // keeps its frames, its media and its nested scroll offsets.
        this.hiddenDisplay.set(el, el.style.display);
        el.style.display = "none";

        // A retained cell is the one kind of cell that stays in the document while standing for
        // no coordinate — and `data-row` / `data-col` are how everything addresses a cell here:
        // the interaction layer by `closest()`, a host or a test by `querySelector`. Left in
        // place they would put a second element claiming row 0 into the document. So they come
        // off, and a stable marker goes on to say what this element now is. The renderer writes
        // both back on re-admission, which is the only way a pooled cell ever returns.
        el.removeAttribute("data-row");
        el.removeAttribute("data-col");
        el.setAttribute("data-avg-pooled", "");

        // The pool is bounded, and an unbounded collection of hidden nodes is exactly what a
        // bound is for. A cell the pool will not take has nothing left to preserve it for, so
        // this — and only this — is the eviction path that still detaches.
        if (!this.pool.release(el)) {
            parent.removeChild(el);
            this.hiddenDisplay.delete(el);
        }
    }

    /** Admit a cell: attach it if it is not already there, and undo any hiding. */
    private admitCell(parent: HTMLElement, el: HTMLElement): void {
        this._stats.cellsAppended++;

        // `append` on a node that is already a child is a **move** — a remove followed by an
        // insert — and the browser treats it as one: measured, moving an element resets a
        // scroller nested inside it from 250 to 0. With `keepCellsAttached` a re-admitted cell
        // is usually already attached, so an unguarded `append` would undo, on every scroll,
        // precisely the state the option exists to keep. Order carries no meaning here — cells
        // are absolutely positioned — so there is nothing to gain by moving one either way.
        if (el.parentElement !== parent) parent.append(el);

        // Guarded on the option, not just on the lookup: with retention off nothing is ever
        // hidden, so the map is always empty and consulting it would be a `WeakMap` read per
        // admitted cell per frame bought for a case that cannot arise.
        if (this.options.keepCellsAttached) {
            const display = this.hiddenDisplay.get(el);
            if (display !== undefined) {
                el.style.display = display;
                el.removeAttribute("data-avg-pooled");
                this.hiddenDisplay.delete(el);
            }
        }

        // Last: attached, and visible again if it had been hidden. A listener that measures the
        // element gets a real box here and would have got a zero one anywhere earlier.
        this.options.onCellAttached?.(el);
    }

    // -----------------------------------------------------------------------
    // Styling
    // -----------------------------------------------------------------------

    /** Structure that never changes. Appearance is the stylesheet's business, not this file's. */
    private applyStaticStyles(): void {
        const { growToHeight, growToWidth } = this.options;

        setStyle(this.root, "flex", "1 1 auto");
        setStyle(this.root, "position", "relative");
        setStyle(this.root, "overflow", "hidden");
        setStyle(
            this.root,
            "height",
            this.options.height ?? (growToHeight ? "unset" : "100px"),
        );
        setStyle(this.root, "max-height", growToHeight ?? "unset");

        setStyle(this.container, "overflow-y", "auto");
        setStyle(this.container, "overflow-x", this.options.fitToWidth ? "hidden" : "auto");
        // The viewport still scrolls — that is what keeps the wheel on the compositor and
        // sticky working — but the bar the user sees and drags is the strip, so its own is
        // hidden.
        setStyle(this.container, "scrollbar-width", "none");
        setStyle(this.container, "outline", "none");
        // Scroll anchoring off, on both the scroller and the content it scrolls.
        //
        // Chromium picks a node near the top of the viewport and keeps *it* still when content
        // above it changes size — which in a virtualized list is every frame, because the rows
        // above the viewport are the ones being recycled away. The browser then "corrects" the
        // scroll position back, silently undoing part of the user's scroll: a list that moves
        // every other frame and shows a blank band in between. Found in a filter popover with
        // 100,000 options; the fix belongs here, where every RenderGrid gets it.
        setStyle(this.container, "overflow-anchor", "none");
        setStyle(this.area, "overflow-anchor", "none");
        setStyle(this.container, "max-height", growToHeight ?? "unset");
        setStyle(this.container, "max-width", growToWidth ?? "unset");

        setStyle(this.area, "position", "relative");

        for (const strip of [this.stripY, this.stripX]) {
            setStyle(strip, "position", "absolute");
            setStyle(strip, "overflow-anchor", "none");
            // Above the cells, below any popover the host mounts.
            setStyle(strip, "z-index", "4");
        }
        setStyle(this.stripY, "top", "0px");
        setStyle(this.stripY, "right", "0px");
        setStyle(this.stripY, "overflow-x", "hidden");
        setStyle(this.stripY, "overflow-y", "scroll");
        setStyle(this.spacerY, "width", "1px");

        setStyle(this.stripX, "left", "0px");
        setStyle(this.stripX, "bottom", "0px");
        setStyle(this.stripX, "overflow-y", "hidden");
        setStyle(this.stripX, "overflow-x", "scroll");
        setStyle(this.spacerX, "height", "1px");

        for (const key of ["stickyTop", "stickyBottom"] as const) {
            setStyle(this.regions[key], "position", "sticky");
            setStyle(this.regions[key], "z-index", "2");
        }
        for (const key of ["stickyLeft", "stickyRight"] as const) {
            setStyle(this.regions[key], "position", "sticky");
            setStyle(this.regions[key], "display", "inline-flex");
            setStyle(this.regions[key], "z-index", "1");
        }
        for (const key of [
            "stickyTopLeft",
            "stickyTopRight",
            "stickyBottomLeft",
            "stickyBottomRight",
        ] as const) {
            setStyle(this.regions[key], "position", "sticky");
            setStyle(this.regions[key], "display", "inline-flex");
            setStyle(this.regions[key], "z-index", "3");
        }
    }

    /** Sizes and offsets that follow from the current geometry. */
    private applyLayout(
        info: RenderInputPrepared,
        scrollBarWidth: number,
        scrollBarHeight: number,
    ): void {
        const { innerSize } = info;
        const opts = this.model.getOptions();
        const width = this.model.size.width ?? 0;
        const height = this.model.size.height ?? 0;

        const { growToHeight, growToWidth } = this.options;

        // The strips take the edges the native scrollbars used to, and the viewport gets what
        // is left. Two passes, because showing one bar shrinks the box the other has to fit in
        // — the same decision `overflow: auto` makes internally.
        let needY = innerSize.height > height;
        const needX = innerSize.width > width - (needY ? this.barSize : 0);
        if (needX) needY = innerSize.height > height - this.barSize;
        this.barW = needY ? this.barSize : 0;
        this.barH = needX ? this.barSize : 0;

        // Drawn at least wide enough to grab, but only *reserving* what the platform reserves
        // — so on an overlay-scrollbar platform the strip floats over the content edge, which
        // is what the platform's own bars do there.
        const drawn = px(Math.max(this.barSize, OVERLAY_STRIP_PX));

        setStyle(this.stripY, "display", needY ? "block" : "none");
        setStyle(this.stripY, "width", drawn);
        setStyle(this.stripY, "height", px(height - this.barH));
        setStyle(this.spacerY, "height", px(innerSize.height));

        setStyle(this.stripX, "display", needX ? "block" : "none");
        setStyle(this.stripX, "height", drawn);
        setStyle(this.stripX, "width", px(width - this.barW));
        setStyle(this.spacerX, "width", px(innerSize.width));

        setStyle(this.container, "width", growToWidth ? "unset" : px(width - this.barW));
        setStyle(this.container, "height", growToHeight ? "unset" : px(height - this.barH));

        setStyle(this.area, "width", px(innerSize.width));
        setStyle(this.area, "height", px(innerSize.height));
        // Published for the bottom-anchored overlays (`avg-extra`, the add-row button): with a
        // bottom band, "the bottom of the content" a host or the stylesheet anchors to is the
        // top of that band, not the area's edge the band overlays.
        setStyle(this.area, "--avg-sticky-bottom", px(innerSize.stickyBottomHeight));

        // The right-hand bands sit at the viewport's right edge, inside the scrollbar.
        const rightLeft = px(width - innerSize.stickyRightWidth - scrollBarWidth);

        this.toggleRegion("stickyTop", Boolean(opts.stickyTop));
        if (opts.stickyTop) {
            const el = this.regions.stickyTop;
            setStyle(el, "top", "0px");
            setStyle(el, "width", px(innerSize.width));
            setStyle(el, "height", px(innerSize.stickyTopHeight));
        }

        this.toggleRegion("stickyTopLeft", Boolean(opts.stickyTop && opts.stickyLeft));
        if (opts.stickyTop && opts.stickyLeft) {
            const el = this.regions.stickyTopLeft;
            setStyle(el, "left", "0px");
            setStyle(el, "width", px(innerSize.stickyLeftWidth));
            setStyle(el, "height", px(innerSize.stickyTopHeight));
        }

        this.toggleRegion("stickyTopRight", Boolean(opts.stickyTop && opts.stickyRight));
        if (opts.stickyTop && opts.stickyRight) {
            const el = this.regions.stickyTopRight;
            setStyle(el, "left", rightLeft);
            setStyle(el, "width", px(innerSize.stickyRightWidth));
            setStyle(el, "height", px(innerSize.stickyTopHeight));
        }

        this.toggleRegion("stickyBottom", Boolean(opts.stickyBottom));
        if (opts.stickyBottom) {
            const el = this.regions.stickyBottom;
            setStyle(
                el,
                "top",
                px(height - innerSize.stickyBottomHeight - scrollBarHeight),
            );
            setStyle(el, "width", px(innerSize.width));
            setStyle(el, "height", px(innerSize.stickyBottomHeight));
        }

        this.toggleRegion(
            "stickyBottomLeft",
            Boolean(opts.stickyBottom && opts.stickyLeft),
        );
        if (opts.stickyBottom && opts.stickyLeft) {
            const el = this.regions.stickyBottomLeft;
            setStyle(el, "left", "0px");
            setStyle(el, "width", px(innerSize.stickyLeftWidth));
            setStyle(el, "height", px(innerSize.stickyBottomHeight));
        }

        this.toggleRegion(
            "stickyBottomRight",
            Boolean(opts.stickyBottom && opts.stickyRight),
        );
        if (opts.stickyBottom && opts.stickyRight) {
            const el = this.regions.stickyBottomRight;
            setStyle(el, "left", rightLeft);
            setStyle(el, "width", px(innerSize.stickyRightWidth));
            setStyle(el, "height", px(innerSize.stickyBottomHeight));
        }

        this.toggleRegion("stickyLeft", Boolean(opts.stickyLeft));
        if (opts.stickyLeft) {
            const el = this.regions.stickyLeft;
            setStyle(el, "left", "0px");
            setStyle(el, "width", px(innerSize.stickyLeftWidth));
            // Falls back to the trailing whitespace when there is no bottom band. The
            // right-hand band does not do this; the asymmetry is the reference's.
            setStyle(
                el,
                "height",
                px(
                    innerSize.height -
                        (innerSize.stickyTopHeight +
                            (innerSize.stickyBottomHeight || whiteSpace)),
                ),
            );
            setStyle(el, "transform", `translate(0, -${innerSize.stickyBottomHeight}px)`);
        }

        this.toggleRegion("stickyRight", Boolean(opts.stickyRight));
        if (opts.stickyRight) {
            const el = this.regions.stickyRight;
            setStyle(el, "left", rightLeft);
            setStyle(el, "width", px(innerSize.stickyRightWidth));
            setStyle(
                el,
                "height",
                px(
                    innerSize.height -
                        (innerSize.stickyTopHeight + innerSize.stickyBottomHeight),
                ),
            );
            setStyle(el, "transform", `translate(0, -${innerSize.stickyBottomHeight}px)`);
        }
    }

    private toggleRegion(key: RegionKey, visible: boolean): void {
        setStyle(
            this.regions[key],
            "display",
            visible ? (INLINE_FLEX_REGIONS.has(key) ? "inline-flex" : "block") : "none",
        );
    }
}
