# AV-Grid

**av-grid** is a dependency-free, framework-agnostic virtualized data grid written in
TypeScript that renders directly to the DOM. It targets **100,000+ rows** with no lag while
scrolling, selecting a range, or editing.

It is a port of the React grid inside **Persephone**, whose virtualization engine is already
framework-free — this project reimplements its rendering layer in plain DOM so the same
performance is available to any plain-JavaScript page. The first consumer is Persephone
Boards, which are written by AI agents; that shapes the API design.

## 📋 The plan

**[`tasks/goal.md`](tasks/goal.md) — read this before starting work.** It holds the goal,
success criteria, the architecture being ported, the per-file port status, the filtering
subsystem, the public-API design principles, scope, and the documentation deliverables.

**[`tasks/plan.md`](tasks/plan.md) — the build order for the current phase.** Each task has a
definition of done. Work top to bottom. **Phase 6, customization (tasks 21–26), is complete**: the
class hooks, custom cell editors, custom filter types, `copyValue`, `sortValue`, and the docs,
example and board that cover them.

**[`tasks/plan-done-01.md`](tasks/plan-done-01.md) — the finished plan for the port**, tasks
1–20 in five phases, archived unedited. **Read its decision log at the bottom before starting
any task.** It records every place the port deliberately diverges from the reference, and why —
including several reference bugs that are fixed rather than carried over, and the traps that
each cost a debugging session. A plan is archived this way once all its tasks are ✅; `plan.md`
then restarts at the current phase, carrying forward the standing rules and a pointer back.

## 📊 Current state

**Phase 6 — customization — is done.** All six tasks, 21–26, in [`plan.md`](tasks/plan.md).

