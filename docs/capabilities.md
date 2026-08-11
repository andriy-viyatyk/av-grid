# What the grid does today, and what it measures

The state of av-grid, by subsystem rather than by task order. Every number here was measured in a
real browser on one of the [test boards](boards.md) — none is an estimate. The full history, and
the measurements that mislead if taken carelessly, is in
[`tasks/benchmark-results.md`](../tasks/benchmark-results.md).

For the public surface see [`api.md`](api.md); for the rules that keep the numbers where they are,
[`invariants.md`](invariants.md).

---

## The performance thesis

100,000 rows in a real browser, through the *whole* grid rather than the engine alone: **first
paint 6.7 ms, 60 fps at both the top and row 99,000, a flat-cost ratio of 1.08×**, a full repaint
of every visible cell in 0.2 ms doing **zero DOM mutations**, and a theme change costing **zero
paints**.

Each subsystem has its own gate, and each is about the shape of the cost rather than its size:

| What | The gate it passed |
|---|---|
| **Range selection** (task 10) | Dragging from row 0 through row 99,000 — a live selection of 99,001 rows against 101 at the top — marks **2 cells dirty per pointer move at both ends**: 0.0141 ms against 0.0147 ms, a ratio of **1.04×** |
| **Row selection** (11) | Selecting all 100,000 rows: 24.9 ms, **19 rows** marked, **0 DOM mutations** |
| **Editing** (12) | A full repaint while a cell is being edited does **0 DOM mutations** and hands back the same `<input>` — the first thing in the library that would notice if the render path stopped preferring `p.previous`. Gate with editing on: first paint 5.7 ms, 0.94×, 60/60 fps |
| **Clipboard** (13) | Pasting into 1,000 cells marks **1 repaint** and mutates **0 DOM nodes** — a paste writes silently and marks the viewport once at the end |
| **Structure** (14) | Inserting a row *above* the viewport at row 90,000 mutates **0 DOM nodes** and keeps both the scroll position and the focus — after fixing a focus-recentre that was moving the viewport 261 px behind the user's back |
| **Filtering** (15) | 100k rows down: **5.9 ms, 1 repaint, 0 mutations**. Back up: nothing at all. Searching a computed column costs **+8.7%**, because it puts a host callback inside the row loop |
| **Popovers** (16) | Opening one over 100,000 rows marks **1 cell dirty** and mutates **0 DOM nodes**, whether the column has five distinct values or a hundred thousand |
| **Context menu** | Opening one marks **0** things and mutates **0** DOM nodes; **2.3 ms with every row selected against 2.9 ms with one**, because `e.selection` is a getter nothing built-in reads |
| **Teardown** | 100 create/destroy cycles leak **0 DOM nodes** and leave **100/100 grids collectable**, at 6.5 ms a cycle |

---

## The grid itself

`AVGrid.create(el, { rows })` renders a real grid — columns, header labels, widths, row keys and
data types all inferred — with header sorting, column resize and reorder, custom cell renderers, a
search filter, cell focus, full keyboard navigation, range selection by drag or by shift, row
selection through a checkbox column, in-cell editing, Excel-compatible clipboard copy/cut/paste,
rows and columns added and deleted by button, keyboard or API, column filters, and a stylesheet
driven entirely by CSS custom properties.

### Editing

`editable: true`. An edit opens on a press on the cell that **already has the focus** — so a cold
cell takes two clicks and a focused one takes a single click, as the reference did — and the caret
lands **where the click landed**, with nothing selected, while Enter / F2 / `startEdit()` select
the whole value instead.

An editable boolean cell carries a checkbox that toggles on the first click, and **only the box
toggles** — the cell around it just selects. Tab and the vertical arrows commit and move on; the
horizontal ones stay with the caret.

The row that ArrowDown adds off the bottom is taken back if the focus leaves it without anyone
typing in it, so holding the key to read the end of a grid does not leave a blank row behind.

**An edit freezes the row order**, so the row being typed into cannot jump away — and that freeze
is released by a change to search, filters *or* sort, through `RowsModel.refilterRows()`. It used
to be released only by a sort, which left filtered-out rows on screen after an edit;
`updateRows()` short-circuits into `updateFrozenRows()` while frozen, which adopts new row objects
in place and re-filters nothing. Only a browser could find it: it takes an edit, then a filter
change, then a look at what is actually on screen.

