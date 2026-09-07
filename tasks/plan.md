# av-grid — Implementation Plan 12: phase 16

**Phase 16 — done, shipping as 2.9.2 (2026-09-07).** Phases 1–15 shipped through **2.9.1**. One task, from
a consumer report on 2.9.x (2026-09-07). **Before starting it, read the decision logs in
`plan-done-01.md` … `plan-done-11.md`** — every one of them still applies. **Task 57 is a
defect**, not a refinement — no prior decision stands behind it.

## Ground rules (standing, carried forward)

- Everything is additive; ships as a **minor** version per [`docs/releasing.md`](../docs/releasing.md)
  — unless a phase holds only a defect fix with no new surface, which ships as a **patch**.
- The core stays dependency-free; every new option reaches the React wrapper through lane 3 (or
  lane 2 for a callback) — verify by test.
- Design the API before implementing it; measure, don't assume (benchmark row per render-path
  change); verify in a browser, not only in tests.
- No consumer names in this repo.
- **Ask before adding a feature** that is not in this plan or in [`goal.md`](goal.md#scope).

## Task 57 — a filter or a sort on a `hidden` column must survive the column being hidden

**The report** (a consumer, 2026-09-07). A user filters a column, then hides that same column
through the host's own column picker — `hidden: true`, the column kept in the array, which is the
only way this library hides one. The grid throws on the next update:

```
Uncaught AVGridError: Unknown column "market" in `filters[0]`.
Available columns: patientName, empi, …
```

Under React that is a render-phase throw, so the screen goes white — the app is gone, not
degraded. The message's own list is the tell: "available columns" is the **visible** set, and the
column it says is unknown is missing from it only because it was just hidden.

**Root cause — filters are validated against the wrong column list.**

```ts
// src/model/FiltersModel.ts:430
private get columns(): Column<R>[] {
    return this.model.data.columns.length      // ← VISIBLE only
        ? this.model.data.columns
        : this.model.options.columns;          // ← all of them
}
```

`AVGridData.columns` is `options.columns` with `hidden` dropped (`ColumnsModel.setColumns` →
`updateColumnsData`, `src/model/ColumnsModel.ts:101`). So the moment a column goes hidden, every
filter naming it is "unknown". The throw arrives through `setOptions`, which applies **columns
before filters** by design (`src/AVGrid.ts:939-942`, *"row filtering matches against them"*) — so a
host holding columns and filters in its own state and echoing both back, which this library
invites (*"every piece of grid state is an option, so every piece of it is a prop"*), hits it on
the very next render.

**The value guard does not save the echo** (reproduced 2026-09-07). Every setter "guards on value
and returns early on no change", which is what makes a host round trip terminate — but in
`FiltersModel` the validation runs *before* the equality check, so even `setFilters()` with the
filters the grid already holds throws once the column is hidden. The fix therefore cannot be
"skip validation when nothing changed"; the validation itself has to accept the column.

**Reproduced, both halves** (2026-09-07, happy-dom): `setColumns` alone hiding a filtered or sorted
column does *not* throw — the filter and the sort stay applied. The throw comes from the next
`setFilters` / `setSort` / `setOptions` naming that column, which a host holding the state is
guaranteed to send. Mount with a hidden column already filtered is accepted. **The sort twin
reproduces**: `setOptions({ columns, sort })` and `setSort()` both throw ``Unknown column "…" in
`sort` `` — so this is one policy at two call sites, and both ship together.

**Three things make this a defect rather than a policy.**

1. **The library contradicts itself across mount and update.** `validateOptions` validates
   `filters` against the **full** column array — `columns` there is the validated, gathered
   `o.columns`, hidden ones included (`src/validate.ts:891-908`). The exact options accepted at
   construction are rejected on the next `setOptions`. Whichever list is right, it cannot be a
   different one on the two paths.
2. **The documented behaviour is the opposite.** `docs/api.md:779`, on hidden columns: *"Sort,
   filter, resize and `hidden` all still work."* `getColumns()` returns the full array, and only
   `data-col` is documented as indexing the visible set (`docs/api.md:2089`). Nothing declares a
   hidden column unfilterable — and filtering by a column you are not showing is an ordinary
   thing to want.
3. **`hidden` is cheap by design.** Phase 10 measured it: *"`hidden` costs nothing per hidden
   column"*. It is a presentation flag that has quietly become a semantic one.

**The sort twin — same shape, not yet reproduced.** `setSort` validates against
`this.model.data.columns` too (`src/AVGrid.ts:560-564`), and `setOptions` applies `sort` after
`columns` in the same pass (`src/AVGrid.ts:949`). So sorting by a column and then hiding it should
throw ``Unknown column "…" in `sort` `` by the identical route. **Reproduce it first** — if it
holds, this is one fix with two call sites, and shipping half of it leaves a white screen behind a
different gesture.

### The work

1. **`FiltersModel`'s `columns` getter resolves against `options.columns`.** The getter's comment
   explains the fallback it has today (*"the live set, or the option when the data model has not
   built one yet, which is the case while this model's own constructor runs"*) — with
   `options.columns` as the primary, that ordering problem disappears rather than being handled,
   and the getter reduces to one expression. Check every reader before assuming it: the getter also
   feeds `validate`, `applyFilter` and `filtersChanged` → the `persistFilters` prune, which wants
   the change too (a persisted filter must not be dropped because a column is hidden).
   **`getOptions` is a separate case** — it passes `data.columns` to `onGetOptions` and to
   `defaultFilterOptions`, where the cascade is deliberately over what is on screen; leave it, and
   record why in the decision log.
2. **`setSort` resolves against the same full list** — the reproduction confirmed it.
   **Prefer one helper on the model** that finds a column by key over the *full* array
   (`options.columns`), and route every reader that resolves a filter's or a sort's *identity*
   through it — `FiltersModel.columns`, `setSort`, `SortColumnModel.updateRowCompare`,
   `describeFilter` (`src/view/FilterBar.ts:202`, which today loses a hidden column's definition
   `label` and hands `filterLabel` a `column: undefined`). `data.columns` stays for geometry and
   render — `data-col`, the sticky bands, the cell renderers, `GridInteractions`.
   `FilterPopover` and `GridInteractions`' Alt+↓ keep the visible set: a popover cannot open on a
   column with no header, and saying so is right.
3. **Decide what a hidden column's filter *matches* against, and write the decision down.**
   `RowsModel.filter` passes `this.model.data.columns` to `filterRows`
   (`src/model/RowsModel.ts:134-142`), so under local filtering a hidden column resolves to
   `column === undefined` and `filterRows` falls back to the raw `row[filter.columnKey]`
   (`src/gridUtils.ts:216-219`, and the `options` case through `filterValue`). It therefore *works*
   today — but a hidden column with a `formatValue` or a `displayFormat` silently changes how it
   matches the moment it is hidden, and a column with its own `filter` definition stops being
   consulted at all (`filtersMatch` reads `column?.filter`). That is the same bug wearing a quieter
   face, and the half a consumer would report second.
   **The sort has the same quiet face.** `SortColumnModel.updateRowCompare` (both the single and
   the multi-sort branch) resolves the sorted column from `data.columns`, so a hidden column with a
   `sortValue` or a `rowCompare` silently falls back to a raw key compare the moment it is hidden.
   Resolve it through the same helper as item 2; the `onDataChange` re-resolve on a column change
   already exists, so the order corrects itself as soon as the lookup does.
   **The catch to design around:** `filterRows(rows, columns, searchString, filters)` uses its one
   `columns` parameter for two jobs — resolving each filter's column **and** `searchStringMatch`'s
   local search across columns. The search should stay over the **visible** columns (searching what
   is on screen is the point), so this cannot be a one-word swap at the call site: either
   `filterRows` takes the filter columns separately, or `RowsModel` resolves them before the pass.
   `filterRows` is **public** (`src/index.ts:114`), so a new parameter must be additive and
   optional, and the existing signature must keep working — including the hand-written-call
   tolerances its own comments promise. **Preferred route: `RowsModel` resolves the filter
   columns before the pass** and `filterRows` gains an optional trailing `filterColumns`
   parameter defaulting to `columns` — the smaller change, and the public signature is untouched
   for every existing caller.

### Verification

- Unit, the reported case exactly: build a grid, `setFilters` on a column, then `setColumns` with
  that column `hidden: true` — no throw, and `getFilters()` still reports the filter.
- Unit, the round trip that made it a white screen: one `setOptions({ columns, filters })` carrying
  the newly hidden column together with the unchanged filters, which is what a React host sends.
- Unit, mount parity: constructing with a hidden column already filtered is accepted today and must
  stay accepted — the regression net against fixing this in the wrong direction.
- Unit, the sort twin (it reproduces): sort a column, hide it through `setOptions({ columns,
  sort })` and through `setSort()` — no throw, `getSort()` unchanged, the order kept.
- Unit, sort matching: a hidden column with a `sortValue`, and one with a `rowCompare`, order the
  rows the same hidden as shown.
- Unit, the bar: `describeFilter()` on a hidden column with a custom `filter` definition still
  uses the definition's `label`, and `filterLabel` receives the column.
- Unit, the echo: `setFilters()` with the filters the grid already holds, after the column was
  hidden, neither throws nor re-runs the pipeline.
- Unit, matching: a hidden column with a `formatValue`, and a hidden column with a custom `filter`
  definition, both filter the same rows hidden as shown (local filtering, `externalFilter` off).
- Unit, persistence: a persisted filter on a hidden column survives a reload.
- **Still throws for a genuinely unknown column** — the message this task is about must not become
  unreachable. `src/validate.test.ts` owns that assertion.
- `externalFilter: true` is the mode the report came from: assert the filter reaches
  `onFiltersChange` and that the row pass leaves the handed-over page alone.
- Browser: `AVGridBoard` — filter a column, hide it through `window.avg`, confirm the grid stands
  and the filter still reads in the bar. No render-path file should change, so no benchmark row is
  expected; append one if that turns out wrong.

### Deliverables

- `docs/api.md` — make `docs/api.md:779`'s promise explicit for the case that broke: a filter and a
  sort on a hidden column stay applied, plus what a hidden column's filter matches against
  (whatever work item 3 decides).
- No `docs/react-api.md` change expected: no new surface crosses the wrapper. The React lane is
  where the throw *lands*, not where it lives.
- Release **2.9.2** per [`docs/releasing.md`](../docs/releasing.md) — a patch: a defect fix inside
  shipped behaviour, no API surface added (an optional `filterRows` parameter from work item 3 is
  still additive).

## Task tracker

| # | Task | Status |
|---|------|--------|
| 1–56 | Phases 1–15 | see `plan-done-01.md` … `plan-done-11.md` — ✅ Done |
| 57 | A filter or a sort on a `hidden` column must survive the column being hidden — `FiltersModel` and `setSort` validate against the visible set | ✅ Done — 2.9.2 |

## Decision log

| Decision | Why | Cost / notes |
|---|---|---|
| **Identity resolves over the full column set; geometry over the visible one.** `ColumnsModel.columnByKey` (over `options.columns`) is the one lookup for what a filter or a sort *names*; `data.columns` / `indexOfKey` stay for what is rendered | `hidden` is a presentation flag; resolving identity against the visible set made it semantic — the same `{ columns, filters }` a host echoed back was rejected the moment one column went hidden, and `create()` (which validates against the full array) and `setOptions` disagreed | Readers moved: `FiltersModel.columns`, `AVGrid.setSort`, `SortColumnModel.updateRowCompare` (both arities), `describeFilter`. Readers deliberately kept on the visible set: `FilterPopover` and the Alt+↓ path (no header, no popover) and the cascade's own column list (below) |
| **The fix is in validation, not in the value guard** | Reproduced: the guard runs *after* validation, so even `setFilters()` with the list the grid already held threw. Skipping validation on "no change" would have left a genuinely unknown column unreported on the first set | The unknown-column error is unchanged and still tested for both `filters[i]` and `sort` |
| **A hidden column matches and sorts exactly as a shown one** — by its `formatValue` / `displayFormat` / `filter` definition, and by its `sortValue` / `rowCompare` | Falling back to the raw row property was the same defect with a quieter face: hiding a formatted column silently changed which rows survived | `filterRows` gained an optional trailing `filterColumns` (default `columns`) — additive; every existing call is unchanged. `RowsModel` passes visible columns for the search and the full set for the filters |
| **`searchString` stays over the visible columns** | Searching what is on screen is the point of a local row search; a match in a column the user cannot see would look like a wrong result | The reason `filterRows` needed a fifth parameter rather than a one-word swap at the call site |
| **`getOptions` still hands `onGetOptions` and `defaultFilterOptions` the visible columns, but the cascade's *filters* resolve over the full set** | The cascade describes what is on screen, and a host is told about the columns the user is looking at; a filter on a hidden column must still narrow the cascade the way it narrows the rows | `defaultFilterOptions` gained the same optional `filterColumns` parameter, passed by the model; the public signature is additive |
| **Patch release (2.9.2)**, and the ground rule now says a defect-only phase ships as a patch | A defect fix inside shipped behaviour with no new surface; the two optional parameters are additive | Docs: a `hidden` section in `docs/api.md` (the promise made explicit, plus what a hidden column's filter matches against), the `filterRows` row, a line under *A filter*. No `docs/react-api.md` change — the React lane is where the throw landed, not where it lived |
| **Open question 4 stays open**: whether a runtime setter should be able to degrade instead of throw | The consumer's own storage replayed the throw on every reload with no user-side recovery. Task 57 removes this cause; the class of failure is a policy question, and adding an `onError` opt-in is a feature, not a fix | Not committed; ask before adding |

## Open questions carried forward

1. **`--avg-control-h` and `--avg-radius` as tokens?** Raised by a consumer on 2026-09-03 and not
   committed — recorded so it is not lost. The filter popovers' input, search box, chips and
   buttons all carry class hooks (`.avg-text-filter-input`, `.avg-list-search`,
   `.avg-text-filter-op`, `.avg-button`), so a host can already restyle them; what it cannot do
   is restyle them *through tokens*, because the control padding and the 4px radius are literals
   in the stylesheet. A host whose own controls are 32px tall with an 8px radius therefore
   overrides rules rather than values — an override that breaks quietly the next time the library
   restyles its own controls. Two tokens would turn that block into two assignments. Against it:
   the stylesheet's structural values are deliberately not all tokenized, and every token is
   public surface forever.
2. **Should `textFilterOps` have a grid-level default?** Deliberately not in task 54 — a host that
   wants the chips everywhere sets the field while building columns. Worth revisiting only if a
   consumer asks with a case where that is not possible.
3. **`textFilterLabels` — the host's words on the popover's operator chips.** `filterLabel`
   (task 55) covers the bar chip only. A localized popover would need a map of op → label; not
   asked for yet.
4. **Should a runtime setter be able to *degrade* instead of throw?** Raised by a consumer on
   2026-09-07 with the task 57 report: the host had saved the hidden column in *its own* browser
   storage, so the throw came back on every reload and a regular user had no way out short of
   clearing site data in dev tools. `plan-done-01.md` decision 15 draws the line today: host input
   throws (a typo in `setFilters` is a bug the author can fix), *stored* input — `persistFilters` —
   is validated one filter at a time and dropped with a warning. That leniency is **not in play
   here**: the host keeps the grid state in its own storage and never uses `persistFilters`, so
   the state arrives as ordinary setter input and nothing on the library's restore path is
   involved. The only lever the library has is what a setter does with input it cannot use.
   Task 57 removes this particular cause; the question is whether the class of failure should
   stay reachable. If
   it is taken up, the shape most in keeping with the library: `create()` stays strict; the
   runtime setters and `setOptions` gain an opt-in, e.g. `onError: (error: AVGridError) => void`
   — when set, a setter that would throw calls it, drops the offending entries (a filter or a sort
   level naming an unknown column) the way the stored-filter restore does, warns, and keeps the
   grid standing; when unset, nothing changes. The React wrapper would surface it as a prop on
   lane 2. Not committed — ask before adding.
