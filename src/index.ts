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
export type {
    AVGridStateSnapshot,
    ColumnStateSnapshot,
    ViewportSnapshot,
} from "./AVGrid";
export type { AVGridOptions, ResolvedOptions } from "./options";
export { CALLBACK_OPTION_KEYS, PAINT_PATH_CALLBACK_KEYS } from "./options";
export type { CallbackOptionKey } from "./options";
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
export {
    FiltersModel,
    FILTERS_CONFIG_VERSION,
    filtersStorageKey,
    hasStoredFilters,
    readStoredFilters,
    writeStoredFilters,
    reviveFilters,
    defaultFilterOptions,
} from "./model/FiltersModel";
export { FocusModel } from "./model/FocusModel";
export type {
    GridSelection,
    SelectionType,
    SelectedCount,
    UpdateFocusOptions,
} from "./model/FocusModel";
export { SelectedModel } from "./model/SelectedModel";
export type { SelectAllState } from "./model/SelectedModel";
export { CopyPasteModel } from "./model/CopyPasteModel";
export type { CopyMode } from "./model/CopyPasteModel";
export { EditingModel } from "./model/EditingModel";
export { createCellInput } from "./view/CellInput";
export { createCellSelect } from "./view/CellSelect";
export { createDefaultEditor } from "./view/DefaultEditFormatter";
export { SortColumnModel } from "./model/SortColumnModel";
export { StructureModel } from "./model/StructureModel";
export { SELECT_COLUMN_KEY, createSelectColumn } from "./view/SelectColumn";
export { Popover } from "./view/Popover";
export type { PopoverOptions, PopoverPlacement, PopoverSize } from "./view/Popover";
export { VirtualList } from "./view/VirtualList";
export type {
    VirtualListItem,
    VirtualListOptions,
    VirtualListValue,
} from "./view/VirtualList";
export { Menu, showMenu, MENU_SEARCH_THRESHOLD, MENU_SUBMENU_DELAY_MS } from "./view/Menu";
export type { MenuOptions } from "./view/Menu";
export {
    gridContextMenuItems,
    gridContextMenuEvent,
    showGridContextMenu,
} from "./view/ContextMenu";
export { showFilterPopover } from "./view/FilterPopover";
export type { ShowFilterPopoverOptions } from "./view/FilterPopover";
export {
    OptionsFilterContent,
    OPTIONS_FILTER_MIN_WIDTH,
} from "./view/OptionsFilterContent";
export type { OptionsFilterContentOptions } from "./view/OptionsFilterContent";
export { CustomFilterContent } from "./view/CustomFilterContent";
export type { CustomFilterContentOptions } from "./view/CustomFilterContent";
export { TextFilterContent, TEXT_FILTER_MIN_WIDTH } from "./view/TextFilterContent";
export type { TextFilterContentOptions } from "./view/TextFilterContent";
export {
    TEXT_FILTER_OPS,
    DEFAULT_TEXT_FILTER_OPS,
    textFilterOpLabel,
} from "./textFilterOps";
export type { TextFilterOpInfo } from "./textFilterOps";
export { FilterBar, optionsFilterValues, describeFilter } from "./view/FilterBar";
export type { FilterBarOptions, FilterChipText } from "./view/FilterBar";
export { createButton, createIconButton } from "./view/Button";

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
    searchWords,
} from "./gridUtils";
export { highlightText } from "./highlight";
export { detectColumnWidth, detectColumnWidths } from "./column-width";
export type { ColumnWidthOptions } from "./column-width";
export {
    inferColumns,
    inferGetRowKey,
    inferRowKeyProperty,
    validateFilters,
} from "./validate";

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

// --- measured row heights (opt-in companion over the engine) ---------------

export { MeasuredRowGrid } from "./measured/MeasuredRowGrid";
export type {
    MeasuredRowGridOptions,
    MeasuredRowCellFunc,
    MeasuredRowCellParams,
} from "./measured/MeasuredRowGrid";
export {
    MeasuredRowHeights,
    MEASURED_ROW_DEBOUNCE_MS,
    DEFAULT_MIN_ROW_HEIGHT,
} from "./measured/MeasuredRowHeights";
export type {
    MeasuredRowHeightOptions,
    MeasuredRowGeometry,
} from "./measured/MeasuredRowHeights";

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
export const version = "2.9.0";
