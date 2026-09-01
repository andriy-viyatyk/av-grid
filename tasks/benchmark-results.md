# Benchmark results

The performance gate from [`plan-done-01.md`](plan-done-01.md) task 5. **Re-run this after any change to the
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

`measureRangeDrag` dispatches its moves on `window` with **real client coordinates** read from
the two cells' bounding rects. That is not cosmetic: the drag resolves its target by
hit-testing the point, so moves dispatched at (0, 0) land outside the grid, trip the
auto-scroll, and measure something else entirely. Re-measured after the auto-scroll work
landed: 2 cells marked per move at both ends, 0.0141 ms against 0.0129 ms — the per-move
`elementFromPoint` costs nothing detectable.

`measureFullRepaint` now does a throwaway `refresh()` before it measures, which finally kills
the spurious "36 DOM mutations" for good: cells that scrolled out during an earlier phase stay
attached until the next full *recompute* trims them, and settling alone never asks for one.

## Task 11 — row selection — 2026-08-08

Task 11's requirement is softer than task 10's — *"select-all on 100k rows does not stall"* —
but it fails in the same way if taken carelessly: selecting 100,000 rows changes 100,000 rows'
appearance, and marking all of them dirty is correct, useless, and slow. Harness entry
`window.avg.measureSelectAll()`.

| Measure | Result | |
|---|---|---|
| Select all 100,000 rows | 24.9 ms | model cost, one click |
| **Rows marked dirty** | **19** | ✅ the viewport, not the selection |
| DOM mutations | 0 | ✅ |
| Paints | 1 | ✅ |
| Clear the selection | 0.1 ms | 19 rows marked |

The 24.9 ms is almost entirely `new Set(100_000 keys)` — 18 ms of it, measured directly. The
two passes that *were* avoidable are gone: `selectAll` tells `updateAllSelected` the answer
instead of making it scan (6.4 ms), and the key array handed to `onSelectionChange` is built
only if a host registered one. Isolated repeats settle at 8–12 ms once the JIT has warmed up.

The rest of the gate, re-run with the checkbox column on and a row-selection class on every
cell:

| Measure | Task 10 | Task 11 | |
|---|---|---|---|
| Time to first paint | 6.7 ms | 5.8 ms | ✅ gate < 100 ms |
| **Flat-cost ratio** | 1.08× | **0.89×** | ✅ ≈ 1.0 |
| Scroll fps (top / bottom) | 60.0 / 60.0 | 60.0 / 60.0 | ✅ |
| Full repaint | 0.2 ms, 0 mutations | 0.0 ms, 0 mutations | |
| **Range drag — cells marked per move** | 2 / 2 | **2 / 2** | ✅ |
| Range-drag ratio | 1.04× | 1.04× | ✅ |
| Sort 100k rows | 22 ms | 23 ms | |

**No regression.** A second per-cell class producer costs nothing measurable for the same
reason the first one did: `rowClass()` returns before touching the row at all when nothing is
selected, which is the state every grid is in until someone clicks.

### The harness bug this found, which was not a grid bug

The first run after the checkbox column landed reported the range drag marking **0 cells per
move at both ends** — a perfect ratio, and completely empty. `measureRangeDrag` dragged from
`data-col="0"`, which is the checkbox column once `selectColumn` is on, and a pointerdown on a
status column is deliberately inert. It now resolves the first non-status column instead.

Worth recording because of the shape of the failure: an instrumented measurement that reports
*zero work* reads like a triumph and is nearly always a broken probe. The same run also
reported 10 DOM mutations on select-all which did not reproduce in isolation — the familiar
"cells that scrolled out during an earlier phase are trimmed by the next full recompute"
artifact, and `measureSelectAll` now does the same throwaway `refresh()` warm-up that
`measureFullRepaint` learned in task 9.

## Task 12 — in-cell editing — 2026-08-08

Editing has no throughput gate — nobody types into 100,000 cells — so the question here is a
different one: **does an open editor survive a repaint?** The invariant in `CLAUDE.md` says a
cell renderer must prefer `p.previous` over a pooled element, and an editor is the first thing
in the library that *notices* when it does not. Take a pooled element instead and the input is
re-parented on the next hover, which destroys the caret, the text selection and any IME
composition in flight. Harness entry `window.avg.measureEditing(row)`.

| Measure | Result | |
|---|---|---|
| Open an editor | 0.0 ms | |
| **Cells marked dirty on open** | **1** | ✅ one cell, not the row |
| Full repaint while editing — DOM mutations | **0** | ✅ |
| **Editor element survives that repaint** | **true** | ✅ same input, same parent cell |
| Commit | 5.7 ms | includes `onEdit` and re-focusing the grid |
| Cells marked dirty on commit | 1 | |

Measured at **row 99,000**, which is the only interesting place to measure it: everything above
is the same code with a smaller index. The 5.7 ms commit is a one-off user action and most of it
is `focusGrid()` returning focus to the root; it is on no repeated path. Opening costs 0.1 ms.

Verified in the browser by hand as well as by the harness, on the 1,000-row board: F2 and
double-click open with the value selected, typing opens with the typed character and the caret
after it, Enter and Tab and blur commit, Escape discards, Tab lands the focus one column right,
a dropdown pick commits immediately, Space flips the booleans in a selection, and Delete clears
one. The editor sits flush in its cell (1px inset, inherited font) — screenshotted, not assumed.

The rest of the gate, re-run on 100,000 rows with editing on:

| Measure | Task 11 | Task 12 | |
|---|---|---|---|
| Time to first paint | 5.8 ms | 5.7 ms | ✅ gate < 100 ms |
| **Flat-cost ratio** | 0.89× | **0.94×** | ✅ ≈ 1.0 |
| Scroll fps (top / bottom) | 60.0 / 60.0 | 60.0 / 60.0 | ✅ |
| Full repaint | 0.0 ms, 0 mutations | 0.0 ms, 0 mutations | ✅ |
| **Range drag — cells marked per move** | 2 / 2 | **2 / 2** | ✅ |
| Range-drag ratio | 1.04× | 0.93× | ✅ |
| Select all 100k | 24.9 ms, 19 rows | 21.7 ms, 36 rows | ✅ viewport-bounded |
| Sort 100k rows | 23 ms | 24 ms | |

**No regression.** The per-cell cost this task adds to the hot path is `isEditingCell` — two
integer comparisons against coordinates that are `-1` whenever no editor is open, which is
almost always.

Two numbers in that table differ from task 11 and neither is a regression. Select-all marked 36
rows rather than 19 because this run reaches it scrolled to row 99,000, where the rendered
window is a full viewport plus overscan rather than the partly-filled one at the top — the claim
being tested is that the count follows the *viewport*, and 36 is a viewport. It also reported 10
DOM mutations: the familiar artifact of cells left attached by the preceding drag phase, which
the next full recompute trims (see task 9), not work done by the selection.

### A frame-paced harness cannot be driven against a hidden window

The first attempt at this run happened while the Persephone window was minimised.
`document.hidden` was true, `requestAnimationFrame` was throttled to a standstill, and every
measurement in `runBenchmark` is frame-paced — `measureEditing` hung mid-way and a scroll-fps
figure taken under that condition would have measured the throttle rather than the grid.
Screenshots pump about eight frames each, which is enough to nurse a short measurement along and
nothing more. If the harness appears to hang, check `document.hidden` before suspecting the grid.

## Task 13 — clipboard copy/paste — 2026-08-08

Copy is the one operation in the library that is *honestly* O(selection): it has to produce a
string containing every selected value, and there is no version of that which is viewport-bounded.
So the question this measures is the other half — **what the paste costs the renderer** — plus
whether the copy itself stays out of the way. Harness entry
`window.avg.measureClipboard(row, rowCount)`.

Measured on the 1,000-row board over a **500-row × 2-column** selection:

| Measure | Result | |
|---|---|---|
| Copy 500 rows × 2 columns | 0.7 ms | 6,634 characters, 501 lines |
| Copy took over the event | true | `preventDefault`, so the browser does not also copy |
| Paste into 1,000 cells | 1.9 ms | tiled one clipboard row across all 500 |
| **Repaints marked by the paste** | **1** | ✅ `{ all: true }` once, not a cell per row |
| **DOM mutations on paste** | **0** | ✅ every visible cell was already in place |

That 1 is the number to watch. A paste writes through `editCellAt` per cell, and marking each
one would build a dirty set larger than the viewport it is about to repaint — so the writes are
silent and the whole thing marks the viewport once at the end, exactly as a range delete does.
`{ all: true }` repaints only what is on screen, which is why 1,000 written cells still mutate
no DOM: each visible cell is `p.previous`, and only its text changes.

Both events in that measurement are genuine `ClipboardEvent`s carrying a real `DataTransfer`, so
this is the path ctrl+C and ctrl+V actually take — not the programmatic API, which the board's
sandbox would refuse anyway.

The round trip was verified in the browser against **the real Windows clipboard**, not only in
tests. Two cells were given a value containing a tab and a value containing a newline;
`copySelection()` wrote the selection out, and reading the system clipboard back gave

```
Ada\t"has\ttab"\r\n
Alan\t"two\r\nlines"\r\n
```

— which is exactly the quoted-TSV shape Excel parses into cells. Pasting those same bytes back
into the grid twenty rows down restored both values intact and moved the selection onto them.
Screenshotted.

One honest detail from that trip: the newline came back as `\r\n` rather than the `\n` that went
out, because Windows normalises line endings for the whole clipboard payload. The grid does not
undo that — the parser preserves whatever is inside the quotes, and inventing a normalisation
would silently corrupt a value that really did contain `\r\n`.

**What could not be checked from here:** a synthetic keystroke does not produce a native
clipboard event, so `browser_press_key("Control+c")` delivers the keydown and nothing else — the
same family of tool artifact as `browser_click` not dispatching `pointerdown`. The handlers were
therefore exercised with genuine `ClipboardEvent`s carrying a real `DataTransfer`, and the
system-clipboard half was checked through `copySelection()` as above. A human pressing ctrl+C is
the one link in the chain still taken on the browser's word.

**The 100k gate was not re-run for this task**, because nothing in the render path changed:
`DataCell` is untouched, and the new code is three root listeners plus a model that runs only
when a clipboard event fires. The last full run is task 12's, below.

## Task 14 — row/column add and delete — 2026-08-08

Adding a row makes the grid taller, which is the one thing in the library that changes the
*geometry* rather than the contents. So the question here is not throughput — it is whether the
viewport survives. Harness entry `window.avg.measureStructure(row)`.

Measured on the 100k-row board, scrolled to row 90,000 and focused there, inserting **above** the
viewport — the case that would shift it if anything did:

| Measure | Result | |
|---|---|---|
| Add a row above the viewport | 3.4 ms | the O(rows) array copy behind the insert |
| Delete it again | 11.4 ms | one pass over 100k rows, one `getRowKey` each |
| **DOM mutations on add** | **0** | ✅ the same cells, showing shifted data |
| **Scroll position kept** | **true** | ✅ |
| **Focus kept** | **true** | ✅ followed the row, which moved one down and back |

