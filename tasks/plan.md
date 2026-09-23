# av-grid — Implementation Plan 20: no open tasks

**Phases 1–23 have shipped, through 2.12.1 (2026-09-24).** This plan holds the standing rules and
the open questions, and is where the next task is written. **Before starting anything, read the
decision logs in `plan-done-01.md` … `plan-done-19.md`** — every one of them still applies.

## Ground rules (standing, carried forward)

- Everything is additive; ships as a **minor** version per [`docs/releasing.md`](../docs/releasing.md)
  — unless a phase holds only a defect fix with no new surface, which ships as a **patch**.
- The core stays dependency-free; every new option reaches the React wrapper through lane 3 (or
  lane 2 for a callback) — verify by test.
- Design the API before implementing it; measure, don't assume (benchmark row per render-path
  change); verify in a browser, not only in tests.
- No consumer names in this repo.
- **Ask before adding a feature** that is not in this plan or in [`goal.md`](goal.md#scope).

## Task tracker

| # | Task | Status |
|---|------|--------|
| 1–65 | Phases 1–23 | see `plan-done-01.md` … `plan-done-19.md` — ✅ Done |

## Decision log

| Decision | Why | Cost / notes |
|---|---|---|
| *(none yet)* | | |

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
5. **A tree *row engine* in the library?** Raised with task 59 (2026-09-08) and deliberately left
   out of it. Task 59 draws the tree; the host derives the visible rows from its own `expanded`
   state, which keeps *"the host owns the row set"* intact. Lifting the engine — hierarchical input
   (`children` or a parent key), an owned `expanded` map, `expandAll` / `collapseAll`, sort within
   siblings, ancestor-retaining filters — would be a phase of its own and would have to decide
   tree-aware sort and filter semantics for every consumer. Persephone's `TreeModel` is the
   reference if it is taken up. The signal to take it up: a second consumer writing the same
   thirty lines. Not committed — ask before adding.
6. **A `title` hook on data cells?** Raised with task 61 (2026-09-11). Nothing in the public surface
   sets a native tooltip on a data cell — `cellClass` / `onCellClass` give classes, `render` gives
   contents — so a host that wants one has no way to ask. If added, it lands on the same line as
   task 61's `removeAttribute("title")` and the fix becomes *set or remove*, exactly as the header
   does it. Not asked for — ask before adding.
