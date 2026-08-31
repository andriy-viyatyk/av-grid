# av-grid — Implementation Plan 09: (no committed task)

**Phase 13 — empty.** Phases 1–12 are done and shipped through **2.7.0**; nothing is committed
here yet. The next task arrives when a consumer asks — the open questions below are the known
candidates. **Before starting any task here, read the decision logs in `plan-done-01.md` …
`plan-done-08.md`** — every one of them still applies.

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
| 1–52 | Phases 1–12 | see `plan-done-01.md` … `plan-done-08.md` — ✅ Done |

## Open questions carried forward

1. **Header focus** — a keyboard-focusable header row would close the one named accessibility
   gap (sorting has no keyboard binding — Ctrl+click for multi-sort is a pointer gesture too)
   and would give group cells a keyboard story. Design them together when a consumer asks.
2. **Group collapse** — stays a consumer job via `hidden` + `setColumns` until a real screen
   proves otherwise (answered in plan 06, restated so it is not re-litigated).
3. **`--avg-*` on `:root`** — the standing theming question from CLAUDE.md, still open, still not
   urgent.
4. **A `loading` state for a host-owned grid** (raised by plan 08) — a filter round trip is the
   first time the grid's own gesture starts something slow. Deliberately unshipped: let a real
   screen say what it needs (dim the rows? keep the header live? a spinner slot?) before
   inventing it. Today the host draws its own overlay.
5. **Range filters — number and date — as built-in types** (raised by plan 08). `docs/api.md`
   already teaches a date range as *the* custom-filter example. If consumers keep writing subtly
   different ranges, that is the argument for adopting them; the `"text"` type is the precedent
   for how a built-in arm lands.
