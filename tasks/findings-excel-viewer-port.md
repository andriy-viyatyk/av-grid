# Findings from porting the Excel Viewer board to av-grid 2.0.0

Context: the Persephone **Excel Viewer** board (`persephone-boards/boards/excel-viewer`) was
rewritten from Tabulator onto av-grid, by an agent working **only from `docs/api.md`** — no access
to the av-grid source. That is the intended consumption path, so everything below is a gap that
path exposed, ordered by how much it cost.

Overall: the port went well. The whole grid is one `AVGrid.create()` call, and sorting, filtering,
the funnel checklist, the filter-bar chips, the context menu, virtualization (20,000 rows render in
~90 ms with ~230 DOM cells) and the `--p-*` theming all worked first try with no custom code. The
`formatValue` / `row[key]` split let the board show Excel's formatted text while sorting the raw
values — which is exactly what a spreadsheet viewer needs, and it deleted the custom sorter the
Tabulator build required. Four things cost real debugging time.

---

## 1. Clicking a cell does not give the grid DOM focus — BUG

**What happens.** After a genuine click on a data cell, `document.activeElement` is still `<body>`.
The cell focus ring appears and range-dragging works, but **arrow keys, Shift+arrow selection and
every keyboard binding do nothing** until something else focuses the grid. The root has
`tabindex="0"`, so it is focusable — the focus is just never taken (presumably a `preventDefault()`
on the pointer gesture, to suppress text selection, that is not compensated with an explicit
`.focus()`).

**Why it is worth fixing.** A grid that ignores the keyboard after a click reads as broken, and the
symptom points nowhere near the cause. `focus()`'s own doc line — *"Give the grid keyboard focus, so
arrow keys reach it without a click first"* — implies a click already does it.

**Suggested fix.** Focus the root on pointerdown when the gesture lands inside the grid and the
grid does not already contain `document.activeElement`.

**Host workaround** (in the board, if this is left as-is — it should at least be documented):

```js
host.addEventListener("mousedown", () => grid.element.focus({ preventScroll: true }), true);
```

## 2. `grid.focus()` also re-homes the *cell* focus to A1 — BUG (or an undocumented contract)

The obvious fix for #1 is `onCellClick: () => grid.focus()`. It makes things **worse**: the cell
focus jumps to the first cell, so a click on any cell selects A1. The workaround above therefore has
to use `grid.element.focus()` and dodge the public method entirely.

Either `focus()` should preserve an existing `CellFocus` (my expectation — it is documented as
"give the grid keyboard focus", a DOM-focus operation), or the doc should say plainly that it
resets the cell focus and that `grid.element.focus()` is the non-destructive form.

## 3. `Ctrl+C` cannot work in a sandboxed iframe — needs a fallback or an option

`docs/api.md` says: *"`Ctrl+C` does not come through `copySelection()` — it goes through the
browser's own copy event, which needs no permission."* Inside a **Persephone board iframe the
native `copy` event never fires at all**. Verified precisely: the `keydown` arrives at the grid root
with `ctrlKey: true` and `defaultPrevented: false`, and no `copy` event follows on the grid root or
on `document` (capture phase). So the built-in Ctrl+C **silently copies nothing** — the worst
failure mode, and the same one Tabulator has there for a different reason.

The right-click **Copy** items are unaffected: they go through `copySelection()` →
`navigator.clipboard`, which works fine in that frame.

**Suggested fix** — any of:
- On the Ctrl+C `keydown`, note it, and if no `copy` event follows in the same task, fall back to
  `copySelection()`. (The keydown is a user gesture, so the write is permitted.)
- Or a `clipboardMode: "event" | "api"` option, defaulting to the current behaviour.
- At minimum, a doc note next to the "On a Persephone board" theming section: the native copy event
  does not fire in a board, bind Ctrl+C to `copySelection()` yourself.

**Host workaround:**

```js
document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || (e.key !== "c" && e.key !== "C")) return;
    if (/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName)) return;
    e.preventDefault();
    grid.copySelection(e.shiftKey ? "copyWithHeaders" : "copy");
});
```

## 4. Explicit `columns` get no width detection — DOC BUG, and arguably a behaviour gap

`docs/api.md` under [`width`](../docs/api.md) says: *"Omitted, the width is detected from the
content — see What is inferred."* That is only true when the **whole `columns` option** is omitted.
A host that supplies its own `columns` — which any host with computed headers must — gets
`defaultGridColumnWidth` (140px) for **every** column, however narrow or wide its content. The
Excel Viewer's first render had six identical 140px columns for `A`…`F`.

The escape hatch exists (`inferColumns` is exported and does detect widths, capping around 300px)
but is not discoverable from that sentence, and the two width helpers listed in the Helpers table —
`detectColumnWidth` / `detectColumnWidths` — have **no documented signature**. Both my guesses at
the argument order returned `{"[object Object]": null}` or threw, so I gave up on them:

```js
detectColumnWidths(rows, cols)   // => {"[object Object]": null}
detectColumnWidths(cols, rows)   // => {"[object Object]": null}
detectColumnWidth(col, rows)     // => TypeError: Cannot read properties of undefined (reading 'length')
detectColumnWidth(rows, col)     // => TypeError: same
```

**Suggested fix.** Detect widths for host-supplied columns that omit `width` (the same code path
inference uses), or — if that is deliberate, e.g. to keep `create()` cheap — say so explicitly under
`width` and show the `inferColumns` recipe. Either way, give the two `detect*` helpers a signature
in the Helpers table; a helper you cannot call is not exported.

**Host workaround** (what the board ships — note it measures the *displayed* text, not the raw
values, since a `Date` object's width is meaningless):

```js
const probe = rows.slice(0, 200).map((row) => project(row));   // {key: displayedText}
const detected = new Map(inferColumns(probe).map((c) => [c.key, c.width]));
for (const column of dataColumns) column.width = clamp(detected.get(column.key));
```

---

## Smaller notes

- **`isStatusColumn` is exactly right for a row-number gutter**, and the behaviour a host wants is
  already there: it is excluded from range selection and from copy, and `filterType: null` /
  `resizable: false` are both honoured on it. None of that is stated in the docs — `isStatusColumn`
  is one line in the `Column` interface (`a non-data column, pinned left`). It deserves a short
  section; a host cannot otherwise tell whether the gutter will end up in the user's clipboard.
- **The read-only context menu is correct out of the box** — a grid with no `editable` and no
  `can*` shows only Copy / Copy as…, no Paste or row/column items. Worth stating, because the
  natural defensive move is to filter the menu with `onGridContextMenu`, which would be wasted work.
- **The "not AG Grid" warning at the top of `api.md` earns its place.** `key`/`name` and the flat
  options object are easy to hold; having the misspelling table and the alias policy up front meant
  no wrong-name guesses in the whole port.
- **The `--p-*` fallback chain is a genuine feature on a board.** Zero theming code, and
  `--avg-bg` / `--avg-header-bg` resolve to `--p-bg` / `--p-bg-dark` exactly as documented.
