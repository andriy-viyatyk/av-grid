/**
 * The public entry point.
 *
 * ```js
 * // The minimum call. Columns, header labels, widths and row keys are all inferred.
 * const grid = AVGrid.create("#host", { rows });
 *
 * // Or say exactly what you want.
 * const grid = AVGrid.create(document.getElementById("host"), {
 *     rows,
 *     columns: [
 *         { key: "id",     name: "ID",   width: 60, align: "right" },
 *         { key: "name",   name: "Name", width: 220 },
 *         { key: "active", name: "Active", dataType: "boolean" },
 *         { key: "score",  name: "Score", render: (c) => `<b>${c.value}</b>` },
 *     ],
 *     getRowKey: (row) => String(row.id),
 *     sort: { key: "name", direction: "asc" },
 *     onSortChange: (sort) => console.log(sort),
 * });
 *
 * grid.setRows(nextRows);
 * grid.scrollToRow(50_000);
 * grid.destroy();
 * ```
 *
 * This class is a *façade*: it owns the wiring between the model layer (`src/model/`) and the
 * virtualization engine (`src/render/`), and exposes the small set of methods a host needs.
 * There is deliberately no required call order — every option can be given at `create()` or
 * later through the matching setter, and both paths run the same code.
 *
 * Nothing here is module-level mutable state, so any number of grids coexist on a page. The
 * one shared thing is the injected `<style>`, which is content-identical for every grid and
 * added at most once per document.
 */

import { AVGridModel } from "./model/AVGridModel";
import { RenderGrid } from "./render/RenderGrid";
import type { RenderCellFunc } from "./render/types";
import { injectStyles } from "./styles/av-grid.css";
import { renderDataCell } from "./view/DataCell";
import { renderHeaderCell } from "./view/HeaderCell";
import { GridInteractions } from "./view/GridInteractions";
import { createDefaultEditor } from "./view/DefaultEditFormatter";
import {
    showFilterPopover,
    type ShowFilterPopoverOptions,
} from "./view/FilterPopover";
import { FilterBar } from "./view/FilterBar";
import type { AVGridOptions } from "./options";
import {
    AVGridError,
    resolveContainer,
    resolveOptions,
    validateColumns,
    validateSort,
} from "./validate";
import type {
    Alignment,
    CellEdit,
    CellFocus,
    Column,
    DataType,
    Filter,
    SortColumn,
} from "./types";
import type { GridSelection } from "./model/FocusModel";
import type { CopyMode } from "./model/CopyPasteModel";
import type { AVGridDataChangeEvent } from "./model/AVGridData";
import type { RowAlign } from "./render/types";

/** Rendered outside the viewport. Four rows absorbs a fast scroll; one column is plenty. */
const DEFAULT_OVERSCAN_ROW = 4;
const DEFAULT_OVERSCAN_COLUMN = 1;

/** Used when the container has no height of its own. Roughly 16 rows at the default height. */
const FALLBACK_HEIGHT = "400px";

/**
 * Pick a definite height for the root.
 *
 * A virtualized grid has to measure its viewport to know what to draw, so its own height can
 * never depend on its content — that is circular, and the grid renders nothing. Filling the
 * container is right whenever the container has a height; when it does not (a bare `<div>` in
 * normal flow, which is what the minimum call is usually given) percentages resolve to zero
 * and the grid would be invisible. A pixel fallback is far better than a blank box, and the
 * host overrides it by sizing the container or passing `growToHeight`.
 */
function resolveHeight(host: HTMLElement): string {
    return host.clientHeight > 0 ? "100%" : FALLBACK_HEIGHT;
}

/**
 * One column, as the grid currently has it — not the `Column` the host wrote.
 *
 * The declared column carries functions (`render`, `validate`, `options`) and is the live
 * array the grid sorts and resizes; neither belongs in something meant to be logged. This is
 * the flattened, serializable answer, with the *current* width rather than the declared one.
 * `getColumns()` returns the real thing.
 */
export interface ColumnStateSnapshot {
    key: string;
    name: string;
    /** The width the grid is drawing it at, after any resize. */
    width: number | `${number}%`;
    dataType?: DataType;
    align?: Alignment;
    /** Set when this is the sort column. */
    sorted?: "asc" | "desc";
    filtered: boolean;
    /** Would a double-click open an editor here? `editable` and `readonly` together. */
    editable: boolean;
    /** A non-data column — the checkbox column is the one the library adds. */
    isStatusColumn?: boolean;
    /** A custom cell renderer is installed. Worth knowing when a cell shows the unexpected. */
    hasRender: boolean;
    /** The column has `options`, so it edits through the dropdown rather than a text box. */
    hasOptions: boolean;
    /** The column supplies its own editor, so neither built-in one opens here. */
    hasEditor: boolean;
    /**
     * Which filter body the funnel opens: `"options"` for the checklist, the definition's `name`
     * for a column with its own `filter`, `null` for a column that opted out.
     */
    filterType: string | null;
}

/**
 * What the engine believes is on screen. The first question worth asking when a grid renders
 * blank or shows a band of nothing, and there is nowhere else to read it.
 *
 * Row and column indices are inclusive and count *data* rows, so `firstRow` is 0 at the top
 * — the header is not in here. Both are `-1` when nothing is rendered at all.
 *
 * `firstColumn` is the first *scrolling* column, so a grid with a checkbox column reports 1
 * rather than 0: columns pinned to the left are always on screen and are not part of the
 * window that scrolling moves.
 */
