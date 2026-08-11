/**
 * The hub every other model hangs off.
 *
 * Ported from `AVGrid/model/AVGridModel.ts`. Three things replace the React machinery:
 *
 * | Reference | Here |
 * |---|---|
 * | `extends TComponentModel<State, Props>` | `extends Model<State>`, with `options` a plain field |
 * | `useModel()` re-running each render | explicit setters, each calling the same handler |
 * | `EffectsModel` | dissolved — the lifecycle is called directly, not observed |
 *
 * The state object holds only what a *repaint* depends on and the host may change: the sort,
 * and (from task 12) the open editor. Everything derived lives on `data`.
 */

import { Model } from "../core/observable";
import type { RenderGridModel } from "../render/RenderGridModel";
import type { RerenderInfo } from "../render/types";
import type { ResolvedOptions } from "../options";
import type { CellContext, CellEdit, Column, Filter, SortColumn } from "../types";
import { AVGridData } from "./AVGridData";
import { AVGridEvents } from "./AVGridEvents";
import { ColumnsModel } from "./ColumnsModel";
import { CopyPasteModel } from "./CopyPasteModel";
import { EditingModel } from "./EditingModel";
import { FiltersModel } from "./FiltersModel";
import { FocusModel } from "./FocusModel";
import { RowsModel } from "./RowsModel";
import { SelectedModel } from "./SelectedModel";
import { SortColumnModel } from "./SortColumnModel";
import { StructureModel } from "./StructureModel";

export interface AVGridState<R = any> {
    sort?: SortColumn;
    cellEdit?: CellEdit<R>;
}

export class AVGridModels<R> {
    readonly columns: ColumnsModel<R>;
    readonly sortColumn: SortColumnModel<R>;
    readonly filters: FiltersModel<R>;
    readonly rows: RowsModel<R>;
    readonly selected: SelectedModel<R>;
    readonly focus: FocusModel<R>;
    readonly editing: EditingModel<R>;
    readonly copyPaste: CopyPasteModel<R>;
    readonly structure: StructureModel<R>;

    constructor(model: AVGridModel<R>) {
        // Order matters: `columns` must exist before `rows`, because the first
        // `updateColumnsData()` sends a data change that `RowsModel` reacts to. `selected` and
        // `focus` come last so neither revalidates against a half-built pipeline — and
        // `editing` after `focus`, because every edit starts from where the focus is, and
        // `copyPaste` after both — a paste is a batch of edits over the selection — and
        // `structure` last, because adding a row moves the focus, deleting one closes an open
        // editor, and a paste that overflows the grid asks it to grow.
        // `filters` before `rows` because the first `updateRows()` reads the filter list, and
        // a restore from storage has to have happened by then or the grid's first paint shows
        // rows the user had filtered away.
        this.columns = new ColumnsModel<R>(model);
        this.sortColumn = new SortColumnModel<R>(model);
        this.filters = new FiltersModel<R>(model);
        this.rows = new RowsModel<R>(model);
        this.selected = new SelectedModel<R>(model);
        this.focus = new FocusModel<R>(model);
        this.editing = new EditingModel<R>(model);
        this.copyPaste = new CopyPasteModel<R>(model);
        this.structure = new StructureModel<R>(model);
    }
}

export class AVGridModel<R = any> extends Model<AVGridState<R>> {
    options: ResolvedOptions<R>;
    renderModel: RenderGridModel | null = null;

    readonly data: AVGridData<R>;
    readonly events = new AVGridEvents<R>();
    readonly models: AVGridModels<R>;

    /**
     * Transient cross-model flags. Kept off `state` because a change to one never repaints
     * on its own — whoever sets it also marks the cells it affects.
     */
    readonly flags: {
        noScrollOnFocus: boolean;
        /** The column being dragged to a new position, while a reorder is in flight. */
        dragColumnKey?: string;
        dragOverColumnKey?: string;
        /**
         * The open filter popover, if there is one. Structural rather than typed as `Popover`
         * so the model layer keeps not importing the view layer — what the model needs is to
         * light the right funnel and to be able to close it on `destroy()`.
         */
        filterPopover?: { columnKey: string; close: () => void };
        /** The open context menu, if there is one. Same shape and the same reason. */
        contextMenu?: { close: () => void };
    } = { noScrollOnFocus: false };

    constructor(options: ResolvedOptions<R>) {
        super({ sort: options.sort ?? undefined });
        this.options = options;
        this.data = new AVGridData<R>([], []);
        this.models = new AVGridModels<R>(this);

        // Prime the pipeline: columns first (rows are filtered against them), then rows.
        this.models.columns.updateColumnsData(options.columns);
        this.models.rows.updateRows();
    }

    // -----------------------------------------------------------------------
    // Wiring
    // -----------------------------------------------------------------------

    setRenderModel = (renderModel: RenderGridModel | null): void => {
        this.renderModel = renderModel;
    };

    /** Mark cells dirty. The whole performance story is in how narrow this argument is. */
    update = (rerender?: RerenderInfo): void => {
        this.renderModel?.update(rerender);
    };

    requestRepaint = (): void => {
        this.renderModel?.requestRepaint();
    };

    /**
     * Give the grid keyboard focus.
     *
     * Keys are handled on the root — see `GridInteractions` — so this is what a handler calls
     * after doing something that could have moved focus elsewhere.
     */
    focusGrid = (): void => {
        this.renderModel?.gridRef.current?.focus({ preventScroll: true });
    };

    // -----------------------------------------------------------------------
    // Coordinates
    // -----------------------------------------------------------------------

    /**
     * Grid row 0 is the header, so data row *n* is grid row *n + 1*. Every conversion in the
     * library goes through these two, rather than scattering `± 1` across the views.
     */
    gridRowToDataRow = (gridRow: number): number => gridRow - 1;
    dataRowToGridRow = (dataRow: number): number => dataRow + 1;

    rowKeyAt = (dataRow: number): string => {
        const row = this.data.rows[dataRow];
        return row === undefined ? "" : this.options.getRowKey(row);
    };

    /** The context object handed to `render`, `onCellClass` and the cell callbacks. */
    cellContext = (dataRow: number, colIndex: number): CellContext<R> | undefined => {
        const row = this.data.rows[dataRow];
        const column = this.data.columns[colIndex];
        if (row === undefined || column === undefined) return undefined;

        return {
            value: (row as any)[column.key],
            row,
            column,
            rowIndex: dataRow,
            colIndex,
            rowKey: this.options.getRowKey(row),
        };
    };

    // -----------------------------------------------------------------------
    // Host-facing setters — the explicit replacements for the reference's prop sync
    // -----------------------------------------------------------------------

    setRows = (rows: readonly R[]): void => {
        this.options.rows = rows;
        this.models.rows.updateRows();
    };

    setColumns = (columns: Column<R>[]): void => {
        this.models.columns.setColumns(columns);
    };

    setSort = (sort: SortColumn | undefined): void => {
        this.models.sortColumn.setSort(sort);
    };

    setFilters = (filters: readonly Filter[] | undefined): void => {
        this.models.filters.setFilters(filters);
    };

    setSearchString = (searchString: string | undefined): void => {
        if (this.options.searchString === searchString) return;
        this.options.searchString = searchString;
        this.models.rows.refilterRows();
    };

    override dispose(): void {
        this.events.clear();
        this.data.onChange.clear();
        this.renderModel = null;
        super.dispose();
    }
}
