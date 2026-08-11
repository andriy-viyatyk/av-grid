# av-grid — Goal and Port Plan

The full plan for this project: what is being built, why, what is being ported from where, and
how the public API should be designed. [`../CLAUDE.md`](../CLAUDE.md) is the short entry point;
this document is the detail behind it.

**Status:** pre-implementation. Nothing is built yet.

---

## Goal

Build **av-grid** — a dependency-free, framework-agnostic virtualized data grid written in
TypeScript that renders directly to the DOM.

The target is a grid that stays smooth at **100,000+ rows**: no lag while scrolling, no lag
while dragging a range selection at *any* scroll position, and no lag while editing. It ships
as a standalone open-source library consumed either as a plain `<script>` (IIFE/UMD global) or
as an ESM module, with **no runtime dependencies** — no React, no framework, nothing.

### Why this project exists

The immediate consumer is **Persephone Boards** (sandboxed mini web-apps built out of plain
HTML + JS). Boards currently recommend [Tabulator](https://tabulator.info/) for tabular data,
and it works well up to a few thousand rows. Past ~100,000 rows it degrades badly: selecting a
range near the *top* of the dataset is fine, but scrolling to the bottom and dragging a
selection takes **~5 seconds** to paint.

Persephone's own internal grid — `AVGrid`, a React component — handles the same 100k-row
dataset smoothly, with no scroll or range-selection lag. The engine behind it is not React; it
is a virtualization layer with cell-level dirty tracking that happens to be *rendered* through
React. This project extracts that engine and reimplements the rendering layer in plain DOM, so
the same performance is available to any plain-JavaScript page.

### Success criteria

1. 100,000 rows × ~20 columns renders and scrolls with no perceptible frame drops.
2. Dragging a range selection is equally fast at row 100 and at row 99,000.
3. Zero runtime dependencies; the built bundle drops into a `<script>` tag and works.
4. Themeable from CSS custom properties alone — a theme switch requires no JS re-render.
5. Feature parity with the reference implementation for the core surface (see *Scope*).
6. An AI agent that has never seen av-grid can write a working grid into a board by guessing
   the API from convention — see *Who this API is for*, which governs every interface
   decision in this project.

---

## Architecture of the reference (what you are porting)

Paths and the read-only rule are in [`../CLAUDE.md`](../CLAUDE.md).

### The two layers

**`RenderGrid/`** is the virtualization engine and the reason the grid is fast. It computes,
for a given scroll offset and viewport size, which rows and columns are visible on both axes,
and — critically — maintains a **dirty set** rather than re-rendering the viewport.

`RerenderInfo` (in `RenderGrid/types.ts`) is the key type:

```ts
interface RerenderInfo {
    all?: boolean;
    rows?: Array<number>;
    columns?: Array<number>;
    cells?: Array<RenderCell>;   // { row, col }
    force?: boolean;
}
```

When a range selection grows by one cell, only the cells whose selection state actually
changed are repainted — not the row, not the viewport. `RenderGridModel.inputChangted()`
deliberately **excludes the scroll offset** from its change comparison, with a comment
explaining that including it would force a full re-render on every scroll frame. This
discipline is the whole performance story. **Preserve it exactly.** Any port that repaints
the visible window on each mouse-move has failed, however clean it looks.

`RenderGrid` also owns the sticky regions: `stickyTop` / `stickyLeft` / `stickyRight` /
`stickyBottom` plus the four corners, each a separately-rendered band. AVGrid uses
`stickyTop = 1` for the header row and `stickyLeft` for status/pinned columns.

**`AVGrid/`** is the grid behavior built on top: columns and resizing, sorting, filtering,
selection, cell focus and keyboard navigation, in-cell editing, and Excel-compatible clipboard
copy/paste. Its logic is already split into a model layer (`AVGrid/model/`) separate from its
React views — which is why this port is feasible at all.

### File inventory and port status

Line counts as of the port baseline; ~7,300 lines total.

**`RenderGrid/` — 2,347 lines**

| File | Lines | Port status |
|------|-------|-------------|
| `renderInfo.ts` | 704 | **Port nearly as-is.** Pure geometry/window math. The only change is the cell payload type: `RenderInputPrepared.cells` and `RenderCellMap` are typed `ReactNode` — substitute your own DOM node type. |
| `rerender-check.ts` | 348 | **Port as-is.** Pure dirty-set computation, no React. |
| `RenderGridModel.ts` | 545 | **Port with rework.** Logic is framework-free (scroll handling, resize, `scrollTo`/`scrollToRow`/`scrollBy`, dirty-set merging) but it extends `TComponentModel` and takes React event types. |
| `types.ts` | 142 | **Port with type substitution** — `ReactNode` → DOM node, `CSSProperties` → own style type. |
| `AsyncRef.ts` | 29 | **Port as-is.** A promise-backed ref, no React. |
| `RenderGrid.tsx` | 294 | **Rewrite.** The DOM shell — sticky bands, scroll container, render area. |
| `RenderFlexGrid.tsx` | 247 | **Rewrite**, or defer (see *Scope*). |

**`AVGrid/model/` — 1,563 lines**

| File | Lines | Port status |
|------|-------|-------------|
| `FocusModel.ts` | 723 | **Port as-is.** The largest single file and the heart of range selection + keyboard navigation. No React import. This is the file that makes the grid worth porting. |
| `EditingModel.ts` | 313 | **Port with rework** — uses `useEffect` for prop sync; also imports `core/utils/audio` (`beep`), which should become an injectable callback or be dropped. |
| `AVGridActions.ts` | 231 | **Port with rework** — DOM/React event handler signatures. |
| `CopyPasteModel.ts` | 181 | **Port as-is.** Clipboard + CSV, no React. |
| `AVGridModel.ts` | 186 | **Port with rework** — the root model; extends `TComponentModel`, composes all sub-models. |
| `ContextMenuModel.tsx` | 158 | ✅ **Rewritten** as `view/ContextMenu.ts` on a new `view/Menu.ts`. The one hard coupling to Persephone's app shell — `showAppPopupMenu` — is replaced by the library's own menu, and `onGridContextMenu` is the injectable handler for a host that wants to draw its own. |
| `RowsModel.ts` | 139 | **Port with rework** — `useEffect` prop sync. |
| `AVGridData.ts` | 134 | **Port as-is.** Plain data container. |
| `ColumnsModel.ts` | 101 | **Port with rework** — `useEffect` prop sync. |
| `EffectsModel.ts` | 99 | **Rework** — exists purely to host React effects; likely dissolves into explicit lifecycle calls. |
| `SortColumnModel.ts` | 53 | **Port with rework** — `useEffect` prop sync. |
| `SelectedModel.ts` | 38 | **Port with rework** — `useEffect` prop sync. |
| `AVGridEvents.ts` | 34 | **Port as-is.** |

**`AVGrid/` views and helpers — 1,884 lines** — all `.tsx`, all **rewrite** except:

| File | Lines | Port status |
|------|-------|-------------|
| `avGridUtils.ts` | 236 | **Port as-is.** Formatting, comparison, value helpers. |
| `avGridTypes.ts` | 137 | **Port with type substitution.** `Column<R>`, `CellFocus`, `CellEdit`, `TSortColumn`, `TFilter` — the public type surface. Strip React types from the renderer/formatter slots. |
| `column-width.ts` | 50 | **Port as-is.** |
| `utils.tsx` | 162 | **Rewrite** — uses `react-dom/server` to render an icon to a string. Trivially replaced by an SVG string constant. |
| `HeaderCell.tsx` | 289 | Rewrite — header cell, sort indicator, resize grip, filter trigger. |
| `DataCell.tsx` | 215 | Rewrite — the hot path. Keep it allocation-light. |
| `CellSelect.tsx` / `CellInput.tsx` / `SelectColumn.tsx` / `DefaultEditFormater.tsx` | 371 | Rewrite — in-cell editors. |
| `useAVGridContext.ts` / `useResolveOptions.ts` | 51 | Drop — React context; the model is passed directly. |

**`AVGrid/filters/` — 752 lines** — **in scope for v1.** See *The filtering subsystem* below
for how these fit together.

| File | Lines | Port status |
|------|-------|-------------|
| `FilterBar.tsx` | 268 | **Rewrite.** The bar of filter chips above the grid. |
| `useFilters.tsx` | 219 | **Port with rework.** Mostly framework-free logic (apply/remove filters, localStorage persistence, Date revival) wrapped in a React context. The context becomes a plain model owned by the grid. |
| `OptionsFilterContent.tsx` | 162 | **Rewrite.** The options (checklist) filter body. |
| `FilterPopover.tsx` | 103 | **Rewrite.** The popover shell + filter-type switch. |

UIKit dependencies to replace: `Popover` (positioned, resizable), `MultiListBox` (checklist
with select-all), `Button`, `Tag` (removable chip), `IconButton`.

### The React coupling — what actually has to change

There are only five kinds of React dependency in the whole codebase. Knowing them makes the
port mechanical rather than exploratory:

1. **The state primitive.** Everything extends `TComponentModel` from
   `core/state/model.ts`, whose reactivity is delivered by a `useComponentModel` hook and
   `state.use(selector)` subscriptions. Replace with a minimal observable base class that
   notifies subscribers — the models' *logic* does not care where the notification goes.
2. **Prop sync via `useEffect`.** Six models (`ColumnsModel`, `RowsModel`, `SelectedModel`,
   `SortColumnModel`, `EditingModel`, `EffectsModel`) use `useEffect` to react to prop
   changes. In a vanilla API these become explicit setters (`grid.setRows(...)`) that call
   the same internal handlers directly. This is a simplification, not a loss.
3. **Cell rendering.** `RenderCellFunc` returns a `ReactNode` and cells are cached in a
   `RenderCellMap`. Return a real `HTMLElement` instead and cache that. **Reuse pooled cell
   elements across scroll frames rather than recreating them** — this is where a naive port
   loses the performance it was written to preserve.
4. **Styling.** Emotion (`@emotion/styled`) throughout, reading tokens from `theme/color.ts`.
   Replace with one static stylesheet driven by CSS custom properties.
5. **UIKit component dependencies.** `Menu`, `Popover`, `Select`, `ListBox`, `MultiListBox`,
   `Input`, `Button`, `IconButton`, `Tag`, `Spinner`, `TruncatedText` — used by the filter UI,
   the context menu, and the cell editors. Write minimal vanilla equivalents, scoped to what
   the grid actually needs. Do not port UIKit.

Note that state classes carry Persephone's own naming quirks (`inputChangted`,
`haderRenderer`, `resizible`, `DefaultEditFormater`). **Fix these spellings in the port** —
this is a new public API, and it is the right moment to correct them.