export interface ViewportSnapshot {
    firstRow: number;
    lastRow: number;
    firstColumn: number;
    lastColumn: number;
    scrollTop: number;
    scrollLeft: number;
    /** The measured size of the grid root. `0` here is why a grid renders blank. */
    width: number;
    height: number;
}

/**
 * Everything the grid thinks is going on, in one plain object.
 *
 * Every field survives `JSON.stringify` — no functions, no row objects, no DOM — because the
 * point of this is `console.log(grid.getState())` mid-debug, and a snapshot that printed
 * 100,000 rows would answer nothing. Payloads stay behind the accessor that returns them:
 * `getSelected()`, `getVisibleRows()`, `getColumns()`.
 */
export interface AVGridStateSnapshot<R = any> {
    /** The library version this grid was built by — the same string as `AVGrid.version`. */
    version: string;
    /** The `name` option, if one was given. Which grid this is, when a page has several. */
    name?: string;
    destroyed: boolean;
    /** Rows currently displayed — after filtering and sorting. */
    rowCount: number;
    /** Rows given to the grid, before filtering. */
    sourceRowCount: number;
    /** Visible columns, including the checkbox column when there is one. */
    columnCount: number;
    columns: ColumnStateSnapshot[];
    sort?: SortColumn;
    searchString?: string;
    /** The applied column filters, normalized. Empty when nothing is filtered. */
    filters: Filter[];
    rowHeight: number;
    /** The focused cell and its range selection. Keys and indices, not rows. */
    focus?: CellFocus<R>;
    /**
     * How many rows are checkbox-selected, and whether that is all of them.
     *
     * The count rather than the keys deliberately: this snapshot is meant to be logged, and
     * 100,000 keys in a console answers nothing. `getSelected()` returns them.
     */
    selectedCount: number;
    allSelected: boolean;
    /** The cell being edited, if any. Present only while an editor is open. */
    editing?: { rowKey: string; columnKey: string; changed: boolean };
    viewport: ViewportSnapshot;
}

export class AVGrid<R = any> {
    /** Bumped on release. Also exported from the package root. */
    static readonly version = "2.0.0";

    readonly model: AVGridModel<R>;
    readonly render: RenderGrid;

    private readonly interactions: GridInteractions<R>;
    private readonly dataSubscription: { unsubscribe: () => void };
    private destroyed = false;
    /** Warn once per grid, not once per stale call — a dead timer can fire a lot. */
    private warnedAfterDestroy = false;
    /** The deferred re-measure the constructor schedules when the host is not laid out yet. */
    private sizeCheckRaf?: number;

    /** The two add affordances, present only while the matching option is on. */
    private addRowButton?: HTMLButtonElement;
    private addColumnButton?: HTMLButtonElement;

    /** The flex column holding the bar and the grid — present only with `filterBar`. */
    private readonly wrapper?: HTMLDivElement;
    private filterBar?: FilterBar<R>;

    /**
     * Create a grid inside `container`.
     *
     * `container` may be an element or a CSS selector. `options.rows` is the only required
     * option; everything else has a default or is inferred from the rows.
     */
    static create<R = any>(
        container: HTMLElement | string,
        options: AVGridOptions<R>,
    ): AVGrid<R> {
        return new AVGrid<R>(container, options);
    }

    /**
     * Mount a filter bar for an existing grid, wherever you want it.
     *
     * ```js
     * const grid = AVGrid.create("#grid", { rows });
     * const bar = AVGrid.createFilterBar("#toolbar", { grid });
     * bar.destroy();   // or leave it — grid.destroy() does not own this one
     * ```
     *
     * The alternative to `filterBar: true`, which puts one directly above the grid. Both make
     * the same object, and a grid can have any number of bars watching it — they all show the
     * same filters and any of them can edit them.
     */
    static createFilterBar<R = any>(
        container: HTMLElement | string,
        options: { grid: AVGrid<R>; className?: string; name?: string },
    ): FilterBar<R> {
        const host = resolveContainer(container);
        if (!options?.grid?.model) {
            throw new AVGridError(
                `AVGrid.createFilterBar(container, { grid }): \`grid\` must be the grid this ` +
                    `bar filters — what AVGrid.create() returned.`,
            );
        }
        if (options.grid.model.options.injectStyles !== false) {
            injectStyles(host.ownerDocument);
        }
        const bar = new FilterBar<R>({
            model: options.grid.model,
            className: options.className,
            name: options.name,
        });
        host.appendChild(bar.element);
        return bar;
    }

