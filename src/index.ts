/**
 * Public entry point.
 *
 * At this stage of the port it exposes the **virtualization engine** — enough to build a grid
 * by hand and, more to the point, enough to benchmark. The `AVGrid.create()` surface described
 * in `tasks/goal.md` arrives in task 6 and will become the headline export; everything here
 * stays available underneath it for callers who want the engine without the grid.
 */

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

export { Observable, Model } from "./core/observable";
export type { Unsubscribe, Listener, StateUpdate } from "./core/observable";
export { AsyncRef } from "./core/AsyncRef";
export { Subscription } from "./core/events";
export type { SubscriptionCallback, SubscriptionHandle } from "./core/events";
export { recordsToCsv, csvToRecords } from "./core/csv";
export type { CsvStringifyOptions } from "./core/csv";

export * from "./render/types";
export * from "./types";

/** Bumped on release; `grid.getState()` and the docs both quote it. */
export const version = "0.0.0";
