# av-grid — Implementation Plan 16 (done): phase 20, a recycled cell's stale contents

**Phases 1–19 have shipped, through 2.11.1 (2026-09-11).** This plan holds the standing rules, the
open questions, and **phase 20 — task 62, the header structure a data cell inherits whole**
(reported by a consumer 2026-09-14; **shipped as 2.11.2 on 2026-09-14**). **Before starting anything, read the decision logs in
`plan-done-01.md` … `plan-done-15.md`** — every one of them still applies, and **`plan-done-15.md`
in particular**: task 62 is the same defect as task 61, one layer in.

Task 62 is a defect with no new surface — a **patch**.

## Ground rules (standing, carried forward)

- Everything is additive; ships as a **minor** version per [`docs/releasing.md`](../docs/releasing.md)
  — unless a phase holds only a defect fix with no new surface, which ships as a **patch**.
- The core stays dependency-free; every new option reaches the React wrapper through lane 3 (or
  lane 2 for a callback) — verify by test.
- Design the API before implementing it; measure, don't assume (benchmark row per render-path
  change); verify in a browser, not only in tests.
- No consumer names in this repo.
- **Ask before adding a feature** that is not in this plan or in [`goal.md`](goal.md#scope).

## Task 62 — a recycled cell keeps the header's *contents*

**The report** (a consumer, 2026-09-14). On a pivot-style screen, **two data cells in the first
visible row drew a column header instead of their value** — one reading `All`, the next `2025`,
where the rest of the row held the consumer's own multi-line metric markup. Not a stray label: the
elements held the header's entire structure. The consumer's report included the DOM, and it is the
whole diagnosis:

```html
<div class="avg-data-cell avg-align-right" data-type="data-cell"
     data-row="0" data-col="1" data-column-key="&lt;group&gt;&#x2401;2025"
     role="gridcell" aria-rowindex="2" aria-colindex="2"
     data-resizable="true" draggable="false" style="…">
  <span class="avg-sort-icon"></span>
  <span class="avg-header-title">All</span>
  <span class="avg-flex-space"></span>
  <button class="avg-filter-button" data-type="filter-button">…</button>
</div>
```

Read the attributes against the children: every attribute `renderDataCell` stamps is correct and
current — `data-type`, `data-row`, `data-col`, `data-column-key`, `role`, both ARIA indices — and
`draggable="false"` proves **task 61's `clearForeignHeaderState` ran on this very element**. The
data-cell renderer processed the element and then *skipped writing its contents*. (`data-resizable`
is the one task 61 deliberately leaves; it is inert here, as recorded.)

### The cause — two element-keyed caches that a foreign write invalidates and nothing tells

Task 61 fixed the attributes a header leaves behind. The contents are guarded by a different
mechanism, and that one has the same asymmetry:

1. `renderDataCell` keeps two `WeakMap`s on the element — `mode` (`DataCell.ts:58`, what the element
   currently holds) and `written` (`:75`, the last html string written into it). The html arm at
   `:400` is a pure cache check: `if (setMode(target, "html")) written.delete(target);` then
   `if (written.get(target) !== rendered) target.innerHTML = rendered;`.
2. **`HeaderCell.ts` touches neither map.** It rebuilds its own structure into the element it is
   handed — correctly, for itself — and both maps go on describing contents that no longer exist.
3. **`setMode` has one guard against exactly this, and `renderDataCell` erases it first.** `setMode`
   (`:118`) returns `false` — meaning *do not clear* — when `mode` matches **and**
   `el.getAttribute("data-type")` matches. That attribute is the only evidence on the element that a
   header used it — and `:340` overwrites it with `"data-cell"` sixty lines before the content
   section reads it.

So: element paints as a data cell with html `X` (`mode='html'`, `written=X`) → returns to the pool →
a header takes it and replaces its children → returns to the pool → a data cell takes it, `:340`
rewrites `data-type`, `setMode` sees `'html'` and `"data-cell"` and returns `false`, and
`written.get(el) === X` for a cell whose value renders to the same string, so **the `innerHTML`
write is skipped**. The header's children stay. Rare by construction — it needs the same element to
go data → header → data *and* the second data cell's markup to be byte-identical to the first's,
which is why it surfaces as one or two cells out of hundreds and moves around on scroll.

**Only the html-string arm is exposed.** The `null` arm is saved by `setCellText`'s
`inner.className !== TEXT_CLASS` check, which rejects `span.avg-header-title` and rebuilds; the node
arm by its own `textContent = ""`. That is luck, not design — neither was written with a foreign
occupant in mind.

`renderFooterCell` (`:534`, `:548`) has the identical hole.

### The shape of the fix

*(As planned; what was actually done, and the second defect found on the way, are in the decision
log below.)*

Read `data-type` **before** `:340` overwrites it, and when the element arrives as anything other
than this renderer's own kind, drop its `mode`, `written` *and* `treeState` (`:152` — a tree cell's
gutter record is element-keyed too and has never been tested across a foreign occupant) entries. The
natural home is `clearForeignHeaderState`, which task 61 created for this hazard and which already
runs at the right moment (`:349`, `:548`) — it would take the previous `data-type` as an argument,
and its name and doc widen from *attributes* to *everything a foreign renderer leaves*.