    private constructor(container: HTMLElement | string, options: AVGridOptions<R>) {
        const host = resolveContainer(container);
        const resolved = resolveOptions<R>(options);

        if (resolved.injectStyles !== false) injectStyles(host.ownerDocument);

        this.model = new AVGridModel<R>(resolved);

        // With a bar, the grid renders into a flex column instead of straight into the host, so
        // that the bar can take a strip off the top and the grid the rest. The wrapper carries
        // the definite height the engine needs; the grid root then takes `auto` and lets the
        // flex line size it, because `100%` would resolve against the wrapper and overflow by
        // exactly the height of the bar.
        if (resolved.filterBar) {
            this.wrapper = host.ownerDocument.createElement("div");
            this.wrapper.className = "avg-grid-wrap";
            if (!resolved.growToHeight) {
                this.wrapper.style.height = resolveHeight(host);
            }
            host.appendChild(this.wrapper);
        }
        const renderCell: RenderCellFunc = (p) =>
            p.row === 0
                ? renderHeaderCell(this.model, p)
                : renderDataCell(this.model, p);

        this.render = new RenderGrid(this.wrapper ?? host, {
            name: resolved.name,
            className: ["avg-grid", resolved.className].filter(Boolean).join(" "),
            // Functions, not numbers: the counts change with every sort, filter and
            // `setRows`, and reading them lazily means none of those has to re-set an option.
            rowCount: () => this.model.models.rows.rowCount,
            columnCount: () => this.model.models.columns.columnCount,
            columnWidth: this.model.models.columns.getColumnWidth,
            rowHeight: resolved.rowHeight,
            renderCell,
            stickyTop: 1,
            stickyLeft: this.model.data.lastIsStatusIndex + 1,
            overscanRow: resolved.overscanRow ?? DEFAULT_OVERSCAN_ROW,
            overscanColumn: resolved.overscanColumn ?? DEFAULT_OVERSCAN_COLUMN,
            fitToWidth: resolved.fitToWidth,
            height: resolved.growToHeight
                ? undefined
                : this.wrapper
                  ? "auto"
                  : resolveHeight(host),
            growToHeight: resolved.growToHeight,
            growToWidth: resolved.growToWidth,
        });

        if (resolved.cellBorders === false) {
            this.render.root.setAttribute("data-cell-borders", "off");
        }

        this.syncSearchHighlight();

        // The container may simply not have been laid out yet when `create()` was called —
        // a board or a framework mounts its DOM and constructs the grid in the same tick. In
        // that case the fallback height was chosen against a measurement of zero; re-check
        // once layout has happened and fill the container after all.
        if (!resolved.growToHeight && host.clientHeight === 0) {
            this.sizeCheckRaf = requestAnimationFrame(() => {
                this.sizeCheckRaf = undefined;
                if (this.destroyed || host.clientHeight === 0) return;
                // The wrapper when there is one: it is what has the definite height, and the
                // grid inside it is sized by the flex line rather than by its own style.
                (this.wrapper ?? this.render.root).style.height = "100%";
                this.render.model.checkSize();
            });
        }

        if (resolved.filterBar && this.wrapper) {
            this.filterBar = new FilterBar<R>({ model: this.model });
            this.wrapper.insertBefore(this.filterBar.element, this.render.root);
        }

        // The model layer opens editors without importing the view layer; this is the seam.
        this.model.models.editing.createEditor = createDefaultEditor;

        this.model.setRenderModel(this.render.model);
        this.interactions = new GridInteractions<R>(this.model, this.render);

        this.dataSubscription = this.model.data.onChange.subscribe(this.onDataChange);
        this.syncAffordances();

        // The models ran their first pass in the AVGridModel constructor, before the render
        // model existed to be told about it. Paint what they produced.
        this.model.update({ all: true });
    }

    // -----------------------------------------------------------------------
    // Elements
    // -----------------------------------------------------------------------

    /** The grid's root element. Style it, or read `data-*` off its cells in a test. */
    get element(): HTMLElement {
        return this.render.root;
    }

    /**
     * The bar `filterBar: true` created, if there is one.
     *
     * Bars from `AVGrid.createFilterBar()` are not here — the caller holds those, and owns
     * destroying them.
     */
    getFilterBar(): FilterBar<R> | undefined {
        return this.filterBar;
    }

    // -----------------------------------------------------------------------
    // Data
    // -----------------------------------------------------------------------

    getRows(): readonly R[] {
        return this.model.options.rows;
    }

    /** The rows actually on screen — after filtering and sorting. */
    getVisibleRows(): readonly R[] {
        return this.model.data.rows;
    }

    /**
     * Replace the rows. Keeps the scroll position and repaints without a teardown; the
     * engine reuses every cell element that is still on screen.
     */
    setRows(rows: readonly R[]): void {
        if (!Array.isArray(rows)) {
            throw new AVGridError(
                `grid.setRows(rows): rows must be an array. Pass [] to empty the grid.`,
            );
        }
        if (!this.alive("grid.setRows()")) return;
        this.model.setRows(rows);
    }

    getColumns(): Column<R>[] {
        return this.model.options.columns;
    }

    setColumns(columns: Column<R>[]): void {
        if (!this.alive("grid.setColumns()")) return;
        this.model.setColumns(
            validateColumns<R>(columns, this.model.options.rows, this.knownColumnKeys()),
        );
    }

    /** The keys the grid already has — columns it has accepted once stay acceptable. */
    private knownColumnKeys(): ReadonlySet<string> {
        return new Set(this.model.options.columns.map((c) => String(c.key)));
    }

    // -----------------------------------------------------------------------
    // Adding and deleting rows and columns
    // -----------------------------------------------------------------------

    /**
     * Insert rows, at an index into the *displayed* rows. Omit the index to append.
     *
     * ```js
     * grid.addRows([{ id: 9, name: "Ada" }]);      // at the end
     * grid.addRows([{ id: 9, name: "Ada" }], 0);   // at the top
     * ```
     *
     * Returns the rows that went in — empty when `onAddRows` refused them. On a sorted or
     * filtered grid the row order is held still, so a new row appears where it was put instead
     * of sorting away or failing the filter; the next sort change releases it.
     *
     * Unlike the user-facing affordances, this does not need `canAddRows`.
     */
    addRows(rows: R[], index?: number): R[] {
        if (!Array.isArray(rows)) {
            throw new AVGridError(
                `grid.addRows(rows, index?): rows must be an array of row objects.`,
            );
        }
        if (!this.alive("grid.addRows()")) return [];
        return this.model.models.structure.addRows(rows, index, true);
    }