---

## The filtering subsystem

**Filtering is part of v1 — both the filter bar and the filter popovers.** It is the most
UIKit-coupled corner of the reference implementation, so it needs the most design work, but it
is not optional. It is a core part of what makes the grid usable on a large dataset: with 100k
rows, narrowing the data *is* the primary interaction.

### Three pieces

**1. The filter bar** (`filters/FilterBar.tsx`) — a horizontal strip above the grid showing one
removable chip per applied filter. Each chip reads `ColumnName: value1,value2 (+7)` with a
chevron, and does three things:

- **Displays** the applied filter, with the value list truncated to ~25 characters and the
  remainder shown as an overflow count (`optionsFilterValues()` does this; port that logic).
- **Opens the filter popover for editing** when the chip body is clicked — anchored to the
  chip, so the user edits an existing filter in place. This is the behavior to preserve
  carefully; it is the reason the bar is interactive rather than a passive summary.
- **Removes** the filter via the chip's ✕, plus a "remove all filters" button at the bar's
  right end.

The whole bar hides itself when no filters are applied (`.no-filters { display: none }`), so
it costs no vertical space until it has something to show.

The reference bar also hosts an unrelated "rows are frozen while editing" refresh button, wired
to `gridModel.data.onChange` / `models.rows.unfreezeRows()`. That is a Persephone editing
concern, not a filtering one — keep it out of the filter bar in the port, or make it a
generic host-supplied slot.

