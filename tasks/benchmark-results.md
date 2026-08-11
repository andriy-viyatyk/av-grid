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