    /** Add one blank row, built by `options.newRow`, and focus it. */
    addRow(index?: number): R | undefined {
        if (!this.alive("grid.addRow()")) return undefined;
        return this.model.models.structure.addBlankRows(1, index)[0];
    }

    /** Delete rows by key — the value `getRowKey` returns. Returns whether anything went. */
    deleteRows(rowKeys: readonly string[]): boolean {
        if (!Array.isArray(rowKeys)) {
            throw new AVGridError(
                `grid.deleteRows(rowKeys): rowKeys must be an array of row keys — ` +
                    `what getRowKey returns, not row objects or indices.`,
            );
        }
        if (!this.alive("grid.deleteRows()")) return false;
        return this.model.models.structure.deleteRows([...rowKeys], true);
    }

    /** Delete the rows the *cell* selection covers. What ctrl+Delete does. */
    deleteSelectedRows(): boolean {
        if (!this.alive("grid.deleteSelectedRows()")) return false;
        return this.model.models.structure.deleteSelectedRows();
    }

    /** Insert columns, at an index into `getColumns()`. Omit the index to append. */
    addColumns(columns: Column<R>[], index?: number): Column<R>[] {
        if (!this.alive("grid.addColumns()")) return [];
        return this.model.models.structure.addColumns(
            validateColumns<R>(
                columns,
                this.model.options.rows,
                new Set(columns.map((c) => String(c?.key))),
            ),
            index,
        );
    }

    /** Add one blank column, built by `options.newColumn`. */
    addColumn(index?: number): Column<R> | undefined {
        if (!this.alive("grid.addColumn()")) return undefined;
        return this.model.models.structure.addBlankColumns(1, index)[0];
    }

    deleteColumns(columnKeys: readonly string[]): boolean {
        if (!this.alive("grid.deleteColumns()")) return false;
        return this.model.models.structure.deleteColumns([...columnKeys]);
    }

    // -----------------------------------------------------------------------
    // Sorting and filtering
    // -----------------------------------------------------------------------

    getSort(): SortColumn | undefined {
        return this.model.state.get().sort;
    }

    /** Set or clear the sort. Pass `undefined` for unsorted. */
    setSort(sort: SortColumn | undefined): void {
        if (!this.alive("grid.setSort()")) return;
        this.model.setSort(
            validateSort(sort ?? undefined, this.model.data.columns),
        );
    }

    getSearchString(): string | undefined {
        return this.model.options.searchString;
    }

    setSearchString(searchString: string | undefined): void {
        if (!this.alive("grid.setSearchString()")) return;
        this.model.setSearchString(searchString);
    }

    /**
     * The applied column filters, normalized — `columnName` and `type` filled in from the
     * column, and each value an `{ value, label }` option.
     *
     * Safe to store and hand back to `setFilters()` later; that is what `persistFilters` does
     * for you when you would rather not.
     */
    getFilters(): Filter[] {
        return this.model.models.filters.getFilters();
    }

    /**
     * Replace every filter. `[]` or `undefined` clears them.
     *
     * ```js
     * grid.setFilters([{ columnKey: "status", value: ["open", "pending"] }]);
     * ```
     *
     * Setting the filters the grid already has does nothing at all, so echoing
     * `onFiltersChange` straight back cannot loop.
     */
    setFilters(filters: readonly Filter[] | undefined): void {
        if (!this.alive("grid.setFilters()")) return;
        this.model.setFilters(filters);
    }

    /**
     * Add or replace one column's filter — or remove it, when the value is empty.
     *
     * ```js
     * grid.applyFilter({ columnKey: "status", value: ["open"] });   // filter to open rows
     * grid.applyFilter({ columnKey: "status" });                    // and back again
     * ```
     *
     * One call for both because that is what the filter popover needs: applying an empty
     * selection means "no filter", not "no rows".
     */
    applyFilter(filter: Filter): void {
        if (!this.alive("grid.applyFilter()")) return;
        this.model.models.filters.applyFilter(filter);
    }

    removeFilter(columnKey: string): void {
        if (!this.alive("grid.removeFilter()")) return;
        this.model.models.filters.removeFilter(columnKey);
    }

    clearFilters(): void {
        if (!this.alive("grid.clearFilters()")) return;
        this.model.models.filters.clearFilters();
    }

    /**
     * Open the filter popover for a column, and resolve when it closes.
     *
     * ```js
     * const applied = await grid.showFilterPopover("status");   // undefined if dismissed
     * ```
     *
     * The same call the header funnel makes. Anchors to that funnel by default; pass an
     * `anchor` — an element or a `{ x, y }` point — to open it from a chip, a toolbar button or
     * a context menu instead. The filter is already applied by the time this resolves.
     */
    showFilterPopover(
        columnKey: string,
        options?: ShowFilterPopoverOptions,
    ): Promise<Filter | undefined> {
        if (!this.alive("grid.showFilterPopover()")) return Promise.resolve(undefined);
        return showFilterPopover(this.model, columnKey, options);
    }

    /** Is a filter applied to this column? What the header's funnel indicator asks. */
    isFiltered(columnKey: string): boolean {
        return this.model.models.filters.isFiltered(columnKey);
    }