**2. The filter popover** (`filters/FilterPopover.tsx`) — a positioned, **resizable** popover
that hosts the filter body. It resolves which body to show from the column's `filterType`
(falling back to the filter's own `type`), so it is a dispatch point built for more filter
types than exist today. It can be anchored to an element (a filter chip, a header cell's
funnel button) *and* offset by a point, and it reports back when the user resizes it.

**3. The filter body** (`filters/OptionsFilterContent.tsx`) — today there is exactly one type,
`"options"`: a searchable multi-select checklist of the column's distinct values with a
select-all, an **Apply** button and a **Clear** button. Notable behaviors to keep:

- Already-selected options are **hoisted to the top** of the list, so the user sees the current
  selection without scrolling.
- Empty-string labels render as `(empty)` rather than a blank row.
- Applying an empty selection removes the filter entirely rather than filtering to nothing.
- Options are supplied by the host through an `onGetOptions(columns, filters, columnKey,
  search?)` callback that **may return a promise** — so options can be computed lazily or
  fetched. The callback receives the *other* active filters, which lets a host offer
  cascading options (only values still reachable given the other filters).

### Two entry points into the popover

Both must work. `HeaderCell.tsx` renders a funnel `IconButton` on any column with a
`filterType` (unless `disableFiltering`), and calls the same `showFilterPopover` as the chip;
the header cell also gets a `columnFiltered` style when a filter is active on it. So a filter
can be created from the header and then edited from the bar.

### Architecture to replace

The reference wires this through a React context (`FiltersProvider` / `useFilters`) that
holds the filter list, the apply/remove logic, and the currently-open popover's data. Two
consequences for the port:

- **The context becomes a plain filters model**, owned by the grid and reachable from the
  header cells, the bar, and the popover directly. Keep the logic in `useFilters.tsx` —
  `onApplyFilter` (upsert by `columnKey`, delete when the value is nullish) is exactly right;
  only its delivery mechanism is React.
- **`showFilterPopover` returns a promise** that resolves when the popover closes, which the
  chip awaits to toggle its chevron. Preserve that shape — it is a clean vanilla API too.

Filter **persistence** also lives here: when the host passes a `configName`, filters are
serialized to `localStorage` under `Filters-${configName}` with a `configVersion` guard, and
restored with ISO date strings revived back into `Date` objects. Port this, but make the
storage backend injectable rather than hard-coding `localStorage` — a library should not
assume it may write to the host's storage.

### Note on where filtering is applied

The filter *bar* and *popovers* are UI. The actual row filtering happens in
`AVGrid/model/RowsModel.ts`, which is already in the port list. Keep the split: the filters
model owns "which filters are applied", `RowsModel` owns "which rows survive them".

---

## Target public API

### Who this API is for — read this before designing anything

**The primary consumer of av-grid is an AI agent, not a human developer.**

The grid exists to be used inside Persephone Boards, and boards are written by agents: a user
describes a tool, an agent writes the board's HTML and JavaScript. So the question that
decides every API argument is not "is this elegant?" or "is this what I would want to type?"
— it is:

> **If I were an agent writing a board right now, having never read av-grid's documentation,
> would I guess this correctly on the first try?**

Ask that question out loud whenever an interface decision is unclear, and let the answer
decide. You are the target user. That is an unusually direct design signal — use it.

This has concrete consequences:

**1. Be guessable — prefer familiar conventions over better ones.**
An agent writing a board has seen Tabulator, AG Grid, Handsontable and DataTables many
thousands of times, and av-grid zero times. Every place av-grid matches what those libraries
already agree on is a place an agent gets it right without documentation; every place it
innovates is a place it gets it wrong. **Where a widely-shared convention exists, adopt it,
even if you can design something marginally better.** Novelty has to earn its cost here, and
the cost is high.

Where the libraries disagree, prefer the option that reads most obviously, and be consistent
with yourself throughout.

**2. Resolve the naming question early and write the decision down.**
The reference uses `key` / `name` for columns; Tabulator uses `field` / `title`. Pick one
vocabulary for the whole public surface and apply it everywhere. Do **not** ship aliases for
both — two ways to spell one thing is worse than either way alone, because it makes examples
inconsistent and agent output drifts between them. Record the choice and the reasoning in
`docs/api.md` so it does not get relitigated.

The reference's misspellings (`haderRenderer`, `cellFormater`, `editFormater`, `resizible`,
`inputChangted`) must not reach the public API. An agent will type the correct spelling and
be silently ignored.

