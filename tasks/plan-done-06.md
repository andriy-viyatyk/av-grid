# av-grid — Implementation Plan 06: pinned-right columns and a sticky footer (tasks 44–46, 49–50)

**Phase 10.** The *simpler half* of the structural gaps a data-dense reporting consumer hits on its
second screen, plus the measurement that should come before them and the accessibility question that
has been open since the first cell was drawn. **Two-level headers (task 47) and multi-column sort
(task 48) are deferred to phase 11 by the author's decision** — this phase ships what the engine
already supports as **2.5.0**, and the header work gets its own release. Their task text stays below,
unrenumbered, so phase 11 can pick them up intact.

**Why now:** the first React consumer is a reporting SPA with three grid screens, and the shapes are
known: a **wide record list** (~70,000 rows, ~280 available columns, a dozen shown by default, the
rest reachable through a column chooser), a **pivot-style cost report** (period columns under a
grouped header, a subtotal row per node, a pinned total row at the bottom), and a **measures screen**
(grouped measure headers, a total footer). Screen one is a fit today — `hidden` + `setColumns` +
`onColumnsChange` are exactly the column chooser's state, the built-in filter popovers with
`onGetOptions` are its facet filters, and 70k rows is inside the measured envelope. Screens two and
three are not: they rest on **two-level headers**, a **sticky total row**, and **right-pinned
columns**, and none of the three has a public option.

Two of those three are the reason this phase is small: **the render engine already implements them.**
`RenderGridModel` takes `stickyTop / stickyLeft / stickyRight / stickyBottom` as first-class counts,
`RenderGrid` maintains all eight regions and corners (`avg-sticky-right`, `avg-sticky-bottom`,
`avg-sticky-bottom-left`, `avg-sticky-bottom-right` are built on every mount), and `renderInfo`
already excludes the sticky bands from the scrolling window and offsets the right band by the
scrollbar width. The grid layer wires **left** (via `isStatusColumn`) and **top** (the header) and
nothing else. Tasks 45 and 46 are therefore mostly *API design plus wiring*, not engine work — which
is also the trap: an option that looks cheap because the hard part is already written still has to
decide what happens to sorting, filtering, selection, reorder, the clipboard and `fitToWidth`.

**How to use this document:** work one task at a time, top to bottom. A task is finished only when
every line in its **Done when** list is true. Update the **Status** column as you go, and record any
decision that changes the plan in *Decision log* at the bottom rather than silently diverging.

**Before starting any task here, read the decision logs in
[`plan-done-01.md`](plan-done-01.md), [`plan-done-02.md`](plan-done-02.md),
[`plan-done-03.md`](plan-done-03.md), [`plan-done-04.md`](plan-done-04.md) and
[`plan-done-05.md`](plan-done-05.md).** Three entries bear directly on this phase:

- **"No `whiteSpaceX`"** (docs/api.md) — the horizontal slack interacts with `fitToWidth` and
  percentage widths through the column-fitting arithmetic, which has already produced one spurious
  horizontal scrollbar. Task 45 adds columns that must be *excluded* from that arithmetic. Expect
  this to be where it bites.
- **"Pinned works off position"** (docs/api.md, `isStatusColumn`) — left pinning is *positional*,
  not a per-column flag honoured anywhere in the array: every column up to and including the last
  status column is sticky. Task 45 should stay consistent with that rather than inventing a second
  model.
