/**
 * The options object — the surface an agent writes by hand.
 *
 * Everything except `rows` is optional, and there is no required call order: an option can be
 * supplied at `create()` or later through `setOptions()`, and the two paths run the same code.
 *
 * The reference had no equivalent of this type. `AVGridProps` was a React props interface in
 * which the host owned all the state — columns, sort, selection and focus were passed *down*
 * with a setter passed back *up*. That is the wrong shape for a library called from plain
 * JavaScript, so here the grid owns its state and reports changes through callbacks. A host
 * that wants control still has it: every piece of state has a getter and a setter.
 */

import type {
    CellContext,
    CellEditEvent,
    CellFocus,
    Column,
    Filter,
    InvalidEditEvent,
    SortColumn,
} from "./types";

export interface AVGridOptions<R = any> {
    // -----------------------------------------------------------------------
    // Data
    // -----------------------------------------------------------------------

    /** The rows to display. The only required option. */
    rows: readonly R[];

    /**
     * The columns to display. Inferred from the first rows' keys when omitted — see
     * `inferColumns` in `validate.ts` for exactly what that produces.
     */
    columns?: Column<R>[];

    /**
     * A stable identity for a row, used by selection, focus and editing so they survive
     * sorting and filtering.
     *
     * Inferred when omitted: an `id` or `key` property if the rows have one, otherwise an
     * identity assigned per row object on first sight. The inferred form is stable across
     * sorting and filtering but not across a `setRows()` that rebuilds the row objects.
     */
    getRowKey?: (row: R) => string;

    // -----------------------------------------------------------------------
    // Row selection
    // -----------------------------------------------------------------------

    /**
     * Show the checkbox column, pinned to the left of the data columns.
     *
     * The column is the grid's, not the host's: it does not appear in `getColumns()` and does
     * not survive into `setColumns()`, so a host can rewrite its columns without having to
     * remember to put the checkbox back.
     */
    selectColumn?: boolean;

    /**
     * Initially selected rows, by row key — the value `getRowKey` returns, not the row index.
     * Keys are used throughout so a selection survives sorting and filtering.
     */
    selected?: readonly string[];

    /**
     * The set of selected rows changed, by checkbox or by `setSelected()`.
     *
     * Receives the keys; call `grid.getSelectedRows()` for the row objects, which is O(rows)
     * and so is not done for you on every click.
     */
    onSelectionChange?: (selectedKeys: string[]) => void;

    // -----------------------------------------------------------------------
    // Editing
    // -----------------------------------------------------------------------

    /**
     * Let the user edit cells in place.
     *
     * ```js
     * AVGrid.create(el, {
     *     rows,
     *     editable: true,
     *     onEdit: (edit) => save(edit.rowKey, edit.columnKey, edit.value),
     * });
     * ```
     *
     * Editing starts on a double-click, on F2 or Enter, or simply by typing into a focused
     * cell; it commits on Enter, Tab or blur and cancels on Escape. Boolean columns have no
     * text editor — Space, Enter or a double-click toggles them across the whole selection —
     * and Delete clears every editable cell in the selection.
     *
     * Per-column opt-outs: `readonly: true` on a column, and any status column (the checkbox).
     *
     * **The grid writes the value into the row object** (`row[column.key] = value`) and then
     * calls `onEdit`. That is the behaviour an agent expects from `editable: true` alone — the
     * reference edited nothing without a callback, which reads as a broken grid. Return `false`
     * from `onEdit` to keep the write from happening and own the update yourself.
     */
    editable?: boolean;

    /**
     * A cell was edited. Fires once per committed cell, *before* the value is written, so
     * returning `false` rejects it.
     *
     * A range delete or a boolean toggle across a selection fires this once per cell.
     */
    onEdit?: (edit: CellEditEvent<R>) => void | boolean;

    /**
     * An edit was rejected because the value could not be coerced to the column's type — the
     * usual case is a value that is not one of the column's `options`.
     *
     * This is where the reference called `beep()` from Persephone's audio utility. A library
     * should not make noise uninvited, so the sound is the host's to make: the default is to do
     * nothing at all.
     */
    onInvalidEdit?: (edit: InvalidEditEvent<R>) => void;

