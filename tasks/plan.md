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
| 3 | `RenderGridModel` — scroll, resize, dirty merge | Engine | ⬜ Not started |
| 4 | DOM shell — sticky bands + cell pool | Engine | ⬜ Not started |
| 5 | **Benchmark page — 100k rows** ⛔ perf gate | Engine | ⬜ Not started |
| 6 | Public entry — `AVGrid.create()` + validation | Grid | ⬜ Not started |
| 7 | Columns, rows, sorting | Grid | ⬜ Not started |
| 8 | Header cell — sort indicator, resize, reorder | Grid | ⬜ Not started |
| 9 | Data cell + theming stylesheet | Grid | ⬜ Not started |
| 10 | Focus, keyboard nav, range selection | Behavior | ⬜ Not started |
| 11 | Row selection + select column | Behavior | ⬜ Not started |
| 12 | In-cell editing | Behavior | ⬜ Not started |
| 13 | Clipboard copy/paste | Behavior | ⬜ Not started |
| 14 | Row/column add and delete | Behavior | ⬜ Not started |
| 15 | Filters model + row filtering | Filters | ⬜ Not started |
| 16 | Filter popover + options body | Filters | ⬜ Not started |
| 17 | Filter bar | Filters | ⬜ Not started |
| 18 | `getState()`, introspection, `destroy()` | Polish | ⬜ Not started |
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
- `examples/benchmark.html` — 100,000 rows × 20 columns, generated client-side, no build step,
  opens directly in a browser. On-page readout of: FPS during a scripted scroll, time to first
  paint, and paint time per frame at row ~99,000.
- `tasks/benchmark-results.md` — the baseline numbers, dated, with the machine noted.

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

## Phase 4 — Filters (tasks 15–17)

The most UIKit-coupled corner of the reference, so it gets the most design work. Read *The
filtering subsystem* in `goal.md` before starting task 15 — it enumerates behaviors that are
easy to miss and annoying to retrofit.

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
- Minimal vanilla replacements for `Popover`, `MultiListBox`, `Button`, `IconButton` — scoped
  to exactly what the grid needs. Do not port UIKit.
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
| 2026-08-08 | 1 | **Scaffold fix:** `@types/node` was missing, so `vite.config.ts` did not typecheck. Added as a dev dependency with `"node"` in `tsconfig.types`. |
