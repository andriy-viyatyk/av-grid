# av-grid — Implementation Plan

The task-by-task build order. [`goal.md`](goal.md) is the *what* and *why*; this document is
the *in what order*, with a definition of done for each step.

**How to use this document:** work one task at a time, top to bottom. A task is finished only
when every line in its **Done when** list is true. Update the **Status** column in the tracker
below as you go, and record any decision that changes the plan in *Decision log* at the bottom
rather than silently diverging.

Reference paths and the read-only rule: [`../CLAUDE.md`](../CLAUDE.md).

---

## Decisions made up front

These were open questions in `goal.md`. They are settled; do not relitigate them mid-port.

| Question | Decision | Reasoning |
|----------|----------|-----------|
| Column vocabulary | **`key` / `name`** | Matches the reference exactly, so every ported model file stays a straight translation and behavior can be diffed against the original. No aliases — `field`/`title` are not accepted. |
| Filter bar mounting | **`filterBar: true` grid option, plus `AVGrid.createFilterBar(el, { grid })` as the escape hatch** | One line for the common case an agent will write; the separate mount exists for boards that want the bar in their own toolbar. |
| Build order | **Engine first, bottom-up** | The performance thesis is the whole point of the project. A scrolling 100k-row grid with zero features, benchmarked, de-risks everything downstream. |

Two more that follow from *Who this API is for* and are worth stating explicitly:

- **Misspellings are fixed in the port.** `inputChangted` → `inputChanged`, `haderRenderer` →
  `headerRenderer`, `cellFormater` → `cellFormatter`, `editFormater` → `editFormatter`,
  `resizible` → `resizable`, `DefaultEditFormater` → `DefaultEditFormatter`.
- **Public API is the only API.** Everything reachable from `src/index.ts` is documented and
  stable; everything else is internal and may change.

---

## Task tracker

| # | Task | Phase | Status |
|---|------|-------|--------|
| 1 | Foundations — observable, types, utils | Engine | ✅ Done |
| 2 | Geometry — `renderInfo` + `rerender-check` | Engine | ✅ Done |
| 3 | `RenderGridModel` — scroll, resize, dirty merge | Engine | ✅ Done |
| 4 | DOM shell — sticky bands + cell pool | Engine | ✅ Done |
| 5 | **Benchmark — 100k rows** ⛔ perf gate | Engine | ✅ Done — **gate passed** |
| 6 | Public entry — `AVGrid.create()` + validation | Grid | ✅ Done |
| 7 | Columns, rows, sorting | Grid | ✅ Done |
| 8 | Header cell — sort indicator, resize, reorder | Grid | ✅ Done |
| 9 | Data cell + theming stylesheet | Grid | ✅ Done |
| 10 | Focus, keyboard nav, range selection | Behavior | ✅ Done — **drag gate passed** |
| 11 | Row selection + select column | Behavior | ✅ Done |
| 12 | In-cell editing | Behavior | ✅ Done |
| 13 | Clipboard copy/paste | Behavior | ✅ Done |
| 14 | Row/column add and delete | Behavior | ✅ Done |
| 14a | `Popover` primitive | Filters | ✅ Done |
| 14b | `VirtualList` primitive — on `RenderGrid` | Filters | ✅ Done |
| 15 | Filters model + row filtering | Filters | ✅ Done |
| 16 | Filter popover + options body | Filters | ✅ Done |
| 17 | Filter bar | Filters | ✅ Done |
| 17a | `CellSelect` rebuilt on the two primitives | Filters | ✅ Done |
| 18 | `getState()`, introspection, `destroy()` | Polish | ✅ Done |
| 19 | `docs/api.md` | Docs | ⬜ Not started |
| 20 | `examples/` | Docs | ⬜ Not started |

Status values: ⬜ Not started · 🟡 In progress · ✅ Done · ⏸️ Blocked (say why).

---

## Standing rules for every task

Applied to all 20 tasks; not repeated in each one.

- **Read the reference file before writing the port of it.** The Persephone file is the
  specification. When behavior is unclear, read it rather than inventing.
- **`npm run typecheck` passes.** Strict mode, no `any` in the public surface, no `@ts-ignore`.
- **No runtime dependency is added.** Ever.
- **After any task that touches the render path (2, 3, 4, 9, 10, 12), re-run the benchmark
  from task 5 and record the numbers.** A regression is the only kind of bug that matters here.
- **Structural DOM gets stable `data-*` attributes** — `data-type` on the root and each region,
  `data-row` / `data-col` / `data-column-key` on cells. State never goes in class names in a
  way that breaks selectors, and never in generated names.
- **Write the usage snippet before the implementation** for any new public surface. If the
  snippet is awkward, fix the API first.

---

## Phase 1 — Engine (tasks 1–5)

The goal of this phase is a grid that renders 100,000 × 20 nothing-cells and scrolls perfectly.
No columns, no selection, no behavior. If this phase is right, everything after it is
straightforward; if it is wrong, nothing after it can be fixed.

### Task 1 — Foundations

Replace the five React dependencies' lowest layer so the rest of the port has ground to stand
on.

**Build**
- `src/core/observable.ts` — minimal observable base replacing `TComponentModel` /
  `TComponentState`. Needs: a state object, `update(mutator)`, `subscribe(fn): () => void`,
  and batched notification (multiple `update()` calls in one tick → one notify). No selectors
  needed — the render layer's dirty set does that job.
- `src/core/events.ts` — port of `core/state/events.ts` (small, framework-free).
- `src/core/csv.ts` — port of `core/utils/csv-utils.ts` as-is.
- `src/core/utils.ts` — only the functions actually used from `core/utils/utils.ts`,
  `core/utils/memorize.ts`, `shared/utils.ts`. Do not port the rest.
- `src/render/types.ts` — port of `RenderGrid/types.ts` with `ReactNode` → `HTMLElement`,
  `CSSProperties` → an own minimal style type, `Ref<T>` dropped.
- `src/types.ts` — port of `AVGrid/avGridTypes.ts`: `Column<R>`, `CellFocus`, `CellEdit`,
  `TSortColumn`, `TFilter`, with React types stripped from the renderer/formatter slots and
  the misspellings fixed.

**Done when**
- The observable has a unit test covering batching and unsubscribe.
- `src/types.ts` compiles with no React import anywhere in `src/`.
- The renderer/formatter slots in `Column<R>` accept `string | HTMLElement` returns.

### Task 2 — Geometry

The pure math. No DOM in this task at all — which is what makes it fully unit-testable.

**Build**
- `src/render/renderInfo.ts` — port of `RenderGrid/renderInfo.ts` (704 lines) nearly as-is.
  Visible-window math, sticky-band splitting, column/row start offsets, overscan.
- `src/render/rerender-check.ts` — port of `RenderGrid/rerender-check.ts` (348 lines) as-is.
  Pure dirty-set computation.

**Done when**
- Unit tests cover: visible window at offset 0 / mid / max; variable row heights and column
  widths; each sticky band's membership; `fitToWidth`; overscan boundaries.
- Dirty-set tests prove the central invariant: **changing one cell's state produces a
  `RerenderInfo` naming that cell only** — not its row, not the viewport.
- Zero references to `document` or any DOM global in both files.

### Task 3 — RenderGridModel

**Build**
- `src/render/RenderGridModel.ts` — port of the 545-line original with rework. Scroll
  handling, resize observation, `scrollTo` / `scrollToRow` / `scrollBy`, dirty-set merging
  across `update()` calls, `AsyncRef` (port as-is, `src/core/AsyncRef.ts`).

**Critical**
- `inputChangted()` becomes `inputChanged()` and **still excludes the scroll offset from its
  comparison**. The original carries a comment explaining why; carry the comment over. This is
  the single most important line in the port.
- Extends the task-1 observable, takes DOM events (not React synthetic events).

**Done when**
- A test asserts that changing only the scroll offset does **not** report an input change.
- Merged `RerenderInfo`s across two `update()` calls in one frame produce the union, and
  `all: true` short-circuits the rest.

### Task 4 — DOM shell

The rewrite of `RenderGrid.tsx`. This is new code, not a transliteration.

**Build**
- `src/render/RenderGrid.ts` — the scroll container, the inner sizer element, the nine render
  regions (center + 4 sticky bands + 4 corners), and the paint loop that consumes
  `RerenderInfo`.
- **A cell element pool.** Cells scrolling out of the window are returned to the pool and
  reused with new content and position rather than created and destroyed. This is where a
  naive port loses the performance the engine was written to preserve.
- Painting is driven from `requestAnimationFrame`, one paint per frame maximum.