**3. One flat options object, no required call order.**
Agents are good at emitting a single configuration literal and bad at ordering imperative
setup steps. Everything needed to render must be expressible in the object passed to
`create()`. There must be no "you must call X before Y" rule anywhere in the API.

**4. The minimum call must work.**
`AVGrid.create(el, { rows })` should render — inferring columns from the keys of the first
row, inferring a row key, choosing a sensible row height. Agents routinely try the smallest
plausible thing first; if that produces an empty container, the agent concludes the library is
broken and works around it. Every option beyond `rows` should be an optional refinement.

**5. Fail loudly, with errors that say what to do.**
The console is the agent's feedback loop when debugging a board. Errors are part of the API
surface and deserve as much care as the function signatures.
`Unknown column "nmae". Available columns: id, name, email.` teaches the fix.
A silently blank grid teaches nothing. Validate the options object on `create()` and throw on
malformed input rather than rendering something empty.

**6. Make the DOM inspectable.**
Agents debug boards through Persephone's MCP tools — `browser_snapshot`, `browser_evaluate`,
`browser_click`. That is only possible if the rendered DOM is legible and addressable. Put
stable `data-*` attributes on the structural elements (`data-type` on the root and on regions,
`data-row` / `data-col` / `data-column-key` on cells), and keep them stable across versions.
An agent must be able to write `document.querySelector('[data-type="av-grid-cell"][data-row="5"]')`
and have it work. Never encode state in generated class names.

