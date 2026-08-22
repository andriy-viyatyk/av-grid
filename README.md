# av-grid

A virtualized data grid that renders straight to the DOM. **No runtime dependencies, no
framework.** Built for **100,000+ rows** with no lag while scrolling, selecting a range, or
editing.

**[▶ Live demo](https://andriy-viyatyk.github.io/av-grid/)** — twelve examples in the browser,
including a [100,000-row benchmark](https://andriy-viyatyk.github.io/av-grid/examples/09-benchmark.html)
you can run yourself.

```js
import { AVGrid } from "av-grid";

const grid = AVGrid.create("#host", { rows: data });
```

That is the whole minimum call. Columns, header labels, widths, data types, alignment and row keys
are all inferred from the rows.

---

## Why another grid

Most JavaScript grids are comfortable to a few thousand rows and degrade past that — usually
because a hover, a focus move or a growing selection repaints the entire visible window. The cost
of an interaction ends up proportional to the size of the viewport, and sometimes to the size of
the dataset.

av-grid keeps a **cell-level dirty set**. Growing a range selection by one cell repaints exactly
the cells whose state changed — two of them — whether the selection covers 101 rows or 99,001.

The result is a grid whose interaction cost is flat:

| Measured on 100,000 rows × 20 columns, in a real browser | |
|---|---|
| First paint | **~6 ms** |
| Scrolling at the top / at row 99,000 | **60 fps / 60 fps**, a flat-cost ratio of **~1.0×** |
| Full repaint of every visible cell | **0.2 ms, 0 DOM mutations** |
| Dragging a range selection from row 0 to row 99,000 | **2 cells repainted per pointer move**, at both ends |
| Selecting all 100,000 rows | 24.9 ms, **19 rows marked, 0 DOM mutations** |
| Filtering 100k rows down to 40k | 5.9 ms, **1 repaint, 0 DOM mutations** |
| Pasting into 1,000 cells | **1 repaint, 0 DOM mutations** |
| Changing the theme | **0 repaints** |

Every number here was measured by driving the real grid in a real browser, not estimated and not
taken from a synthetic benchmark. The harness is in [`test-boards/`](test-boards/), the full
history — including the measurements that mislead if taken carelessly — is in
[`tasks/benchmark-results.md`](tasks/benchmark-results.md), and you can run it yourself:
[`examples/09-benchmark.html`](examples/09-benchmark.html).

## How it stays flat

Three ideas, and only three:

1. **Visible-window math, done without touching the DOM.** Pure geometry decides which rows and
   columns are on screen, plus an overscan band *in the direction of travel only*.
2. **A cell-level dirty set.** Every state change — focus, selection, hover, an edit, a class hook
   — names the cells it invalidates. A paint re-renders those and reuses everything else *in place*,
   so the element keeps its identity: focus, an open editor and a running transition all survive.
3. **Element pooling.** Cells scrolled out of the window are recycled into cells scrolling in, so a
   scroll frame allocates nothing.

None of it is a framework, and none of it needs one.

## Install

```bash
npm install av-grid
```

Or take the files straight from a CDN — no build step, no bundler:

```
https://cdn.jsdelivr.net/npm/av-grid/dist/av-grid.js
https://cdn.jsdelivr.net/npm/av-grid/dist/av-grid.css
```

Either way you get `dist/av-grid.js` (ESM), `dist/av-grid.umd.cjs` (UMD, global `AVGrid`),
`dist/index.d.ts` (TypeScript types) and `dist/av-grid.css` — about **50 kB gzipped**, everything
included, nothing else pulled in.

Without a bundler, point at the files directly:

```html
<!-- ESM -->
<div id="host" style="height: 400px"></div>
<script type="module">
    import { AVGrid } from "./dist/av-grid.js";
    AVGrid.create("#host", { rows });
</script>

<!-- UMD, no bundler -->
<script src="dist/av-grid.umd.cjs"></script>
<script>
    AVGrid.AVGrid.create("#host", { rows });
</script>
```

The stylesheet is injected on first use and shared by every grid on the page. Pass
`injectStyles: false` and link `dist/av-grid.css` yourself if you would rather control it.

> **Versions 1.x are a different library** — the 2021 React component this project is the
> descendant of, preserved on the
> [`react-1.x`](https://github.com/andriy-viyatyk/av-grid/tree/react-1.x) branch. The rewrite
> shares no API with it and starts at **2.0.0**.

> **The host needs a height.** The grid measures its own root to decide what is on screen, so that
> height has to be definite — `height: 400px`, a flex child, `position: absolute`. If a grid
> renders blank, `grid.getState().viewport.width` is the first thing to read; `0` is the answer to
> the commonest integration failure.

## What it does

- **Virtualized on both axes**, with a sticky header and sticky columns
- **Sorting** by header click, with `sortValue` or `rowCompare` for a custom order
- **Filtering** — a searchable checklist per column, cascaded against the other filters, plus a bar
  of removable chips, `localStorage` persistence, and host-defined filter types
- **Cell focus and full keyboard navigation**, Excel-style
- **Range selection** by drag or by shift, and row selection through a checkbox column
- **In-cell editing** with validation, a virtualized dropdown for columns with `options`, and
  host-supplied editors
- **Clipboard** copy / cut / paste, Excel-compatible, plus Copy as headers / JSON / HTML table
- **A context menu** you can extend, replace, or turn off
- **Rows and columns** added and deleted by button, keyboard or API
- **Column resize and reorder**
- **Themed entirely from CSS custom properties** — no build step, no CSS-in-JS

### Customization

Seven hooks cover what a host actually wants to change, all of them plain functions on a column or
on the options:

| I want to… | Hook |
|---|---|
| draw a cell myself | `Column.render` |
| colour a cell, a header, or a whole row | `Column.cellClass`, `Column.headerClass`, `rowClass` |
| edit with my own control | `Column.editor` |
| filter by something other than a value list | `Column.filter` |
| copy something other than what is on screen | `Column.copyValue` |
| sort by something other than the value | `Column.sortValue` |

No registration calls and no plugin system — a hook is an object property, so reuse is a shared
`const`. Notably, a host `match` in a custom filter is *cheaper* than the built-in test it
replaces (1.7 ms against 2.1 ms on 100,000 rows), and `copyValue` is 6× cheaper than the fallback
it overrides.

## Examples

Eleven standalone files, one topic each, every one meant to be copied whole. The names below open
the **[live demo](https://andriy-viyatyk.github.io/av-grid/)**; the source of each is one file in
[`examples/`](examples/), with no build step of its own.

| | | |
|---|---|---|
| [01-minimal](https://andriy-viyatyk.github.io/av-grid/examples/01-minimal.html) | the smallest thing that works | [source](examples/01-minimal.html) |
| [02-columns](https://andriy-viyatyk.github.io/av-grid/examples/02-columns.html) | widths, types, alignment, inference | [source](examples/02-columns.html) |
| [03-cell-rendering](https://andriy-viyatyk.github.io/av-grid/examples/03-cell-rendering.html) | `render`, `formatValue`, class hooks | [source](examples/03-cell-rendering.html) |
| [04-sorting-filtering](https://andriy-viyatyk.github.io/av-grid/examples/04-sorting-filtering.html) | sorting, search, filters, the filter bar | [source](examples/04-sorting-filtering.html) |
| [05-selection-keyboard](https://andriy-viyatyk.github.io/av-grid/examples/05-selection-keyboard.html) | focus, ranges, row selection, the keyboard map | [source](examples/05-selection-keyboard.html) |
| [06-editing](https://andriy-viyatyk.github.io/av-grid/examples/06-editing.html) | `editable`, validation, dropdowns | [source](examples/06-editing.html) |
| [07-clipboard](https://andriy-viyatyk.github.io/av-grid/examples/07-clipboard.html) | copy, cut, paste, Copy as… | [source](examples/07-clipboard.html) |
| [08-theming](https://andriy-viyatyk.github.io/av-grid/examples/08-theming.html) | the CSS custom-property contract | [source](examples/08-theming.html) |
| [09-benchmark](https://andriy-viyatyk.github.io/av-grid/examples/09-benchmark.html) | the 100k harness — run it yourself | [source](examples/09-benchmark.html) |
| [10-customization](https://andriy-viyatyk.github.io/av-grid/examples/10-customization.html) | all seven hooks in one file | [source](examples/10-customization.html) |
| [11-host-integration](https://andriy-viyatyk.github.io/av-grid/examples/11-host-integration.html) | `rowNoun`, `highlightString`, `extraElement`, menu ids | [source](examples/11-host-integration.html) |
| [persephone-board](https://andriy-viyatyk.github.io/av-grid/examples/persephone-board/) | the grid inside a Persephone board | [source](examples/persephone-board/) |

## Documentation

| | |
|---|---|
| [`docs/api.md`](docs/api.md) | **The complete public surface** — every option, column field, method and callback, the filter API, the keyboard map, the CSS tokens, the DOM contract |
| [`docs/capabilities.md`](docs/capabilities.md) | What each subsystem does and what it measures |
| [`docs/architecture.md`](docs/architecture.md) | The source tree, file by file |
| [`docs/invariants.md`](docs/invariants.md) | The three rules that carry the performance — read before changing the render path |
| [`docs/releasing.md`](docs/releasing.md) | How a version gets cut and published |

## Provenance

av-grid is a port of the React grid inside
[Persephone](https://github.com/andriy-viyatyk/persephone), where its virtualization engine has
been running against 100k-row datasets. That engine was already framework-free; this project
reimplements the rendering layer in plain DOM so the same performance is available to any page.

**It is not AG Grid**, despite the one-character distance. There is no shared API, no shared code
and no shared history — `AVGrid.create(host, options)` is the whole entry point, and
[`docs/api.md`](docs/api.md) is the whole surface.

The API is deliberately shaped for **an AI agent to use without reading the docs first** — the
minimum call infers everything, the vocabulary is `key` / `name` with no aliases, and validation is
loud and specific rather than silent. Persephone Boards are written by agents, and they were the
first consumer.

## Development

```bash
npm test              # vitest — 737 tests
npm run typecheck     # tsc --noEmit, strict
npm run build         # typecheck + lib build to dist/ (ESM + UMD + types + CSS)
npm run build:board   # bundle src/ into the test boards
```

Tests sit next to their subject as `*.test.ts`. They run under happy-dom, which does **no layout** —
so a green suite proves logic and proves nothing about rendering or performance. That is what the
boards under [`test-boards/`](test-boards/) are for: a real browser, real layout, and a harness on
one global per board. Anything touching the render path gets a benchmark re-run and a row appended
to [`tasks/benchmark-results.md`](tasks/benchmark-results.md).

## License

[MIT](LICENSE)
