/** Compiled against emitted declarations with exactOptionalPropertyTypes enabled. */
import { AVGrid, type AVGridOptions } from "av-grid";
import { AVGridReact, type AVGridReactProps } from "av-grid/react";

type AllUndefined<T> = {
    [K in keyof T as {} extends Pick<T, K> ? K : never]-?: undefined;
};

type Row = { id: string };

// Kept explicit so adding an optional AVGridOptions field breaks this fixture until covered.
const options: AllUndefined<AVGridOptions<Row>> = {
    columns: undefined, getRowKey: undefined, selectColumn: undefined, selected: undefined,
    focus: undefined, onSelectionChange: undefined, editable: undefined, onEdit: undefined,
    onInvalidEdit: undefined, canAddRows: undefined, canDeleteRows: undefined,
    canAddColumns: undefined, canDeleteColumns: undefined, newRow: undefined, newColumn: undefined,
    addRowLabel: undefined, rowNoun: undefined, onAddRows: undefined, onDeleteRows: undefined,
    onAddColumns: undefined, onDeleteColumns: undefined, disableClipboard: undefined,
    rowHeight: undefined, headerHeight: undefined, fitToWidth: undefined, cellBorders: undefined,
    growToHeight: undefined, growToWidth: undefined, overscanRow: undefined, overscanColumn: undefined,
    whiteSpaceY: undefined, className: undefined, name: undefined, injectStyles: undefined,
    extraElement: undefined, footerRows: undefined, footerRowClass: undefined,
    columnGroupRender: undefined, columnGroupClass: undefined, sort: undefined, multiSort: undefined,
    searchString: undefined, highlightSearch: undefined, highlightString: undefined, filters: undefined,
    persistFilters: undefined, onGetOptions: undefined, filterLabel: undefined, externalFilter: undefined,
    externalSort: undefined, disableSorting: undefined, disableFiltering: undefined,
    disableColumnReorder: undefined, treeColumn: undefined, onTreeToggle: undefined, filterBar: undefined,
    onSortChange: undefined, onFiltersChange: undefined, onColumnResize: undefined,
    onColumnsReorder: undefined, onColumnsChange: undefined, initialScroll: undefined,
    onScrollChange: undefined, onVisibleRowsChange: undefined, onFocusChange: undefined,
    onCellClick: undefined, onCellDoubleClick: undefined, onCellContextMenu: undefined,
    getContextMenuItems: undefined, onGridContextMenu: undefined, disableContextMenu: undefined,
    onCellClass: undefined, rowClass: undefined,
};

export function core(host: HTMLElement): void {
    AVGrid.create<Row>(host, { rows: [], ...options }).setOptions(options);
}

const reactProps: AVGridReactProps<Row> = { rows: [], ...options, style: undefined };
export const exactOptionalElement = <AVGridReact<Row> {...reactProps} className={undefined} />;