    // -----------------------------------------------------------------------
    // Row selection
    // -----------------------------------------------------------------------

    /**
     * The selected rows, by row key.
     *
     * This is the checkbox selection, and it is a different thing from the *cell* range in
     * `getSelection()` — one is a set of rows a host acts on, the other a rectangle that copy
     * and paste act on. A grid can have both at once.
     *
     * ```js
     * AVGrid.create(el, { rows, selectColumn: true, onSelectionChange: (keys) => … });
     * grid.setSelected(["3", "7"]);
     * grid.getSelectedRows().forEach(send);
     * ```
     */
    getSelected(): string[] {
        return this.model.models.selected.getSelectedKeys();
    }

    /** The selected row objects, in display order. O(rows) — call it when you need them. */
    getSelectedRows(): R[] {
        return this.model.models.selected.getSelectedRows();
    }

    /** Replace the selection. Accepts an array or a `Set`; `undefined` clears it. */
    setSelected(selected: Iterable<string> | undefined): void {
        if (!this.alive("grid.setSelected()")) return;
        this.model.models.selected.setSelected(selected);
    }

    isSelected(rowKey: string): boolean {
        return this.model.models.selected.isSelected(rowKey);
    }

    toggleSelected(rowKey: string): void {
        if (!this.alive("grid.toggleSelected()")) return;
        this.model.models.selected.toggleSelected(rowKey);
    }

    /** Select every *displayed* row — so on a filtered grid, what the user can see. */
    selectAll(): void {
        if (!this.alive("grid.selectAll()")) return;
        this.model.models.selected.selectAll();
    }

    clearSelected(): void {
        if (!this.alive("grid.clearSelected()")) return;
        this.model.models.selected.clearSelected();
    }

    // -----------------------------------------------------------------------
    // Editing
    // -----------------------------------------------------------------------

    /**
     * Open the editor on a cell, by index into the *displayed* rows.
     *
     * ```js
     * AVGrid.create(el, { rows, editable: true, onEdit: (e) => save(e.rowKey, e.columnKey, e.value) });
     * grid.startEdit(0, 1);
     * ```
     *
     * Does nothing when the grid is not `editable`, the column is `readonly`, or the column is
     * a boolean — booleans toggle instead, through `Space`, `Enter` or a double-click.
     */
    startEdit(rowIndex: number, colIndex: number): void {
        if (!this.alive("grid.startEdit()")) return;
        this.model.models.editing.openEdit(rowIndex, colIndex);
    }

    /** Is an editor open? */
    isEditing(): boolean {
        return this.model.models.editing.isEditing;
    }

    /** The open edit — its cell, and the value the editor is holding. */
    getEdit(): CellEdit<R> | undefined {
        return this.model.models.editing.edit;
    }

    /** Write the editor's value and close it. */
    commitEdit(): void {
        if (!this.alive("grid.commitEdit()")) return;
        this.model.models.editing.commitEdit();
    }

    /** Close the editor, discarding what was typed. */
    cancelEdit(): void {
        if (!this.alive("grid.cancelEdit()")) return;
        this.model.models.editing.cancelEdit();
    }

    /**
     * Set one cell's value as if the user had edited it — validation, `onEdit` and the repaint
     * all happen. Returns whether anything was written.
     */
    setCellValue(rowIndex: number, colIndex: number, value: any): boolean {
        if (!this.alive("grid.setCellValue()")) return false;
        return this.model.models.editing.editCellAt(rowIndex, colIndex, value);
    }

    // -----------------------------------------------------------------------
    // Clipboard
    // -----------------------------------------------------------------------

    /**
     * Copy the selected range to the clipboard. Resolves to whether it got there.
     *
     * ```js
     * await grid.copySelection();                   // tab-separated — pastes into Excel as cells
     * await grid.copySelection("copyWithHeaders");  // with the column names on the first line
     * await grid.copySelection("copyAsJson");       // an array of objects
     * await grid.copySelection("copyAsHtmlTable");  // a formatted table, plus TSV as plain text
     * ```
     *
     * The user pressing **ctrl+C** does not come through here — that goes through the browser's
     * own copy event, which needs no permission. This is the programmatic path, and it can be
     * refused: `navigator.clipboard` requires a secure context, and a page that is neither
     * `https:` nor `localhost` falls back to `execCommand` and may still fail.
     */
    copySelection(mode: CopyMode = "copy"): Promise<boolean> {
        if (!this.alive("grid.copySelection()")) return Promise.resolve(false);
        return this.model.models.copyPaste.copySelection(mode);
    }

    /** The selected range as text, without going near the clipboard. */
    getSelectionText(mode: CopyMode = "copy"): string {
        return this.model.models.copyPaste.selectionText(mode);
    }

    /**
     * Read the clipboard and paste it into the selection.
     *
     * Reading the clipboard is permission-gated — Chrome prompts, Firefox refuses — so this
     * resolves `false` more often than you would like. **ctrl+V** has no such problem, and
     * neither does `pasteText`.
     */
    paste(): Promise<boolean> {
        if (!this.alive("grid.paste()")) return Promise.resolve(false);
        return this.model.models.copyPaste.paste();
    }

