# av-grid — Implementation Plan 07: column groups and multi-column sort (tasks 47–48)

**Phase 11 — done, shipped as 2.6.0.** Both tasks were unblocked and redesigned with the author on
2026-08-31 — the designs below **supersede** the ones archived in
[`plan-done-06.md`](plan-done-06.md#task-47--columngroups--two-level-headers), which are kept for
the record of what changed and why. Task 48's "build only when a consumer's screen asks" condition
was met: the author's consumer screen asked.

**Before starting any task here, read the decision logs in `plan-done-01.md` … `plan-done-06.md`.**
Entries from phase 10 that bear directly on this phase:

- **`syncRegion` learned about migrations** — a cell moving between sticky regions in one paint is
  a migration, not an eviction; the active-set union in `paint()` is what makes that safe.
- **Sorting has no keyboard binding** (task 49's named gap). Ctrl+click is a pointer gesture, so
  task 48 does **not** close it — the keyboard reference keeps saying so.

## Ground rules (standing, carried forward)

- Everything is additive; ships as a **minor** version per [`docs/releasing.md`](../docs/releasing.md).
- The core stays dependency-free; every new option reaches the React wrapper through lane 3 —
  verify by test.
- Design the API before implementing it; measure, don't assume (benchmark row per render-path
  change); verify in a browser, not only in tests.
- No consumer names in this repo.
- **Ask before adding a feature** that is not in this plan or in [`goal.md`](goal.md#scope).

## Task 48 — Multi-column sort (agreed design, 2026-08-31)

```js
AVGrid.create(el, {
    rows,
    multiSort: true,                                   // opt in; default false
    sort: [{ key: "region", direction: "asc" }, { key: "spend", direction: "desc" }],
    onSortChange: (sort) => setSort(sort),             // an array, because multiSort is on
});
```

- **Arity follows the option.** With `multiSort: false` (default) `sort`, `getSort()` and
  `onSortChange` hold/report one `SortColumn | undefined`, exactly as today — the single-column
  path is untouched, its tests unchanged. With `multiSort: true` they hold/report a
  `readonly SortColumn[]` (`[]` when unsorted). Internal state never holds an empty array.
- **The gesture** (author's design): plain click resets the sort to the clicked column
  (cycling asc → desc → none when it is already the only sorted column, as today);
  **Ctrl+click — or Cmd+click, because Ctrl+click is the macOS context-menu gesture** — appends
  the column ascending, cycles it to descending on the next Ctrl+click, and removes it from the
  list on the third, leaving the rest of the list alone.
- **Position numbers**: when more than one column is sorted, each sorted header shows its
  position (1, 2, 3) beside the arrow; with one or zero the header is pixel-identical to today.
  `aria-sort` goes on the primary column only, per the ARIA recommendation.
- **The pipeline**: a multi-sort resolves to one decorate-tuple `sortValue` plus one composite
  comparator with per-level direction folded in (negation per level; stable `Array.sort` keeps
  final ties in source order). `Column.sortValue` keeps its O(n) contract; `Column.rowCompare`
  levels compare rows pairwise. `RowsModel` is untouched — an array in `state.sort` has no
  `.direction`, so its reverse-for-desc step naturally does not fire.
- **The value guard compares lists element-by-element** — that is what keeps `sort={sort}`
  terminating through the React wrapper; extend the round-trip tests, do not replace them.
- `validateSort` accepts an array only when `multiSort` is on, and raises on duplicate keys.

## Task 47 — Column groups (agreed design, 2026-08-31 — supersedes plan 06's `columnGroups`)

```js
AVGrid.create(el, {
    rows,
    columns: [
        { key: "member", name: "Member", pinned: "left" },
        { key: "q1_spend", name: "Spend", group: "Q1" },
        { key: "q1_pmpm", name: "PMPM", group: "Q1" },
        { key: "q2_spend", name: "Spend", group: "Q2" },
        { key: "q2_pmpm", name: "PMPM", group: "Q2" },
    ],
    // optional: columnGroupRender / columnGroupClass for custom group cells
});
```

- **`Column.group?: string`** replaces the sibling `columnGroups` array — the grouping lives on
  the column, where an agent already is, and the unknown-key / claimed-twice error classes
  cannot exist. No `showColumnGroups` switch: the two-row header appears iff any **visible**
  column carries `group` — a property that silently does nothing until a second option is set
  would violate the API-for-agents principle.
- **Order is normalized, not validated**: same-group columns are gathered (stable — each group
  anchors where it first appears) instead of raising on non-contiguity. `getColumns()` returns
  the normalized order.
- **Column reordering is off** while groups are shown (author's call: a grouped order was
  prepared as a useful view). Resize, sort, filter, hide stay.
- **A pinned column cannot carry `group`** — raise. Groups live in the scrolling band; the
  sticky corners keep their plain tall headers.
- **Engine: zero changes.** `stickyTop` stays 1; when groups are active, row 0 is simply
  **twice as tall** (`rowHeight` becomes a per-row function) — grouped columns' header cells
  shrink to the lower half via a style adjustment in the renderer, ungrouped columns' headers
  fill the doubled slot as the natural tall cell. The group band itself is an
  **`addOverlay(el, "header")` overlay**: one absolutely positioned div per contiguous visible
  group run, in content-x coordinates, so horizontal scrolling costs nothing and the pooled
  renderer never sees a group cell. Rebuilt only when columns (set, order, width, visibility)
  change. Group cells are `aria-hidden` (the header row's semantics are unchanged); the docs'
  accessibility section says so.
- Hooks: `columnGroupRender({ group, columns })` → content, `columnGroupClass({ group, columns })`
  → extra classes. Both classified in `CALLBACK_OPTION_KEYS` (not paint-path — the overlay is
  not on it). No `onGroupClick` until something asks.

## Task tracker

| # | Task | Status |
|---|------|--------|
| 1–46, 49–50 | Phases 1–10 | see `plan-done-01.md` … `plan-done-06.md` — ✅ Done |
| 48 | Multi-column sort (Ctrl/Cmd+click, `multiSort`) | ✅ Done |
| 47 | Column groups (`Column.group`, overlay band) | ✅ Done |
| — | Docs, example (`14-groups.html`), board cases (`measureGroups` / `measureMultiSort`), benchmark rows, release **2.6.0** | ✅ Done |

## Open questions carried forward

1. **Group collapse** — stays a consumer job via `hidden` + `setColumns` until a real screen
   proves otherwise (answered in plan 06, restated so it is not re-litigated).
2. **Header focus** — would close the sorting keyboard gap; not part of this phase (Ctrl+click
   is pointer-only and the keyboard reference keeps naming the gap).
3. **`--avg-*` on `:root`** — the standing theming question from CLAUDE.md, still open, still not
   urgent.

## Decision log

| Decision | Why | Cost / notes |
|---|---|---|
| `group` on the column instead of a sibling `columnGroups` array | The info lives where an agent writes columns; two whole validation error classes (unknown key, claimed twice) cannot exist | Supersedes plan 06's design |
| Normalize mixed group order instead of raising | The author's model: the order was prepared as a view; gathering is forgiving and deterministic (stable, anchored at first occurrence) | `getColumns()` must return the normalized order or round-trips drift |
| No `showColumnGroups` option — presence of `group` turns the band on | An option-gated property that silently no-ops violates the API-for-agents principle | If "defined but hidden" is ever needed, that is when an option earns its place |
| Group band = taller row 0 + a header overlay, **not** `stickyTop: 2` | Keeps every row-coordinate choke point (`gridRowToDataRow`, `update({rows:[0]})`, aria, hit-tests, `scrollToRow`) untouched; `addOverlay(el, "header")` already exists | The archived "find every stickyTop:1 assumption" work item disappears entirely |
| Reordering off while groups show | Author's call — see plan discussion | Guard both `draggable` and the dnd handlers; a drop mid-flight when groups appear must be refused |
| Pinned columns cannot be grouped | The overlay lives in the scrolling band; corners keep plain tall headers | Raise in `validateColumns`; lift later only if a screen asks |
| Ctrl+click **and** Cmd+click append to the sort | Ctrl+click is the macOS context-menu gesture — the browser fires `contextmenu`, not `click` | `e.ctrlKey \|\| e.metaKey` |
| Sort position numbers shown only when 2+ columns sorted | Without them a 3-column sort is un-debuggable; with one column the header stays pixel-identical | `aria-sort` on the primary only, per ARIA |
| Multi-sort arity follows `multiSort` | No existing consumer sees a changed type; no consumer handles a union at runtime | The list value guard is load-bearing for the React round trip |
| The multi-sort list resolves to one decorate **tuple** + one composite comparator | `Column.sortValue` keeps its once-per-row contract per level (the pairwise alternative calls it O(n log n) times per level); a `rowCompare` level puts the row in its tuple slot | `RowsModel` needed **zero** changes: an array has no `.direction`, so its reverse-for-desc naturally never fires — that accident of shape is worth knowing before "cleaning it up" |
| Group cells are drawn by the band overlay, never by the pooled renderer | Column virtualization makes any pooled anchor for a span wrong: the anchor coordinate scrolls out of the render window while the rest of the group is still visible, and an incremental scroll never re-calls the survivors — the label just vanishes. Reasoned through before building; the overlay has no such coordinate | The band reads the engine's own `columnStarts`/`columnLength` (exported from `renderInfo`), so percentage widths and `fitToWidth` align by construction — measured 0.0 px |
| The board's group checks measure the design, not a hunch | First run "failed" twice: the band draws **all** groups (8 cells while 5 are on screen — deliberate, it is not virtualized), and alignment can only be checked for groups whose first and last headers are both rendered | A gate that encodes the wrong invariant reads as a red feature; both checks were fixed to state what the design promises |
