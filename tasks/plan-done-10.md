# av-grid — Implementation Plan 10 (done): phase 14, the empty-value text operator and `filterLabel`

**Phase 14 — done, shipped as 2.9.0 on 2026-09-03.** Phases 1–13 shipped through **2.8.0**. Two tasks,
both asked for by a consumer on 2026-09-03. **Before starting it, read the decision logs in
`plan-done-01.md` … `plan-done-09.md`** — every one of them still applies, and
[`plan-done-08.md`](plan-done-08.md) in particular: it holds the design of the `"text"` filter
type this task extends, including the four review resolutions that fixed its value shape.

## Ground rules (standing, carried forward)

- Everything is additive; ships as a **minor** version per [`docs/releasing.md`](../docs/releasing.md).
- The core stays dependency-free; every new option reaches the React wrapper through lane 3 —
  verify by test.
- Design the API before implementing it; measure, don't assume (benchmark row per render-path
  change); verify in a browser, not only in tests.
- No consumer names in this repo.
- **Ask before adding a feature** that is not in this plan or in [`goal.md`](goal.md#scope).

## Task 54 — `blank` / `notBlank` on the built-in `"text"` filter, opt-in per column

```js
AVGrid.create(el, {
    rows,
    columns: [
        { key: "name", filterType: "text" },                     // unchanged: three operators
        { key: "email", filterType: "text",
          textFilterOps: ["contains", "equals", "blank"] },       // + an "is empty" chip
    ],
});
```

**The ask.** A consumer filtering server-side needs *"this column has no value"* on a
high-cardinality text column — the population a checklist can express (it can offer a blank entry)
and a text box cannot. There is no way to reach it today: the operator list is a module constant
with no host hook, so the consumer's only route is to replace the built-in filter with a
`column.filter` of its own and re-implement the input, the chips, the roving tabindex and the chip
label to gain one operator.

**Two operators, not one.** `blank` is what was asked for; `notBlank` costs one more entry in the
same table and is what a user expects to find once *is empty* exists. Labels: **`is empty`** /
**`is not empty`** — the spreadsheet wording, and the wording a user reads as a state rather than
as a comparison.

### Opt-in, and what exactly is opt-in

**`Column.textFilterOps?: readonly TextFilterOp[]`**, defaulting to
`["contains", "equals", "startsWith"]` — so **nothing changes for any existing consumer**, and a
column that wants the new chips names them.

One option rather than a `textFilterEmptyOp` boolean, for three reasons: it turns the next
operator into one entry instead of another flag; it lets a column *remove* an operator it cannot
honour (a server predicate with no `startsWith`); and it puts the choice where `filterType`
already is, so there is no grid-option/column-option precedence to specify. A host that wants the
chips everywhere sets the field while building its columns — one line, and a consumer that builds
columns from a schema builds them in a loop anyway.

**What is opt-in is the chip, not the operator.** A `{ op: "blank" }` value set programmatically —
`setFilters`, a restored persisted filter, a host's own saved report — must **validate and match
on any text column**, whether or not that column offers the chip. Two reasons: a column's op list
can change between the day a filter was saved and the day it is restored, and a value the grid
hands out through `getFilters()` must be a value it accepts back. `textFilterOps` governs what the
popover renders and nothing else.

### The five places that assume an operator carries text

This is the whole of the work, and the reason it is not "one entry in a table". Each of these is
correct today *because* every operator needs a needle:

1. **The operator table** — gains the two entries, each marked as needing no text
   (`needsText: false`, or the equivalent once the type is written). Everything else branches on
   that marker rather than on the op name, so a third text-free operator costs nothing.
2. **`apply()`** — trims the input and emits `undefined` when it is empty, which is av-grid's
   "remove this filter" value. **As written, choosing *is empty* and pressing Apply clears the
   filter**: the control looks right and does nothing. It must emit `{ op }` with no `text` for a
   text-free operator, and keep today's behaviour for the other three. This is the one that would
   otherwise ship.
3. **The chip label** — returns `""` when the value has no `text`, so the bar would draw a chip
   with a column name and no value. It must read `Email: is empty`, the operator spelled as the
   chip is labelled, with no trailing text.
4. **The local matcher** (`filterRows`' `"text"` arm) — resolves a `needle` and skips the test when
   it is `undefined`, so **no needle narrows nothing**. The op has to be examined before that
   guard. *Empty* is the negation of the rule the filter already documents: the displayed text —
   `formatValue` → `displayFormat` → `row[key]`, `String()`-coerced — is empty **after trim**,
   which covers `null`, `undefined`, `""`, whitespace, and a value whose formatter produced
   nothing. That last case belongs in the docs: on a formatted column, *is empty* means "shows
   nothing", not "holds no value". It is the same "filters by the text you can see" rule as the
   other three operators, and the alternative — a raw-value test — would give one filter two
   notions of its own column. `notBlank` is its exact complement, so every row satisfies exactly
   one of the two.
5. **The `filters` prop validator** — its message enumerates *"(contains / equals / starts with)"*,
   and the value shape is validated as requiring `text`. Both widen: `text` becomes optional in
   `TextFilterValue`, present for the three comparing operators and absent for the two state ones.
   A `text` supplied beside `blank` is ignored rather than rejected — a host toggling the op on a
   value it is holding should not have to strip the field.

### The layout, which changes for real

`.avg-text-filter-ops` is one row, `justify-content: space-between`, in a 260px popover. Three
chips fit; five do not. Add `flex-wrap` and verify at four and five — the author's call in plan 08
was that chips read faster than a vertical radio list at that width, and a silently overflowing
row would undo it. Consider whether the two state operators belong on their own line: they are a
different kind of thing from the three comparisons, and a wrapped row puts them there anyway.

### One question this raises about the library, worth answering deliberately

**av-grid would then have two notions of "empty".** The options checklist builds `(null)` and
`(undefined)` entries, italic and distinct from each other, from the raw value. This task's
`blank` folds null, undefined, empty and whitespace together, from the displayed text. Both are
defensible alone; a host using both filter types on one grid will find them disagreeing — a column
can offer a `(null)` entry and an *is empty* chip that select different rows.

The plan's position: **leave the checklist alone and document the difference** where the two are
described. The checklist's entries are *values the data holds*, which is what makes them italic
rather than folded; the text operator is a *state of the cell*. Changing the checklist would move
behaviour consumers already depend on. But it should be a decision in the log, not something
discovered later.

### Review resolutions (2026-09-03, before implementation)

Seven points from reading the plan against the code; each is now part of the work.

1. **One operator table, not three.** The op list is spelled today in `TextFilterContent.ts`
   (`OPS`), `validate.ts` (`TEXT_FILTER_OPS`) and the label map in `FilterBar.ts`. Task 54 puts
   it once in `src/textFilterOps.ts` — `{ op, label, needsText }` — and the popover, the
   validator, the matcher and the bar all read it. A third text-free operator is then one row.
2. **The popover shows an applied op the column does not offer.** `{ op: "blank" }` is accepted
   on any text column; opened on a column with the default three chips, no chip would be pressed
   and the roving tabindex would have nothing tabbable. The body renders the column's chips
   **plus the current op's chip when it is missing**, so the user sees why the column is filtered.
3. **`TextFilterValue` becomes a discriminated union**, not a shape with `text?`: the three
   comparing ops keep `text: string`, the two state ops have none. A host narrowing on `op` keeps
   a guaranteed string; a host reading `.text` without narrowing gets a compile error, which is
   the nudge it needs — its server predicate has two new ops to handle. **Named in the release
   notes**: additive at runtime, a deliberate compile-time change for strict TypeScript hosts.
4. **Op ids stay `blank` / `notBlank`.** With task 55's `filterLabel` the wording is the host's,
   so the id is a wire format; `empty` was rejected because "empty text removes the filter" is an
   existing rule with the same word.
5. **The input while a text-free chip is pressed** stays enabled — Enter still applies from it —
   but its placeholder changes to say the text is not used, and whatever is typed is ignored.
6. **Layout**: `.avg-text-filter-ops` wraps, and the chips take `flex: 1 1 auto` so three fill
   one row and five fill two, instead of `space-between` spreading a two-chip second row to the
   edges. Verified live at three and five.
7. **`textFilterOps` is validated in `validateColumns`**: a non-empty array of known ops, no
   duplicates, and only on a column whose filter is the built-in `"text"` type — on any other
   column it would render nothing, and an agent that set it expects chips.

### Verification

- Unit: each new operator against `null`, `undefined`, `""`, whitespace, a real value, and a
  `formatValue` column whose formatter returns `""` for a present value; `notBlank` as the exact
  complement of `blank` over one row set; the chip label; Apply on *is empty* with an empty input
  **applies** rather than clears; Apply with text typed beside *is empty* stores no `text`; a
  `{ op: "blank" }` filter set through `setFilters` on a column with the default op list matches
  and round-trips through `getFilters()`; persistence round trip; `textFilterOps` renders exactly
  the named chips in the named order, and an unknown entry is rejected naming the column.
- Keyboard: arrow keys cycle the wrapped chip row in DOM order, roving tabindex intact, Enter
  applies from the input with a text-free operator selected.
- Board: `CustomizationBoard`, a case beside `measureTextFilter` — one claim per new operator, and
  one that a default column still shows three chips.
- Benchmark: 100,000 rows, `blank` and `notBlank`, against `contains` on the same column. Neither
  resolves a needle, so the expectation is at or under the `contains` row; append to
  [`benchmark-results.md`](benchmark-results.md) either way, because a per-row `String()` on a
  formatted column is the plausible regression.
- Browser: the four- and five-chip popover at 260px, and a chip in the filter bar for each.

## Task 55 — `filterLabel`: the host's word on a filter-bar chip

```js
AVGrid.create(el, {
    rows, columns, filterBar: true,
    filterLabel: (filter, column, defaultText) => {
        if (filter.type === "text" && filter.value?.op === "blank") return "has no value";
        return undefined;                       // undefined → the built-in text
    },
});
```

**The ask.** Raised beside task 54 by the same consumer, 2026-09-03: a way to override what a
chip says. Today only a custom `column.filter` definition controls its chip, through `label`; the
two built-in types hardcode `contains smith` and `open,pending (+3)`, and a host that wants other
wording — a localized "is empty", a domain word for a value — has to skip the bar and render
chips itself from `describeFilter()`.

**One grid-level callback, `filterLabel?: (filter, column, defaultText) => string | undefined`.**

- **Grid-level**, not per column: chip wording is a presentation concern that usually applies to
  the whole bar (localization is the obvious case). The `column` argument gives per-column control
  anyway, and `filter.type` / `filter.value` give per-operator control.
- **Receives the default text** — the string the bar would have shown — so a host tweaks rather
  than rebuilds, and **`undefined` keeps the default**, so a host overrides one case and inherits
  the rest. The result is used as-is: not truncated (the host chose it, the same reasoning as a
  definition's `label`), ellipsized by the chip if it still does not fit.
- **Runs for every filter type**, including custom definitions, *after* their own `label`. A
  definition's `label` is the authoring-side default; `filterLabel` is the consumer-side override
  — one hook the host writes once, whatever the column's type.
- **`describeFilter()` goes through it too**, so a host-rendered bar and the built-in bar can
  never disagree. The tooltip (`title`) uses the override when there is one: the built-in
  tooltip's job is to show what truncation cut, and an untruncated override has nothing to show.
- **Guarded** like the definition's `label` — host code on the bar's redraw path, so a throw
  warns once naming the column and falls back to the default text rather than leaving the bar
  stale.
- **React: lane 2** — it joins `CALLBACK_OPTION_KEYS`, so the wrapper installs a stable proxy and
  the newest closure fires; the exhaustiveness assertion in `options.ts` will not compile until it
  is classified, which is the point of that assertion.
- **Not covered, deliberately**: the operator chips *inside* the text popover. That is a
  `textFilterLabels` map if a consumer asks; it is a different thing (authoring the control, not
  describing a value) and is not part of this task.

### Verification

- Unit: the built-in chip shows the override for an options filter and a text filter; `undefined`
  keeps the default; the override runs after a definition's `label` and receives it as
  `defaultText`; `describeFilter()` returns the same `values` and a `title` built from it; a
  throwing `filterLabel` warns once naming the column and the chip shows the default; the chip is
  rebuilt when the override changes what it says (signature).
- React: the key is proxied like every other callback (the existing loop test covers it once the
  key is in the list); a re-rendered inline `filterLabel` is the one that fires.
- Board: `CustomizationBoard`, one claim — the chip reads what `filterLabel` returned.

## Deliverables for the phase

- `docs/api.md` — `filterLabel` in the callbacks table and under the filter bar / *drawing your own
  chips* sections (`describeFilter()` honours it); `textFilterOps` in the Column table and in the filter-type section; the widened
  `TextFilterValue` with `text` optional; the two operators in the `"text"` rules list, including
  the displayed-text reading of *empty* and the exception it makes to the existing "a nullish cell
  never matches" line; a note that the chip is opt-in but the value is always accepted; the
  checklist-vs-text difference in *empty*, stated once, where both are described.
- `docs/react-api.md` — `textFilterOps` is part of `columns`, so lane 3; `filterLabel` joins the
  lane-2 callback list.
- `docs/capabilities.md` — the filtering line gains the operator count.
- `examples/` — the text-filter example gains a column with the chips (no new file).
- `tasks/benchmark-results.md` — the rows named above.
- Release **2.9.0** per [`docs/releasing.md`](../docs/releasing.md).

## Task tracker

| # | Task | Status |
|---|------|--------|
| 1–53 | Phases 1–13 | see `plan-done-01.md` … `plan-done-09.md` — ✅ Done |
| 54 | `blank` / `notBlank` on the built-in `"text"` filter, opt-in per column via `textFilterOps` | ✅ Done — 2.9.0 |
| 55 | `filterLabel` — the host's word on a filter-bar chip, grid-level, `undefined` keeps the default | ✅ Done — 2.9.0 |

## Open questions carried forward

None recorded. The questions from plan 09's earlier revision (header focus, group collapse,
`--avg-*` on `:root`, a `loading` state, built-in range filters) were removed at a consumer's
request on 2026-09-01 — handled consumer-side; the git history and the archived logs keep them
if a future consumer re-asks.

## Open questions raised by this phase

1. **`--avg-control-h` and `--avg-radius` as tokens?** Raised by the same consumer, 2026-09-03,
   and **not committed here** — a separate ask, recorded so it is not lost. The filter popovers'
   input, search box, chips and buttons all carry class hooks (`.avg-text-filter-input`,
   `.avg-list-search`, `.avg-text-filter-op`, `.avg-button`), so a host can already restyle them;
   what it cannot do is restyle them *through tokens*, because the control padding and the 4px
   radius are literals in the stylesheet. A host whose own controls are 32px tall with an 8px
   radius therefore overrides rules rather than values — an override that breaks quietly the next
   time the library restyles its own controls. Two tokens would turn that block into two
   assignments. Against it: the stylesheet's structural values are deliberately not all
   tokenized, and every token is public surface forever.
2. **Should `textFilterOps` have a grid-level default?** Deliberately not in task 54 — a host that
   wants the chips everywhere sets the field while building columns. Worth revisiting only if a
   consumer asks with a case where that is not possible.

## Decision log

| Decision | Why | Cost / notes |
|---|---|---|
| `blank` / `notBlank` test the **displayed** text, empty after trim — not the raw value | The text filter already documents "filters by the text you can see"; a raw-value test would give one filter two notions of its own column. On a formatted column *is empty* therefore means "shows nothing" | The options checklist's `(null)` / `(undefined)` entries are left as they are — *values the data holds*, deliberately distinct — and the difference is stated once in `docs/api.md` where both are described |
| **The chips are opt-in (`Column.textFilterOps`); the operators are not** | A saved filter must restore after a column's op list changed, and a value from `getFilters()` must be a value `setFilters()` accepts | Every op validates and matches on every text column; the popover appends the applied op's chip when the list omits it, so the pressed chip and the roving tabindex always exist |
| `TextFilterValue` is a **discriminated union** on `op`, not `{ op; text?: string }` | Narrowing on `op` keeps `text: string` for the three comparing operators; a host reading `.text` unconditionally gets a compile error — the nudge it needs, since its server predicate has two new ops to handle | **A deliberate compile-time change for strict TypeScript hosts**, named in the release notes. Additive at runtime |
| Op ids `blank` / `notBlank`, labels *is empty* / *is not empty* | `empty` collides with the existing "empty text removes the filter" rule; with task 55 the wording is the host's, so the id is a wire format | Author's call after review |
| One operator table, `src/textFilterOps.ts` (`op`, `label`, `needsText`) | It was spelled three times (body, validator, bar); everything that assumed a needle now branches on `needsText`, never on the op name | A third text-free operator is one row |
| **(Live, supersedes review resolution 6)** Five chips do not wrap — the popover has an intrinsic width and widens to ~354 px on one row | Measured on the board; one row reads better than two, and the input gains the width too | `flex-wrap` stays as the safety net under a host max-width; chips are `flex: 1 1 auto` so three still fill the row, which is also why it is not `space-between` |
| `textFilterOps` validated in `validateColumns`: non-empty, known ops, no duplicates, text-filter column only | On any other column the field renders nothing, and an agent that set it expects chips | Error names the column and the operators |
| `filterLabel` is **grid-level**, runs for every filter type **after** a definition's `label`, receives the built-in text, `undefined` keeps it | Chip wording is a presentation concern for the whole bar (localization); the `column` and `filter` arguments give per-column and per-operator control anyway. Definition `label` is the authoring-side default, `filterLabel` the consumer-side override | The bar now builds every chip from `describeFilter()` — one resolver — so a host-drawn bar can never disagree with the built-in one. The override is untruncated and becomes the tooltip too |
| `filterLabel` is guarded like a definition's `label` | Host code on the bar's redraw path; a throw would leave the bar stale | Warns naming the column, shows the default text |
| `filterLabel` joins `CALLBACK_OPTION_KEYS` (React lane 2) | It is a pure callback the wrapper can proxy; `_EveryFunctionOptionIsClassified` would not compile otherwise | The existing "proxy for every key" test covers it |
| The popover's operator chips are **not** covered by `filterLabel` | Authoring a control is a different thing from describing a value; a `textFilterLabels` map is the answer if a consumer asks | Stated in the docs and the plan |
| Measured, not assumed: `blank` 2.2–3.1 ms, `notBlank` 2.4–3.1 ms vs `contains` 4.7 ms, `equals` 3.4–4.1 ms at 100,000 rows | The plausible regression was a per-row `String()` on a formatted column; it did not appear — no needle, one `trim()` per row | Row in `benchmark-results.md`; gate carried, no render-path file changed |
