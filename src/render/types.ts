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

export interface RenderCellParams {
    col: number;
    row: number;
    style: CellStyle;
    key: RenderCellKey;
    renderInfo: RenderInputPrepared;
}

export type RenderCellFunc = (p: RenderCellParams) => RenderedCell;

export interface RenderData {
    renderCell: RenderCellFunc;
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
