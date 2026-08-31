# av-grid — Implementation Plan 08: host-owned filtering and sorting, and a built-in text filter (tasks 51–52)

**Phase 12 — done, shipped as 2.7.0.** Two tasks, requested by the author on 2026-08-31 after a
consumer measured its own screen against the library: a grid whose rows arrive already filtered and
sorted by the server, over a dataset far too wide and too tall to load. Both tasks are additive and
shipped together as **2.7.0** the same day. The four review-resolution rows in the decision log
were folded in before implementation, resolved in the direction the author set: useful to an
agent first.

> This file replaces the empty phase-12 placeholder. Nothing was archived, because nothing was
> committed there — but the shipped **loan ledger** patch it recorded is carried into the decision
> log below rather than dropped with the placeholder.

**Before starting either task, read the decision logs in `plan-done-01.md` … `plan-done-07.md`** —
every one of them still applies. The entries that bear directly on this phase:

- **`onGetOptions` keeps its `search` parameter even though the built-in implementation ignores
  it** (plan 01, decision 14a) — the door was left open deliberately for "a host with a million
  rows", and this phase is that host walking through it. Nothing about `onGetOptions` needs to
  change.
- **Custom filter types are the extension point, not more built-in arms** (goal.md, v1.1). Task 52
  deliberately adds one built-in arm anyway; the reasoning is in its section and in the decision
  log, so it does not read as ignorance of that rule.
- **Every piece of grid state is an option, so every piece of it is a prop**, and every setter
  guards on value so a host can echo it straight back (phase 11). Both new options are plain
  options and inherit that; neither is state.

## Is this the "server-side data model" that `goal.md` rules out?

No, and the distinction is worth stating because the next agent to read
[`goal.md`](goal.md#scope) will find `server-side data models` in the non-goals list and wonder.

A server-side data model means the **grid** owns the conversation: it pages, it fetches on scroll,
it holds a row count it has never seen rows for, and virtualization becomes a network protocol.
That is still a non-goal, and nothing here moves toward it.

Task 51 is the opposite direction: it lets the grid **do less**. The host hands it a complete
`rows` array, exactly as today, and asks it not to filter or sort that array — because something
upstream already did. There is no fetching, no paging, no unloaded region, no row the grid has not
been given. Every measurement in [`capabilities.md`](../docs/capabilities.md) still describes the
same engine over the same in-memory array.

## Ground rules (standing, carried forward)

- Everything is additive; ships as a **minor** version per [`docs/releasing.md`](../docs/releasing.md).
- The core stays dependency-free; every new option reaches the React wrapper through lane 3 —
  verify by test.
- Design the API before implementing it; measure, don't assume (benchmark row per render-path
  change); verify in a browser, not only in tests.