`addMs` and `deleteMs` are not gates. Both are dominated by copying the host's row array, which
is O(rows) *by choice*: the alternative is a permanent index that every sort and filter would
have to maintain, to save a few milliseconds on an operation a user performs by hand. The delete
pass was halved — 32 ms to 11 ms — by splitting "what goes" from "what stays" in a single loop
rather than filtering the array twice, because each filter calls the host's `getRowKey` per row.

### The scroll jump this found, which was a real bug

The first run reported `scrollKept: false` and **260 DOM mutations** — a whole viewport's worth.
The cause was not the insert. `FocusModel` revalidates the focus whenever the rows change, and a
focused row whose *index* moved is treated as "the rows moved", which scrolls it back to
**centre**. Inserting one row above the focus therefore yanked the viewport by 261 px and
repainted everything, for a change the user did not make.

The reference has the same hazard and the same answer: a `noScrollOnFocus` flag set by
`AVGridActions.addRows` around exactly that one revalidation. It had not been ported, because
until this task nothing inserted rows. `StructureModel` now sets it in both `addRows` and
`deleteRows`, and the numbers above are the result.

Worth recording *how* it was found, because it very nearly was not: the boolean `scrollKept` said
false, and the first three hypotheses — browser scroll anchoring, a height clamp, a stale
`offset.y` — were all wrong. Wrapping `scrollTo` / `scrollToRow` / `restoreScroll` on the render
model in a logger answered it in one call: `scrollToRow(90002, "center")`. **Instrument the
suspect rather than reasoning about it.**

The remaining **10 mutations** seen mid-investigation are honest and expected: the grid got 24 px
taller, so one more row fits at the bottom, and one row of cells is appended. Once the add and the
delete are measured as a pair, that nets back to 0.

**The 100k gate was re-run** and holds — the render path is untouched, but a task that changes the
row count is exactly the one that should not be taken on trust:

| Measure | Result | Gate |
|---|---|---|
| Time to first paint | 7.4 ms | < 100 ms ✅ |
| Flat-cost ratio | 0.98× | ≈ 1.0 ✅ |
| Scroll fps, top / bottom | 60.0 / 60.0 | ✅ |
| Full repaint | 0.100 ms, 0 mutations | ✅ |
| Range drag, both ends | 2.0 cells marked | ✅ |
| Paste into 1,000 cells | 1 repaint, 0 mutations | ✅ |

## Task 14b — the virtualized list — 2026-08-08

The filter popover's body, measured because the whole reason it exists is a number: a
distinct-values checklist over a high-cardinality column on 100k rows would otherwise put tens of
thousands of DOM rows inside a popover. Harness entry `window.avg.measureList(count)`, which opens
a real `Popover` and fills it — a list whose container has no definite height renders nothing, so
measuring it outside one would measure the wrong thing.

100,000 options, 24 px rows, in a 320 px-tall popover:

| Measure | Result | Gate |
|---|---|---|
| Mount — construction + first paint | **4.4 ms** | same order as the grid's 7.4 ms for 100k rows ✅ |
| Rows in the DOM | **11** | not 100,000 ✅ |
| Scroll fps | 60.0 | ✅ |
| Paint cost, top / end | 0.313 ms / 0.313 ms | |
| **Flat-cost ratio** | **1.00×** | ≈ 1.0 ✅ |
| Select all 100,000 options | 9.0 ms, 1 repaint | ✅ |

The flat ratio is the same claim the grid makes, one level down: a paint at option 99,000 costs
what a paint at option 0 costs, because both paint eleven rows. Select-all marks `{ all: true }`
once for the whole operation — the trade already made for Delete, a boolean toggle and a paste —
so ticking 100,000 options costs the same paint as ticking one.

Two things this measurement corrected while it was being taken. `mountMs` originally awaited three
frames before stopping the clock and reported **20.6 ms**, which was mostly the display refresh
rate: the number that matters is construction plus the synchronous first paint, the same thing the
grid's `firstPaintMs` measures. And the list initially rendered *nothing* under test, because the
constructor built the engine before the items existed — `RenderGrid` paints synchronously so a grid
is on screen when it returns, and that paint was being spent on an empty `filtered`. State before
engine, now, with a comment saying why.

No grid gate re-run: the list is a separate `RenderGrid` instance and touches nothing in the
grid's render path.

## Task 15 — filters and row filtering — 2026-08-09

The task's own gate: *filtering 100k rows down and back up is smooth, and filters round-trip
through the injected storage including `Date` values.* Harness entries
`window.avg.measureFilter(count)` and `window.avg.measureFilterStorage()`.

100,000 rows, 10 columns:

| Measure | Result | Gate |
|---|---|---|
| Filter down — 100,000 → 40,000 | **5.9 ms** | one pass over every source row |
| A second filter on top — → 20,000 | 6.0 ms | the AND path, same cost |
| Filter back up — → 100,000 | **0.0 ms** | ✅ nothing applied, so `filterRows` returns the *same array* |
| **Repaints per filter change** | **1** | ✅ |
| **DOM mutations** | **0** | ✅ every visible cell was already in place |
| Scroll fps on the filtered grid | 60.0 | ✅ |
| Free-text search over 100k rows | 107 ms | every column of every row formatted |

The DOM numbers are the point, and they are the ones that do not scale with the data. Narrowing
100,000 rows to 40,000 changes what every visible cell shows, so it is a full repaint — and a full
repaint of a viewport is the same work whether the grid behind it holds a hundred rows or a
hundred thousand. Zero mutations, one paint, either way.

Filtering *back up* costing nothing at all is `filterRows` returning its input array when there is
nothing to apply — the same property that lets `setRows()` on an unfiltered 100k-row grid copy
nothing. It is worth knowing that the expensive direction is the only direction.

### What the computed-column fix costs

Task 13 left a known gap: the free-text search read the raw row property, so a *computed* column —
one on screen with no property behind it — could never match. Closed here by searching
`columnDisplayValue`, which consults the column's `formatValue`. That puts a host callback inside
the 100k-row loop, which is exactly why it was deferred, so it was measured rather than assumed:

| Search over 100,000 rows × 10 columns | Median of 5 |
|---|---|
| With `formatValue` on the computed column | 107.1 ms |
| Without it — what the search did before | 98.5 ms |

**+8.6 ms, or 8.7%, for one computed column in ten.** Paid only while a search is active, and only
by columns that define `formatValue`. `render` is still never called from the filter path: it may
build an element, and the clipboard's fallback to it (`CopyPasteModel.cellText`) is affordable
across a selection in a way it would not be across 100,000 rows a keystroke.

Proven on the board rather than only in a unit test, with a computed value that appears in no row
property at all: **12,500 rows matched with `formatValue`, 0 without.**

### Persistence

| Measure | Result | |
|---|---|---|
| Keys written to the injected store | `Filters-avgrid-board` | 388 bytes |
| Keys written to real `localStorage` | **none** | ✅ the injection is the whole point |
| Row count before / after the reload | 1 / 1 | ✅ round-tripped |
| Restored `Date` is a `Date` | **true** | ✅ same instant |
| Restored option kept its label | **true** | the reference lost this — see the decision log |

The reload is simulated by destroying the grid and creating another against the same store, which
is what a reload is from the model's point of view.

The 100k gate was re-run even though this is not the render path, because `updateRows` sits behind
every `setRows`. No regression: first paint 2.9–6.0 ms across repeats, flat ratio 0.84×, 60/60 fps,
full repaint 0.2 ms / 0 mutations, drag 2 cells per move at both ends. (A single cold first run
reported 10.2 ms; repeated runs settle immediately, so the cold number is page warm-up, not the
grid.)

## Task 16 — the filter popover — 2026-08-09

Harness entry `window.avg.measureFilterPopover(count)`. The question this task has to answer is
not how fast a popover opens — it is whether opening one over 100,000 rows costs the *grid*
anything, and whether a column with 100,000 distinct values puts 100,000 rows in a checklist.

100,000 rows:

| Opening the popover on… | Time | Rows in the DOM | Grid marks | Grid mutations |
|---|---|---|---|---|
| `status` — 5 distinct values | **4.4 ms** | 5 | **1** | **0** |
| `score` — ~100,000 distinct values | 113 ms | **12** | **1** | **0** |
| Typing in the search box, on `score` | 31 ms | 12 | — | — |

**The two right-hand columns are the gate.** Opening a popover marks exactly one thing on the
grid — the header row, so the funnel lights — and mutates nothing, whether the column has five
values or a hundred thousand. And the checklist holds **12 rows** in both cases: that is
`VirtualList` earning the reason it was built as task 14b rather than as part of this one.

The 113 ms is the default option provider making one pass over every row and then sorting the
result, and it is honest work rather than overhead — measured directly on the same data:

| Collecting 100,000 distinct values | |
|---|---|
| `Set` over 100,000 rows | 11.1 ms |
| Sorting 100,000 values | 19.7 ms |
| Building 100,000 labels | 10.6 ms |

The rest is `formatDisplayValue` per option (the labels have to read as the cells do) and the
list's own item mapping. A column with a hundred thousand distinct values is a column nobody
filters by picking from a list, so this is the worst case, not the common one — `status` is,
and that is 4.4 ms. A host with a better answer supplies `onGetOptions` and this code never
runs.

The 100k gate was re-run because `HeaderCell` is on the render path — it now toggles one more
class per header cell per paint. No regression: first paint 4.9 ms, flat ratio **0.92×**, 60.0 /
60.0 fps, full repaint 0.2 ms with 0 mutations, drag 2 cells per move at both ends, and
`measureFilter` unchanged on a fresh grid (down 3.5 ms, up 0.1 ms, 0 mutations either way).

### Three defects the numbers could not see — found by scrolling the list

All three surfaced from one report: *open the filter popover on a column with many options,
scroll down, and the list is empty below the first screenful.* Every benchmark above was green
while all three were live, which is the point of the entry.

1. **The list rows were never positioned absolutely.** The engine writes `top`/`left` on a cell;
   making it `position: absolute` is the stylesheet's job, and `.avg-list-item` — unlike
   `.avg-data-cell` — never said so. The rows laid out in flow, which *looks* correct at the top
   of a list because each row's inline width fills the container and forces a wrap, and shows
   nothing at all below: the `top` the engine wrote was ignored, so scrolling revealed content
   nobody had positioned. Shipped in task 14b, and `measureList` had been measuring paint cost
   and frame rate over it happily ever since — it never asked where a row *was*.
2. **The paint wrote its own scroll offset back over the user's.** `RenderGrid.render()`
   restored `model.offset` onto the container whenever the two differed. But a scroll event is
   delivered a frame *after* the position changes, so a paint routinely runs with the container
   ahead of the model — and the write undoes the scroll, then fires a scroll event of its own,
   so the two take turns. Measured: **half of all scrolls reverted**. Now gated on a flag set
   only when the container was actually hidden, which is the case the restore was written for.
3. **Chromium's scroll anchoring fought the virtualization.** The browser keeps a node near the
   top of the viewport still when content above it resizes — which in a virtualized list is
   every frame. `overflow-anchor: none` on the scroller and its content, in the engine, where
   every `RenderGrid` gets it.

And a fourth, smaller: `VirtualList` never passed `overscanRow`, so it took the engine's default
of **0** and drew exactly the rows that fit. The grid has always passed 4; the list now does too.

