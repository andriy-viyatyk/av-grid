# av-grid — Implementation Plan 07: two-level headers (tasks 47–48, carried from phase 10)

**Phase 11 — not started.** The half of phase 10 the author deferred so the engine-backed features
could ship first as 2.5.0: **`columnGroups` (task 47)**, the one feature with no engine support in
place, and **multi-column sort (task 48)**, which stays parked until a consumer's screen actually
asks for it. The full task text, design decisions and done-when lists live in
[`plan-done-06.md`](plan-done-06.md#task-47--columngroups--two-level-headers) — they were written
to be picked up intact, and nothing here restates them.

**Before starting any task here, read the decision logs in `plan-done-01.md` … `plan-done-06.md`.**
Entries from phase 10 that bear directly on this phase:

- **`syncRegion` learned about migrations** — a cell moving between sticky regions in one paint is
  a migration, not an eviction. The two-row header moves the header band's contents around; the
  active-set union in `paint()` is what makes that safe.
- **The header is `stickyTop: 1` everywhere.** Task 47's mechanical work is finding every place
  that assumes it — the corner heights, hit-testing, `scrollToRow` — and the sticky-corner case
  "a right-pinned column under a two-row header" was deliberately left in task 47's done-when.
- **Sorting has no keyboard binding** (task 49's named gap). If task 47 ever gives headers focus,
  that is the moment the gap closes — design them together, not separately.

## Ground rules (standing, carried forward)

- Everything is additive; ships as a **minor** version per [`docs/releasing.md`](../docs/releasing.md).
- The core stays dependency-free; every new option reaches the React wrapper through lane 3 —
  verify by test.
- Design the API before implementing it; measure, don't assume (benchmark row per render-path
  change); verify in a browser, not only in tests.
- No consumer names in this repo.
- **Ask before adding a feature** that is not in this plan or in [`goal.md`](goal.md#scope).

## Task tracker

| # | Task | Status |
|---|------|--------|
| 1–46, 49–50 | Phases 1–10 | see `plan-done-01.md` … `plan-done-06.md` — ✅ Done |
| 47 | `columnGroups` — two-level headers ([design](plan-done-06.md#task-47--columngroups--two-level-headers)) | ⬜ Not started |
| 48 | Multi-column sort ([design](plan-done-06.md#task-48--multi-column-sort--deferred-to-phase-11-build-only-if-a-screen-asks)) | ⏸️ Blocked — build only when a consumer's screen asks |
| — | Docs, example, board case, release | ⬜ Not started |

## Open questions carried forward

1. **Group collapse** — when groups land, collapse stays a consumer job via `hidden` +
   `setColumns` until a real screen proves otherwise (answered in plan 06, restated so it is not
   re-litigated).
2. **Header focus** — a keyboard-focusable header row would close the sorting keyboard gap and
   give task 47's group cells a keyboard story. Decide once, for both.
3. **`--avg-*` on `:root`** — the standing theming question from CLAUDE.md, still open, still not
   urgent.

## Decision log

*(Empty. Record every deliberate divergence from this plan here, with what it cost to learn.)*
