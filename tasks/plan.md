# av-grid — Implementation Plan 08: (no committed task)

**Phase 12 — empty.** Phases 1–11 are done and shipped through **2.6.0**; nothing is committed
here yet. The next task arrives when a consumer asks — the open questions below are the known
candidates. **Before starting any task here, read the decision logs in `plan-done-01.md` …
`plan-done-07.md`** — every one of them still applies.

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
| 1–50 | Phases 1–11 | see `plan-done-01.md` … `plan-done-07.md` — ✅ Done |
| — | The loan ledger: reclaim pool cells rendered by a superseded recompute (found by a consumer, shipped as a patch) | ✅ Done |

## Open questions carried forward

1. **Header focus** — a keyboard-focusable header row would close the one named accessibility
   gap (sorting has no keyboard binding — Ctrl+click for multi-sort is a pointer gesture too)
   and would give group cells a keyboard story. Design them together when a consumer asks.
2. **Group collapse** — stays a consumer job via `hidden` + `setColumns` until a real screen
   proves otherwise (answered in plan 06, restated so it is not re-litigated).
3. **`--avg-*` on `:root`** — the standing theming question from CLAUDE.md, still open, still not
   urgent.

## Decision log

| Decision | Why | What it cost / what to know |
|---|---|---|
| The pool's `recycle` is wrapped in a loan ledger (`acquireCell` records, `reclaimLoaned(active)` at the end of `paint()` re-parks what the painted info did not claim) | `renderCell` runs during the model's *recompute*, and a frame can hold more than one — two scroll events, or two state writes in separate microtasks. Only the last render info is painted; the dropped pass's cells came out of the pool, and with `keepCellsAttached` a pooled cell is still an un-hidden child of its region that was never in `attached`, so no `syncRegion` can ever evict it — stale rows on screen for the life of the grid | Found by a consumer's file tree (lazy loads + expand/collapse make two recomputes per frame easy), diagnosed by its agent: the signature is `data-avg-pooled` **and** `data-row` on one element, a combination `evictCell`/`admitCell` make impossible on the normal path. The ledger also reclaims a cell a renderer takes with `recycle()` and drops. `onCellReleased` can now fire twice with no attach between — `MeasuredRowGrid`'s handler is idempotent, and any future listener must be too. Gate unmoved (1.8 ms / 0.96× / 60 fps / 0) |
