# av-grid — Implementation Plan 10: (no committed task)

**Phase 14 — empty.** Phases 1–13 are done and shipped through **2.8.0**; nothing is committed
here yet. The next task arrives when a consumer asks. **Before starting any task here, read the
decision logs in `plan-done-01.md` … `plan-done-09.md`** — every one of them still applies.

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
| 1–53 | Phases 1–13 | see `plan-done-01.md` … `plan-done-09.md` — ✅ Done |

## Open questions carried forward

None recorded. The questions from plan 09's earlier revision (header focus, group collapse,
`--avg-*` on `:root`, a `loading` state, built-in range filters) were removed at a consumer's
request on 2026-09-01 — handled consumer-side; the git history and the archived logs keep them
if a future consumer re-asks.
