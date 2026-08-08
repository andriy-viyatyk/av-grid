# AVGridBoard — the grid, in a real browser

The debugger and visual check for **the grid layer** (tasks 6–14 of
[`plan.md`](../../tasks/plan.md)): `AVGrid.create()`, inferred columns, header sorting, column
resize and reorder, custom cell renderers, the injected stylesheet, the theme contract, cell
focus with keyboard navigation and range selection, row selection with the checkbox column,
in-cell editing, clipboard copy/cut/paste, and rows and columns added and deleted.

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

> **Building another board?** Read `read_guide("boards")` first — it is the Persephone MCP
> documentation for how boards work — then scaffold with the `create_board` tool so the board
> is auto-trusted.
>
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
await window.avg.measureRangeDrag(row)    // the task-10 gate: drag cost at any row
await window.avg.measureSelectAll()       // the task-11 gate: select-all cost and dirty rows
await window.avg.measureEditing(row)      // the task-12 check: does the editor survive a repaint
await window.avg.measureClipboard(row, n) // the task-13 check: copy cost, and what a paste repaints
await window.avg.measureStructure(row)    // the task-14 check: does an insert move the viewport
await window.avg.measureFilter(count)    // the task-15 gate: filter down, narrow, back up, search
await window.avg.measureFilterStorage()  // filters round-tripped through an injected store
window.avg.showPopover({ anchor, tall })  // task 14a: open one; returns its resolved geometry
window.avg.popoverGeometry()              // placement, rect, insideViewport, contentScrolls
window.avg.closePopover(result)           // resolves the show() promise with `result`
await window.avg.measureList(100000)      // task 14b: mount, fps, flat ratio, select-all cost
window.avg.closeList()
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
- **Focus and selection** — click a cell, drag to select a range, shift-click to extend,
  arrow / Tab / Home / End / PageUp / PageDown / ctrl+arrows to navigate, ctrl+A to select
  everything. The selection outline is muted while the grid is blurred and accent-coloured
  once it has focus — `grid.focus()` from the console shows both.
- **Row selection** — the board turns `selectColumn: true` on, so the first column is the
  checkbox. Click a box to select a row, click the header box to select or clear everything,
  and watch the live readout. The two selections are independent and visible at once: checked
  rows carry a full-width tint, the cell range carries an outline.
- **In-cell editing** — `editable: true` is on. Double-click a cell, press F2, or just start
  typing; Enter, Tab and clicking away commit, Escape discards. `Status` has `options`, so it
  opens a dropdown *and* has a custom `render` — the two coexist. `Active` is a boolean, so
  Space and Enter toggle it across the whole selection instead of opening anything. `#` is
  readonly and `Full Name` is computed, so neither opens. Delete clears the selected cells.
- **Clipboard** — ctrl+C copies the selected range as tab-separated text, ctrl+shift+C adds a
  header row, ctrl+V pastes into the selection, ctrl+X copies and clears. Copy and paste ride
  the browser's own clipboard events, so they need no permission — which also means they are
  driveable from here with a real `ClipboardEvent` carrying a `DataTransfer`, and that is what
  `measureClipboard` does. A value containing a tab or a newline is quoted on the way out and
  comes back as one cell; paste a single cell's worth into one selected cell and the target
  expands to fit. `Full Name` is the case worth re-checking after any change here: it is a
  computed column with a `render` and no row property, so it copies what it *shows*, and a paste
  aimed at it is dropped while the fields either side still land — after which it re-derives
  from whichever of them changed. It carries a `formatValue` as well as a `render`, which is
  what makes it searchable and filterable: the row filter never calls `render`, because that may
  build an element and would run 100,000 times a keystroke.
- **Adding and deleting** — all four `can*` options are on, so there is a **+ add person**
  button under the last row and a **+** at the right end of the header. ctrl+Insert inserts as
  many rows as are selected, ctrl+Delete deletes them, and the shift variants do the same for
  columns; ArrowDown or Tab off the end of the grid grows it by one row, ctrl+→ off the last
  column adds one. The board passes `newRow` because its rows carry an `id` the grid cannot
  invent and a `Full Name` derived from two other fields. The thing worth re-checking after any
  change here is `measureStructure`: **scroll and focus must both survive an insert above the
  viewport**, and they only do because `StructureModel` suppresses one focus revalidation.
