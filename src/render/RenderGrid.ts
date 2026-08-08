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
import type { RenderedCell, RenderInputPrepared } from "./types";
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
}

const px = (n: number) => `${n}px`;

/** Write a style only when it actually differs — a redundant write can force layout. */
function setStyle(el: HTMLElement, prop: string, value: string): void {
    if (el.style.getPropertyValue(prop) !== value) {
        el.style.setProperty(prop, value);
    }
}

function div(dataType: string): HTMLDivElement {
    const el = document.createElement("div");
    el.setAttribute("data-type", dataType);
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

    private lastInfo?: RenderInputPrepared;
    private lastScrollBarWidth = -1;
    private lastScrollBarHeight = -1;

    private _stats = {
        paints: 0,
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

        this.container = div("render-grid-scroll");
        // Focusable so keyboard navigation has somewhere to land, but not in the tab order.
        this.container.tabIndex = -1;

        this.area = div("render-grid-area");

        this.regions = {
            cells: this.area,
            stickyTop: div("render-grid-sticky-top"),
            stickyBottom: div("render-grid-sticky-bottom"),
            stickyLeft: div("render-grid-sticky-left"),
            stickyRight: div("render-grid-sticky-right"),
            stickyTopLeft: div("render-grid-sticky-top-left"),
            stickyTopRight: div("render-grid-sticky-top-right"),
            stickyBottomLeft: div("render-grid-sticky-bottom-left"),
            stickyBottomRight: div("render-grid-sticky-bottom-right"),
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

        this.applyStaticStyles();
        this.host.append(this.root);

        this.model = new RenderGridModel({
            ...options,
            recycle: this.pool.acquire,
        });

        this.container.addEventListener("scroll", this.model.onScroll, {
            passive: true,
        });

        this.unsubscribe = this.model.state.subscribe(this.onModelChanged);

        // Measure and compute. The model is now in the document, so offsetWidth is real.
        this.model.attach({ grid: this.root, container: this.container });

        // Paint synchronously so the grid is on screen when the constructor returns, rather
        // than a frame later. Everything after this goes through requestAnimationFrame.
        this.paint();
    }

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

    /** Replace some or all options; the model decides whether a recompute is needed. */
    setOptions(options: Partial<RenderGridShellOptions>): void {
        Object.assign(this.options, options);
        this.model.setOptions(options);
        if (options.className !== undefined) {
            this.root.className = options.className;
        }
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;

        this.container.removeEventListener("scroll", this.model.onScroll);
        this.unsubscribe?.();
        this.unsubscribe = undefined;

        if (this.rafId !== undefined) {
            cancelAnimationFrame(this.rafId);
            this.rafId = undefined;
        }

        this.model.dispose();
        this.pool.clear();

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
            return;
        }

        this.lastInfo = info;
        this.lastScrollBarWidth = scrollBarWidth;
        this.lastScrollBarHeight = scrollBarHeight;
        this._stats.paints++;

        const startedAt = performance.now();

        this.applyLayout(info, scrollBarWidth, scrollBarHeight);

        this.syncRegion("cells", info.cells);
        this.syncRegion("stickyTop", info.stickyTop);
        this.syncRegion("stickyBottom", info.stickyBottom);
        this.syncRegion("stickyLeft", info.stickyLeft);
        this.syncRegion("stickyRight", info.stickyRight);
        this.syncRegion("stickyTopLeft", info.stickyTopLeft);
        this.syncRegion("stickyTopRight", info.stickyTopRight);
        this.syncRegion("stickyBottomLeft", info.stickyBottomLeft);
        this.syncRegion("stickyBottomRight", info.stickyBottomRight);

        // Hiding the container resets its scrollTop to 0 while the model keeps the real
        // offset; put it back once the content is there to scroll.
        if (
            this.container.scrollTop !== this.model.offset.y ||
            this.container.scrollLeft !== this.model.offset.x
        ) {
            this.model.restoreScroll();
        }

        this._stats.lastPaintMs = performance.now() - startedAt;
        this._stats.totalPaintMs += this._stats.lastPaintMs;
    }

    /** Zero the counters, so a benchmark can measure one phase in isolation. */
    resetStats(): void {
        this._stats = {
            paints: 0,
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
    private syncRegion(key: RegionKey, cells: Array<RenderedCell>): void {
        const parent = this.regions[key];
        const prev = this.attached[key];

        const next = new Set<HTMLElement>();
        for (const cell of cells) {
            if (cell) next.add(cell);
        }

        for (const el of prev) {
            if (!next.has(el)) {
                parent.removeChild(el);
                this.pool.release(el);
                this._stats.cellsRemoved++;
            }
        }

        for (const el of next) {
            if (!prev.has(el)) {
                parent.append(el);
                this._stats.cellsAppended++;
            }
        }

        this.attached[key] = next;
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
        setStyle(this.container, "outline", "none");
        setStyle(this.container, "max-height", growToHeight ?? "unset");
        setStyle(this.container, "max-width", growToWidth ?? "unset");

        setStyle(this.area, "position", "relative");

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
        setStyle(this.container, "width", growToWidth ? "unset" : px(width));
        setStyle(this.container, "height", growToHeight ? "unset" : px(height));

        setStyle(this.area, "width", px(innerSize.width));
        setStyle(this.area, "height", px(innerSize.height));

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
