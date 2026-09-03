# av-grid — Implementation Plan 11: phase 15

**Phase 15.** Phases 1–14 are done and shipped through **2.9.0**. Nothing is committed here yet.
**Before starting any task, read the decision logs in `plan-done-01.md` … `plan-done-10.md`** —
every one of them still applies.

## Ground rules (standing, carried forward)

- Everything is additive; ships as a **minor** version per [`docs/releasing.md`](../docs/releasing.md).
- The core stays dependency-free; every new option reaches the React wrapper through lane 3 (or
  lane 2 for a callback) — verify by test.
- Design the API before implementing it; measure, don't assume (benchmark row per render-path
  change); verify in a browser, not only in tests.
- No consumer names in this repo.
- **Ask before adding a feature** that is not in this plan or in [`goal.md`](goal.md#scope).

## Task tracker

| # | Task | Status |
|---|------|--------|
| 1–55 | Phases 1–14 | see `plan-done-01.md` … `plan-done-10.md` — ✅ Done |

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