After the fixes, scrolling to any offset in a 100,000-option list — including the last one,
2,399,745 px down — lands on rows that fill the viewport, and **no scroll is lost at any step
size** (24 px, 120 px, 240 px, 20 steps each). Re-measured: opening on `status` 3.0 ms, on
`score` 77.5 ms, still **1 grid mark / 0 grid mutations**; the standalone list holds flat ratio
1.03× at 60 fps; and the 100k gate is unchanged — first paint 4.7 ms, flat ratio 0.90×, 60/60
fps, full repaint 0 mutations, drag 2 cells per move.

> **A measurement that misleads.** `measureFilter` reported 430–480 DOM mutations when run
> straight after `runBenchmark`, which looks exactly like a task-16 regression and is not: the
> benchmark leaves the grid sorted and its rows added to and deleted from, so filtering there
> genuinely reorders what is on screen. Re-run against a fresh grid it is 0 mutations again, as
> in task 15. Re-create the grid before measuring a filter.

## Task 17 — the filter bar — 2026-08-09

Harness entry `window.avg.measureFilterBar(count)`. The bar lives *outside* the grid root, so
there is only one performance question worth asking: does having it cost the grid anything a
filter applied through the API would not?

100,000 rows, two filters applied and then cleared:

| | Time | Chips | Bar height | Grid mutations |
|---|---|---|---|---|
| Nothing filtered | — | 0 | **0 px** | — |
| Two filters applied | 4.9 ms | 2 | 32 px | 20 |
| A third filter, or a chip's value changed | 3–6 ms | — | 32 px | **0** |
| One of two removed | 4.8 ms | 1 | 32 px | **0** |
| Cleared from the bar's remove-all | 0.2 ms | 0 | **0 px** | 20 |

**The 20s are the bar appearing and disappearing, not the filter.** The bar takes 32 px off the
grid, which is a resize, and 20 cells is one row's worth at this width. Every filter change while
the bar is already up mutates **nothing** — task 15's "0 mutations per filter" is intact, and the
only two moments that cost anything are the first filter and the last removal.

Anchoring, which is the part no unit test can check — happy-dom returns a zero rect for
everything, so all 32 of the new tests run on stubbed geometry:

| Popover opened from a chip | |
|---|---|
| Below the chip by | 4 px |
| Left edge offset from the chip's | 3 px |
| Inside the viewport | yes |
| Chip lit and caret turned over | yes |

The 100k gate was re-run with the bar on, because a wrapper element now sits between the host and
the grid root: first paint 9.5 ms, flat ratio **0.70×**, 60.0 / 60.0 fps, full repaint 0.1 ms with
0 mutations, drag 2 cells per move at both ends, editing and structure unchanged. (First paint is
higher than task 16's 4.9 ms because the grid is measured full-width here — ten columns visible
rather than five — not because of the bar.)

### The layout bug the numbers could not see, again

The bar's wrapper had `display: flex; flex-direction: column` and no `flex` of its own. The engine
writes `flex: 1 1 auto` on the grid root; the wrapper had taken the root's place as the host's
child without taking its sizing contract, so in a flex-row host it fell back to the default
`0 1 auto`, sized itself to the grid's *intrinsic* width, and rendered a full-page grid as a
689 px column down the left of a 1,477 px host.

Every one of the 572 tests was green over it, and so was `measureFilterBar` — a paint costs the
same whatever width the grid ended up. It was caught by looking at the board, which is now twice
in two tasks: **anything inserted between a host and the grid root inherits the root's sizing
contract, not just its position.**

## Task 17a — the cell dropdown — 2026-08-09

Harness entry `window.avg.measureCellSelect(count, optionCount)`. The plan's gate is *"a column
with 10,000 options opens instantly"*, and the number that makes that true is the DOM row count,
not the milliseconds — the milliseconds here are four settle frames either way.

100,000 rows, opening the editor on a `status` cell:

| Options behind the cell | DOM rows in the list | Grid mutations | Popover height |
|---|---|---|---|
| 5 (an enumeration — what a status column really holds) | **5** | **0** | 158 px |
| 10,000 | **13** | **0** | 322 px, capped |

Picking a row: value written, edit closed, popover gone, **0** grid mutations. Keyboard, end to
end: the search box has the focus on open, typing `option 77` narrows 10,000 options to 13 rows,
ArrowDown moves the highlight, Enter commits and focus lands back in the grid.

The two things a native `<select>` could not do, which is why this was worth a task at all:

| | |
|---|---|
| Popover background / board background | `rgb(31,31,31)` / `rgb(31,31,31)` — the same |
| Font | the grid's, not the platform's control font |
| Anchored below the cell by | 1 px, left edges aligned, inside the viewport |

The 100k gate was re-run: first paint 5.3 ms, flat ratio **0.91×**, 60.0 / 60.0 fps, full repaint
0.1 ms with 0 mutations, drag 2 cells per move at both ends, and the task-12 editing gate intact —
1 cell marked on open, 1 on commit, 0 mutations while editing, same element after a repaint.

## Task 18 — introspection and teardown — 2026-08-10

Harness entry `window.avg.measureTeardown(cycles, rowCount)`. The plan's gate is *"creating and
destroying a grid 100 times in a loop shows flat memory"*. Each cycle builds a grid with the whole
surface on it — filter bar, checkbox column, both add buttons, an applied filter, a focused cell
and an open editor — and destroys it.

| | 100 cycles, 2,000 rows |
|---|---|
| Time per cycle | 6.5 ms |
| DOM nodes leaked | **0** (27 before, 27 after) |
| Grids collected | **100 / 100** |

### `usedJSHeapSize` was the wrong instrument

The obvious way to measure this is a heap delta, and it does not work. Without
`--js-flags=--expose-gc` a page cannot force a collection, so `usedJSHeapSize` reports whatever
garbage has not been swept yet. Four consecutive runs of the *same* measurement:

| Run | Heap growth per cycle |
|---|---|
| 1 | +45.3 KB |
| 2 | **−15.5 KB** |
| 3 | +39.1 KB |
| 4 | +19.0 KB |

A number that comes back negative on a leak test is not measuring a leak. It is measuring the
allocator's mood, and a real leak of a few kilobytes a cycle would be invisible underneath it.

What answers the actual question — *is anything still reachable?* — is a `WeakRef` to every
destroyed grid plus enough allocation pressure to provoke a sweep. Something still pointing at a
grid, from a document listener or a pending frame or a module-level registry, keeps it alive and
uncollected. It reads 100/100, and it earned its keep on the first run: it read **99/100** until
the harness stopped holding the last grid in its own loop binding — an artefact that looks exactly
like a one-object leak and took a bisect to tell apart from one. The line that fixes it carries a
comment saying so.

### Two teardown gaps it found

Neither survived past the next frame, so neither was a leak in the strict sense — but both are
what the 100-cycle test exists to catch, and both are now closed:

- **The constructor's deferred re-measure was never cancelled.** When the host is not laid out yet
  the grid schedules a `requestAnimationFrame` to re-check its height; `destroy()` did not cancel
  it, so every destroyed grid held itself alive for one more frame.
- **The two add-affordance buttons outlived the grid.** They are `addOverlay` children of a render
  *region*, not of the root, so `render.destroy()` removing the root did not take them with it.

The render path was not touched, but the gate was re-run anyway: first paint 8.0 ms, flat ratio
**0.88×**, 60.0 / 60.0 fps, full repaint 0.10 ms with **0** mutations, drag 2 cells per move at
both ends. Select-all reported 10 mutations *inside the full benchmark run* and **0** on its own —
the cold cell pool left by the preceding scroll phase, the same artefact task 17a saw, not a cost
of anything in this task.

## The hover highlight, and what it costs during a scroll

Row hover was read from `mousemove`, which looked equivalent to `pointermove` and was not.
`onCellPointerDown` calls `preventDefault()` so the browser does not start a text selection that
follows the drag out of the grid — and per the Pointer Events spec that **suppresses the
compatibility mouse events for the rest of that pointer's stream**. So a range drag delivered no
`mousemove` at all: the highlight stayed on the cell the drag started from and jumped to the
pointer only on release, when the compat events resumed. `pointermove` is not suppressed.

The second half is a wheel scroll with the pointer standing still. No pointer event fires, so
nothing recomputed the highlight and the row it was on scrolled away from under the cursor. It is
now re-resolved from the pointer's last position in a frame requested from the scroller's `scroll`
event — after the paint, because `RenderGrid` paints on rAF and its own scroll listener is bound
first, so a frame requested here runs behind it. Hit-testing before the paint returns the row that
*was* there.

What it costs, measured on 100,000 rows, one row per frame for 200 frames:

| Scrolling with | DOM mutations per paint | Per paint |
|---|---|---|
| the pointer away from the grid | 20.2 | 0.120 ms |
| the pointer parked over a cell | 99.8 | 0.291 ms |

The highlight moving on its own — pointer crossing rows, grid not scrolling — is **0 mutations and
0.045 ms**, so this is not the cost of drawing hover. It is the cost of a dirty set arriving in the
same frame as a scroll: `update()` schedules a recompute with no `direction`, which cannot take the
cheap newly-exposed-cells path the scroll itself took. 0.29 ms is 1.7% of a frame and fps held at
60.0, so it is left alone; the guard that matters is that `onScrolled` returns immediately when no
pointer is over the grid, which is every programmatic scroll — the benchmark below is unchanged
because of it.

## Task 21 — the class hooks — 2026-08-11

Four hooks now run inside the per-cell loop: `Column.cellClass`, `Column.headerClass`, the
existing `onCellClass`, and `rowClass`. Two of them allocate — a functional `cellClass` or
`onCellClass` builds one `CellContext` per cell, `rowClass` a second, smaller `RowContext` — so
this is the first feature since task 15's search that puts host callbacks on the hot path.

The gate, re-run on 100,000 rows with all four live on the board:

| | |
|---|---|
| First paint | 9.2 ms |
| Paint cost at row 100 / near the bottom | 0.120 ms / 0.115 ms |
| **Flat ratio** | **0.96×** |
| Scroll fps, top / bottom | 60.0 / 60.0 |
| Full repaint | 0.200 ms, **0 DOM mutations** |
| Range drag, top / bottom | 2.0 cells a move at both ends, ratio 0.88× |
| Select all 100k | 28.3 ms, 39 rows marked, 0 mutations |

**What the hooks themselves cost: +0.012–0.015 ms on a full repaint of every visible cell,
which is 1.24×–1.32×.** Measured by `measureClassHooks`'s method taken further — 40 paired
repaints, alternating all-four-on against all-four-off *within each pair* so page drift lands on
both, run twice with the order inside the pair reversed: 0.0650 vs 0.0525 ms one way and 0.0625
vs 0.0475 the other. **DOM mutations stay 0 in every configuration**, which is the exact half of
this measurement.

⚠ **Measured in blocks rather than alternating pairs, this comparison lies.** A first attempt
timed each configuration as a run of 60 repaints and reported the *bare* grid at 0.090 ms against
`onCellClass` alone at 0.074 — the hooks apparently making the grid faster. A full repaint costs
~0.05–0.1 ms here and the webview's timer quantizes near 0.1 ms, so block ordering dominates a
difference of 12 µs. Same lesson as `measureRangeDrag` and the 100k example: when the quantity is
smaller than the clock, pair the samples or quote the exact counter instead.

