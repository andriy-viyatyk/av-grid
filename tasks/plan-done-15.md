# av-grid — Implementation Plan 15 (done): phase 19, a recycled cell's stale attributes

**Phases 1–18 have shipped, through 2.11.0 (2026-09-09).** This plan holds the standing rules, the
open questions, and **phase 19 — task 61, the `title` and `aria-sort` a data cell inherits from a
header cell** (reported by a consumer 2026-09-11; **shipped as 2.11.1 on 2026-09-11**). **Before starting anything, read the decision
logs in `plan-done-01.md` … `plan-done-14.md`** — every one of them still applies.

Task 61 is a defect with no new surface — a **patch**. It is two `removeAttribute` calls and a `draggable` reset (found in review — see the decision log), and the
reason it is written up at length is that the *class* of bug is the one the pool's own contract
warns about, the renderers already guard against it once (`data-row` on a footer cell), and the
next attribute added to `HeaderCell` will reintroduce it unless the asymmetry is named.

## Ground rules (standing, carried forward)

- Everything is additive; ships as a **minor** version per [`docs/releasing.md`](../docs/releasing.md)
  — unless a phase holds only a defect fix with no new surface, which ships as a **patch**.
- The core stays dependency-free; every new option reaches the React wrapper through lane 3 (or
  lane 2 for a callback) — verify by test.
- Design the API before implementing it; measure, don't assume (benchmark row per render-path
  change); verify in a browser, not only in tests.