Worth considering instead, and deciding explicitly: whether the caches should be keyed on the
element *plus* its `data-type`, so no renderer can read another's entry at all — the same result
without every future renderer having to remember to invalidate. Task 61's conclusion was that the
asymmetry must be *named* or the next attribute reintroduces it; the same argument applies to the
next cache.

### Acceptance

- A pooled element driven data → header → data, with both data paints rendering the same html
  string, ends holding that string and no header child. Tested **through the pool**, as task 61's
  tests are — the defect is invisible to a test that renders a data cell in isolation.
- The same for footer cells, and for a tree cell recycled through a header.
- The `null` and node arms keep working (they already do — pin them, since the fix moves the code
  that saves them).
- Benchmark row: this is on the hot render path.

## Task tracker

| # | Task | Status |
|---|------|--------|
| 1–61 | Phases 1–19 | see `plan-done-01.md` … `plan-done-15.md` — ✅ Done |
| 62 | A recycled cell keeps the header's *contents* — `mode` / `written` survive a foreign occupant | ✅ Done — 2.11.2 |

## Decision log

| Decision | Why | Cost / notes |
|---|---|---|
| **62: `claim(el, kind)` at the top of both renderers, before any write** — reads `data-type`, and when it is not this renderer's kind drops `mode`, `written`, `treeState` and `aria-expanded`; then the task 61 attribute clears | The only evidence of who held the element last is the attribute the renderer is about to overwrite; `HeaderCell.ts:73` has read it first since phase 1, and the data cell now does the same. `clearForeignHeaderState` is folded in — one takeover step, one doc comment, widened from *attributes* to *everything a renderer leaves on or about an element* | One `getAttribute` per paint, which `setMode` used to spend on every call anyway; the deletes run only on a kind change |
| **62: `setMode` no longer compares `data-type`** — it trusts `mode`, because `claim()` has already invalidated it | The compare was doubly wrong: the renderer had rewritten the attribute before calling, so a header's visit was invisible (the bug); and the **tree content host carries no `data-type`**, so the compare failed on every paint and the host was emptied and its text span recreated — a `refresh()` over 16 tree cells did 48 child-list mutations, now 0. **This corrects `plan-done-13.md` decision 59's claim** that "the existing skip logic applies unchanged one level down" — it did not until now; the 1.01× gutter measurement was honest but counted gutter mutations only | The footer's `"footer-cell"` argument went with it; data ↔ footer is covered by `claim()` |
| **62: the plan's alternative — keying the caches on element + `data-type` — was rejected** | It does not work on its own: the header never writes into these maps, so a data → header → data cycle still finds the data entry. Only reading the attribute before overwriting it sees the header's visit. One mechanism, the header's, rather than a second | — |
| **62: seven tests through the pool**, including the `null` / node arms pinned, a searched (`match`) cell, a tree cell through the header, a tree cell through a footer, and **a tree cell repainted in place keeping its host and span** | The last one is the test for the second defect and failed before the change; five of the seven fail on 2.11.1 | The tree fixtures duplicate `AVGrid.test.ts`'s in miniature — the pool-driven shape needs `renderDataCell` directly |

## Open questions

The six open questions this plan carried move forward unchanged to [`plan.md`](plan.md). None is
committed.