### The cell dropdown

A column with `options` opens a themed, virtualized list rather than a native `<select>`, whose
popup the platform drew and the `--p-*` contract could never reach. **10,000 options put 13 rows in
the DOM and mutate zero grid cells.** Typing over a cell seeds the list's search box instead of the
cell's value; a picked option keeps its type — `20` commits as the number, which the stringifying
`<select>` could not manage — and Escape or a click elsewhere cancels rather than committing.

### Column widths

**A column that omits `width` is sized from its content** whether the columns were inferred or
written out by hand. For a long time only the inference path did it, so naming your own columns —
which is what anyone does the moment they want a header label — silently gave every one of them a
flat 140 px, against a doc that had always promised detection. The first host to hit it re-ran the
exported `inferColumns()` over a probe of display text purely to copy the widths back off it.

The measurement is by character count over 50 rows, not by text metrics: laying out the rows to
size a column would cost more than the first paint. It reads `columnDisplayValue`, so a
`formatValue` or a `displayFormat` is what gets measured — a `displayFormat: "date"` column comes
out at 84 px rather than the width of the 40-character `Date.toString()` behind it. Nothing to
measure means no width and the 140 px default, which is what keeps a column `addColumns()` has just
made from being the narrowest thing on screen at the moment it most needs room.

A percentage width (`width: "35%"`) is measured against what is left after the fixed columns and
the vertical scrollbar, and re-resolves on every resize. One is enough to fit the grid to its
container — `fitToWidth` is only for stretching a set of columns that are all fixed widths.

That was not always true: `calcInnerSize` adds 20 px of slack past the last column so it can scroll
clear of the edge, and dropped it only under `fitToWidth` — so a percentage column got a perfect
fit **and** the slack on top, which is a horizontal scrollbar by construction. `hasPercentLength()`
now decides `columnsFitted`, which the geometry and the dirty-set check read in place of the
option.

---

## Selection, focus and the pointer

**DOM focus lands on the root from any press inside the grid.** It used to be done by the branch
that resolved a *data cell*, so a press on a header, on the empty area past the last row, or on the
band a status column occupies left focus wherever it had been — and since the keyboard is bound to
the root, sorting by clicking a header killed the arrow keys until something else focused it. It is
now the first thing `pointerdown` does, and skips only a press that lands on a control which takes
focus itself, because stealing it there would close the editor the press was opening.

**The row highlight follows the pointer everywhere it should.** It read `mousemove`, and
`onCellPointerDown` calls `preventDefault()` to stop the browser starting a text selection — which
**suppresses the compatibility mouse events for the rest of that pointer's stream**, so a range
drag delivered no `mousemove` at all and the highlight stayed on the cell the drag began from until
the button came up. It reads `pointermove` now.

A wheel scroll under a stationary pointer re-resolves the row *after* the paint, on the scroller's
own `scroll` event — before the paint the hit test returns the row that *was* there. The gate is
untouched, because that handler returns immediately when no pointer is over the grid, which is
every programmatic scroll. A real wheel scroll under the pointer costs **0.291 ms a paint against
0.120 ms**; the highlight moving on its own is **0 mutations and 0.045 ms**.

---

## Filtering

**From the header.** Every column carries a funnel (`filterType: null` takes it off one,
`disableFiltering` off all of them); clicking it opens a searchable checklist of the column's
distinct values, cascaded against the other filters, with select-all, Apply and Clear. The option
list is supplied by the library unless a host passes `onGetOptions`, which may return a promise. A
column with 100,000 distinct values puts **12** rows in the checklist — `VirtualList` earning its
keep.

**Through the API, and across a reload.** `grid.applyFilter({ columnKey: "status", value:
["open"] })` narrows 100,000 rows to 40,000 in **5.9 ms with one repaint and zero DOM mutations**,
and clearing it costs **0.0 ms**, because an unfiltered pass returns the same array it was given.
`persistFilters: { name }` remembers the filters across a reload through an injected store —
`localStorage` by default, never written to unless asked — reviving `Date` values without losing
the labels around them.