- No consumer names in this repo.
- **Ask before adding a feature** that is not in this plan or in [`goal.md`](goal.md#scope).




## Task 61 — a recycled cell keeps the header's `title` and `aria-sort`

**The report** (a consumer, 2026-09-11). Hovering a data cell shows a **native browser tooltip
naming something unrelated to that cell** — on a pivot-style screen, a cell reading `1,102` with a
`631/6,869` sub-line showed `Total`. It happens on more than one screen and reads as random: some
cells have it, most do not, and which ones changes as the grid is scrolled and reloaded. The
consumer's own guess in the report was *"some uncleared value from a reused cell"*, and that is
exactly what it is.

### The cause — one attribute the data cell does not overwrite

Three facts that are each correct alone:

1. **`CellPool.release()` does not reset the element.** Its own doc says so and says why: *"It
   arrives at its next occupant with the same children, classes, attributes and event listeners it
   had before. Wiping it would throw away the inner structure, which is most of what makes reuse
   worth doing — so a cell renderer that recycles is responsible for overwriting everything it
   sets."*
2. **Header cells and data cells share that one pool.** `RenderGrid` holds a single `CellPool` and
   hands the same `acquireCell` to every region; no reuse key is stamped anywhere, so there is one
   untagged bucket. `HeaderCell.ts` states the consequence outright — *"the pool is shared with
   data cells, whose children are laid out differently"* — and handles it, rebuilding its inner
   structure whenever the element it was handed is not already a header cell.
3. **`HeaderCell.ts:159` sets `el.title`**, and removes it on both of its other arms
   (`:162`, `:166`), so a header cell is never stale *as a header cell*.

**`DataCell.ts` never mentions `title`.** `renderDataCell` assembles `className` from scratch (with
a comment saying precisely why: *"pooled cells arrive holding their last occupant's classes"*) and
stamps `data-type`, `data-row`, `data-col`, `data-column-key`, `role`, `aria-rowindex` and
`aria-colindex` — every attribute it sets, overwritten every paint. `title` is not one of them,
because a data cell has no use for one; so a pooled header element hands its `title` to the data
cell that takes it, and nothing ever clears it. The tooltip is the column name of whatever column's
header last released that element.

`Total` is the string the consumer noticed because it is the one header name on that screen
unrelated to any cell's value — a trailing totals column. Every other leak names a real column and
reads as plausible, which is why this went unreported for so long.

**A second attribute leaks the same way: `aria-sort`.** The header sets it at `:134` and clears it
at `:151`; the data cell never touches it, so a recycled cell can carry
`role="gridcell" aria-sort="ascending"` — invalid, and announced.

**Three more header attributes do not matter, and the task should not touch them.** `data-sort`,
`data-resizable` and `data-pinned` also survive the recycle, but every stylesheet rule reading them
is qualified `.avg-header-cell[data-…]`, so on a data cell they are inert. Listed here so the next
reader does not have to re-derive it — and as the reason the fix is two lines rather than five.

**Direction matters: only header → data leaks.** `renderHeaderCell` sets or removes `title` on all
three of its arms, and `build()` clears `textContent` and `style` when it adopts a foreign element,
so a data cell recycled into the header is already clean.

### The fix

In `DataCell.ts`, beside the attribute block each renderer already has:

```ts
el.removeAttribute("title");
el.removeAttribute("aria-sort");
if (el.draggable) el.draggable = false;   // added in review, 2026-09-11 — see the decision log
```

as one helper, `clearForeignHeaderState(el)`, called from **`renderDataCell`** and **`renderFooterCell`** — the footer takes from the same pool and has
no `title` of its own either.

**There is precedent in the file for exactly this shape.** `renderFooterCell` already ends with
`el.removeAttribute("data-row")` under the comment *"A pooled element may arrive carrying a data
cell's row — a footer cell stands for no data coordinate, and a stale `data-row` would make it one
to every selector."* That is the same defect one attribute over, already found once. Write the new
comment so the rule generalizes rather than describing only these two attributes: **an attribute
set by any renderer that draws from the pool must be set or removed by every other renderer that
draws from it.**

**Rejected: clearing in `CellPool.release()`.** It would have to enumerate the attributes anyway,
it would put renderer knowledge in the pool, and it contradicts the pool's stated contract — the
thing that makes recycling worth doing is that the element arrives intact.

**Rejected: a reuse key separating headers from data cells.** It would fix this instance at the
cost of a pool miss (a `createElement` plus a full `build()`) every time the header repaints, and
it would leave the underlying asymmetry in place for the next shared-pool pair.

**Consider, and decide in the task: should a data cell be able to HAVE a `title`?** Nothing in the
public surface sets one today — `cellClass` / `onCellClass` give classes, and `render` gives
contents, so a host that wants a native tooltip on a cell has no way to ask for it and no way to
work around this defect either. If a `title` hook is ever added, it lands on the same line as the
`removeAttribute` and the fix becomes *set or remove*, exactly as the header does it. Not part of
this task — ask before adding.

### Verification

- Unit: acquire an element as a header cell for a column named `Total`, release it, render a data
  cell into it — the element has **no** `title` attribute. The test has to go through the pool,
  not call `renderDataCell` on a hand-built element, or it asserts nothing about the bug.
- Unit: the same for `aria-sort` — a sorted column's header recycled into a data cell leaves no
  `aria-sort` on a `role="gridcell"`.
- Unit: the same two for `renderFooterCell`.
- Unit: the reverse direction stays clean — a data cell recycled into a header cell gets the
  header's own `title`, and a header whose `headerRender` returns markup has none.
- Unit: a header cell that is *not* recycled still carries its `title` — the guard against fixing
  this by clearing too widely.
- Board: horizontal scroll on a grid wide enough to virtualize columns, with a distinctive
  right-most column name, then hover the body. This is the consumer's repro and the only check
  that exercises real eviction; happy-dom will not produce it.
- Benchmark: a row on the render path. Two `removeAttribute` calls per painted cell on attributes
  that are usually absent — expected to be unmeasurable, but the ground rule is measure, don't
  assume.

### Deliverables

- `src/view/DataCell.ts` — the two calls in both renderers, with the generalized comment.
- `src/render/CellPool.ts` — extend the *reuse contract* doc block: name the header/data pair as
  the shared-pool case that exists today, and state the rule as an obligation on renderers.
- `docs/` — nothing to change: no public surface moves. There is no changelog file — the GitHub
  release notes are generated from commit titles — so the symptom (a stale native tooltip on a data
  cell) goes in the commit title, since that is what a reader will be searching for.
- Release as a **patch** — defect fix, no new surface. A consumer is waiting on the bump.


## Task tracker

| # | Task | Status |
|---|------|--------|
| 1–60 | Phases 1–18 | see `plan-done-01.md` … `plan-done-14.md` — ✅ Done |
| 61 | Phase 19 — a recycled cell keeps the header's `title` and `aria-sort` | ✅ Done — 2.11.1 |

## Decision log

| Decision | Why | Cost / notes |
|---|---|---|
| **61: `draggable` is the third leaked header state, and it is reset too** | The task text listed `data-sort` / `data-resizable` / `data-pinned` as inert and missed `el.draggable = true`, which `HeaderCell` sets on every reorderable column and no data renderer resets. It is mostly harmless in practice — the data cell's `pointerdown` calls `preventDefault`, which stops a native drag starting, and the root `dragstart` handler cancels any drag not on a header — but it is the same class of leak and changes the accessibility tree. On the board's repro **every** cell with a stale title was also `draggable` (38 of 574) | `if (el.draggable) el.draggable = false` — a property read on the hot path, no attribute write when already false |
| **61: one helper, `clearForeignHeaderState(el)`, not two inline blocks** | Two renderers, one rule — the comment that states the rule (*an attribute set by any renderer that draws from the pool must be set or removed by every other renderer that draws from it*) lives once, beside the list of what is deliberately left | The footer keeps its own `removeAttribute("data-row")` beside the call — that one is the data cell's attribute, not the header's |
| **61: the tests drive `CellPool` directly** — header rendered, `release()`d, then `renderDataCell` / `renderFooterCell` with `recycle: pool.acquire` | Asserting on a hand-built element says nothing about the bug; going through the real grid would depend on happy-dom's layout-free eviction. Removing the fix fails exactly the two forward-direction tests and no other | The params object is cast — the renderers read only `row`, `col`, `style`, `previous`, `recycle` |
| **61: no changelog file exists** — the symptom goes in the commit title | Release notes are `--generate-notes` from commits (`docs/releasing.md`) | The plan text said "changelog"; corrected in place |

## Open questions

The five open questions this plan carried move forward unchanged to [`plan.md`](plan.md). None is
committed. Task 61 raised one more, recorded there as question 6: whether a data cell should be
able to *have* a `title` (a host tooltip hook) — nothing public sets one today.