The correctness half — and the one no unit test can reach, because happy-dom pools nothing under
real layout — is that a class **goes away** when its hook stops asking for it. Pooled cells arrive
holding their last occupant's classes, and the class name is assembled from scratch and assigned
once per paint, so removing all four hooks from a live 100,000-row grid leaves
`flagged: 0, low-score: 0, inactive: 0, score-header: 0` from 70/10/130/1, and restoring them
brings back exactly those counts. `window.avg.measureClassHooks()` reports it as `cleared: true`.

## Task 22 — custom cell editors — 2026-08-11

`Column.editor` puts a host-built control in the cell. Nothing in it runs per paint — an editor is
built once when an edit opens — so what had to be shown is that task 12's gate still holds when the
element in the cell belongs to someone else, and that the editor is torn down every way an edit can
end. The board's `joined` column is now edited by an `<input type="date">`;
`window.avg.measureCustomEditor(row)` drives it.

The gate on 100,000 rows, with the date editor installed:

| | |
|---|---|
| First paint | 11.8 ms |
| Paint cost at row 100 / near the bottom | 0.167 ms / 0.159 ms |
| **Flat ratio** | **0.95×** |
| Scroll fps, top / bottom | 60.0 / 60.0 |
| Full repaint | 0.100 ms, **0 DOM mutations** |
| Range drag, top / bottom | 2.0 cells a move at both ends, ratio 1.10× |
| Select all 100k | 22.8 ms, 39 rows marked, 0 mutations |
| Built-in editor (task 12's own gate) | 0 mutations while editing, same element after a repaint |

**Task 22's own gate — a *host* editor, at row 100 and at row 99,000, identical both times:**
opening it marks **1 cell** dirty, a full repaint of every visible cell while it is open does
**0 DOM mutations** and hands back **the same element**, in the same cell. The element carries
`avg-cell-editor` and fills the cell (167×21 px, screenshotted), Escape cancels and Tab commits and
moves on with the editor handling neither, and `destroy` is called exactly once on each ending.

**The teardown finding, which is why this section is longer than the numbers deserve.** Scrolling
the editing row 1,000 rows away closes the edit and calls `destroy`: `closed: true`,
`destroyed: 1`, nothing left in the DOM. It did not before. `releaseCell` fires when the editing
cell is *repainted* as a different coordinate, and a long scroll does not do that — the pool
**evicts** the element, removing it from the DOM and giving the new coordinate a different one, so
no renderer ever runs for it. The edit stayed open around a detached element: a text box the user
could no longer reach, and for a `CellSelect`-style editor a popover left on `document.body`.
`EditingModel.onViewportScrolled` closes it, from the `scroll` listener `GridInteractions` already
had, and returns on one comparison when nothing is open. Pre-existing, and it affected the built-in
editors identically.

Two things about how that check is written are load-bearing:

- **It reads the render window, not `element.isConnected`.** The window is recomputed synchronously
  inside `onScroll`, *before* the paint that evicts anything, so the answer is already correct and
  costs nothing. The first version waited a frame and asked the DOM, which made it depend on
  whether the paint's frame had been queued before the check's — it is, sometimes, and the test
  failed intermittently for exactly that reason.
- **`rendered`, not `visible`.** Overscan rows have cells too, and closing an edit on a row that is
  merely off-screen-but-rendered would fire on an ordinary scroll of two rows.

Verified in the other direction as well, because a check like this fails silently by firing too
often: a two-row scroll leaves both a custom and a built-in editor open, still holding the same
element.

## Task 23 — custom filter types — 2026-08-11

`Column.filter` puts host code where nothing else in this library puts it: **inside the row loop**,
called once per row per pass. So the question is not what a filter costs — task 15 answered that —
it is what the callback costs *against the built-in test it replaces*, and what the one piece of
advice the docs give about writing one is worth. `window.avg.measureCustomFilter(count)` drives it;
the board's `Score` column is now filtered by a min/max range whose bounds are parsed once in
`getValue`.

**The grid path, on 100,000 rows.** Applying, changing, ANDing with a built-in filter, clearing:

| | ms | paints | DOM mutations | rows left |
|---|---|---|---|---|
| First apply (`0–666`) | 5.3 | 1 | **10** | 66,601 |
| **Change it (`0–300`)** | **4.6** | **1** | **0** | 30,001 |
| Plus a built-in `status` filter | 5.6 | 1 | **0** | 12,001 |
| Clear everything | 0.1 | 1 | 10 | 100,000 |

**The row that is the gate is the second one.** The ten mutations either end are the filter *bar*:
the first filter makes it appear, the grid loses 32 px of height, and one row of cells goes with it
— the same ten task 17 measured. A filter *change*, with the bar already up, costs **one repaint and
zero DOM mutations**, and so does adding a built-in filter on top of a custom one. Clearing costs
0.1 ms because an unfiltered pass returns the array it was given.

**The popover.** Opening the Score funnel marks **1 cell** — the header cell the funnel lives in —
and mutates **0** DOM nodes. The body is the host's element (`bodyMounted: true`), **no checklist is
built at all**, `focus` reaches the `min` input, Apply reads `getValue()` and narrows to 25,001 rows,
and `destroy` runs exactly once on the way out. The chip reads `Score: 0 – 300` from the
definition's `label`, alongside `Status: open,pending` from the built-in one, in the same bar.

**The row loop: a host `match` against the built-in `"options"` test.** Both keep ~66,600 of 100,000
rows, so the survivor array costs the same and what is left is the test itself. Alternated within
pairs, then again with the order inside the pair reversed; four runs:

| | |
|---|---|
| A host `match` (two numeric comparisons) | **1.6–2.0 ms** |
| The built-in `"options"` test (one option) | **2.1–3.2 ms** |
| **Ratio** | **0.63×–0.93×**, four runs clustering at **0.78–0.82×** |

**A custom filter is *cheaper* than the built-in one.** Worth stating plainly, because the intuition
is the opposite. The built-in path resolves each row's value through `filterValue`, which checks the
column for a `formatValue`, and then compares it with `optionMatches`, which tests for an option
object and for two `Date`s before it reaches `===`. A definition's `match` skips all of that: its
value arrived in the shape it wanted. The honest comparison is task 15's **+8.7%** for putting
`columnDisplayValue` inside the search loop — a host callback in the row loop is not automatically
expensive, and this is the other sign of the same thing.

**Parsed once against parsed per row — the number behind the docs' warning.** The same date-range
filter written the two ways, same rows, same 66,667 survivors:

| | |
|---|---|
| Bounds resolved in `getValue`, `match` compares numbers | **1.6 ms** |
| `match` calling `Date.parse` on the row and on both bounds | **90 ms** |
| **Ratio** | **56×** |

That is why `match` has no `prepare` companion: the value is data the definition controls, and
putting the parsed form in it *is* the optimization. Fifty-six times is not a micro-optimization; it
is the difference between a filter that applies imperceptibly and one that visibly stalls.

**One measurement trap, and a new one.** The alternating-pairs discipline is now standing practice
and was used here from the start. The new one is the environment: **a backgrounded webview throttles
everything**. The same row-loop pass measured 14.0 ms with `document.hidden === true` and 1.7 ms
once the window was in front — an 8× difference with identical code, and rAF does not run at all, so
nothing that awaits a frame completes. Any number quoted from this board is only meaningful with the
window visible; check `document.hidden` before believing a timing.

## Task 24 — `copyValue` — 2026-08-11

Not the render path: `copyValue` is read by `CopyPasteModel.cellText` and by nothing that paints,
so there is no gate to re-run. What is worth recording is that the hook is **cheaper than the
alternative it replaces**, for a reason specific to what it replaces.

The board's `Rating` column renders five glyphs and carries `copyValue: (c) => stars(c.row)`.
`window.avg.measureCopyValue(1000)` copies that column's 1,000 cells both ways — 20 alternating
pairs, the order inside the pair flipped every iteration:

| | |
|---|---|
| With `copyValue` | **0.20 ms** |
| Without it, reducing `render`'s markup to text | **1.24 ms** |
| **Ratio** | **0.16×** |

**Six times cheaper, because the fallback is expensive rather than because the hook is fast.** With
no `copyValue`, a column that has a `render` and no `formatValue` is copied by calling `render` per
cell and then reducing what comes back to its text — for a string that means an `innerHTML` write
into a scratch `<div>` and a `textContent` read out of it, per cell. `copyValue` skips both, and the
copied text shrinks from 6,000 characters of `★★★☆☆` to 2,000 of digits.

The behavioural half, in the browser rather than in happy-dom: a real `ClipboardEvent` over rows
1–3 × all nine data columns copies `1 Ada Lovelace platform Ada Lovelace open 0 **1** false`,
tab-separated, and `copyAsJson` writes `"rating": 1` as a **number** — the hook's return value is
not stringified on the way out.

## Task 26 — `sortValue` — 2026-08-11

`Column.sortValue` is the second hook this phase that puts host code in a loop over every row, and
the first where the *number of calls* is the design question rather than the cost of each one.
`Array.sort` calls its comparator O(n log n) times, so a projection written inside a `rowCompare`
runs that many times; `sortValue` is read once per row into a parallel array, which is sorted and
unwrapped. `window.avg.measureSortValue(pairs)` runs both forms of the same order, alternating
within pairs with the order flipped every iteration, and counts the calls rather than trusting the
arithmetic.

**On 100,000 rows, with both forms asserted to produce the same order** (`sameOrder: true`):

| The projection | `sortValue` | inside `rowCompare` | ratio | calls per sort |
|---|---|---|---|---|
| `RANK[row.status]` — a table lookup | **10.3 ms** | 10.8 ms | 0.95× | 100,000 vs **1,209,558** |
| Two `toLowerCase()` and a concat, `localeCompare` | **17.5 ms** | 46.9 ms | **0.37×** | 100,000 vs **1,325,678** |

**Twelve times fewer calls buys 5% on a table lookup and 2.7× on a projection that does work.** That
is the honest shape of it, and the cheap row is the interesting one: the decoration allocates a
wrapper object per row and walks the array twice more, which eats almost all of the saving when the
projection is a single property read. It never loses, and the more the projection does the more it
wins — which is the right way round, because a projection worth extracting is one that does
something. An earlier run of the same lookup case read 9.3 ms against 10.6 ms (0.88×); treat that row
as a wash rather than a number.

Not the paint path: a sort marks the header row for its indicator and repaints the viewport once,
which is what it did before. No gate re-run.

## History

| Date | Task | First paint | Flat ratio | Scroll fps (top / bottom) | Allocations | Note |
|---|---|---|---|---|---|---|
| 2026-08-08 | 5 | 5.6 ms | 1.02× | 60.0 / 60.0 | 0 | Baseline. Gate passed. |
| 2026-08-08 | 9 | 8.0 ms | 0.93× | 60.0 / 60.0 | 0 | Whole grid, real cell renderers. No regression. |
| 2026-08-08 | 10 | 6.7 ms | 1.08× | 60.0 / 60.0 | 0 | Focus and range selection. Drag ratio **1.04×**, 2 cells marked per move at both ends. |
| 2026-08-08 | 11 | 5.8 ms | 0.89× | 60.0 / 60.0 | 0 | Row selection + checkbox column. Select-all on 100k: 24.9 ms, **19 rows marked**, 0 mutations. |
| 2026-08-08 | 12 | 5.7 ms | 0.94× | 60.0 / 60.0 | 0 | In-cell editing. Editing at row 99,000: **1 cell marked**, **0 mutations**, editor survives a full repaint. No regression. |
| 2026-08-08 | 14 | 7.4 ms | 0.98× | 60.0 / 60.0 | 0 | Row/column add and delete. Adding a row above the viewport at row 90,000: **0 mutations**, scroll and focus both kept — after fixing a focus-recentre that moved the viewport 261 px. |
| 2026-08-08 | 13 | — | — | — | — | Clipboard. Render path untouched, so no gate re-run: paste into 1,000 cells marks **1 repaint** and mutates **0** DOM nodes; copying 500 rows costs 0.7 ms. |
| 2026-08-08 | 14b | — | — | 60.0 | 0 | `VirtualList`. 100,000 options: mount **4.4 ms**, **11 rows** in the DOM, flat ratio **1.00×**, select-all 9.0 ms in **1 repaint**. Separate engine instance, so no grid gate re-run. |
| 2026-08-08 | 14a | — | — | — | — | `Popover`. Not on the render path. Verified in the browser: flip, clamp, height cap with a scrolling body, follow-on-scroll, Escape, outside click, focus restored, resize drag exact. |
| 2026-08-09 | 15 | 2.9–6.0 ms | 0.84× | 60.0 / 60.0 | 0 | Filters model + row filtering. 100k → 40,000 in **5.9 ms**, back up in **0.0 ms**, **1 repaint** and **0 mutations** either way, 60 fps filtered. Searching a computed column costs **+8.7%**. |
| 2026-08-09 | 16 | 4.9 ms | 0.92× | 60.0 / 60.0 | 0 | Filter popover + options body. Opening one over 100k rows marks **1** thing on the grid and mutates **0** DOM nodes; a column with 100,000 distinct values holds **12** rows in the checklist. |
| 2026-08-09 | 17a | 5.3 ms | 0.91× | 60.0 / 60.0 | 0 | Cell dropdown on `Popover` + `VirtualList`. A column with **10,000 options** puts **13** rows in the DOM and mutates **0** grid cells; the list is themed by the same `--p-*` tokens as the grid, which the native `<select>` never was. |
| 2026-08-09 | 17 | 9.5 ms | 0.70× | 60.0 / 60.0 | 0 | Filter bar. Every filter change while the bar is up mutates **0** DOM nodes; the bar appearing or disappearing costs one row of cells, because it takes 32 px off the grid. First paint is measured full-width here, not slower. |
| 2026-08-10 | 18 | 8.0 ms | 0.88× | 60.0 / 60.0 | 0 | Introspection and teardown. 100 create/destroy cycles: **0 DOM nodes leaked**, **100/100 grids collected**, 6.5 ms a cycle. `getState()` is JSON-serializable throughout. Render path untouched; gate re-run for the record. |
| 2026-08-10 | polish | 8.0 ms | 0.94× | 60.0 / 60.0 | 0 | Editing polish: a press on the focused cell opens the editor, and an editable boolean cell carries a checkbox that toggles on the press. `DataCell` gained two comparisons on the boolean branch and no allocation on any other — every branch returns one of five constant strings, so an unchanged cell compares equal and is not touched. Full repaint still **0.1 ms / 0 mutations**, drag still **2 cells a move** at both ends, select-all still **0 mutations**, editing gate unchanged. |
| 2026-08-11 | polish | 8.8 ms | 0.88× | 60.0 / 60.0 | 0 | A commit marks the edited **row**, so a computed column cannot go stale. One mark, one paint, and the bulk writers are untouched because they were already `silent` + one `{ all: true }`: a 1,000-row paste still costs **1 mark and 0 DOM mutations**. `measureEditing`'s `dirtyCellsOnCommit` counts `cells + rows`, so its `1` is now one row. |
| 2026-08-11 | polish | 10.2 ms | 0.85× | 60.0 / 60.0 | 0 | An untouched trailing row is deleted when the focus leaves it. Not the render path — the hook is one `undefined` comparison at the end of `applyFocus`, which is why the range drag, whose every pointer move goes through it, still costs **2 cells a move** at both ends and reads a **0.88×** ratio. Full repaint **0.1 ms / 0 mutations**, select-all **0 mutations**, insert above the viewport **0 mutations**. First paint drifted up 1.4 ms with nothing on the paint path changed; it is a cold-JIT number on a shared machine and the ratio is what the gate is about. |
| 2026-08-11 | polish | 5.6 ms | 1.11× | 60.0 / 60.0 | 0 | The context menu, on a new `Menu` primitive. Opening one over 100,000 rows marks **0** things on the grid and mutates **0** DOM nodes — and costs **2.3 ms with all 100,000 rows selected against 2.9 ms with one cell**, because the items are built from `selectedCount` and `e.selection` is a getter nothing built-in reads. The render path is untouched: the only change inside the grid is one branch in the `contextmenu` handler. |
| 2026-08-11 | polish | 8.8 ms | 0.86× | 60.0 / 60.0 | 0 | Row hover follows the pointer during a drag and during a wheel scroll. Hover moved from `mousemove` to `pointermove`, because `preventDefault()` on `pointerdown` suppresses the compat mouse events — and a stationary pointer now re-resolves after the paint on `scroll`. The gate is unchanged (drag **2 cells a move** at both ends, full repaint **0 mutations**, select-all **0 mutations**) because `onScrolled` returns immediately with no pointer over the grid, which is every programmatic scroll. A real wheel scroll under the pointer costs **0.291 ms a paint against 0.120 ms**; hover moving on its own is **0 mutations, 0.045 ms**. |
| 2026-08-11 | 21 | 9.2 ms | 0.96× | 60.0 / 60.0 | 0 | The four class hooks — `Column.cellClass`, `Column.headerClass`, `onCellClass`, `rowClass` — all live on the board's 100k grid. Full repaint 0.200 ms and **0 DOM mutations**; the hooks themselves add **+0.012–0.015 ms (1.24×–1.32×)** to a full repaint of every visible cell, measured as 40 alternating pairs run twice with the pair order reversed, because measured in blocks the comparison came back backwards. A class **disappears** when its hook stops asking for it: 70/10/130/1 marked cells → 0/0/0/0 with the hooks removed, and back again. |
| 2026-08-11 | 22 | 11.8 ms | 0.95× | 60.0 / 60.0 | 0 | Custom cell editors. A host's editor at rows 100 and 99,000: **1 cell marked on open, 0 mutations on a full repaint, same element back**. Found and fixed a pre-existing leak — a long scroll *evicts* the editing cell rather than repainting it, so the edit stayed open around a detached element. |
| 2026-08-11 | 26 | — | — | — | — | `sortValue`. Not the render path. A projection read **once per row (100,000 calls) against 1.2 million inside a comparator**: 10.3 ms vs 10.8 ms for a table lookup — a wash, the wrapper allocation eats the saving — and **17.5 ms vs 46.9 ms (0.37×)** for a projection that does real work. Both forms asserted to produce the same order. |
| 2026-08-11 | 24 | — | — | — | — | `copyValue`. Not the render path, so no gate re-run. Copying 1,000 cells of a glyph-rendered column costs **0.20 ms with the hook against 1.24 ms without it (0.16×)** — the fallback reduces `render`'s markup through a scratch element per cell. `copyAsJson` keeps the returned number a number. |
| 2026-08-11 | 23 | 6.9 ms | 0.78× | 60.0 / 60.0 | 0 | Custom filter types. A filter change on 100,000 rows: **1 repaint, 0 DOM mutations**; opening a host's filter body marks **1 cell** and mutates **0**. The host `match` costs **1.7 ms against the built-in test's 2.1 ms (0.78×)** — cheaper, because the built-in path resolves `formatValue` and `optionMatches` per row and a definition's `match` does not. The same filter re-parsing its bounds per row costs **90 ms, 56×** as much, which is the number the docs' warning now quotes. |
| 2026-08-11 | 25 | — | — | — | — | Customization docs, example and board — plus the freeze fix driving the example found. `measureFilter(100000)` after it: filter down **3.0 / 2.9 ms** on the second and third runs (10.6 cold), narrow **6.2 ms**, back up **0.2 ms**, **1 repaint** each, and **11 DOM mutations** on the first filter and the last removal, which is the filter bar's 32 px and not the filter. Unchanged from task 23's row. `RowsModel.refilterRows()` adds one `if` on a filter or search change and nothing at all on a paint. |
| 2026-08-11 | fix | 3.0 ms | 1.03× | 60.0 / 60.0 | 0 | A percentage column width fits on its own, so it must suppress the trailing whitespace too. A single `width: "35%"` column with `fitToWidth` off produced a horizontal scrollbar exactly `whiteSpace` (20 px) wide on a grid whose columns already totalled the usable width — the scrollbar *was* subtracted correctly (columns fitted to 1203 = 1215 − 12), the slack was added on top of a perfect fit. `hasPercentLength()` now decides `columnsFitted`, which `calcInnerSize` and `rerender-check` read instead of the option. Costs one pass over the **columns** (20 of them here, never the rows) per geometry recompute: gate unmoved. Measured on the board: `scrollWidth − clientWidth` **20 → 0**. |
| 2026-08-11 | fix | 8.6 ms | 0.86× | 60.0 / 60.0 | 0 | Two host-reported bugs. (1) DOM focus now lands on the root from **any** press inside the grid, not only from one that resolves to a data cell — a header press left the arrow keys dead. `focusRoot()` runs once per `pointerdown`, does one `closest()` against a short selector, and touches nothing on a paint: full repaint **0.1 ms / 0 mutations**, drag still **2 cells a move** at both ends. (2) Explicit `columns` that omit `width` now get one detected from content, which the docs had always promised and only inference delivered. The scan is **50 rows × the columns that omitted a width**, once per `validateColumns` — first paint 8.6 ms with every column detected, against 8.0–10.2 ms for the same board with all widths given. Measured through `columnDisplayValue`, so a `displayFormat: "date"` column reads **84 px** rather than the 40-character `Date.toString()` the raw path would have measured. |
| 2026-08-11 | feat | 11.3 ms | 0.81× | 60.0 / 60.0 | 0 | Search-word highlighting in the default cell. `measureHighlight("a")` at 100,000 rows — 97,500 kept, **93 of 451 visible cells marked** — reads **0.1 ms / 0 mutations** on a full repaint and **59.99 fps** on a scripted scroll, digit for digit what the same two read with the search off. Three things buy that: the words are split once per `updateRows()` onto `data.searchWords` rather than per cell, a cell with no match returns `null` from `highlightMarkup` and stays on the single-text-node `setText` path, and a matching cell compares against the markup it last wrote (a `WeakMap`) instead of reading `innerHTML` back. The *shape* — `"text"` / `"background"` / `"both"` — is one attribute on the root, so it costs nothing per cell and switching repaints nothing. First paint 11.3 ms with no search is a cold-JIT number on the same board that read 9.9 ms minutes earlier; the ratio and the fps are what the gate is about. Boards: AVGridBoard by eye in all four states, CustomizationBoard 20/20. |
| 2026-08-12 | feat | 10.0 ms | 0.78× | 60.0 / 60.0 | 0 | `CellContext.highlight` — the way a `render` column marks the search, since the grid will not reach inside a hook's markup. One function per *grid*, not per cell: `AVGridModel.highlightText` is built once and the context takes a reference, so the hook costs one property write on an object that was already being allocated. Re-measured with it live on the board's computed Full Name column: `measureHighlight("a")` at 100,000 rows, **119 of 451 visible cells marked**, still **0.1 ms / 0 mutations** on a full repaint and **59.98 fps** on a scroll — identical to the search-off reading beside it. Found a real layout bug doing it: a data cell is `inline-flex`, and flex discards whitespace *between* items, so `Alan <span>Dijkstra</span>` rendered as **"AlanDijkstra"**. Marked output is now wrapped in one `avg-search-text` inline box; measured against the same row unmarked, width and `scrollWidth` are **identical**, so a mark changes appearance and never layout. The reference solves this by rewriting those spaces to U+00A0 — the wrapper is better, because `textContent`, a selection and a copy all still read the text the row holds. |
| 2026-08-22 | 30, 31 | 10.7 ms | 0.94× | 60.0 / 60.0 | 0 | `whiteSpaceY` exposed, and `extraElement` parented after the last row. `whiteSpaceY` feeds `calcInnerSize`, which is why this row exists: it adds no work at all — the arithmetic already read `whiteSpaceY ?? whiteSpace`, and the option was simply never passed. Verified as geometry rather than as a timing: content height **24,025 + the slack**, measured at `0` / default 20 / 24 / 80 as **24,025 / 24,045 / 24,049 / 24,105**, with the slack below the last row at full scroll reading **1 / 21 / 25 / 81 px**. `extraElement` is an overlay, so `syncRegion` never reconciles it: a full repaint of every visible cell with a footer parented mutates **0** DOM nodes, the same as without one. The check that matters for it is not a number — a 100,000-row scroll that **released 18,040 cells** left the host's element connected, unmutated and its click listener still firing, which is the pool-eviction failure plan 02's log recorded for the editor. Gate re-run for the record: drag **2 cells a move** at both ends, full repaint **0.2 ms / 0 mutations**, sort 23.2 ms. |
| 2026-08-22 | fix | — | — | — | 0 | A `render` column's markup is compared against the last string **assigned**, not against `innerHTML`. The getter serializes the subtree, so the old comparison held only for markup written exactly the way the serializer emits it: a hook that self-closes a tag (`<path … />` → `></path>`) or lowercases an SVG attribute (`viewbox` → `viewBox`) re-parsed its cell on **every** repaint that touched it — a hover move, a selection change — invisibly, and undiscoverably from the hook. The `WeakMap` the search-highlight path already used for this reason now covers both markup modes. Measured as the deterministic counter rather than a timing, on a 12-row viewport with one self-closing-SVG `render` column: childList node mutations on a full repaint **36 → 0** (3 per cell — the old subtree removed, the new one added), attribute mutations unchanged at 112 either way. Strictly less work: a `WeakMap` get replaces a serialization, and the write it guards is the one that was never needed. **The board gate was not re-run** — the change removes DOM writes and adds no per-cell allocation, and the paint-timing harness needs a browser; the counter above is the number this change is about. Trade-off, unchanged from the highlight path and now documented on the map: a host that mutates the DOM *inside* a cell behind the grid's back finds it preserved rather than overwritten. |
| 2026-08-22 | fix | — | — | — | 0 | **A text cell's content moved into an `.avg-cell-text` span, because the cell could never ellipsize its own text.** `.avg-data-cell` is `inline-flex`, so a bare text node in it becomes an *anonymous flex item* — a generated block box that inherits neither `overflow` nor `text-overflow` — while the `overflow: hidden` doing the clipping sits on the flex container, which has no line box to truncate. So the `text-overflow: ellipsis` in this stylesheet had **never** had any effect: every clipped cell was cut mid-glyph. Worse in a right-aligned column, where the overflow of a nowrap flex line moves to the *start* side, so `123456789012` in a 70px numeric column rendered as `456789012` — a wrong number that still reads as a number. Verified in Chromium against the built bundle, before and after, by screenshot. **Measured as counts, because that is what the change is about, and every counter is identical to 2.2.2**: 100,000 rows × 3 columns, 75 visible cells / 75 wrappers, driven over CDP with a `MutationObserver` on the grid root. A full `refresh()` — **0 childList nodes, 321 attributes** on both builds, twice in a row; a scroll to row 99,000 — **162 / 0** on both; a `refresh()` at row 99,000 — **12 / 321** on both; switching the search on — **75 / 22** on both; a `refresh()` with search live — **12 / 309** on both. The wrapper is therefore free per frame, which is the whole design: `setMode` already reports whether it cleared the element, so a pooled cell builds the span once per *content-shape change* (~250 over a grid's life) and every repaint after that is the same single `nodeValue` compare-and-write `setText` always did, one level deeper. **The board timing gate was not re-run** — it needs a browser and a Persephone build; the ms/fps columns are left blank rather than carried over, and the counts above are the number this change is accountable for. Also in this release: `focus.isDragging` no longer latches on a press that announced a drag and then took an early exit (the boolean toggle, and a press on a cell with an open editor), which is bookkeeping and costs no paint. |
| 2026-08-30 | 33 | 1.2 ms | 0.97× | 60.0 / 60.0 | 0 | **The keyed cell pool.** `CellPool` went from one array to one bucket per reuse key, which puts it on the scroll path in a new way and is why this row exists. Measured **A/B against the pre-change bundle on the same board in the same session** (stash, `build:board`, `board_refresh`, back again), because at 0.15 ms a paint the ratio alone is noise: warm flat-cost ratio **0.86 / 1.02 before** against **0.87 / 0.94 / 0.97 / 1.06 / 1.10 after** (median 0.97), paint cost **0.12–0.14 ms before** against **0.13–0.18 ms after**, 60.0 / 60.0 fps and **0 pool misses while scrolling** on both. A full repaint of all 240 visible cells is **0 childList mutations / 480 attribute writes / 0.1 ms — digit for digit identical on both builds**, three runs each. First paint is quoted warm; the first `runBenchmark()` after a page load reads 1.4–1.5× on either build and is a cold-JIT number. **The unkeyed path is not merely unregressed, it is unchanged**: with no key every cell lands in one bucket and `acquire` is still a `pop`. | The feature itself was driven in a real browser rather than only in happy-dom, on a second `RenderGrid` over 50,000 rows of three interleaved kinds: a 60-frame scroll took **177 pool hits against 14 misses, 0 wrong-kind reuses, and 3 rebuilds after the initial 11** — after warm-up every admission arrived already the right shape — with all 10 visible cells rendering the kind their row asked for, confirmed by screenshot. The structure was chosen by measurement, not taste: the reference's backward linear scan costs **2,177 ns against the bucket's 24.8 ns** at a 2,000-element pool when half the requests ask for a kind the pool does not hold, and grows linearly from there. |
| 2026-08-30 | 35 | 1.0 ms | 1.09× | 60.0 / 60.0 | 0 | **The scroll-loss defect, both faces.** The render path is touched twice — `syncRegion` split into `evictCell`/`admitCell`, and a restore added to the paint's early-return branch — so this row is an **A/B against HEAD (2.2.4) on the same board in the same session** (stash, `build:board`, `board_refresh`, restore), because at 0.15 ms a paint the ratio alone is noise. Four `runBenchmark()` runs each: ratio **0.86 / 0.96 / 0.92 / 1.18 before** against **1.21 / 1.20 / 1.00 / 0.98 after** (medians 0.94 vs 1.10, fully overlapping), paint cost **0.110-0.182 ms before** against **0.117-0.188 ms after**, 60.0 / 60.0 fps and **0 pool misses** on both. A full repaint is **0 childList mutations and exactly 2 attribute writes per cell on both builds** (504/252 cells before, 480/240 after - the viewport differed by one row between refreshes; per cell it is identical), three runs each. The default path is unchanged by construction: with `keepCellsAttached` off, `evictCell` is the same `removeChild` + `release` behind one boolean, and `admitCell` adds one `parentElement` comparison and no `WeakMap` read. | **`keepCellsAttached: true` is not a cost, it is a saving, on the cells it is for.** Measured on a 400-row grid whose every cell holds a nested scroller and an `<iframe>`, driven 40 rows down and back: **0.586 ms a paint against 1.648 ms (0.36x)** and **40 childList mutations against 160**, at the price of 240 attribute writes (the `display` toggle) and **150 nodes held in the document against 30** — bounded by the pool's `maxSize`, since overflow is the one eviction path that still detaches. The saving is the iframe: detaching destroys its document and re-admission reloads it (`load` 1 -> 2), which costs far more than a `display` write. The defect measurements themselves: face 1, a detach/re-append at `scrollTop: 20000` — **20000 -> 0, no scroll event, 456 of 468 px of viewport unpainted** before; **20000 restored, 0 px unpainted** after, on the same 100,000-row grid. Face 1 same-task reparent — reset just the same with **`resizeObserverSaw0x0: false`**, which is why a `MutationObserver` on the ancestors and not a size check. Face 2 — nested `scrollLeft` **300 -> 0** and the frame reloaded, before; **300 -> 300** and one `load` total, after. And the regression this is most likely to cause, checked explicitly: a genuine scroll to the top with an ancestor mutating every frame still lands at 0, and 30 frames of continuous scrolling under the same churn land exactly where asked. |
| 2026-08-30 | 36, 37 | 1.0 ms | 1.00× | 60.0 / 60.0 | 0 | **After-paint scrolling, and a live shell layout.** The render path is touched once: `flushPendingScroll()` now runs at the end of *every* paint, in both branches. That is why this row exists, and the guard order is the whole of the cost story — `_disposed || !pendingScrollRow || !measured`, with the empty-slot test **before** `measured`, which reads `container.offsetHeight` and can force layout. A paint with nothing queued therefore pays one boolean. Four `runBenchmark(100000)` runs: ratio **1.68 / 1.04 / 1.02 / 1.00** — the 1.68 is the first run after a page load, with `firstPaintMs` 2.8 and `dataMs` 36.2 against 1.0 and 5.2 warm, the cold-JIT reading every previous row has noted; the three warm runs are **1.00–1.04×**. Paint cost **0.122–0.135 ms** top and bottom, 60.0 / 60.0 fps, **0 pool misses** on all four. A full repaint of every visible cell, three runs: **0 childList mutations / 400 attribute writes over 200 cells (2 per cell) / 0.2 ms** — unchanged from tasks 33 and 35. `setOptions`' layout branch is not on the paint path at all: it fires only when one of four fields actually changed, and a `setOptions` that touches none of them forces no paint (asserted). | **The defects, before and after.** Gap 4, measured on a grid grown 20 → 3,000 rows in one turn and asked for row 2,000 — a request for `scrollTop: 48000` against an old extent of exactly 100 px: `scrollToRow` landed at **100**, `setTimeout(0)` at **100**, one `requestAnimationFrame` at **100**, and `scrollToRowAfterPaint` at **48000** with row 2,000 painted at the top. So the fork's `setTimeout(0)` claim is confirmed by measurement rather than trusted, and the `rAF` result is new: it fails because the paint is itself scheduled on `rAF` and a callback taken out in the same turn is queued ahead of it. The three wrong entry points read **100 after the fix too** — they are the wrong call, not a regression, and leaving them unchanged is what makes this additive. The shared slot's other half: a `scrollToRow` for row 1,500 issued while the host was `display: none` landed at **0**, now **36000**. Gap 5: a `setOptions({ growToHeight: "150px" })` on a grid in a 400 px host left the root at **400 px / `max-height: unset`**; it now reads **150 → 260 → 400 px** across three calls, with `max-width: 320px` and `overflow-x: hidden` following `growToWidth` / `fitToWidth`, and the geometry following too — a grid capped at 100 px showing 5 rows shows **16** at 360 px. **Task 35's rig re-run and unchanged in every figure**, which was the point of doing these two together: face 1 restored to 20000 with **0 px unpainted**, the same-task reparent likewise (`resizeObserverSaw0x0: false`), `manualRevalidate` **0 → 20000**, retention keeping a nested `scrollLeft` of **300** and **one** iframe `load`, and a genuine user scroll to the top still landing at **0**. And the new conflict, measured: a host reparenting the grid in the same turn as an after-paint scroll lands on **28800**, the row asked for, not on the stale **20000**. |
| 2026-08-30 | 34 | 1.0–1.4 ms | 0.97× | 60.0 / 60.0 | 0 | **Measured row heights, and the fixed-height gate held unmoved.** The engine is touched in three places — `RerenderInfo.fromRow` honoured in `prepareRerender`, carried through `mergeRerenders`, and an `onCellAttached` / `onCellReleased` pair fired from `admitCell` / `evictCell` — so this row exists even though the feature itself is a **companion module the default path never constructs**. Three warm `runBenchmark(100000)` runs: ratio **0.97 / 1.22 / 0.95**, first paint **1.2 / 1.0 / 1.4 ms**, paint cost **0.127–0.155 ms** top and bottom, 60.0 / 60.0 fps and **0 pool misses** on all three (the cold first run after a page load read 1.22× with `firstPaintMs` 2.7 and `dataMs` 27.9, the cold-JIT reading every previous row has noted). Digit for digit the numbers tasks 35, 36 and 37 recorded. The cost added to the default path is two `undefined` property reads per cell transition — `this.options.onCellReleased?.(el)` and `this.options.onCellAttached?.(el)` — and, in `prepareRerender`, one `!== undefined` test per call. `fromRow` is bounded by the rendered window on both ends like every other dirty-set entry, so marking from row 12 of 100,000 costs a viewport. | **What the measured path itself costs, measured rather than estimated.** 5,000 rows of randomly wrapped text through a 400 px viewport, driven top to bottom in 60 steps, against **the same rows and the same renderer** at a fixed 48 px: **0.685 ms a paint against 0.119 ms — 5.8×** — with **1,242 pool misses against 11**, both holding **60.0 fps**. The misses are the mechanism, not a defect: every committed height moves the geometry, which moves the window, which admits cells the pool has not been handed yet. **The cost is transient, and that was checked rather than assumed** — a settled measured grid takes **0 paints and 0 pool activity over a second**, and a full repaint of every visible cell does **0 DOM insertions or removals**, the `previous` path holding exactly as it does for the fixed grid. The feature's own numbers, from `window.measured` on the RenderGridTest board: hints drive the first geometry to the pixel (**extent 300,020**, the hint sum + the 20 px slack) and settle to 40–104 px measured, row 1's offset **40 → 72**; a fully-walked 400-row list sums to **26,640** against an inner height and `scrollHeight` of **26,660**, 0 rows unmeasured; a row grown **88 → 296** moves the **seven** rendered rows below it by exactly **208 px each**, leaves the row above it at its offset and re-renders none of their content — which is the whole of what `fromRow` buys; and, the interaction most likely to be silently wrong, a `keepCellsAttached` cell that never leaves the document measures **0** while hidden (ignored, not committed — its height stays 72) and, re-admitted as **the same element**, is measured again to **280**, matching its laid-out height. Tasks 35, 36 and 37's rigs were re-run and are unchanged in every figure. |
| 2026-08-31 | 39 | 5.4 ms | 0.68– 0.77× | 60.0 / 60.0 | 0 | **`focus` became an option, which put a value comparison on the drag path.** `FocusModel.applyFocus` guarded on `next === previous`; that is enough while every caller is internal and hands back the previous object when it means "no change", and it stops being enough the moment a host echoes the focus back as an option — the object that returns is equal but new. So the guard is now `sameFocus`, eleven field comparisons behind an identity fast path. It runs **once per focus change** — once per cell a drag crosses, not once per pointer move and never once per cell painted — which is why the gate is unmoved: three warm `runBenchmark(100000)` runs read a **range-drag ratio of 1.08 / 0.77 / 0.84**, **2 cells marked per move at both ends** with **0 DOM mutations**, flat ratio 0.68–0.77×, 60.0 / 60.0 fps, a full repaint of every visible cell at **0.0–0.1 ms / 0 mutations**, select-all 23.9 ms / **0 mutations**, sort 20.3–23.0 ms. Every internal caller still hits the identity check first, so the eleven comparisons are paid only by a host that sets the focus. | **The browser found a defect the unit tests could not.** Driven as a controlled React prop — `focus={focus} onFocusChange={setFocus}` with a `structuredClone` in between — a plain click left `isDragging: **true**`, because the echo carries the *previous* event's value: the one from `pointerdown`, arriving after the `pointerup` that ended the drag. Restoring a focus from storage has the same shape, with no pointer in the room at all. `isDragging` is the pointer's state that happens to travel inside `CellFocus`, so a host-supplied focus now keeps the grid's live flag and discards the incoming one, and `initFocus` forces it false. Verified in the browser on the scratch React app: three clicks settle to **`isDragging: false`**, a real press-move-release stays **armed mid-gesture** through the echo and releases to **false** with the range **rows 10–13** intact. Three tests pin it. |
| 2026-08-31 | — | 1.9 ms | 0.83× | 60.0 / 60.0 | 0 | **The shell got stable classes** — `avg-viewport` on the scrolling element, `avg-cells-area` on the canvas, `avg-sticky-*` on the eight bands — so host CSS can style the scrollbar and the header band without reaching for undocumented `data-type` selectors. Ten class assignments at construction, nothing per frame; the benchmark ran anyway because the change sits in `src/render/`, and reads first paint 1.9 ms, 60.0 / 60.0 fps, ratio 0.83×, 0 pool misses top and bottom. | Verified in the browser: a host stylesheet targeting `.avg-grid .avg-sticky-top` shadows the whole header band, and the checkbox column sits in `.avg-sticky-left` as documented. |
| 2026-08-31 | 44 | 13.8 ms | 0.99× (horizontal) | 60.0 / 60.0 | 0 | **The wide-grid gate — no API change, and no task 44b needed: horizontal is as flat as vertical.** 70,000 rows × 300 columns (`measureWideGrid` on AVGridBoard), the shape no published gate had covered because every prior row is 20 columns wide. **All visible**: first paint 13.8 ms, horizontal paint cost **0.218 ms at the left edge against 0.215 ms out at column ~290 (0.99×)**, 60.0 fps at both, vertical paint 0.143 ms, full repaint 0.1 ms / **0 mutations** — so column count moves nothing but first paint, which is linear in *visible* cells as designed. **12-of-300 projection against a 12-column baseline**: paint 0.153 vs 0.136 ms (1.13×, within run-to-run noise), first paint 10.5 vs 8.9 ms, full repaint 0 mutations both — `hidden` is filtered once into the visible list, never consulted per cell, confirmed by measurement. **The column chooser** (`setColumns()` 12 → 40 visible): **1 paint, 0.7 ms model, same root**, 114 cells appended (the ~3 newly exposed columns × rows, not 28 × rows — the window renders what fits), narrowing back removes 128 and appends 0. **One filter on 70k rows**: 9.4–12.6 ms with 300 visible against 9.2–15.7 ms with 12 visible over three runs — indistinguishable, so the filter pass is row-bound, not row × column-bound. Verified by screenshot mid-grid at scrollLeft 13,000: headers aligned, values right-aligned, no blank bands. |
| 2026-08-31 | 45 | 0.7–4.9 ms | 0.79 / 0.92× | 60.0 / 60.0 | 0 | **Pinned-right columns, and a region-migration fix in `syncRegion`.** The render path is touched once: `paint()` now builds one Set of every cell any region will hold ("active") and a region evicts only what is in no region at all — because a column pinned or unpinned **migrates** its live element between regions in a single paint, and the old code evicted it: a `removeChild` against the wrong parent in one sync order, and in the other an on-screen element released into the pool, which would hand it out as a recycle. Found by the new happy-dom test, pinned by `RenderGrid.test.ts` ("moves a cell between regions without evicting it"). The cost is one Set insert per visible cell per paint, and the gate did not move: two warm `runBenchmark(100000)` runs read first paint **0.7 / 4.9 ms**, flat ratio **0.79 / 0.92×**, 60.0 / 60.0 fps, full repaint **0–0.1 ms / 0 mutations**, drag **2 cells a move at both ends** (ratio 0.62–0.87), select-all **0 mutations**, sort 18.8 ms. The unpinned wide grid is unregressed by direct comparison: horizontal paint **0.237 / 0.273 ms** on the new bundle against 0.218 / 0.215 before. | **The feature itself** (`measurePinned`, 70k × 300 with 1 left + 2 right pinned): the bands hold their columns at both scroll extremes (`["c298","c299"]` right, `["id"]` left, identical at `scrollLeft` 0 and 25,685 — screenshots both ends), horizontal paint **0.50 / 0.73 ms** — the honest cost of repositioning three bands per scroll frame, still 3% of a 60Hz budget — at 60 fps, and 72 band cells never evicted across a 60-column scroll. A selection dragged across the band boundary copies **3 cells in visible order** with no coordinate discontinuity. Drag-reorder verified in the browser with real `DragEvent`s: a scrolling column over the pinned band and a pinned column over the scrolling region both show **no indicator and refuse the drop**; a reorder inside the band works. The left-edge resize grip: press at `rect.left + 3`, drag left 40 px, width **90 → 130**. |
| 2026-08-31 | 46 | 12.3 ms | 0.79× | 60.0 / 60.0 | 0 | **`footerRows` — rows pinned to the bottom.** The render path is touched twice, both branches measured. (1) `calcInnerSize`: with a bottom band the *default* trailing slack is dropped (the band is what the last scrolling row clears) but an explicit `whiteSpaceY` now keeps its meaning — room between the last data row and the band, which is exactly the strip `extraElement` needs; pinned by a renderInfo unit test (400 / 440 / 420 px for band / band+40 / no band). (2) `applyLayout` publishes `--avg-sticky-bottom` on the area, and the stylesheet anchors `avg-extra` and the add-row button above the band instead of under it. The gate re-run warm: first paint 12.3 ms, flat ratio **0.79×**, 60.0 / 60.0 fps, full repaint **0.1 ms / 0 mutations**, drag **2 cells a move at both ends**, select-all **0 mutations** (isolated, twice — the 11 inside the full suite run is residual state from its editing phases). | **The band itself, on 100k rows with a two-row footer + `extraElement` + `whiteSpaceY: 40`** (`measureFooter`): pinned at both scroll extremes with identical cells and text, and **60 one-row scroll frames admit/evict only the scrolling region's cells (~10–11 per frame) while the footer elements stay untouched by identity** — the sticky bottom band costs zero extra DOM mutations on a scroll frame, which was the task's gate. `extraElement` sits exactly on the band's top edge (bottom 890 = band top 890), in the 40 px slack, verified by screenshot. Sorting leaves the footer in place, a search that matches no data row leaves it rendered over an empty grid, and it is not itself a match. The exclusion list is one test per line in `AVGrid.test.ts` (`describe("footerRows")`, 11 tests): no `data-row` so no focus/drag/edit can resolve to one, select-all never names one, `getVisibleRows`/`onVisibleRowsChange` keep meaning data rows, `startEdit` past the data refuses, a range stops at the last data row, and `getRowKey` is never called with a footer row (keys are minted `avg-footer-<n>`). |
| 2026-08-31 | 49 | 15.1 ms | 0.90× | 60.0 / 60.0 | 0 | **Accessibility: roles, `aria-sort`, and two keyboard gaps fixed.** Per-cell writes joined the paint path — `role="gridcell"` + 1-based `aria-rowindex` / `aria-colindex` on every data and footer cell, `role="columnheader"` + `aria-colindex` + `aria-sort` on headers, `role="grid"` + live `aria-rowcount` / `aria-colcount` + `aria-multiselectable` on the root — so the gate was re-run and a `MutationObserver` put a number on the cost: a full repaint of **220 cells produces 0 childList and 0 attribute mutation records** (Chromium queues no record for a same-value `setAttribute`, so an unchanged aria index is free), paint cost 0.18–0.20 ms, ratio 0.90×, 60.0 / 60.0 fps, drag 2 cells a move both ends. | **The keyboard audit found two real gaps and fixed both.** (1) The first navigation key in a fresh grid landed on the **checkbox column** — a cell the pointer can never focus (`onCellPointerDown` returns early for chrome); focus now clamps to the first data column everywhere (`firstColumn = lastIsStatusIndex + 1` in ArrowLeft, Ctrl+Home, the Shift+Tab wrap and the initial landing), pinned by a test. (2) The filter popover was pointer-only; **Alt+↓** now opens the focused column's popover anchored at its header (the Excel gesture), and the **Menu key**'s `contextmenu` — which fires on the root, not a cell — resolves to the focused cell and anchors the menu there. `measureKeyboard()` on AVGridBoard drives the grid start-to-finish without a pointer: **17/17 checks pass** (tab in, first key lands, arrows, F2/Escape/type-to-edit/Enter-commits, Shift-extend, Ctrl+A + real ClipboardEvent copy of all 50 rows, Alt+↓ anchored popover, Menu-key menu at the focused cell, and the four ARIA claims — counts live under filtering, `aria-sort` set and *removed*, never stale on a pooled element). The named gap, documented rather than hidden: **sorting has no keyboard binding** — a header focus mode is a phase-11 question. |

