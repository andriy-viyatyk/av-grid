# AVGridBoard — the grid, in a real browser

The debugger and visual check for **the grid layer** (tasks 6–9 of
[`plan.md`](../../tasks/plan.md)): `AVGrid.create()`, inferred columns, header sorting, column
resize and reorder, custom cell renderers, the injected stylesheet, and the theme contract.

Its sibling [`RenderGridTest/`](../RenderGridTest/CLAUDE.md) benchmarks the *engine* with a
trivial cell renderer. This board runs the whole thing. Use it whenever a change could alter
what the user sees — the unit tests run under happy-dom, which does no layout, so a green
suite sits happily on top of a grid that renders as a blank box.

## Run it

```
npm run build:board          # from C:\av-grid — bundles src/ into this board's lib/
```

Then open the board in Persephone. After editing board files, apply the changes with
`board_refresh { pageId }` — boards do not auto-reload. After editing `src/`, run
`npm run build:board` first.

`lib/` is a **build artifact and is gitignored**.

> **Why `AVGridBoard` and not `AVGridTest`?** Trust is granted per board *path*, and a board
> Persephone did not create is untrusted — it renders a "Trust board" prompt instead of the
> page, and `browser_evaluate` cannot reach it. `create_board` scaffolds a board that is
> trusted from the start, and it refuses a name that already exists. So: **create the folder
> with `create_board`, then write your files into it.** Do not hand-create a board folder and
> expect to drive it.

## Drive it as an agent

Everything is on `window.avg`, so a whole session runs with no clicking:

```js
await window.avg.runBenchmark(100000)     // the task-5 gate, through the whole grid
await window.avg.measurePaintCost(y)      // avg paint ms over 300 one-row scrolls from y
await window.avg.measureScrollFps(y)      // scripted 2s scroll; fps + frame percentiles
await window.avg.measureFullRepaint()     // the sort / filter / setRows path
window.avg.createGrid(count)              // explicit columns
window.avg.minimalGrid()                  // AVGrid.create(el, { rows }) and nothing else
window.avg.grid                           // the live AVGrid; .model, .render, .getState()
```

`grid.render.stats` and `grid.render.pool.stats` expose paint timings and pool hit/miss
counts; `grid.render.resetStats()` isolates a phase.

## Key files

| File | What it is |
|---|---|
| `index.html` | Toolbar, results table, grid host, live event readout |
| `app.js` | Data, the column definitions, the measurement harness, `window.avg` |
| `style.css` | **Board chrome only** — nothing here styles a cell |
| `lib/av-grid.js` | **Build artifact** — the bundled library. Gitignored |

`style.css` deliberately contains no cell styling. The grid injects its own stylesheet, so if
the grid looks wrong here the bug is in `src/styles/av-grid.css.ts` — which is the point.

## What it exercises

- **Explicit columns** — a computed column (`full`, no such row property) returning a string,
  an element renderer (`status`), a boolean column, a `displayFormat: "dateTime"` column, a
  non-resizable column, and `onCellClass` painting closed rows red.
- **The minimum call** — the *Minimum call* button drops to `AVGrid.create(el, { rows })` and
  shows what inference produces: humanized labels (`firstName` → *First Name*, `id` → *ID*),
  content-based widths, `dataType` and `displayFormat` guesses, inferred row keys.
- **Interaction** — header click sorts, header edge drag resizes, header drag reorders,
  hovering highlights a row, the search box filters.

## Checks worth re-running after a render-path change

```js
// 1. Hover repaints one row's worth of cells and mutates no DOM.
grid.render.resetStats();
cell.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
await window.avg.settle();
grid.render.stats;   // cellsAppended + cellsRemoved must be 0

// 2. A theme change costs zero paints.
const before = grid.render.stats.paints;
document.documentElement.style.setProperty("--p-text", "#ff0000");
await window.avg.settle();
grid.render.stats.paints - before;   // must be 0
```

The second is the task-9 requirement in one line: **theming is CSS, never JavaScript.**

## Gotchas

- **`measurePaintCost` samples 300 steps, not 40.** A paint costs well under a millisecond, so
  a 40-step sample is dominated by timer noise and the top-to-bottom ratio swings between
  0.99× and 1.31× run to run. At 300 it settles within a percent or two.
- **`measureFullRepaint` settles first, generously.** Cells that scrolled out during a
  previous phase stay attached until the next paint. Reset the stats before they are collected
  and their removal reads as though the repaint had replaced them — which is where a spurious
  "36 DOM mutations" comes from. 36 is 4 overscan rows × 9 columns.
- **60fps is the display ceiling**, not a measured limit. Read paint cost for headroom.
- **The board is offline-first** (CSP blocks remote network), which is why the library is
  vendored into `lib/`.

## Reference

Persephone board API (`persephone.*`, the `--p-*` theme contract, `browser_*` testing):
`read_guide("boards")`.