    /**
     * Paste tab-separated text into the selection, with no clipboard involved. Returns whether
     * anything changed.
     *
     * ```js
     * grid.focusCell(0, 1);
     * grid.pasteText("Ada\t36\nGrace\t45");   // one selected cell expands to fit
     * ```
     *
     * A single selected cell expands to fit the text, clamped to the rows and columns that
     * exist; a larger selection is filled by repeating the text across it. Every cell goes
     * through the same validation and `onEdit` call that typing does.
     */
    pasteText(text: string): boolean {
        if (!this.alive("grid.pasteText()")) return false;
        return this.model.models.copyPaste.pasteText(text);
    }

    /** Copy the selection, then clear it — ctrl+X. Clears nothing unless the grid is editable. */
    cut(): Promise<boolean> {
        if (!this.alive("grid.cut()")) return Promise.resolve(false);
        return this.model.models.copyPaste.cut();
    }

    // -----------------------------------------------------------------------
    // Focus and range selection
    // -----------------------------------------------------------------------

    /**
     * The focused cell and the range anchored on it, or `undefined` when nothing is focused.
     *
     * ```js
     * grid.focusCell(10, 2);            // row index, column index
     * grid.selectRange(10, 0, 20, 3);   // rowStart, colStart, rowEnd, colEnd
     * grid.getSelection().rows;         // the selected row objects
     * ```
     */
    getFocus(): CellFocus<R> | undefined {
        return this.model.models.focus.focus;
    }

    /** Set the focus directly. Indices are optional — keys alone are enough. */
    setFocus(focus: CellFocus<R> | undefined): void {
        if (!this.alive("grid.setFocus()")) return;
        this.model.models.focus.setFocus(focus);
    }

    clearFocus(): void {
        if (!this.alive("grid.clearFocus()")) return;
        this.model.models.focus.clearFocus();
    }

    /** Focus one cell by index into the *displayed* rows, discarding any selection. */
    focusCell(rowIndex: number, colIndex: number, withScroll = false): void {
        if (!this.alive("grid.focusCell()")) return;
        this.model.models.focus.focusCell(rowIndex, colIndex, withScroll);
    }

    /** Select a rectangle of cells. The focus lands on the end corner, as after a drag. */
    selectRange(
        startRowIndex: number,
        startColIndex: number,
        endRowIndex: number,
        endColIndex: number,
    ): void {
        if (!this.alive("grid.selectRange()")) return;
        this.model.models.focus.selectRange(
            startRowIndex,
            startColIndex,
            endRowIndex,
            endColIndex,
        );
    }

    /** The selected rows and columns, with their index ranges. `undefined` when unfocused. */
    getSelection(): GridSelection<R> | undefined {
        return this.model.models.focus.getGridSelection();
    }

    /** Give the grid keyboard focus, so arrow keys reach it without a click first. */
    focus(): void {
        if (!this.alive("grid.focus()")) return;
        this.model.focusGrid();
    }

    // -----------------------------------------------------------------------
    // Options
    // -----------------------------------------------------------------------

    /**
     * Change any option after creation. Equivalent to having passed it to `create()` —
     * validation and defaults are identical, so nothing behaves differently for having been
     * set late.
     */
    setOptions(options: Partial<AVGridOptions<R>>): void {
        if (!this.alive("grid.setOptions()")) return;

        // Order matters: columns first, because row filtering matches against them.
        if ("columns" in options && options.columns) this.setColumns(options.columns);
        if ("rows" in options && options.rows) this.setRows(options.rows);
        if ("searchString" in options) this.setSearchString(options.searchString);
        if ("filters" in options) this.setFilters(options.filters);
        if ("sort" in options) this.setSort(options.sort ?? undefined);

        // Everything else is a straight assignment plus, where the engine cares, a re-set.
        const rest: Partial<AVGridOptions<R>> = { ...options };
        delete rest.columns;
        delete rest.rows;
        delete rest.searchString;
        delete rest.filters;
        delete rest.sort;
        delete rest.selected;
        Object.assign(this.model.options, rest);

        // Showing or hiding the checkbox column changes what the render layer sees, which
        // `updateColumnsData` — not `setColumns` — is what produces.
        if ("selectColumn" in options) {
            this.model.models.columns.updateColumnsData(this.model.options.columns);
        }
        if ("filterBar" in options) this.syncFilterBar();
        // Turning highlighting on or off changes what is painted without changing which rows
        // survive, so it is the one thing here that the row pipeline would not have picked up.
        // Switching between the *shapes* needs neither — the attribute alone does it.
        if ("highlightSearch" in options) {
            this.syncSearchHighlight();
            this.model.syncSearchWords();
            this.model.requestRepaint();
        }
        if ("selected" in options) this.setSelected(options.selected);
        // An editor left open on a grid that is no longer editable would commit on its next
        // blur, writing a value the host has just said it does not accept.
        if (options.editable === false) this.model.models.editing.cancelEdit();

        if (rest.cellBorders !== undefined) {
            if (rest.cellBorders === false) {
                this.render.root.setAttribute("data-cell-borders", "off");
            } else {
                this.render.root.removeAttribute("data-cell-borders");
            }
        }
        if (rest.className !== undefined) {
            this.render.setOptions({
                className: ["avg-grid", rest.className].filter(Boolean).join(" "),
            });
        }
        if (rest.rowHeight !== undefined) {
            this.render.setOptions({ rowHeight: rest.rowHeight });
        }
        if (rest.fitToWidth !== undefined) {
            this.render.setOptions({ fitToWidth: rest.fitToWidth });
        }
        if (rest.overscanRow !== undefined) {
            this.render.setOptions({ overscanRow: rest.overscanRow });
        }
        if (rest.overscanColumn !== undefined) {
            this.render.setOptions({ overscanColumn: rest.overscanColumn });
        }

        this.syncAffordances();
        this.refresh();
    }

