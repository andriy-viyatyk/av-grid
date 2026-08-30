/**
 * Types for the virtualization engine.
 *
 * Ported from `RenderGrid/types.ts` with three substitutions and nothing else:
 * - `ReactNode` → `RenderedCell` (an `HTMLElement`, or `undefined` when nothing was rendered)
 * - `CSSProperties` → `CellStyle`, which is the exact set of properties `renderInfo.ts`
 *   actually produces — six numeric/keyword fields, not the whole CSS surface
 * - `Ref<T>` / `RefType<T>` → dropped; the DOM shell holds real element references
 *
 * Everything else keeps the reference's names, because `renderInfo.ts` and
 * `rerender-check.ts` are ported nearly line-for-line against them.
 */

/** What a cell renderer produces. `undefined` means "render nothing in this slot". */
export type RenderedCell = HTMLElement | undefined;

export type RenderInfoObject = { [key: number]: boolean };
export type RenderCellKey = `${number}_${number}`;
export type RenderInfoCellObject = { [key in RenderCellKey]?: boolean };
export type RenderRange = { rows: number[]; columns: number[] };

export type RenderCell = { row: number; col: number };
export type RenderPoint = { x: number; y: number };
export type RenderSize = { width: number; height: number };
export type RenderSizeOptional = {
    width: number | undefined;
    height: number | undefined;
};
export type Percent = `${number}%`;
export type ElementLength = number | ((v: number) => number | Percent);
export type RenderCellMap = { [key in RenderCellKey]?: RenderedCell };
export type RowAlign = "top" | "center" | "bottom" | "nearest";

export type RenderRect = {
    top: number;
    right: number;
    bottom: number;
    left: number;
};

/** A uniform length for every element, or a per-element array of lengths. */
export type RenderLength = number | Array<number>;

export type AdjustRenderRangeFunc = (r: RenderRect) => void;

/** Absolute positioning for one cell, in pixels. Produced by `renderInfo.ts`. */
export interface CellStyle {
    display: "inline-flex";
    position: "absolute";
    left: number;
    top: number;
    width: number;
    height: number;
}

/** `RerenderInfo` expanded into lookup maps, so the paint loop can test membership in O(1). */
export interface RerenderInfoPrepared {
    all: boolean;
    rows: RenderInfoObject;
    columns: RenderInfoObject;
    cells: RenderInfoCellObject;
}

/**
 * The dirty set — the single most important type in the library.
 *
 * A change reports *only the cells whose rendered output actually changed*. Growing a range
 * selection by one cell must produce `{ cells: [thatCell, theCellThatLostIt] }`, never
 * `{ rows: [...] }` and never `{ all: true }`. Every performance claim this project makes
 * rests on that discipline being kept everywhere a `RerenderInfo` is constructed.
 */
export interface RerenderInfo {
    all?: boolean;
    rows?: Array<number>;
    /**
     * **Geometry** invalidation: every row from here down has moved.
     *
     * Different in kind from `rows`, which says "these rows' *content* changed". A row that
     * grows or shrinks does not change what any row below it renders — it changes where each
     * one *starts*, and it changes the total scrollable height. Repainting only the row that
     * changed leaves the rest of the list drawn at its old offsets, overlapping or gapped.
     *
     * This is what a measured-height layer marks when a row's measured height is committed:
     * `update({ fromRow: row })`. `{ rows: [row] }` is not a substitute (it repaints one row
     * and leaves the others mispositioned) and `{ all: true }` is not either (it invalidates
     * content that did not change, and still does not state the contract).
     *
     * Absent, everything behaves exactly as it did before this field existed.
     */
    fromRow?: number;
    columns?: Array<number>;
    cells?: Array<RenderCell>;
    /** Repaint even where the engine believes nothing changed. Escape hatch; use sparingly. */
    force?: boolean;
}

export interface RenderedRange {
    visible: RenderRect;
    rendered: RenderRect;
    visibleOffset?: RenderRect;
}

export interface RenderInnerSize {
    width: number;
    height: number;
    stickyTopHeight: number;
    stickyRightWidth: number;
    stickyBottomHeight: number;
    stickyLeftWidth: number;
}

export interface RenderInput {
    size: RenderSize;
    rowCount: number;
    columnCount: number;
    stickyTop: number;
    stickyRight: number;
    stickyBottom: number;
    stickyLeft: number;
    scrollBarWidth: number;
    scrollBarHeight: number;
    fitToWidth: boolean;
}

/**
 * The computed window: which rows and columns are visible, where each one sits, and the
 * rendered cells for every region. The nine cell arrays are the centre plus the four sticky
 * bands plus the four corners.
 */
export interface RenderInputPrepared {
    visible: RenderRect;
    rendered: RenderRect;
    visibleOffset?: RenderRect;
    innerSize: RenderInnerSize;
    columnLength: RenderLength;
    rowLength: RenderLength;
    columnStarts: RenderLength;
    rowStarts: RenderLength;

