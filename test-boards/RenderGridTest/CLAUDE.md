# RenderGridTest — av-grid performance harness

The performance gate for [av-grid](../../tasks/plan-done-01.md). It drives the virtualization engine
against a 100,000-row dataset in a real browser and reports the four numbers task 5 stops on:
time to first paint, sustained scroll FPS, paint cost near the top, and paint cost near row
99,000.

It exists because the unit tests run under happy-dom, which does no layout — so until this
board, nothing had measured the render path in a real engine. **Re-run it after any change to
the render path** and append a row to [`tasks/benchmark-results.md`](../../tasks/benchmark-results.md).

## Run it

```
npm run build:board          # from C:\projects\av-grid — bundles src/ into this board's lib/
```

Then open the board in Persephone and click **Run benchmark**. After editing board files, apply
the changes with the `board_refresh` MCP tool (boards do not auto-reload).

`lib/` is a **build artifact and is gitignored** — a fresh clone must run `npm run build:board`
before the board will load.

## Drive it as an agent

Everything is on `window.bench`, so no clicking is needed:

```js
await window.bench.runBenchmark()          // the full gate; returns the results object
await window.bench.measurePaintCost(y)     // avg paint ms over 40 one-row scrolls from y
await window.bench.measureScrollFps(y)     // scripted 2s scroll; fps + frame percentiles
await window.bench.scrollTo(y)             // and .settle(frames), .createGrid()
window.bench.grid                          // the live RenderGrid; .stats, .pool, .model
```

