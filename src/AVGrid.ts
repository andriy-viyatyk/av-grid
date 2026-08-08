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
import type { AVGridOptions } from "./options";
import {
    AVGridError,
    resolveContainer,
    resolveOptions,
    validateColumns,
    validateSort,
} from "./validate";
import type { CellFocus, Column, SortColumn } from "./types";
import type { GridSelection } from "./model/FocusModel";
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

export interface AVGridStateSnapshot<R = any> {
    columns: Column<R>[];
    /** Rows currently displayed — after filtering and sorting. */
    rowCount: number;
    /** Rows given to the grid, before filtering. */
    sourceRowCount: number;
    sort?: SortColumn;
    searchString?: string;
    rowHeight: number;
    /** The focused cell and its range selection. */
    focus?: CellFocus<R>;
    /**
     * How many rows are checkbox-selected, and whether that is all of them.
     *
     * The count rather than the keys deliberately: this snapshot is meant to be logged, and
     * 100,000 keys in a console answers nothing. `getSelected()` returns them.
     */
    selectedCount: number;
    allSelected: boolean;
}

export class AVGrid<R = any> {
    /** Bumped on release. Also exported from the package root. */
    static readonly version = "0.0.0";

    readonly model: AVGridModel<R>;
    readonly render: RenderGrid;

    private readonly interactions: GridInteractions<R>;
    private readonly dataSubscription: { unsubscribe: () => void };
    private destroyed = false;

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

    private constructor(container: HTMLElement | string, options: AVGridOptions<R>) {
        const host = resolveContainer(container);
        const resolved = resolveOptions<R>(options);

        if (resolved.injectStyles !== false) injectStyles(host.ownerDocument);

        this.model = new AVGridModel<R>(resolved);

        const renderCell: RenderCellFunc = (p) =>
            p.row === 0
                ? renderHeaderCell(this.model, p)
                : renderDataCell(this.model, p);

        this.render = new RenderGrid(host, {
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
            height: resolved.growToHeight ? undefined : resolveHeight(host),
            growToHeight: resolved.growToHeight,
            growToWidth: resolved.growToWidth,
        });

        if (resolved.cellBorders === false) {
            this.render.root.setAttribute("data-cell-borders", "off");
        }

        // The container may simply not have been laid out yet when `create()` was called —
        // a board or a framework mounts its DOM and constructs the grid in the same tick. In
        // that case the fallback height was chosen against a measurement of zero; re-check
        // once layout has happened and fill the container after all.
        if (!resolved.growToHeight && host.clientHeight === 0) {
            requestAnimationFrame(() => {
                if (this.destroyed || host.clientHeight === 0) return;
                this.render.root.style.height = "100%";
                this.render.model.checkSize();
            });
        }

        this.model.setRenderModel(this.render.model);
        this.interactions = new GridInteractions<R>(this.model, this.render);

        this.dataSubscription = this.model.data.onChange.subscribe(this.onDataChange);

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
        this.model.setRows(rows);
    }

    getColumns(): Column<R>[] {
        return this.model.options.columns;
    }

    setColumns(columns: Column<R>[]): void {
        this.model.setColumns(validateColumns<R>(columns, this.model.options.rows));
    }

    // -----------------------------------------------------------------------
    // Sorting and filtering
    // -----------------------------------------------------------------------

    getSort(): SortColumn | undefined {
        return this.model.state.get().sort;
    }

    /** Set or clear the sort. Pass `undefined` for unsorted. */
    setSort(sort: SortColumn | undefined): void {
        this.model.setSort(
            validateSort(sort ?? undefined, this.model.data.columns),
        );
    }

    getSearchString(): string | undefined {
        return this.model.options.searchString;
    }

    setSearchString(searchString: string | undefined): void {
        this.model.setSearchString(searchString);
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
        this.model.models.selected.setSelected(selected);
    }

    isSelected(rowKey: string): boolean {
        return this.model.models.selected.isSelected(rowKey);
    }

    toggleSelected(rowKey: string): void {
        this.model.models.selected.toggleSelected(rowKey);
    }

    /** Select every *displayed* row — so on a filtered grid, what the user can see. */
    selectAll(): void {
        this.model.models.selected.selectAll();
    }

    clearSelected(): void {
        this.model.models.selected.clearSelected();
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
        this.model.models.focus.setFocus(focus);
    }

    clearFocus(): void {
        this.model.models.focus.clearFocus();
    }

    /** Focus one cell by index into the *displayed* rows, discarding any selection. */
    focusCell(rowIndex: number, colIndex: number, withScroll = false): void {
        this.model.models.focus.focusCell(rowIndex, colIndex, withScroll);
    }

    /** Select a rectangle of cells. The focus lands on the end corner, as after a drag. */
    selectRange(
        startRowIndex: number,
        startColIndex: number,
        endRowIndex: number,
        endColIndex: number,
    ): void {
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
        if (this.destroyed) return;

        // Order matters: columns first, because row filtering matches against them.
        if ("columns" in options && options.columns) this.setColumns(options.columns);
        if ("rows" in options && options.rows) this.setRows(options.rows);
        if ("searchString" in options) this.setSearchString(options.searchString);
        if ("filters" in options) {
            this.model.options.filters = options.filters;
            this.model.models.rows.updateRows();
        }
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
        if ("selected" in options) this.setSelected(options.selected);

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

        this.refresh();
    }

    // -----------------------------------------------------------------------
    // Introspection
    // -----------------------------------------------------------------------

    /**
     * A plain, serializable answer to "what does the grid think is going on". Task 18 adds
     * selection and focus to it.
     */
    getState(): AVGridStateSnapshot<R> {
        return {
            columns: this.model.options.columns,
            rowCount: this.model.data.rows.length,
            sourceRowCount: this.model.options.rows.length,
            sort: this.model.state.get().sort,
            searchString: this.model.options.searchString,
            rowHeight: this.model.options.rowHeight,
            focus: this.model.models.focus.focus,
            selectedCount: this.model.models.selected.count,
            allSelected: this.model.models.selected.allSelected,
        };
    }

    // -----------------------------------------------------------------------
    // Painting and scrolling
    // -----------------------------------------------------------------------

    /** Repaint every visible cell. The escape hatch for data mutated in place. */
    refresh(): void {
        this.model.update({ all: true });
    }

    scrollToRow(row: number, align: RowAlign = "nearest"): Promise<void> {
        // Callers count data rows; the engine counts grid rows, where 0 is the header.
        return this.render.model.scrollToRow(
            this.model.dataRowToGridRow(row),
            align,
        );
    }

    scrollToCell(row: number, col: number): Promise<void> {
        return this.render.model.scrollTo(this.model.dataRowToGridRow(row), col);
    }

    // -----------------------------------------------------------------------
    // Teardown
    // -----------------------------------------------------------------------

    /** Release everything: listeners, observers, pooled DOM. Safe to call twice. */
    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;

        this.dataSubscription.unsubscribe();
        this.interactions.destroy();
        this.model.setRenderModel(null);
        this.render.destroy();
        this.model.dispose();
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
    private onDataChange = (e: AVGridDataChangeEvent): void => {
        if (this.destroyed) return;
        if (e.lastIsStatusIndex) {
            this.render.setOptions({
                stickyLeft: this.model.data.lastIsStatusIndex + 1,
            });
        }
    };
}