**As removable chips.** `filterBar: true` puts a bar above the grid, or
`AVGrid.createFilterBar(el, { grid })` puts one anywhere — both make the same object, and a grid
can have any number of them, all live. A chip reads `Status: open,pending (+3)`; clicking its body
reopens the popover *anchored to the chip*, its ✕ removes that filter and the ✕ at the right end
removes them all. The bar takes no space at all until something is filtered. Every filter change
while the bar is up mutates **zero** DOM nodes; the bar appearing or going away costs one row of
cells, because it changes the grid's height by 32 px.

**Free text, and where it matched.** `searchString` keeps a row when every whitespace-separated
word appears in some column's displayed value, and each of those words is then marked inside the
cells, so it is visible *why* a row survived. The mark is the accent colour by default;
`highlightSearch` switches it to a tint behind the letters, to both, or off. It is measured on
the 100k board with a search active: **60 fps scrolling, and a full repaint of every visible cell
in 0.1 ms with 0 DOM mutations** — indistinguishable from no search at all. Three things buy
that: the words are split once per pipeline run rather than per cell, a cell with no match never
leaves the single-text-node path, and the *shape* is one attribute on the root, so choosing
between the three repaints nothing. What is marked is the **displayed** text — the same text the
search matched. A `render` column is left alone, because its markup belongs to the host — and
is given `CellContext.highlight` to opt in with — one call that escapes the text and marks the
same words the rest of the grid is marking:

```js
{ key: "full", render: (c) => c.highlight(`${c.row.firstName} ${c.row.lastName}`) }
```

Marked output is wrapped in one inline box, which is not decoration: a data cell is `inline-flex` and
flex discards the whitespace *between* items, so a mark that split the text rendered
"Alan Dijkstra" as "AlanDijkstra". Measured against the same row unmarked, width and
`scrollWidth` are identical — a mark changes appearance, never layout.

---

## The context menu

Right-click offers Copy, Copy as… (headers / JSON / HTML table), Paste, and Insert / Add / Delete
for both rows and columns, each label counting what the selection actually covers — a header gets
the two column items instead.

`getContextMenuItems` adds items above the built-in ones; `onGridContextMenu(e, items)` receives
the point and the items the grid *would* have shown and draws its own menu instead;
`disableContextMenu` hands the gesture back to the browser, which is also what an open cell editor
gets, because Cut/Paste and spelling are things only the platform can offer.

The menu itself is a primitive, `Menu`, on `Popover`: submenus on hover or click, arrow keys, and a
search box past twenty items.

---

## Customization — the seven host hooks