    // -----------------------------------------------------------------------
    // Introspection
    // -----------------------------------------------------------------------

    /** Has `destroy()` been called? */
    isDestroyed(): boolean {
        return this.destroyed;
    }

    /**
     * A plain, serializable answer to "what does the grid think is going on".
     *
     * ```js
     * console.log(grid.getState());       // the whole picture, in one line
     * JSON.stringify(grid.getState());    // and it survives this
     * ```
     *
     * Safe to call on a destroyed grid: it answers `destroyed: true` and reports the last
     * state the grid held, which is usually what a post-mortem wants.
     */
    getState(): AVGridStateSnapshot<R> {
        const edit = this.model.models.editing.edit;
        const sort = this.model.state.get().sort;
        const { getColumnWidth } = this.model.models.columns;
        const editable = Boolean(this.model.options.editable);

        return {
            version: AVGrid.version,
            name: this.model.options.name,
            destroyed: this.destroyed,
            rowCount: this.model.data.rows.length,
            sourceRowCount: this.model.options.rows.length,
            columnCount: this.model.data.columns.length,
            columns: this.model.data.columns.map((column, index) => {
                const key = String(column.key);
                return {
                    key,
                    name: column.name ?? key,
                    width: getColumnWidth(index),
                    dataType: column.dataType,
                    align: column.align,
                    sorted: sort?.key === key ? sort.direction : undefined,
                    filtered: this.model.models.filters.isFiltered(key),
                    editable:
                        editable && !column.readonly && !column.isStatusColumn,
                    isStatusColumn: column.isStatusColumn,
                    hasRender: Boolean(column.render),
                    hasOptions: Boolean(column.options),
                    hasEditor: Boolean(column.editor),
                    filterType: column.filterType === null
                        ? null
                        : (column.filter?.name ?? column.filterType ?? "options"),
                };
            }),
            sort,
            searchString: this.model.options.searchString,
            filters: this.model.models.filters.getFilters(),
            rowHeight: this.model.options.rowHeight,
            focus: this.model.models.focus.focus,
            selectedCount: this.model.models.selected.count,
            allSelected: this.model.models.selected.allSelected,
            editing: edit
                ? {
                      rowKey: edit.rowKey,
                      columnKey: String(edit.columnKey),
                      changed: Boolean(edit.changed),
                  }
                : undefined,
            viewport: this.viewportState(),
        };
    }

    private viewportState(): ViewportSnapshot {
        const { visible } = this.render.model.renderInfo.current;
        const { offset, size } = this.render.model;
        const rowCount = this.model.data.rows.length;
        // `visible` is in grid rows, where 0 is the header, and is inclusive at both ends.
        // An empty grid leaves it all-zero, which converts to a first row of -1 — right by
        // accident, but say so rather than leave it to arithmetic.
        const firstRow = rowCount ? Math.max(0, visible.top - 1) : -1;
        return {
            firstRow,
            lastRow: rowCount ? Math.min(rowCount - 1, visible.bottom - 1) : -1,
            firstColumn: visible.left,
            lastColumn: visible.right,
            scrollTop: offset.y,
            scrollLeft: offset.x,
            width: size.width ?? 0,
            height: size.height ?? 0,
        };
    }

    // -----------------------------------------------------------------------
    // Painting and scrolling
    // -----------------------------------------------------------------------

    /** Repaint every visible cell. The escape hatch for data mutated in place. */
    refresh(): void {
        if (!this.alive("grid.refresh()")) return;
        this.model.update({ all: true });
    }

    scrollToRow(row: number, align: RowAlign = "nearest"): Promise<void> {
        if (!this.alive("grid.scrollToRow()")) return Promise.resolve();
        // Callers count data rows; the engine counts grid rows, where 0 is the header.
        return this.render.model.scrollToRow(
            this.model.dataRowToGridRow(row),
            align,
        );
    }

    scrollToCell(row: number, col: number): Promise<void> {
        if (!this.alive("grid.scrollToCell()")) return Promise.resolve();
        return this.render.model.scrollTo(this.model.dataRowToGridRow(row), col);
    }

    // -----------------------------------------------------------------------
    // Teardown
    // -----------------------------------------------------------------------

    /**
     * Release everything: listeners, observers, pooled DOM, timers. Safe to call twice.
     *
     * ```js
     * grid.destroy();          // the host element is empty again
     * grid.isDestroyed();      // true
     * ```
     *
     * Nothing outside the grid holds a reference to it afterwards — no module-level registry,
     * no document listener, no pending frame — so the whole object graph is collectable as
     * one. The one thing left behind is the injected `<style>`, which is shared by every grid
     * in the document and content-identical, so removing it would break the others.
     *
     * Anything that would *change* the grid after this warns once and does nothing, rather
     * than throwing: a stale callback firing during a framework's unmount should not take the
     * unmount with it. Reads still answer — `getState()` and the getters report the last
     * state the grid held, which is usually what a post-mortem wants.
     */
    destroy(): void {
        if (this.destroyed) return;
        // Before the flag: an open editor commits on blur, and tearing the DOM down under it
        // would fire that blur with nothing left to write into.
        this.model.models.editing.cancelEdit();
        // A popover lives on `document.body`, outside everything `render.destroy()` reaches, so
        // it would outlive the grid it filters.
        this.model.flags.filterPopover?.close();
        this.model.flags.contextMenu?.close();
        this.destroyed = true;

        if (this.sizeCheckRaf !== undefined) {
            cancelAnimationFrame(this.sizeCheckRaf);
            this.sizeCheckRaf = undefined;
        }

        this.dataSubscription.unsubscribe();
        this.interactions.destroy();
        this.model.setRenderModel(null);
        this.render.destroy();
        this.filterBar?.destroy();
        this.filterBar = undefined;
        this.wrapper?.remove();
        this.addRowButton?.remove();
        this.addRowButton = undefined;
        this.addColumnButton?.remove();
        this.addColumnButton = undefined;
        this.model.dispose();
    }