**7. Make the grid introspectable at runtime.**
Provide a way to ask the live instance what it thinks its state is —
`grid.getState()` returning columns, row count, sort, filters, selection and focus as plain
serializable data. An agent that can `console.log` the grid's own view of the world debugs in
one step instead of five. Expose a `version` too.

**8. Cell rendering must be the easy path, not the advanced one.**
Custom cell content is the single most-used extension point in the React version and will be
the most-used here. A per-column render hook receiving a small, documented argument object
and returning **either an HTML string or a DOM element** covers both the common case
(`` render: (c) => `<b>${c.value}</b>` ``, which is what agents reach for) and the careful case
(building an element to attach listeners to). Support both; document the string form first.
Note in the docs that the string form inserts markup — boards are sandboxed, but the caller
still owns escaping untrusted values.

### The shape

Imperative and framework-free. Sketch, not a specification — refine it as the port proceeds,
guided by the principles above:

```js
const grid = AVGrid.create(container, {
    columns: [{ key: "id", name: "ID", width: 80 }, { key: "name", name: "Name" }],
    rows: data,
    getRowKey: (row) => row.id,
    rowHeight: 24,
    onFocusChange: (focus) => {},
    onSelectionChange: (selection) => {},
    onEdit: (columnKey, rowKey, value) => {},
});

grid.setRows(rows);
grid.setColumns(columns);
grid.scrollToRow(50_000);
grid.getSelection();
grid.destroy();
```

Further rules:

- **No hidden global state.** Multiple grids coexist on one page.
- **Controlled where it matters.** Selection, focus and sort are readable and settable by the
  host, mirroring the reference's controlled-prop design.
- **Every callback optional.** A grid with only `columns` + `rows` must render.
- **`destroy()` releases everything** — listeners, observers, pooled DOM.
- **One obvious way to do each thing.** No convenience aliases, no two paths to one result.

### The filter bar's interface

The filter bar is a second public component and needs the same treatment. The open design
question is whether it is:

- **part of the grid** — `filterBar: true` in the grid options, rendered above the grid
  automatically; or
- **a separate component** — `AVGrid.createFilterBar(el, { grid })`, mounted where the host
  wants it.