    input: RenderInput;

    cells: Array<RenderedCell>;
    stickyTop: Array<RenderedCell>;
    stickyLeft: Array<RenderedCell>;
    stickyRight: Array<RenderedCell>;
    stickyBottom: Array<RenderedCell>;
    stickyTopLeft: Array<RenderedCell>;
    stickyTopRight: Array<RenderedCell>;
    stickyBottomRight: Array<RenderedCell>;
    stickyBottomLeft: Array<RenderedCell>;
    map: RenderCellMap;
    renderRange: RenderRange;
}

/**
 * Hands back a detached element that scrolled out of the window on an earlier frame, or
 * `undefined` when the pool is empty.
 *
 * The element arrives in **whatever state its previous occupant left it** — same children,
 * classes, attributes and listeners. That is deliberate: reusing the inner structure is most
 * of the saving. A cell renderer that recycles must therefore overwrite everything it sets.
 *
 * Pass a `reuseKey` when the list's rows are **not all alike** — a log of text, tables and
 * images; a notebook of mixed cells. Only a cell released under that same key comes back, so a
 * renderer never has to tear down and rebuild an incompatible one, and a keyed request that
 * finds nothing returns `undefined` rather than something of the wrong kind. Pair it with
 * `setReuseKey`, which is what tells the pool the kind the cell ended up being built for.
 *
 * A renderer that passes no key gets the pool's original behaviour: any element will do.
 */
export type RecycleFunc = (reuseKey?: CellReuseKey) => HTMLElement | undefined;

/**
 * A consumer-owned “same kind of cell” token, opaque to the library. A string is the usual
 * choice (`"text"`, `"image"`); anything works. Keys compare by `Map` semantics — identity for
 * objects and symbols, value for strings and numbers.
 */
export type CellReuseKey = unknown;

/**
 * Declares what kind of row a cell was built for, so the pool can hand it back to a compatible
 * one later. Call it after resolving the element, with the same key passed to `recycle`:
 *
 * `p.setReuseKey?.(cell, kind);`
 *
 * Calling it with no key returns the cell to the untagged pool. A renderer whose rows are all
 * alike never needs it.
 */
export type SetReuseKeyFunc = (element: HTMLElement, reuseKey?: CellReuseKey) => void;

export interface RenderCellParams {
    col: number;
    row: number;
    style: CellStyle;
    key: RenderCellKey;
    renderInfo: RenderInputPrepared;
    /** Present when a cell pool is attached. See `RecycleFunc`. */
    recycle?: RecycleFunc;
    /**
     * Present when a cell pool is attached. Only needed by a renderer whose rows differ in
     * structure — see `SetReuseKeyFunc`.
     */
    setReuseKey?: SetReuseKeyFunc;
    /**
     * The element already rendered at this coordinate, when there is one — i.e. the cell is
     * being re-rendered because it went dirty, not because it just scrolled into view.
     *
     * **Prefer this over `recycle()`.** Updating it in place means the shell sees the same
     * element before and after, so the paint does no DOM insertion or removal at all, and
     * anything living on the element survives — focus, an open editor, a running transition.
     * Swapping in a pooled element instead would destroy all three.
     *
     * The usual shape is:
     * `const el = p.previous ?? p.recycle?.() ?? document.createElement("div");`
     */
    previous?: HTMLElement;
}

export type RenderCellFunc = (p: RenderCellParams) => RenderedCell;

export interface RenderData {
    renderCell: RenderCellFunc;
    recycle?: RecycleFunc;
    setReuseKey?: SetReuseKeyFunc;
    old: RenderInputPrepared;
    newInfo: RenderInputPrepared;
    rerender: RerenderInfoPrepared | null;
    rowLength: RenderLength;
    columnLength: RenderLength;
    rowStarts: RenderLength;
    columnStarts: RenderLength;
}

export interface CalcRenderInfoInput {
    offset: RenderPoint;
    size: RenderSize;
    rowCount: number;
    columnCount: number;
    rowHeight: ElementLength;
    columnWidth: ElementLength;
    renderCell: RenderCellFunc;
    /** Forwarded verbatim to every `renderCell` call. The geometry never calls it itself. */
    recycle?: RecycleFunc;
    /** Forwarded verbatim too, beside `recycle`. */
    setReuseKey?: SetReuseKeyFunc;
    stickyTop: number;
    stickyLeft: number;
    stickyRight: number;
    stickyBottom: number;
    overscanColumn: number;
    overscanRow: number;
    scrollBarWidth: number;
    scrollBarHeight: number;
    direction?: RenderPoint;
    fitToWidth: boolean;
    onAdjustRenderRange?: AdjustRenderRangeFunc;
    rerender?: RerenderInfo;
}