**Done when**
- Scrolling 100k rows allocates no new cell elements after the first few frames (verify in
  DevTools' allocation profiler, or by counting pool misses behind a debug flag).
- A dirty set of one cell touches exactly one DOM element.
- `data-type` is on the root and each of the nine regions; `data-row` / `data-col` on cells.

### Task 5 — Benchmark ⛔ **Performance gate**

**Build**
- `test-boards/RenderGridTest/` — a **Persephone board** carrying the harness: 100,000 rows ×
  20 columns generated client-side, with an on-page readout of FPS during a scripted scroll,
  time to first paint, and paint time per frame at row ~99,000. Everything is also exposed on
  `window.bench`, so it can be driven through the browser MCP tools with no clicking — which
  makes it a debugger for every later task, not only a benchmark.
- `tasks/benchmark-results.md` — the baseline numbers, dated, with the machine noted.

> The standalone `examples/benchmark.html` (no build step, opens in any browser) is still a
> task-20 deliverable. The board came first because it can be inspected and driven directly.

**Done when**
- Sustained 60fps scrolling through the full 100k range.
- Time-to-first-paint under 100ms after data is in memory.
- Frame cost at row 99,000 is within noise of the cost at row 100 — **the flat-cost property
  is the whole thesis**; if it is not flat here, stop and fix the engine before task 6.

> **Do not proceed past this gate on a "close enough" result.** Every later task adds work to
> the render path. Whatever headroom does not exist now will not appear later.

---

## Phase 2 — Grid (tasks 6–9)

### Task 6 — Public entry

Design the options object first, as a snippet, then implement it.

**Build**
- `src/AVGrid.ts` + `src/index.ts` — `AVGrid.create(container, options)` returning the
  instance, with the UMD global wired up in the vite build.
- `src/validate.ts` — options validation that throws on malformed input with errors naming the
  fix: `Unknown column "nmae". Available columns: id, name, email.`
- Inference for the minimum call: `AVGrid.create(el, { rows })` infers columns from the first
  row's keys, infers a row key, picks a default row height.

**Done when**
- `AVGrid.create(el, { rows: [{a:1},{a:2}] })` renders a visible grid with a header.
- Every option other than `rows` is optional, and there is no required call order anywhere.
- Two grids on one page do not interfere. No module-level mutable state.
- Passing a bad column key, a missing container, or a non-array `rows` throws a message that
  says what to do.

### Task 7 — Columns, rows, sorting

**Build**
- `src/model/ColumnsModel.ts`, `RowsModel.ts`, `SortColumnModel.ts`, `AVGridData.ts`,
  `AVGridEvents.ts`, `AVGridModel.ts` — ported, with the `useEffect` prop-sync in each
  replaced by explicit setters (`setRows`, `setColumns`, `setSort`) calling the same internal
  handlers. `EffectsModel` dissolves into explicit lifecycle calls rather than being ported.
- `src/column-width.ts` and `src/gridUtils.ts` (from `avGridUtils.ts`) — as-is.

**Done when**
- `grid.setRows(newRows)` repaints without a full teardown and without a scroll-position jump.
- Sorting 100k rows re-sorts and repaints; measure it and record the number.
- Row filtering hooks exist in `RowsModel` but are not wired yet (task 15 fills them).

### Task 8 — Header cell

**Build**
- `src/view/HeaderCell.ts` — label, sort indicator, resize grip, filter funnel button (inert
  until task 16), `columnFiltered` state class.
- Column resize by drag; column reorder by drag.
- `src/view/icons.ts` — SVG string constants replacing the `react-dom/server` icon rendering
  in `utils.tsx`.

**Done when**
- Resizing a column repaints only the affected columns, not the viewport.
- Sort indicator reflects `getState().sort` and clicking cycles asc → desc → none.

### Task 9 — Data cell + theming

**Build**
- `src/view/DataCell.ts` — the hot path. Allocation-light: reuse text nodes, avoid per-paint
  object literals, no closures created per cell per frame.
- `src/styles/av-grid.css` — one static stylesheet, no JS-generated styles, driven entirely by
  `--avg-*` custom properties that default to `--p-*` where those exist. Ported from the
  styled block at the top of `AVGrid.tsx` (lines ~29–198): header cells, data cells, row
  hover, row selection, the four selection-border edges, focused cell, borderless variant.
- Per-column `render` hook accepting a return of `string | HTMLElement`.

**Done when**
- Switching a theme by changing CSS variables on an ancestor re-tints the grid with **no JS
  and no re-render**.
- The custom `render` hook works in both string and element form.
- **Benchmark re-run: no regression against the task-5 baseline.**

---

## Phase 3 — Behavior (tasks 10–14)

### Task 10 — Focus, keyboard nav, range selection

The heart of the port. `FocusModel.ts` is 723 lines and has no React import — it ports nearly
verbatim.

**Build**
- `src/model/FocusModel.ts` — ported as-is on top of the task-1 observable.
- `src/model/AVGridActions.ts` — ported with DOM event signatures replacing React's.

**Done when**
- Arrow keys, Tab, Home/End, PageUp/PageDown, Ctrl+arrows, Shift+arrows all match the
  reference's behavior.
- **Dragging a range selection at row 99,000 is as fast as at row 100** — the specific failure
  this whole project exists to avoid. Measure both; record both.
- Each mouse-move during a drag repaints only the cells whose selection state changed. Verify
  by instrumenting the dirty set, not by eye.

### Task 11 — Row selection

**Build**
- `src/model/SelectedModel.ts` — ported, prop sync → `setSelected()`.
- `src/view/SelectColumn.ts` — the checkbox column, rewritten.

**Done when** selection is readable and settable by the host, `onSelectionChange` fires, and
select-all on 100k rows does not stall.

### Task 12 — In-cell editing

**Build**
- `src/model/EditingModel.ts` — ported; the `useEffect` prop sync becomes explicit, and the
  `core/utils/audio` `beep` import becomes an injectable `onInvalidEdit` callback (default:
  no-op — a library should not make noise uninvited).
- `src/view/CellInput.ts`, `CellSelect.ts`, `DefaultEditFormatter.ts` — rewritten.

**Done when** editing starts on typing/F2/double-click, commits on Enter/Tab/blur, cancels on
Escape, `onEdit(columnKey, rowKey, value)` fires, and **the benchmark shows no regression**.

### Task 13 — Clipboard copy/paste

**Build**
- `src/model/CopyPasteModel.ts` — ported as-is on top of `src/core/csv.ts`.

**Done when** copy from the grid pastes into Excel with correct cell boundaries, and a paste
from Excel lands in the right cells including quoted values containing tabs and newlines.

### Task 14 — Row/column add and delete

**Build**
- The `onAddRows` / `onDeleteRows` / `onAddColumns` / `onDeleteColumns` paths, plus the
  add-row affordance after the last row.

**Done when** each callback fires with the documented arguments and the grid repaints without
losing focus or scroll position.

> **Deferred from this phase:** the context menu. Ship `onContextMenu` and let the host draw
> its own menu, per *Scope* in `goal.md`. `ContextMenuModel.tsx` is not ported.

---

## Phase 4 — Filters (tasks 14a, 14b, 15–17, 17a)

The most UIKit-coupled corner of the reference, so it gets the most design work. Read *The
filtering subsystem* in `goal.md` before starting task 15 — it enumerates behaviors that are
easy to miss and annoying to retrofit.

Two of those UIKit couplings are load-bearing enough to build **before** the filters model
rather than inside task 16, which is what tasks 14a and 14b are. Both are **built fresh, not
ported** — see the decision log.

### Task 14a — `Popover` primitive

**Build**
- `src/view/Popover.ts` — a positioned floating panel, ~120 lines, no portal and no lifecycle
  framework. Read `uikit/Popover/PopoverModel.ts` for the behaviors, then write it fresh:
  - anchored to an **element** *and* offset by a **point** (the reference supports both, and
    the filter chip and the header funnel use them differently);
  - **flips** when it will not fit below / to the right of the anchor, and clamps to the
    viewport;
  - closes on outside pointerdown and on Escape, and **`show()` returns a promise that
    resolves when it closes** — the shape `showFilterPopover` needs;
  - optionally **resizable**, reporting the new size back so the caller can remember it.
- Listeners go on the popover root and on `document`, never on content. It mounts outside the
  grid root, so it is the first thing in the library that is not inside the grid's own DOM —
  `destroy()` must take it with it (task 18).

**Done when** a popover opens against a header cell near the right edge of the window and
flips rather than clipping, Escape and an outside click both resolve its promise, and nothing
is left on `document` after it closes.

### Task 14b — `VirtualList` primitive — on `RenderGrid`

**Build**
- `src/view/VirtualList.ts` — a single-column virtualized list of checkbox+label rows over the
  **engine we already own**, ~200 lines. Not a port of `ListBox` / `MultiListBox`: search box,
  select-all, arrow-key navigation, `scrollToRow`, and nothing else.
- The same three invariants apply as everywhere else — `p.previous ?? p.recycle?.()`,
  listeners on the root, state on the model.

**Done when** a list of 100,000 options scrolls at 60 fps and mounts in the same order of
magnitude as the grid does, measured on a board rather than asserted.

> **Why this is a prerequisite and not part of task 16.** A distinct-values checklist over a
> 100k-row column can legitimately produce tens of thousands of options, and the reference
> hands all of them to `MultiListBox` at once. Unvirtualized, that is the one place in the
> design that reintroduces exactly the cost this library exists to avoid.

### Task 15 — Filters model + row filtering

**Build**
- `src/model/FiltersModel.ts` — the logic from `useFilters.tsx` with the React context
  removed. `onApplyFilter` upserts by `columnKey` and deletes when the value is nullish —
  port that shape exactly.
- Persistence with an **injectable storage backend** (default: none — the library does not
  write to the host's storage unless asked). `configName` + `configVersion` guard, ISO date
  strings revived to `Date`.
- Wire the row filtering into `RowsModel`, keeping the split: the filters model owns *which
  filters are applied*, `RowsModel` owns *which rows survive them*.
- Public `grid.getFilters()` / `grid.setFilters()` + an `onFiltersChange` callback.

**Done when** filtering 100k rows down and back up is smooth, and filters round-trip through
the injected storage including `Date` values.

### Task 16 — Filter popover + options body

**Build**
- `src/view/FilterPopover.ts` — positioned, resizable, anchorable to an element *and* offset
  by a point, reporting resize back. `showFilterPopover` **returns a promise resolving when
  the popover closes** — preserve that shape, it is a clean vanilla API.
- `src/view/OptionsFilterContent.ts` — searchable multi-select checklist, select-all, Apply,
  Clear. Behaviors that must survive the port:
  - selected options **hoisted to the top** of the list;
  - empty-string labels render as `(empty)`;
  - applying an empty selection **removes** the filter rather than filtering to nothing;
  - `onGetOptions(columns, filters, columnKey, search?)` **may return a promise**, and
    receives the *other* active filters so a host can offer cascading options.
- Built on `Popover` (task 14a) and `VirtualList` (task 14b). What is left here is `Button` and
  `IconButton` — scoped to exactly what the grid needs. Do not port UIKit.
- Wire the header cell's funnel button (built inert in task 8) to open it.

**Done when** a filter can be created from a header funnel, the popover dispatches on the
column's `filterType` (falling back to the filter's own `type`), and every bullet above has a
test or a documented manual check.

### Task 17 — Filter bar

**Build**
- `src/view/FilterBar.ts` — one removable chip per applied filter, reading
  `ColumnName: value1,value2 (+7)`; the value list truncated to ~25 characters with the
  remainder as an overflow count (port `optionsFilterValues()`). Chip body click opens the
  popover **anchored to the chip** for in-place editing; chip ✕ removes; a "remove all" button
  at the right end. The bar hides entirely when no filters are applied.
- `filterBar: true` grid option, and `AVGrid.createFilterBar(el, { grid })` for custom
  placement.

**Not ported:** the reference bar's "rows are frozen while editing" refresh button. That is a
Persephone editing concern, not a filtering one.

**Done when** a filter created from the header is editable from its chip, and both mounting
paths work with two grids on one page.

### Task 17a — `CellSelect` rebuilt on the two primitives

**Build**
- `src/view/CellSelect.ts` rewritten over `Popover` + `VirtualList`, replacing the native
  `<select>`. Roughly 60 lines once both exist.

**Done when** a column with 10,000 `options` opens instantly, the dropdown is themed by the
same `--p-*` contract as the rest of the grid, and keyboard commit/cancel behaves exactly as
the native element did.

> **Why after 17 and not before.** Column `options` are enumerations — status, category — and
> are realistically under a hundred, so the native element's size limit is not what makes this
> worth doing. The real argument is that a native `<select>` cannot be themed to match, which
> is a task-9 concern the port has been carrying quietly. It is cheap only *after* both
> primitives exist, so it waits for them.

---

## Phase 5 — Polish and docs (tasks 18–20)

### Task 18 — Introspection and teardown

**Build**
- `grid.getState()` returning columns, row count, sort, filters, selection and focus as plain
  serializable data.
- `AVGrid.version`.
- `grid.destroy()` releasing **everything** — listeners, observers, pooled DOM, timers.

**Done when** `console.log(grid.getState())` answers "what does the grid think is going on"
in one step, and creating + destroying a grid 100 times in a loop shows flat memory.

### Task 19 — `docs/api.md`

Exhaustive, skimmable, heavy on short snippets, light on narrative — written for an agent
reading it once, mid-task, to answer one question. Covers the options object field by field,
the column definition, every instance method, every event, every CSS custom property, and the
filter API. **Includes the naming decision and its reasoning** so it is not relitigated.

### Task 20 — `examples/`

One standalone HTML file per topic, no build step, each small enough to read whole and
**copy-pasteable in full**: minimal · explicit columns · custom cell rendering · sorting and
filtering with the bar · selection and keyboard nav · editing · clipboard · theming ·
the 100k benchmark (already built in task 5) · a Persephone Board wired to `--p-*` and
`persephone.onThemeChange`.

---

## Decision log

Append here whenever the plan changes during implementation — what changed, and why. Empty at
the start.

| Date | Task | Decision |
|------|------|----------|
| 2026-08-08 | — | Plan written. Vocabulary `key`/`name`; filter bar as grid option with a separate-mount escape hatch; engine-first build order. |
| 2026-08-08 | 1 | **`csv-utils.ts` could not be ported as-is.** `goal.md` lists it "port as-is", but it is a wrapper over the `csv-stringify` / `csv-parse` npm packages, and av-grid ships zero runtime dependencies. `src/core/csv.ts` keeps the two signatures and the observed behavior (including the `relax_quotes` / `relax_column_count` / `skip_empty_lines` leniencies and the `!csv.trim()` early return) with an own RFC 4180 implementation. Covered by 24 tests including an Excel round-trip. |
| 2026-08-08 | 1 | **Observable diverges from `TComponentState` in two ways, both deliberate.** No selectors — the render layer's dirty set does that job far more precisely than a selector could. And `update()` shallow-clones rather than running immer's `produce()`: nothing in the grid diffs nested state, so structural sharing buys nothing and costs a dependency. Notifications coalesce on the microtask queue, with `batch()` for explicit grouping and `flush()` for synchronous delivery. |
| 2026-08-08 | 1 | **`Subscription` dropped its `EventTarget` / `CustomEvent` plumbing.** A plain listener array is smaller and lets the payload be typed non-optional — the reference's `(detail?: D) => void` was optional even when the sender always sent a value. |
| 2026-08-08 | 1 | **Type names lost the `T` prefix.** `TSortColumn` → `SortColumn`, `TFilter` → `Filter`, `TDisplayFormat` → `DisplayFormat`, and so on. The prefix is Persephone house style; a consumer would not guess it. `RanderedRange` → `RenderedRange` while passing. |
| 2026-08-08 | 1 | **`cellRenderer` and `cellFormater` collapsed into one `render` hook.** They differed only because one was a React `ComponentType` and the other returned a `ReactNode`; in the DOM both are "a function producing cell content", so keeping two would be two ways to do one thing. `haderRenderer` → `headerRender`, `editFormater` → `editRender`. `render` returns `string \| HTMLElement \| null`. |
| 2026-08-08 | 1 | **`dataAlignment` → `align`**, on the guessability test — it is what Tabulator-adjacent muscle memory reaches for. **`Column.name` is now optional**, defaulting to `key`, so the minimum call in rule 4 of *Who this API is for* holds for inferred columns. |
| 2026-08-08 | 1 | **`toClipboard` returns its promise** instead of swallowing it. The clipboard API rejects when the document is unfocused or permission is denied, and a copy that silently did nothing is the kind of failure that burns an agent's debugging loop. `debounce` and `memorize` gained `cancel()` / `clear()` so `destroy()` can release them. |
| 2026-08-08 | 2 | **Dropped `RenderInfoProto` and its `calcExpandWidth` / `calcExpandHeight` methods.** They were attached to every render-info object via `Object.setPrototypeOf` and are called nowhere in Persephone — verified by grepping all of `src/renderer`. Removing them also removes a prototype mutation on a hot object. |
| 2026-08-08 | 2 | **Two reference quirks found, preserved, and pinned with tests rather than fixed.** (a) A *first* `calcRenderInfo` call carrying a scroll `direction` at offset (0,0) falls inside the initial state's all-zero `visibleOffset` and returns it having rendered nothing — so task 3 must not pass a direction on a grid's first frame, or it comes up blank. (b) `rowInRange`/`colInRange` end with `r >= rowCount - stickyBottom`, which with `stickyBottom: 0` admits *any* out-of-bounds index; marking one paints nothing but costs an unnecessary recompute, so callers must mark real indices only. |
| 2026-08-08 | 3 | **Bug fixed in `AsyncRef`: the reference never resolved its first promise.** `async`'s class-field initializer installed `resolveAsync`, then the constructor *body* ran `this.resolveAsync = undefined` and wiped it — field initializers run before the body. The first `ref()` therefore took the `else` branch and *replaced* `async` with a fresh promise, so any caller holding the original waited forever. That is exactly `grid.scrollToRow(50_000)` issued right after `create()`, which *Target public API* requires to work. Building the promise in the constructor body is the fix; a test covers the before-attach case. |
| 2026-08-08 | 3 | **The first-frame direction trap from task 2 is now guarded in `updateRenderInfo`.** It passes `direction` through only once `renderInfo.current` has moved off `renderInfoInitialState`; otherwise scrolling back to the very top before anything had rendered would return the initial state and leave the grid blank. |
| 2026-08-08 | 3 | **`setTimeout(checkSize, 200)` on mount → a `ResizeObserver` attached in `attach()`.** The reference's poll both delayed the first paint by 200ms and missed every subsequent resize. `attach()` degrades gracefully where `ResizeObserver` is undefined. |
| 2026-08-08 | 3 | **`setOptions` notifies rather than suppressing.** The reference passed `inRender: true` here to avoid a setState during React's render phase, because React was about to repaint anyway. Nothing repaints on its own in the DOM port, so the notification must actually be sent. `rerender()` is renamed `requestRepaint()` — in a DOM library "rerender" reads as the paint itself rather than a request for one. |
| 2026-08-08 | 4 | **Region syncing is set arithmetic, not diffing.** Cells are absolutely positioned, so DOM order carries no meaning — a region is reconciled by removing what left and appending what arrived, with no reordering, no `insertBefore` and no keyed reconciliation. A one-row scroll touches twelve nodes regardless of viewport size. The per-region `attached` set only ever holds cells the shell appended, so a sync can never remove a region's structural children — which is why centre cells can live directly on the render area, exactly as in the reference. |
| 2026-08-08 | 4 | **The pool is reached through a `recycle` hook threaded from the shell to `renderCell`.** `CalcRenderInfoInput` → `RenderData` → `RenderCellParams` each gained one optional field, forwarded verbatim; the geometry never calls it, so `renderInfo.ts` stays pure. **`release()` deliberately does not reset the element** — it arrives at its next occupant with the same children, classes and listeners, because reusing the inner structure is most of the saving. Cell renderers must overwrite everything they set (task 9). |
| 2026-08-08 | 4 | **First paint is synchronous; every later paint is on `requestAnimationFrame`.** Painting the constructor's first frame inline means the grid is on screen when `create()` returns rather than a frame later, which matters for the "minimum call must work" rule. The paint early-returns when the render info is the identical object *and* scrollbar thickness is unchanged — the second half of that condition matters because a scrollbar can appear after a paint without the geometry having moved. |
| 2026-08-08 | 4 | **`happy-dom` added as a dev dependency** for the shell tests only, via a per-file `@vitest-environment` docblock; every other test stays in the node environment. happy-dom does no layout, so the tests pin `offsetWidth`/`offsetHeight` — which is itself a useful check that the shell reads nothing else. |
| 2026-08-08 | 5 | **⛔ Gate passed.** 100k × 20 in a real browser: first paint 5.6 ms, scroll 60.0 fps at both the top and row 99,000, zero cell allocations while scrolling, and a **flat-cost ratio of 1.02×** — a paint at row 99,000 costs 1.07 ms against 1.04 ms at row 100. That ratio is the whole thesis of the project. ~92% of each frame is still free for tasks 6–17. Full numbers in [`benchmark-results.md`](benchmark-results.md). |
| 2026-08-08 | 5 | **`previous` added to `RenderCellParams` — the element already rendered at that coordinate.** The first benchmark run showed a full repaint costing 2.42 ms and **504 DOM mutations**, because every dirty cell was being *replaced* by a pooled element: `renderCell` had no way to reach the element already there. With the hint, renderers update in place — **0.195 ms and 2 mutations, a 12× improvement** on the path sorting, filtering and data changes all take. The correctness half matters more: swapping the element out destroys anything living on it, so task 12's in-cell editor would have lost focus whenever its cell was marked dirty. Renderers should read `p.previous ?? p.recycle?.() ?? createElement()`. |
| 2026-08-08 | 5 | **The harness is a Persephone board, not a standalone HTML file.** `test-boards/RenderGridTest/` can be opened, screenshotted and scripted through the browser MCP tools, so it doubles as a debugger for every later task. Its `lib/` is a gitignored build artifact — `npm run build:board` regenerates it. The standalone `examples/benchmark.html` remains a task-20 deliverable. |
| 2026-08-08 | 1 | **Scaffold fix:** `@types/node` was missing, so `vite.config.ts` did not typecheck. Added as a dev dependency with `"node"` in `tsconfig.types`. |
| 2026-08-08 | 6 | **The host no longer owns the grid's state.** `AVGridProps` passed `columns`, `sort`, `selected` and `focus` *down* with a setter passed back *up*, because that is how React state lifting works. From plain JavaScript it is the wrong shape — nothing is re-rendering, so there is nobody to hand the value back. The grid owns its state, mutates it, and *reports* through callbacks (`onSortChange`, `onColumnResize`, `onColumnsChange`); a host that wants control uses the matching setter. Both paths run the same handler, which is what makes "no required call order" true rather than aspirational. |
| 2026-08-08 | 6 | **`AVGrid.create()` accepts a CSS selector as well as an element**, because `AVGrid.create("#grid", …)` is what people try first and failing it teaches nothing. Validation messages name the fix and the *available* values — `Unknown column "nmae". Available columns: id, name, email.` — and a column whose key is absent from the data throws unless it is computed (has `render` / `formatValue` / `isStatusColumn`), because a silently empty column reads as a rendering bug. |
| 2026-08-08 | 6 | **Inference goes further than "columns from the first row's keys".** It samples 50 rows so a key only later rows carry is not missed; humanizes labels (`firstName` → *First Name*, `id` → *ID*); guesses `dataType` from the sampled values and `displayFormat: "dateTime"` for Dates; and sizes each column from its content. Array rows work too — keys are indices, labels 1-based — because that is the shape the benchmark harness uses. `getRowKey` prefers an `id`-shaped property and otherwise assigns an identity per row *object* in a `WeakMap`, which survives sorting and filtering where an index would not. |
| 2026-08-08 | 6 | **Bug found by the board, fixed in the shell: the grid rendered nothing unless the caller passed `growToHeight`.** A virtualized grid measures its own root to decide what to draw, so that height must be *definite*; the shell's default was a literal `height: 100px`, and `RenderGridTest` only looked right because it happened to pass `growToHeight: "100%"`. A new `height` shell option carries an explicit height, and `AVGrid` sets it: `100%` when the container has a height, a `400px` fallback when it does not, plus a one-frame re-check that upgrades to `100%` if the container simply had not been laid out yet. Without this the minimum call — the thing task 6 exists to make work — produced a blank box. |
| 2026-08-08 | 7 | **Bug found and fixed: flipping a sort from ascending to descending did not re-sort.** `defaultCompare` is memorized by key, so both directions resolve to the *same* comparator; `AVGridData` compares by identity, reported no change, and `RowsModel` never re-ran. The reference did not have this hole because its `useEffect` watched the sort object rather than the comparator. `SortColumnModel.sortChanged` now re-runs the pipeline itself when the comparator identity is unchanged, and leaves the key-change case to the data event. Pinned with a test. |
| 2026-08-08 | 7 | **`EffectsModel` dissolved rather than ported**, as planned, and `AVGridData` kept every field including the ones nothing reads yet (`rowsFrozen`, `newRowKey`, `editTime`, `allSelected`). They are the hooks tasks 11–15 attach to, and inventing them later would mean re-deriving the change-event batching that makes them cheap. |
| 2026-08-08 | 8 | **No per-cell listeners anywhere. The root delegates.** The reference bound a dozen handlers to every cell, which React made cheap by memoizing them. In a *pooled* DOM grid that is not merely slower, it is unsound: an element that was a header cell one frame is a data cell the next, so listeners would have to be unbound on every recycle and any one missed would fire against the wrong column. `GridInteractions` binds ten listeners to the root for the whole grid and resolves each event by reading `data-row` / `data-col` / `data-column-key` off the nearest cell. Column resize captures the pointer on the root and computes from the header's rect; reorder uses HTML5 drag with an `application/x-av-grid-column` payload. |
| 2026-08-08 | 8 | **Drag state lives on `model.flags`, not on the DOM.** A repaint reassigns `className`, so a class set directly on an element by an event handler would vanish on the next frame. `dragColumnKey` / `dragOverColumnKey` are model state that `HeaderCell` reads, and setting one marks the header row — one row, never the viewport. |
| 2026-08-08 | 9 | **One static stylesheet, injected once per document, generated into `dist/av-grid.css` at build time.** Emotion produced a class per style object at runtime; here nothing in `src/` reads a colour and the only thing that varies is a CSS custom property. Injecting by default (`injectStyles: false` opts out) is deliberate: the minimum call must produce something that *looks* like a grid, and a library whose first impression is unstyled text costs more than one `<style>` tag. `src/styles/av-grid.css.ts` is the single source of truth; `scripts/build-css.mjs` emits the file so the two cannot drift. |
| 2026-08-08 | 9 | **Theming verified as costing zero JavaScript.** Setting `--p-text` on the document root re-tinted every border and background with **0 paints** — measured on the board, not assumed. Tokens read `--avg-*` → `--p-*` → a neutral light default, so the grid looks deliberate on a bare page and matches the app on a board. Derived tones (header background, hover, selection) use `color-mix`, which keeps the whole palette a function of four tokens. |
| 2026-08-08 | 9 | **`DataCell` allocates nothing on the default path.** `CellContext` is built only when a `render` or `onCellClass` hook actually needs one; the class name is assembled into a single string and assigned once rather than through `classList` calls; text goes through the existing text node (`setText`) rather than `textContent`; and the four content shapes an element can hold (text, boolean icon, host HTML, host element) are tracked per element so switching between them clears up after the last one. |
| 2026-08-08 | 9 | **⛔ Benchmark re-run through the whole grid: no regression.** First paint 8.0 ms, 60 fps at both ends, flat-cost ratio **0.93×**, a full repaint of 216 real cells in 0.5 ms with **zero** DOM mutations, and a 100k-row sort in 21 ms. Full numbers and the two misleading measurements to avoid in [`benchmark-results.md`](benchmark-results.md). |
| 2026-08-08 | 9 | **The grid board is `test-boards/AVGridBoard/`, not `AVGridTest/`.** Board trust is granted per *path*, and a board Persephone did not create renders a trust prompt instead of the page — `browser_evaluate` cannot reach it, so a hand-created board folder is undriveable. `create_board` scaffolds a trusted board but refuses a name that already exists, so the working order is **create the folder with `create_board`, then write the files into it**. The name is the one that was free. Recorded in the board's `CLAUDE.md` so it is not rediscovered. |
| 2026-08-08 | 10 | **The reference's drag path is quadratic, and the port does not carry it over.** `updateFocus` marked `cellsToUpdate(oldSelection)` plus `cellsToUpdate(newSelection)` on every move — both *entire rectangles*, unclipped. Dragging from row 0 to row 99,000 therefore builds a 100,000-entry array on each of 99,000 moves. It is invisible in Persephone because its grids are small; it is precisely the failure this project exists to avoid. `FocusModel.markChanged` instead walks the *rendered window*, comparing each cell's old and new state bitmask and marking only those that differ. Cost per move is a function of the viewport, never of the selection: **2 cells marked per move at row 100 and at row 99,000 alike**, model cost 0.0141 ms vs 0.0147 ms. |
| 2026-08-08 | 10 | **Cell state is a bitmask, not a `clsx` call.** The reference built two arrays and sorted them per cell to decide six class names. The ordered range is derived once per focus change and each cell reduces to six integer comparisons — which is also what makes the symmetric-difference dirty set possible: comparing *masks* rather than "is it selected" catches the cell that stays selected but loses its border, which a membership test misses. `focusClass()` returns the identical empty string for every cell of an unfocused grid, so the default path allocates nothing. |
| 2026-08-08 | 10 | **Range selection uses pointer events, not HTML5 drag-and-drop.** The reference set `draggable` on every cell, installed a 1×1 transparent GIF as the drag image, and handled `dragenter` per cell. In a pooled grid `draggable` is one more attribute to keep in sync through recycling, and the cell drag shares an event stream with the header's column-reorder drag that each then has to filter itself out of. `pointerdown` on the root plus `pointerup` on the window is smaller, has no drag-image hack, and keeps the two drags entirely separate. |
| 2026-08-08 | 10 | **`startDrag` split out of the selection type.** The reference's `SelType` had a `startDrag` member that meant "anchor here" *and* "begin dragging". Those are two questions, so dragging is now a separate flag and `SelectionType` is only about the anchor. The payoff is behavioral: shift-drag extends a selection instead of resetting its anchor, which the reference could not do because `dragstart` always re-anchored. |
| 2026-08-08 | 10 | **The grid owns the focus, as it owns everything else.** `props.focus` / `props.setFocus` becomes `grid.getFocus()` / `setFocus()` / `focusCell()` / `selectRange()` / `getSelection()` / `clearFocus()` / `focus()`, plus an `onFocusChange` callback. Named for *cell* focus deliberately — `onSelectionChange` is reserved for task 11's row selection, which is a different thing a grid can have selected. |
| 2026-08-08 | 10 | **`tabindex="0"` goes on the root, and the root is the only thing that ever holds focus.** A cell is a pooled element that may belong to a different coordinate next frame, so focus must never land on one; `onCellPointerDown` calls `root.focus({ preventScroll: true })` explicitly rather than letting the browser pick. Keydown is delegated from the root like every other listener, and keys originating inside an `input` / `textarea` / `select` / `contenteditable` are left alone so task 12's in-cell editor keeps its caret keys. |
| 2026-08-08 | 10 | **Two small behavioral improvements over the reference, both deliberate.** A navigation key on a grid with nothing focused now lands on cell (0, 0) — the reference did nothing at all, which makes a freshly tabbed-into grid feel broken. And `updateFocus` bails when a drag has not left its cell, so `onFocusChange` fires once per *cell* rather than once per pointer move. |
| 2026-08-08 | 10 | **`AVGridActions.ts` deliberately not created yet.** Task 10 lists it, but of its eleven methods, three already exist as direct event wiring (`sortColumn`, `columnResize`, `columnsReorder`), one is trivial (`focusGrid`, now on `AVGridModel`), and the remaining seven are `editRow` / `addRows` / `addNewRow` / `addNewColumns` / `deleteRows` / `deleteColumns` — tasks 12 and 14. Creating the class now would mean a mostly-empty file duplicating wiring that works. It arrives with task 12, where it has something to do. Consequently the reference's add-row and add-column branches in `onContentKeyDown` (ArrowDown past the last row, Tab wrapping past the last cell, ctrl+ArrowRight past the last column) are **not** ported yet and belong to task 14. |
| 2026-08-08 | 10 | **The harness had to be measured twice before it measured anything.** The first `measureRangeDrag` awaited a frame per move, so every move cost 16.7 ms of waiting, the ~14 µs of real work disappeared under the display cadence, and the ratio came back 1.0006× — a number that would have been true of a quadratic implementation too. It now times a tight loop with no frame wait for model cost and a paced loop for paint cost. The headline number to quote is *cells marked per move*, which is exact; a single-run timing ratio at 14 µs swings 0.77×–1.09× on timer quantization alone. |
| 2026-08-08 | 10 | **Auto-scroll during a range drag, added after the pointer-event rewrite lost it.** HTML5 drag-and-drop scrolls the container for free when the pointer nears an edge, which is how the reference lets you select down past the visible rows; pointer events do not, so dragging to the bottom of the viewport simply stopped selecting. `GridInteractions` now runs its own rAF loop while a drag is live: an edge zone reaching 16px *inside* the data area on all four sides, a speed proportional to how far past it the pointer is (2–48 px/frame), and scrolling that continues while the pointer sits still outside the window — none of which the browser's version offers. It stops when both axes reach the end of the content. Verified in the browser: held below the grid it scrolled 0 → 2,160px in ~45 frames and grew the selection by 90 rows; held right it scrolled 1,920px and reached the last column. |
| 2026-08-08 | 10 | **The drag target is resolved by hit test first, geometry second — and the second half is not an optimization.** Clamping an off-grid point back inside the viewport and hit-testing *that* looks equivalent and is not: during an auto-scroll the DOM is a frame behind the scroll offset, so it keeps returning the cell that was at the edge before this frame's scroll and the selection stalls one row short forever. The fallback therefore reads the edge row and column straight out of `renderInfo.visible`, and the tick calls `renderModel.onScroll()` synchronously after moving the container so the geometry is current when it does. The hit test is kept as the *first* path because it is the only thing that resolves the sticky bands, where a pinned cell overlaps a scrolling one. |
| 2026-08-08 | 10 | **Drag listeners live on `window`, not on the root, and pointer capture is not used.** A drag has to keep being heard after it leaves the grid. Capture would do that too, but it retargets the events to the root, and this class resolves everything by hit-testing the point anyway — so `window` is the simpler half of the same trade. `pointerdown` on a cell now calls `preventDefault()`, without which the browser starts a text selection that follows the drag across the page; `onCellClick` was checked in the browser afterwards and still fires. |
| 2026-08-08 | 11 | **The checkbox column is the grid's, not the host's.** The reference exported a `SelectColumn` object that a caller spliced into its own `columns` array — which means the caller must remember to put it back after every `setColumns`, and can delete or duplicate it. Here `selectColumn: true` is an option and the column is prepended inside `updateColumnsData`, so it never reaches `options.columns`: `getColumns()` returns only the host's columns, and `setColumns()` cannot disturb the checkbox. It is still an *ordinary* `Column` whose `render` / `headerRender` hooks return markup — a host could write the same column by hand, which is the honest test of whether those hooks are good enough. `createSelectColumn` is exported for exactly that. |
| 2026-08-08 | 11 | **The selection is a set of row keys, and the public surface is arrays.** The reference passed `ReadonlySet<string>` both ways. Internally that is still right — membership is the hot question — but `getSelected()` returns `string[]` and `setSelected()` takes any iterable, because an array is what an agent writes, what JSON carries, and what `console.log` shows usefully. `getState()` reports `selectedCount` rather than the keys for the same reason: 100,000 strings in a state snapshot answer nothing. |
| 2026-08-08 | 11 | **Clicking a status column moves nothing.** `onCellPointerDown` returns early for any `isStatusColumn` column, so the checkbox neither moves the cell focus nor starts a range drag, and the header checkbox does not sort. The reference got this free by not binding handlers to those cells; with root delegation it has to be said out loud. The root still takes keyboard focus, so a click on a checkbox leaves the grid arrow-navigable. |
| 2026-08-08 | 11 | **`selectAll` passes `allSelected` in rather than letting it be recomputed.** `updateAllSelected` is the one genuinely O(rows) operation in the model, and `selectAll` is the one path that always reaches its scan — while also being the one caller that already knows the answer, having just built the set from those very rows. 6.4 ms of 24 on 100k rows. For the same reason the key array handed to `onSelectionChange` is built only when a host registered the callback. |
| 2026-08-08 | 11 | **`onSelectionChange` reports keys only, not rows.** Resolving keys to row objects is O(rows) and most hosts want it once, at the end, not on every click — `grid.getSelectedRows()` is one call away. Row selection selects the *displayed* rows, so `selectAll()` on a filtered grid selects what the user can see, which is what a "select all" checkbox above a filtered list means everywhere else. |
| 2026-08-08 | 12 | **`editable: true` edits the row; the reference edited nothing without a callback.** `props.editRow(columnKey, rowKey, value)` was mandatory and did the write itself, because Persephone's rows live in React state above the grid. From plain JavaScript that reads as a broken grid: you turn editing on, type, press Enter, and the cell reverts. So the grid writes `row[column.key] = value` and *then* calls `onEdit` — which receives the row and column themselves rather than three positional strings, and can return `false` to reject the write and own it instead. The plan's `onEdit(columnKey, rowKey, value)` signature is the one thing here that deliberately diverges from what task 12 specified. |
| 2026-08-08 | 12 | **The open editor is one element owned by `EditingModel`, and `DataCell` only parents it.** Cells are pooled, so an editor built into a cell would be recycled out from under the caret. Because the render path prefers `p.previous`, a repaint of the editing cell re-parents nothing — measured: a full repaint while editing does **0 DOM mutations** and hands back the same input element. Listeners *are* bound directly to that input, which does not violate the root-delegation invariant: that invariant is about elements whose identity changes between frames, and this one is created per edit and discarded with it. A cell that held the editor and is later repainted as a different coordinate (the editing row scrolled far out of view) commits, rather than leaving an editor nobody can reach. |
| 2026-08-08 | 12 | **A native `<select>` replaces UIKit's `Select`, and a bare `<input>` replaces UIKit's `Input`.** `CellSelect.tsx` bridged `Column.options` into `IListBoxItem`s for a filterable popover list box; `CellInput.tsx` spent most of its body overriding the wrapped component's chrome back out again so it would sit flush in a cell. With no component library underneath there is nothing to override and nothing to bridge — and a native select is keyboard-navigable, type-ahead searchable and screen-reader correct for free. The input is `type="text"` even for a number column: `type="number"` rejects the first keystroke of a type-to-edit when it is not a digit, refuses `setSelectionRange`, and adds a spinner. |
| 2026-08-08 | 12 | **A column with no declared `dataType` whose cell held a number keeps holding one.** An editor always hands back a string, so without this one edit turns a numeric column into strings — after which it sorts lexicographically, aligns left and formats differently, all from a change the user cannot see. The reference could live with that because Persephone's columns declare their types; a grid whose columns are *inferred* cannot. Only when the string really parses as a number: "n/a" typed into a number cell stays "n/a". |
| 2026-08-08 | 12 | **`beep()` becomes `onInvalidEdit`, default no-op** — a library should not make noise uninvited — and it fires where `defaultValidate` rejects a value outright, which is an options column given something not in its options. The `useModel()` effect that closed the editor when `props.focus` moved becomes `EditingModel.onFocusMoved()`, called from the one place in `FocusModel` where focus can actually change instead of on every React render. |
| 2026-08-08 | 12 | **`AVGridActions.ts` still not created, and now probably never will be.** Deferred from task 10 on the grounds that it would be a mostly-empty file; task 12 was supposed to give it `editRow`, but with `onEdit` on the options object and the write happening in `EditingModel`, that method has no body left to hold. Its remaining members — `addRows` / `addNewRow` / `addNewColumns` / `deleteRows` / `deleteColumns` — are all task 14, so the decision moves there: build it then if those five want a home, and drop the file from the plan if they do not. |
| 2026-08-08 | 12 | **Ranged edits mark `{ all: true }` once instead of a cell each.** Delete over a selection, and a boolean toggle across one, both write per cell — but `all` repaints only what is on screen, so for a selection of any size it is the cheaper of the two and cannot build a dirty set the size of the selection. A single-cell edit still marks exactly its own cell. |
| 2026-08-08 | 12 | **⛔ Benchmark re-run with editing on: no regression.** First paint 5.7 ms, flat-cost ratio **0.94×**, 60/60 fps, full repaint 0 mutations, range drag still 2 cells per move at both ends. Task 12's own number is not a throughput figure but a survival one: a full repaint while a cell is being edited does **zero** DOM mutations and hands back the same `<input>`, which is the first thing in the library that would notice if the render path stopped preferring `p.previous`. |
| 2026-08-08 | 12 | **A frame-paced harness cannot be driven against a hidden window.** The first attempt at that re-run happened with the Persephone window minimised: `document.hidden` was true, `requestAnimationFrame` was throttled to a standstill, `measureEditing` hung mid-way, and an fps figure taken then would have measured the throttle rather than the grid. Screenshots pump about eight frames each, enough to nurse one short measurement along and nothing more. If the harness appears to hang, check `document.hidden` before suspecting the grid. |
| 2026-08-08 | 13 | **The clipboard is reached through the native `copy` / `cut` / `paste` events, not through `navigator.clipboard`.** The reference handled ctrl+C and ctrl+V in a keydown handler and called `writeText()` / `readText()`. Both halves of that API are permission-gated and secure-context-only: `readText()` raises a paste prompt in Chrome on every use and does not exist for pages in Firefox, so the reference's ctrl+V is a prompt or a silent failure depending on the browser. The native events have no such problem — the keystroke *is* the consent, the data is available synchronously, and it works on `file://`. So the events are the primary path and the async API is the fallback for `grid.copySelection()` / `grid.paste()`, which have no event to ride on. `copySelection` falls back again to a hidden textarea and `execCommand("copy")` when `navigator.clipboard` is missing or refuses. |
| 2026-08-08 | 13 | **ctrl+X added, which the reference did not have.** It is `copy` composed with the range delete task 12 already built, it arrives as a native `cut` event alongside the other two, and a grid that copies and pastes but does not cut reads as unfinished. It clears nothing unless the grid is `editable`. |
| 2026-08-08 | 13 | **Three reference bugs in the copy path, fixed rather than carried over.** (1) `rowsToCsvText` keyed its records by *column name*, so two columns sharing a name collapsed into one — the second column emitted the first's values. Records are now keyed by column index and the labels go to a new `headerNames` option on `recordsToCsv`. (2) `recordsToClipboardFormatted` read `row[column.key]` raw for both the HTML and the plain-text flavour, so a `formatValue` column copied its unformatted value and a computed column — one with no such row property — copied nothing; every shape now goes through `columnDisplayValue`. (3) Status columns are excluded from a copy: the reference had no checkbox column when this was written, and ctrl+A selects it along with everything else, so copying after a select-all would paste a column of empty strings into the user's spreadsheet. |
| 2026-08-08 | 13 | **A paste marks the viewport once.** Every cell goes through `editCellAt(..., silent)` and the whole paste ends with a single `{ all: true }`, the same trade task 12 made for Delete and the boolean toggle: `all` repaints only what is on screen, so a 1,000-cell paste marks 1 repaint and mutates 0 DOM nodes. Measured. |
| 2026-08-08 | 13 | **A single-cell paste expands to fit, clamped to the grid.** The reference grew the grid through `onAddRows` / `onAddColumns` when the clipboard overflowed it; those callbacks are task 14, so until then the overflow is dropped rather than wrapped, and the pasted rectangle becomes the selection so the user can see what landed. A *larger* selection tiles the clipboard across itself, which is the reference's behaviour and Excel's. |
| 2026-08-08 | 13 | **`pasteText(text)` is public, and is the entry point to recommend.** Reading the clipboard is the one operation the browser can refuse; handing the grid a string cannot fail. It is also what makes paste testable at all under happy-dom, which has no clipboard, no `ClipboardEvent` and no `DataTransfer`. `getSelectionText(mode)` is its mirror on the copy side. |
| 2026-08-08 | 13 | **ctrl+shift+C is the one clipboard shortcut still handled in keydown**, because it produces no native copy event — so copy-with-headers has to go through the async API and inherits its refusals. Chrome also binds ctrl+shift+C to its element inspector, which wins whenever devtools is open. Noted in the code rather than worked around. |
| 2026-08-08 | 13 | **A synthetic keystroke does not produce a native clipboard event.** `browser_press_key("Control+c")` delivers the keydown to the grid root and nothing else — no `copy` event, so the MCP cannot drive ctrl+C or ctrl+V end to end. Same family as `browser_click` not dispatching `pointerdown` (task 12). The handlers were verified with genuine `ClipboardEvent`s carrying a real `DataTransfer`, and the system-clipboard half through `copySelection()`: the text that reached the *Windows* clipboard was `Ada\t"has\ttab"\r\nAlan\t"two\r\nlines"\r\n`, and pasting those exact bytes back restored both values. Note the `\n` came back as `\r\n` — Windows normalises the clipboard payload, and the parser preserves what is inside the quotes rather than inventing a normalisation that would corrupt a value which genuinely contained `\r\n`. |
| 2026-08-08 | 13 | **Copy reads what a cell *shows*, including a `render`-only column.** Reported from the board: a computed column — `readonly`, with `render: (c) => `${c.row.firstName} ${c.row.lastName}`` over a `key` no row has — copied as an empty column while displaying a full one, because `columnDisplayValue` reads `row[column.key]` and there is nothing there. The reference has the same hole. `CopyPasteModel.cellText` now falls back to `render` when no `formatValue` / `displayFormat` is set, matching the order `DataCell` paints in, and reduces markup or an element to its text — neither belongs in a spreadsheet cell. `columnDisplayValue` itself is unchanged: it is also the filter path's value source, and calling `render` per row there would put a host callback on the 100k-row filter loop. **That leaves the same gap in search** — a free-text filter does not match a computed column — which belongs to task 15. |
| 2026-08-08 | 13 | **Pasting onto a readonly column drops that field and keeps the rest aligned** — confirmed against the same report, not changed. The clipboard maps onto the target rectangle positionally, `editCellAt` refuses the readonly column, and the fields either side still land where they should. A derived column appearing to change after such a paste is the derivation re-running over the columns that *did* change, which is the point of a derived column. |
| 2026-08-08 | 14 | **`AVGridActions.ts` is not ported, and the decision is now final.** Deferred at task 10 as a mostly-empty file, deferred again at task 12 when `editRow` turned out to have no body left. Its remaining five members — `addRows` / `addNewRow` / `addNewColumns` / `deleteRows` / `deleteColumns` — are this task, and they got a home with a name that says what it holds: `src/model/StructureModel.ts`, changes to the grid's *shape* rather than its values. "Actions" described how the reference's methods were reached from React, not what they do. |
| 2026-08-08 | 14 | **The add/delete callbacks fire *before* the change and `false` cancels it — the same inversion already made for `onEdit`.** In the reference, `onAddRows: (count, insertIndex) => R[]` was the host *producing* rows for a grid that owned none. Here the grid owns its rows, so it makes them and the callback observes: `onAddRows: (e) => e.rows.forEach(fill)`, or `onDeleteRows: (e) => confirm(...)` to refuse. Firing before the change is what makes a delete confirmation possible at all, and it is why the names stayed imperative (`onAddRows`, not `onRowsAdded`). |
| 2026-08-08 | 14 | **`canAddRows` / `canDeleteRows` / `canAddColumns` / `canDeleteColumns` gate the *user's* affordances only.** `grid.addRows()` and friends always work. Requiring an option before the host's own code may call a method is a trap rather than a safeguard — the host asking for the change *is* the permission. The flags exist because the affordances are visible: a `+ add row` button on a grid that cannot accept one is worse than no button. |
| 2026-08-08 | 14 | **Adding while sorted or filtered freezes the row order.** A blank row inserted into a sorted grid sorts to wherever an empty field belongs, and a filtered grid drops it outright — so the user clicks *add row* and nothing appears. `RowsModel.freezeRows()` already existed for editing and does the job unchanged; the only addition is that `onRowsAdded` now splices at the requested display index instead of appending, so an insert into the middle of a sorted grid lands where it was asked to. |
| 2026-08-08 | 14 | **A `noScrollOnFocus` flag the port had skipped turned out to be load-bearing.** `FocusModel` treats a focused row whose index moved as "the rows moved" and scrolls it back to *centre*. Inserting one row above the focus therefore yanked the viewport by 261 px and repainted all 260 visible cells, for a change the user did not make. The reference sets `flags.noScrollOnFocus` around exactly that revalidation; nothing inserted rows before this task, so it had never been reachable. Found by wrapping the render model's scroll methods in a logger after three wrong hypotheses — see `benchmark-results.md`. |
| 2026-08-08 | 14 | **The "unknown column" check learned about exemptions.** Validation rejects a column whose key no row has, which catches a typo at `create()` — and would reject the normal case the moment columns can be *added*, since a new column is empty until something is typed into it. `validateColumns` now takes an `exemptKeys` set: `addColumns` exempts what it is adding, `setColumns` exempts the columns the grid already has, and `create()` stays strict. Without the second of those, `grid.setColumns(grid.getColumns())` would throw after an add. |
| 2026-08-08 | 14 | **A blank row is `{}` plus its key, not a row of empty strings.** The same shape a cleared cell leaves behind, so nothing downstream has to know which of the two produced it. The key matters: with an inferred `getRowKey` reading `id`, every added row would otherwise share the key `"undefined"` and selection, focus and editing would all address the same one — hence `inferRowKeyProperty`, split out of `inferGetRowKey` so the default `newRow` can fill exactly that property. A host with real requirements passes `newRow`. |
| 2026-08-08 | 14 | **The temp-row guard is ported: one blank row at the end at a time.** ArrowDown or Tab off the end of the grid adds a row and marks it `data.newRowKey`; no second one is offered until it has been typed into. Without it, holding ArrowDown at the bottom manufactures a hundred empty rows. `EditingModel` clears the mark on the first committed value. |
| 2026-08-08 | 14 | **The two add affordances are overlays, not cells, and still carry no listener.** `RenderGrid.addOverlay` appends them outside the pooled reconciliation — `syncRegion` only removes elements it appended itself, so nothing recycles them — and the click is resolved from the root by `data-avg-action`, like every other click. The third invariant holds even for an element that is never pooled: one place that knows what a click can mean, one teardown. |
| 2026-08-08 | 14 | **`focusNewRows` lands on the first *editable* column, not column 0.** Caught on the board: with `selectColumn: true`, column 0 is the checkbox, which a click cannot focus either — so adding a row put the focus somewhere the next keystroke would go nowhere, which reads as the add having failed. Falls back to the first non-status column when every column is readonly. |
| 2026-08-08 | 14a | **The UIKit components are rebuilt, not ported — `Popover`, `ListBox`/`MultiListBox` and `Select` all stay in Persephone.** Raised before task 15: a filter popover over a high-cardinality column on 100k rows needs a virtualized list, which is true, and `ListBox` is already built on `RenderGrid`, which is also true. But `ListBox` + `ListBoxModel` + `ListItem` + `SectionItem` + `MultiListBox` is ~1,100 lines of React carrying sections, groups, a keyboard model and a general-purpose item API, and what the filter body needs is checkbox rows, a search box, select-all and `scrollToRow` — ~200 lines over the engine the port already owns. `SelectModel` alone is 611 lines, sized by search, async options and form integration this library does not have. Porting 1,700 lines to obtain 320 is a net loss, and it is what *"port behavior, improve structure"* is there to prevent. `PopoverModel` is read for its behaviors — anchor element *plus* point offset, flip, outside-click, resize reported back, promise on close — and then written fresh without the portal. |
| 2026-08-08 | 14a | **Virtualization fixes the rendering, not the distinct-values pass.** Worth stating so the effort lands in the right place: computing the distinct set over 100k rows is one O(rows) walk with a Map and is not a problem. What virtualization prevents is 50,000 DOM rows inside a popover. |
| 2026-08-08 | 14a | **`onGetOptions` keeps its `search` parameter even though the default implementation ignores it.** The reference already assumed a host might narrow the options server-side rather than return every one; the grid's own implementation computes distinct values in memory, but a host with a million rows needs that door open, and it cannot be added later without breaking the callback's shape. |
| 2026-08-08 | 14a | **The reference's Popover is `@floating-ui/react` with a shell around it, so there was nothing to port — only a contract to keep.** Placement, flipping, viewport clamping and live repositioning all come from the dependency; `Popover.tsx` adds a portal, and `PopoverModel.ts` adds the resize drag and the dismissal listeners. With no runtime dependencies allowed, the ~90 lines of placement arithmetic are written here: side + align from the placement string, flip only when the opposite side is genuinely roomier, cap the height to the space available and let the content scroll, then clamp into the viewport. The behaviours kept from the reference are the ones a caller would notice: anchor by element *or* by point, `ignoreOutside`, `matchAnchorWidth`, resize reported back, and the grip moving to the top corner when the popover opened upward. |
| 2026-08-08 | 14a | **`show()` returns a promise that resolves when the popover closes.** The reference reaches that shape one level up, in `showFilterPopover`; putting it on the primitive costs nothing and makes every caller a single statement — `const applied = await popover.show()`, `undefined` when dismissed. It is also the whole teardown story: every exit path routes through `close()`, which is the only place the document listeners come off. |
| 2026-08-08 | 14a | **The document listeners are bound in the *capture* phase, and that is load-bearing.** A popover opened from a `pointerdown` handler would otherwise see the tail of that same event bubble up to the document and dismiss itself before it was visible. Document capture runs before the target, so a listener added mid-dispatch has already missed that phase — the in-flight event cannot reach it. The anchor is exempt from outside-dismissal besides: whoever opened the popover owns what a second click on it means, and closing here would race their toggle. |
| 2026-08-08 | 14a | **A popover carries its own copy of the `--avg-*` token block.** The tokens are defined on `[data-type="render-grid"].avg-grid` and the popover mounts on `document.body`, so it inherits none of them. Both blocks read the same `--p-*` host variables, so a theme change still moves the two together and still costs zero paints. |
| 2026-08-08 | 14a | **Do not anchor a popover to a data cell.** Cells are pooled: one scrolls out and comes back as a different row, so the popover would silently re-anchor to whatever the element became. Found on the board — scrolling the grid under a cell-anchored popover walked it to the top of the viewport. Header cells, chips and points are all stable. Documented on the `anchor` option rather than guarded against, since the check would cost a `closest()` on every reposition. |
| 2026-08-08 | 14a | **No benchmark row for this task.** The popover touches nothing in the render path — no cell renderer, no dirty set, no scroll handler — so the gate has nothing to say about it. Verified in the browser instead: flip, clamp, height cap with a scrolling body, follow-on-scroll, Escape, outside click, focus handed back to the grid, and a resize drag reporting +120×+90 with no drift after release. |
| 2026-08-08 | 14b | **State before engine.** `RenderGrid` paints synchronously in its own constructor so a grid is on screen when it returns — which means a `VirtualList` that builds the engine before its items exist spends that paint on an empty list and shows nothing until the next frame. Caught by the test suite rendering zero rows, and it is the kind of thing only a synchronous read finds: on a real board it would have looked like a harmless one-frame flicker. |
| 2026-08-08 | 14b | **Search and select-all compose, which is `MultiListBox`'s rule and worth keeping exactly.** The tri-state reflects the rows the search is currently showing, and toggling it affects only those rows. Search "north", tick all, clear the search: the box goes back to indeterminate rather than claiming everything is selected, and a selection made under a different search is left alone. |
| 2026-08-08 | 14b | **`onSearch` hands filtering to the host.** By default the list matches the search text itself; set `onSearch` and it reports what was typed and shows exactly what it is given. This is the seam `onGetOptions(columns, filters, columnKey, search?)` needs — the reference already assumed a host might narrow a million rows' worth of options at the source rather than return every one, and the callback's shape cannot gain that later without breaking. |
| 2026-08-08 | 14b | **The selection is a Set *and* an array.** The Set is the membership test a repaint runs per visible row; the array is the order options were picked in, which is what `onChange` reports and what the filter chip will show. Neither alone does both jobs. A selected value whose item is no longer in the option set is kept rather than dropped — a filter can hold a value the current options do not offer, and dropping it would silently widen the filter. |
| 2026-08-08 | 14b | **Moving the active row marks two rows, not the viewport.** Holding ArrowDown through 40,000 options repaints the row losing the highlight and the row gaining it. Select-all goes the other way and marks `{ all: true }` once, the same trade as Delete, the boolean toggle and a paste: `all` repaints only what is on screen, so 100,000 options cost one paint. |
| 2026-08-08 | 14b | **`data-active` is on the element, and that is fine, because it is written by the renderer.** The third invariant forbids a *handler* setting a class a repaint would wipe. Here the active index lives on the list and every paint rewrites the attribute from it — the same shape as the grid's selection outline. |
| 2026-08-09 | 15 | **A filter is `{ columnKey, value }` and nothing else.** The reference's `TFilter` requires `columnName` and `type` on every filter because its host always built one from a column it already had; here a filter is something an agent writes by hand, and three required fields where one would do is the friction *Who this API is for* exists to remove. Both are optional on the way in and always present on the way out — `columnName` from the column's `name`, `type` from its `filterType` — and bare values expand to `{ value, label }`, so `value: ["open"]` works. Everything downstream reads the normalized form, so `getFilters()` gives back more than was passed in. |
| 2026-08-09 | 15 | **`Filter.value` is typed `any` on the base interface, not only on `AnyFilter`.** Found by a test: `grid.applyFilter({ columnKey: "status", value: ["open"] })` — the call every caller writes — did not typecheck, because `value` lived on `AnyFilter` and the public methods took `Filter`. A public API whose most obvious call is a type error is a broken API. `OptionsFilter` still narrows it. |
| 2026-08-09 | 15 | **Persistence is opt-in by passing `persistFilters`, and the storage is injected.** `goal.md` asked for an injectable backend; the shape chosen is one object — `{ name, storage? }` — rather than two co-dependent options, because two options that only work together is a thing to explain. Passing the object *is* the consent to write, and `storage` defaults to `localStorage` only once that consent exists. Stored filters win over the `filters` option: the option is the grid's default, the stored list is what this user last chose. Nothing stored and stored-but-empty are different states, so a user who cleared their filters gets them cleared on reload rather than the default back. |
| 2026-08-09 | 15 | **Host input is validated loudly; stored input is validated one filter at a time and dropped with a warning.** A typo in `setFilters` is a bug the author can fix, so it throws. A filter written months ago against a column that has since been renamed is not a bug in today's code, and throwing out of `create()` over it would take the whole grid down. |
| 2026-08-09 | 15 | **Reference bug fixed in the date revival.** `restoreFiltersConfig` mapped each option *object* to a bare `Date`, so a restored filter lost its labels — and `filtersMatch` then had to accept two shapes (`o instanceof Date ? … : o.value === …`) to cope with its own output. Here the `Date` goes back inside the option it came from, the shape is identical before and after a reload, and the two-shape branch in the matcher is gone. A restored chip therefore still has something to show. Dates compare by instant throughout: a filter that has been through storage is never `===` the value in the row. |
| 2026-08-09 | 15 | **`setFilters` compares by value, not by identity, and it has to.** The guard exists so a host echoing `onFiltersChange` straight back cannot loop — and that round-trip never produces the same objects, because `getFilters()` hands back a normalized copy and `setFilters()` normalizes again on the way in. An identity check would have passed its test and failed in the one case it was written for: re-filtering 100k rows on every echo. |
| 2026-08-09 | 15 | **The computed-column search gap, deferred from task 13, is closed through `formatValue` — not through `render`.** The search now matches `columnDisplayValue`, so a column with a `formatValue` is searchable and filterable by what it shows. `render` is still never called from the filter path: it may build an element, and `CopyPasteModel.cellText`'s fallback to it is affordable across a selection in a way it is not across 100,000 rows per keystroke. Measured rather than assumed — **+8.7%** on a 100k-row search for one computed column in ten. The rule for hosts is one line: *give a computed column a `formatValue` and it joins search, filtering and copy.* |
| 2026-08-09 | 15 | **`FiltersModel` writes `options.filters`; `RowsModel` reads it.** One store, not two, so `getState()`, `setOptions()` and `freezeRows()` all keep working unchanged and there is no pair of copies to drift. The split the plan asked for is preserved where it matters: only `FiltersModel` ever writes, and it calls `updateRows()` when it does, so a filter change costs exactly one pipeline pass however it arrived. Constructed *before* `RowsModel` so a restore from storage is in place before the first `updateRows()` — otherwise the first paint shows rows the user had filtered away. |
| 2026-08-09 | 16 | **Every column is filterable by default; `filterType: null` opts one out.** The reference made `filterType` opt-in per column, so a grid whose author never thought about filtering had no funnels at all — invisible, and the author here is usually an agent. The default is `"options"`, `disableFiltering` still turns the lot off, and status columns never get one because there is nothing to filter by. |
| 2026-08-09 | 16 | **The library ships the default option provider the reference made every host write.** `GridEditor.onGetOptions` — distinct values, cascaded against the *other* filters — was host code in Persephone. Here it is `defaultFilterOptions`, so `AVGrid.create(el, { rows })` has working filter popovers with no callback at all; `onGetOptions` remains for values that do not live in the rows. Two divergences from the reference version: the grid's `searchString` narrows the options too (it hides rows exactly as a filter does, and offering a value that selects nothing is a trap), and `search` matches option *labels* rather than being fed back in as a row search, which is what the popover's search box means by it. |
| 2026-08-09 | 16 | **The checklist is keyed by an option's position, not its value.** `VirtualList` addresses items by `string | number`; a filter option's value is whatever was in the column — a `Date`, a boolean, `null`. So the list is handed indices and `OptionsFilterContent` maps back. It also separates the two identity questions cleanly: the list compares positions, and carrying a selection across a re-fetch compares `optionKey`, where a `Date` is its instant. |
| 2026-08-09 | 16 | **Search narrows locally *and* re-asks the provider.** One or the other is not enough: a host that ignores the `search` argument — as the reference's own host did — would get a search box that does nothing, and a host whose values were never all in the browser needs to be asked again. So both happen, and a response overtaken by a newer one is discarded by request token. A host doing real I/O debounces inside its own `onGetOptions`. |
| 2026-08-09 | 16 | **The popover is sized from the outside, by option count.** A virtualized list cannot take its height from its rows — that is what virtualizing means — so the body reports a preferred height whenever the options change and `Popover.setSize()` applies it, clamped to the viewport as any size is. Once the user drags the grip, the count stops getting a say: the reference carried a `resized` flag for the same reason. Found in the browser, not in a test — happy-dom does no layout, so the collapsed one-row popover the first version produced was invisible to a green suite. |
| 2026-08-09 | 16 | **The funnel opens the popover; a second click on it closes.** `Popover` exempts its own anchor from outside-dismissal precisely so that decision belongs to whoever opened it, and a funnel that reopened the popover it had just dismissed would be unusable. The open column's funnel is lit from `model.flags.filterPopover` rather than from a class set by the handler — a repaint reassigns `className`, so a class set on the element would vanish on the next frame. |
| 2026-08-09 | 16 | **A cell's `position: absolute` belongs to the stylesheet, and `VirtualList` had never claimed it.** The engine writes `top`/`left`; `.avg-data-cell` says `position: absolute`, `.avg-list-item` did not — so the list's rows laid out in flow. It looked right at the top of a list, because each row's inline width fills the container and forces a wrap, and showed an empty band everywhere below. Shipped in 14b and invisible to every benchmark: `measureList` measures what a paint *costs*, never where a row *is*. The lesson is the one already in `CLAUDE.md` about happy-dom, one level further out — a green harness is not a look at the screen. |
| 2026-08-09 | 16 | **A paint must never write its own scroll offset back to reconcile a mismatch.** `RenderGrid.render()` restored `model.offset` whenever the container disagreed with it. A scroll event is delivered a frame after the position changes, so a paint routinely runs with the container ahead — and the write undid the user's scroll, then fired a scroll event of its own, so the two took turns: half of all scrolls reverted. The restore now happens only when a resize observation saw the grid at 0×0, which is the `display: none` case it was written for. |
| 2026-08-09 | 16 | **`overflow-anchor: none` on the scroller and its content, in the engine.** Chromium's scroll anchoring keeps a node near the top of the viewport still when content above it changes size — which in a virtualized list is every frame, since the rows above the viewport are the ones being recycled. It then "corrects" the scroll position back. Not a popover problem and not a list problem: any `RenderGrid` is exposed, so the fix is next to the other scroll styles rather than in a stylesheet a host could drop. |
| 2026-08-09 | 17 | **The bar is a plain element, and both mounting paths make the same one.** `filterBar: true` puts it above the grid; `AVGrid.createFilterBar(el, { grid })` puts it anywhere. The reference read its filters from a React context and could only exist where that provider was; here the bar subscribes to the model, so a grid can have any number of bars, each of them live and each of them able to edit. |
| 2026-08-09 | 17 | **`filterBar: true` wraps the grid in a flex column, so it is read at `create()`.** The bar has to take a strip off the top, which means the grid can no longer be the host's direct child. Turning the option *off* later works; turning it *on* later would mean re-parenting a live grid — scrolled, focused, possibly mid-edit — to save a call to `createFilterBar`, so it warns and points there instead. |
| 2026-08-09 | 17 | **The wrapper takes over the grid root's `flex: 1 1 auto`, and that is not cosmetic.** The engine writes that flex on the root; a wrapper without it is a flex item at the default `0 1 auto` and sizes itself to the grid's *intrinsic* width. A grid that filled a flex-row container rendered in a column down the left instead — caught by eye on the board, invisible to 572 green tests. The general rule: anything inserted between a host and the grid root inherits the root's sizing contract, not just its position. |
| 2026-08-09 | 17 | **The bar listens on the internal event bus, not on `onFiltersChange`.** That callback belongs to the host, and a bar that consumed it would silently eat a host's own. `AVGridEvents.onFiltersChanged` is internal, has no arity limit, and fires from the same place — so a filter applied from the API, a funnel, a chip or storage all redraw the bar identically. |
| 2026-08-09 | 17 | **Chips are reconciled by column key, not rebuilt.** A chip whose rendered text is unchanged is the *same element* across a redraw, recorded as `data-signature` on it. That is what keeps an open popover's anchor in the document when some *other* filter changes underneath it — a rebuilt chip would leave the popover anchored to a detached node. |
| 2026-08-09 | 17 | **A chip's value list is formatted from the option's value; the reference formatted its label.** `optionsFilterValues` is ported budget-for-budget — 25 characters spent on values and not on the commas, so the label runs slightly over and the chip ellipsizes the rest — but a `Date` is now formatted from the `Date` it still has rather than round-tripped through its label. The reference's version renders `(null)` re-parsed as a date, which is an empty chip. |
| 2026-08-09 | 17 | **Showing or hiding the bar costs one row of cells; every filter change after that costs none.** The bar changes the grid's height by 32 px, which is a resize — 20 DOM mutations on the first filter and 20 on the last removal, and **0** for everything in between. Worth stating because task 15's "0 mutations per filter" is still true and reads as though it were contradicted. |
| 2026-08-09 | 17 | **Not ported: the reference bar's "rows are frozen while editing" refresh button.** Freezing is a Persephone editing concern that happened to be rendered in the filter bar. `rowsFrozen` still exists on the model and task 12 still uses it; it just does not belong in a component whose subject is filters. |
| 2026-08-09 | 17a | **The dropdown is a `div` over `Popover` + `VirtualList`, and the argument for it was never size.** Column `options` are enumerations and realistically under a hundred, so a native `<select>` was never going to run out of room. What it could not do is be themed: its popup is drawn by the platform, so a grid in a dark board opened a white list in a system font — a task-9 debt the port carried quietly until both primitives existed to pay it off. Measured: a 10,000-option column puts 13 rows in the DOM and the popover's background is the board's. |
| 2026-08-09 | 17a | **The list addresses options by position, so a picked value keeps its type.** The same trick `OptionsFilterContent` uses, and here it fixes a real defect rather than working around a type constraint: the `<select>` version round-tripped every option through `String(value)`, so a numeric or `Date` option came back as text and `defaultValidate`'s `col.options.find(o => o === val)` identity check rejected it. Picking `20` from `[10, 20, 30]` now commits the number. |
| 2026-08-09 | 17a | **A type-to-edit seeds the search box, not the value.** Typing `p` over a status cell opens the list narrowed to the options containing it, and the cell keeps showing what it holds. The `<select>` version put the literal string `"p"` into the edit and left `defaultValidate` to reject it. It also settles what a dismissal means: the edit already carries `changed: true` from that keystroke, so closing without a pick must **cancel** rather than commit — which is right anyway, since picking is the only way to change a value here and a dismissal has nothing to write. |
| 2026-08-09 | 17a | **`CellEditor` gains an optional `destroy()`.** An editor used to be one element, and `detachEditor` removing it was the whole teardown. This one mounts a popover on `document.body` — outside the grid's DOM entirely — so removing the cell's element would leave it and its document listeners behind. The model clears `this.editor` *before* calling `destroy()`, because closing the popover fires the dismissal handler that calls back into `closeEdit`, and having no editor is what stops the re-entry. |
| 2026-08-09 | 17a | **The popover does not take the focus; the list does.** `autoFocus: false`, then `list.focus()`. Left on, the popover would restore focus on close to the editor element the commit is about to remove, fighting `closeEdit`'s own `focusGrid()`. The search box holding the focus is also what makes the keyboard path work unchanged: arrows, Home/End and Enter bubble from it to the list's root, where the keyboard map lives. |
| 2026-08-10 | 18 | **`getState()` stopped returning the live `Column[]`.** It handed back `model.options.columns` — the array the grid sorts and resizes, carrying `render`, `validate` and `options` functions. A snapshot whose whole purpose is `console.log` must survive `JSON.stringify`, and that one silently dropped every function and let a caller mutate the grid's columns by writing to what looked like a copy. Now a flat `ColumnStateSnapshot[]`: key, name, the *current* width, sorted/filtered/editable, and `hasRender` / `hasOptions` for the two things a debugger wants to know about. The real columns are one call away in `getColumns()`. |
| 2026-08-10 | 18 | **Counts, never payloads.** No row objects anywhere in the snapshot — `selectedCount` not the keys, `sourceRowCount` not the rows. A 100,000-row grid has to stay loggable, and a snapshot that carried rows would put host data into every log line and every bug report pasted into a chat. |
| 2026-08-10 | 18 | **`viewport` added, which the plan did not ask for.** "Which rows does it think are on screen, and how big does it think it is" is the first question when a grid renders blank or shows a band of nothing, and there was nowhere to read it. `width: 0` in there is the answer to the single most common integration failure. `firstColumn` is the first *scrolling* column, so a grid with a checkbox column reports 1 — the sticky band is always on screen and is not part of the window scrolling moves. |
| 2026-08-10 | 18 | **After `destroy()`, a mutator warns once and does nothing; reads still answer.** Not a throw: a stale callback firing during a framework's unmount should not take the unmount down with it. Not a silent no-op either — `addRows` would otherwise still mutate the host's array and call `onAddRows` against a dead grid, because only the *model* was disposed and the structure model runs before it. `getState()` keeps working and reports `destroyed: true`, which is exactly when a post-mortem wants it. |
| 2026-08-10 | 18 | **⛔ Gate passed, and the heap number is not how.** 100 create/destroy cycles of a fully-loaded grid (filter bar, checkbox column, add buttons, an applied filter, an open editor): **0 DOM nodes leaked and 100/100 grids collected**, at 6.5 ms a cycle. `usedJSHeapSize` was the wrong instrument — without `--expose-gc` it sawtooths, and consecutive runs of the same measurement came back at +45 KB and −15 KB per cycle. `WeakRef` under real allocation pressure answers the actual question, "is anything still reachable", and it earned its keep immediately: it read 99/100 until the harness stopped holding the last grid in its own loop binding. |
| 2026-08-10 | 18 | **Two teardown gaps found and closed.** The constructor's deferred re-measure (`requestAnimationFrame` when the host is not laid out yet) was never cancelled, and the two add-affordance buttons are `addOverlay` children of a render region rather than of the root, so `render.destroy()` did not take them with it. Neither was a leak past the next frame, but both are exactly what the 100-cycle test exists to catch. |
| 2026-08-10 | 18 | **`AVGrid.version`, `version` and `package.json` are pinned together by a test.** Three copies of a version string, two of them stale after the first release, is the most predictable bug in the file. |
| 2026-08-10 | polish | **A press on the already-focused cell opens the editor.** The port had only the double-click, and the reference has both: `EditingModel.onCellMouseDown` opens an edit when the pressed cell is the one that already had the focus. So a cold cell still takes two presses — the first focuses, the second edits — and a double-click keeps working, because its second press is exactly that. On mousedown rather than click, so the caret is in the input before the button comes back up. Modifiers and non-primary buttons opt out: shift extends the range, ctrl and meta belong to the host. Booleans opt out too — a checkbox shows both its states and a text box over it would add nothing. |
| 2026-08-10 | polish | **`wasFocused` is resolved by the sender, not the listener.** `FocusModel` subscribes to `cell.onMouseDown` before `EditingModel` and moves the focus onto the pressed cell, so by the time the edit decision runs the answer is always "yes, it was focused". The reference never met this: its focus was a React prop, still holding the pre-click value while the handler ran. So `GridInteractions` reads the focus *before* it sends, and the payload carries the answer. |
| 2026-08-10 | polish | **An editable boolean cell carries a checkbox, and only the box toggles.** The reference's `DefaultCellBoolean` swapped its tick for an `IconButton` when the cell was hovered and the column editable; the port had only the tick, which left the pointer with no way at all to change a boolean. A click on the cell *around* the box selects and changes nothing — which is what makes a column of booleans navigable without editing it by accident. |
| 2026-08-10 | polish | **⚠ The box is in the DOM whether or not the cell is hovered; only the glyph inside it is.** Emitting the box *only* for the hovered cell — which is what the reference does, and what this was written as first — means the hit target does not exist until the frame **after** the pointer arrives. A pointer that moves and clicks in the same frame therefore hits an empty cell, and marking a column of records costs two clicks each: one to conjure the box, one to use it. So an unchecked cell at rest is an empty 16×16 wrapper — invisible, and already under the pointer. The reference got away with it because React re-rendered on the hover event itself rather than on the next frame. |
| 2026-08-11 | polish | **A written value marks the whole row dirty, not the cell that was written.** A computed column reads the entire row, so editing `lastName` changes what a `fullName` cell should say — and marking only the edited cell left the computed one showing the old value until something unrelated repainted it. Hovering the row was how you found out, which makes the grid look like it needs poking. There is no way to know which other cells a host's `render` or `formatValue` depends on, and a row is the widest thing one of its values can affect, so a row is what gets marked: ~10 cells instead of 1, flat as the grid grows. |
| 2026-08-11 | polish | **The bulk writers were already batched, so they are untouched.** `pasteText`, `deleteRange` and `toggleBooleans` all pass `silent` to `editCellAt`, which skips the mark entirely, then mark `{ all: true }` once at the end — measured: a 1,000-row paste still costs **1 mark and 0 DOM mutations**. And even an unbatched caller could not flood the engine, because `RenderGridModel` merges every mark into one dirty set painted once per frame. Two independent mechanisms; the row-level mark is safe under both. |
| 2026-08-11 | polish | **A test cannot assert the mark and the repaint in one pass.** `captureDirty` replaces `render.model.update`, which suppresses the very paint a "did the computed column update" assertion needs — the first version of that test failed for exactly this reason and looked like a product bug. The two have to be observed separately, and the coalescing itself is already pinned one level down in `RenderGrid.test.ts`. |
| 2026-08-10 | polish | **ArrowUp and ArrowDown commit an edit and move a row; ArrowLeft and ArrowRight stay with the caret.** A cell editor is a single-line input, so the vertical arrows have nothing to do inside it and the horizontal ones have everything. Without this, Tab is the only way out of a cell and editing a *column* means a reach for Enter on every row. `CellInput` routes both through the same `commitAndPass` that Tab already used, so the grid's own key handling does the move — which means `ctrl+ArrowDown`'s page jump and the trailing-row growth off the bottom come along for free. The reference reaches the same place from the other side: its editor stopped propagation only for printable keys, and its `FocusModel` returned early on the horizontal arrows while editing. This port never routes editor keys to the grid at all, so the split is stated in the editor instead of undone in the focus model. |
| 2026-08-10 | polish | **⛔ The box toggles on the press, not on the click — element identity does not survive a real press.** A real click holds the button for ~100 ms, so the focus the press just moved repaints the cell in between and rewrites its content: the box the press landed on is **replaced**, measured `true` on every one of five presses. The browser then dispatches `click` on the nearest surviving ancestor, the cell, with the box nowhere in the event's path — so the first click appeared to do nothing and the second one worked, because by then nothing was left to change. Every synthetic test passed, because dispatching pointerdown/pointerup/click in one task leaves no frame for the repaint. In a pooled grid whose cells are rewritten by any state change, **the press is the only reliable pointer signal for a target inside a cell**; a click can only be trusted against the cell itself. |
| 2026-08-10 | polish | **The glyph swap is in the render path, not in CSS.** `.avg-data-cell:hover` would be cheaper and instant, and it was the second attempt — but it cannot be verified in the board: Playwright's synthetic hover leaves nothing matching `:hover` in the webview, so the rule could only be checked by forcing the state, and a broken selector would ship green. The model already tracks `hovered.col` and already repaints the hovered row, so choosing the glyph there costs two comparisons and is testable. Per *cell*, not per row: a row-wide swap would frame a box in every boolean column at once when only one is under the pointer. |
| 2026-08-10 | polish | **The box toggles its own cell, not the selection around it.** `toggleBooleanCell`, deliberately not `toggleBooleans` — the pointer is on one cell and means that one. Space and Enter still act on the whole selection, because that is where a selection is the thing being pointed at. |
| 2026-08-10 | polish | **That press must not also arm a range drag.** Once the editor is open on the cell, the drag armed by the same pointerdown would extend the selection across the grid while the user is placing a caret in the input under their pointer. `GridInteractions` checks `editing.isEditingCell` after the send and returns before arming. |
| 2026-08-11 | polish | **An untouched trailing row is taken back when the focus leaves it.** Holding ArrowDown is how a user reads the bottom of a grid, and the last press lands on a row that exists only because of the press — which the user then has to notice and delete with ctrl+Delete. `data.newRowKey` was already the temporary mark (set by `addTrailingRow`, cleared by the first `editCellAt`); the missing half was the reference's `EffectsModel` effect on `[focus]`, and it is now `StructureModel.dropUntouchedTrailingRow()` called from the end of `FocusModel.applyFocus` — the one place the focus can move, so arrow keys, clicks elsewhere and `clearFocus()` are all covered by one hook. |
| 2026-08-11 | polish | **The mark is cleared before the delete, and the delete tests the selection.** Cleared first because `deleteRows` moves the focus, which comes straight back through `applyFocus`, and the mark is the only thing saying there is work to do — the reference clears it first for the same reason. Tested against the whole selection rather than the focused cell, so a range dragged up *off* the new row, which still has it selected, keeps it. |
| 2026-08-11 | polish | **⚠ `addTrailingRow` has to suppress the drop while it runs.** Adding rows re-validates the focus, and a re-validation reaching the hook after the row exists but *before* the focus has moved onto it would delete the row as part of adding it. React never exposed this: the effect ran after the render had finished. Hence the `addingTrailingRow` guard — the port's problem, not the reference's. |
| 2026-08-11 | polish | **The row is found by checking the tail first.** The only row ever asked about is the one just appended, so one `getRowKey` comparison answers every ordinary call; the O(rows) scan behind it is reached only when a sort has since moved an untouched new row, and leads to a delete of the same order anyway. A key that is nowhere on display — filtered out, or the host replaced its rows — clears the mark instead, which otherwise blocks the next trailing row for the life of the grid. |