| 2026-08-31 | 48 | 2.3 ms | 0.84× | 60.0 / 60.0 | 0 | **Multi-column sort (`multiSort`, Ctrl/Cmd+click).** The paint path is touched once: the header's sort indicator now resolves against a list (`sortAsList` + `findIndex` per header cell per header paint — the header row only, never the viewport) and appends a position number when 2+ columns sort. The gate re-run warm: first paint **2.3 ms**, flat ratio **0.84×**, 60.0 / 60.0 fps, full repaint **0.1 ms / 0 mutations**, drag **2 cells a move at both ends** (ratio 1.00), single-column sort 70.4 ms — unmoved. | **The feature** (`measureMultiSort`, 100k rows): a **two-level sort costs 99.8 ms against 66.4 ms single-level (1.5×)** — the tuple decoration (`sortValue` keeps its one-call-per-row contract per level) plus one composite comparator; ordering verified within-team descending across 2,000 rows. The Ctrl+click gesture driven through the real header: plain click resets to the clicked column, Ctrl+click appends ascending then cycles to descending — `[firstName asc, score desc]` after the sequence. Position numbers **1 / 2** in the DOM, `aria-sort` on the primary only, and with a single sorted column the header is pixel-identical to before (no number). The single-column path is untouched by construction — an array in `state.sort` has no `.direction`, so `RowsModel`'s reverse never fires for it, and every pre-existing sort test passes unchanged. |
| 2026-08-31 | 47 | 5.9 ms | vsync-bound | 60.0 / 60.0 | 0 | **Column groups (`Column.group`) — the two-row header with zero engine changes.** The engine's `stickyTop` stays 1: row 0 is doubled by a per-row `rowHeight` function while groups are active, grouped headers shrink to its lower half (one style adjustment in the renderer), ungrouped headers fill the doubled slot as the natural tall cell, and the band itself is an **`addOverlay(el, "header")` overlay — one absolutely positioned div per group, not pooled cells**, in content-x coordinates inside the sticky-top region, so horizontal scrolling moves it for free. `measureGroups` (100k rows, 8 groups × 3 columns): first paint **5.9 ms**, the band paints **once per group (8 cells for 8 groups, constant at both scroll extremes)**, aligns with the leaf headers to **0.0 px** at every checkable group, and a 120-frame scroll queues **0 mutation records inside the band** at 16.8 ms/frame (vsync). Positions come from the engine's own `columnStarts`/`columnLength`, so percentage widths and `fitToWidth` stay exact by construction. Reorder is off while groups show (no header is draggable, a mid-flight drop is refused); sorting, filtering, editing (editor aligns over its cell), Alt+↓ and `scrollToRow` verified live on the grouped grid; toggling the last group away restores the single-height header and the plain-number `rowHeight`. An ungrouped grid pays nothing: it still gets the plain number, and the 100k gate above ran on this bundle. `measureKeyboard` re-run: **17/17**. |
| 2026-08-31 | fix | 1.8 ms | 0.96× | 60.0 / 60.0 | 0 | **The loan ledger — a pooled cell rendered by a superseded recompute is reclaimed by the paint.** Found in a consumer tree with `keepCellsAttached`: `renderCell` runs during the model's recompute and a frame can hold more than one (two scroll events, or two state writes in separate microtasks); only the last render info is painted, but the dropped pass's cells came out of the pool un-hidden and repositioned, were never in `attached`, and no `syncRegion` could ever evict them — stale rows on screen for the life of the grid, `data-avg-pooled` **and** `data-row` at once, a combination the eviction/admission contract forbids. `recycle` is now wrapped by `acquireCell` (records every loan) and `paint()` ends with `reclaimLoaned(active)` (re-parks whatever the painted info did not claim — which also reclaims a cell a renderer takes and drops). Two happy-dom tests pin both paths; verified live: 20 double-scroll-per-frame rounds leave **0** `[data-avg-pooled][data-row]` cells. The gate re-run warm on this code: first paint **1.8 ms**, flat ratio **0.96×**, 60.0 / 60.0 fps, full repaint **0 ms / 0 appended**, 0 pool misses — the ledger costs one `Set` insert per recycled cell per recompute, unmeasurable. |
| 2026-08-31 | 51 | 2.5 ms | 0.95× | 60.0 / 60.0 | 0 | **`externalFilter` / `externalSort` — the host owns the row set.** Not a render-path change — the whole feature is two guards in `RowsModel` (`filter` withholds `filters` from the pass, `sort` returns the rows as handed over) — but the gate ran anyway on this bundle: first paint **2.5 ms**, flat ratio **0.95×**, 60.0 / 60.0 fps, full repaint **0 ms / 0 appended**, 0 pool misses. The number the task exists to remove, measured on CustomizationBoard at 100,000 rows with three filters applied (an options list, a custom date range, a text filter): the local pass costs **12.2–17 ms per filter change** (25,000 rows kept); with `externalFilter: true` the same `setFilters` call costs **0.2–0.4 ms** — state, chips and callbacks only, no pass. Board: `checkExternalData` (4 claims — chip appears with the row set unchanged, callback fires with the normalized list, sort is state while rows hold, the `setOptions` toggle restores the local pipeline) passes live; `checkAll` reads **29/29**. |
| 2026-08-31 | 52 | 2.5 ms | 0.95× | 60.0 / 60.0 | 0 | **The built-in `"text"` filter type (contains / equals / starts with).** Not a render-path change either (a new arm in `filtersMatch` plus a popover body); same bundle, same gate as the row above. The per-pass cost at 100,000 rows, one single-value filter on the same column: the options checklist reads **2.1 ms**, the text operators **3.8 ms (equals) / 4.2 ms (starts with) / 5.1 ms (contains)** — ∼2× the checklist, which is the honest price of `String()` + `toLowerCase` per row against the *displayed* value, still ∼30% of one 60 Hz frame for the worst operator. The needle is lowercased **once per pass** in `filterRows`'s ResolvedFilter, never per row and never written into the `{ op, text }` value (which is public and persisted). Board: `checkTextFilter` (5 claims — one per operator with expected row counts, the chip spelling `starts with`, the popover opening the text body with the input focused) passes live; the popover verified by screenshot — full-width input, three operator chips under it. |
| 2026-09-01 | 53 | 1.7 ms | 0.84× | 60.0 / 60.0 | 0 | **`pinned: "left"` as a data column — sticky split from chrome.** The render-path touch is two predicate swaps in `HeaderCell` (`resizable` and the funnel now key off `isChromeColumn` — `isStatusColumn` only — instead of `isPinnedLeft`), header row only, never the viewport. The gate re-run on this bundle: first paint **1.7 ms**, flat ratio **0.84×**, 60.0 / 60.0 fps, 0 pool misses. Verified live on AVGridBoard with a 21-column grid, first column `pinned: "left"` without `isStatusColumn`: the column holds at the band edge under a 600 px horizontal scroll; a real grip drag resizes it **160 → 220 px** and the first scrolling header lands exactly at the pinned band's new right edge (252 = 252, offsets recomputed through the ordinary resize path — no new machinery); a pointer press focuses it; a range copy reads `Person 0	0:0`; the checkbox stays chrome (`data-resizable` false, press does not focus). CustomizationBoard `checkAll` **29/29** on the same bundle. |

## Phase 10 summary — what changed about the wide-column story

Before this phase every published gate was 20 columns wide. The task-44 rows established that the
performance thesis holds sideways with no library change: **horizontal scrolling over 300 columns is
as flat as vertical over 100k rows** (0.99×, 60 fps at both edges), `hidden` costs nothing per
hidden column (a 12-of-300 projection paints within noise of a 12-column grid), a column chooser's
`setColumns()` is one paint against the same root, and the filter pass is row-bound. On top of that
the phase shipped the two band features the engine already supported — `pinned: "left" | "right"`
columns and `footerRows` — plus the accessibility layer, and the gate never moved: the one engine
defect found (a cell migrating between sticky regions in a single paint was evicted by the region
losing it) was fixed with one Set per paint, measured at no cost. The honest costs, recorded above:
a grid with live side bands pays ~0.5–0.7 ms per horizontal scroll frame against 0.24 unpinned
(repositioning three bands), still ~3% of a 60 Hz budget; the footer band costs zero extra DOM
mutations per scroll frame; the aria attributes cost zero mutation records on a repaint.
