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
    AddColumnsEvent,
    AddRowsEvent,
    CellContext,
    CellEditEvent,
    CellFocus,
    ClassValue,
    Column,
    DeleteColumnsEvent,
    DeleteRowsEvent,
    Filter,
    GetFilterOptions,
    GridContextMenuEvent,
    InvalidEditEvent,
    MenuItem,
    PersistFiltersOptions,
    RowContext,
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
    // Adding and deleting rows and columns
    // -----------------------------------------------------------------------

    /**
     * Let the user add rows: an **+ add row** button under the last row, ctrl+Insert, ArrowDown
     * or Tab off the end of the grid, and a paste that is taller than the grid.
     *
     * ```js
     * AVGrid.create(el, {
     *     rows,
     *     editable: true,
     *     canAddRows: true,
     *     newRow: () => ({ id: crypto.randomUUID(), name: "", score: 0 }),
     *     onAddRows: (e) => save(e.rows),
     * });
     * ```
     *
     * The four `can*` options govern *the user's* affordances only. `grid.addRows()` and the
     * other methods always work — an API call is the host's own decision, and needing to set an
     * option before your own code may call a method is a trap, not a safeguard.
     */
    canAddRows?: boolean;
    /** Let the user delete rows — ctrl+Delete deletes the selected ones. */
    canDeleteRows?: boolean;
    /** Let the user add columns — ctrl+shift+Insert, ctrl+→ off the last column, and a `+` in the header. */
    canAddColumns?: boolean;
    /** Let the user delete columns — ctrl+shift+Delete deletes the selected ones. */
    canDeleteColumns?: boolean;

    /**
     * What a blank row contains. Called once per row being added, with the index it will land at.
     *
     * The default produces `{}` — plus a unique placeholder for the row-key property when the
     * grid inferred one, because two rows sharing a key would confuse selection, focus and
     * editing. Supply this whenever a blank row needs anything else.
     */
    newRow?: (index: number) => R;

    /** What a blank column looks like. The default is `{ key: "column<n>", name: "Column <n>" }`. */
    newColumn?: (index: number) => Column<R>;

    /** Text on the add-row button. Default `` `add ${rowNoun}` ``, so `"add row"`. */
    addRowLabel?: string;

    /**
     * What this grid calls one of its rows. Default `"row"`.
     *
     * ```js
     * AVGrid.create(el, { rows: links, rowNoun: "link", canAddRows: true, canDeleteRows: true });
     * // the menu reads "Insert 3 links" / "Delete 1 link"; the button reads "+ add link"
     * ```
     *
     * Not every grid holds "rows" — a grid of links holds links, a grid of environment
     * variables holds variables, and on those a menu offering `Insert 3 rows` reads as though the
     * grid does not know what it contains. Give it the **singular** noun and the grid pluralises
     * it: the three row items in the context menu and the add-row button's text and title.
     *
     * `addRowLabel` still overrides the button outright. Columns are unaffected — there is no
     * `columnNoun`, because nothing has asked to rename them.
     */
    rowNoun?: string;

    /**
     * Rows are about to be added, however that was triggered. Return `false` to cancel.
     *
     * Fires *before* the insert, like `onEdit`, so the callback can fill the rows in or refuse
     * them. `grid.getRows()` afterwards includes them.
     */
    onAddRows?: (e: AddRowsEvent<R>) => void | boolean;
    /** Rows are about to be deleted. Return `false` to cancel — this is where a confirm goes. */
    onDeleteRows?: (e: DeleteRowsEvent<R>) => void | boolean;
    /** Columns are about to be added. Return `false` to cancel. */
    onAddColumns?: (e: AddColumnsEvent<R>) => void | boolean;
    /** Columns are about to be deleted. Return `false` to cancel. */
    onDeleteColumns?: (e: DeleteColumnsEvent<R>) => void | boolean;

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
    /**
     * Height in pixels of the slack below the last row. Default 20.
     *
     * ```js
     * AVGrid.create(el, { rows, whiteSpaceY: 0 });    // no trailing slack at all
     * AVGrid.create(el, { rows, whiteSpaceY: 24, extraElement: footer });   // room for a footer
     * ```
     *
     * The grid reserves a little room past the last row so the final one can scroll clear of the
     * bottom edge. Set it to `0` to take that away, or raise it to make room for an
     * `extraElement` taller than the default — which is the reason it is exposed: a footer
     * that reserved its own space would be an element silently changing the grid's geometry.
     *
     * **There is deliberately no `whiteSpaceX`.** The horizontal slack interacts with
     * `fitToWidth` and percentage column widths through the column-fitting arithmetic, which has
     * already produced one spurious horizontal scrollbar; a second control over it with nothing
     * asking for it is how that comes back. Ask if you need one.
     */
    whiteSpaceY?: number;

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
    /**
     * One host element placed after the last row, inside the scrolling content.
     *
     * ```js
     * const footer = document.createElement("div");
     * footer.textContent = "Load more";
     * const grid = AVGrid.create(el, { rows, extraElement: footer, whiteSpaceY: 24 });
     * grid.setOptions({ extraElement: null });   // and it goes away
     * ```
     *
     * For the one thing a grid needs after its rows that is not a row: a "Load more" footer, an
     * empty-state line, a total. It scrolls with the content, and the grid **parents it and
     * nothing else** — it is never inspected, cleared, restyled beyond the `avg-extra`
     * class, or destroyed. `destroy()` takes it out of the DOM and leaves it intact and
     * reusable, because the host made it.
     *
     * The stylesheet positions it as a full-width band at the bottom of the content. Override
     * with one more class — `.avg-grid .avg-extra.my-chip { left: 4px; right: auto; }`
     * — and set its own colour, padding and height: only the host knows what the grid's
     * background is.
     *
     * Two things worth knowing rather than working around:
     *
     * - It lives in the trailing slack, which is 20 px. **Taller than that overlaps the last
     *   row** — pair it with `whiteSpaceY` to reserve the room, or give it an opaque
     *   background.
     * - **It shares that strip with the add-row button** (`canAddRows`), which sits at the
     *   bottom left. A grid that wants both positions its own element clear of it.
     */
    extraElement?: HTMLElement | null;

    // -----------------------------------------------------------------------
    // Sorting and filtering
    // -----------------------------------------------------------------------

    /** Initial sort. Clicking a header cycles ascending → descending → none. */
    sort?: SortColumn | null;
    /** Free-text filter applied across every column's displayed value. */
    searchString?: string;
    /**
     * Mark the matched words inside the cells. Default `true`.
     *
     * ```js
     * AVGrid.create(el, { rows, searchString: "ann NY" });                          // accent text
     * AVGrid.create(el, { rows, searchString: "ann", highlightSearch: "both" });     // and a tint
     * AVGrid.create(el, { rows, searchString: "ann", highlightSearch: false });      // filter only
     * ```
     *
     * Every word of `searchString` is marked wherever it appears in a cell's *displayed* text,
     * case-insensitively. The colour is `--avg-search-match`, the accent unless a host changes
     * it, and the four values choose how it is applied:
     *
     * | Value | What a match looks like |
     * |---|---|
     * | `true` (default), `"text"` | The letters in the accent colour |
     * | `"background"` | A tint behind the letters, their own colour untouched |
     * | `"both"` | Both |
     * | `false` | Nothing. Rows still filter exactly as before |
     *
     * **Which shape suits a theme depends on its accent, so none is recommended here.** Leave
     * the default unless asked, or unless you have compared them on the actual host: a pale
     * accent can read dimmer than the text around it, where a tint helps; a saturated one turns
     * the tint into a solid block behind text of nearly its own colour, which is worse than the
     * default. `"background"` has a reason of its own — on a column whose text colour already
     * means something, a status or a rating, it marks without overriding it.
     */
    highlightSearch?: boolean | "text" | "background" | "both";
    /**
     * Extra words to mark in the cells, **without filtering any row out**.
     *
     * ```js
     * AVGrid.create(el, { rows, highlightString: "connection refused" });
     * grid.setOptions({ highlightString: term });
     * ```
     *
     * `searchString` does two things — it narrows the rows *and* marks the words that kept
     * them. That is right for a search box the user is typing into. It is wrong when the words
     * came from somewhere this grid is not: a search-results panel that navigated the user
     * here, a URL fragment, a filter applied upstream. There the rows are already the right
     * rows, and hiding the ones that happen not to contain the term is a bug.
     *
     * So: **`searchString` when the user is searching *this* grid, `highlightString` when the
     * words came from outside it.** Both may be set at once, and the marked set is the union of
     * the two. `highlightSearch: false` silences both; `highlightSearch`'s shapes apply to both.
     */
    highlightString?: string;
    /**
     * Applied column filters. The filter UI arrives in task 16; these already filter rows.
     *
     * ```js
     * filters: [{ columnKey: "status", value: ["open", "pending"] }]
     * ```
     *
     * `columnName` and `type` are filled in from the column, and bare values are expanded to
     * `{ value, label }` — so `getFilters()` gives back more than was passed in.
     */
    filters?: Filter[];
    /**
     * Remember the applied filters across reloads, under `Filters-${name}`.
     *
     * ```js
     * AVGrid.create(el, { rows, persistFilters: { name: "orders" } });
     * ```
     *
     * Passing this is the consent to write — nothing is stored otherwise. Stored filters take
     * precedence over `filters` above, which stays the default for a first visit.
     */
    persistFilters?: PersistFiltersOptions;
    /**
     * Supply the options a filter popover offers, instead of the column's distinct values.
     *
     * ```js
     * onGetOptions: (columns, filters, columnKey, search) => fetchValues(columnKey, search)
     * ```
     *
     * May return a promise. Receives the *other* applied filters, so options can cascade.
     */
    onGetOptions?: GetFilterOptions<R>;
    disableSorting?: boolean;
    /** Take the funnel off every header. A column opts out on its own with `filterType: null`. */
    disableFiltering?: boolean;
    /**
     * Show a bar of removable filter chips directly above the grid.
     *
     * ```js
     * AVGrid.create(el, { rows, filterBar: true });
     * ```
     *
     * The bar takes no space until something is filtered. To put it somewhere else — a toolbar,
     * a panel of its own — leave this off and call `AVGrid.createFilterBar(el, { grid })`
     * instead; a grid can have any number of bars, mounted either way.
     *
     * Read at `create()`: the grid wraps itself in a flex column to make room, which is not
     * something to do to a page later. `setOptions({ filterBar: false })` still takes the bar
     * away, and `true` puts it back on a grid that was created with one.
     */
    filterBar?: boolean;

    // -----------------------------------------------------------------------
    // Callbacks
    // -----------------------------------------------------------------------

    onSortChange?: (sort: SortColumn | undefined) => void;
    /**
     * The applied filters changed — from the API, the header funnel or a filter chip alike.
     *
     * Receives the normalized list, which is safe to hand straight back to `setFilters()`:
     * setting the filters the grid already has does nothing, so an echo cannot loop.
     */
    onFiltersChange?: (filters: Filter[]) => void;
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

    /**
     * Extra items at the top of the context menu, above the built-in ones.
     *
     * ```js
     * getContextMenuItems: (e) => [
     *     { label: `Open ${e.rowKey}`, onClick: () => open(e.row) },
     * ]
     * ```
     *
     * Called every time the menu opens, so the items can reflect what was clicked. `e.target`
     * says whether the pointer was over a cell or a header; `e.selectedCount` is free to read,
     * `e.selection` copies the selected rows and so is a getter.
     */
    getContextMenuItems?: (e: GridContextMenuEvent<R>) => MenuItem[];
    /**
     * Draw the context menu yourself, instead of the grid's.
     *
     * ```js
     * onGridContextMenu: (e, items) => myMenu.show(e.x, e.y, items)
     * ```
     *
     * Receives the point in viewport coordinates and the items the grid *would* have shown —
     * already filtered to the ones that apply — so a host menu can offer the same actions
     * without knowing how to build them. Each item's `onClick` does the work; nothing else is
     * needed to make them behave.
     *
     * Providing this suppresses the grid's own menu **and** the browser's. To get the platform
     * menu back instead, use `disableContextMenu`.
     */
    onGridContextMenu?: (e: GridContextMenuEvent<R>, items: MenuItem[]) => void;
    /**
     * Leave right-click alone: no grid menu, and the browser's own menu appears.
     *
     * The grid never shows its menu over an open cell editor either way — a user editing text
     * wants Cut/Paste/Spelling, which only the platform can offer.
     */
    disableContextMenu?: boolean;
    /**
     * Extra class names for a cell, applied on top of the built-in state classes.
     *
     * The grid-wide arm of `Column.cellClass`: use this one when the rule spans columns, and the
     * column's own when it does not.
     *
     * ```js
     * onCellClass: (c) => (c.value === null ? "missing" : undefined)
     * ```
     */
    onCellClass?: (cell: CellContext<R>) => ClassValue;

    /**
     * Extra class names for every cell of a row — how a whole row is highlighted.
     *
     * ```js
     * rowClass: (r) => (r.row.overdue ? "overdue" : undefined)
     * ```
     *
     * There is no row *element* to put a class on: rows are not wrapped, which is what keeps a
     * one-row scroll to twelve node touches. So the class lands on each of the row's cells, and
     * a rule of `.avg-data-cell.overdue { background: … }` colours the row.
     *
     * Called once per cell, not once per row, so keep it a property read rather than a search.
     */
    rowClass?: (row: RowContext<R>) => ClassValue;
}

/** The resolved form: every option that has a default, with its default filled in. */
export interface ResolvedOptions<R = any> extends AVGridOptions<R> {
    columns: Column<R>[];
    getRowKey: (row: R) => string;
    rowHeight: number;
    /** Always present and normalized — `FiltersModel` owns it, `RowsModel` reads it. */
    filters: Filter[];
}
