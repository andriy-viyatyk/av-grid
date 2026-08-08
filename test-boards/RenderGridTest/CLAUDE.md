# RenderGridTest — av-grid performance harness

The performance gate for [av-grid](../../tasks/plan.md). It drives the virtualization engine
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

## Key files

| File | What it is |
|---|---|
| `index.html` | Toolbar, results table, grid host, live footer readout |
| `app.js` | Data generation, the cell renderer, the measurement harness, `window.bench` |
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