All seven are documented in [`api.md`](api.md#customization-at-a-glance), demonstrated together in
[`examples/10-customization.html`](../examples/10-customization.html), and checked as **20 pass/fail
claims** by [`CustomizationBoard`](../test-boards/CustomizationBoard/CLAUDE.md).

### The four class hooks

`Column.cellClass` and `Column.headerClass` take a constant string or a function of the cell;
`rowClass` on the options highlights a whole row; `onCellClass` predates them. All four are
additive on top of the state classes, accept an array with its falsy entries dropped, and are
reassigned whole on every paint, so a class **disappears** when its hook stops asking for it:
removing all four from a live 100,000-row grid takes 70/10/130/1 marked cells to 0/0/0/0 and
restores exactly those counts. That is the pool trap, and no happy-dom test can see it.

The cost is **+0.012 ms on a full repaint of every visible cell and 0 DOM mutations** — measured as
alternating pairs, because timed in blocks the bare grid came back *slower* than the hooked one.

There is no row element to hang a class on, by design, so `rowClass` lands on each of the row's
cells; and a host rule has to out-specify `.avg-data-cell`, so write `.avg-data-cell.overdue`.

### `Column.editor` — a custom cell editor

Receives the `EditorContext` the built-in text box and dropdown already use — value, row, column,
indices, `openedBy`, and `setValue` / `commit` / `cancel` — and returns an element, or
`{ element, focus?, destroy? }` when it owns a panel somewhere else. Four lines for a date picker.

The grid **adopts** whatever comes back: adds `avg-cell-editor`, which is what positions it inside
the cell, marks it `data-type="cell-editor"` so its keys and clipboard are not the grid's, and
binds Escape and Tab so an editor that handles neither still cancels and still lets the user move
on.

**Commit-on-blur is deliberately not the grid's** — it lives in `CellInput`, which is what lets a
date picker take the focus without closing the edit underneath it. A column with an `editor` opens
it whatever its `dataType`, including `boolean`, which then shows a tick and no checkbox, because
the checkbox's press toggles and would make the editor unreachable.

The broken `editRender` is gone: it was handed a `CellContext`, so whatever it drew had no way to
record a value or end the edit.

### `Column.filter` — a custom filter type

Takes a definition — `{ name, create, label, match }`, plus `serialize` / `deserialize` if the
value is not JSON-shaped — and the funnel then opens the host's element instead of the checklist.
`create(ctx)` returns `{ element, getValue, focus?, destroy? }` and nothing more: the grid keeps
the panel, the **Apply** and **Clear**, the chip that reads `label` and reopens the body anchored
to itself, the cascade into the other columns' option lists, and the persistence.

**No registration call** — the definition is an object on the column, so reuse is a shared `const`
and there is no order of calls to get right. A filter naming a type its column is not filtered by
is rejected, which is what makes a stored filter whose definition has gone drop with a warning
instead of silently matching nothing.

**A host `match` is *cheaper* than the built-in test it replaces — and 56× more expensive written
the obvious way.** On 100,000 rows: a definition whose `getValue` parses its bounds once and whose
`match` is two numeric comparisons filters in **1.7 ms** against **2.1 ms** for the built-in
`"options"` test, which resolves each row through `filterValue` and `optionMatches` before it
reaches `===`. The same date-range filter re-parsing its bounds inside `match` takes **90 ms**.
That is why there is no `prepare`-style second hook: the value is data the definition controls, and
putting the parsed form in it is the whole optimization.

### `Column.copyValue` — what a cell copies

Used by every copy path — ctrl+C, ctrl+X, all four Copy as… modes, `getSelectionText()` — for the
cell whose screen form is a bar, a badge or an icon. It is **6× cheaper than the fallback it
overrides** (0.20 ms against 1.24 ms for 1,000 cells), because reducing `render`'s markup to text
costs an `innerHTML` write and a `textContent` read per cell.

There is no `pasteValue`: `validate` already coerces an incoming value on typing, pasting and
range-delete alike.

### `Column.sortValue` — sorting by something other than the value

`sortValue: (row) => any` is a projection — `sortValue: (row) => RANK[row.status]` is a status
priority, and whatever it returns is compared the way the grid compares anything.
`Column.rowCompare` stays for an order that is genuinely pairwise: a collator, a natural sort, a
tie-break across two properties. It wins where both are set. Both sort ascending, because a
descending header click reverses the sorted array.

**`sortValue` is read once per row, not once per comparison.** `Array.sort` calls its comparator
O(n log n) times — **1,209,558 times for 100,000 rows**, counted on the board — so a projection
written inside a `rowCompare` runs that often too; decorating the rows with their sort values and
sorting *those* is 100,000 calls. Twelve times fewer calls buys **5%** on a table lookup (10.3 ms
against 10.8 ms — the wrapper object per row eats the rest) and **2.7×** on a projection that
lowercases and concatenates (17.5 ms against 46.9 ms). It never loses, and it wins in proportion to
what the projection does.

### Which hook feeds what

[One table in `api.md`](api.md#which-hook-feeds-what) covers screen, sort, search, a filter's row
test, a filter's option list, copy and paste, each with the order it tries. Writing it by reading
the code rather than recalling it found **two documented claims that were false** — `formatValue`
was said to feed sorting, and `dataType` to govern the comparator; neither does, because
`defaultCompare` compares `row[key]` by its *runtime* type.

One real asymmetry stays: **copy prefers `formatValue` over `render` while the screen prefers
`render`**, because a `formatValue` is already the plain text a spreadsheet wants. A column that
wants its rendered text copied says so with `copyValue`.

---

## Theming

**⚠ `--avg-*` on an ancestor does nothing.** The grid root, `.avg-popover`, `.avg-list` and
`.avg-filter-bar` each define the whole token block *on themselves* from `--p-*`, because a popover
lives on `document.body` and cannot inherit from a grid, and an element's own definition shadows
any ancestor's. So:

- **`--p-*` on an ancestor reaches everything**
- **`--avg-*` on an ancestor is shadowed**
- **`--avg-*` on the element itself wins**

The docs used to say otherwise; running the theming example in a browser is what caught it. Whether
the defaults should move to `:root` so an ancestor's `--avg-*` works is **still open**.

**On a board the grid looks like Persephone's own.** Four tokens name their `--p-*` counterparts
rather than deriving values: the header band and the filter bar take `--p-bg-dark` (#181818 against
a #1f1f1f body — *darker* than the grid, which a `color-mix` tint of the text colour could never
be), and the cell lines moved to a token of their own, `--avg-grid-line` = `--p-border-light`
(#2b2b2b), so they recede without thinning the popover borders that shared `--avg-border-color`
with them. The two `+` buttons brighten to `--p-text-strong` on hover instead of turning blue, and
a menu row takes the full `--p-selection-bg` / `--p-selection-text` pair rather than the 18% tint a
checklist wants. Every fallback is the old value, so a bare HTML page is unchanged.

---

## Introspection and teardown

**`getState()` answers "what is going on" in one line, and it survives `JSON.stringify`.** Every
field is plain data — the columns are flattened to key/name/width plus sorted, filtered, editable
and `hasRender` / `hasOptions`, because it used to hand back the live `Column[]` with its functions
on it. There are no row objects anywhere: counts, keys and indices only, so logging a 100,000-row
grid stays readable and puts no host data in the line. A `viewport` block reports the window the
engine believes is on screen and the size it thinks it has, `width: 0` being the answer to the
commonest integration failure.

**`destroy()` releases everything.** 100 create/destroy cycles of a fully-loaded grid leak **0 DOM
nodes** and leave **100/100 grids collectable**, at 6.5 ms a cycle. Afterwards a mutator warns once
and does nothing while the getters still answer — `getState().destroyed` is `true`, which is
exactly when a post-mortem wants it.

---

## The two primitives

Neither was ported from UIKit; both were built fresh for the filter UI.

**`Popover`** anchors to an element or a point, flips instead of clipping, caps its height to the
space available and scrolls, dismisses on Escape or an outside pointerdown, resizes by a corner
grip, and resolves a promise when it closes.

**`VirtualList`** is a searchable checklist on its own `RenderGrid` instance: **100,000 options
mount in 4.4 ms with 11 rows in the DOM, scroll at 60 fps with a flat-cost ratio of 1.00×, and
select-all across all of them costs 9 ms and one repaint.**

---

## Documentation and examples

**[`api.md`](api.md) is the complete public surface**, written for an agent reading it once
mid-task: every option, every column field, every instance method, every callback (marked for which
ones can veto by returning `false`), the filter API and its persistence, the keyboard map in four
tables, the CSS custom properties with what each falls back to, and the DOM contract. It records
the **naming decision** — `key` / `name`, no aliases, and why — so it is not relitigated, and it
commits to the class names and `data-*` attributes as public while explicitly leaving the DOM
*structure* free to change, because cells are pooled and their nesting already has. Every signature
was read out of the source rather than recalled; two of them (`filterRows`, `rowsToCsvText`) were
not what the obvious guess would have been.

**[`examples/`](../examples/) holds eleven runnable files**, one topic each, every one standalone
and meant to be copied whole: minimal · columns · cell rendering · sorting and filtering ·
selection and keyboard · editing · clipboard · theming · the 100k benchmark · customization · a
Persephone board. Each was opened in a real browser and driven, which is how three of them ended up
different from how they were written. The benchmark reports **12.1 cells touched per paint at the
top against 12.0 at row 99,000** — the exact number — next to the timing ratio, which swings
0.8×–1.2× because a paint costs 0.1 ms. The board example was scaffolded, vendored and opened: it
renders in Persephone's dark theme with **not one line of theming code and an empty `ui.log`**.