- No consumer names in this repo.
- **Ask before adding a feature** that is not in this plan or in [`goal.md`](goal.md#scope).

## Task 51 — `externalFilter` / `externalSort`: the host owns the row set

```js
AVGrid.create(el, {
    rows,                                  // already filtered and sorted by the server
    externalFilter: true,                  // don't test rows against `filters`
    externalSort: true,                    // don't reorder rows
    filterBar: true,
    onFiltersChange: (filters) => reload({ filters }),   // the round trip is the host's
    onSortChange: (sort) => reload({ sort }),
    onGetOptions: async (columns, filters, columnKey, search) =>
        (await fetch(`/values/${columnKey}?q=${search ?? ""}`)).json(),
});
```

**Two flat booleans, both default `false`.** Flat because that is this API's shape already
(`multiSort`, `filterBar`, `disableFiltering`), and separate because the two halves are genuinely
independent: a grid may sort a loaded page locally while filtering server-side, and a grid with a
server-ordered report may filter what it has.

### What each one changes — and it is deliberately almost nothing

| | `externalFilter: true` | `externalSort: true` |
|---|---|---|
| **Skipped** | the `filters` test in the row pass | the reorder in the row pass |
| **Unchanged** | funnels, popovers, custom filter types, the cascade, chips, the bar, persistence, `onFiltersChange`, `isFiltered`, `applyFilter`/`setFilters`/`clearFilters` | header arrows, position numbers, `aria-sort`, the click and Ctrl/Cmd+click gestures, `multiSort`, `onSortChange`, `getSort`/`setSort` |
| **Unused by the grid** | `FilterDefinition.match` | `Column.sortValue`, `Column.rowCompare` |

The whole change is a guard in `RowsModel.filter` and `RowsModel.sort`
(`src/model/RowsModel.ts:106-108, 128`). `gridUtils.filterRows` keeps its signature and its
early-out; the option is read in the model, not threaded into the utility, so nothing that calls
`filterRows` for another purpose is affected.

### The five details that are the actual work

- **`FilterDefinition.match` becomes optional when `externalFilter` is on.** A required
  `match: () => true` on every column is exactly the awkwardness the design-the-API-first rule
  exists to catch. `match` stays required otherwise, and the existing "missing field throws,
  naming the column and the field" error keeps firing — conditioned on the option, which the grid
  knows at `create()` and the definition object does not.
- **`onGetOptions` becomes the only sensible source of options, and the docs must say so.** The
  built-in checklist computes distinct values from the loaded rows, which under `externalFilter`
  are one server-filtered page — so a checklist built from them offers the values the user can
  already see, which is the confusing case this whole feature exists to remove. Not enforced (a
  boolean column's two values are correct from the page, and a warning per popover would be
  noise), stated once, plainly, next to the option.
- **A search box is not part of this task.** `searchString` is a local row filter and stays one;
  a host searching server-side passes its words to **`highlightString`** instead, which marks and
  filters nothing. That pairing already works and needs no flag — do not add `externalSearch` for
  symmetry.
- **`setOptions` must handle both keys explicitly**, so toggling one at runtime re-runs the row
  pipeline rather than being diffed into `rest` and forgotten (`src/AVGrid.ts:909, 923`). One test
  per key: turn it on with filters applied, assert the row count changes; turn it off, assert it
  changes back.
- **The editing freeze is unaffected, and there is a test to prove it.** A filter change still
  calls `refilterRows` to end an editing freeze (`src/model/FiltersModel.ts:457-459`); with the
  guard in place that pass simply keeps every row. The insert-order hold
  (`docs/api.md:978`) becomes a no-op path rather than a behaviour — nothing can sort away when
  nothing sorts.

### Verification

- Unit: each flag on/off × (filters applied / sort applied), including `multiSort`; a custom
  filter definition with no `match` accepted under the flag and rejected without it; the
  `setOptions` toggle both ways; the React round trip through lane 3.
- Board: `CustomizationBoard` case `measureExternalData` — apply a filter, assert the chip appears
  and the row set does **not** change; assert the callback fired with the normalized list.
- Benchmark: 100,000 rows with three filters applied, `externalFilter` off vs on. This is not a
  render-path change, so no regression is expected in the gate; append the row anyway, because the
  recompute cost is the number this task claims to remove.
- Browser: open the board and look. A chip with an unchanged row set is precisely the state that
  looks broken, so it must look deliberate — that is what the filter bar is for.

## Task 52 — a built-in `"text"` filter type

```js
AVGrid.create(el, {
    rows,
    columns: [
        { key: "name", filterType: "text" },     // input + contains | equals | starts with
        { key: "status" },                       // unchanged: the options checklist
    ],
    filterBar: true,
});
```

Author's design, 2026-08-31: **one text input and three switches — `contains`, `equals`,
`starts with` — with `contains` the default.** Three is the whole set; `endsWith`, negation and
regex wait for something to ask.

- **The value** is JSON, so persistence needs no `serialize`:

  ```ts
  interface TextFilterValue { op: "contains" | "equals" | "startsWith"; text: string }
  ```

  A host building a server predicate reads `op` and `text` and nothing else — that shape is public
  surface, so keep it free of anything derived.
- **Empty text removes the filter** — the existing nullish rule, so Apply on an empty body is
  Clear, exactly like the checklist.
- **The chip** reads `Name: contains smith`, with the operator word spelled as the switch is
  labelled (`starts with`, not `startsWith`).
- **It filters locally too, and that is the point.** `match` is case-insensitive against the same
  value the checklist resolves — `formatValue` → `row[key]` (`docs/api.md:609`) — so
  `filterType: "text"` is a complete filter on an ordinary in-memory grid, not a stub that only
  means something to a server. That is what makes it a legitimate built-in rather than a hook
  shaped for one consumer.
- **Per-row cost.** `match` runs once per row per pass, so the needle must not be lowercased
  per row. Do **not** put a derived `textLower` in the value — it would leak into persistence and
  into what a host reads. Use a one-entry memo keyed on the value object's identity, resolved on
  first `match` of a pass. Measure it: the built-in options test is the bar to stay under.
- **`filterType` widens to `"options" | "text" | null`**, and `FilterType` with it. Precedence is
  unchanged and unambiguous: `column.filter` (a definition) wins over `filterType`; a filter whose
  `type` names neither is still rejected.
- **Keyboard**: Alt+↓ opens the popover with focus in the input (`FilterBody.focus` defaults to
  the first control, so the input comes first in the DOM). The switches are a radio group with an
  accessible group label; Enter applies.
- **Where it lives**: a `TextFilterContent` beside `OptionsFilterContent` in `src/view/`, reached
  through the popover's existing dispatch point — the same seam custom definitions use, so no new
  branching in `FilterPopover`.

### Verification

- Unit: each operator, case-insensitivity, empty text clears, a `formatValue` column filtered by
  its displayed text, persistence round trip, the chip label, rejection of an unknown `type`.
- Board: `CustomizationBoard` case `measureTextFilter` — three claims, one per operator.
- Benchmark: 100,000 rows, one text filter per operator, against the options filter on the same
  column.

## Deliverables for the phase

- `docs/api.md` — the two options in *Sorting and filtering*; a *Host-owned filtering and sorting*
  section under Filtering; `"text"` in the filter-type list with its value shape; the
  `onGetOptions` note; the `match`-optional rule.
- `docs/react-api.md` — both options are lane 3; no new prop shape.
- `docs/capabilities.md` — one line per subsystem, with the measured numbers.
- `examples/15-external-data.html` — a fake async source, a text filter, chips, and a visible
  "the server did this" line so the example teaches the failure mode it prevents.
- `tasks/benchmark-results.md` — the rows named above.
- Release **2.7.0** per [`docs/releasing.md`](../docs/releasing.md).

## Task tracker

| # | Task | Status |
|---|------|--------|
| 1–50 | Phases 1–11 | see `plan-done-01.md` … `plan-done-07.md` — ✅ Done |
| — | The loan ledger: reclaim pool cells rendered by a superseded recompute (found by a consumer, shipped as a patch) | ✅ Done |
| 51 | `externalFilter` / `externalSort` — the host owns the row set | ✅ Done |
| 52 | Built-in `"text"` filter type (contains / equals / starts with) | ✅ Done |
| — | Docs, `examples/15-external-data.html`, board cases, benchmark rows, release **2.7.0** | ✅ Done |

## Open questions carried forward

1. **Header focus** — a keyboard-focusable header row would close the one named accessibility
   gap (sorting has no keyboard binding — Ctrl+click for multi-sort is a pointer gesture too)
   and would give group cells a keyboard story. Design them together when a consumer asks.
2. **Group collapse** — stays a consumer job via `hidden` + `setColumns` until a real screen
   proves otherwise (answered in plan 06, restated so it is not re-litigated).
3. **`--avg-*` on `:root`** — the standing theming question from CLAUDE.md, still open, still not
   urgent.

## Open questions raised by this phase

4. **Does a host-owned grid want to show that a reload is in flight?** Today the host draws its
   own overlay. A `loading: true` option that dims the rows and keeps the header live is the
   obvious next ask, and it is deliberately **not** in this phase: a filter round trip is the
   first time the grid's own gesture starts something slow, so let a real screen say what it
   needs before inventing it.
5. **Range filters — number and date — as built-in types.** `docs/api.md` already teaches a date
   range as *the* custom-filter example, which is evidence both that it is wanted and that the
   extension point suffices. If task 52's built-in arm proves itself, these are the next
   candidates; if consumers keep writing subtly different ranges, that is the argument for
   adopting them.

## Decision log

| Decision | Why | Cost / notes |
|---|---|---|
| Two flat booleans, `externalFilter` and `externalSort`, rather than one `externalData: {…}` object | Matches the shape of every other switch here (`multiSort`, `filterBar`), and the two are independently useful — a locally sorted page over a server-filtered set is a real configuration | An object would also invite `externalSearch` as a third field, which would be wrong (see below) |
| No `externalSearch` | `searchString` is a local row filter by definition; a host searching server-side already has the right tool in `highlightString`, which marks without filtering. Adding the flag would give two ways to spell one thing | Stated in the plan so it is not added later for symmetry |
| `FilterDefinition.match` optional only under `externalFilter` | `match: () => true` on every column is the workaround this task removes; leaving `match` unconditionally required would leave it half-removed | The validation moves from the definition to `create()`, which is the only place that knows the option |
| The guard lives in `RowsModel`, not in `gridUtils.filterRows` | `filterRows` is a pure utility with other callers and its own early-out; the policy belongs to the model that owns the pipeline | One-line change in each of two methods |
| `"text"` becomes a built-in filter type, reversing "custom filter types are the extension point, not more built-in arms" | A text filter is not a domain type like a slider or a tag picker — it is the *other* general answer to "filter this column", and the one every host with a high-cardinality column writes. Three operators cover it; leaving it out means each consumer re-implements the same popover, slightly differently, and none of them get the keyboard and chip behaviour right for free | The reversal is bounded: `endsWith`, negation and regex stay out, and ranges stay custom until asked (open question 5) |
| `contains` is the default operator | It is what a user typing into a filter box means, and it is the only operator that is useful before you know the data | Author's call |
| The lowercased needle is resolved once per pass in `filterRows`' own `ResolvedFilter`, not stored in the value | The value is public surface a host reads to build a predicate, and it is persisted; a derived field there would outlive its purpose. The pass already resolves each filter's column once — the needle rides along, so there is no memo to invalidate | Zero per-row cost by construction |
| **(Review resolution)** `setOptions({ externalFilter: false })` re-validates the columns in effect and throws — naming the column — when a `match`-less definition would be left filtering nothing | The `create()`-time check alone leaves a hole: accept a `match`-less definition under the flag, toggle the flag off at runtime, and the definition silently keeps every row. An agent is best served by a loud, actionable error at the moment of the mistake | The validation runs against `options.columns ??` the current set, so swapping the columns and the flag in one call is judged on what will actually be in effect |
| **(Review resolution)** `FilterDefinition.match` becomes `match?:` in the *type* for everyone; required-ness is enforced at runtime | TypeScript cannot condition a field on a runtime option. The compile-time loss is accepted: the runtime error names the column and the field, which for an agent is as good as a type error and arrives with more context | A vanilla consumer omitting `match` now fails at `create()` instead of at compile time — deliberate, not overlooked |
| **(Review resolution)** The `externalFilter` docs name the checklist's exact failure: server-filtered rows have a column's **own** filter baked in, so the cascade's excluded-own-filter rule cannot work and the checklist offers only surviving values | The generic "options may be stale" warning would not tell an agent *why* its checklist cannot re-widen; the specific mechanism does | Stated in `docs/api.md` next to the option; not enforced (a boolean column's page-derived values are still correct) |
| **(Review resolution)** The text filter matches the **search box's** text: `formatValue` → `displayFormat` → `row[key]`, `String()`-coerced, case-insensitive; nullish never matches | One consistent rule an agent already knows beats a new one; "filters by the text you can see" is also the only rule a user can predict for a date or formatted column | Documented in the consumers-of-a-cell table in `docs/api.md`; `equals` compares the whole displayed string |
| **(Review resolution)** A bare string is accepted as a text filter's `value` and normalized to `{ op: "contains", text }`; the input's text is trimmed and empty text normalizes to no filter | Mirrors the options filter's bare-value normalization — the shortest thing an agent writes should work; a trailing space silently failing `equals` is the agent-hostile case | `getFilters()` always hands back the normalized `{ op, text }` shape |
| **(Author, mid-implementation)** The text popover's operators are a horizontal row of **chips** under a full-width input (space-between), not a vertical radio list | The author asked for it after seeing the first cut live; chips read faster in a 260 px popover and the input deserves the full width | The chips are buttons wearing radio semantics — `role="radiogroup"` / `role="radio"` / `aria-checked`, roving tabindex, arrow keys cycle — so a screen reader hears the same one-of-three the radios said. Found live on the board first: a host page's own `input { width }` rule had stretched the radios to 120 px, which is also why the grid's stylesheet now pins the input's `box-sizing` |
| The board benchmark's three-filter set must actually intersect | The first measurement run combined `priority: critical` (every 4th row) with `task contains "release"` (a *different* every-4th row) — 0 rows kept, a meaningless "localRows". The timing was still honest (the pass visits every row either way), but the row count in the results must describe a real screen | Re-measured with `contains "review"` (25,000 kept). A note so the next measurement doesn't repeat it |
| **Carried from the placeholder plan (already shipped as a patch):** the pool's `recycle` is wrapped in a loan ledger (`acquireCell` records, `reclaimLoaned(active)` at the end of `paint()` re-parks what the painted info did not claim) | `renderCell` runs during the model's *recompute*, and a frame can hold more than one — two scroll events, or two state writes in separate microtasks. Only the last render info is painted; the dropped pass's cells came out of the pool, and with `keepCellsAttached` a pooled cell is still an un-hidden child of its region that was never in `attached`, so no `syncRegion` can ever evict it — stale rows on screen for the life of the grid | Found by a consumer's file tree (lazy loads + expand/collapse make two recomputes per frame easy), diagnosed by its agent: the signature is `data-avg-pooled` **and** `data-row` on one element, a combination `evictCell`/`admitCell` make impossible on the normal path. The ledger also reclaims a cell a renderer takes with `recycle()` and drops. `onCellReleased` can now fire twice with no attach between — `MeasuredRowGrid`'s handler is idempotent, and any future listener must be too. Gate unmoved (1.8 ms / 0.96× / 60 fps / 0) |
