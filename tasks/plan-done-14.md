# av-grid — Implementation Plan 14 (done): phase 18, `headerHeight`

**Phases 1–17 have shipped, through 2.10.0 (2026-09-08).** This plan holds the standing rules, the
open questions, and **phase 18 — task 60, `headerHeight`** (requested by a consumer 2026-09-09;
**shipped as 2.11.0 on 2026-09-09** after the author verified the board). **Before starting anything, read the decision logs in `plan-done-01.md` …
`plan-done-13.md`** — every one of them still applies.

Task 60 is one additive option, and the request behind it is cosmetic: a grid with tall rows gets a
header sized by the rows. What makes it more than a type widening is that **the header already
reads `rowHeight` as its own band height in two places** — so the fix is a value the group-header
renderer can read, not a per-row function passed through to the engine. The API section says why
that choice was made and what was rejected.

## Ground rules (standing, carried forward)

- Everything is additive; ships as a **minor** version per [`docs/releasing.md`](../docs/releasing.md)
  — unless a phase holds only a defect fix with no new surface, which ships as a **patch**.
- The core stays dependency-free; every new option reaches the React wrapper through lane 3 (or
  lane 2 for a callback) — verify by test.
- Design the API before implementing it; measure, don't assume (benchmark row per render-path
  change); verify in a browser, not only in tests.