Use `browser_evaluate { pageId }` with the board's page id from `list_pages` (`editor:
"board-view"`). `grid.resetStats()` zeroes the counters so a phase can be measured in isolation.

## The scroll-loss rig — `window.scrollLoss`

`scroll-loss.js` is the second harness on this board, built for plan task 35. It measures the two
ways a grid loses scroll state, both of which are invisible to the unit tests because they are
browser behaviours: **the host detaching the grid's subtree**, and **the engine detaching its own
cells**. Every call builds its own grid in a scratch host, measures, and tears it down, so nothing
here disturbs `window.bench`.

```js
await window.scrollLoss.all()            // every measurement below, in one object
await window.scrollLoss.face1()          // detach + re-append across frames
await window.scrollLoss.face1Sync()      // detach + re-insert in ONE task (no resize is observable)
await window.scrollLoss.manualRevalidate()   // watchHost: false, then grid.revalidate()
await window.scrollLoss.hidePremise()    // does display:none really lose scrollTop? (no)
await window.scrollLoss.face2({ keep })  // a cell owning a nested scroller and an iframe
await window.scrollLoss.userScrollToTop()    // the regression a reconciliation would cause
window.scrollLoss.unpaintedPx(grid)      // px of viewport with no cell painted over it — the symptom
```

`face1({ grid: window.bench.grid })` runs the detach against the live 100,000-row grid rather than
a scratch one, which is how the headline before/after numbers were taken.

**Gotchas this rig cost:**

- **The board's `<body>` is a flex column**, so a plain block host is squashed to nothing. `makeHost`
  uses `position: absolute` to stay out of flow while still being laid out and scrollable.
- **The engine does not write `top`/`left`/`width`/`height` — the renderer does**, from `p.style`. A
  harness renderer that forgets it stacks every cell at the top, and `unpaintedPx` then reports
  nonsense on a perfectly healthy grid.
- **The board's CSP blocks inline script inside a `srcdoc` iframe**, so a frame reload is counted
  from the iframe element's own `load` event rather than from a generation stamped inside it.

## The after-paint rig — `window.afterPaint`

`after-paint.js` is the third harness on this board, built for plan tasks 36 and 37 (EPIC-079 gaps
4 and 5). Like the scroll-loss rig it exists because happy-dom cannot see either defect: one is
about **which frame** a `scrollTop` write lands in, the other about **geometry** the unit tests
never compute. Every call builds its own grid in a scratch host and tears it down.

```js
await window.afterPaint.all()               // every measurement below, in one object
await window.afterPaint.gap4All()           // the four entry points side by side — see below
await window.afterPaint.gap4({ via })       // "now" | "timeout" | "raf" | "afterPaint"
await window.afterPaint.gap4Unmeasured()    // a scrollToRow issued behind display:none
await window.afterPaint.gap4VsRevalidate()  // a queued scroll and the task-35 reconciliation, together
await window.afterPaint.gap5()              // setOptions changing height / growTo* / fitToWidth
await window.afterPaint.gap5Renders()       // and the engine following the new box, not just the styles
window.afterPaint.topPaintedRow(grid)       // the row actually at the top of the viewport
```

`gap4` grows a grid from 20 rows to 3,000 **in one turn** and asks for row 2,000. The small start is
deliberate: 20 rows in a 400px viewport is an old extent of exactly 100px against the 48,000px the
request wants, so a clamp is unmistakable rather than a near miss.

**What it should print.** `via: "afterPaint"` lands at **48000** with `topPaintedRow: 2000`; `"now"`,
`"timeout"` and `"raf"` all land at **100** — and are *supposed to*, after the fix as well as before.
They are the wrong entry point, not a regression, and leaving them alone is what makes the feature
additive. If `"afterPaint"` comes back `unsupported: true`, the board's `lib/` predates the feature:
run `npm run build:board` and `board_refresh`.

**Gotchas this rig cost:**

- **A bare `requestAnimationFrame` does not fix gap 4 either**, and it is the deferral a reader
  reaches for after `setTimeout(0)`. The paint is itself scheduled on `rAF`, so a callback taken out
  in the same turn as the row-set change is queued *ahead* of the paint's own frame. Measured at 100
  alongside the other two — which is why `via: "raf"` is in the rig rather than left as an argument.
- **Read the geometry from the DOM, never from the options.** `gap5` reads
  `root.getBoundingClientRect().height` and the container's inline `max-height` / `max-width` /
  `overflow-x`. Asserting on `grid.getOptions()` would have passed against the broken build, because
  the options were being stored correctly all along and simply never applied.
- **`open_board` on an already-open board can serve a stale `lib/`.** After a `npm run build:board`, a freshly opened page came back with `scrollToRowAfterPaint` `undefined` and every gap-4/gap-5 number at its *pre-fix* value — which reads exactly like a regression and is not one. `board_refresh { pageId }` fixes it. Check the bundle, not the symptom: `typeof grid.model.scrollToRowAfterPaint` against `grep -c scrollToRowAfterPaint lib/av-grid.js`.
- **Measuring the box is not enough for gap 5** — `gap5Renders` exists because a shell can resize
  without the engine noticing. The number that proves it is `model.visibleRowCount`: 5 at 100px, 16
  at 360px.

## The measured-height rig — `window.measured`

Task 34's companion, `MeasuredRowGrid`. Its whole point is a height that cannot be computed, only
laid out, so it is the one feature in this project that **cannot** be tested anywhere but a real
browser: happy-dom does no layout, and a green suite there says only that the plumbing is connected.
Each function builds its own grid in its own scratch host and tears it down, so nothing here
disturbs `window.bench`.

```js
await window.measured.all()          // every measurement below, in one object
await window.measured.hints()        // first paint from getInitialRowHeight, then settling
await window.measured.extent()       // total scroll extent against the sum of measured heights
await window.measured.fromRow()      // rows AFTER a changed one land at their new offsets
await window.measured.readmit()      // keepCellsAttached: hidden -> 0, re-admitted -> remeasured
await window.measured.cost()         // measured path vs fixed height, same rows, same renderer
window.measured.makeGrid(texts, over, hostHeight)   // and .makeTexts, .renderedTops, .settled
```

The data is deliberately hostile: `makeTexts` produces 2–71 random words per row, so no row height
is derivable from anything but the DOM.

**What it should print.** `hints`: `firstPaintUsedHints: true`, then `extentMovedAfterMeasurement:
true`. `extent`: `unmeasured: 0` and `extentMatchesMeasuredSum: true`. `fromRow`:
`allBelowMovedByDelta: true` and `contentBelowUnchanged: true`, with `rowsAbove` all `moved: 0`.
`readmit`: `zeroWhileHiddenIgnored`, `sameElementCameBack`, `remeasured` and `matchesLayout` all
`true`. `cost`: a `paintRatio` around 5–6 with both grids at 60 fps.

**Gotchas this rig cost:**

- **A `MeasuredRowGrid` needs an explicit `height` exactly like a bare `RenderGrid`.** The first run
  rendered **3 rows in a 600 px host**, because the root's default height is a deliberately visible
  `100px` — not the host's. The layer does *not* default it to `100%` (the fork does; see the
  decision log). Pass `height: "100%"`, as every harness here does.
- **Measure a child, never the cell.** The engine writes the cell's `height` from what it currently
  believes, so `p.measure(cell)` reports that belief straight back and the row never grows. The rig
  nominates an inner `.m-body` whose own content lays it out.
- **`heightOf(row)` read in the same expression that scrolled is not settled yet.** Rows can come
  back `undefined` simply because their 50 ms debounce has not elapsed — that reads like a missing
  measurement and is not one. Call `settled()` again before asserting.
- **`fromRow`'s extent grows by more than the row's delta, and that is correct.** With
  `preferMinHeightForNewRows` off, every never-measured row is estimated at the *last* measured
  height, so making one row 296 px tall re-estimates the other 390. The rows `fromRow` is
  accountable for are the rendered ones, and they move by exactly the delta.

## Key files

| File | What it is |
|---|---|
| `index.html` | Toolbar, results table, grid host, live footer readout |
| `app.js` | Data generation, the cell renderer, the measurement harness, `window.bench` |
| `scroll-loss.js` | The scroll-loss rig, `window.scrollLoss` — see above |
| `measured.js` | The measured-height rig, `window.measured` — see above |
| `after-paint.js` | The after-paint / live-layout rig, `window.afterPaint` — see above |
| `style.css` | Board chrome + the grid's own cell styling (`.avg-cell`) |
| `lib/av-grid.js` | **Build artifact** — the bundled library. Gitignored |

## How it works

- **Data** — 100,000 arrays of 20 mixed values, strings drawn from a small interned pool so
  generation stays a rounding error rather than dominating the run.
- **Header** — `stickyTop: 1` with row 0 rendered as the header, so data row *n* is grid row
  *n+1*. `stickyLeft: 1` pins the `#` column. This mirrors how AVGrid itself will use the
  engine.
