# av-grid examples

Twelve runnable examples, one topic each, every file standalone and small enough to read whole. They
are meant to be **copied in full** and adapted — that is how they will actually be used.

## Running them

```bash
npm run build          # once — the examples load ../dist/av-grid.js, which is not checked in
npx serve .            # or: python -m http.server
```

Then open `examples/` — [`index.html`](index.html) is a launcher with a line about each one.

**Opening a file directly off the filesystem does not work.** The examples use ES module imports,
and browsers block those over `file://`. Any static server will do; a build step, they do not
need.

| File | What it shows |
|---|---|
| [`01-minimal.html`](01-minimal.html) | `rows` and nothing else — columns, labels, widths, data types and row keys all inferred |
| [`02-columns.html`](02-columns.html) | Explicit widths (pixels and percent), alignment, `dataType`, `displayFormat`, a computed column, a hidden one |
| [`03-cell-rendering.html`](03-cell-rendering.html) | `render` returning markup, `headerRender`, `onCellClass`, and a button handled through `onCellClick` |
| [`04-sorting-filtering.html`](04-sorting-filtering.html) | Header sorting, the funnel popover, the filter-chip bar, search and its highlighting, `persistFilters` |
| [`05-selection-keyboard.html`](05-selection-keyboard.html) | Row selection and cell-range selection side by side, plus keyboard navigation |
| [`06-editing.html`](06-editing.html) | Click-to-edit, the dropdown column, the boolean checkbox, `validate`, a vetoing `onEdit` |
| [`07-clipboard.html`](07-clipboard.html) | Copy in four modes, cut, paste — from the keyboard and from the API |
| [`08-theming.html`](08-theming.html) | Live token editing and a dark theme, with a paint counter proving it costs zero paints |
| [`09-benchmark.html`](09-benchmark.html) | 100,000 rows: first paint, paint cost top vs row 99,000, the flat-cost ratio |
| [`10-customization.html`](10-customization.html) | All seven host hooks at once: `cellClass`, `headerClass`, `rowClass`, `editor`, `column.filter`, `copyValue`, `sortValue` |
| [`11-host-integration.html`](11-host-integration.html) | What a host supplies around the rows: `rowNoun`, `highlightString`, `extraElement`, `whiteSpaceY`, and a host menu drawn from the built-in item ids |
| [`12-react.html`](12-react.html) | The React wrapper: `<AVGridReact>`, a detached `<AVGridFilterBar>`, the instance ref — React and ReactDOM from a CDN, no build step and no JSX |
| [`13-report.html`](13-report.html) | A report shape: a label column `pinned: "left"`, a `pinned: "right"` Total column, and a grand-total row in `footerRows`, formatted by the same columns as the data |
| [`persephone-board/`](persephone-board/) | The grid on a Persephone board, themed by `--p-*` with no theming code |

## Three things every example depends on

They are worth knowing before adapting one, because each produces a grid that looks broken in a
way the code does not explain.

**1. The host needs a definite height.** The grid measures its own root to decide what is on
screen. `height: 400px` works; so does a flex child with `flex: 1 1 auto; min-height: 0` (which is
what these files use). A host whose height comes from its content has none, and the grid renders
blank. `grid.getState().viewport.width === 0` is how you confirm it.

**2. Indices are into the *displayed* rows** — after filtering and sorting — everywhere in the
API. Row **keys** (`getRowKey`, `id` by default) are the stable identity; selection, focus and
editing all use them so they survive a sort.

**3. Theming is CSS, never JavaScript — and the token to set is `--p-*`.** The grid root, a
popover, a virtual list and the filter bar each define the whole `--avg-*` block *on themselves*
from the matching `--p-*`, because a popover lives on `document.body` and cannot inherit from a
grid. So `--p-*` on any ancestor reaches everything, `--avg-*` on an ancestor is shadowed and
does nothing, and `--avg-*` on the element itself wins — that last one is how you make a single
grid deviate. [`08-theming.html`](08-theming.html) demonstrates all three.

The full reference is [`../docs/api.md`](../docs/api.md).
