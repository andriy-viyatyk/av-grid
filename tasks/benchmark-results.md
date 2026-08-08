# Benchmark results

The performance gate from [`plan.md`](plan.md) task 5. **Re-run this after any change to the
render path** (tasks 2, 3, 4, 9, 10, 12) and append a row — a regression here is the only kind
of bug that matters for this project's purpose.

**How to run:** `npm run build:board`, open `test-boards/RenderGridTest` in Persephone, click
**Run benchmark** — or drive it headlessly with `await window.bench.runBenchmark()`.

## Machine

| | |
|---|---|
| Host | Windows 11 Enterprise 10.0.26200 |
| Runtime | Persephone board (Electron / Chromium), 100k rows × 20 columns |
| Display | 60Hz — so 60fps is the ceiling the harness can observe, not a measured limit |

## Baseline — 2026-08-08, task 5

Dataset: 100,000 rows × 20 columns, row height 24px, sticky header + sticky first column,
overscan 4 rows / 1 column. Viewport ≈ 20 rows × 12 columns rendered.

| Measure | Result | Gate | |
|---|---|---|---|
| Data generation | 27.9 ms | — | |
| **Time to first paint** | **5.6 ms** | < 100 ms | ✅ |
| Paint cost at row 100 | 1.04 ms over 40 paints | — | |
| Paint cost at row 99,000 | 1.07 ms over 40 paints | — | |
| **Flat-cost ratio (bottom ÷ top)** | **1.02×** | ≈ 1.0 | ✅ |
| Scroll from the top | 60.0 fps — median 16.7 ms, p95 17.1 ms, worst 17.3 ms | 60 fps | ✅ |
| Scroll near row 99,000 | 60.0 fps — median 16.7 ms, p95 16.9 ms, worst 17.0 ms | 60 fps | ✅ |
| **Cell allocations while scrolling** | **0** | 0 after warm-up | ✅ |
| Full repaint (`{ all: true }`) | 0.195 ms, 2 DOM mutations | — | |

**The gate passes.** The flat-cost property — the entire thesis of the project — holds: a paint
at row 99,000 costs 1.07 ms against 1.04 ms at row 100. Tabulator's failure mode at this scale
was ~5 s to paint a range selection near the bottom of a 100k-row dataset; here the bottom of
the dataset is indistinguishable from the top.

Scroll frames sit at the 16.7 ms display cadence with ~1.3 ms of that spent painting, so
roughly 92% of each frame is still free — which is the headroom tasks 6–17 will spend on
selection, editing and filtering.

### The one change the benchmark prompted

The first run measured a **full repaint at 2.42 ms doing 504 DOM mutations** (252 insertions +
252 removals). Every dirty cell was being *replaced* by a pooled element, because `renderCell`
had no way to reach the element already at that coordinate.

Adding a `previous` hint to `RenderCellParams` — the element currently rendered there, when
there is one — let the renderer update in place instead:

| | Before | After |
|---|---|---|
| Full repaint | 2.42 ms | **0.195 ms** |
| DOM mutations per full repaint | 504 | **2** |

A 12× improvement on the path that sorting, filtering and data changes will all take. The
correctness half matters more than the speed half: swapping the element out would have
destroyed anything living on it — focus, an open editor, a running transition — so task 12's
in-cell editor would have lost focus whenever anything marked its cell dirty.

## History

| Date | Task | First paint | Flat ratio | Scroll fps (top / bottom) | Allocations | Note |
|---|---|---|---|---|---|---|
| 2026-08-08 | 5 | 5.6 ms | 1.02× | 60.0 / 60.0 | 0 | Baseline. Gate passed. |