- **Measurement** — paint cost comes from `grid.stats.totalPaintMs / paints` after
  `resetStats()`, counting only paints that did work (the engine skips the rest). FPS comes
  from timing rAF boundaries during a scripted scroll and reporting median / p95 / worst,
  because an average hides exactly the stutter that matters.

## Gotchas

- **The cell renderer's shape is the point.** `p.previous ?? p.recycle?.() ?? createElement()`
  — update in place when the cell is already there, take a pooled element when it just
  scrolled in, allocate only as a last resort. Getting this wrong is what makes a naive DOM
  port slow: dropping `previous` costs ~12× on full repaints, and dropping `recycle` allocates
  on every scroll frame. Task 9's `DataCell` must keep this shape.
- **Pooled elements arrive dirty.** `CellPool.release()` deliberately does not reset anything,
  so the renderer overwrites every property it sets. Text goes through the existing text node
  (`firstChild.nodeValue`) rather than `textContent`, which would allocate a node per cell per
  frame.
- **60fps is the display ceiling**, not a measured limit — the harness cannot observe faster
  than the refresh rate. Read the paint-cost numbers for headroom, not the FPS.
- **The board is offline-first** (CSP blocks remote network), which is why the library is
  vendored into `lib/` rather than loaded from anywhere else.

## Reference

Persephone board API (`persephone.*`, the `--p-*` theme contract, `browser_*` testing):
`read_guide("boards")`.