Decide by the guessability test. A single option on the grid is one line for an agent to write
and impossible to wire up wrong; a separate component costs more setup but lets a board place
the bar in its own toolbar. **Consider supporting the simple path first and the separate mount
as the escape hatch** — but make the call deliberately and record it.

Whichever it is, the host must be able to read and set the filter list programmatically
(`grid.getFilters()` / `grid.setFilters()`) and be notified on change, so a board can persist
filters itself or drive them from its own UI.

### Theming contract

Style entirely through CSS custom properties on the grid root, with sane defaults so the grid
is usable with no theming at all. A theme switch must re-tint the grid with **no JS and no
re-render**.

Persephone Boards expose a `--p-*` palette (`--p-bg`, `--p-panel`, `--p-text`,
`--p-text-muted`, `--p-border`, `--p-accent`, `--p-accent-text`, `--p-success`, `--p-warning`,
`--p-error`, `--p-link`, `--p-shadow`, `--p-radius-*`, `--p-font-*`). Define av-grid's own
namespaced variables (`--avg-*`) that *default to* the `--p-*` values where they exist, so the
grid drops into a board and inherits the app theme automatically, while staying independent of
Persephone for everyone else.

Reference for what needs to be themeable: the styled block at the top of
`AVGrid/AVGrid.tsx` (lines ~29–198) enumerates every visual state — header cells, data cells,
row hover, row selection, the four selection-border edges, the focused cell, and the
borderless variant.

---

## Scope

**v1 — the core, matching the reference:**
virtualized rendering on both axes · sticky header + sticky columns · column resize and
reorder · sorting · row selection · cell focus and keyboard navigation · Excel-style range
selection · clipboard copy/paste · in-cell editing · row/column add and delete ·
**column filtering, including the filter bar and the filter popovers** (see *The filtering
subsystem*) · CSS-variable theming.

**Defer past v1:** `RenderFlexGrid` · additional filter types beyond `"options"` (the popover is
already a dispatch point, so these are additive).

~~the context menu~~ — deferred here, then built in the polish phase after task 18, once
`Popover` made it a hundred lines rather than a dependency on Persephone's app shell. Both
halves shipped: the grid draws its own menu, and `onGridContextMenu(e, items)` hands the point
and the generated items to a host that would rather draw one itself.

**Non-goals:** row grouping, tree/hierarchical data, frozen row groups, pagination, aggregation
rows, server-side data models. Tabulator covers these; av-grid's differentiator is raw scale,
and every feature added is a chance to reintroduce a full-viewport repaint.

---

## Documentation and examples

Two deliverables beyond the library itself. They are expected to be **written after the
implementation lands**, but the API should be designed as though they already exist — if a
rule is hard to state in a sentence, or an example needs three paragraphs of caveats, that is
a signal to change the API, not the prose.

**`docs/api.md` — the grid API reference.** The complete public surface: the options object
field by field, the column definition, every instance method, every event, the CSS custom
properties, and the filter API. Written for an agent reading it once, mid-task, to answer a
specific question — so: exhaustive, skimmable, heavy on short code snippets, light on
narrative. Include the naming decision and its reasoning (see *Who this API is for*, rule 2).

**`examples/` — runnable examples.** Standalone HTML files, each opening in a browser with no
build step, each demonstrating one thing and small enough to read whole:

- minimal (`rows` only, columns inferred)
- explicit columns, widths, alignment, formatting
- custom cell rendering
- sorting and filtering, with the filter bar
- selection, focus and keyboard navigation
- in-cell editing
- clipboard copy/paste
- theming via CSS custom properties
- a 100k-row benchmark (this doubles as the performance harness required by the working
  agreements in [`../CLAUDE.md`](../CLAUDE.md))
- a Persephone Board using the grid, wired to the `--p-*` palette and
  `persephone.onThemeChange`

Examples are the highest-leverage documentation for this project's audience: an agent that
finds a close-enough example copies and adapts it correctly far more reliably than one
assembling a call from a reference table. Treat them as a primary deliverable, not a
nice-to-have — and keep each one **copy-pasteable in full**, since that is how they will be
used.
