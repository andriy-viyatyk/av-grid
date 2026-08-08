/**
 * The public type surface.
 *
 * Ported from `AVGrid/avGridTypes.ts`, with React removed and the reference's naming quirks
 * corrected. Three classes of change, all deliberate — see the decision log in
 * `tasks/plan.md`:
 *
 * 1. **Misspellings fixed.** `haderRenderer`, `cellFormater`, `editFormater`, `resizible`
 *    are gone. An agent types the correct spelling and must not be silently ignored.
 * 2. **The `T` prefix dropped.** `TSortColumn` → `SortColumn`, `TFilter` → `Filter`. The
 *    prefix is a Persephone house style, not something a consumer would guess.
 * 3. **`cellRenderer` and `cellFormater` collapsed into one `render` hook.** In React they
 *    differed because one was a `ComponentType` and the other a function returning a
 *    `ReactNode`. In the DOM both are "a function that produces cell content", so keeping
 *    two would be two ways to do one thing.
 *
 * Dropped entirely: `TAVGridContext` (React context — the model is passed directly) and the
 * `React.MouseEvent` / `React.DragEvent` handler types (replaced with DOM events).
 */

import type { Percent, RenderCellParams } from "./render/types";

export type { Percent };

export type Point = { x: number; y: number };

export type SortDirection = "asc" | "desc";

export interface SortColumn {
    key: string;
    direction: SortDirection;
}

export type DataType = "string" | "number" | "boolean";

export type DisplayFormat =
    | "text"
    | "date"
    | "dateTime"
    | "phone"
    | `date:${string}`
    | `utcToLocal:${string}`;

export type Alignment = "left" | "center" | "right";

export type RowCompare<R = any> = (left: R, right: R) => number;

// ---------------------------------------------------------------------------
// Cell rendering
// ---------------------------------------------------------------------------

/**
 * What a `render` hook receives. Small and flat on purpose: an agent writing
 * `` render: (cell) => `<b>${cell.value}</b>` `` should not have to learn a type to do it.
 */
export interface CellContext<R = any> {
    /** The cell's value — `row[column.key]`, before any formatting. */
    value: any;
    row: R;
    column: Column<R>;
    /** Index into the currently displayed rows (after sorting and filtering). */
    rowIndex: number;
    colIndex: number;
    rowKey: string;
}

/**
 * Produces a cell's content. Return an HTML string (the common case) or a DOM element (when
 * you need to attach listeners). Returning `null` or `undefined` renders an empty cell.
 *
 * The string form inserts markup as-is. Boards are sandboxed, but the caller still owns
 * escaping untrusted values.
 */
export type CellRenderer<R = any> = (
    cell: CellContext<R>,
) => string | HTMLElement | null | undefined;

export interface HeaderContext<R = any> {
    column: Column<R>;
    colIndex: number;
}

export type HeaderRenderer<R = any> = (
    header: HeaderContext<R>,
) => string | HTMLElement | null | undefined;

/**
 * Low-level renderer used by the engine itself, which addresses cells by grid coordinates
 * rather than by row object. Internal — column authors use `CellRenderer`.
 */
export interface GridCellParams<R = any> extends RenderCellParams {
    className?: string;
    columns: Column<R>[];
    rows: R[];
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

export interface Column<R = any> {
    /** Property name on the row object. Also the column's identity everywhere in the API. */
    key: keyof R | string;
    /** Header label. Defaults to `key` when omitted. */
    name?: string;
    width?: number | Percent;
    hidden?: boolean;

    /** Custom cell content. See `CellRenderer`. */
    render?: CellRenderer<R>;
    /** Custom header content. */
    headerRender?: HeaderRenderer<R>;
    /** Custom content while the cell is being edited. */
    editRender?: CellRenderer<R>;

    /** Plain-text value used for sorting, filtering, and clipboard copy. */
    formatValue?: (column: Column<R>, row: R) => string;

    dataType?: DataType;
    displayFormat?: DisplayFormat;
    align?: Alignment;

    resizable?: boolean;
    readonly?: boolean;
    /** Marks a non-data column (row selection checkbox, row number) pinned to the left. */
    isStatusColumn?: boolean;

    rowCompare?: RowCompare<R>;
    filterType?: FilterType;

    /** Coerce/reject an edited value. Return the value to commit. */
    validate?: (column: Column<R>, row: R, value: any) => any;
    /** Choices for the in-cell editor. May be computed, and may be async. */
    options?: any[] | (() => any[] | Promise<any[]>);
}

export type OnColumnResize = (columnKey: string, width: number) => void;
export type OnColumnsReorder = (sourceKey: string, targetKey: string) => void;

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/** Only `"options"` exists today; the popover is built as a dispatch point for more. */
export type FilterType = "options";

export interface Filter {
    columnKey: string;
    columnName: string;
    type: FilterType;
    displayFormat?: DisplayFormat;
}

export interface AnyFilter extends Filter {
    value: any;
}

export interface DisplayOption<T = any> {
    value: T;
    label: string;
    italic?: boolean;
}

export type OptionsFilterValue = DisplayOption[];

export interface OptionsFilter extends Filter {
    type: "options";
    value?: OptionsFilterValue;
}

// ---------------------------------------------------------------------------
// Focus, selection, editing
// ---------------------------------------------------------------------------

/**
 * The focused cell, plus the range selection anchored on it.
 *
 * Both key and index are carried for each selection corner: keys survive sorting and
 * filtering, indices make the hot-path bounds test a pair of integer comparisons rather than
 * a map lookup. Keeping both is what lets range selection stay flat-cost at row 99,000.
 */
export type CellFocus<R = any> = {
    rowKey: string;
    columnKey: keyof R | string;
    isDragging: boolean;
    selection?: {
        rowKeyStart: string;
        rowKeyEnd: string;
        colKeyStart: keyof R | string;
        colKeyEnd: keyof R | string;
        rowStart: number;
        rowEnd: number;
        colStart: number;
        colEnd: number;
    };
};

export type CellEdit<R = any> = {
    rowKey: string;
    columnKey: keyof R | string;
    value: any;
    dontSelect?: boolean;
    changed: boolean;
};

// ---------------------------------------------------------------------------
// Cell events
// ---------------------------------------------------------------------------

export type CellClickEvent<R = any> = (
    row: R,
    col: Column<R>,
    rowIndex: number,
    colIndex: number,
) => void;

export type CellMouseEvent<R = any> = (
    e: MouseEvent,
    row: R,
    col: Column<R>,
    rowIndex: number,
    colIndex: number,
) => void;

export type CellDragEvent<R = any> = (
    e: DragEvent,
    row: R,
    col: Column<R>,
    rowIndex: number,
    colIndex: number,
) => void;