- No consumer names in this repo.
- **Ask before adding a feature** that is not in this plan or in [`goal.md`](goal.md#scope).


## Task 60 — `headerHeight`: a header that does not grow with the rows

**The request** (a consumer, 2026-09-09). A pivot-style screen stacks up to three lines in a data
cell — a metric, a comparison figure, and the numerator/denominator that produced it — each of the
lower two behind its own screen option. It steps `rowHeight` as those options turn on, which is
what the library asks it to do: the option is uniform and there is no per-row variant. **The
header steps with it, and there is nothing in the header to fill the extra height** — the column
name is one line whatever the rows are doing. The consumer asked for the header's height to stay
fixed while the rows grow.

The numbers, from that screen: a 26px base row becomes 41 and then 56 as the two options come on,
and the header follows exactly. When the same screen's column layout has **two horizontal
dimensions**, `Column.group` is set, `hasGroups` flips, and row 0 doubles — so the header takes
**52 / 82 / 112px**, and at three lines a two-line header owns 112px of a screen to say two words.
The consumer's report is that it "looks not good", which is the whole defect: nothing breaks, the
header is simply sized by a number that has nothing to do with it.

**What exists today, and why the host cannot do it.** `RenderGrid` has supported a per-row
`rowHeight` function since the beginning (`ElementLength = number | ((v: number) => number |
Percent)`, `render/types.ts:30`), and row 0 **is** the header in the engine's coordinate space —
`renderCell` dispatches `p.row === 0` to `renderHeaderCell` with `stickyTop: 1` (`AVGrid.ts:314`).
So the capability is already in the layer underneath. `AVGrid` narrows it away: `rowHeight?:
number`, documented *"Uniform — variable row heights are not supported."* (`options.ts:262`,
`docs/api.md:293`).

Four things stop a host from passing a function through anyway, and only the first is a type:

1. **`validate.ts:902`** rejects it outright — *"`rowHeight` must be a positive number of pixels,
   but was …"*.
2. **`engineRowHeight()`** (`AVGrid.ts:1459`) computes `base * 2` for row 0 while groups are
   shown. Handed a function, that is `NaN`.
3. **`HeaderCell.ts:196`** reads `model.options.rowHeight` as the **band** height, to offset a
   grouped column's header into the lower half of the doubled row 0.
4. **`GroupHeader.ts:104`** reads it the same way, as the height of the band it draws.

Items 3 and 4 are the finding that shapes this task: **the header already treats `rowHeight` as
"the header band's own height"** in its internal two-row split. So a per-row function passed
cleanly to the engine would still not fix the header — those two readers would keep computing the
band from the data row height, and the group label and the leaf header would overlap or leave a
gap of exactly `band − rowHeight`. Whatever the API, those two readers have to change.

### The API — a second height, not a function

**`headerHeight?: number` on `AVGridOptions`, defaulting to `rowHeight`.** Chosen over widening
`rowHeight` to `ElementLength`, for three reasons:

- **It gives items 3 and 4 the number they actually wanted.** `rowHeight` keeps meaning what its
  doc says, and the band's height becomes a value rather than an assumption.
- **A function would leak the engine's row space into host code.** Every caller would have to know
  that render row 0 is the header and `row > rows.length` is a footer — an internal convention.
  `AVGrid`'s public row space is 0-based over *data* rows everywhere else: `getRowKey`, selection,
  `focus`, filters, `scrollToRow`.
- **It would advertise variable data-row heights**, which the grid is not built for — `measured/`
  exists precisely because that is a separate problem with its own hint/measure/commit machinery
  (`docs/api.md:2814`).

**`headerHeight` is the band, not the total.** With groups shown the header is
`headerHeight * 2`, the same relationship `rowHeight` has today. The alternative — `headerHeight`
as the total, halved per band when groups appear — was rejected because it makes the same option
mean two different things depending on a column property, and because a host setting it is
answering *"how tall is a header row"*, which is the question the two band readers ask.
**Confirmed with the consumer 2026-09-09**: the total with groups is expected to be `headerHeight * 2`;
a total-height option is not wanted.

**Footers keep `rowHeight` and this task does not change that.** They are render rows
`> rows.length`, so `row === 0 ? band : rowHeight` leaves them alone by construction
(`docs/api.md:2292` is still true). A `footerHeight` has not been asked for — **confirmed with the
consumer 2026-09-09: footers stay on `rowHeight`, out of this task's scope** (a possible later ask).

### The work

1. **`headerHeight?: number`** on `AVGridOptions`, beside `rowHeight` in the Layout block.
   Validated by the same rule as `rowHeight` — positive number of pixels — mirroring the message
   at `validate.ts:902`.
2. **Do not resolve it into `ResolvedOptions`.** Its default is *another option's value*, not a
   literal, so filling it in at create time would freeze it: a later
   `setOptions({ rowHeight: 40 })` on a grid that never set `headerHeight` must move the header
   too, and an eagerly resolved copy would not. `ResolvedOptions` is "every option that has a
   default, with its default filled in" — a default of `rowHeight` does not qualify.
3. **One accessor, three readers** — the shape task 58 used for `reorderEnabled()`. Add
   `headerBand()` on the model = `options.headerHeight ?? options.rowHeight`, and route
   `engineRowHeight()`, `HeaderCell.ts:196` and `GroupHeader.ts:104` through it, so the three
   cannot drift and the band the renderer offsets by is the band the engine laid out.
4. **`engineRowHeight()` becomes** `row === 0 ? band * (hasGroups ? 2 : 1) : rowHeight`, with the
   identity cache keyed on `(rowHeight, band, hasGroups)` instead of `(base, groups-on)` — the
   engine detects a change by identity, so the same triple must resolve to the same function.
   **Keep returning the plain number when `band === rowHeight && !hasGroups`**, so a grid that
   never sets the option hands the engine exactly what it hands it today.
5. **`setOptions`**: re-set the engine height on `"headerHeight" in rest` as well as
   `"rowHeight" in rest` (`AVGrid.ts:1036`). **Add nothing at `AVGrid.ts:988`** — an explicit
   `headerHeight: undefined` means "back to the default", the default is "follow `rowHeight`", and
   `Object.assign` writing `undefined` is already exactly that. This is the opposite of what
   `rowHeight` needed three lines above, so say why in a comment or the next reader will "fix" it.
6. **`getState()`**: `headerHeight: number` beside `rowHeight` (`AVGrid.ts:1132`, interface at
   `:185`) — the resolved band. The snapshot is meant to be logged, and the header's height is now
   a thing that can differ from the rows'.
7. **React lane 3** — a plain option, no callback; verify by the wrapper's existing lane test.

### Verification

- Unit: `headerHeight: 26` with `rowHeight: 56` and no groups — row 0 is 26px, every data row 56px,
  and a footer row 56px.
- Unit: the same with groups shown — row 0 is **52**px, a grouped column's header is offset by 26
  and is 26 tall, an ungrouped column's header spans the whole 52, and the band `GroupHeader`
  draws is 26 tall. **This is the case that fails if items 3 and 4 keep reading `rowHeight`** — it
  is the regression net for the whole task, so assert the band's height and the leaf header's
  `top` as numbers, not just that they differ.
- Unit: unset — `engineRowHeight()` returns a **number**, and every existing row-height and
  column-group test stays green unchanged.
- Unit: `setOptions({ rowHeight })` on a grid that never set `headerHeight` moves the header;
  `setOptions({ headerHeight: undefined })` on one that did puts it back on `rowHeight`.
- Unit: identity — two calls with the same `(rowHeight, band, hasGroups)` return the same function,
  so a data change that does not touch either height is not a geometry change.
- Unit: `setOptions({ headerHeight })` re-lays out the band — **synchronously, as it turned out**
  (corrected during implementation, 2026-09-09): a row-height change is *geometry*, and the
  engine's `setOptions` re-lays out at once, unlike a header *repaint* (task 58 item 5), which is
  deferred to the frame. The test asserts the new band on the first read.
- Unit: rejected by `validate` at `0`, a negative, a string and a function, with the `rowHeight`
  message's wording — at `create()`; `setOptions` validates neither height at runtime, and this
  task keeps that parity rather than validating one of the two.
- Board: `AVGridBoard` with tall rows — set `headerHeight` live through `window.avg`, with groups
  on and off, and watch the band and the leaf headers stay aligned. Measure the alignment the way
  the group band was measured (`measureGroups`): the leaf header's top edge against the band's
  bottom, expected 0.0px.

### Deliverables

- `docs/api.md`: the option in the options table beside `rowHeight` (`:293`), and amend
  `rowHeight`'s *"Uniform. Variable row heights are not supported."* — still true of data rows,
  no longer true of the header. The options and state interface listings (`:1407`, `:2501`). The
  column-groups section: the band is `headerHeight * 2` now. The footer note (`:2292`): footers
  keep `rowHeight`.
- `docs/capabilities.md`: the *Column groups* paragraph at `:175` states that row 0 is doubled by
  a per-row `rowHeight` function — it now doubles the header band, which is a separate option.
- `docs/react-api.md`: the prop in the lane-3 list.
- Release as a **minor** — additive surface.

## Task tracker

| # | Task | Status |
|---|------|--------|
| 1–59 | Phases 1–17 | see `plan-done-01.md` … `plan-done-13.md` — ✅ Done |
| 60 | Phase 18 — `headerHeight`: a header that does not grow with the rows | ✅ Done — 2.11.0 |

## Decision log

| Decision | Why | Cost / notes |
|---|---|---|
| **60: `headerHeight` is the band; with groups the header is `headerHeight * 2`** (consumer confirmed 2026-09-09) | The two band readers ask "how tall is a header row"; a total-height option would mean two things depending on a column property | — |
| **60: footers keep `rowHeight`** (consumer confirmed 2026-09-09) | Not asked for; footer cells mirror the data cell layout, so growing with the rows is usually right | `footerHeight` is a sibling option if ever requested |
| **60: one accessor, `AVGridModel.headerBand()`, for the three readers** — the engine's row 0, `HeaderCell`'s two-row offset, `GroupHeader`'s band | The shape task 58 used; three readers of one number cannot drift. `headerHeight` is *not* resolved into the options, because its default is `rowHeight`'s current value | The identity cache is keyed on `rowHeight:headerTotal`; a grid that sets neither still hands the engine the plain number |
| **60: the plan's "next paint frame" claim for a height change was wrong and is corrected in the task text** | A row-height change goes through the engine's `setOptions`, which re-lays out synchronously — geometry, not a deferred cell repaint. Found by the test that asserted the old value first | Recorded so the next reader does not carry task 58's deferred-paint lesson to a place it does not apply |
| **60: no runtime validation in `setOptions`** | `rowHeight` has none either; validating one height and not the other would be the surprise. Both are validated at `create()` | A `headerHeight: -1` through `setOptions` misbehaves exactly as `rowHeight: -1` does today — open question 4's territory |
| **60: the board gets *Row h* / *Header h* fields and `measureHeaderHeight()`** | The seam between the band and the leaf header is a real-layout question happy-dom cannot answer; the live-toggle path (blank field → `undefined` → follow the rows) is the React-removal path in miniature | 9 checks, seam 0.00 px at 100k |

## Open questions

The five open questions this plan carried (the popovers' control-size tokens; a grid-level
`textFilterOps` default; `textFilterLabels`; a runtime setter that degrades instead of throwing; a
tree row engine in the library) move forward unchanged to [`plan.md`](plan.md). None is committed.
A `footerHeight` sibling was noted with task 60 and not asked for.