    // -----------------------------------------------------------------------
    // Clipboard
    // -----------------------------------------------------------------------

    /**
     * Turn off the grid's clipboard handling. On by default — no option is needed to get it.
     *
     * ctrl+C copies the selected range as tab-separated text, which is what Excel, Sheets and
     * Numbers paste as cells; ctrl+shift+C adds a header row; ctrl+V pastes into the selection;
     * ctrl+X copies and then clears, on an `editable` grid. Pasting writes through the same path
     * as typing, so `validate`, `readonly` and `onEdit` all still apply.
     *
     * Set this when the page has its own clipboard behaviour to run instead.
     */
    disableClipboard?: boolean;

    // -----------------------------------------------------------------------
    // Layout
    // -----------------------------------------------------------------------

    /** Row height in pixels. Default 24. Uniform — variable row heights are not supported. */
    rowHeight?: number;
    /** Stretch the columns to fill the width, instead of scrolling horizontally. */
    fitToWidth?: boolean;
    /** Draw the static cell borders. Default `true`; `false` gives a borderless list look. */
    cellBorders?: boolean;
    /** CSS height for the root. Set it to let the grid grow instead of filling its parent. */
    growToHeight?: string;
    growToWidth?: string;
    /** Extra rows/columns rendered outside the viewport. Defaults: 4 rows, 1 column. */
    overscanRow?: number;
    overscanColumn?: number;

    // -----------------------------------------------------------------------
    // Presentation
    // -----------------------------------------------------------------------

    /** Extra class on the root element, for host styling. */
    className?: string;
    /** Debug label, emitted as `data-name` on the root. Never used for styling. */
    name?: string;
    /**
     * Inject the grid's stylesheet into the document on first use. Default `true`.
     *
     * Set `false` if you link `av-grid.css` yourself. The injected sheet is added once per
     * document however many grids are created, and carries no `!important`, so any host rule
     * of equal specificity wins.
     */
    injectStyles?: boolean;

    // -----------------------------------------------------------------------
    // Sorting and filtering
    // -----------------------------------------------------------------------

    /** Initial sort. Clicking a header cycles ascending → descending → none. */
    sort?: SortColumn | null;
    /** Free-text filter applied across every column's displayed value. */
    searchString?: string;
    /** Applied column filters. The filter UI arrives in task 16; these already filter rows. */
    filters?: Filter[];
    disableSorting?: boolean;
    disableFiltering?: boolean;

    // -----------------------------------------------------------------------
    // Callbacks
    // -----------------------------------------------------------------------

    onSortChange?: (sort: SortColumn | undefined) => void;
    onColumnResize?: (columnKey: string, width: number) => void;
    onColumnsReorder?: (sourceKey: string, targetKey: string) => void;
    /** Fires after any change to the column set, whatever caused it. */
    onColumnsChange?: (columns: Column<R>[]) => void;
    /** Fires when the set of displayed rows changes — a sort, a filter, or `setRows()`. */
    onVisibleRowsChange?: (rows: readonly R[]) => void;

    /**
     * The focused cell, and the range selected around it, changed.
     *
     * Fires for clicks, drags and keyboard navigation alike, and once per cell during a drag
     * rather than once per pointer move. `undefined` means the focus was cleared.
     *
     * Named for *cell* focus deliberately: `onSelectionChange` is reserved for row selection,
     * which is a different thing a grid can have selected.
     */
    onFocusChange?: (focus: CellFocus<R> | undefined) => void;

    onCellClick?: (cell: CellContext<R>, e: MouseEvent) => void;
    onCellDoubleClick?: (cell: CellContext<R>, e: MouseEvent) => void;
    onCellContextMenu?: (cell: CellContext<R>, e: MouseEvent) => void;
    /** Extra class names for a cell, applied on top of the built-in state classes. */
    onCellClass?: (cell: CellContext<R>) => string | undefined;
}

/** The resolved form: every option that has a default, with its default filled in. */
export interface ResolvedOptions<R = any> extends AVGridOptions<R> {
    columns: Column<R>[];
    getRowKey: (row: R) => string;
    rowHeight: number;
}
