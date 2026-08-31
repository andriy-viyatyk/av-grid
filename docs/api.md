# av-grid API reference

A dependency-free, framework-agnostic virtualized data grid that renders straight to the DOM.
Built for 100,000+ rows with no lag while scrolling, selecting or editing.

This page is the complete public surface. It is written to be read once, mid-task, to answer one
question — so it is exhaustive and skimmable, and every entry carries the snippet you would
actually type. Runnable standalone files live in [`../examples/`](../examples/).

> **av-grid is not AG Grid.** The names differ by one character and nothing else does: av-grid
> shares no API, no options and no lineage with it. There is no `columnDefs`, no `rowData`, no
> `createGrid`, no module registration. If you are filling a gap from memory, fill it from this
> page — a half-remembered AG Grid call is *plausible and wrong*, which is the expensive kind of
> mistake. The UMD global is `AVGrid`, capital V.

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
| `editFormater` | `editor` (a `CellEditor` factory, not a renderer — see [`editor`](#editor--a-custom-cell-editor)) |
| `editRender` | `editor` — this library's own earlier name for the same field, removed because it could not work: it was handed a `CellContext`, so whatever it drew had no way to record a value, commit it or cancel |
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

> **Writing React?** Read [`react-api.md`](react-api.md) instead — the same grid as a
> component, with everything on this page available as props. This page stays framework-free.

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
| `focus` | `CellFocus<R> \| null` | `null` | The focused cell and the range around it. Keys alone are enough; `selection` may be omitted for a single cell. The same value `onFocusChange` reports, and safe to hand straight back — see [Focus and range selection](#focus-and-range-selection). |

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
native `<select>`, and one with [`editor`](#editor--a-custom-cell-editor) opens whatever you
build. Per-column opt-outs: `readonly: true`, and any `isStatusColumn`.

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
| `addRowLabel` | `string` | `` `add ${rowNoun}` `` | Text on the add-row button. Overrides `rowNoun` for the button. |
| `rowNoun` | `string` | `"row"` | What this grid calls one of its rows, **singular** — the grid pluralises it. Feeds the three row items in the context menu and the add-row button. Columns are unaffected. |
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
| `fitToWidth` | `boolean` | `false` | Stretch the columns to fill the width instead of scrolling horizontally. Not needed when a column has a percentage [`width`](#width) — that fills the width on its own. |
| `cellBorders` | `boolean` | `true` | `false` gives a borderless list look. |
| `growToHeight` | `string` | — | CSS height cap: the grid grows to its content up to this, instead of filling its parent. |
| `growToWidth` | `string` | — | The same, horizontally. |
| `overscanRow` | `number` | `4` | Extra rows rendered outside the viewport. |
| `overscanColumn` | `number` | `1` | Extra columns. |
| `whiteSpaceY` | `number` | `20` | Height of the slack below the last row, so the final row can scroll clear of the edge. `0` removes it; raise it to make room for an `extraElement`. With [`footerRows`](#rows-pinned-to-the-bottom--footerrows) the default becomes `0` — the band is what the last row clears — but an explicit value is still honored, as room between the last data row and the band. There is deliberately no `whiteSpaceX` — see the note below. |

**No `whiteSpaceX`.** The horizontal slack interacts with `fitToWidth` and percentage column widths
through the column-fitting arithmetic, which has already produced one spurious horizontal
scrollbar; a second control over it, with nothing asking for one, is how that comes back. Ask if
you need it.

### Presentation

| Option | Type | Default | Notes |
|---|---|---|---|
| `className` | `string` | — | Extra class on the root, for host styling. |
| `name` | `string` | — | Debug label, emitted as `data-name` on the root and reported by `getState().name`. Never used for styling. |
| `injectStyles` | `boolean` | `true` | Inject the stylesheet on first use. `false` if you link `av-grid.css` yourself. |
| `extraElement` | `HTMLElement \| null` | — | One host element placed after the last row, scrolling with the content. See [An element after the last row](#an-element-after-the-last-row). |
| `footerRows` | `readonly R[]` | — | Rows pinned to the bottom — a grand total, a subtotal band. See [Rows pinned to the bottom](#rows-pinned-to-the-bottom--footerrows). |
| `footerRowClass` | `(row: RowContext<R>) => ClassValue` | — | Extra class names for footer-row cells, alongside `avg-footer-cell`. `rowIndex` is the index into `footerRows`. |
| `onCellClass` | `(cell: CellContext<R>) => ClassValue` | — | Extra class names for a cell, on top of the built-in state classes. The grid-wide arm of `Column.cellClass`. Data cells only — never a footer cell. |
| `rowClass` | `(row: RowContext<R>) => ClassValue` | — | Extra class names for every cell of a row — how a whole row is highlighted. Data rows only; footer rows have `footerRowClass`. |

```js
AVGrid.create(el, {
    rows,
    onCellClass: (cell) => (cell.value === null ? "missing" : undefined),
    rowClass: (r) => (r.row.overdue ? "overdue" : undefined),
});
```

### The four class hooks

Four hooks add class names, narrowest to widest. All are additive — they never replace the
built-in state classes — and all accept the same `ClassValue`: a string, an array (falsy entries
dropped, so `[a && "x", b && "y"]` works), or nothing.

| Hook | Where | Receives |
|---|---|---|
| `Column.cellClass` | one column's data cells | `CellContext<R>`, or a constant `string` |
| `Column.headerClass` | one column's header cell | `HeaderContext<R>`, or a constant `string` |
| `onCellClass` | every data cell | `CellContext<R>` |
| `rowClass` | every cell of a row | `RowContext<R>` — `{ row, rowIndex, rowKey }` |

```js
columns: [
    { key: "status", cellClass: (c) => `status-${c.value}` },
    { key: "score",  cellClass: (c) => (c.value < 50 ? "low" : undefined) },
    { key: "note",   cellClass: "wrap", headerClass: "wrap" },
]
```

**⚠ Your rule has to out-specify `.avg-data-cell`.** The stylesheet is injected during
`create()`, so it lands *after* the page's own `<style>`, and `.avg-data-cell` setting `color` is
exactly as specific as a bare `.low`. Write the cell class into the selector:

```css
.avg-data-cell.low      { color: #c00; }
.avg-data-cell.overdue  { background: #fff4f4; }
.avg-header-cell.wrap   { white-space: normal; }
```

**There is no row element.** Rows are not wrapped — that is what keeps a one-row scroll to twelve
node touches — so `rowClass` puts its class on each of the row's cells, and a background rule on
the cell class colours the row.

**Cost.** A hook that is not supplied costs nothing: the `CellContext` is built only when
`render`, `onCellClass` or a *functional* `cellClass` needs one, and a constant-string `cellClass`
needs none. With all four live, a full repaint of every visible cell costs about 1.3× what a bare
grid's does — +0.012 ms — and still mutates **0** DOM nodes. `rowClass` runs once per *cell*, not
once per row, so keep it a property read rather than a search.

### Sorting and filtering

| Option | Type | Default | Notes |
|---|---|---|---|
| `sort` | `SortColumn \| SortColumn[] \| null` | `null` | The sort. Clicking a header cycles ascending → descending → none. **Arity follows `multiSort`**: a single object by default, an array with `multiSort: true`. A column sorts by `row[key]` unless it has a `sortValue` or a `rowCompare` — see [Sorting by something other than the value](#sorting-by-something-other-than-the-value). |
| `multiSort` | `boolean` | `false` | Sort by several columns at once — see [Multi-column sort](#multi-column-sort--multisort). |
| `searchString` | `string` | — | Free-text filter. Every whitespace-separated word must appear in some column's *displayed* value — so a computed column with `formatValue` is searchable too. |
| `highlightSearch` | `boolean \| "text" \| "background" \| "both"` | `true` | Mark the matched words inside the cells. See [Search highlighting](#search-highlighting). |
| `highlightString` | `string` | — | Extra words to mark, **filtering nothing**. For words that came from outside this grid. See [Search highlighting](#search-highlighting). |
| `filters` | `Filter[]` | `[]` | Applied column filters. See [Filtering](#filtering). |
| `persistFilters` | `PersistFiltersOptions` | — | Remember the filters across reloads. Passing this **is** the consent to write. |
| `onGetOptions` | `GetFilterOptions<R>` | — | Supply the options a filter popover offers, instead of the column's distinct values. May return a promise. |
| `disableSorting` | `boolean` | `false` | |
| `disableFiltering` | `boolean` | `false` | Take the funnel off every header. One column opts out with `filterType: null`. |
| `filterBar` | `boolean` | `false` | A bar of removable filter chips directly above the grid. Read at `create()`. |

### Multi-column sort — `multiSort`

```js
AVGrid.create(el, {
    rows,
    multiSort: true,
    sort: [{ key: "region", direction: "asc" }, { key: "spend", direction: "desc" }],
    onSortChange: (sort) => console.log(sort),   // always an array here — [] when unsorted
});
```

**Arity follows the option.** With `multiSort: false` (the default) `sort`, `getSort()` and
`onSortChange` hold one `SortColumn | undefined`, exactly as before the option existed. With
`multiSort: true` they hold a `readonly SortColumn[]` — `[]` when unsorted, first element sorts
first. No consumer handles a union at runtime; passing an array without `multiSort` is a
validation error that names the fix.

**The gesture.** A plain header click resets the sort to the clicked column (cycling
ascending → descending → none when it is already the only sorted column, as always).
**Ctrl+click — or Cmd+click on macOS, where Ctrl+click is the context-menu gesture — appends**:
the first Ctrl+click adds the column ascending, the second flips it to descending, the third
removes it from the list, and the other sorted columns stay put throughout. When two or more
columns sort, each sorted header shows its position number beside the arrow (`.avg-sort-pos`);
with one, the header is pixel-identical to the single-sort look. `aria-sort` stays on the
primary column only, per the ARIA recommendation.

`Column.sortValue` keeps its once-per-row contract in a multi-sort (the levels decorate into one
tuple per row), and a level with a `rowCompare` compares rows pairwise as always. Ties at every
level keep source order — the composite sort is stable.

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

    cellClass?: string | ((cell: CellContext<R>) => ClassValue);      // extra classes, this column
    headerClass?: string | ((header: HeaderContext<R>) => ClassValue);

    render?: CellRenderer<R>;       // custom cell content
    headerRender?: HeaderRenderer<R>;
    editor?: CellEditorFactory<R>;  // the control this column is edited with

    formatValue?: (column: Column<R>, row: R) => string;  // plain-text projection: screen/search/filter/copy
    copyValue?: (cell: CellContext<R>) => any;            // what this column copies, overriding all of the above

    dataType?: "string" | "number" | "boolean";
    displayFormat?: DisplayFormat;
    align?: "left" | "center" | "right";

    resizable?: boolean;
    readonly?: boolean;
    pinned?: "left" | "right";      // stick to an edge; "right" columns must be the trailing run
    isStatusColumn?: boolean;       // the older spelling of pinned: "left"
    group?: string;                 // the label drawn over this column — the two-row header

    sortValue?: (row: R) => any;                 // the value this column sorts by, read once per row
    rowCompare?: (left: R, right: R) => number;  // ...or the comparison itself; wins over sortValue
    filterType?: "options" | null;  // default "options"; null takes the funnel off
    filter?: FilterDefinition<R>;   // a filter type of your own, in place of the checklist

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

### Customization, at a glance

Seven hooks cover what a host normally reaches for. Each is additive: it extends the built-in
behaviour rather than replacing it, and a hook you do not supply costs nothing — the context
object it would receive is not even allocated.

| I want to… | Hook | Where |
|---|---|---|
| colour one column's cells | `Column.cellClass` | [the four class hooks](#the-four-class-hooks) |
| colour one column's header | `Column.headerClass` | [the four class hooks](#the-four-class-hooks) |
| colour a whole row | `rowClass` (an option) | [the four class hooks](#the-four-class-hooks) |
| draw the cell differently | `Column.render` | [`render`](#render--custom-cell-content) |
| edit it with my own control | `Column.editor` | [`editor`](#editor--a-custom-cell-editor) |
| filter it my way | `Column.filter` | [`column.filter`](#columnfilter--a-filter-type-of-your-own) |
| sort it my way | `Column.sortValue` / `rowCompare` | [sorting by something else](#sorting-by-something-other-than-the-value) |
| copy something other than what it shows | `Column.copyValue` | [`copyValue`](#copyvalue--what-a-cell-copies) |

[`examples/10-customization.html`](../examples/10-customization.html) is all of them in one
runnable file.

### `render` — custom cell content

```js
{ key: "score", render: (cell) => `<b>${cell.value}</b>` }
```

Return an **HTML string** (the common case), a **DOM element** (when you need to attach a
listener, or when you already hold the node), or `null` / `undefined` for an empty cell. The string
form inserts markup as-is — boards are sandboxed, but the caller still owns escaping untrusted
values.

The element arm is typed **`Element`**, not `HTMLElement`, so an `<svg>` built with
`document.createElementNS` is a legal return — an icon column is the most common reason to return an
element at all, and in TypeScript's DOM types `SVGElement` is a *sibling* of `HTMLElement`, not a
subtype. `Column.headerRender` takes the same three arms, for the same reason. `Column.editor` is
deliberately narrower (`HTMLElement | CellEditor`): the grid focuses an editor and reads its value.

Handing back the **same node** across paints is supported and is how an icon column should work: the
element branch clears the cell and appends what it is given on every paint, so a renderer that
caches per row keeps one node alive instead of rebuilding it. (The string branch skips an unchanged
write; the element branch cannot, because it never sees the previous return value.)

`CellContext` is small and flat on purpose:

```ts
interface CellContext<R = any> {
    value: any;        // row[column.key], before formatting
    row: R;
    column: Column<R>;
    rowIndex: number;  // index into the *displayed* rows
    colIndex: number;
    rowKey: string;
    highlight: (text: unknown) => string;   // escape, and mark the search words
}
```

**`highlight` is how a `render` column joins in the search highlighting.** A default cell marks
the matched words itself, but this column's markup is yours — the grid will not reach inside it —
so a computed column looks unmarked beside the plain one it was computed from. One call fixes it:

```js
{ key: "full", name: "Full Name",
  render: (c) => c.highlight(`${c.row.firstName} ${c.row.lastName}`) }
```

Use it unconditionally. With no search, or with `highlightSearch: false`, it is the escaped text
— so a column does not half-opt-out of a feature the grid was told to turn off. And because **it
escapes**, it is the right way to put any untrusted value into a `render` string, search or no
search. Mark the text, then wrap it: `` `<b>${c.highlight(name)}</b>` `` works; the other way
round, `c.highlight("<b>" + name)`, escapes the tag and shows it. For text the grid never sees —
a summary line, a panel beside it — the same thing is exported as
[`highlightText(text, searchString)`](#helpers).

A cell with `render` is still **sorted, searched and filtered by its raw value** — `render` output
is never parsed for those. `formatValue` is the plain-text projection search and filtering use, and
a computed column (no row property at all) needs it to take part in them; sorting is the one that
`formatValue` does *not* reach — give the column a `rowCompare` instead. Copy has its own hook,
`copyValue`, and its own order. All of it in one table below.

### `copyValue` — what a cell copies

For the cell whose screen form is not what belongs in a spreadsheet: a bar, a badge, an icon, a
colour swatch.

```js
{
    key: "status",
    render: (c) => `<span class="dot ${c.value}"></span>${c.value}`,
    copyValue: (c) => c.value,
}
```

It receives the same `CellContext` as `render` and is used by **every** copy path — ctrl+C,
ctrl+X, all four Copy as… modes and `getSelectionText()` — so they cannot disagree. The return
value is not stringified on the way out, so `copyAsJson` keeps a number a number.

Copy only. There is no `pasteValue`: `validate` already coerces an incoming value on typing,
pasting and range-delete alike, and a paste-only hook would be a second place to do one job.

### Which hook feeds what

Six consumers read a cell, and they do not all read it the same way. Left to right is the order
each one tries; the first hook present wins.

| Consumer | Order |
|---|---|
| **What the cell shows** | `render` → the checkbox/tick (`dataType: "boolean"`) → `formatValue` → `displayFormat` → `row[key]` |
| **Sorting** | `rowCompare` → `sortValue` → `row[key]`; whichever value is reached is compared by its runtime type (number, string via `localeCompare`, `Date` by instant, boolean, nullish first) |
| **The search box** | `formatValue` → `displayFormat` → `row[key]` |
| **A filter's row test** | `filter.match(value, row, column)` when the column has a custom `filter`, which reads whatever it likes; otherwise `formatValue` → `row[key]` |
| **A filter's option list** | values from `formatValue` → `row[key]`; each label through `displayFormat` |
| **Copy** | `copyValue` → `formatValue` → `displayFormat` → text of `render` → `row[key]` |
| **Paste** | `validate` → `defaultValidate` for the column's `dataType` |

Two rows in that table surprise people, and both are deliberate:

- **Copy prefers `formatValue` over `render`; the screen prefers `render`.** A `formatValue` is
  already the plain text a spreadsheet wants, so copy takes it rather than reducing a fragment of
  markup to find the same string. A column that wants the *rendered* text copied says so with
  `copyValue`.
- **Sorting reads neither `formatValue` nor `displayFormat`.** It compares `row[key]` directly, so
  a computed column — one with no row property — does not sort at all until you give it one of the
  two sort hooks below.

### Sorting by something other than the value

Two hooks, and the first one is the answer nine times out of ten.

```js
const RANK = { critical: 0, high: 1, normal: 2, low: 3 };

columns: [
    { key: "priority", sortValue: (row) => RANK[row.priority] },       // a projection
    { key: "name", rowCompare: (a, b) => collator.compare(a.name, b.name) },  // a comparison
]
```

**`sortValue: (row) => any`** — the value this column sorts by, in place of `row[key]`. Whatever it
returns is compared the way the grid compares anything, so a projection to a number, a string or a
`Date` all work, and rows whose value is `null` or `undefined` land at the ascending end.

**`rowCompare: (left, right) => number`** — for an order that is genuinely pairwise: a collator with
options, a natural sort, a tie-break across two properties. It wins where both are set.

Both sort **ascending**; a descending header click reverses the result, so neither hook ever sees
the direction. Neither is affected by `dataType`.

**Prefer `sortValue`, and not only because it is shorter.** `Array.sort` calls a comparator
O(n log n) times — 1.2 million times for 100,000 rows, counted — so a projection written inside a
`rowCompare` runs that many times too. `sortValue` is read **once per row** into a parallel array
which is then sorted and unwrapped: 100,000 calls, whatever the row count's logarithm.

How much that is worth depends on what the projection does. Measured on 100,000 rows, both forms
producing the same order:

| The projection | `sortValue` | the same thing inside `rowCompare` |
|---|---|---|
| A table lookup (`RANK[row.status]`) | **10.3 ms** | 10.8 ms |
| Two `toLowerCase()` and a concat, compared with `localeCompare` | **17.5 ms** | 46.9 ms |

A lookup that cheap is roughly a wash — the transform allocates one wrapper per row, and that pays
for most of the twelvefold drop in calls. The moment the projection does real work it is **2.7×**
faster, and it never loses. Sorting is not on the paint path either way: the grid repaints once when
the order changes.

### `dataType`

Governs coercion on edit and the editor: `"number"` commits through `Number()`, and `"boolean"`
replaces the text editor with a checkbox and a toggle gesture. It does **not** govern the sort — the
comparator dispatches on each value's runtime type, so a numeric column whose values are strings
sorts as strings whatever its `dataType` says. Give it a `sortValue` if that is wrong.

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

### `pinned`

Pin a column to an edge, so it stays put while the rest scrolls horizontally.

```js
columns: [
    { key: "member", name: "Member", pinned: "left" },
    { key: "jan" }, { key: "feb" }, /* … many more … */
    { key: "total", name: "Total", pinned: "right", align: "right" },
    { key: "actions", name: "", pinned: "right", width: 40, filterType: null },
]
```

Pinning is **positional**, both sides. Left: every column up to and including the last
left-pinned one is sticky — put them first. Right: the pinned columns must be the **trailing**
run of the array — a `pinned: "right"` column followed by an unpinned one is a validation
error naming both keys. A `hidden` pinned column just shortens its run.

The two edges mean different things:

- **`pinned: "left"` marks chrome** — it is the newer spelling of `isStatusColumn: true`
  (below), with every consequence in that table: not focusable, not editable, not copied, no
  header affordances.
- **`pinned: "right"` is a data column that happens to be sticky** — a total, an actions
  cell. It sorts, filters, edits, copies (in visible order, with no coordinate seam at the
  band boundary) and resizes like any other column. Its resize grip sits on its **left** edge,
  because its right edge is anchored to the viewport, and it can be drag-reordered **within
  the pinned band only** — a drop that would cross the boundary shows no indicator and is
  refused.

A pinned column needs a **fixed** `width`: a percentage is resolved by stretching the
scrolling columns to fit, which the pinned bands are excluded from, so a percentage width on a
pinned column is a validation error. `data-col` is the column's real index into the visible
columns — it is **not** renumbered inside a band.

### `isStatusColumn`

Marks a column as **chrome rather than data** — a row number, a checkbox, a drag handle. The
older spelling of `pinned: "left"`; both work, and they mean exactly the same thing. The
selection column `selectColumn: true` adds is one, and a host writes its own the same way:

```js
{ key: "__row", name: "", width: 48, isStatusColumn: true, render: (c) => String(c.rowIndex + 1) }
```

One flag, and the column steps out of everything that treats a column as data:

| | |
|---|---|
| **Pinned** | Every column up to and including the last status column is sticky-left, so they stay put while the rest scrolls. This works off *position*: put them first in the array. |
| **Not focusable** | A press does not move the cell focus or start a range drag. The click still arrives, which is how the checkbox toggles. |
| **Skipped by focus fallback** | Focus landing on a row with nothing better lands on the first column that is not one. |
| **Never edited** | Excluded from `editable` regardless of `readonly`, and from `firstEditable`. |
| **Never copied** | Left out of Ctrl+C, `copySelection()` and the CSV projection — so a copied range pastes into a spreadsheet without a row-number column glued to the front. |
| **No header affordances** | No sort, no funnel, no resize grip, not draggable to reorder; the context menu drops its add/delete-column items. |
| **No data behind it** | Exempt from the "unknown column" check, so the `key` need not exist on the row — give it a `render`. |

### `group` — two-level headers

```js
columns: [
    { key: "member", name: "Member" },                 // no group: one tall header cell
    { key: "q1_spend", name: "Spend", group: "Q1" },
    { key: "q1_pmpm",  name: "PMPM",  group: "Q1" },
    { key: "q2_spend", name: "Spend", group: "Q2" },
    { key: "q2_pmpm",  name: "PMPM",  group: "Q2" },
]
```

Put the same `group` string on the columns that belong together and the header becomes two rows:
a group cell spanning those columns on top, the column headers below. **There is no switch to
remember** — the band appears as soon as any visible column carries a `group`, and goes away with
the last one. A column without a `group` spans both rows as one tall cell, which is what a label
column wants anyway.

The rules, all chosen so the option cannot be half-applied:

| | |
|---|---|
| **Order is normalized** | Columns of one group are gathered together if the array interleaves them — stable, each group anchored where it first appears. `getColumns()` returns the normalized order. |
| **Reorder is off** | While groups are shown, no header is draggable: a grouped order is a prepared view. Sort, filter, resize and `hidden` all still work; a hidden column just shrinks its group, and hiding all of a group's columns removes its cell. |
| **Pinned columns cannot be grouped** | `pinned` (either edge, either spelling) plus `group` is a validation error — the sticky corners keep their plain tall headers. |
| **Groups do not nest** | Two levels, full stop. |
| **Affordances stay on the leaf header** | A group cell has no sort, no funnel, no resize grip. It shows its `group` string, or what the hooks below return. |

Two grid options shape the cells:

```js
AVGrid.create(el, {
    rows, columns,
    columnGroupRender: ({ group, columns }) => `${group} <small>(${columns.length})</small>`,
    columnGroupClass:  ({ group }) => (group === "Q2" ? "period-current" : undefined),
});
```

`columnGroupRender` returns a string (treated as HTML), an element, or `undefined` to keep the
default label. `columnGroupClass` adds classes to `.avg-group-cell`. Both receive
`{ group, columns }` — the label and the visible columns under the cell.

Group cells are **not pooled cells**: they are a handful of overlay divs painted once per group
(not once per column), positioned by the engine's own column geometry so they stay pixel-aligned
under percentage widths and `fitToWidth`, and they cost a scroll frame nothing. They carry
`data-type="group-cell"` and `data-group` for CSS and tests, and are `aria-hidden` — the header
row's ARIA semantics are unchanged by the band.

### `width`

A number of pixels, or a percentage string (`"25%"`). A user resize overrides it and is reported
through `onColumnResize`; `getState().columns[i].width` reports what the grid is actually drawing.

**Omitted, the width is detected from the content** — the header label and the first 50 rows,
measured as the cell will *display* them, so a `formatValue` or a `displayFormat` is what counts
and not the raw value behind it. Detection applies whether the columns were inferred or you wrote
them out yourself, and is bounded to 60–300 px. Two cases fall back to a flat 140 px, because
there is nothing to measure: a grid created before its rows arrive, and a column with no value in
any sampled row — including the one `addColumns()` has just made.

The measurement is by character count, not by text metrics; laying out the rows to size a column
would cost more than the first paint. If a column has to be exact, give it a `width`.

**A percentage is measured against the width left over after the fixed columns and the vertical
scrollbar**, and it re-resolves on every resize. One is enough to make the grid fit its container:
the percentage columns divide whatever remains, so there is no horizontal scrollbar and no
[`fitToWidth`](#layout) needed. Set `fitToWidth` as well only to stretch a set of columns that
are *all* fixed widths.

### `validate`

```js
{ key: "score", dataType: "number", validate: (col, row, value) => Math.max(0, Number(value)) }
```

Return the value to commit. Return `undefined` to reject the edit, which fires `onInvalidEdit`.
With no `validate`, `defaultValidate` coerces to `dataType`: `"number"` through `Number()`
(rejecting `NaN`), `"boolean"` treating `"false"` / `"no"` / `"0"` as false, and a column with an
`options` array rejecting anything not in it.

### `editor` — a custom cell editor

The control the column is edited with, in place of the text box or the dropdown: a date picker, a
colour swatch, a lookup that queries a server. Return an element and you are done.

```js
{
    key: "due",
    editor: (ctx) => {
        const input = document.createElement("input");
        input.type = "date";
        input.value = ctx.value ?? "";
        input.addEventListener("input", () => ctx.setValue(input.value));
        input.addEventListener("blur", () => ctx.commit());   // your call — see below
        return input;
    },
}
```

What the grid does for you, so the snippet above is the whole editor:

- **Positions it.** `avg-cell-editor` is added to whatever classes you set, which fills the cell
  and inherits its font and colours. Style further with your own class alongside it.
- **Binds `Escape` and `Tab`.** Escape cancels, Tab commits and moves the focus to the next cell.
  Handle either yourself and call `preventDefault()`, and the grid stands aside.
- **Keeps the grid's keys and clipboard out of it.** Arrow keys move your caret, not the cell
  focus; `ctrl+C` copies your text, not the cell range.
- **Tears it down** on commit, on cancel, when the focus leaves the cell, when the row scrolls far
  enough out of view, and on `grid.destroy()`.

**What is yours to decide is when a blur commits.** The built-in text box commits on blur, because
clicking away from a half-typed value should keep it. An editor that opens a panel — a calendar, a
colour picker, a list — must *not*, or it closes the instant its own panel takes the focus. That is
why the policy lives in the editor rather than in the grid.

`EditorContext`, the argument:

| Field | Type | What it is |
|---|---|---|
| `value` | `any` | The current edit value: the typed character for a type-to-edit, else the cell's value. |
| `row` | `R` | The row object. |
| `column` | `Column<R>` | This column. |
| `rowIndex` / `colIndex` | `number` | Position in the *displayed* rows and columns. |
| `rowKey` | `string` | The row's key. |
| `openedBy` | `"key" \| "pointer" \| "typing"` | How the edit started — where a caret should land. |
| `pointerX` | `number \| undefined` | Client x of the click, when `openedBy` is `"pointer"`. |
| `setValue(v)` | | Record a value. Does not write it: a commit does. |
| `commit()` / `cancel()` | | End the edit, with or without writing. |
| `commitAndPass(e)` | | Commit and hand the key back to the grid, which is how Tab moves on. Rarely needed — the grid already does this for Tab. |

Return `{ element, focus?, destroy? }` instead of a bare element when the editor owns something
beyond that element:

```js
editor: (ctx) => {
    const button = document.createElement("button");
    const panel = buildCalendar(ctx, document.body);       // lives outside the grid
    return {
        element: button,
        focus: () => button.focus(),                        // default is element.focus()
        destroy: () => panel.remove(),                      // your only chance to clean up
    };
}
```

The value goes through `validate` (or the column's `dataType` coercion) on commit exactly as a
typed one does, so an editor may hand back any type: a `Date`, a number, an object.

A column with an `editor` opens it **whatever its `dataType`** — including `boolean`, which
otherwise toggles rather than opening anything, and which then shows a tick instead of a checkbox
so that a press reaches the editor.

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
| `getSort()` | `SortColumn \| undefined` — or `SortColumn[]` (`[]` when unsorted) with `multiSort: true` |
| `setSort(sort \| undefined)` | `void`. Takes the same arity the grid reports — see [Multi-column sort](#multi-column-sort--multisort) |
| `getSearchString()` | `string \| undefined` |
| `setSearchString(text \| undefined)` | `void` |

```js
grid.setSort({ key: "score", direction: "desc" });
grid.setSort(undefined);            // unsorted
grid.setSearchString("lovelace");   // across every column's displayed value
```

### Search highlighting

The words that kept a row are marked inside its cells, so it is visible *why* each row survived
a search. It is on by default and needs nothing:

```js
grid.setSearchString("ada lovelace");   // both words marked wherever they appear
```

Each whitespace-separated word of `searchString` is marked wherever it appears in a cell's
**displayed** text, case-insensitively, in `--avg-search-match` — the accent colour unless a
host changes it. `highlightSearch` picks the shape, or turns it off:

| Value | What a match looks like |
|---|---|
| `true` (default), `"text"` | The letters in the accent colour |
| `"background"` | A tint behind the letters, their own colour untouched |
| `"both"` | Both |
| `false` | Nothing. Rows filter exactly as before |

```js
AVGrid.create(el, { rows, searchString: "ada", highlightSearch: "both" });
grid.setOptions({ highlightSearch: false });    // any time, not only at create()
```

**Which one is right depends on the host's accent, and there is no recommending it in advance.**
The default is the colour alone; change it only if asked, or if you have looked. A pale accent
can read *dimmer* than the text around it, which a tint fixes; a saturated one makes the tint a
solid block behind text of nearly its own colour, which is worse than the default — that is a
real report, from a dark theme where `"both"` lost to plain `"text"`. Two screenshots settle it
in a way reasoning about the theme does not. The one shape with a reason of its own is
`"background"`: on a column that carries its own colours — a status, a rating — it marks without
recolouring text whose colour already means something.

What is and is not marked:

- **The displayed text**, so a `formatValue` or a `displayFormat` column marks what is on
  screen rather than the value behind it — the same text the search matched against.
- **Not a `render` column — until it asks.** The host owns that markup, and the grid will not
  parse what a hook returned. Such a column still *matches* and its row still survives; to mark
  it too, call `c.highlight(text)`, which escapes the text and marks the same words the rest of
  the grid is marking:

  ```js
  { key: "full", render: (c) => c.highlight(`${c.row.firstName} ${c.row.lastName}`) }
  ```

  It is safe with no search and honours `highlightSearch: false`, so it needs no guard. See
  [`render`](#render--custom-cell-content).
- **Not a boolean column**, which shows a tick rather than text, and **not the open editor**.
- A value that looks like markup is escaped: a cell holding `<b>ada</b>` shows those characters
  and marks the `ada` between them.

Overlapping words merge into one run rather than nesting: searching `"an ana"` against
`"banana"` marks `anan` once.

#### Two sources of words: `searchString` and `highlightString`

`searchString` does two things — it narrows the rows *and* marks the words that kept them. That is
right for a box the user is typing into, and wrong when the words came from somewhere this grid is
not: a search-results panel that navigated the user here, a URL fragment, a filter applied
upstream. There the rows are already the right rows, and hiding the ones that happen not to contain
the term is a bug. `highlightString` marks and filters nothing.

```js
AVGrid.create(el, { rows, highlightString: "connection refused" });
grid.setOptions({ highlightString: term });   // works here too
```

**The rule: `searchString` when the user is searching *this* grid, `highlightString` when the words
came from outside it.**

Both may be set at once and the marked set is their **union** — a live search box over a grid
arrived at from a search result marks both terms. `highlightSearch` governs both: its shapes apply
to either source, and `false` silences both. `c.highlight()` marks both too, so a `render` column
does not go unmarked beside a plain one.

Cost, on the 100k-row board with a search active: **60 fps scrolling and a full repaint of every
visible cell in 0.1 ms with 0 DOM mutations** — the same numbers as with no search. A cell with
no match never leaves the plain-text path, and the shape is one attribute on the root, so
switching between `"text"`, `"background"` and `"both"` repaints nothing.

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
| `startEdit(rowIndex, colIndex)` | `void` | Opens with the value selected. No-op when the grid is not `editable`, the column is `readonly`, or the column is a boolean **without an `editor` of its own**. |
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

That split would matter in a host that suppresses the native event: `Ctrl+C` would reach the grid
as a `keydown` with no `copy` event behind it, and nothing would be written. **No such host has
turned up yet** — the one that was reported, a Persephone board iframe, was retested by hand and
copies fine. Before you conclude you have found one, read
[Driving the grid from an agent](#driving-the-grid-from-an-agent): a **synthetic** `keydown` never
produces a `copy` event on any browser, so a harness that dispatches one reproduces the symptom
everywhere. Check `e.isTrusted` and `document.hasFocus()` first.

If you do land in such a host, bind the key yourself and take the other path:

```js
grid.element.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "c") return;
    e.preventDefault();                 // stop both paths running where the event does fire
    void grid.copySelection(e.shiftKey ? "copyWithHeaders" : "copy");
});
```


### Focus and range selection

| Method | Returns | Notes |
|---|---|---|
| `getFocus()` | `CellFocus<R> \| undefined` | The focused cell and the range anchored on it. |
| `setFocus(focus \| undefined)` | `void` | Keys alone are enough — the indices are optional. Identical to `setOptions({ focus })`. |
| `clearFocus()` | `void` | |
| `focusCell(rowIndex, colIndex, withScroll?)` | `void` | Discards any selection. |
| `selectRange(rowStart, colStart, rowEnd, colEnd)` | `void` | The focus lands on the end corner, as after a drag. |
| `getSelection()` | `GridSelection<R> \| undefined` | The selected rows and columns, with their index ranges. |
| `focus()` | `void` | Give the grid keyboard **DOM** focus, so arrow keys reach it without a click first. The focused cell and the selection are untouched — this is `grid.element.focus({ preventScroll: true })` and nothing else. Rarely needed: any press inside the grid already does it, unless the press lands on a control that takes focus itself — an open editor, or a `<button>` a `render` hook drew. |

**The focus is also an option**, so it can be restored at `create()` and driven from a host that
holds it in state:

```js
const grid = AVGrid.create(el, {
    rows,
    focus: JSON.parse(sessionStorage.getItem("focus")),      // keys are enough
    onFocusChange: (f) => sessionStorage.setItem("focus", JSON.stringify(f)),
});
```

**Echoing it straight back is safe.** Setting a focus equal *in value* to the current one does
nothing: no repaint, and no second `onFocusChange`. So the round trip *grid moves the focus →
`onFocusChange` → host state → `focus` → back in* terminates, which is what lets a framework
binding treat it as a controlled value. The same holds for `sort`, `filters` and `selected`.

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
| `revalidate()` | `void` | Re-check the scroll position after moving the grid in the DOM, and repair it if the browser discarded it. See [Surviving a host that moves the grid](#surviving-a-host-that-moves-the-grid). |
| `scrollToRow(row, align?)` | `Promise<void>` | `align`: `"top" \| "center" \| "bottom" \| "nearest"` (default). |
| `scrollToRowAfterPaint(row, align?)` | `void` | **Use this one when the row set has just changed.** See below. |
| `scrollToCell(row, col)` | `Promise<void>` | |
| `destroy()` | `void` | Release everything. Safe to call twice. |

`scrollToRow` / `scrollToCell` work before the grid has been laid out — they resolve once it has.

#### Scrolling right after the rows changed

`scrollTop` is clamped to the scrollable extent, and the extent is the content height, which the
grid writes **inside its next paint**. So scrolling in the same turn as a filter, a sort or a data
replacement scrolls against the *old* extent: the request is silently clamped, the list then paints
correctly and is simply at the wrong place, and nothing re-issues it.

```js
grid.data.setRows(filtered);
grid.scrollToRowAfterPaint(matchIndex, "center");   // not scrollToRow
```

Measured on a list grown from 20 rows to 3,000 in one turn and asked for row 2,000 — a request for
`scrollTop: 48000`:

| | lands at |
|---|---|
| `scrollToRow(2000)` | **100** — the entire old extent |
| the same call inside `setTimeout(0)` | **100** |
| the same call inside one `requestAnimationFrame` | **100** |
| `scrollToRowAfterPaint(2000)` | **48000** |

Neither deferral helps: `setTimeout(0)` lands after the microtask that recomputes the geometry but
before the frame that applies it, and a `requestAnimationFrame` registered at that moment runs
*before* the paint's own frame. Only the paint knows the extent is now real.

One request is held at a time and the newest replaces it, so calling this repeatedly while rows
churn scrolls once, to the row asked for last.

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
    hasEditor: boolean;             // the column supplies its own editor
    filterType: string | null;      // "options", a custom definition's name, or null
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
| `onSortChange` | After — one `SortColumn`, or an array with `multiSort: true` | — |
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

`FilterType` is `"options"` — the built-in checklist — or the `name` of a `FilterDefinition` you
put on the column. Do not write `type` by hand for a custom filter: it is taken from the column,
and a filter naming a type the column does not have is rejected.

### The funnel

Every column carries one by default. `filterType: null` takes it off one column,
`disableFiltering: true` off all of them. Clicking it opens a searchable checklist of that
column's distinct values, **cascaded against the other filters**, with select-all, Apply and
Clear. A column with 100,000 distinct values puts 12 rows in the checklist. Give the column a
`filter` definition and the same funnel opens that instead — see below.

### `column.filter` — a filter type of your own

A date range, a number range, a slider, a tag picker. You write the body of the popover; the grid
draws the panel around it, the Apply and Clear buttons, the chip, and the persistence.

```js
const dateRangeFilter = {
    name: "dateRange",
    create: (ctx) => {                       // the popover body
        const el = document.createElement("div");
        el.innerHTML = `<input type="date" data-from><input type="date" data-to>`;
        return {
            element: el,
            getValue: () => ({
                from: el.querySelector("[data-from]").value,
                to: el.querySelector("[data-to]").value,
            }),
        };
    },
    label: (value) => `${value.from || "…"} – ${value.to || "…"}`,   // the chip's text
    match: (value, row, column) => {                                 // keep the row?
        const v = row[column.key];
        return (!value.from || v >= value.from) && (!value.to || v <= value.to);
    },
};

AVGrid.create(el, {
    rows,
    columns: [{ key: "created", filter: dateRangeFilter }],
    filterBar: true,
});
```

**No registration call.** The definition is an object on the column; reuse across columns is a
shared `const`. There is no order of calls to get right, which is the same rule as everything else
in this API.

```ts
interface FilterDefinition<R = any> {
    name: string;                                          // stored as the filter's `type`
    create: (ctx: FilterBodyContext<R>) => FilterBody;
    label: (value: any, column: Column<R>) => string;
    match: (value: any, row: R, column: Column<R>) => boolean;
    serialize?: (value: any) => any;                       // only if the value is not JSON
    deserialize?: (stored: any) => any;
}

interface FilterBody {
    element: HTMLElement;
    getValue: () => any;      // read when Apply is pressed; nullish removes the filter
    focus?: () => void;       // defaults to the first control in `element`
    destroy?: () => void;     // called every way the popover closes
}

interface FilterBodyContext<R = any> {
    column: Column<R>;
    value: any;               // the applied value, or undefined the first time
    filter: Filter;           // the whole applied filter, normalized
    apply: (value: any) => void;   // apply and close — for a body with its own Enter
    close: () => void;             // close without applying
}
```

What the grid does, so the snippet above is the whole filter:

- **The funnel** on that column opens your body instead of the checklist. `filterType: null` still
  takes the funnel off; `disableFiltering` still takes them all off.
- **Apply and Clear.** Apply reads `getValue()`; Clear applies nothing. A **nullish value removes
  the filter**, so Apply with an empty body is Clear — the same rule as an empty checklist.
- **The chip**, reading `label(value, column)`, reopening your body anchored to itself, removing
  the filter from its ✕.
- **Persistence**, if `persistFilters` is on, and the cascade: an `"options"` filter on another
  column offers only the values your filter leaves reachable.
- **Teardown.** `destroy()` is called when the popover closes, however it closes.

⚠ **`match` runs once per row, on every filter pass.** Do the parsing in `getValue` and put the
result in the value:

```js
getValue: () => ({
    from: fromInput.value,                    // for the chip and for storage
    fromMs: Date.parse(fromInput.value),      // parsed once, here
    toMs: Date.parse(toInput.value),
}),
match: (v, row) => row.created >= v.fromMs && row.created <= v.toMs,   // two comparisons
```

The value is data you control, which is why there is no second `prepare`-style hook. Measured on
100,000 rows: a `match` written this way filters them in **1.7 ms** — *less* than the built-in
options test on the same rows, which resolves `formatValue` and `optionMatches` per row — and the
identical filter re-parsing its bounds inside `match` takes **90 ms**, fifty-six times as long.
That is the whole cost of getting this wrong. See
[`tasks/benchmark-results.md`](../tasks/benchmark-results.md).

**Persistence is JSON.** The value is stored as it stands, with ISO date strings revived into
`Date`. Add `serialize` / `deserialize` only when the value cannot survive that — a `RegExp`, a
`Map`, or an `Infinity` you would rather rebuild than trust. A stored filter whose column no longer
has that definition is **dropped with a warning** rather than silently filtering nothing.

A definition missing `name`, `create`, `label` or `match` throws from `create()`, naming the column
and the field.

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

// Chips only — for a toolbar that has its own clear control
AVGrid.createFilterBar("#toolbar", { grid, clearButton: false });
```

A grid can have any number of bars watching it, mounted either way; they all show the same filters
and any of them can edit them.

`filterBar` is read at `create()`, because the grid wraps itself in a flex column to make room and
that is not something to do to a page later. `setOptions({ filterBar: false })` still takes the
bar away, and `true` puts it back on a grid that was *created* with one — on a grid that was not,
it warns and points you at `createFilterBar()`.

### A bar of your own

When the built-in bar's markup is not enough — chips interleaved with your own controls, your own
chip design — skip it and render chips yourself. Everything a chip does is a public call, and
`describeFilter()` hands you the exact strings the built-in chip would show, so the two can never
disagree:

```js
const grid = AVGrid.create("#host", { rows, onFiltersChange: renderChips });

function renderChips(filters) {
    toolbar.replaceChildren(
        ...filters.map((f) => {
            const { name, values, title } = grid.describeFilter(f);
            const chip = document.createElement("span");
            chip.title = title;                                     // the full value list
            chip.textContent = `${name}: ${values}`;                // e.g. `Status: open,pending (+3)`
            chip.onclick = () => grid.showFilterPopover(f.columnKey, { anchor: chip });
            // and a ✕ calling grid.removeFilter(f.columnKey)
            return chip;
        }),
    );
}
myClearButton.onclick = () => grid.clearFilters();
```

| Piece of a chip | The call |
|---|---|
| Its text and tooltip | `grid.describeFilter(filter)` → `{ name, values, title }` |
| Clicking its body | `grid.showFilterPopover(filter.columnKey, { anchor: chipElement })` |
| Its ✕ | `grid.removeFilter(filter.columnKey)` |
| The remove-all ✕ | `grid.clearFilters()` |
| Knowing when to redraw | `onFiltersChange` — fired for every source: the API, a funnel, any bar |

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
    id?: string;               // stable identity; the built-in items all carry one
    items?: MenuItem[];        // submenu
}
```

`MenuItem` is Persephone's own shape, so a host that already builds these can hand the same array
to either menu.

### The built-in item ids

Every item the grid builds carries a stable `id`. Match on it rather than on the label: the labels
count and pluralise what the selection covers (`Insert 3 rows`), and they are the part a host may
want to translate.

| Item | `id` |
|---|---|
| Insert column *(header right-click)* | `avg-insert-column` |
| Delete column *(header right-click)* | `avg-delete-column` |
| Copy | `avg-copy` |
| Copy as… | `avg-copy-as` |
| ↳ With Headers | `avg-copy-as-headers` |
| ↳ JSON | `avg-copy-as-json` |
| ↳ Formatted (HTML Table) | `avg-copy-as-html` |
| Paste | `avg-paste` |
| Insert *n* rows | `avg-insert-rows` |
| Add *n* rows | `avg-add-rows` |
| Delete *n* rows | `avg-delete-rows` |
| Insert *n* columns | `avg-insert-columns` |
| Add *n* columns | `avg-add-columns` |
| Delete *n* columns | `avg-delete-columns` |

**These are a stable contract** — they will not be renamed without a major version. The motivating
case is a host menu that draws icons its own way, since `icon` here is markup or a node and a menu
taking icon *components* cannot use either:

```js
onGridContextMenu: (e, items) => {
    for (const item of items) {
        if (item.id === "avg-copy") item.icon = myIcons.copy;
    }
    myMenu.show(e.x, e.y, items);
}
```

The `avg-` prefix is deliberate. Host items from `getContextMenuItems` are prepended into the same
array and `id` is what the menu uses for keyboard navigation, so a collision between a host id and
a built-in one would be a real bug — and `item.id?.startsWith("avg-")` is how you tell the
library's own items from yours.

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
| `Alt+↓` | Open the focused column's filter popover, anchored at its header — the Excel gesture |
| Menu key (`≣`) | Open the context menu at the focused cell — the browser fires `contextmenu` on the focused element, and the grid resolves that to the focus |

`↓` on the last row, `Tab` off the last cell, and `Ctrl+→` off the last column each grow the grid
by one, when the matching `can*` option is on.

**Sorting has no keyboard binding.** A header click is the only built-in gesture — with
`multiSort: true`, Ctrl+click (Cmd+click on macOS) appends a sort level, but that is a pointer
gesture too. A keyboard-first consumer sorts through its own UI and `grid.setSort()`. Named as a
known gap in
[capabilities.md](capabilities.md#accessibility--what-conformance-we-claim), not hidden.

### Editing

| Key | Does |
|---|---|
| `Enter` / `F2` | Open the editor, value selected |
| any printable key | Open the editor with that character |
| `Space` | Toggle a boolean column — or open its `editor`, if it has one |
| `Enter` (boolean) | Toggle the selection to the focused cell's opposite |
| `Escape` | Cancel |
| `Enter` / `Tab` / `↑` / `↓` (in the editor) | Commit, then move |
| `←` / `→` / `Home` / `End` (in the editor) | Move the caret; the grid does not act |
| `Escape` / `Tab` (in a custom `editor`) | Cancel / commit-and-move, bound by the grid unless the editor calls `preventDefault()` |
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
| `--avg-search-match` | — | `--avg-accent`. A matched search word. Its own token because it is the one place the accent lands on *text*. |
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
| `data-type="footer-cell"` | A footer-row cell (`footerRows`), carrying `avg-footer-cell`. It has **no `data-row`** — a footer cell stands for no data coordinate, which is what keeps every interaction away from it — and `data-footer-row` is its index into `footerRows`. |
| `data-row` | Row index. A header cell carries `0`; a data cell carries its **data** row index, so data row 0 also reads `0` — `data-type` is what tells them apart. |
| `data-col` | Column index — into the **visible** columns, i.e. `columns` with `hidden` ones dropped. `getColumns()` returns the full array, so the two disagree the moment a column is hidden: map a cell back to its column by `data-column-key`, not by indexing `getColumns()` with this. It is **not renumbered inside a pinned band**: a pinned cell's index is its real one. |
| `data-column-key` | The column's `key` |
| `data-sort="asc" \| "desc"` | A sorted header cell. `aria-sort="ascending" \| "descending"` rides on the **primary** sorted column only; with `multiSort` and 2+ sorted columns, each sorted header holds its position number in an `avg-sort-pos` span |
| `data-type="group-row"` / `data-type="group-cell"` | The column-group band and its cells (`Column.group`) — overlay divs above the header row, classed `avg-group-cell`, each carrying `data-group` with its label. `aria-hidden`, not pooled, and **no** `data-row` / `data-col`: a group cell stands for a span, not a coordinate |
| `role` / `aria-*` | The root is `role="grid"` with live `aria-rowcount` / `aria-colcount` and `aria-multiselectable`; header cells `role="columnheader"` + `aria-colindex`; data and footer cells `role="gridcell"` + 1-based `aria-rowindex` / `aria-colindex` (the header is row 1). There are deliberately **no row elements**, so this is grid semantics with sort state exposed, not a fully conformant ARIA grid — see [capabilities.md](capabilities.md#accessibility--what-conformance-we-claim). |
| `data-resizable` | A header cell |
| `data-pinned="left" \| "right"` | A pinned column's header cell. On `"right"`, the resize grip moves to the cell's left edge. |
| `data-type="filter-button"` | The funnel inside a header cell |
| `data-type="cell-editor"` | The open editor |
| `data-avg-action="add-row" \| "add-column"` | The two `+` buttons |
| `data-avg-slot="content-end"` | The host's `extraElement`, which also carries `avg-extra` |
| `data-cell-borders="off"` | The root, with `cellBorders: false` |
| `data-search-highlight="background" \| "both"` | The root. Absent for the default, colour-only shape |
| `data-avg-pooled` | A cell evicted while `keepCellsAttached` is on: hidden, kept in the document, and standing for no coordinate. **It has no `data-row` / `data-col`** — they are removed on eviction and written back on re-admission, so a hidden cell can never shadow the live one at the same coordinate. Only ever present with that option. |

Cell state classes, which the four class hooks add to rather than replace: `avg-focused`,
`avg-editing`, `avg-in-selection` (plus `-top` / `-right` / `-bottom` / `-left` for the edges),
`avg-row-hovered`, `avg-row-selected`, `avg-align-center`, `avg-align-right`.

A text cell's content lives in one `avg-cell-text` span — **both** the plain and the matched
shape, so the two lay out identically. It carries the cell's truncation: `text-overflow` needs a
block container and the cell itself is `inline-flex`, where a bare text node becomes an anonymous
flex item that cannot be styled, so the ellipsis lives on this wrapper. It is also what keeps the
spaces either side of a mark, since flex discards whitespace *between* items. A boolean cell and a
cell filled by a column's `render` hook have **no** wrapper — so **a `render` column that returns
text can emit `<span class="avg-cell-text">…</span>` itself to get the same ellipsis**, and one
that draws a graphic simply does not. Inside the wrapper, `avg-search-match` wraps each matched
search word; a cell with no match has no mark and holds a bare text node. On a header cell's
funnel: `avg-column-filtered` when that column is filtered, `avg-filter-open` while its popover
is up.

Root-level classes worth knowing: `avg-grid` (the root), `avg-grid-wrap` (the flex column a
`filterBar` grid lives in), `avg-header-cell`, `avg-data-cell`, `avg-filter-bar`, `avg-popover`,
`avg-menu`, `avg-list`.

The shell inside the root is classed too, for the styling the `--avg-*` tokens do not cover:

| Class | The element |
|---|---|
| `avg-viewport` | The scrolling element. **The place for scrollbar styling** — `.avg-grid .avg-viewport::-webkit-scrollbar { … }` — and for `scrollbar-width` / `scrollbar-color`. |
| `avg-cells-area` | The sized canvas the pooled cells position themselves in. |
| `avg-sticky-top` | The band the header row lives in — a background or `box-shadow` here styles the whole header, not cell by cell. |
| `avg-sticky-bottom` / `-left` / `-right`, `avg-sticky-top-left` / `-top-right` / `-bottom-left` / `-bottom-right` | The other sticky bands and corners. Empty unless something is frozen on that edge: the checkbox column and `pinned: "left"` cells sit in `avg-sticky-left`, `pinned: "right"` cells in `avg-sticky-right` — and pinned columns' **header** cells in the matching top corner. |

These are containers, not cells: put backgrounds, borders and scrollbar styling on them, but leave
`position`, `overflow` and `transform` alone — the virtualization owns those. Inside a filter popover: `avg-filter-content` (either body),
`avg-filter-buttons` (the Apply / Clear row), and for a `column.filter`,
`avg-custom-filter-content` on the panel with `avg-custom-filter-body` around the element your
`create()` returned.

**If you write your own cell renderer returning an element, the stylesheet must position it
absolutely.** The engine writes `top` and `left`; nothing writes `position`. A cell that lays out
in flow looks correct at the top of a list and shows an empty band everywhere below.

### Rows pinned to the bottom — `footerRows`

```js
AVGrid.create(el, {
    rows,
    columns,
    footerRows: [{ label: "Total", spend: 4_812_500, members: 71_475 }],
    footerRowClass: () => "grand-total",
});
grid.setOptions({ footerRows: undefined });   // and the band goes away
```

Footer rows **are rows**: the same shape as `rows`, rendered through the same columns —
`formatValue`, `displayFormat`, `align`, `render` and `cellClass` all apply unchanged, so your
number formatting is written once. They live in the `avg-sticky-bottom` band, pinned below the
scrolling rows at every scroll position, each cell carrying `avg-footer-cell` plus whatever
`footerRowClass` returns.

And they are **only rendered** — invisible to everything that treats a row as data:

- **Sorting, filtering, `searchString`** — a footer row never moves, never disappears, and is
  not a search match.
- **Row selection** — no checkbox under `selectColumn`, select-all skips it, `getSelected()`
  never names it.
- **`getVisibleRows()` / `onVisibleRowsChange` / `getState().rowCount`** — those keep meaning
  *data* rows.
- **Editing** — readonly regardless of `editable`; `startEdit` past the data rows refuses.
- **Focus, range selection and copy** — a footer cell is not a coordinate: it carries no
  `data-row`, a drag downwards stops at the last data row, and a `selectRange` reaching past
  the data is refused.
- **Add/delete-row affordances** — the footer is not "the last row" for ArrowDown off the end,
  Ctrl+Insert, or a tall paste.
- **`getRowKey`** — never called for one. Footer rows are keyed `avg-footer-<n>` internally, so
  a key reading a field your totals row does not have cannot throw.

`rowHeight` applies to footer rows and the grid's height accounts for them. With a footer the
trailing slack defaults to `0` — the band itself is what the last data row scrolls clear of —
but an explicit `whiteSpaceY` still buys room *between* the last data row and the band, which is
where an `extraElement` sits: content, slack (with the `extraElement` in it), band.

### An element after the last row

`extraElement` puts one host element into the scrolling content, after the last row: a "Load more"
footer, an empty-state line, a total.

```js
const footer = document.createElement("div");
footer.textContent = "Load more";
const grid = AVGrid.create(el, { rows, extraElement: footer, whiteSpaceY: 24 });
grid.setOptions({ extraElement: null });   // and it goes away
```

The grid **parents it and nothing else** — never inspected, cleared, restyled beyond adding
`avg-extra`, or destroyed. Listeners you bind to it survive a repaint and a scroll long enough to
evict every cell around it, because it is an overlay rather than a pooled cell. `destroy()` takes
it out of the DOM and leaves it intact, so it can be mounted somewhere else.

**Unlike a cell renderer, this one the library positions** — a full-width band at the bottom of the
content:

```css
.avg-grid .avg-extra { position: absolute; left: 0; right: 0; bottom: 0; }
```

There the engine writes `top` and `left` and the host only has to add `position`; here nothing
writes anything, so an unpositioned element would lay out in flow among absolutely positioned cells
and land at the top-left *behind* them — invisible and still hoverable. One more class overrides
it, and no colour, size or padding is set, because only the host knows what the grid's background
is:

```css
.avg-grid .avg-extra.my-chip { left: 4px; right: auto; }
```

Two things to know rather than work around:

- **It lives in the trailing slack, which is 20 px.** Taller than that and it overlaps the last
  row at full scroll. Raise [`whiteSpaceY`](#layout) to its height to reserve the room, or give it
  an opaque background.
- **It shares that strip with the add-row button**, which sits at `bottom: 1px; left: 4px`. A
  full-width default band will sit over it; a grid that wants both positions its own element clear.

---

## Driving the grid from an agent

If you are testing av-grid through Persephone's MCP browser tools, read this before you conclude
anything from a click. It has already cost one port a day: three of the four bugs it reported were
the harness, not the grid.

### The one thing to know

**`browser_click` and `browser_press_key` dispatch synthetic events.** A `browser_click` fires a
bare `click` — no `pointerdown`, no `mousedown`. A `browser_press_key` fires a `keydown` with
`isTrusted: false`. Two consequences, and both look exactly like a grid bug:

- **The grid resolves pointer gestures on `pointerdown`** — focus, cell focus, range drags, the
  boolean checkbox — because a repaint between the press and the click replaces the element the
  press landed on (see the third invariant in `CLAUDE.md`). A lone synthetic `click` reaches none
  of that, so the grid looks like it ignored the click and left `document.activeElement` on
  `<body>`.
- **A synthetic key cannot drive the clipboard.** `Ctrl+C` works through the browser's own `copy`
  event, which only trusted input produces — on every browser, in every frame. `keydown` arrives,
  no `copy` follows, nothing is written. This is not evidence of anything about your environment.

An MCP-driven page usually does not have OS focus either, so `document.hasFocus()` is `false` and
some browsers decline clipboard work on that basis alone. Log both `e.isTrusted` and
`document.hasFocus()` before you believe a clipboard result.

### Prefer the API

Almost everything worth asserting is reachable without synthesising an event at all, and this is
the path to reach for first:

```js
grid.focusCell(10, 2);                  // move the cell focus
grid.selectRange(10, 2, 40, 5);         // a range, as after a drag
grid.startEdit(10, 2);                  // open the editor
await grid.copySelection("copy");       // the clipboard, through navigator.clipboard
grid.setSearchString("ada");
grid.setFilters([...]); grid.setSort({ key: "score", direction: "desc" });

grid.getState();                        // columns, viewport, focus, counts — JSON-serializable
grid.getFocus(); grid.getSelection(); grid.getSelectionText();
```

`getState().viewport.width === 0` is the answer to a grid that rendered blank, and worth checking
first whenever a selector finds no cells.

### When you do need a real gesture

Synthesise the whole pointer sequence in `browser_evaluate`. `clientX` / `clientY` must be real
screen coordinates — the grid hit-tests the point for sticky bands and for drags:

```js
const cell = document.querySelector('[data-type="data-cell"][data-row="3"][data-col="2"]');
const r = cell.getBoundingClientRect();
const o = { bubbles: true, cancelable: true, clientX: r.left + 10, clientY: r.top + 8,
            button: 0, buttons: 1, pointerId: 1, pointerType: "mouse", isPrimary: true };

cell.dispatchEvent(new PointerEvent("pointerdown", o));           // focus + cell focus happen here
window.dispatchEvent(new PointerEvent("pointerup", { ...o, buttons: 0 }));  // window, not the cell
cell.dispatchEvent(new MouseEvent("click", o));                   // only for onCellClick
```

- **`pointerup` goes on `window`**, because that is where a range drag listens — a drag has to keep
  being heard after it leaves the grid.
- **A range drag** is `pointerdown` on the first cell, then `pointermove` on `window` with the
  coordinates of each later cell, then `pointerup`.
- **Opening an editor takes two presses** on a cold cell, one on a cell that already has the focus.
  That is the real gesture; `grid.startEdit()` is the shortcut.
- **Keyboard navigation works synthetically** — the grid's own `keydown` handler does not care
  about `isTrusted`. Dispatch on `grid.element`:
  `grid.element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }))`.
  Only the clipboard keys need real input.
- **Give it a frame.** Paints are on `requestAnimationFrame`, so `await` a frame or two before
  reading the DOM back.

### Finding things

Cells are addressed by the [DOM contract](#dom-contract) above:
`[data-type="data-cell"][data-row="3"][data-col="2"]`, `[data-type="header-cell"]`,
`[data-type="cell-editor"]` for the open editor. Only the **visible** window exists — the grid is
virtualized, so row 99,000 has no element until you scroll to it. `data-row` on a data cell is the
data row index, not the grid row.

Screenshots beat accessibility snapshots here: cells are `div`s with no roles, so a snapshot shows
a flat list of strings and hides every layout bug. Take a screenshot and look at it.

### Iterating on a board

Boards do not auto-reload. After editing the grid's source: `npm run build:board`, then
`board_refresh { pageId }`. After editing only the board's own files, `board_refresh` alone.

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
| `highlightText(text, searchString)` | Escape `text` and wrap each search word in `<span class="avg-search-match">`. For text outside the grid — a summary line, a panel. **Inside a cell use `CellContext.highlight`**, which already holds the grid's search and honours `highlightSearch: false`. |
| `searchWords(searchString)` | How the grid splits a search: lowercased, on any whitespace, empties dropped. |
| `detectColumnWidth(rows, key, headerName, options?)` | The width one column would be given, in pixels. `rows` are the raw rows, `key` the property read from each, `headerName` the label measured alongside them. `options`: `{ charWidth = 8, padding = 20, minWidth = 60, maxWidth = 300, sampleSize = 100 }`. |
| `detectColumnWidths(rows, keys, options?)` | The same for several keys at once, returning `{ [key]: width }`. Each key is its own header label. |
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

### Reuse keys — when the rows are not all alike

A grid's cells are interchangeable, so any pooled element will do. A **list whose rows differ in
structure** — a log of text, tables, images and errors; a notebook of mixed cells — is the case
that breaks: an element built for one kind handed to a row of another has to be torn down and
rebuilt, which costs more than the allocation the pool saved.

So a renderer may stamp each cell with an opaque key of its own and ask for a matching one back.
Both calls are optional and both are one line:

```js
const kindOf = new WeakMap();          // cell element -> the kind it was built for

renderCell: (p) => {
    const kind = entries[p.row].type;             // "text" | "table" | "image" | "error"

    // `previous` is still preferred — but only when it was built for this kind.
    const previous = p.previous && kindOf.get(p.previous) === kind ? p.previous : undefined;
    const cell = previous ?? p.recycle?.(kind) ?? document.createElement("div");
    p.setReuseKey?.(cell, kind);
    kindOf.set(cell, kind);

    if (cell !== previous) buildRow(cell, entries[p.row]);
    return cell;
}
```

| | |
|---|---|
| `p.recycle(reuseKey?)` | With a key, only cells released under that same key are eligible; a request that finds none returns `undefined` — a miss, and a `createElement`, rather than a cell of the wrong shape. With no key, any pooled element will do, exactly as before. |
| `p.setReuseKey(el, reuseKey?)` | Declares what the cell ended up being built for, so the pool can hand it back to a compatible row. Called with no key, the cell returns to the untagged pool. |

**The key is yours and the library never inspects it.** A string is the usual choice. Keys compare
by `Map` semantics — identity for objects and symbols, value for strings and numbers.

`p.previous` is **not** filtered by key: it is the element already at that coordinate, and whether
it is still the right shape is a question only the renderer can answer — hence the guard in the
snippet. Checking it is what makes a row that changed kind in place rebuild.

A renderer that passes no key gets the pool it always had, down to the hit/miss counts in
`grid.render.stats.pool`. Nothing about a homogeneous grid changes.

### Keeping a cell's state — `keepCellsAttached`

Ordinary scrolling removes a cell from the DOM the moment it leaves the render window. For a data
grid that is exactly right: the cells are inert, and detaching is the cheapest way to evict one.

It is wrong for a cell that **owns** something. Removing a subtree destroys what is inside it, and
the browser does not put it back on re-insertion. Measured on a cell holding a nested scroller and
an `<iframe>`, scrolled out of the window and back:

| | detached (default) | `keepCellsAttached: true` |
|---|---|---|
| nested scroller position | `300` → **`0`** | `300` → **`300`** |
| iframe `load` events | 1 → **2** (document torn down and reloaded) | 1 → **1** |
| `contentWindow` while evicted | **`null`** | live |

```js
new RenderGrid(host, {
    rowCount, columnCount, renderCell,
    keepCellsAttached: true,     // evicted cells are hidden, not detached
});
```

An evicted cell is given `display: none`, has its `data-row` / `data-col` removed and gains
`data-avg-pooled`, and is left where it is. It contributes no layout and paints nothing, so it
costs what a detached cell costs everywhere except the node count — and it keeps its frames, its
media and its nested scroll offsets. Admission restores the display and clears the marker.

Cells are still detached **when the pool overflows**, which is what bounds how many hidden elements
can accumulate: the cap is the pool's `maxSize`.

**This keeps the element alive; it does not route it back to the same row.** An unkeyed pool hands
out whichever element it has, so pair it with a [reuse key](#reuse-keys--when-the-rows-are-not-all-alike)
per row when the state belongs to a particular row:

```js
renderCell: (p) => {
    const el = p.previous ?? p.recycle?.(p.row) ?? document.createElement("div");
    p.setReuseKey?.(el, p.row);
    ...
}
```

Off by default, because it trades DOM nodes for state and a grid whose cells own nothing gains
nothing. On the stateful cells above it is also **faster** — 0.59 ms a paint against 1.65 ms, and a
quarter of the childList mutations — because the expensive part was rebuilding the iframe.

### Surviving a host that moves the grid

Chromium resets **every scroller inside a detached subtree**, keeps it reset when the subtree is
re-inserted, and fires **no scroll event** either way. So a host framework that re-renders the slot
the grid lives in leaves it painting rows at an offset the container no longer has — measured, a
grid at `scrollTop: 20000` came back at `0` with the model still at `20000` and **the entire
viewport unpainted**, and it did not self-heal until someone scrolled.

The grid handles this itself. There is nothing to call and nothing to configure:

```js
const grid = new RenderGrid(host, { rowCount, columnCount, renderCell });
// host re-renders its slot, detaching and re-appending the grid — the position comes back
```

It works two ways, because one detector cannot see both cases. A detach that spans a frame is
caught by the size the grid measures. A host that removes and re-inserts the subtree **within a
single task** — what a framework does when it moves a node during a commit — produces no size
change at all that any observer can sample, so the grid also watches the child lists of its own
ancestors. Those are nodes it never touches, so on a page that leaves the grid alone this observes
nothing and costs nothing.

| Option / method | |
|---|---|
| `watchHost` | Default `true`. Set `false` to turn the automatic watching off. |
| `grid.revalidate()` | Check now and repair. On `RenderGrid` and on `AVGrid`. |

**A disagreement between the container and the model is never acted on by itself.** A scroll event
is delivered a frame *after* the scroll it reports, so during any user scroll the container is
routinely ahead of the model — writing the model back there would undo the scroll, and because the
write fires a scroll event of its own the two take turns, which reads as a list that scrolls half
the time. What separates the two cases is not the disagreement but what follows it: a scroll the
browser performed is always followed by an event, and a position it discarded is followed by none.
So a disagreement is carried across two frames and any scroll event arriving in that window vetoes
it. Verified: scrolling to the top while the host churns an ancestor every frame lands at the top
and stays there.

### Scrolling after a paint — `scrollToRowAfterPaint`

The engine's two scroll entry points, and the distinction is load bearing.

```js
grid.model.scrollToRow(row, "center");             // the rows have not changed
grid.model.scrollToRowAfterPaint(row, "center");   // the rows have just changed
```

`scrollTop` is clamped to the scrollable extent, and the extent is the sizer's height, which the
**paint** writes. Scrolling before that frame clamps against the old extent: the list renders
correctly and is simply scrolled to the wrong place, with nothing re-issuing the request. Measured
on a grid grown from 20 rows to 3,000 in one turn and asked for row 2,000 (`scrollTop: 48000`), it
landed at **100** — the whole of the old extent — and at 48,000 through `scrollToRowAfterPaint`.
`setTimeout(0)` and a single `requestAnimationFrame` both measured **100** as well; the first lands
after the microtask that recomputes the geometry but before the frame that applies it, and the
second is registered before the paint's own frame.

| | |
|---|---|
| `model.scrollToRowAfterPaint(row, align?)` | Queue a scroll for the end of the next paint. Requests a paint itself, so it is correct on its own. |
| `model.flushPendingScroll()` | Drain the register. The shell calls this at the end of every paint; a host driving `RenderGridModel` without `RenderGrid` must call it itself. |
| `model.measured` | Whether the grid has a layout box the write could land in. |

**One slot, last-wins.** The register holds a single request and is overwritten rather than
appended to, so a burst issued while the extent is unknown collapses to the newest and a stale row
is discarded by construction.

**`scrollToRow` shares it.** A request issued while the grid has no usable size — a list built
inside a popover that lays out later — is queued in the same slot instead of writing a `scrollTop`
the browser will clamp to nothing, and is drained by the same flush. Measured: a request for row
1,500 issued while the host was `display: none` landed at **0** before, and at **36000** after,
once the popover opened.

**A queued scroll outranks the scroll reconciliation above.** Both write `scrollTop`, and they mean
different things: the reconciliation repairs a position the browser *discarded*, while the register
holds one the host explicitly asked for, and asked for later. Within a paint the flush runs last;
across frames the reconciliation stands down while the register is loaded. Restoring first would
write the stale offset, fire a scroll event of its own, and be overwritten a frame later — a
visible jump to the old place and back. Verified together: a host that reparents the grid in the
same turn as an after-paint scroll lands on the requested row (28,800), not on the old offset
(20,000).

### Changing the shell's layout after construction

`height`, `growToHeight`, `growToWidth` and `fitToWidth` are **live**. Pass any of them to
`setOptions` and the shell follows:

```js
// An autocomplete popup that resizes as its filtered list grows.
grid.setOptions({ height: undefined, growToHeight: `${Math.min(rows.length * 24, 300)}px` });
```

There is nothing else to touch — the grid's own elements are private, and a host should never need
to reach into them to resize it. The change reaches the geometry too, not only the styles: measured,
a grid capped at 100px showing 5 rows re-capped to 360px shows **16**.

Before this these four were read once, at construction. A `setOptions({ growToHeight: "150px" })`
left the root at its original 400px with `max-height: unset`.

A `setOptions` that touches none of them costs nothing: every write goes through the same
skip-if-unchanged path the constructor uses, and no paint is forced.

### Row heights measured from the DOM — `MeasuredRowGrid`

`rowHeight` accepts a function, which covers every height that can be **computed**. It does not
cover a height that is only knowable once the row has been laid out: wrapped text of
unpredictable length, a chat bubble, a log entry with a stack trace in it, a comment with an
image in it. `MeasuredRowGrid` is an opt-in companion for that case.

```js
import { MeasuredRowGrid } from "av-grid";

const grid = new MeasuredRowGrid(host, {
    rowCount: () => entries.length,
    columnCount: 1,
    columnWidth: () => "100%",
    fitToWidth: true,
    height: "100%",                       // as for RenderGrid: the root needs a definite height
    minRowHeight: 18,
    maxRowHeight: 800,
    getInitialRowHeight: (row) => cache.get(entries[row].id),
    renderCell: (p) => {
        const cell = p.previous ?? p.recycle?.() ?? document.createElement("div");
        applyCellStyle(cell, p.style);    // exactly as for any RenderGrid renderer

        let body = cell.firstElementChild;
        if (!body) cell.append((body = document.createElement("div")));
        body.textContent = entries[p.row].text;

        p.measure(body);                  // ← this row is as tall as `body`
        return cell;
    },
});

grid.model.scrollToRow(entries.length - 1, "bottom");
grid.destroy();
```

**Nominate a child, not the cell.** The engine writes the cell's `height` from what it currently
believes the row to be, so measuring the cell reports that belief straight back and the row never
grows. A child is laid out by its own content, which is the height the row actually needs. A
renderer that nominates nothing falls back to measuring the cell — right for a cell the renderer
left unsized, and a harmless no-op for one it sized.

It is a **companion, not a mode**: it owns a `RenderGrid` rather than changing one. A host that
never constructs it runs the same code it ran before this existed, and the 100,000-row fixed-height
benchmark measures the same path it always did.

| Option | Meaning |
|---|---|
| `minRowHeight` | Floor for every height, measured or hinted. Defaults to **24**. |
| `maxRowHeight` | Ceiling for every height. Unbounded when absent. |
| `getInitialRowHeight(row)` | A height already known from somewhere other than the DOM — a cached measurement, a value stored with the record. Used until the row is measured, so the first paint is close instead of uniform. Clamped like a measurement. |
| `preferMinHeightForNewRows` | Estimate a never-measured row at `minRowHeight` rather than at the last measured height. Right for a list that appends short entries to a tail the user is watching. |
| `rowHeight` | The last-resort estimate, when there is no hint and nothing has been measured. Only a **number** is read here. |

Everything else is `RenderGrid`'s option surface unchanged, `keepCellsAttached` and `watchHost`
included. The members forwarded from the shell are `model`, `root`, `scrollElement`, `stats`,
`addOverlay()`, `revalidate()`, `setOptions()` and `destroy()`; `grid.grid` is the `RenderGrid`
itself and `grid.heights` is the policy, whose `heightOf(row)` is how a host caches a measurement
to feed back through `getInitialRowHeight` next time.

**How it behaves.** One `ResizeObserver` watches every nominated element. A cell is measured
synchronously when it is rendered, again when it is admitted, and once more in the following
animation frame — the last of those is the only one that can see the layout the admission caused.
Measurements are coalesced **per row on a 50 ms debounce** before the geometry is told, because a
cell settles over several frames as fonts load and images decode. A zero is ignored: a hidden,
detached or not-yet-laid-out element reports zero, and none of those mean the row is zero tall.

**Updating options does not repaint the grid.** `setOptions` mutates the height policy and keeps
the same `rowHeight` and `renderCell` functions — `RenderGridModel` compares those by identity, so
replacing them would make every option change a full geometry invalidation. That includes replacing
your own `renderCell`: it is stored and reached through the stable wrapper.

Measured, on 5,000 rows of wrapped text of random length through a 400 px viewport, against the
same rows and the same renderer at a fixed 48 px: **0.685 ms a paint against 0.119 ms (5.8×)**,
both at 60 fps. That is the price of the feature, and it is paid only while heights are being
discovered — a settled grid is completely idle (**0 paints and 0 pool activity over a second**),
and a full repaint of every visible cell does **0 DOM insertions or removals**, exactly as the
fixed path does.

### `RerenderInfo.fromRow` — geometry, not content

```js
model.update({ fromRow: row });
```

"Every row from here down has moved." Different in kind from `rows`, which says "these rows'
*content* changed". A row that grows or shrinks does not change what any row below it renders — it
changes where each one **starts**, and it changes the total scrollable height.

`{ rows: [row] }` is not a substitute: it repaints one row and leaves the rest of the list drawn at
its old offsets, overlapping or gapped. `{ all: true }` is not either: it invalidates content that
did not change.

Bounded like every other entry in a dirty set — marking from row 12 in a 100,000-row list costs a
viewport, not a dataset. Rows above `fromRow` are untouched. Absent, everything behaves exactly as
it did before the field existed.

Measured on the board: a row grown from 88 px to 296 px moved the **seven** rendered rows below it
by exactly 208 px each, left the row above it at its offset, and re-rendered none of their content.

### Cell lifecycle — `onCellAttached` / `onCellReleased`

Two optional `RenderGrid` callbacks, for a layer built **over** the engine. An ordinary renderer
needs neither; it hears about a cell through `renderCell`.

```js
new RenderGrid(host, {
    onCellAttached: (el) => observer.observe(el),
    onCellReleased: (el) => observer.unobserve(el),
    // …
});
```

**"Released" means "left the active render set", not "detached from the DOM".** With
`keepCellsAttached` the element stays in the document, hidden, and is still released; when the pool
overflows it is detached *after* the callback. Tying the meaning to detachment would make the
contract depend on the pool's overflow limit and would skip retained cells entirely.

`onCellAttached` fires for **every** admission, including the re-admission of a retained cell whose
`parentElement` never changed — a hidden element measures **zero**, so a re-admitted cell needs a
fresh look. It runs after the element is attached and after any hiding is undone, so it is the
first moment a measurement is meaningful.

Neither is a cleanup hook: a cell is released and re-admitted constantly while scrolling, so
anything torn down there is rebuilt within a frame.

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
