# CustomizationBoard — the host hooks, and whether the docs are true

The check that phase 6's customization surface behaves the way
[`docs/api.md`](../../docs/api.md) says it does. Seven hooks are live here, each written the way
the documentation's snippet writes it — copied, not paraphrased — and `checkAll()` returns **one
row per documented claim** with the value it was checked against:

`Column.cellClass` · `Column.headerClass` · `rowClass` · `Column.editor` · `Column.filter` ·
`Column.copyValue` · `Column.sortValue`

Its sibling [`AVGridBoard/`](../AVGridBoard/CLAUDE.md) measures what those hooks **cost** —
`measureClassHooks`, `measureCustomEditor`, `measureCustomFilter`, `measureCopyValue`,
`measureSortValue`. This board asks the other question and answers it as pass/fail. Neither
replaces the other, and neither can be replaced by a unit test: happy-dom does no layout, so it
has no cells to carry a class, no pool to evict an editor, and no popover with a real rect.

## Run it

```
npm run build:board          # from C:\projects\av-grid — bundles src/ into this board's lib/
```

Then open the board in Persephone. After editing board files, apply the changes with
`board_refresh { pageId }` — boards do not auto-reload. After editing `src/`, run
`npm run build:board` first. `lib/` is a **build artifact and is gitignored**.

## Drive it as an agent

```js
await window.custom.checkAll()          // every claim below; { passed, failed, results }
await window.custom.checkClassHooks()   // the three class hooks reach the DOM
await window.custom.checkClassesGoAway() // …and a class disappears when its hook stops asking
await window.custom.checkSortValue()    // the projection's order, and its call count
await window.custom.checkCustomFilter() // a host match: rows, chip label, stored type
await window.custom.checkFilterPopover() // the funnel opens the host body; the grid draws Apply
await window.custom.checkEditor()       // open, Escape, Tab-commit, and eviction by scroll
window.custom.checkCopyValue()          // copyValue on the real ctrl+C path
await window.custom.checkFreezeEnds()   // a filter cleared after an edit re-runs the pipeline
window.custom.createGrid(50000)         // rebuild at any size
window.custom.grid                      // the live AVGrid
```

`checkAll()` renders the same rows into the results panel, green for pass and red for fail, with
the "checked against" column carrying the number or string the assertion saw — a failure says
*what it found*, not only that it failed.

**The expected result is 20/20.** Anything else is a regression, and the detail column names it.

## Key files

| File | What it is |
|---|---|
| `index.html` | Toolbar, results table, grid host |
| `app.js` | The seven hooks, the checks, `window.custom` |
| `style.css` | Board chrome, **plus** the classes the class hooks ask for and the filter body's look |
| `lib/av-grid.js` | **Build artifact** — the bundled library. Gitignored |

## What each check is really testing

- **The class hooks** — that `cellClass` (functional and constant-string), `headerClass` and
  `rowClass` reach the DOM at the granularity documented, and that `rowClass` lands on **every
  cell of the row**, because there is no row element. Their rules in `style.css` are written
  `.grid-host .x`: the grid injects its stylesheet during `create()`, so it lands after this
  board's and a bare `.p-critical` loses the specificity tie to `.avg-data-cell`.
- **A class that goes away** — the pool trap, and the reason this board exists. Cells are
  recycled and come back dirty, so a class whose hook is removed has to be *gone* on the next
  paint. The check reads `10/60/1 → 0/0/0 → 10/60/1` — marked, stripped by `setOptions`,
  restored. It leaves the hooks back on; a script that stops halfway leaves the grid unstyled,
  and `board_refresh` puts it back.
- **`sortValue`** — that the order is the projection's (`critical` first ascending, `low` first
  descending) and that the projection is read **once per row**: `2000 calls for 2000 rows`, not
  the ~22,000 an `Array.sort` comparator would make of it.
- **The custom filter** — that a host `match` narrows the rows and is called exactly once per
  row, that the stored filter's `type` was filled in **from the column** rather than written by
  the host, that the chip reads the definition's `label`, and that clearing restores everything.
- **The filter popover** — that the funnel opens the host's element and *not* the checklist
  (`create()` called 1×, `.avg-list` absent), and that the grid still draws **Apply** and
  **Clear** around it.
- **The editor** — that the column's editor opens whatever else is true of the column, that it
  carries `avg-cell-editor` (which is what positions it) and `data-type="cell-editor"` (which is
  what keeps the grid's keys and clipboard out of it), that Escape cancels and `destroy()` runs,
  that Tab commits and moves on with nothing special-cased, and that **a long scroll closes the
  edit** — the fifth way an edit can end, where the pool *evicts* the cell rather than repainting
  it, so `releaseCell` never fires.
- **`copyValue`** — through a real `ClipboardEvent("copy")`, the path ctrl+C takes. The
  programmatic `copySelection()` is permission-gated in the sandbox; this is not. The column
  renders a bar and copies `0 · 17 · 34 · 51 · 68` rather than `0% · 17% · …`.
- **The freeze** — a regression check for the bug this board's example found: an edit freezes the
  row order, and a filter change has to end that freeze. Before the fix, clearing a filter after
  an edit left the filtered-out rows on screen (`942 filtered → 942 after clear`).

## Gotchas

- **A cell affordance resolves on `pointerdown`, never `click`.** `pressCell()` dispatches
  `pointerdown` / `pointerup` / `click` and then awaits frames, and the editor checks call it
  **twice** — the first press settles the focus, the second opens the edit. `element.click()`
  alone reaches neither, which is worth remembering before concluding the grid is broken.
- **Do not name a host class `.bar`.** The board chrome's toolbar is `.bar`, and the progress
  cell's span was too — the later rule won, the toolbar became `display: inline-block` and
  collapsed to 17 px with its buttons overflowing. It is `.progress-bar` now. The accessibility
  snapshot showed the buttons present and correct throughout; only the screenshot showed it.
- **Escape the detail column.** `input.outerHTML` in a result detail is markup, and the results
  table used to render the very editor it was reporting on.
- **`document.hidden` invalidates every timing on any of these boards** — a backgrounded webview
  is throttled and `requestAnimationFrame` does not run, so anything awaiting `settle()` hangs.
  This board asserts rather than times, so it is affected less than `AVGridBoard`, but the checks
  that await frames still need the window visible.

## Reference

Persephone board API (`persephone.*`, the `--p-*` theme contract, `browser_*` testing):
`read_guide("boards")`.