**Every customization hook is documented, demonstrated and checked in a browser.**
[`docs/api.md`](docs/api.md#customization-at-a-glance) opens the column section with one table from
*the thing a host wants* to *the hook that does it* — seven rows, each linking to its own section —
and `editRender` has joined the removed-names table beside the reference's misspellings.
[`examples/10-customization.html`](examples/10-customization.html) is all seven in one runnable
file: priority colours from `cellClass`, an overdue row from `rowClass`, a date-picker `editor`, a
date-range `filter`, a `copyValue` on a column that draws a bar, and a `sortValue` that ranks. And
[`test-boards/CustomizationBoard/`](test-boards/CustomizationBoard/CLAUDE.md) turns the
documentation's sentences into **20 pass/fail claims** — `checkAll()` reports 20/20, each row
carrying the value it was checked against, so a regression says what it saw rather than only that
it failed. It asserts rather than times, because `AVGridBoard`'s five drivers already time the same
hooks.

**Driving the example found a bug older than the phase: an edit froze the row order and only a sort
released it.** `freezeRows()` holds the displayed order steady while a cell is open, so the row
being typed into cannot jump away — but a filter cleared afterwards left the filtered-out rows on
screen, because `updateRows()` short-circuits into `updateFrozenRows()`, which adopts new row
objects in place and re-filters nothing. The reference releases the freeze on *all three* of search,
filters and sort; `RowsModel.refilterRows()` is now that path, called from `FiltersModel` and
`setSearchString`. Three tests and a board check. No unit test could have found it — it takes an
edit, then a filter change, then a look at what is actually on screen.

**A percentage column width fits the grid to its container on its own — and used to guarantee a
horizontal scrollbar while doing it.** `calcInnerSize` adds 20 px of slack past the last column so
it can scroll clear of the edge, and drops it under `fitToWidth` because the columns already total
the width. But the fit runs whenever *any* width is a percentage, `fitToWidth` or not — so one
`width: "35%"` column got a perfect fit **and** the slack on top: measured on the board, columns
fitted to exactly 1203 = 1215 − a 12 px scrollbar, `area` 1223. The vertical scrollbar was never
the problem; `hasPercentLength()` now decides `columnsFitted`, which `calcInnerSize` and
`rerender-check`'s resize branch read in place of the option. The reference has the same hole and
never falls in it, because Persephone only ever writes a percentage alongside `fitToWidth`. Gate
unmoved at 1.03×, 60/60 fps.

**One table now says which hook feeds what**, in [`docs/api.md`](docs/api.md#which-hook-feeds-what):
screen, sort, search, a filter's row test, a filter's option list, copy and paste, each with the
order it tries. Writing it by reading the code rather than recalling it found **two documented claims
that were false** — `formatValue` was said to feed sorting, and `dataType` to govern the comparator;
neither does, because `defaultCompare` compares `row[key]` by its *runtime* type — and one real
asymmetry that stays: **copy prefers `formatValue` over `render` while the screen prefers `render`**,
because a `formatValue` is already the plain text a spreadsheet wants. A column that wants its
rendered text copied says so with `copyValue`, which is the other half of task 24: a hook used by
every copy path — ctrl+C, ctrl+X, all four Copy as… modes, `getSelectionText()` — for the cell whose
screen form is a bar, a badge or an icon. It is **6× cheaper than the fallback it overrides** (0.20 ms
against 1.24 ms for 1,000 cells), because reducing `render`'s markup to text costs an `innerHTML`
write and a `textContent` read per cell. There is no `pasteValue`: `validate` already coerces an
incoming value on typing, pasting and range-delete alike.

**A column sorts by whatever a host says, in one line.** `Column.sortValue: (row) => any` is the
projection — `sortValue: (row) => RANK[row.status]` is a status priority, and whatever it returns is
compared the way the grid compares anything — and `Column.rowCompare`, which has been there since the
port and was documented by one line in a type block, stays for an order that is genuinely pairwise: a
collator, a natural sort, a tie-break across two properties. It wins where both are set. Both sort
ascending, because a descending header click reverses the sorted array.

**`sortValue` is read once per row, not once per comparison, and that is measured rather than
assumed.** `Array.sort` calls its comparator O(n log n) times — **1,209,558 times for 100,000 rows**,
counted on the board — so a projection written inside a `rowCompare` runs that often too; decorating
the rows with their sort values and sorting *those* is 100,000 calls. Twelve times fewer calls buys
**5%** on a table lookup (10.3 ms against 10.8 ms — the wrapper object per row eats the rest) and
**2.7×** on a projection that lowercases and concatenates (17.5 ms against 46.9 ms). It never loses,
and it wins in proportion to what the projection does, which is the right way round.

**A column can bring its own filter type, and the grid still draws everything around it.**
`Column.filter` takes a definition — `{ name, create, label, match }`, plus `serialize` /
`deserialize` if the value is not JSON-shaped — and the funnel then opens the host's element
instead of the checklist. `create(ctx)` returns `{ element, getValue, focus?, destroy? }` and
nothing more: the grid keeps the panel, the **Apply** and **Clear**, the chip that reads `label`
and reopens the body anchored to itself, the cascade into the other columns' option lists, and the
persistence. **No registration call** — the definition is an object on the column, so reuse is a
shared `const` and there is no order of calls to get right. `filterType: null` still takes the
funnel off; a filter naming a type its column is not filtered by is rejected, which is what makes
a stored filter whose definition has gone drop with a warning instead of silently matching nothing.

**A host `match` is *cheaper* than the built-in test it replaces — and 56× more expensive written
the obvious way.** On 100,000 rows at matching selectivity: a definition whose `getValue` parses
its bounds once and whose `match` is two numeric comparisons filters in **1.7 ms** against
**2.1 ms** for the built-in `"options"` test, which resolves each row through `filterValue` and
`optionMatches` before it reaches `===`. The same date-range filter re-parsing its bounds inside
`match` takes **90 ms**. That is why there is no `prepare`-style second hook: the value is data
the definition controls, and putting the parsed form in it is the whole optimization.

**A column can supply its own editor, and it takes four lines.** `Column.editor` receives the
`EditorContext` the built-in text box and dropdown already use — value, row, column, indices,
`openedBy`, and `setValue` / `commit` / `cancel` — and returns an element, or `{ element, focus?,
destroy? }` when it owns a panel somewhere else. The broken `editRender` is gone: it was handed a
`CellContext`, so whatever it drew had no way to record a value or end the edit. The grid **adopts**
whatever comes back — adds `avg-cell-editor`, which is what positions it inside the cell, marks it
`data-type="cell-editor"` so its keys and clipboard are not the grid's, and binds Escape and Tab so
an editor that handles neither still cancels and still lets the user move on. **Commit-on-blur is
deliberately not the grid's**: it lives in `CellInput`, which is what lets a date picker take the
focus without closing the edit underneath it. A column with an `editor` opens it whatever its
`dataType`, including `boolean` — which then shows a tick and no checkbox, because the checkbox's
press toggles and would make the editor unreachable.

Writing that task's teardown test found **a fifth way an edit can end, and a real bug**: scroll the
editing row far enough and the pool *evicts* the cell instead of repainting it as another one, so
`releaseCell` never fired and the edit stayed open around an element no longer in the document — a
`CellSelect`-style editor would have left its popover on `document.body`. `onViewportScrolled` now
closes it, reading the render window synchronously rather than waiting a frame to ask the DOM. It
affected the built-in editors identically, and only a browser can see it, because the pool needs
real layout to evict anything.

**Styling reaches the granularity a host actually styles at.** `Column.cellClass` and
`Column.headerClass` take a constant string or a function of the cell; `rowClass` on the options
highlights a whole row. All four class hooks — those three plus the existing `onCellClass` — are
additive on top of the state classes, accept an array with its falsy entries dropped, and are
reassigned whole on every paint, so a class **disappears** when its hook stops asking for it:
removing all four from a live 100,000-row grid takes 70/10/130/1 marked cells to 0/0/0/0 and
restores exactly those counts. That is the pool trap, and no happy-dom test can see it. The cost
is **+0.012 ms on a full repaint of every visible cell and 0 DOM mutations** — measured as
alternating pairs, because timed in blocks the bare grid came back *slower* than the hooked one.
There is no row element to hang a class on, by design, so `rowClass` lands on each of the row's
cells; and a host rule has to out-specify `.avg-data-cell`, so write `.avg-data-cell.overdue`.

**All twenty tasks of the port are done.** Phases 1–5 are complete, including the two primitives the filter
UI needed and the library did not have — **14a `Popover`** and **14b `VirtualList`**, built fresh
rather than ported from UIKit — and both documentation deliverables.

**[`examples/`](examples/) holds eleven runnable files**, one topic each, every one standalone and
meant to be copied whole: minimal · columns · cell rendering · sorting and filtering · selection
and keyboard · editing · clipboard · theming · the 100k benchmark · customization · a Persephone
board. Each was
opened in a real browser and driven, which is how three of them ended up different from how they
were written. The benchmark reports **12.1 cells touched per paint at the top against 12.0 at row
99,000** — the exact number — next to the timing ratio, which swings 0.8×–1.2× because a paint
costs 0.1 ms. The board example was scaffolded, vendored and opened: it renders in Persephone's
dark theme with **not one line of theming code and an empty `ui.log`**.

**⚠ `--avg-*` on an ancestor does nothing** — the grid root, `.avg-popover`, `.avg-list` and
`.avg-filter-bar` each define the whole token block *on themselves* from `--p-*`, because a
popover lives on `document.body` and cannot inherit from a grid, and an element's own definition
shadows any ancestor's. So: **`--p-*` on an ancestor reaches everything, `--avg-*` on an ancestor
is shadowed, `--avg-*` on the element itself wins.** The docs used to say otherwise; running the
theming example in a browser is what caught it. Whether the defaults should move to `:root` so an
ancestor's `--avg-*` works is still open.

**[`docs/api.md`](docs/api.md) is the complete public surface**, written for an agent reading it
once mid-task: every option, every column field, every instance method, every callback (marked for
which ones can veto by returning `false`), the filter API and its persistence, the keyboard map in
four tables, the CSS custom properties with what each falls back to, and the DOM contract. It
records the **naming decision** — `key` / `name`, no aliases, and why — so it is not relitigated,
and it commits to the class names and `data-*` attributes as public while explicitly leaving the
DOM *structure* free to change, because cells are pooled and their nesting already has. Every
signature was read out of the source rather than recalled; two of them (`filterRows`,
`rowsToCsvText`) were not what the obvious guess would have been.

**On a board the grid now looks like Persephone's own.** Four tokens stopped being derived and
started naming their `--p-*` counterparts, so they resolve to the reference's exact values: the
header band and the filter bar take `--p-bg-dark` (#181818 against a #1f1f1f body — *darker* than
the grid, which a `color-mix` tint of the text colour could never be), and the cell lines moved to
a token of their own, `--avg-grid-line` = `--p-border-light` (#2b2b2b), so they recede without
thinning the popover borders that shared `--avg-border-color` with them. The two `+` buttons
brighten to `--p-text-strong` on hover instead of turning blue, and a menu row takes the full
`--p-selection-bg` / `--p-selection-text` pair rather than the 18% tint a checklist wants. Every
fallback is the old value, so a bare HTML page is unchanged.

**The row highlight follows the pointer everywhere it should.** It read `mousemove`, and
`onCellPointerDown` calls `preventDefault()` to stop the browser starting a text selection — which
**suppresses the compatibility mouse events for the rest of that pointer's stream**, so a range
drag delivered no `mousemove` at all and the highlight stayed on the cell the drag began from
until the button came up. It reads `pointermove` now. A wheel scroll under a stationary pointer
re-resolves the row after the paint, on the scroller's own `scroll` event — before the paint the
hit test returns the row that *was* there. The gate is untouched, because that handler returns
immediately when no pointer is over the grid, which is every programmatic scroll; a real wheel
scroll under the pointer costs **0.291 ms a paint against 0.120 ms**, and the highlight moving on
its own is **0 mutations and 0.045 ms**.

**Right-click has a menu, and a host can take it over.** Copy, Copy as… (headers / JSON / HTML
table), Paste, and Insert / Add / Delete for both rows and columns, each label counting what the
selection actually covers — a header gets the two column items instead. `getContextMenuItems`
adds items above the built-in ones; `onGridContextMenu(e, items)` receives the point and the
items the grid *would* have shown and draws its own menu instead; `disableContextMenu` hands the
gesture back to the browser, which is also what an open cell editor gets, because Cut/Paste and
spelling are things only the platform can offer. **Opening one over 100,000 rows marks 0 things
on the grid and mutates 0 DOM nodes, and costs 2.3 ms with every row selected against 2.9 ms
with one** — `e.selection` is a getter and nothing built-in reads it. The menu itself is a new
primitive, `Menu`, on `Popover`: submenus on hover or click, arrow keys, and a search box past
twenty items.

**`getState()` answers "what is going on" in one line, and it survives `JSON.stringify`.** Every
field is plain data — the columns are flattened to key/name/width plus sorted, filtered, editable
and `hasRender` / `hasOptions`, because it used to hand back the live `Column[]` with its functions
on it. There are no row objects anywhere: counts, keys and indices only, so logging a 100,000-row
grid stays readable and puts no host data in the line. A `viewport` block reports the window the
engine believes is on screen and the size it thinks it has, `width: 0` being the answer to the
commonest integration failure.

**`destroy()` releases everything, and there is now a test that proves it.** 100 create/destroy
cycles of a fully-loaded grid leak **0 DOM nodes** and leave **100/100 grids collectable**, at
6.5 ms a cycle. Afterwards a mutator warns once and does nothing while the getters still answer —
`getState().destroyed` is `true`, which is exactly when a post-mortem wants it.

**The cell dropdown is the library's own DOM now.** A column with `options` opens a themed,
virtualized list instead of a native `<select>`, whose popup the platform drew and the `--p-*`
contract could never reach. **10,000 options put 13 rows in the DOM and mutate zero grid cells**;
typing over a cell seeds the list's search box instead of the cell's value, a picked option keeps
its type — `20` commits as the number, which the stringifying `<select>` could not manage — and
Escape or a click elsewhere cancels rather than committing.

**Applied filters show as removable chips.** `filterBar: true` puts a bar above the grid, or
`AVGrid.createFilterBar(el, { grid })` puts one anywhere — both make the same object, and a grid
can have any number of them, all live. A chip reads `Status: open,pending (+3)`; clicking its body
reopens the popover *anchored to the chip*, its ✕ removes that filter and the ✕ at the right end
removes them all. The bar takes no space at all until something is filtered. Every filter change
while the bar is up mutates **zero** DOM nodes; the bar appearing or going away costs one row of
cells, because it changes the grid's height by 32 px.

**Filtering works from the header.** Every column carries a funnel (`filterType: null` takes it
off one, `disableFiltering` off all of them); clicking it opens a searchable checklist of the
column's distinct values, cascaded against the other filters, with select-all, Apply and Clear.
The option list is supplied by the library unless a host passes `onGetOptions`, which may return
a promise. Opening one over 100,000 rows marks **one** thing on the grid and mutates **zero** DOM
nodes, and a column with 100,000 distinct values puts **12** rows in the checklist — `VirtualList`
earning its keep.

**Filters apply, persist and round-trip.** `grid.applyFilter({ columnKey: "status", value:
["open"] })` narrows 100,000 rows to 40,000 in **5.9 ms with one repaint and zero DOM
mutations**, and clearing it costs **0.0 ms** because an unfiltered pass returns the same array
it was given. `persistFilters: { name }` remembers the filters across a reload through an
injected store — `localStorage` by default, never written to unless asked — reviving `Date`
values without losing the labels around them.

**Both primitives are done.** `Popover` anchors to an element or a point, flips instead of
clipping, caps its height to the space available and scrolls, dismisses on Escape or an outside
pointerdown, resizes by a corner grip, and resolves a promise when it closes. `VirtualList` is a
searchable checklist on its own `RenderGrid` instance: **100,000 options mount in 4.4 ms with 11
rows in the DOM, scroll at 60 fps with a flat-cost ratio of 1.00×, and select-all across all of
them costs 9 ms and one repaint.**

There is a working grid. `AVGrid.create(el, { rows })` renders a real one — columns, header
labels, widths, row keys and data types all inferred — with header sorting, column resize and
reorder, custom cell renderers, a search filter, cell focus, full keyboard navigation, range
selection by drag or by shift, row selection through a checkbox column, in-cell editing
(`editable: true`, opened by a press on the cell that already has the focus — so a cold cell
takes two clicks and a focused one takes a single click, as the reference did, and the caret lands
**where the click landed**, with nothing selected, while Enter / F2 / `startEdit()` select the whole
value instead; an editable boolean
cell carries a checkbox that toggles on the first click, and only the box toggles — the cell
around it just selects; Tab and the vertical arrows commit and move on, while the horizontal ones
stay with the caret), Excel-compatible clipboard copy/cut/paste, rows and columns added and
deleted by button, keyboard or API — and the row that ArrowDown adds off the bottom is taken
back if the focus leaves it without anyone typing in it, so holding the key to read the end of a
grid does not leave a blank row behind — column filters applied through the API, and a stylesheet
driven entirely by CSS custom properties.

The performance thesis survived the grid layer, and then survived selection. 100,000 rows in a
real browser, through the *whole* grid rather than the engine alone: first paint 6.7 ms, 60 fps
at both the top and row 99,000, a **flat-cost ratio of 1.08×**, a full repaint of every visible
cell in 0.2 ms doing **zero** DOM mutations, and a theme change costing **zero** paints.

Task 10's own gate: dragging a range selection anchored at row 0 down through row 99,000 —
a live selection of 99,001 rows against 101 at the top — marks **2 cells dirty per pointer
move at both ends**, for a model cost of 0.0141 ms against 0.0147 ms, a **ratio of 1.04×**.
Task 11's: selecting all 100,000 rows takes 24.9 ms, marks **19 rows** dirty, and mutates
**zero** DOM nodes. Task 12's is about survival rather than throughput — a full repaint while a
cell is being edited does **zero** DOM mutations and hands back the same `<input>`, which is the
first thing in the library that would notice if the render path stopped preferring `p.previous`.
The gate was re-run with editing on and holds: first paint 5.7 ms, flat ratio 0.94×, 60/60 fps.
Task 13's is the same shape one level up: pasting into 1,000 cells marks **one** repaint and
mutates **zero** DOM nodes, because a paste writes silently and marks the viewport once at the
end. Task 14's is the geometry one — inserting a row *above* the viewport at row 90,000 mutates
**zero** DOM nodes and keeps both the scroll position and the focus, which took fixing a
focus-recentre that was moving the viewport 261 px behind the user's back. Task 15's is the
cheap direction and the expensive one: filtering 100k rows down costs **5.9 ms, one repaint and
zero mutations**, filtering back up costs nothing at all, and closing the computed-column search
gap left over from task 13 costs **+8.7%** on a full-text search — measured, because it puts a
host callback inside the row loop. Task 16's is about what a popover costs the grid *behind* it:
opening one over 100,000 rows marks **1** cell dirty and mutates **0** DOM nodes whether the
column has five distinct values or a hundred thousand. Full results, history,
and the measurements that mislead if taken carelessly, in
[`tasks/benchmark-results.md`](tasks/benchmark-results.md).

## Reference implementation — Persephone

The React implementation being ported lives in the Persephone project:

```
C:\projects\persephone\src\renderer\uikit\
    AVGrid\        ← grid behavior: columns, rows, selection, focus, editing, copy/paste, filters
    RenderGrid\    ← the virtualization engine: visible-window math + cell-level dirty tracking
```

**Persephone is a read-only reference. Never modify anything under `C:\projects\persephone`.**
Read from it freely; write only inside `C:\projects\av-grid`.

Supporting code that AVGrid depends on, also under `C:\projects\persephone\src\renderer\`:

| Path | What it provides | What to do with it |
|------|------------------|--------------------|
| `core/state/model.ts` | `TModel` / `TComponentModel` base classes, `useComponentModel` | Replace with a minimal observable |
| `core/state/state.ts` | `IState`, `TComponentState` reactive state primitive | Replace with a minimal observable |
| `core/state/events.ts` | Event channel used by `AVGridEvents` | Port — small and framework-free |
| `core/utils/csv-utils.ts` | CSV parse/serialize for clipboard copy/paste | ~~Port as-is~~ — it wraps `csv-stringify` / `csv-parse`, so it was **rewritten** dependency-free as `src/core/csv.ts`, keeping both signatures |
| `core/utils/utils.ts`, `core/utils/memorize.ts` | misc helpers | Port the few functions actually used |
| `core/traits/` | Trait-based data binding for UIKit list components | Drop — UIKit-specific |
| `theme/color.ts` | Theme color tokens | Replace with a CSS custom-property contract |
| `shared/utils.ts` | misc helpers | Port the few functions actually used |

Per-file port status for everything under `AVGrid/` and `RenderGrid/` is in
[`tasks/goal.md`](tasks/goal.md#file-inventory-and-port-status).

Persephone's own docs are worth reading when board integration comes up:
`C:\projects\persephone\assets\board-template\CLAUDE.md` (the board authoring guide, including
the `--p-*` theme contract) and `C:\projects\persephone\boards-assets\manifest.json` (how
third-party components are vendored into boards).

## Project layout

```
av-grid/
    CLAUDE.md                    ← you are here
    tasks/
        goal.md                  ← the goal, scope, and API design principles
        plan.md                  ← the current phase's tasks + its decision log
        plan-done-01.md          ← the port, tasks 1–20 — done; its decision log still applies
        benchmark-results.md     ← performance history; append after render-path changes
    scripts/
        build-css.mjs            ← emits dist/av-grid.css from the stylesheet module
    src/
        index.ts                 ← public entry point
        AVGrid.ts                ← AVGrid.create() — the façade wiring models to the engine
        options.ts               ← AVGridOptions, the surface an agent writes by hand
        validate.ts              ← loud validation + inference for the minimum call
        types.ts                 ← public type surface (Column, CellFocus, Filter, …)
        gridUtils.ts             ← formatting, comparison, row filtering
        column-width.ts          ← content-based width detection
        model/                   ← grid state, ported from AVGrid/model/
            AVGridModel.ts       ← the hub every other model hangs off
            AVGridData.ts        ← derived data + batched change events
            AVGridEvents.ts      ← the internal event bus
            CopyPasteModel.ts    ← copy/cut/paste, on the native clipboard events
            ColumnsModel.ts      ← visible columns, resize, reorder
            RowsModel.ts         ← filter → sort pipeline
            FiltersModel.ts      ← which filters are applied, and their persistence
            SortColumnModel.ts   ← sort state and its comparator
            FocusModel.ts        ← focus, keyboard nav, range selection
            SelectedModel.ts     ← row selection, by row key
            EditingModel.ts      ← in-cell editing: open, commit, cancel, validate
            StructureModel.ts    ← rows and columns added and deleted
        view/                    ← the DOM, rewritten rather than transliterated
            ContextMenu.ts       ← what right-click offers, and the two hooks that change it
            Menu.ts              ← the menu itself: rows, submenus, keyboard, search
            FilterBar.ts         ← removable chips: edit from one, remove one, remove all
            DataCell.ts          ← the hot path; allocation-light
            CellInput.ts         ← the text editor; owned by EditingModel, never pooled
            CellSelect.ts        ← the dropdown editor, for a column with `options`
            DefaultEditFormatter.ts ← which of the two a cell gets
            HeaderCell.ts        ← label, sort indicator, resize grip, filter funnel
            FilterPopover.ts     ← showFilterPopover(): dispatch on filterType, resolve on close
            OptionsFilterContent.ts ← the checklist body: search, select-all, Apply, Clear
            Button.ts            ← the two buttons the filter UI needs, and nothing else
            Popover.ts           ← the floating panel: anchor, flip, clamp, dismiss, resize
            VirtualList.ts       ← virtualized checklist: search, select-all, keyboard
            SelectColumn.ts      ← the checkbox column, as an ordinary Column
            GridInteractions.ts  ← every listener, all of them delegated from the root
            cellDom.ts           ← setText / applyCellStyle, the two per-cell operations
            icons.ts             ← SVG source strings
        styles/
            av-grid.css.ts       ← the whole stylesheet; single source of truth
        core/                    ← framework-free primitives replacing Persephone's React deps
            observable.ts        ← replaces TComponentModel / TComponentState
            events.ts            ← typed event channel
            AsyncRef.ts          ← awaitable ref, so scrollTo() works before mount
            csv.ts               ← dependency-free CSV/TSV for the clipboard
            utils.ts             ← the few helpers the grid actually uses
        render/                  ← the virtualization engine
            types.ts             ← RerenderInfo and friends
            renderInfo.ts        ← visible-window geometry (pure, no DOM)
            rerender-check.ts    ← dirty-set computation (pure, no DOM)
            RenderGridModel.ts   ← scroll, resize, dirty-set merging
            RenderGrid.ts        ← the DOM shell: nine regions + rAF paint loop
            CellPool.ts          ← element recycling
    test-boards/                 ← Persephone boards used to run and debug the grid
        RenderGridTest/          ← the engine alone: the 100k-row performance harness
        AVGridBoard/             ← the whole grid: rendering, interaction, theming
        CustomizationBoard/      ← the host hooks: every documented claim, checked
    docs/api.md                  ← API reference (task 19)
    examples/                    ← runnable standalone examples (task 20)
```

Tests sit next to their subject as `*.test.ts`. Everything runs in the node environment except
`RenderGrid.test.ts` and `AVGrid.test.ts`, which need a DOM and opt into happy-dom with a
per-file `// @vitest-environment happy-dom` docblock.

## Commands

```
npm test              # vitest, all tests
npm run test:watch
npm run typecheck     # tsc --noEmit, strict
npm run build         # typecheck + vite lib build to dist/ (ESM + UMD) + dist/av-grid.css
npm run build:board   # bundle src/ into both boards' lib/
```

## Test boards — how to actually run the grid

The unit tests run under happy-dom, which does **no layout**. So a passing test suite says
nothing about whether the grid renders or performs. That is what the boards under
`test-boards/` are for: real browser, real layout, driveable through the Persephone MCP tools.

| Board | What it is for |
|---|---|
| [`RenderGridTest/`](test-boards/RenderGridTest/CLAUDE.md) | The engine alone, with a stub cell renderer. The 100k-row performance gate. `window.bench` |
| [`AVGridBoard/`](test-boards/AVGridBoard/CLAUDE.md) | The whole grid: `AVGrid.create()`, inference, sorting, resize, reorder, theming. `window.avg` |
| [`CustomizationBoard/`](test-boards/CustomizationBoard/CLAUDE.md) | The seven host hooks, and whether the docs are true: 20 pass/fail claims. `window.custom` |

```
npm run build:board                     # each lib/ is a gitignored build artifact
open_board { path: ".../test-boards/AVGridBoard" }
list_pages                              # find editor: "board-view" → pageId
browser_evaluate { pageId, expression: "window.avg.runBenchmark(100000)" }
browser_take_screenshot { pageId }       # verify visually — a11y snapshots hide layout bugs
```

After editing board files, apply the changes with **`board_refresh { pageId }`** — boards do
not auto-reload. After editing `src/`, run `npm run build:board` first.

Each board puts its whole harness on one global — `window.bench` and `window.avg` — so a
session runs without clicking. Both expose paint timings and pool hit/miss counts, and a
`resetStats()` that isolates a phase.

### Creating a new board

**1. Read the boards guide first — `read_guide("boards")`.** It is the Persephone MCP
documentation for how boards are built: the sandbox and its offline-first CSP, the
`window.persephone` bridge, the `--p-*` theme contract, and the `browser_*` testing tools.
Read it before writing board files, not after the board fails to load.

**2. Scaffold with the `create_board` MCP tool, then write your files into it.** A board
created that way is **auto-trusted**. Board trust is granted per path, and a board Persephone
did not create renders a trust prompt instead of the page — `browser_evaluate` cannot reach it
at all, which makes a hand-created board folder useless for debugging. `create_board` also
refuses a name that already exists, so create first and populate second.

**Add a board here for any subsystem that needs eyes on it** — selection, editing, filtering —
following *Creating a new board* above. Rewrite each board's `CLAUDE.md` to document that
board once it works.

## Working agreements

- **TypeScript**, strict mode. The library ships its own type definitions.
- **No runtime dependencies.** Dev dependencies (build, test, lint) are fine.
- **The API is designed for an AI agent to use without reading docs.** This governs every
  interface decision — see *Who this API is for* in [`tasks/goal.md`](tasks/goal.md#who-this-api-is-for--read-this-before-designing-anything).
- **Design the API before implementing it.** For any new public surface, write the usage
  snippet first — the one that would appear in `examples/`. If the snippet is awkward to
  write or needs explaining, fix the API before writing the code behind it.
- **Measure, don't assume.** After any change to the render path, re-run the benchmark board
  and append a row to [`tasks/benchmark-results.md`](tasks/benchmark-results.md). A regression
  there is the only kind of bug that matters for this project's purpose. It has already earned
  its keep once: it found a 12× cost on full repaints that no unit test could have seen.
- **Verify in a browser, not only in tests.** happy-dom does no layout, so a green suite can
  sit on top of a grid that renders as a blank box. Before calling UI work done, open the
  board, screenshot it, and look.
- **Port behavior, improve structure.** Do not transliterate React idioms into DOM code. The
  models are worth keeping close to the original — the render layer should be written fresh.
- **Read the reference before writing.** The Persephone files are the specification. When
  behavior is unclear, read the original rather than inventing.
- **Ask before adding a feature** that is not in the scope section of
  [`tasks/goal.md`](tasks/goal.md#scope).

## Three invariants that carry the performance

Everything else is ordinary code. These three are not — each is easy to break with a change
that looks like a cleanup, and breaking any one costs the project its reason to exist.

**1. The scroll offset stays out of `inputChanged()`.** `RenderGridModel.inputChanged()`
compares every input *except* the scroll offset, and carries a comment saying so. Scrolling is
handled by `onScroll → updateRenderInfo(undefined, direction)`, which renders only the newly
exposed cells. Adding the offset "for symmetry" would report a change on every scroll frame,
force `updateRenderInfo({ all: true })`, and rebuild every visible cell 60 times a second.

**2. A cell renderer resolves its element in this order:**

```js
const el = p.previous ?? p.recycle?.() ?? document.createElement("div");
```

- `p.previous` — the element already at this coordinate, present when the cell went dirty
  rather than scrolled in. Updating it in place means the paint does **no** DOM insertion or
  removal, and anything living on the element survives: focus, an open editor, a transition.
- `p.recycle()` — an element evicted on an earlier frame, for cells that genuinely just
  arrived. It comes back **dirty**, exactly as its last occupant left it, so overwrite every
  property you set.
- `createElement` — only when both miss.

Dropping `previous` costs ~12× on full repaints and breaks in-cell editing; dropping `recycle`
allocates on every scroll frame. Prefer `firstChild.nodeValue` over `textContent`, which
allocates a text node per cell per frame.

**A cell that owns something cannot rely on its own repaint to hear that it lost it.** An element
scrolled out of the window is often *evicted* — removed from the DOM and replaced at the new
coordinate by a different element — and a renderer is never called for an element that is merely
evicted. `EditingModel` learned this the expensive way: `releaseCell`, which fires when the editing
cell is repainted as another coordinate, covers a short scroll and misses a long one, so an open
editor was left attached to nothing. The fix is to ask the render window on the scroll
(`onViewportScrolled`) rather than to wait for a paint that will not come.

And whatever a renderer returns, **the stylesheet has to position it absolutely**. The engine
writes `top` and `left`; nothing writes `position`. A cell class that forgets it lays out in
flow, which looks correct at the top of a list — the inline width forces a wrap — and shows an
empty band everywhere below, while every benchmark stays green, because a paint costs the same
whether or not the row ended up where it was told. `VirtualList` shipped that way in task 14b.

The same trap one level out: **anything inserted between the host and the grid root inherits the
root's sizing contract, not just its position.** The engine writes `flex: 1 1 auto` on the root,
so a wrapper that takes the root's place as the host's child must carry it too — task 17's filter
bar wrapper did not, fell back to the flex default of `0 1 auto`, and sized itself to the grid's
*intrinsic* width, rendering a full-page grid as a narrow column down the left of its host. Green
suite, green benchmark: a paint costs the same whatever width the grid ended up.

**3. Listeners go on the root, never on a cell.** `GridInteractions` binds ten listeners for
the whole grid and resolves each event by reading `data-row` / `data-col` / `data-column-key`
off the nearest cell. This is not a micro-optimization — it is a correctness requirement of
pooling. An element that was a header cell one frame is a data cell the next, so a listener
bound to a cell would have to be removed on every recycle, and any one missed would fire
against the wrong column. For the same reason, **state that a handler wants to show goes on
the model, not on the element**: a repaint reassigns `className`, so a class set directly by an
event handler vanishes on the next frame. That is why the column-drag state lives on
`model.flags` and `HeaderCell` reads it.

The consequence that bites hardest: **an affordance *inside* a cell must be resolved on
`pointerdown`, never on `click`.** A real click holds the button for ~100 ms, and any state the
press itself changes — the focus it moves, the hover it triggers — repaints the cell in between
and rewrites its content, replacing the element the press landed on. The browser then dispatches
`click` on the nearest surviving ancestor, which is the cell, and the affordance is nowhere in the
event's path. That is what made the boolean checkbox need two clicks: the first one appeared to do
nothing, and the second worked only because by then nothing was left to change. It cannot be
caught by dispatching `pointerdown`/`pointerup`/`click` in one task, which is what a test does —
there has to be a frame in the middle, as there is in every real press. `click` is safe against
the cell itself, because `data-row` / `data-col` are re-read from whatever element survived.