- **"A controlled-props compatibility layer" was rejected** (plan 03) — nothing added here becomes a
  controlled prop. New state (a group's collapse, a sort list) is an option in, a callback out, a
  getter/setter on the instance. The React wrapper then gets it for free through lane 3.

## Ground rules (standing, carried forward)

- **Everything is additive.** No existing option, default, signature, CSS selector or dist filename
  moves. This ships as a **minor** version — **2.5.0** — per [`docs/releasing.md`](../docs/releasing.md).
  Task 49 is the one that could force a major; it is scoped so it does not.
- **The core stays dependency-free**, and React stays an optional peer. Nothing in this phase is
  React-specific: every new option should reach the wrapper as a prop through lane 3 with no wrapper
  change at all. Verify that claim (task 50) rather than assuming it.
- **Design the API before implementing it.** Each task below opens with the usage snippet that would
  appear in `examples/`. If a snippet needs explaining, fix the API before writing the code behind it.
- **Measure, don't assume.** Every task here touches `src/render/` or `src/view/`. Re-run the
  benchmark board and append a row to [`benchmark-results.md`](benchmark-results.md) after each one.
- **Verify in a browser.** happy-dom does no layout, so a green suite says nothing about a sticky
  band that renders in the wrong place. Open the board, screenshot it, look. Sticky-region bugs are
  *invisible* to the accessibility tree — that is already recorded in `docs/boards.md` as having cost
  three separate debugging sessions.
- **No consumer names in this repo.** Motivate by shape ("a pivot-style report with period column
  groups"), never by naming a private consumer, its product, or its organization.
- **Ask before adding a feature** that is not in this plan or in [`goal.md`](goal.md#scope).

---

## Task tracker

| # | Task | Status |
|---|------|--------|
| 1–43 | Phases 1–9 | see `plan-done-01.md` … `plan-done-05.md` — ✅ Done |
| 44 | The wide-grid gate: 300 columns, and a 12-of-300 projection | ✅ Done — horizontal is flat (0.99×), no 44b needed |
| 45 | Pinned-right columns (incl. `pinned: "left"` as the `isStatusColumn` synonym) | ✅ Done — the example lands with task 50's combined report example |
| 46 | `footerRows` — rows pinned to the bottom | ✅ Done |
| 47 | `columnGroups` — two-level headers | ⏭️ Deferred to phase 11 |
| 48 | Multi-column sort | ⏭️ Deferred to phase 11 (parity, not a need — no screen asks for it) |
| 49 | Accessibility: roles, `aria-sort`, and what conformance we claim | ✅ Done — 17/17 keyboard checks; sorting named as the keyboard gap |
| 50 | Docs, example, board, release 2.5.0 | ✅ Done |

Status values: ⬜ Not started · 🟡 In progress · ✅ Done · ⏸️ Blocked (say why).

**Do 44 first.** It is measurement only, it changes no API, and it can invalidate the design of every
task after it. Every published gate in `docs/capabilities.md` is **20 columns wide**; the consumer's
first screen is ~280. If a 300-column grid costs more than a 20-column one by more than the overscan
accounts for, the answer is a library fix, and it is better to know that before the new options are
layered on top of it.

---

## Task 44 — The wide-grid gate: 300 columns, and a 12-of-300 projection

No API change. A new benchmark case on the existing board, and a row in
[`benchmark-results.md`](benchmark-results.md).

**What to measure**, on 70,000 rows:

| Case | Why it is the case |
|---|---|
| 300 columns, all visible | The horizontal analogue of the 100k gate. First paint, fps while scrolling **horizontally** at the left edge and at column 290, and the flat-cost ratio between them. |
| 300 columns, 288 `hidden` | The real shape: a wide table with a small default projection. Confirms `hidden` costs *nothing per hidden column* on the paint path — that it is filtered once into the visible list, not consulted per cell. |
| Toggling 12 → 40 visible via `setColumns()` | What a column chooser does. Should be one repaint, not a re-create. |
| 300 columns, one filter applied | That the filter pass is row-bound, not row × column-bound. |

**Done when**

- The four cases run from the board (`window.avg`) with one call each, the way `runBenchmark(100000)`
  does.
- A row per case is appended to `benchmark-results.md`, with the numbers and the browser.
- The horizontal flat-cost ratio is stated in `docs/capabilities.md` beside the vertical one — or, if
  it is not flat, this task ends by opening a task 44b that says why, and the phase stops until it is
  answered.
- `setColumns()` with a different visible set is confirmed to mutate the DOM once (`render.stats`),
  not to tear the grid down.

**The trap.** Column overscan defaults to `1`, row overscan to `4`. A wide grid scrolled horizontally
exercises the *column* direction of "overscan in the direction of travel only", which no published
gate covers. If horizontal scrolling is not flat, suspect that before suspecting cell count.

---

## Task 45 — Pinned-right columns

```js
AVGrid.create(el, {
    rows,
    columns: [
        { key: "member", name: "Member", isStatusColumn: true },   // pinned left, as today
        { key: "jan" }, { key: "feb" }, /* … 280 more … */
        { key: "total", name: "Total", pinned: "right", align: "right" },
        { key: "actions", name: "", pinned: "right", width: 40 },
    ],
});
```

**Design.**

- One new column field: `pinned?: "left" | "right"`. **The author confirmed the synonym**: left
  pinning is positional (the leading run), so `pinned: "left"` can and must mean *exactly* what
  `isStatusColumn: true` means — same `lastIsStatusIndex` arithmetic, same validation shape as the
  right side's trailing-run rule, mirrored. `isStatusColumn` keeps working (soft synonym, documented
  as the older spelling; the one existing consumer migrates whenever it bumps). A column carrying
  both spellings with conflicting values is a validation error naming the key.
- **Positional, like left.** The right-pinned columns are the *trailing* run of the visible columns.
  `validateColumns` raises if a `pinned: "right"` column is followed by an unpinned one — with the
  offending key in the message, the way the existing column errors do.
- Wiring is the engine's `stickyRight` count = the length of that trailing run **in the visible
  columns** (`hidden` dropped first). A hidden pinned column simply shortens the run.
- The right band's offset by the vertical scrollbar width is already handled in `renderInfo`
  (`width - stickyRightWidth - scrollBarWidth`). Read that line before writing anything.

**What has to be decided, not assumed:**

- **`fitToWidth` and percentage widths.** Pinned widths must come out of the pool being stretched, or
  the fit arithmetic double-counts them and a spurious horizontal scrollbar reappears — the exact
  failure the missing `whiteSpaceX` exists to avoid. Pin *fixed* widths only, and raise on a
  percentage width for a pinned column rather than making the arithmetic guess.
- **Drag-reorder.** A drop that would move an unpinned column into the pinned tail, or a pinned one
  out of it, must be refused during the drag (no drop indicator), not fixed up after
  `onColumnsReorder`. The same applies to left.
- **Resize.** A pinned column stays resizable; the grip is on its left edge and must not fall under
  the band's edge shadow.
- **`data-col`** stays an index into visible columns, so a pinned cell's index is its real one — do
  not renumber inside the band. Say so in the DOM contract, because it is the first thing a test gets
  wrong.

**Done when**

- `pinned: "right"` puts the trailing run in `avg-sticky-right`, and it stays put while the rest
  scrolls, at both scroll extremes, verified by **screenshot** on the board.
- The corners work: a right-pinned column's header lands in `avg-sticky-top-right`, and with
  `footerRows` (task 46) its footer cell in `avg-sticky-bottom-right`. (The two-row-header corner
  case moves to phase 11 with task 47.)
- Range selection, copy, focus movement and keyboard navigation cross the boundary between the
  scrolling band and the pinned band with no coordinate discontinuity — a `Ctrl+A` copy still yields
  columns in visible order.
- `validateColumns` raises on a non-trailing pinned column and on a percentage-width pinned column,
  each naming the key.
- A benchmark row: 300 columns with two pinned right, horizontal scroll, against task 44's baseline.
- `docs/api.md` (Columns, DOM contract), `docs/capabilities.md`, an example, and a board case.

---

## Task 46 — `footerRows` — rows pinned to the bottom

```js
AVGrid.create(el, {
    rows,
    columns,
    footerRows: [{ label: "Total", spend: 4_812_500, members: 71_475 }],
    footerRowClass: () => "grand-total",
});
```

**Design.** The engine's `stickyBottom` is a count of *trailing rows*, so the cheapest correct design
is that footer rows **are rows**: same row type, so the same columns, `formatValue`, `displayFormat`,
`align`, `render` and `cellClass` all apply unchanged, and the consumer's number formatting is not
written twice. The grid appends them internally after the visible row set and sets `stickyBottom` to
their count.

**The work is the exclusion list, and it is the whole task.** A footer row must be invisible to:

- **sorting** (it never moves), **filtering** and `searchString` (it never disappears — and it is not
  a search match either),
- **row selection** (`selectColumn` draws no checkbox there; select-all does not include it;
  `getSelected()` never names it),
- **`onVisibleRowsChange`** and **`getVisibleRows()`** — those keep meaning *data* rows, or every
  consumer's row count becomes wrong by one,
- **add/delete-row affordances** (`canAddRows`, `Ctrl+Insert`, `ArrowDown` off the end, a tall paste)
  — the footer is not the last row for any of those purposes,
- **editing** — footer cells are `readonly` regardless of `editable`,
- **a range selection and its copy** — a drag downwards stops at the last data row.

Two more decisions:

- **Row keys.** `getRowKey` must not be asked for a key for a footer row (a consumer's implementation
  will read a field that is not there). Mint `avg-footer-<n>`, and guarantee it cannot collide with a
  data key — the same guarantee the blank-row placeholder already needs.
- **`extraElement` coexistence.** `extraElement` scrolls with the content and stays after the last
  data row; the footer band is pinned below it. Both at once must not overlap — that is a
  `whiteSpaceY` interaction, and a case on the board.

**Top summary rows are deliberately not in this task.** The `avg-sticky-top` band already holds the
header, so a top summary is a *second* structural row in that band and belongs with task 47's header
work if it is ever asked for. Nothing in the consumer's three screens needs one.

**Done when**

- A footer row renders in `avg-sticky-bottom`, stays pinned at both scroll extremes, and is styled
  through `avg-footer-cell` + `footerRowClass` — screenshot on the board.
- Every item in the exclusion list has a test that fails if the exclusion is dropped. Write them as
  the list, one `it` per line; this is the part a future refactor breaks silently.
- `rowHeight` applies to footer rows, and the grid's total height accounts for them, so the last data
  row can still scroll clear (`whiteSpaceY` unchanged in meaning).
- Sorting, filtering and a search leave the footer row untouched and in place.
- A benchmark row: the sticky bottom band must cost **zero** extra DOM mutations on a scroll frame,
  since its cells are never evicted. If it does not, the region sets are being resynced when they
  should not be.

---

## Task 47 — `columnGroups` — two-level headers ⏭️ *deferred to phase 11*

**Not in this release.** The big one, and the only task here with no engine support already in
place — which is exactly why the author chose to ship the engine-backed features first and give
this its own version. The design below stands as written for phase 11.

```js
AVGrid.create(el, {
    rows,
    columns: [
        { key: "member", name: "Member", isStatusColumn: true },
        { key: "q1_spend", name: "Spend" }, { key: "q1_pmpm", name: "PMPM" },
        { key: "q2_spend", name: "Spend" }, { key: "q2_pmpm", name: "PMPM" },
    ],
    columnGroups: [
        { name: "Q1", columnKeys: ["q1_spend", "q1_pmpm"] },
        { name: "Q2", columnKeys: ["q2_spend", "q2_pmpm"], className: "period-current" },
    ],
});
```

**Design — a flat list that references keys, not nested children.**

`react-data-grid` nests (`{ name, children: [...] }`), and nesting is the wrong trade here: it makes
the column array a tree, so every index, `data-col`, reorder, resize, `getColumns()` / `setColumns()`
round trip and validation has to flatten it first, and the flattening becomes load-bearing in code
that is currently flat and fast. A **sibling `columnGroups` list keyed by column key** leaves the
column model exactly as it is. Consequences to accept deliberately:

- **A group must be contiguous in the visible order.** Validate and raise, naming the group. A hidden
  column shrinks its group; a group whose columns are all hidden disappears.
- **A column in no group** spans both header rows (one tall cell), which is what a label column wants
  anyway.
- **Groups do not nest.** Two levels, full stop. Three is a different feature and no one has asked.

**The mechanical work:**

- The header band becomes **two rows**, so `stickyTopHeight` is no longer one `headerHeight`. Find
  every place that assumes the header is one row tall — the measurement, the sticky-corner heights,
  the hit-testing in `GridInteractions`, and the `scrollToRow` arithmetic.
- **Group cells are their own cells**, painted through the same pooled renderer, carrying
  `data-group-key` and **no** `data-row` / `data-col` (they stand for a span, not a coordinate). The
  hit-test must resolve a click on one to the group and never to a column — invariant 3's rule that
  everything resolves off the nearest cell's data attributes still holds, it just gains a case.
- **Affordances stay on the leaf header.** Sort, funnel and the resize grip do not appear on a group
  cell. A group cell gets `headerRender`, `className` and a click callback (`onGroupClick`) — and
  nothing else, until something asks.
- **Reorder inside a group only.** A drag that would take a column out of its group is refused during
  the drag, as in task 45. Dragging a whole *group* is not in this task.

**Done when**

- Two-level headers render, align exactly over their columns at every scroll offset and after a
  resize, and hold up over a left-pinned and a right-pinned column — **screenshot**, at two zoom
  levels, because this is where a half-pixel is visible and a test is not.
- A hidden column shrinks its group; hiding all of a group's columns removes the group cell.
- `validateColumns` (or a new `validateColumnGroups`) raises on a non-contiguous group, an unknown
  column key, and a column claimed by two groups — each naming the group and the key.
- Sorting and filtering still work from the leaf header; a group cell has no funnel and no sort.
- A benchmark row: full repaint cost with 300 columns in 25 groups, against task 44's baseline. The
  gate is that a group cell is painted **once per visible group**, not once per column.

---

## Task 48 — Multi-column sort ⏭️ *deferred to phase 11 (build only if a screen asks)*

**Not in this release.** The author reviewed it and deferred: no requirement names it; it is on this list because
`react-data-grid` exposes `sortColumns` (plural), so a consumer migrating from it will look for the
equivalent. That is parity, not a need, and it is the one item here that touches an existing
callback's shape.

If it is confirmed, the shape that stays additive:

```js
AVGrid.create(el, {
    rows,
    multiSort: true,                                   // opt in
    sort: [{ columnKey: "region" }, { columnKey: "spend", direction: "desc" }],
    onSortChange: (sort) => setSort(sort),             // an array, because multiSort is on
});
```

- `sort` widens to `SortColumn | readonly SortColumn[] | null`, and **arity follows the option**:
  with `multiSort: false` (the default) the grid holds one and `onSortChange` reports one, exactly as
  today; with `multiSort: true` it holds and reports an array. No existing consumer sees a changed
  type, and no consumer ever has to handle a union at runtime.
- `Ctrl+click` (or `Shift+click` — pick one, and put it in the keyboard reference) appends a column to
  the sort; clicking a sorted column cycles it, and a third click removes it from the list rather than
  clearing the whole list.
- The header shows each sorted column's **position** (1, 2, 3) beside its arrow, or the feature is
  unusable with three columns sorted.
- `SortColumnModel`'s value guard must compare **lists**, element by element, or the React round trip
  stops terminating — that guard is what makes `sort={sort}` safe, and it is pinned by a test that
  must be extended, not replaced.

**Done when** the single-column path is unchanged (its tests untouched and passing), the array path
round-trips through the React wrapper without an echo loop, and the keyboard reference and
`docs/react-api.md`'s state table both name the new arity rule.

---

## Task 49 — Accessibility: roles, `aria-sort`, and what conformance we claim

Today cells are `div`s with no roles — `docs/api.md` says so, in the course of explaining why
screenshots beat accessibility snapshots for this library. That is a defensible engineering position
and an awkward answer to a consumer whose organization mandates WCAG 2.1 AA. This task's deliverable
is **an honest, bounded claim plus the cheap half of the work**, not a screen-reader mode.

The bounded part, which is most of AA for a data grid and is largely already true:

- **Keyboard operability** — grid navigation, editing, selection and the context menu are already
  reachable from the keyboard. Audit against the keyboard reference and fix the gaps.
- **Visible focus** — the focused cell has an indicator that survives a theme change and meets the
  3:1 non-text contrast rule. Check it in both themes.
- **Contrast** — the shipped token defaults for header, selection, search-match and disabled states,
  all measured, all recorded in `docs/capabilities.md#theming`. A consumer overriding tokens owns its
  own palette, and the docs should say that in one line.

The roles part, scoped so it cannot become a redesign:

- `role="grid"`, `aria-rowcount`, `aria-colcount`, `aria-multiselectable` on the root.
- `role="columnheader"` + **`aria-sort`** on header cells (cheap, and genuinely useful),
  `role="gridcell"` + `aria-rowindex` / `aria-colindex` on data cells.
- **State the limit plainly in the docs:** ARIA's grid pattern wants `role="row"` owners, and this
  library deliberately has **no row element** — that absence is what keeps a one-row scroll to twelve
  node touches (invariant 2's corollary). So the claim is *"keyboard-operable, with grid semantics and
  sort state exposed; not a fully conformant ARIA grid, because there are no row elements."* Write
  that sentence in `docs/capabilities.md` and do not soften it. A consumer can then make an informed
  decision instead of discovering it in an audit.
- Whether to offer `role="row"` wrappers behind an opt-in option (`ariaRows: true`, trading the
  performance the library exists for) is a **question for the author**, not a task. Do not build it
  speculatively.

**Done when** the three bounded items are audited and fixed, the roles above are present, a board case
shows the grid driven start-to-finish from the keyboard, and `docs/capabilities.md` carries the
conformance sentence and the measured contrast table.

---

## Task 50 — Docs, example, board, release 2.5.0

- `docs/api.md`: `pinned` in Columns (with `isStatusColumn` marked the older spelling);
  `footerRows` / `footerRowClass` in Options; the new DOM contract entries (`avg-footer-cell`, and
  the note that `data-col` is not renumbered inside a band); `aria-sort` in the DOM contract.
- `docs/react-api.md`: confirm — by test, not by reading — that the new options reach the
  wrapper through **lane 3** with no wrapper change, and add `footerRows` to the note about props
  whose *reference* identity matters (a footer array rebuilt during render sends a `setOptions` per
  commit; memoize it, exactly as with `columns`).
- `docs/capabilities.md`: a subsystem entry per feature, with its measured numbers.
- One example covering both at once — a report shape: a left label column, a right-pinned total
  column, a pinned grand-total row. (The grouped-header layer joins it in phase 11.)
- A board case for each, and the screenshots that prove the bands land where they should.
- `benchmark-results.md`: every row this phase produced, plus a one-paragraph summary of what changed
  about the wide-column story.
- Release **2.5.0** per `docs/releasing.md`. Update `CLAUDE.md`'s *Current state*, and archive this
  file as `plan-done-06.md` once every task is ✅.

---

## Not in this phase, and why

- **`colSpan` / cell spanning.** Wanted for a subtotal label spanning the label columns, and it is the
  most invasive item on the list: it changes cell *enumeration* in `renderInfo`, the hot path the
  whole project's numbers rest on. A consumer has two cheaper routes — put the label in the first
  column and blank the rest, or give the subtotal row a `rowClass` and let the label ellipsize.
  Revisit only if a real screen proves those are not enough.
- **Row grouping, tree rows, expand/collapse.** A reporting consumer's aggregation runs server-side
  and the grid is handed already-grouped flat rows; the drill affordance is a `render` chevron plus
  `onCellClick`. Keeping grouping out is what keeps the grid a grid.
- **Aggregation of any kind.** Same reason, permanently. The grid renders rows it is handed.
- **`.xlsx` export.** The clipboard is already Excel-compatible TSV, and a real export in a reporting
  application is generated server-side because it has to be logged. A spreadsheet writer inside a
  dependency-free grid is a poor trade.
- **Variable row heights.** Already out of scope in `goal.md`; nothing here changes that.

## Open questions for the author — **all answered (2026-08-31)**

1. **`pinned: "left"` as a synonym for `isStatusColumn`** — **yes.** Positional left pinning means
   the two spellings can be made exactly equivalent, so the symmetric spelling wins for the
   AI-agent audience; `isStatusColumn` stays as the older spelling. (Task 45.)
2. **Multi-column sort** — **deferred.** Parity with `react-data-grid`, not a need; none of the
   consumer's three screens uses it. Revisit in phase 11 only if a screen asks. (Task 48.)
3. **`ariaRows` opt-in** — **never.** "Keyboard-operable, with grid semantics and sort state
   exposed; not a fully conformant ARIA grid" is the permanent answer; row elements would cost the
   performance the library exists for. (Task 49.)
4. **Group collapse** — moot for this phase (task 47 deferred); when groups land, collapse stays a
   consumer job via `hidden` + `setColumns` until proven otherwise.

## Decision log

| Decision | Why | What it costs / guards |
|---|---|---|
| **Phase split: 47 (columnGroups) and 48 (multi-sort) deferred to phase 11** (author, 2026-08-31) | Ship the engine-backed features (pinned-right, footer rows, a11y) as 2.5.0 without waiting on the one task with no engine support; the two-row header gets its own release and full attention | Task 45/50 lose their task-47 cross-dependencies (edited above); phase 11 inherits tasks 47–48 verbatim, including the corner case "right-pinned column under a two-row header" |
| **`syncRegion` learned about migrations** (task 45) | A column pinned or unpinned moves its live cell between regions in one paint; the old code evicted it — a `removeChild` crash in one sync order, and an on-screen element released into the pool (then handed out as a recycle) in the other | One Set insert per visible cell per paint; measured unmoved (0.79/0.92× warm, plain wide grid 0.24 ms before and after). Pinned by the RenderGrid "moves a cell between regions" test |
| **The percentage-width raise covers `isStatusColumn` too** (task 45) | The synonym must stay exact, and the fit-arithmetic trap is the same on either edge — so both spellings raise, rather than the new one validating harder than the old | In principle a break for a percent-width status column; no consumer has one, and the author licensed contract changes this phase |
| **`whiteSpaceY` is honored with a bottom band** (task 46) | The engine dropped all trailing slack under `stickyBottom`; the *default* still is (the band is the slack), but an explicit `whiteSpaceY` now buys room between the last scrolling row and the band — the strip `extraElement` needs to coexist with a footer | One renderInfo branch; pinned by a unit test (400/440/420). The area also publishes `--avg-sticky-bottom`, which the stylesheet uses to anchor `avg-extra` and the add-row button above the band |
| **Footer exclusion is structural, not a list of guards** (task 46) | Footer cells carry `data-type="footer-cell"` and no `data-row`, so the interaction layer — which resolves everything off a data cell's attributes (invariant 3) — cannot reach one. Sorting/filtering/selection never see footer rows because they are never in `data.rows`; only `rowCount` (the engine's) counts them | The exclusion list is still one test per line in `AVGrid.test.ts`, so a refactor that reintroduces a path fails a test rather than a consumer |
| **Alt+↓ and the Menu key added to the keyboard surface** (task 49) | The audit found the filter popover pointer-only and the keyboard `contextmenu` landing on the bare grid; both are standard gestures (Excel's Alt+↓; the platform Menu key), not invented chords | Two entries in the keyboard reference; the focused-cell resolution lives in `GridInteractions.onContextMenu`, anchored at the cell's rect since a synthetic event carries no useful coordinates |
| **Keyboard focus clamps past pinned-left chrome** (task 49) | The first navigation key landed on the checkbox column, which the pointer can never focus — the keyboard was the one way into a cell that half the interactions refuse | `firstColumn = lastIsStatusIndex + 1` in the landing, ArrowLeft, Ctrl+Home and the Shift+Tab wrap. Behavior change to keyboard movement; no test pinned the old landing, one now pins the new |
| **Sorting stays pointer-only, named as a gap** (task 49) | A sort key without header focus has no standard spelling; inventing one is worse than documenting the gap and pointing at `setSort()` | The conformance claim in capabilities.md and the keyboard reference both name it; header focus is a phase-11 question |
| **`pinned: "left"` added as a true synonym of `isStatusColumn`** (author, 2026-08-31) | Symmetric, self-explaining column API for the AI-agent audience; the sole existing consumer can migrate at its own pace | Both spellings must stay *exactly* equivalent forever — validation raises if one column carries conflicting values |