    /**
     * Guard for anything that changes the grid. `false` means "destroyed — do nothing".
     *
     * The model already ignores updates once disposed, so an unguarded call is harmless; what
     * it is not is *visible*. This makes the no-op say so, once.
     */
    private alive(method: string): boolean {
        if (!this.destroyed) return true;
        if (!this.warnedAfterDestroy) {
            this.warnedAfterDestroy = true;
            console.warn(
                `av-grid: ${method} was called on a grid that has been destroyed. ` +
                    `It did nothing. Create a new grid with AVGrid.create() — a destroyed ` +
                    `one cannot be revived.`,
            );
        }
        return false;
    }

    // -----------------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------------

    /**
     * The status columns are pinned left, and how many there are is derived from the column
     * set — so a column change can move the sticky boundary. This is the one engine option
     * the models cannot express as a lazily-read function, because the engine compares it in
     * `inputChanged()`.
     */
    /**
     * Create or remove the add-row and add-column buttons to match the options.
     *
     * They are overlays rather than cells — `RenderGrid.addOverlay` explains why that is safe —
     * and they carry no listener of their own: the click is resolved from the root like every
     * other, so there is one teardown and no element with a handler bound to it.
     */
    /**
     * Add or remove the built-in filter bar to match the option.
     *
     * Only inside the wrapper the constructor made: turning the bar *on* later would mean
     * re-parenting a live grid — moving a scrolled, focused, possibly mid-edit element into a
     * new box — to save a call to `AVGrid.createFilterBar()`, which does the same job without
     * touching the grid at all.
     */
    /**
     * Put the chosen highlight shape on the root, where the stylesheet reads it.
     *
     * The default — colour alone — is the bare rule, so it is the *absence* of the attribute.
     * A shape is a presentation choice with no bearing on which cells match, so it belongs on
     * one element rather than in the class name of every mark inside every cell.
     */
    private syncSearchHighlight(): void {
        const mode = this.model.options.highlightSearch;
        if (mode === "background" || mode === "both") {
            this.render.root.setAttribute("data-search-highlight", mode);
        } else {
            this.render.root.removeAttribute("data-search-highlight");
        }
    }

    private syncFilterBar(): void {
        const wanted = Boolean(this.model.options.filterBar);
        if (wanted === Boolean(this.filterBar)) return;

        if (!wanted) {
            this.filterBar?.destroy();
            this.filterBar = undefined;
            return;
        }
        if (!this.wrapper) {
            console.warn(
                `av-grid: setOptions({ filterBar: true }) — this grid was created without one, ` +
                    `so there is nowhere above it to put a bar. Pass filterBar at create(), or ` +
                    `mount one yourself with AVGrid.createFilterBar(el, { grid }).`,
            );
            this.model.options.filterBar = false;
            return;
        }
        this.filterBar = new FilterBar<R>({ model: this.model });
        this.wrapper.insertBefore(this.filterBar.element, this.render.root);
    }

    private syncAffordances(): void {
        const doc = this.render.root.ownerDocument;
        const { canAddRows, canAddColumns, addRowLabel } = this.model.options;

        if (canAddRows) {
            if (!this.addRowButton) {
                this.addRowButton = doc.createElement("button");
                this.addRowButton.type = "button";
                // Out of the tab order: Tab inside the grid moves the cell focus, so a button
                // in the sequence would be reachable from outside and nowhere else.
                this.addRowButton.tabIndex = -1;
                this.addRowButton.className = "avg-add-row";
                this.addRowButton.setAttribute("data-avg-action", "add-row");
                this.render.addOverlay(this.addRowButton, "content");
            }
            const label = addRowLabel ?? "add row";
            this.addRowButton.textContent = `+ ${label}`;
            this.addRowButton.title = `${label} (Ctrl+Insert)`;
        } else {
            this.addRowButton?.remove();
            this.addRowButton = undefined;
        }

        if (canAddColumns) {
            if (!this.addColumnButton) {
                this.addColumnButton = doc.createElement("button");
                this.addColumnButton.type = "button";
                this.addColumnButton.tabIndex = -1;
                this.addColumnButton.className = "avg-add-column";
                this.addColumnButton.setAttribute("data-avg-action", "add-column");
                this.addColumnButton.textContent = "+";
                this.addColumnButton.title = "Add column (Ctrl+→)";
                this.render.addOverlay(this.addColumnButton, "header");
            }
        } else {
            this.addColumnButton?.remove();
            this.addColumnButton = undefined;
        }
    }

    private onDataChange = (e: AVGridDataChangeEvent): void => {
        if (this.destroyed) return;
        if (e.lastIsStatusIndex) {
            this.render.setOptions({
                stickyLeft: this.model.data.lastIsStatusIndex + 1,
            });
        }
    };
}
