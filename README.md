# av-grid

A framework-agnostic virtualized data grid for the DOM. **No runtime dependencies.**

Built for scale: 100,000+ rows with no lag while scrolling, no lag while dragging a range
selection at any scroll position, and no lag while editing.

> **Status: pre-alpha.** Nothing is implemented yet. See [tasks/goal.md](tasks/goal.md) for the
> goal, the architecture being ported, and the plan.

## Why

Most JavaScript grids are comfortable up to a few thousand rows and degrade past that —
typically because a selection or hover change repaints the whole visible window. av-grid keeps
a cell-level dirty set, so growing a range selection by one cell repaints exactly the cells
whose state changed.

The engine is a port of the grid inside
[Persephone](https://github.com/andriy-viyatyk/persephone), where it has been running against
100k-row datasets in production. This project reimplements its rendering layer in plain DOM so
the same performance is available without React.

## Planned usage

```js
const grid = AVGrid.create(document.getElementById("grid"), {
    columns: [
        { key: "id", name: "ID", width: 80 },
        { key: "name", name: "Name" },
    ],
    rows: data,
    getRowKey: (row) => row.id,
});
```

## Features (target for v1)

- Virtualized rendering on both axes
- Sticky header row and sticky columns
- Column resize and reorder
- Sorting
- Column filtering — a filter bar of editable chips plus per-column filter popovers
- Row selection, cell focus, keyboard navigation
- Excel-style range selection
- Clipboard copy / paste
- In-cell editing
- Themeable entirely from CSS custom properties

## License

MIT
