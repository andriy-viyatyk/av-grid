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

---

## Resolution

Investigated 2026-08-11 against this source, reproducing each claim in a real browser before
touching anything. **Two of the four are real; two are artifacts of how the port was tested.**

### The testing artifact behind #1, #2 and #3

Persephone's `browser_click` dispatches a bare synthetic `click` — no `pointerdown`, no
`mousedown` — and `browser_press_key` dispatches keys with `isTrusted: false`. Verified by
instrumenting both boards: a `browser_click` on a data cell logs exactly one event, `click`, and a
`browser_press_key` of `Control+c` logs `keydown:c+ctrl trusted=false`. The board's own CLAUDE.md
records the follow-on advice — synthesise the pointer sequence in `browser_evaluate` instead — but
by then the conclusions were drawn.

That explains all three:

- **#1 does not reproduce.** A `pointerdown` on a data cell has always focused the root
  (`GridInteractions.onCellPointerDown`). Dispatching one *in the Excel Viewer board itself*, with
  the board's own capture-phase workaround bypassed — the workaround is on `mousedown`, so a lone
  `pointerdown` isolates av-grid — moves `document.activeElement` from `BODY` to `.avg-grid`. A
  synthetic `click` alone reaches neither handler, which is what "activeElement stays on `<body>`"
  was measuring.
- **#2 does not reproduce.** `grid.focus()` *is* `grid.element.focus({ preventScroll: true })` and
  nothing else — one line, `AVGridModel.focusGrid`, with no listener on the far side. Measured:
  `getFocus()` before and after is byte-identical, and identical again after `grid.element.focus()`.
  Most likely the A1 came from an arrow key pressed while nothing was focused yet, which does start
  at the first cell.
- **#3 does not reproduce either.** A synthetic `keydown` never produces a `copy` event on *any*
  browser, so "keydown arrives, no copy event follows" is what a synthetic key looks like
  everywhere, not what a board iframe looks like. A document that does not have focus — which is
  every MCP-driven page — will not copy either. Settled by hand, since no tool here produces
  trusted key input: **a real Ctrl+C copies correctly in a board**, confirmed in both this
  project's test boards and the Excel Viewer itself. The board's keydown binding is unnecessary,
  though harmless — it takes a different path to the same clipboard.

**Both #1 and #2 were nonetheless worth the trip**, because #1 pointed at a real bug next door.

### What was fixed

**Focus is now taken on any press inside the grid** (`GridInteractions.focusRoot`), not only on one
that resolves to a data cell. The real gap was the *other* branches: a press on a **header**, on the
empty area past the last row or right of the last column, or on the band a status column occupies,
left focus wherever it had been — so sorting by clicking a header killed the arrow keys, and on a
fresh page they had never worked at all. A press landing on a control that takes focus itself is
skipped, because stealing it would close the editor the press was opening.

**Explicit `columns` that omit `width` now get one detected from content**, which is what the docs
had always promised. Measured through `columnDisplayValue`, so `formatValue` and `displayFormat`
are what gets measured — strictly better than the inference path was on its own, and the same
correction the board's `detectWidths()` had to make by hand. A column with nothing to measure keeps
the 140 px default rather than being sized to its header, so a column `addColumns()` has just made
is not the narrowest thing on screen at the moment it most needs room. The board's `detectWidths()`
probe can be deleted.

### What was documented

- `width` — detection stated properly: both paths, the 50-row sample, display text not raw values,
  the 60–300 px bounds, and the two cases that fall back to 140 px.
- `detectColumnWidth` / `detectColumnWidths` — full signatures and the `options` defaults, in the
  Helpers table. The port's four guesses failed because the first argument is the **rows** and the
  column is named by a **string key**, not by a `Column` object.
- `isStatusColumn` — its own section: what it does to pinning, focus, editing, copy, the header
  affordances and the "unknown column" check, with the row-number gutter as the example.
- `focus()` — says plainly that it is DOM focus only and leaves the cell focus alone, and that a
  press already does it.
- The clipboard section — that no host suppressing the native event has actually turned up, the
  binding to write if one ever does, and how to tell that case apart from a synthetic-key harness.
- **A new section, [Driving the grid from an agent](../docs/api.md#driving-the-grid-from-an-agent)**,
  which is the real fix for three of these four. It states that `browser_click` and
  `browser_press_key` are synthetic and what that breaks, gives the API-first path, gives the full
  pointer sequence for when a real gesture is needed — including that `pointerup` goes on `window`
  and that a cold cell takes two presses to edit — and notes that keyboard *navigation* works
  synthetically while the clipboard keys do not. `docs/boards.md` points at it from the running
  instructions, where an agent driving a board is looking.

The read-only context menu and the `--p-*` chain were already documented as the port found them;
nothing to change there.

---

## Confirmed downstream (2026-08-12, av-grid 2.1.0)

The Excel Viewer board was updated to 2.1.0 and the resolution above **checks out in the board
itself**. Retested there, using the pointer protocol the new
[Driving the grid from an agent](../docs/api.md#driving-the-grid-from-an-agent) section prescribes:

- **#1 was the harness.** A lone `pointerdown` on a data cell — with the board's workaround
  removed — moves `document.activeElement` from `BODY` to `.avg-grid`, and the cell focus lands on
  the pressed cell, not A1 (which also disposes of #2). A synthetic `browser_click` reaches
  neither, which is all the original measurement was seeing. **Both workarounds deleted.**
- **The width fix removes the `detectWidths()` probe entirely.** Detection on explicit columns now
  produces 68/76/60/76/76/300 px against the probe's 68/76/64/76/76/300 — the same answer, minus
  25 lines of board code. Measuring through `columnDisplayValue` is what makes it correct here:
  the raw values behind these columns include `Date` objects, whose width means nothing.
- **Search highlighting works with no setup**, because the board's columns project through
  `formatValue` rather than `render`. One note on the shape: the docs recommend `"both"` for dark
  themes, and in Persephone's `default-dark` that reads *worse* than the colour-only default —
  the accent is saturated enough that the tint becomes a solid block behind text of nearly the
  same colour, so the marked word is harder to read than its neighbours, not easier. The board
  ships the default. Worth softening that recommendation to "try it, it depends on how saturated
  the host's accent is".
- **#3 remains unverified from here**, honestly — no MCP tool produces trusted key input, so the
  board's Ctrl+C binding was removed on the strength of the by-hand retest recorded above rather
  than on a measurement of our own.

The new agent section is the right fix. Had it existed, three of the four reports would not have
been filed; `docs/boards.md` pointing at it is where an agent driving a board will actually meet it.
