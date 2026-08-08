/**
 * Public entry point.
 *
 * `AVGrid` is the headline export and the only thing most callers need:
 *
 * ```js
 * import { AVGrid } from "av-grid";
 * const grid = AVGrid.create("#host", { rows });
 * ```
 *
 * Everything under it stays exported, because the virtualization engine is useful on its own
 * — the benchmark harness in `test-boards/` drives `RenderGrid` directly, with no grid on top.
 *
 * Everything reachable from this file is public API and documented. Everything else is
 * internal and may change without notice.
 */

// --- the grid -------------------------------------------------------------

export { AVGrid } from "./AVGrid";
export type { AVGridStateSnapshot } from "./AVGrid";
export type { AVGridOptions, ResolvedOptions } from "./options";
export { AVGridError } from "./validate";
export {
    injectStyles,
    css as avGridCss,
    AVGRID_STYLE_ID,
} from "./styles/av-grid.css";

// --- models, for hosts that want to reach past the façade -----------------

export { AVGridModel } from "./model/AVGridModel";
export type { AVGridState } from "./model/AVGridModel";
export { AVGridData } from "./model/AVGridData";
export type { AVGridDataChangeEvent } from "./model/AVGridData";
export { AVGridEvents } from "./model/AVGridEvents";
export { ColumnsModel, defaultColumnWidth as defaultGridColumnWidth } from "./model/ColumnsModel";
export { RowsModel } from "./model/RowsModel";
export { SortColumnModel } from "./model/SortColumnModel";

// --- helpers --------------------------------------------------------------

export {
    defaultCompare,
    formatDisplayValue,
    filterRows,
    columnDisplayValue,
    rowsToCsvText,
    defaultValidate,
    gridBoolean,
    falseString,
} from "./gridUtils";
export { detectColumnWidth, detectColumnWidths } from "./column-width";
export type { ColumnWidthOptions } from "./column-width";
export { inferColumns, inferGetRowKey } from "./validate";

// --- the engine -----------------------------------------------------------

export { RenderGrid } from "./render/RenderGrid";
export type {
    RenderGridShellOptions,
    RenderGridStats,
} from "./render/RenderGrid";

export {
    RenderGridModel,
    defaultRowHeight,
    defaultColumnWidth,
} from "./render/RenderGridModel";
export type {
    RenderGridOptions,
    RenderGridElements,
    RenderGridState,
} from "./render/RenderGridModel";

export { CellPool } from "./render/CellPool";
export type { CellPoolStats } from "./render/CellPool";

export {
    calcRenderInfo,
    calcScrollOffset,
    calcScrollOffsetX,
    calcScrollOffsetY,
    renderInfoInitialState,
    whiteSpace,
} from "./render/renderInfo";
export { prepareRerender } from "./render/rerender-check";

// --- primitives -----------------------------------------------------------

export { Observable, Model } from "./core/observable";
export type { Unsubscribe, Listener, StateUpdate } from "./core/observable";
export { AsyncRef } from "./core/AsyncRef";
export { Subscription } from "./core/events";
export type { SubscriptionCallback, SubscriptionHandle } from "./core/events";
export { recordsToCsv, csvToRecords } from "./core/csv";
export type { CsvStringifyOptions } from "./core/csv";

export * from "./render/types";
export * from "./types";

/** Bumped on release; `AVGrid.version` and the docs both quote it. */
export const version = "0.0.0";