- **The popover** — `showPopover({ anchor, tall })` opens one against any element or `{x, y}`
  and returns where it landed. This is the *only* place the placement arithmetic is exercised
  for real: happy-dom returns a zero rect for everything, so all 26 unit tests run on stubbed
  geometry. Worth re-running here after any change to `Popover.ts` — anchor near the bottom
  (`{ x: 300, y: innerHeight - 40 }`) for the flip, `tall: true` for the height cap and the
  scrolling body, and near the right edge for the clamp. `insideViewport` must be `true` in
  every case.
- **The virtualized list** — `measureList(count)` opens a `VirtualList` of `count` options
  inside a real popover and reports mount cost, rows actually in the DOM, fps, the top-vs-end
  paint ratio and what a select-all costs. Run it inside a popover, never bare: a list whose
  container has no definite height renders nothing, which is a layout fact happy-dom cannot
  reproduce. The numbers to quote are **rows in the DOM** (11, not 100,000) and the **flat
  ratio**; `mountMs` is honest only because the clock stops before the settle — awaiting frames
  first measures the display refresh rate.
- **Filtering** — `measureFilter(count)` filters 100k rows down, narrows with a second filter,
  clears, and searches — reporting model cost, repaints and DOM mutations for each. The numbers
  to quote are **1 repaint / 0 mutations** per change and the **0.0 ms** clear: an unfiltered
  pass returns the same array it was given, so only narrowing costs anything. Two traps live
  here. The generator's `status` and `team` cycles are both mod 5, so most pairs of values
  intersect in *nothing* — pick `team: ["platform"]` alongside `status: ["open", "pending"]` or
  the AND path measures an empty grid. And `Full Name` cannot demonstrate the computed-column
  search on this data, because every word in it also appears in a real column; prove that one
  with a `formatValue` returning a token found nowhere else (`Grace~Thompson` matches 12,500
  rows with it and 0 without) — and note the board's eight first names and eight last names
  pair up into only eight combinations, so `Grace~Hopper` is not one of them.
- **Filter persistence** — `measureFilterStorage()` runs against an in-memory store rather than
  `localStorage`, deliberately: the point of the injection is that the library never writes to
  the host's storage uninvited, and a board leaving keys behind would prove the opposite. It
  checks the row count survives a destroy-and-recreate, and that a `Date` comes back a `Date`
  with its label intact.
- **Auto-scroll while dragging** — drag a selection past any edge and the grid scrolls after
  it, faster the further past the edge the pointer goes, and keeps going while the pointer
  sits still. This is the one thing the pointer-event rewrite had to build by hand, so it is
  worth re-checking by mouse after any change to `GridInteractions`.

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
- **`measureRangeDrag` reports two numbers, and only one of them is the gate.** Quote
  `dirtyCellsPerMove` — it is exact, and it is 2 at row 100 and at row 99,000 alike.
  `modelMsPerMove` is ~14 *microseconds*, so a single run's ratio swings 0.77×–1.09× on timer
  quantization; average several runs before quoting it. Its tight loop deliberately does **not**
  await a frame per move: at 60Hz that buries 14 µs of real work under 16.7 ms of waiting and
  returns a meaningless 1.00× whatever the implementation does.
- **`measureFullRepaint` warms up with a throwaway `refresh()` before measuring.** Cells that
  scrolled out during a previous phase stay attached until the next full *recompute* trims
  them — settling alone never asks for one. Measure without the warm-up and their removal
  reads as though the repaint had replaced them, which is where a spurious "36 DOM mutations"
  comes from. 36 is 4 overscan rows × 9 columns.
- **60fps is the display ceiling**, not a measured limit. Read paint cost for headroom.
- **The board is offline-first** (CSP blocks remote network), which is why the library is
  vendored into `lib/`.

## Reference

Persephone board API (`persephone.*`, the `--p-*` theme contract, `browser_*` testing):
`read_guide("boards")`.
