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
