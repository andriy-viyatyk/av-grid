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

## Task 9 — the grid layer — 2026-08-08

The same gate, re-run through **the whole grid** rather than the engine alone: real
`DataCell` / `HeaderCell` renderers, nine columns including a computed one, an element
renderer, a boolean column and a formatted date column, plus `onCellClass` on every cell.
Board: [`test-boards/AVGridBoard`](../test-boards/AVGridBoard/CLAUDE.md), viewport 577px tall
(24 rows × 9 columns rendered).

| Measure | Engine (task 5) | Grid (task 9) | |
|---|---|---|---|
| Data generation | 27.9 ms | 17.2 ms | different dataset |
| **Time to first paint** | 5.6 ms | **8.0 ms** | ✅ gate < 100 ms |
| Paint cost near the top | 1.04 ms | 0.906 ms | 300-step sample |
| Paint cost near row 99,000 | 1.07 ms | 0.842 ms | 300-step sample |
| **Flat-cost ratio** | 1.02× | **0.93×** | ✅ ≈ 1.0 |
| Scroll from the top | 60.0 fps | 60.0 fps — median 16.8 ms, p95 17.2 ms | ✅ |
| Scroll near row 99,000 | 60.0 fps | 60.0 fps — median 16.7 ms, p95 17.1 ms | ✅ |
| Full repaint (`{ all: true }`) | 0.195 ms, 2 mutations | **0.5 ms, 0 mutations** | |
| Sort 100k rows | — | 21 ms | filter → sort → mark dirty |

**No regression.** A full-featured cell renderer costs about the same per paint as the
benchmark's stub did, and the flat-cost property survives the grid layer intact — the whole
point of measuring again.

The ratio is quoted from a 300-step sample. **A 40-step sample is meaningless here:** a paint
costs under a millisecond, so four consecutive 40-step runs gave ratios of 1.16×, 1.31×,
1.10× and 0.99×. The harness now defaults to 300, and the board's `CLAUDE.md` says why.

Two numbers that look wrong and are not:

- **0 DOM mutations on a full repaint**, against the engine's 2. The grid renderers resolve
  `p.previous` for every cell, so a repaint of 216 cells inserts and removes nothing at all.
- **36 mutations** if the repaint is measured immediately after a scroll. Those are 4 overscan
  rows × 9 columns left attached by the directional scroll path, which the full recompute
  trims. Settle before measuring.

**Hover**, the narrowest dirty set the grid produces today, was measured separately: moving
the pointer between two rows repaints those two rows, mutates **zero** DOM nodes, and takes
one paint.

**Theming costs nothing.** Setting `--p-text` on the document root re-tinted every border and
background with **0 paints** — the browser did all of it. That is the task-9 requirement, and
it is only true because there is one static stylesheet and no JavaScript reads a colour.

## Task 10 — range selection — 2026-08-08

Task 10 adds a gate of its own: **dragging a range selection at row 99,000 must be as fast as
at row 100.** Same board, same dataset, new harness entry `window.avg.measureRangeDrag(row)`.

The measurement is deliberately unkind. Before each drag the selection is anchored at row 0,
so at row 99,000 the *live* selection covers 99,001 rows against 101 at the top. The reference
marks both the old and the new selection rectangle dirty on every pointer move, unclipped —
under that algorithm this measurement comes back roughly 990× worse at the bottom.

| Measure | Row 100 | Row 99,000 | |
|---|---|---|---|
| Selection under the drag | 101 rows | 99,001 rows | 980× more selected |
| **Cells marked dirty per move** | **2** | **2** | ✅ identical |
| **Model cost per move** | **0.0141 ms** | **0.0147 ms** | ✅ **ratio 1.04×** |
| Paint cost per move | 0.065 ms | 0.050 ms | |
| DOM mutations over 200 moves | 0 | 0 | ✅ |

The rest of the gate, re-run through the selection-aware `DataCell`:

| Measure | Task 9 | Task 10 | |
|---|---|---|---|
| Time to first paint | 8.0 ms | 6.7 ms | ✅ gate < 100 ms |
| Paint cost near the top | 0.906 ms | 0.895 ms | |
| Paint cost near row 99,000 | 0.842 ms | 0.967 ms | |
| **Flat-cost ratio** | 0.93× | **1.08×** | ✅ ≈ 1.0 |
| Scroll fps (top / bottom) | 60.0 / 60.0 | 60.0 / 60.0 | ✅ |
| Full repaint | 0.5 ms, 0 mutations | 0.2 ms, 0 mutations | |
| Sort 100k rows | 21 ms | 22 ms | |

**No regression.** Adding focus and selection state to every cell's class string cost nothing
measurable, because `focusClass()` returns the same empty string for every cell of an
unfocused grid and a bitmask comparison for the rest.

### The number to quote, and the one to ignore

**Quote cells-marked-per-move.** It is exact, it is 2 at both ends, and it is what the plan
actually asks for: *"each mouse-move during a drag repaints only the cells whose selection
state changed"*. Two is right — extending a one-column selection down a row makes the old last
row lose its bottom border and the new one gain it.

**Ignore a single-run timing ratio.** A move costs ~14 *microseconds*, so 200 of them total
3 ms and the ratio swings between 0.77× and 1.09× on timer quantization alone. The 1.04×
above is the mean of 6 × 400 moves at each end. This is the same trap as the 40-step paint
sample in task 9, one order of magnitude further down.

The harness times two loops for this reason. The tight loop — no frame wait — is the one the
gate rests on: it measures dispatch, the focus update and building the dirty set. **Do not
"simplify" it by awaiting a frame per move.** At 60Hz every move then costs 16.7 ms of
waiting, the real work vanishes under the display cadence, and the ratio comes back a
meaningless 1.00 whatever the implementation does. That mistake was made and caught here.

`measureFullRepaint` now does a throwaway `refresh()` before it measures, which finally kills
the spurious "36 DOM mutations" for good: cells that scrolled out during an earlier phase stay
attached until the next full *recompute* trims them, and settling alone never asks for one.

## History

| Date | Task | First paint | Flat ratio | Scroll fps (top / bottom) | Allocations | Note |
|---|---|---|---|---|---|---|
| 2026-08-08 | 5 | 5.6 ms | 1.02× | 60.0 / 60.0 | 0 | Baseline. Gate passed. |
| 2026-08-08 | 9 | 8.0 ms | 0.93× | 60.0 / 60.0 | 0 | Whole grid, real cell renderers. No regression. |
| 2026-08-08 | 10 | 6.7 ms | 1.08× | 60.0 / 60.0 | 0 | Focus and range selection. Drag ratio **1.04×**, 2 cells marked per move at both ends. |
