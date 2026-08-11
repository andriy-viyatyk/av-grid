# av-grid API reference

A dependency-free, framework-agnostic virtualized data grid that renders straight to the DOM.
Built for 100,000+ rows with no lag while scrolling, selecting or editing.

This page is the complete public surface. It is written to be read once, mid-task, to answer one
question — so it is exhaustive and skimmable, and every entry carries the snippet you would
actually type. Runnable standalone files live in [`../examples/`](../examples/).

**Contents**

- [Install and the minimum call](#install-and-the-minimum-call)
- [The naming decision](#the-naming-decision)
- [`AVGrid` statics](#avgrid-statics)
- [Options](#options)
- [Columns](#columns)
- [What is inferred](#what-is-inferred)
- [Instance methods](#instance-methods)
- [Callbacks, at a glance](#callbacks-at-a-glance)
- [Filtering](#filtering)
- [The filter bar](#the-filter-bar)
- [The context menu](#the-context-menu)
- [Keyboard reference](#keyboard-reference)
- [Theming](#theming)
- [DOM contract](#dom-contract)
- [Primitives](#primitives)
- [Helpers](#helpers)
- [The engine](#the-engine)
- [Errors and warnings](#errors-and-warnings)
- [Performance notes](#performance-notes)

---

## Install and the minimum call

```html
<div id="host" style="height: 400px"></div>
<script type="module">
    import { AVGrid } from "./dist/av-grid.js";

    const grid = AVGrid.create("#host", {
        rows: [
            { id: 1, name: "Ada Lovelace", score: 98 },
            { id: 2, name: "Grace Hopper", score: 95 },
        ],
    });
</script>
```

That is the whole minimum call. Columns, header labels, widths, data types, alignment and row
keys are all inferred from the rows — see [What is inferred](#what-is-inferred).

**The host needs a height.** The grid measures its own root to decide what is on screen, so that
height has to be *definite*. A host with a height (`height: 400px`, a flex child, `position:
absolute`) gets a grid that fills it; a host with no height at all gets a pixel fallback, and the
grid re-measures once on the next frame in case the page simply had not laid out yet. If a grid
renders blank, `grid.getState().viewport.width` is the first thing to read — `0` is the answer to
the commonest integration failure.

**Builds.** `dist/av-grid.js` (ESM), `dist/av-grid.umd.cjs` (UMD, global `AVGrid`),
`dist/index.d.ts` (types), `dist/av-grid.css` (the stylesheet, if you would rather link it than
let the grid inject it).

```html
<!-- UMD, no bundler -->
<script src="dist/av-grid.umd.cjs"></script>
<script>
    const grid = AVGrid.AVGrid.create("#host", { rows });
</script>
```

The stylesheet is injected into the document on first use and shared by every grid in it. Pass
`injectStyles: false` and link `av-grid.css` yourself if you would rather control it.

---

## The naming decision

**The vocabulary is `key` / `name`, and there are no aliases.**

```js
columns: [{ key: "score", name: "Score" }]     // ✅
columns: [{ field: "score", title: "Score" }]  // ❌ — not accepted, not aliased
```

Why, since Tabulator's `field` / `title` is at least as familiar:

- **`key` is already the property name.** It is what `row[column.key]` reads, what a filter names
  in `columnKey`, what `onEdit` reports, and what `deleteColumns()` takes. Calling the same string
  `field` in the column and `columnKey` everywhere else would be two words for one thing.
- **The reference uses it**, and the port's models are kept close to the reference so behaviour can
  be diffed against it.
- **`name` beats `title`** because `title` is an HTML attribute with a different meaning (the
  tooltip), and a column literal carrying both would read as a contradiction.
- **No aliases, deliberately.** Two ways to spell one thing is worse than either alone: examples
  drift between them and generated code becomes inconsistent. So `field` and `title` are silently
  ignored rather than accepted, and `validateColumns` raises on a column with no `key` at all.

The reference's misspellings are **not** carried over. Type the correct spelling:

| Reference | Here |
|---|---|
| `haderRenderer` | `headerRender` |
| `cellRenderer` + `cellFormater` | `render` (one hook) |
| `editFormater` | `editRender` |
| `resizible` | `resizable` |
| `dataAlignment` | `align` |
| `TSortColumn`, `TFilter`, … | `SortColumn`, `Filter`, … (no `T` prefix) |

One flat options object, no required call order: anything you can pass to `create()` you can pass
to `setOptions()` later, and the two run the same code.

---

## `AVGrid` statics

### `AVGrid.create(container, options)`

```js
const grid = AVGrid.create("#host", { rows });          // CSS selector
const grid = AVGrid.create(document.body, { rows });    // or an element
```

`container` is an element or a selector. `options.rows` is the only required option. Returns an
`AVGrid` instance. Throws [`AVGridError`](#errors-and-warnings) on input the grid cannot use.

### `AVGrid.createFilterBar(container, { grid, className?, name? })`

Mount a filter bar somewhere other than directly above the grid. See
[The filter bar](#the-filter-bar).

### `AVGrid.version`

The library version string. Also exported as `version` from the package root, and reported by
`getState().version`.

### Instance properties

| Property | What it is |
|---|---|
| `grid.element` | The grid's root element. Style it, or read `data-*` off its cells in a test. |
| `grid.model` | The model hub — every sub-model hangs off it. Public so a host can reach past the façade. |
| `grid.render` | The virtualization engine instance, including `grid.render.stats`. |

---

## Options

Every option is optional except `rows`. Everything here can also be passed to
`grid.setOptions({ … })` at any time.

### Data

| Option | Type | Default | Notes |
|---|---|---|---|
| `rows` | `readonly R[]` | — | **Required.** The rows to display. |
| `columns` | `Column<R>[]` | inferred | See [Columns](#columns). |
| `getRowKey` | `(row: R) => string` | inferred | A stable row identity. Selection, focus and editing all address rows by it, so it survives sorting and filtering. |

```js
AVGrid.create(el, {
    rows,
    getRowKey: (row) => row.orderId,
});
```

### Row selection

| Option | Type | Default | Notes |
|---|---|---|---|
| `selectColumn` | `boolean` | `false` | The checkbox column, pinned left. It is the grid's own: it does not appear in `getColumns()` and does not survive into `setColumns()`. |
| `selected` | `readonly string[]` | `[]` | Initially selected rows, **by row key**. |
| `onSelectionChange` | `(keys: string[]) => void` | — | The checkbox selection changed. Call `getSelectedRows()` for the objects — that is O(rows) and so is not done for you. |

```js
AVGrid.create(el, {
    rows,
    selectColumn: true,
    selected: ["3", "7"],
    onSelectionChange: (keys) => console.log(keys.length, "selected"),
});
```

Row selection (checkboxes) and cell range selection are two different things a grid can have at
once — `getSelected()` for the first, `getSelection()` for the second.

### Editing

| Option | Type | Default | Notes |
|---|---|---|---|
| `editable` | `boolean` | `false` | Let the user edit cells in place. |
| `onEdit` | `(e: CellEditEvent<R>) => void \| boolean` | — | Fires once per committed cell, **before** the write. Return `false` to reject it. |
| `onInvalidEdit` | `(e: InvalidEditEvent<R>) => void` | — | The value could not be coerced to the column's type. Default is to do nothing — a library should not beep uninvited. |

```js
AVGrid.create(el, {
    rows,
    editable: true,
    onEdit: (e) => save(e.rowKey, e.columnKey, e.value),
});
```

**The grid writes the value into the row object** (`row[column.key] = value`) and then calls
`onEdit`. Return `false` to keep the write from happening and own the update yourself.

How an editor opens:

| Gesture | What happens |
|---|---|
| Click a cell that already has the focus | Opens, **caret where the click landed**, nothing selected. A cold cell therefore takes two clicks and a focused one takes a single click. |
| Double-click | Opens the same way. |
| `Enter` / `F2` / `grid.startEdit()` | Opens with the **whole value selected**, so the next keystroke replaces it. |
| Type a printable character | Opens with that character as the value, caret after it. |
| `Escape` | Cancels. |
| `Enter`, `Tab`, `ArrowUp`, `ArrowDown`, blur | Commits. `Tab` and the vertical arrows then move the focus; the horizontal arrows stay in the text, moving the caret. |

Boolean columns have no text editor: `Space`, `Enter` or a double-click toggles them across the
whole selection, and an editable boolean cell carries a checkbox that toggles on the first click
(only the box toggles — the cell around it just selects). `Delete` clears every editable cell in
the selection. A column with `options` opens the library's own themed dropdown rather than a
native `<select>`. Per-column opt-outs: `readonly: true`, and any `isStatusColumn`.

`EditOrigin` — the value on `CellEdit.openedBy`, and the only thing that decides where the caret
starts:

```ts
type EditOrigin = "key" | "pointer" | "typing";
```

### Adding and deleting rows and columns

| Option | Type | Default | Notes |
|---|---|---|---|
| `canAddRows` | `boolean` | `false` | An **+ add row** button under the last row, `Ctrl+Insert`, `ArrowDown` or `Tab` off the end, and a paste taller than the grid. |
| `canDeleteRows` | `boolean` | `false` | `Ctrl+Delete`. |
| `canAddColumns` | `boolean` | `false` | `Ctrl+Shift+Insert`, `Ctrl+→` off the last column, and a `+` in the header. |
| `canDeleteColumns` | `boolean` | `false` | `Ctrl+Shift+Delete`. |
| `newRow` | `(index: number) => R` | `{}` plus a unique row-key placeholder | What a blank row contains. |
| `newColumn` | `(index: number) => Column<R>` | `{ key: "column<n>", name: "Column <n>" }` | What a blank column looks like. |
| `addRowLabel` | `string` | `"add row"` | Text on the add-row button. |
| `onAddRows` | `(e: AddRowsEvent<R>) => void \| boolean` | — | Before the insert. Return `false` to cancel; mutate `e.rows` to fill them in. |
| `onDeleteRows` | `(e: DeleteRowsEvent<R>) => void \| boolean` | — | Return `false` to cancel — this is where a confirm goes. |
| `onAddColumns` | `(e: AddColumnsEvent<R>) => void \| boolean` | — | |
| `onDeleteColumns` | `(e: DeleteColumnsEvent<R>) => void \| boolean` | — | |

```js
AVGrid.create(el, {
    rows,
    editable: true,
    canAddRows: true,
    canDeleteRows: true,
    newRow: () => ({ id: crypto.randomUUID(), name: "", score: 0 }),
    onAddRows: (e) => save(e.rows),
    onDeleteRows: (e) => confirm(`Delete ${e.rows.length} rows?`),
});
```

**The four `can*` options govern the user's affordances only.** `grid.addRows()` and the rest
always work — an API call is the host's own decision, and needing to set an option before your own
code may call a method is a trap, not a safeguard.

The row that `ArrowDown` adds off the bottom is taken back if the focus leaves it without anyone
typing in it, so holding the key to read the end of a grid does not leave a blank row behind.

### Clipboard

| Option | Type | Default | Notes |
|---|---|---|---|
| `disableClipboard` | `boolean` | `false` | Turn off the grid's clipboard handling. It is **on by default** — no option is needed to get it. |

`Ctrl+C` copies the selected range as tab-separated text (which Excel, Sheets and Numbers paste as
cells); `Ctrl+Shift+C` adds a header row; `Ctrl+V` pastes into the selection; `Ctrl+X` copies then
clears, on an `editable` grid. A paste writes through the same path as typing, so `validate`,
`readonly` and `onEdit` all still apply.

### Layout

| Option | Type | Default | Notes |
|---|---|---|---|
| `rowHeight` | `number` | `24` | Uniform. Variable row heights are not supported. |
| `fitToWidth` | `boolean` | `false` | Stretch the columns to fill the width instead of scrolling horizontally. |
| `cellBorders` | `boolean` | `true` | `false` gives a borderless list look. |
| `growToHeight` | `string` | — | CSS height cap: the grid grows to its content up to this, instead of filling its parent. |
| `growToWidth` | `string` | — | The same, horizontally. |
| `overscanRow` | `number` | `4` | Extra rows rendered outside the viewport. |
| `overscanColumn` | `number` | `1` | Extra columns. |

### Presentation

| Option | Type | Default | Notes |
|---|---|---|---|
| `className` | `string` | — | Extra class on the root, for host styling. |
| `name` | `string` | — | Debug label, emitted as `data-name` on the root and reported by `getState().name`. Never used for styling. |
| `injectStyles` | `boolean` | `true` | Inject the stylesheet on first use. `false` if you link `av-grid.css` yourself. |
| `onCellClass` | `(cell: CellContext<R>) => string \| undefined` | — | Extra class names for a cell, on top of the built-in state classes. |

```js
AVGrid.create(el, {
    rows,
    onCellClass: (cell) => (cell.column.key === "score" && cell.value < 50 ? "low" : undefined),
});
```

### Sorting and filtering

| Option | Type | Default | Notes |
|---|---|---|---|
| `sort` | `SortColumn \| null` | `null` | Initial sort. Clicking a header cycles ascending → descending → none. |
| `searchString` | `string` | — | Free-text filter. Every whitespace-separated word must appear in some column's *displayed* value — so a computed column with `formatValue` is searchable too. |
| `filters` | `Filter[]` | `[]` | Applied column filters. See [Filtering](#filtering). |
| `persistFilters` | `PersistFiltersOptions` | — | Remember the filters across reloads. Passing this **is** the consent to write. |
| `onGetOptions` | `GetFilterOptions<R>` | — | Supply the options a filter popover offers, instead of the column's distinct values. May return a promise. |
| `disableSorting` | `boolean` | `false` | |
| `disableFiltering` | `boolean` | `false` | Take the funnel off every header. One column opts out with `filterType: null`. |
| `filterBar` | `boolean` | `false` | A bar of removable filter chips directly above the grid. Read at `create()`. |

### Context menu

| Option | Type | Notes |
|---|---|---|
| `getContextMenuItems` | `(e: GridContextMenuEvent<R>) => MenuItem[]` | Extra items **above** the built-in ones. Called every time the menu opens. |
| `onGridContextMenu` | `(e: GridContextMenuEvent<R>, items: MenuItem[]) => void` | Draw the menu yourself. Suppresses the grid's menu **and** the browser's. |
| `disableContextMenu` | `boolean` | Leave right-click alone: the browser's own menu appears. |

See [The context menu](#the-context-menu).

### Cell events

| Option | Type |
|---|---|
| `onCellClick` | `(cell: CellContext<R>, e: MouseEvent) => void` |
| `onCellDoubleClick` | `(cell: CellContext<R>, e: MouseEvent) => void` |
| `onCellContextMenu` | `(cell: CellContext<R>, e: MouseEvent) => void` |

### Change callbacks

| Option | Type | Fires when |
|---|---|---|
| `onSortChange` | `(sort: SortColumn \| undefined) => void` | The sort changed. |
| `onFiltersChange` | `(filters: Filter[]) => void` | The filters changed — from the API, a funnel or a chip alike. Receives the normalized list, safe to hand straight back to `setFilters()`. |
| `onColumnResize` | `(columnKey: string, width: number) => void` | A column was resized. |
| `onColumnsReorder` | `(sourceKey: string, targetKey: string) => void` | Columns were dragged into a new order. |
| `onColumnsChange` | `(columns: Column<R>[]) => void` | Any change to the column set, whatever caused it. |
| `onVisibleRowsChange` | `(rows: readonly R[]) => void` | The displayed row set changed — a sort, a filter, or `setRows()`. |
| `onFocusChange` | `(focus: CellFocus<R> \| undefined) => void` | The focused cell or the range around it changed. Once per cell during a drag, not once per pointer move. |

`onFocusChange` is named for *cell* focus deliberately: `onSelectionChange` is reserved for row
selection, which is a different thing.

---

## Columns

```ts
interface Column<R = any> {
    key: keyof R | string;          // property name on the row, and the column's identity
    name?: string;                  // header label; defaults to `key`
    width?: number | `${number}%`;
    hidden?: boolean;

    render?: CellRenderer<R>;       // custom cell content
    headerRender?: HeaderRenderer<R>;
    editRender?: CellRenderer<R>;   // content while the cell is being edited

    formatValue?: (column: Column<R>, row: R) => string;  // text used for sort/filter/copy

    dataType?: "string" | "number" | "boolean";
    displayFormat?: DisplayFormat;
    align?: "left" | "center" | "right";

    resizable?: boolean;
    readonly?: boolean;
    isStatusColumn?: boolean;       // a non-data column, pinned left

    rowCompare?: (left: R, right: R) => number;
    filterType?: "options" | null;  // default "options"; null takes the funnel off

    validate?: (column: Column<R>, row: R, value: any) => any;
    options?: any[] | (() => any[] | Promise<any[]>);
}
```

```js
columns: [
    { key: "name", name: "Full name", width: 220 },
    { key: "score", name: "Score", dataType: "number", align: "right", width: 80 },
    { key: "active", name: "Active", dataType: "boolean", width: 70 },
    { key: "created", name: "Created", displayFormat: "date" },
    { key: "status", name: "Status", options: ["open", "pending", "closed"] },
    { key: "actions", name: "", render: () => `<button>Send</button>`, filterType: null },
]
```

### `render` — custom cell content

```js
{ key: "score", render: (cell) => `<b>${cell.value}</b>` }
```

Return an **HTML string** (the common case), a **DOM element** (when you need to attach a
listener), or `null` / `undefined` for an empty cell. The string form inserts markup as-is —
boards are sandboxed, but the caller still owns escaping untrusted values.

`CellContext` is small and flat on purpose:

```ts
interface CellContext<R = any> {
    value: any;        // row[column.key], before formatting
    row: R;
    column: Column<R>;
    rowIndex: number;  // index into the *displayed* rows
    colIndex: number;
    rowKey: string;
}
```

A cell with `render` is still sorted, filtered and copied by its raw value — unless you also give
it `formatValue`, which is the plain-text projection those three use. A computed column (no row
property at all) needs `formatValue` to take part in them.

### `dataType`

Governs coercion on edit, the comparator, and the editor. `"boolean"` also replaces the text
editor with a checkbox and a toggle gesture.

### `displayFormat`

```ts
type DisplayFormat = "text" | "date" | "dateTime" | "phone" | `date:${string}` | `utcToLocal:${string}`;
```

| Value | Renders |
|---|---|
| `"text"` (default) | `String(value)`; a `Date` becomes `toLocaleString()`. |
| `"date"` | `toLocaleDateString()`. A date-shaped string is parsed first. |
| `"dateTime"` | `toLocaleString()`. |
| `"phone"` | A 10-character string as `(123) 456-7890`; anything else unchanged. |

### `width`

A number of pixels, or a percentage string (`"25%"`). Omitted, the width is detected from the
content — see [What is inferred](#what-is-inferred). A user resize overrides it and is reported
through `onColumnResize`; `getState().columns[i].width` reports what the grid is actually drawing.

### `validate`

```js
{ key: "score", dataType: "number", validate: (col, row, value) => Math.max(0, Number(value)) }
```

Return the value to commit. Return `undefined` to reject the edit, which fires `onInvalidEdit`.
With no `validate`, `defaultValidate` coerces to `dataType`: `"number"` through `Number()`
(rejecting `NaN`), `"boolean"` treating `"false"` / `"no"` / `"0"` as false, and a column with an
`options` array rejecting anything not in it.

### `options`

```js
{ key: "status", options: ["open", "pending", "closed"] }
{ key: "owner", options: () => teamMembers }
{ key: "owner", options: async () => (await fetch("/owners")).json() }
```

Opens the library's own virtualized, themed dropdown — 10,000 options put 13 rows in the DOM. The
picked option **keeps its type**, so a numeric option commits as a number. Typing over the cell
seeds the dropdown's search box rather than the cell's value. Escape or a click elsewhere cancels.

---

## What is inferred

Omit `columns` and the grid builds them from the rows — sampling the first rows, not all of them.

| From the rows | You get |
|---|---|
| Object keys | One column per key, in first-seen order |
| The key | `name`, humanized: `firstName` → `First Name` |
| The values | `width`, detected from the content and the header |
| All sampled values `boolean` | `dataType: "boolean"` |
| All sampled values `number` | `dataType: "number"` |
| All sampled values `Date` | `displayFormat: "dateTime"` |
| — | `resizable: true` |

Array rows work too: keys are the indices and headers are 1-based, which is what a
spreadsheet-shaped dataset wants.

**Row keys.** With no `getRowKey`, the grid uses the first present of `id`, `key`, `_id`, `uuid`,
`rowKey`. Failing that it assigns an identity per row *object* in a `WeakMap` — stable across
sorting and filtering (they reorder the same objects) but **not** across a `setRows()` that
rebuilds them. Pass `getRowKey` if your rows are rebuilt and a selection has to survive it.

The inference helpers are exported, if you want to start from what the grid would have done:

```js
import { inferColumns, inferGetRowKey, inferRowKeyProperty } from "av-grid";

const columns = inferColumns(rows);
columns[2].align = "right";
AVGrid.create(el, { rows, columns });
```

---

## Instance methods

Every method that *changes* the grid is a no-op on a destroyed one (warning once); every getter
still answers.

Indices are into the **displayed** rows — after filtering and sorting — throughout. Row *keys* are
what `getRowKey` returns.

### Data

| Method | Returns | Notes |
|---|---|---|
| `getRows()` | `readonly R[]` | What was given to the grid. |
| `getVisibleRows()` | `readonly R[]` | What is on screen — after filtering and sorting. |
| `setRows(rows)` | `void` | Keeps the scroll position and repaints without a teardown. |
| `getColumns()` | `Column<R>[]` | Without the checkbox column — that one is the grid's. |
| `setColumns(columns)` | `void` | Validated exactly as at `create()`. |

### Rows and columns

| Method | Returns | Notes |
|---|---|---|
| `addRows(rows, index?)` | `R[]` | Insert at a display index, or append. Returns what went in — empty when `onAddRows` refused. |
| `addRow(index?)` | `R \| undefined` | One blank row from `newRow`, focused. |
| `deleteRows(rowKeys)` | `boolean` | By key, not index, not row object. |
| `deleteSelectedRows()` | `boolean` | What `Ctrl+Delete` does — the rows the *cell* selection covers. |
| `addColumns(columns, index?)` | `Column<R>[]` | Index into `getColumns()`. |
| `addColumn(index?)` | `Column<R> \| undefined` | One blank column from `newColumn`. |
| `deleteColumns(columnKeys)` | `boolean` | |

```js
grid.addRows([{ id: 9, name: "Ada" }]);      // at the end
grid.addRows([{ id: 9, name: "Ada" }], 0);   // at the top
grid.deleteRows(["3", "7"]);
```

On a sorted or filtered grid the row order is held still for an insert, so a new row appears where
it was put instead of sorting away or failing the filter. The next sort change releases it.

### Sorting and search

| Method | Returns |
|---|---|
| `getSort()` | `SortColumn \| undefined` |
| `setSort(sort \| undefined)` | `void` |
| `getSearchString()` | `string \| undefined` |
| `setSearchString(text \| undefined)` | `void` |

```js
grid.setSort({ key: "score", direction: "desc" });
grid.setSort(undefined);            // unsorted
grid.setSearchString("lovelace");   // across every column's displayed value
```

### Filters

See [Filtering](#filtering) for the shapes.

| Method | Returns | Notes |
|---|---|---|
| `getFilters()` | `Filter[]` | The **normalized** form — safe to store and hand back. |
| `setFilters(filters \| undefined)` | `void` | Replace every filter. `[]` clears. Setting what the grid already has does nothing, so echoing `onFiltersChange` cannot loop. |
| `applyFilter(filter)` | `void` | Add or replace one column's filter — or remove it, when the value is empty. |
| `removeFilter(columnKey)` | `void` | |
| `clearFilters()` | `void` | |
| `isFiltered(columnKey)` | `boolean` | What the header funnel's indicator asks. |
| `showFilterPopover(columnKey, options?)` | `Promise<Filter \| undefined>` | Opens the popover and resolves when it closes. The filter is already applied by then. |

```js
grid.applyFilter({ columnKey: "status", value: ["open"] });   // filter to open rows
grid.applyFilter({ columnKey: "status" });                    // and back again

const applied = await grid.showFilterPopover("status");       // undefined if dismissed
```

`ShowFilterPopoverOptions`: `anchor` (an element or a `{ x, y }` point — defaults to the column's
own funnel), `offset`, `size`, `onResize`. Never anchor to a data cell: cells are pooled, so one
scrolled out from under an open popover re-anchors it to a different row.

### Row selection

| Method | Returns | Notes |
|---|---|---|
| `getSelected()` | `string[]` | Row keys. |
| `getSelectedRows()` | `R[]` | The objects, in display order. O(rows) — call it when you need them. |
| `setSelected(keys \| undefined)` | `void` | Accepts an array or a `Set`. |
| `isSelected(rowKey)` | `boolean` | |
| `toggleSelected(rowKey)` | `void` | |
| `selectAll()` | `void` | Every **displayed** row — so on a filtered grid, what the user can see. |
| `clearSelected()` | `void` | |

### Editing

| Method | Returns | Notes |
|---|---|---|
| `startEdit(rowIndex, colIndex)` | `void` | Opens with the value selected. No-op when the grid is not `editable`, the column is `readonly`, or the column is a boolean. |
| `isEditing()` | `boolean` | |
| `getEdit()` | `CellEdit<R> \| undefined` | The open edit and the value the editor is holding. |
| `commitEdit()` | `void` | Write and close. |
| `cancelEdit()` | `void` | Close, discarding what was typed. |
| `setCellValue(rowIndex, colIndex, value)` | `boolean` | As if the user had edited it: validation, `onEdit` and the repaint all happen. |

### Clipboard

| Method | Returns | Notes |
|---|---|---|
| `copySelection(mode?)` | `Promise<boolean>` | The programmatic path, and it can be refused. |
| `getSelectionText(mode?)` | `string` | Without going near the clipboard. |
| `paste()` | `Promise<boolean>` | Reading the clipboard is permission-gated. |
| `pasteText(text)` | `boolean` | No clipboard involved. |
| `cut()` | `Promise<boolean>` | Copy then clear. Clears nothing unless the grid is editable. |

```ts
type CopyMode = "copy" | "copyWithHeaders" | "copyAsJson" | "copyAsHtmlTable";
```

```js
await grid.copySelection();                   // TSV — pastes into Excel as cells
await grid.copySelection("copyWithHeaders");  // with the column names first
await grid.copySelection("copyAsJson");       // an array of objects
await grid.copySelection("copyAsHtmlTable");  // a table, plus TSV as the plain-text flavour

grid.focusCell(0, 1);
grid.pasteText("Ada\t36\nGrace\t45");         // one selected cell expands to fit
```

A single selected cell expands to fit the pasted text, clamped to the rows and columns that exist;
a larger selection is filled by repeating the text across it. Every cell goes through the same
validation and `onEdit` that typing does.

**`Ctrl+C` does not come through `copySelection()`** — it goes through the browser's own copy
event, which needs no permission. `copySelection()` and `paste()` are the programmatic paths:
`navigator.clipboard` needs a secure context, and reading is permission-gated (Chrome prompts,
Firefox refuses), so they resolve `false` more often than you would like. `pasteText()` has no
such problem.

### Focus and range selection

| Method | Returns | Notes |
|---|---|---|
| `getFocus()` | `CellFocus<R> \| undefined` | The focused cell and the range anchored on it. |
| `setFocus(focus \| undefined)` | `void` | Keys alone are enough — the indices are optional. |
| `clearFocus()` | `void` | |
| `focusCell(rowIndex, colIndex, withScroll?)` | `void` | Discards any selection. |
| `selectRange(rowStart, colStart, rowEnd, colEnd)` | `void` | The focus lands on the end corner, as after a drag. |
| `getSelection()` | `GridSelection<R> \| undefined` | The selected rows and columns, with their index ranges. |
| `focus()` | `void` | Give the grid keyboard focus, so arrow keys reach it without a click first. |

```js
grid.focusCell(10, 2);
grid.selectRange(10, 0, 20, 3);
grid.getSelection().rows;      // the selected row objects
```

`CellFocus` carries both a key and an index for every corner: keys survive sorting and filtering,
indices make the hot-path bounds test a pair of integer comparisons. Keeping both is what lets
range selection stay flat-cost at row 99,000.

### Options, introspection, painting, teardown

| Method | Returns | Notes |
|---|---|---|
| `setOptions(partial)` | `void` | Any option, any time. Equivalent to having passed it to `create()`. |
| `getState()` | `AVGridStateSnapshot<R>` | See below. |
| `isDestroyed()` | `boolean` | |
| `getFilterBar()` | `FilterBar<R> \| undefined` | The bar `filterBar: true` created. Bars from `createFilterBar()` are the caller's. |
| `refresh()` | `void` | Repaint every visible cell. The escape hatch for data mutated in place. |
| `scrollToRow(row, align?)` | `Promise<void>` | `align`: `"top" \| "center" \| "bottom" \| "nearest"` (default). |
| `scrollToCell(row, col)` | `Promise<void>` | |
| `destroy()` | `void` | Release everything. Safe to call twice. |

`scrollToRow` / `scrollToCell` work before the grid has been laid out — they resolve once it has.

#### `getState()`

```js
console.log(grid.getState());       // the whole picture, in one line
JSON.stringify(grid.getState());    // and it survives this
```

Every field is plain data: no functions, no row objects, no DOM. There are no row objects anywhere
— counts, keys and indices only — so logging a 100,000-row grid stays readable and puts no host
data in the line. Payloads stay behind the accessor that returns them (`getSelected()`,
`getVisibleRows()`, `getColumns()`).

```ts
interface AVGridStateSnapshot<R = any> {
    version: string;
    name?: string;
    destroyed: boolean;
    rowCount: number;         // displayed — after filtering
    sourceRowCount: number;   // given to the grid
    columnCount: number;      // including the checkbox column
    columns: ColumnStateSnapshot[];
    sort?: SortColumn;
    searchString?: string;
    filters: Filter[];        // normalized
    rowHeight: number;
    focus?: CellFocus<R>;
    selectedCount: number;    // checkbox selection
    allSelected: boolean;
    editing?: { rowKey: string; columnKey: string; changed: boolean };
    viewport: ViewportSnapshot;
}

interface ColumnStateSnapshot {
    key: string;
    name: string;
    width: number | `${number}%`;   // what the grid is drawing, after any resize
    dataType?: DataType;
    align?: Alignment;
    sorted?: "asc" | "desc";
    filtered: boolean;
    editable: boolean;              // would a click open an editor here?
    isStatusColumn?: boolean;
    hasRender: boolean;             // a custom renderer is installed
    hasOptions: boolean;            // edits through the dropdown
}

interface ViewportSnapshot {
    firstRow: number;      // inclusive, counting data rows; -1 when nothing is rendered
    lastRow: number;
    firstColumn: number;   // the first *scrolling* column — 1 with a checkbox column
    lastColumn: number;
    scrollTop: number;
    scrollLeft: number;
    width: number;         // measured size of the root. `0` is why a grid renders blank
    height: number;
}
```

Safe to call on a destroyed grid: it answers `destroyed: true` and reports the last state the grid
held, which is usually what a post-mortem wants.

#### `destroy()`

```js
grid.destroy();      // the host element is empty again
grid.isDestroyed();  // true
```

Releases listeners, observers, pooled DOM, timers, popovers and the filter bar it owns. Nothing
outside the grid holds a reference afterwards — no module-level registry, no document listener, no
pending frame — so the whole object graph is collectable as one. 100 create/destroy cycles of a
fully-loaded grid leak 0 DOM nodes.

The one thing left behind is the injected `<style>`, shared by every grid in the document and
content-identical, so removing it would break the others.

Afterwards, anything that would *change* the grid warns once and does nothing rather than throwing
— a stale callback firing during a framework's unmount should not take the unmount with it.

---

## Callbacks, at a glance

Which callbacks can **veto** by returning `false`, and which are notifications:

| Callback | Fires | Vetoable |
|---|---|---|
| `onEdit` | Before the value is written | ✅ |
| `onAddRows` | Before the insert | ✅ |
| `onDeleteRows` | Before the delete | ✅ |
| `onAddColumns` | Before the insert | ✅ |
| `onDeleteColumns` | Before the delete | ✅ |
| `onInvalidEdit` | After a rejection | — |
| `onSelectionChange` | After | — |
| `onFocusChange` | After | — |
| `onSortChange` | After | — |
| `onFiltersChange` | After | — |
| `onColumnResize` / `onColumnsReorder` / `onColumnsChange` | After | — |
| `onVisibleRowsChange` | After | — |
| `onCellClick` / `onCellDoubleClick` / `onCellContextMenu` | On the gesture | — |

Event payload shapes:

```ts
interface CellEditEvent<R> {
    value: any;          // about to be written, after coercion
    previousValue: any;
    row: R;
    column: Column<R>;
    columnKey: string;
    rowKey: string;
    rowIndex: number;    // into the displayed rows
    colIndex: number;
}

interface InvalidEditEvent<R> { value: any; row: R; column: Column<R>; rowIndex: number; colIndex: number }
interface AddRowsEvent<R>     { rows: R[]; index: number }
interface DeleteRowsEvent<R>  { rows: R[]; rowKeys: string[] }
interface AddColumnsEvent<R>  { columns: Column<R>[]; index: number }
interface DeleteColumnsEvent<R> { columns: Column<R>[]; columnKeys: string[] }
```

---

## Filtering

### A filter

```ts
interface Filter {
    columnKey: string;
    value?: any;            // for "options", the values to keep
    columnName?: string;    // chip label; filled in from the column
    type?: FilterType;      // defaults to the column's filterType, then "options"
    displayFormat?: DisplayFormat;
}
```

Only `columnKey` and `value` are worth writing by hand:

```js
grid.setFilters([{ columnKey: "status", value: ["open", "pending"] }]);
```

Everything else is filled in from the column, and bare values are expanded to `{ value, label }`
options — so `getFilters()` gives back **more** than was passed in. That normalized form is what
the chips read and what `persistFilters` stores, and it is safe to hand straight back.

An empty or absent `value` means **no filter at all**, which is why applying one and removing it
are the same call: applying an empty selection means "no filter", not "no rows".

`FilterType` is `"options"` today. The popover is built as a dispatch point for more.

### The funnel

Every column carries one by default. `filterType: null` takes it off one column,
`disableFiltering: true` off all of them. Clicking it opens a searchable checklist of that
column's distinct values, **cascaded against the other filters**, with select-all, Apply and
Clear. A column with 100,000 distinct values puts 12 rows in the checklist.

### `onGetOptions` — supply the options yourself

```ts
type GetFilterOptions<R> = (
    columns: Column<R>[],
    filters: Filter[],      // the *other* applied filters, never this column's own
    columnKey: string,
    search?: string,        // what the user has typed into the popover's search box
) => DisplayOption[] | Promise<DisplayOption[]>;
```

```js
onGetOptions: async (columns, filters, columnKey, search) =>
    (await fetch(`/values/${columnKey}?q=${search ?? ""}`)).json(),
```

The list shows a loading row until the promise resolves, and a response overtaken by a newer one
is discarded. Ignore `search` and the list narrows the returned options itself.

```ts
interface DisplayOption<T = any> { value: T; label: string; italic?: boolean }
```

### Persistence

```js
AVGrid.create(el, { rows, persistFilters: { name: "orders" } });
```

Stored under `Filters-${name}`. **Passing the object is the consent** — nothing is written
otherwise, and there is no default-on form. Stored filters take precedence over the `filters`
option, which stays the default for a first visit. `Date` values are revived without losing the
labels around them.

```ts
interface PersistFiltersOptions {
    name: string;
    storage?: FilterStorage;   // defaults to localStorage
}

interface FilterStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}
```

`localStorage` and `sessionStorage` both satisfy `FilterStorage` structurally, so
`persistFilters: { name: "orders", storage: sessionStorage }` needs nothing implemented.

Exported for hosts that want to manage the store directly: `filtersStorageKey`,
`hasStoredFilters`, `readStoredFilters`, `writeStoredFilters`, `reviveFilters`,
`FILTERS_CONFIG_VERSION`.

---

## The filter bar

Applied filters shown as removable chips. A chip reads `Status: open,pending (+3)`; clicking its
body reopens the popover **anchored to the chip**, its ✕ removes that filter, and the ✕ at the
right end removes them all. **The bar takes no space at all until something is filtered.**

Two ways to mount one, both making the same object:

```js
// Directly above the grid
const grid = AVGrid.create("#host", { rows, filterBar: true });
grid.getFilterBar();

// Or anywhere else — a toolbar, a panel of its own
const bar = AVGrid.createFilterBar("#toolbar", { grid });
bar.element;     // the root; append it wherever
bar.refresh();   // redraw from the grid's current filters
bar.destroy();   // yours to destroy — grid.destroy() does not own this one
```

A grid can have any number of bars watching it, mounted either way; they all show the same filters
and any of them can edit them.

`filterBar` is read at `create()`, because the grid wraps itself in a flex column to make room and
that is not something to do to a page later. `setOptions({ filterBar: false })` still takes the
bar away, and `true` puts it back on a grid that was *created* with one — on a grid that was not,
it warns and points you at `createFilterBar()`.

---

## The context menu

Right-click gives Copy, Copy as… (With Headers / JSON / Formatted HTML Table), Paste, and
Insert / Add / Delete for both rows and columns — each label counting what the selection actually
covers, and a header getting the two column items instead.

Three hooks, in order of how much they take over:

```js
// 1. Add items above the built-in ones
getContextMenuItems: (e) => [
    { label: `Open ${e.rowKey}`, onClick: () => open(e.row) },
],

// 2. Draw the menu yourself, with the items the grid would have shown
onGridContextMenu: (e, items) => myMenu.show(e.x, e.y, items),

// 3. Hand the gesture back to the browser
disableContextMenu: true,
```

`onGridContextMenu` receives the point in viewport coordinates — exactly what
`showMenu({ anchor: { x, y } })` wants — and the items **already filtered to the ones that
apply**. Each item's `onClick` does the work; nothing else is needed to make them behave. It
suppresses the grid's menu *and* the browser's; `disableContextMenu` is how you get the platform
menu back.

The grid never shows its menu over an open cell editor either way — a user editing text wants
Cut / Paste / Spelling, which only the platform can offer.

```ts
interface GridContextMenuEvent<R = any> {
    x: number;
    y: number;
    target: "cell" | "header" | "grid";
    column?: Column<R>;
    row?: R;
    rowKey?: string;
    rowIndex?: number;      // display indices, counting data rows
    colIndex?: number;
    readonly selection?: GridSelection<R>;   // a getter — see below
    selectedCount: SelectedCount;            // rows, columns, and the top-left corner
    event: MouseEvent;
}
```

**`e.selection` is a getter**, computed at most once. Reading it on a grid with all 100,000 rows
selected copies 100,000 row references, and most menus only need `selectedCount`. Nothing built-in
reads it, which is why opening the menu over 100,000 rows costs 2.3 ms with every row selected
against 2.9 ms with one.

```ts
interface MenuItem {
    label: string;
    onClick?: () => void;
    icon?: Node | string;      // a node, or a string inserted as markup
    disabled?: boolean;        // shown but not pickable
    invisible?: boolean;       // left out entirely
    startGroup?: boolean;      // separator above
    hotKey?: string;           // right-aligned hint, e.g. "(Ctrl+C)". Binds nothing.
    selected?: boolean;        // checked, and highlighted when the menu opens
    minor?: boolean;           // dimmed
    id?: string;
    items?: MenuItem[];        // submenu
}
```

`MenuItem` is Persephone's own shape, so a host that already builds these can hand the same array
to either menu.

---

## Keyboard reference

### Navigation

| Key | Does |
|---|---|
| `←` `→` `↑` `↓` | Move one cell |
| `Ctrl+↑` / `Ctrl+↓` | One viewport |
| `Ctrl+←` / `Ctrl+→` | First / last column |
| `PageUp` / `PageDown` | One viewport |
| `Home` / `End` | First / last row |
| `Ctrl+Home` / `Ctrl+End` | First / last cell |
| `Tab` / `Shift+Tab` | Next / previous cell, wrapping across rows |
| `Shift+` any of the above (not `Tab`) | Extend the range selection |
| `Ctrl+A` | Select every cell |

`↓` on the last row, `Tab` off the last cell, and `Ctrl+→` off the last column each grow the grid
by one, when the matching `can*` option is on.

### Editing

| Key | Does |
|---|---|
| `Enter` / `F2` | Open the editor, value selected |
| any printable key | Open the editor with that character |
| `Space` | Toggle a boolean column |
| `Enter` (boolean) | Toggle the selection to the focused cell's opposite |
| `Escape` | Cancel |
| `Enter` / `Tab` / `↑` / `↓` (in the editor) | Commit, then move |
| `←` / `→` / `Home` / `End` (in the editor) | Move the caret; the grid does not act |
| `Delete` | Clear every editable cell in the selection |

### Clipboard

| Key | Does |
|---|---|
| `Ctrl+C` | Copy the selection as TSV |
| `Ctrl+Shift+C` | Copy with a header row |
| `Ctrl+V` | Paste into the selection |
| `Ctrl+X` | Copy, then clear (editable grids) |

### Structure

| Key | Does |
|---|---|
| `Ctrl+Insert` | Insert blank rows above the selection, as many as it covers |
| `Ctrl+Shift+Insert` | Insert blank columns before the selection |
| `Ctrl+Delete` | Delete the rows the selection covers |
| `Ctrl+Shift+Delete` | Delete the columns the selection covers |

`Numpad0` and `NumpadDecimal` stand in for `Insert` and `Delete` when NumLock is off, as they do
everywhere else.

---

## Theming

**Setting a custom property re-tints the grid with no JavaScript and no repaint** — the browser
does it, and nothing in the library reads a colour. A theme change costs **zero** paints.

### Which property, and where — read this first

Four elements define the whole `--avg-*` block **on themselves**, each from its `--p-*`
counterpart with a neutral fallback: the grid root (`[data-type="render-grid"].avg-grid`), a
popover (`.avg-popover`), a virtual list (`.avg-list`) and the filter bar (`.avg-filter-bar`).
They have to — a popover is mounted on `document.body` and a filter bar can be mounted anywhere,
so neither can rely on inheriting from a grid. The consequence is the one rule worth knowing:

| Where you set it | Effect |
|---|---|
| `--p-*` on any ancestor (`:root`, `body`, a wrapper) | **Reaches everything** — the grid, its popovers, its dropdown, its filter bar. This is how you theme a page. |
| `--avg-*` on any ancestor | **Does nothing.** The element's own definition shadows it. |
| `--avg-*` on the element itself | **Wins.** This is how you make one grid differ. |

```css
/* Theme the page. Every --avg-* token falls back to one of these. */
:root {
    --p-accent: #d83b01;
    --p-bg: #ffffff;
    --p-text: #202020;
    --p-bg-dark: #f3f2f1;      /* the header band and the filter bar */
    --p-border-light: #e5e5e5; /* the cell lines */
}
```

```js
// Make one grid deviate. On the grid root, not on the host — the host is an ancestor.
grid.element.style.setProperty("--avg-header-bg", "#1d7a4f");
```

```css
/* The same from a stylesheet needs to beat the library's own selector, which is
   [data-type="render-grid"].avg-grid — two classes' worth of specificity. */
[data-type="render-grid"].avg-grid { --avg-header-bg: #1d7a4f; }
```

Every token falls back to its Persephone `--p-*` equivalent where one exists, then to a neutral
light default — so the grid looks deliberate on a bare HTML page and matches the app on a board.

| Token | Falls back to | Then |
|---|---|---|
| `--avg-font-family` | `--p-font-family` | a system stack |
| `--avg-font-size` | `--p-font-base` | `13px` |
| `--avg-text` | `--p-text` | `#202020` |
| `--avg-text-muted` | `--p-text-muted` | `#767676` |
| `--avg-bg` | `--p-bg` | `#ffffff` |
| `--avg-accent` | `--p-accent` | `#0078d4` |
| `--avg-border-color` | — | 22% of `--avg-text`. Popover edges, button borders, menu separators, the resize grip. |
| `--avg-grid-line` | `--p-border-light` | 11% of `--avg-text`. The cell lines — texture between values, deliberately weaker than `--avg-border-color`. |
| `--avg-header-bg` | `--p-bg-dark` | 7% of `--avg-text` over `--avg-bg`. The header band and the filter bar: chrome, so *darker* than the grid in a dark theme. |
| `--avg-header-text` | — | `--avg-text` |
| `--avg-cell-bg` / `--avg-cell-text` | — | `--avg-bg` / `--avg-text` |
| `--avg-hover-bg` | — | 6% of `--avg-text` |
| `--avg-selection-bg` | — | 18% of `--avg-accent` |
| `--avg-selection-border` | — | `--avg-accent` |
| `--avg-selection-border-blurred` | — | `--avg-text-muted`. The selection outline while the grid does not have focus. |
| `--avg-menu-selection-bg` | `--p-selection-bg` | `--avg-accent`. A menu row is *picked*, so it takes the full selection colour, not the tint a checklist wants. |
| `--avg-menu-selection-text` | `--p-selection-text` | `#ffffff` |
| `--avg-cell-padding-x` | — | `4px` |

A token whose fallback column says "—" has no `--p-*` counterpart, so it can only be set on the
element itself — which also means it is derived from the others and usually needs no setting at
all.

### On a Persephone board

Nothing to wire up. The `--p-*` contract is read directly, so a board's own theme — including a
live theme switch — reaches the grid with no code:

```js
const grid = AVGrid.create("#host", { rows });
// persephone.onThemeChange fires; the grid re-tints itself. No repaint, no callback needed.
```

---

## DOM contract

Useful for host CSS and for driving the grid from a test. **Class names and `data-*` attributes
are part of the public surface; the DOM structure is not** — cells are pooled and absolutely
positioned, and their nesting can change.

| Attribute | On |
|---|---|
| `data-type="render-grid"` | The root |
| `data-name` | The root, from the `name` option |
| `data-type="header-cell"` | A header cell |
| `data-type="data-cell"` | A data cell |
| `data-row` | Row index. A header cell carries `0`; a data cell carries its **data** row index, so data row 0 also reads `0` — `data-type` is what tells them apart. |
| `data-col` | Column index |
| `data-column-key` | The column's `key` |
| `data-sort="asc" \| "desc"` | The sorted header cell |
| `data-resizable` | A header cell |
| `data-type="filter-button"` | The funnel inside a header cell |
| `data-type="cell-editor"` | The open editor |
| `data-avg-action="add-row" \| "add-column"` | The two `+` buttons |
| `data-cell-borders="off"` | The root, with `cellBorders: false` |

Cell state classes, which `onCellClass` adds to rather than replaces: `avg-focused`,
`avg-editing`, `avg-in-selection` (plus `-top` / `-right` / `-bottom` / `-left` for the edges),
`avg-row-hovered`, `avg-row-selected`, `avg-align-center`, `avg-align-right`. On a header cell's
funnel: `avg-column-filtered` when that column is filtered, `avg-filter-open` while its popover
is up.

Root-level classes worth knowing: `avg-grid` (the root), `avg-grid-wrap` (the flex column a
`filterBar` grid lives in), `avg-header-cell`, `avg-data-cell`, `avg-filter-bar`, `avg-popover`,
`avg-menu`, `avg-list`.

**If you write your own cell renderer returning an element, the stylesheet must position it
absolutely.** The engine writes `top` and `left`; nothing writes `position`. A cell that lays out
in flow looks correct at the top of a list and shows an empty band everywhere below.

---

## Primitives

Built for the grid's own filter UI, exported because they are useful on their own and because the
grid's popovers are themed by the same tokens.

### `Popover`

```js
import { Popover } from "av-grid";

const popover = new Popover({ anchor: buttonEl, placement: "bottom-start" });
popover.content.append(myPanel);
const result = await popover.show();   // resolves when it closes
```

Anchors to an element or a point, flips instead of clipping, caps its height to the space
available and scrolls, dismisses on `Escape` or an outside pointerdown, and resizes by a corner
grip.

```ts
interface PopoverOptions {
    anchor: Element | { x: number; y: number };
    placement?: PopoverPlacement;      // default "bottom-start"
    offset?: [number, number];         // [cross, main]
    className?: string;
    matchAnchorWidth?: boolean;
    resizable?: boolean;
    size?: PopoverSize;
    minWidth?: number;
    minHeight?: number;
    onResize?: (size: PopoverSize) => void;
    ignoreOutside?: string;            // a selector; a pointerdown on a match does not close
    autoFocus?: boolean;               // default true
    document?: Document;
}
```

**Never anchor to a data cell.** Cells are pooled, so one scrolled out from under an open popover
silently re-anchors it to whatever the element became. Anchor to a header cell, a chip, or a point.

### `VirtualList`

A searchable, virtualized checklist on its own `RenderGrid` instance. 100,000 options mount in
4.4 ms with 11 rows in the DOM and scroll at 60 fps.

```js
import { VirtualList } from "av-grid";

const list = new VirtualList({
    items: values.map((v) => ({ value: v })),
    multiple: true,
    onChange: (values) => console.log(values),
});
host.append(list.element);
```

```ts
interface VirtualListItem { value: VirtualListValue; label?: string; disabled?: boolean }

interface VirtualListOptions {
    items?: VirtualListItem[];
    selected?: readonly VirtualListValue[];
    multiple?: boolean;          // default true — checkboxes. false gives single-pick
    search?: boolean;            // default true
    searchPlaceholder?: string;
    selectAll?: boolean;         // defaults to `multiple`
    selectAllLabel?: string;
    emptyLabel?: string;
    rowHeight?: number;
    overscanRow?: number;        // default 4
    className?: string;
    onChange?: (values: VirtualListValue[], items: VirtualListItem[]) => void;
    onActivate?: (item: VirtualListItem) => void;   // Enter, or a click in single-pick mode
    onSearch?: (text: string) => void;              // take over filtering
}
```

Methods: `setItems`, `getItems`, `getVisibleItems`, `setSelected`, `getSelected`,
`getSelectedItems`, `setSearch`, `setActiveIndex`, `getActiveItem`, `scrollToIndex`, `measure`,
`focus`, `destroy`.

Set `onSearch` and the list stops matching the text itself and just reports what was typed — the
seam `onGetOptions(…, search)` needs when the options are narrowed at the source.

### `Menu` / `showMenu`

```js
import { showMenu } from "av-grid";

const picked = await showMenu({
    anchor: { x: e.clientX, y: e.clientY },
    items: [
        { label: "Copy", hotKey: "(Ctrl+C)", onClick: () => grid.copySelection() },
        { label: "More", items: [{ label: "As JSON", onClick: () => … }] },
    ],
});
```

Resolves with the item that was picked, or `undefined`. Prefer `showMenu()` to `new Menu(…)`: a
menu that outlives the gesture that opened it has nothing to hold on to, and the promise is the
whole contract.

Submenus open on hover or click, arrow keys navigate, and a search box appears past
`MENU_SEARCH_THRESHOLD` (20) items. `MENU_SUBMENU_DELAY_MS` is 400.

```ts
interface MenuOptions {
    anchor: Element | Point;
    items: MenuItem[];
    placement?: PopoverPlacement;   // default "bottom-start" — for a point, down and right
    offset?: [number, number];
    className?: string;
    document?: Document;
}
```

### The rest

`showFilterPopover`, `OptionsFilterContent`, `FilterBar`, `createButton`, `createIconButton`,
`createCellInput`, `createCellSelect`, `createDefaultEditor`, `SELECT_COLUMN_KEY`,
`createSelectColumn` are all exported for hosts assembling their own filter or editor UI out of
the grid's own parts.

---

## Helpers

Exported because the grid uses them and a host reproducing the grid's own behaviour elsewhere
should not have to reimplement them.

| Export | Does |
|---|---|
| `formatDisplayValue(value, format?)` | What a cell shows, for a `DisplayFormat`. |
| `defaultCompare(propertyKey?)` | The comparator the grid sorts by. |
| `filterRows(rows, columns, searchString?, filters?)` | The whole filter pass. Returns the *same array* when nothing filters. |
| `columnDisplayValue(column, row)` | The plain-text projection used for sort, filter and copy. |
| `rowsToCsvText(rows, columns, withHeaders?, tabDelimiter?)` | What `Ctrl+C` produces. |
| `defaultValidate(column, row, value)` | The coercion applied when a column has no `validate`. |
| `gridBoolean(v)` / `falseString(v)` | The grid's truthiness for boolean columns. |
| `detectColumnWidth` / `detectColumnWidths` | Content-based width detection. |
| `inferColumns` / `inferGetRowKey` / `inferRowKeyProperty` | What the grid infers from the rows. |
| `validateFilters` | The normalization `setFilters()` applies. |
| `recordsToCsv` / `csvToRecords` | Dependency-free CSV/TSV, Excel-compatible. |
| `injectStyles(document?)` / `avGridCss` / `AVGRID_STYLE_ID` | The stylesheet, if you would rather place it yourself. |
| `Observable` / `Model` / `Subscription` / `AsyncRef` | The framework-free primitives the models are built on. |

---

## The engine

The virtualization engine is exported and usable with no grid on top — `RenderGrid`,
`RenderGridModel`, `CellPool`, `calcRenderInfo`, `prepareRerender`. That is how the 100k-row
benchmark harness in `test-boards/RenderGridTest/` drives it.

```js
import { RenderGrid } from "av-grid";

const engine = new RenderGrid(host, {
    rowCount: () => 100_000,
    columnCount: () => 20,
    rowHeight: 24,
    height: "100%",
    renderCell: (p) => {
        const el = p.previous ?? p.recycle?.() ?? document.createElement("div");
        el.className = "my-cell";
        el.textContent = `${p.row}:${p.col}`;
        return el;
    },
});
```

`grid.render.stats` reports `paints`, `cellsAppended`, `cellsRemoved`, `lastPaintMs`,
`totalPaintMs` and the pool's hit/miss counts — which is how any change to the render path is
judged.

**A cell renderer must resolve its element in this order:**

```js
const el = p.previous ?? p.recycle?.() ?? document.createElement("div");
```

`p.previous` is the element already at this coordinate, present when the cell went dirty rather
than scrolled in — updating it in place means the paint does no DOM insertion or removal, and
anything living on the element survives. `p.recycle()` is an element evicted on an earlier frame;
it comes back **dirty**, exactly as its last occupant left it, so overwrite every property you
set. Dropping `previous` costs ~12× on full repaints; dropping `recycle` allocates on every scroll
frame.

---

## Errors and warnings

**`AVGridError`** is thrown — synchronously, from `create()` or the setter — for input the grid
cannot use at all: a container that does not resolve, `rows` that is not an array, a column with
no `key`, a sort naming a column that does not exist. The message names the option, says what was
wrong, and lists what was available:

```
AVGridError: columns[2] has no `key`. Every column needs one: { key: "name", name: "Name" }.
```

**`console.warn`** is used where the grid can carry on: a column filter naming a column that does
not exist, a `setOptions({ filterBar: true })` on a grid created without one, an `options`
provider that rejects, and any mutating call on a destroyed grid (once per grid, not once per
call).

Both are deliberate. The grid is written for an agent, and an agent's debugging loop is expensive:
a silent no-op costs far more than a loud message.

---

## Performance notes

The measured numbers, and the history behind them, are in
[`../tasks/benchmark-results.md`](../tasks/benchmark-results.md). What matters when *using* the
grid:

- **The host needs a definite height.** This is the single commonest reason a grid renders blank.
  `getState().viewport.width === 0` says so.
- **Row keys should be cheap and stable.** `getRowKey` is called a lot. A property read is ideal;
  a `JSON.stringify` is not.
- **`formatValue` sits inside the row loop** for search and filtering. A full-text search over
  100,000 rows costs about 8.7% more with one installed — worth it for a computed column, not
  worth it for something a plain property would answer.
- **`getSelectedRows()` and `getSelection().rows` are O(rows).** Call them when you need the
  objects; use `getSelected()` or `getState().selectedCount` when you need to know how many.
- **`refresh()` is cheap** — a full repaint of every visible cell does zero DOM mutations — but it
  is only needed for data mutated behind the grid's back. Every API path repaints itself.
- **Mutating a row object directly does not repaint.** Call `refresh()`, or go through
  `setCellValue()`.
- **`rows` is not copied.** The grid reads the array you gave it and writes edits into the row
  objects; hand it a fresh array through `setRows()` rather than mutating its length.
