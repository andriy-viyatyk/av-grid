# av-grid — Implementation Plan 13 (done): phase 17, `disableColumnReorder` and `treeColumn`

**Phase 17 — done, shipped as 2.10.0 on 2026-09-08: tasks 58 and 59** (requested by a consumer
2026-09-08; the author verified the boards before the release). Phases 1–16 shipped
through **2.9.2**. **Before starting either, read the decision logs in `plan-done-01.md` …
`plan-done-12.md`** — every one of them still applies. Task 58, `disableColumnReorder`, is one
additive option. Task 59, `treeColumn`, is the tree *visual and gesture* on one column — the host
keeps owning the row set. Both additive; planned as two minor releases, **shipped as one (2.10.0)**
once both had been implemented and board-verified in the same session — see the decision log. Both
were reviewed with the author on 2026-09-08; the review's changes are folded into the task texts.

## Ground rules (standing, carried forward)

- Everything is additive; ships as a **minor** version per [`docs/releasing.md`](../docs/releasing.md)
  — unless a phase holds only a defect fix with no new surface, which ships as a **patch**.
- The core stays dependency-free; every new option reaches the React wrapper through lane 3 (or
  lane 2 for a callback) — verify by test.
- Design the API before implementing it; measure, don't assume (benchmark row per render-path
  change); verify in a browser, not only in tests.
- No consumer names in this repo.
- **Ask before adding a feature** that is not in this plan or in [`goal.md`](goal.md#scope).

## Task 58 — `disableColumnReorder`: a grid whose column order is not the user's to change

**The request** (a consumer, 2026-09-08). A pivot-style screen builds its columns from a
user-chosen dimension — one column per payer, one per period bucket — so the order *is* the data's
order, and a header drag that moved `2026Q2` before `2026Q1` would produce a grid that lies. The
host wants header drag-reorder **off** for that grid, while sort, filter, resize and `hidden` keep
working.

**What exists today, and why it is not enough.** Reordering is already off in two situations, both
by the library's own rules rather than the host's:

- a **pinned** column is never draggable (`HeaderCell.ts:122` — `el.draggable = !pinnedLeft &&
  !model.data.hasGroups`), and a drop may not cross a sticky band (`GridInteractions.reorderAllowed`);
- **while column groups are shown**, no header is draggable — *"a grouped order is a prepared
  view"* (`Column.group`, plan-done-07).

So a host that wants no reordering has two workarounds, and both are the wrong tool: pin every
column (which changes layout and forbids percentage widths), or put a `group` on every column
(which draws a header band the screen may not want). The consumer's pivot has groups on some
configurations and none on others, so today the same grid is reorderable or not depending on what
the user picked — the exact inconsistency this option removes. `disableSorting` and
`disableFiltering` are the precedent: a grid-level switch for one header affordance.

**Reviewed 2026-09-08** — three corrections to the first draft, folded in below: the group gate has
*three* readers, not two; a runtime toggle has **no repaint path today** (the same gap
`disableFiltering` and `disableSorting` already have); and no boolean option is "validated" — they
are coerced.

### The work

1. **`disableColumnReorder?: boolean`** on `AVGridOptions` (default `false`), coerced with
   `Boolean()` the way `multiSort` and `externalSort` are — there is no boolean validator to
   follow, and none is needed. In the options table of `docs/api.md`, beside `disableSorting`.
2. **One predicate, three readers.** Today three places gate reordering on `hasGroups`:
   `HeaderCell` (`el.draggable`, line 122), `GridInteractions.onDragStart` (`preventDefault` for a
   drag already primed, line 902) and `GridInteractions.reorderAllowed` (the drop, line 932). Add
   one predicate on the model — `reorderEnabled()` = `!options.disableColumnReorder &&
   !data.hasGroups` — and route **all three** through it, so the three conditions cannot drift and
   a drag that started before the option flipped is refused at the drop as well as at the start.
3. **The option is additive and changes nothing else.** `onColumnsReorder` simply never fires;
   `onColumnsChange` still fires for every other column change; `setColumns` from the host still
   reorders — the option governs the *gesture*, not the column array. Say so in the docs.
4. **React lane 3** — plain option, no callback; verify by the wrapper's existing lane test.
5. **Live toggle — needs no new path** (corrected during implementation, 2026-09-08). The
   review draft claimed `setOptions({ disableColumnReorder })` would repaint nothing and that
   `disableFiltering` / `disableSorting` had the same gap. Wrong on both counts: `setOptions`
   ends in `refresh()` — `update({ all: true })` — so every header repaints on the **next paint
   frame**, and `HeaderCell` reassigns `draggable` on every paint. What misled the draft is that
   the paint is deferred, as every paint in this grid is; a test that reads `draggable`
   synchronously after `setOptions` sees the old value, one that awaits the frame sees the new
   one. The test says so. Nothing was added, and there was no `disableFiltering` defect to fix.

### Verification

- Unit: with the option on, no header carries `draggable="true"`; a synthesized `dragstart` is
  cancelled; a synthesized drop is refused (`reorderAllowed` false); `onColumnsReorder` is not
  called; `getColumns()` order is unchanged after a drop.
- Unit: off (the default) leaves every existing reorder test green, unchanged.
- Unit: sort, filter, resize and `hidden` still work with the option on; `setColumns` from the
  host still reorders.
- Unit: toggling at runtime through `setOptions` flips `draggable` on the visible headers **in the
  same tick**, and the same for `disableFiltering` (the funnel) — the regression net for item 5.
- Board: `AVGridBoard` with the option on — a header drag does nothing, a pinned band still
  resizes; toggle it live through `window.avg` and watch the header.

### Deliverables

- `docs/api.md`: the option in the options table; a line under *Pinned columns* and one under
  *Column groups* (`docs/api.md:796`, "Reorder is off") noting that the option makes that state
  the host's choice as well as the library's.
- `docs/react-api.md`: the prop in the lane-3 list.
- Release **2.10.0** — additive surface, minor. Planned to ship alone ahead of task 59; shipped
  with it (decision log).

## Task 59 — `treeColumn`: the tree gutter and gesture on one column, over a host-derived row list

**The request** (a consumer, 2026-09-08). A pivot screen shows its row dimensions as a tree in the
first column — market, then payer, then measure — collapsible by chevron, with leaves aligned under
folders and the path as the cell's copy value. The consumer is building the row *engine* itself (a
flat visible-row list derived from an `expanded` map, rebuilt on every toggle), and asked whether
the *column* could be a reusable av-grid feature rather than a per-project `render` hook, the way
`selectColumn` is a built-in rather than a hand-rolled checkbox column.

**Reviewed 2026-09-08, and reshaped three times with the author.** The result is a narrower and
cleaner feature than the first draft: av-grid draws the **tree gutter** — indent guides and the
chevron or stub — and the **consumer renders everything else** through the column's ordinary hooks;
the expand/collapse **gesture exists only when the host asks for it**; and the keyboard arrows fall
through to the grid's own navigation instead of going dead. Each change is recorded in the decision
log the moment it is implemented.

**Scope.** [`goal.md`](goal.md#scope) lists *tree/hierarchical data* as a non-goal. This task is
the ask that rule requires, and the non-goal is amended with it: the **row engine** stays out
(open question 5); the **gutter on one column** is in, because it is per-row rendering driven by
three values read off the row, which is exactly what the cell renderer already does.

**The reference exists.** Persephone's `uikit/Tree/` is built on the same `RenderGrid` this
library ports: `TreeItemView` draws N indent guides, a 14px chevron button — or an equally wide
stub so leaves align with folders — then an icon, the label and a trailing slot (`TreeItemView.ts`,
`tree-indents.ts`, `tree-indents.css`, `TreeItem.css`). `TreeModel.deriveRows` is the engine half.
Read the first, port its *shape*, not its numbers: its "16 + 17 × (N − 1)" gutter width comes from
a missing `box-sizing` rule and its guides render at **zero height** there because nothing gives
the row a definite height. Here the engine's cell *has* a definite height, so the guides will
actually draw — take the 16px indent, the chevron width and the stub-for-alignment idea, and
nothing else. `TreeIndents.sync` (grow and shrink the guide array in place, never rebuild) is the
right pattern for the pooled cell.

**The boundary — and why it is the whole design.** A tree is two halves:

1. **The gutter and the gesture** — indents, chevron or stub, the chevron press, `←` / `→` on the
   focused row, the path as the copy value. Pure per-row rendering driven by three values read off
   the row. Every consumer of a tree wants exactly this, and it is what `selectColumn` is to a
   checkbox column. **This is task 59.**
2. **The row engine** — which rows are visible, the expanded map, rebuilding the flat list, and
   what *sorting* and *filtering* mean inside a tree (sort within siblings only; a filter that keeps
   a matched leaf's ancestors). That is the *"the host owns the row set"* line behind
   `externalFilter` / `externalSort`, and deciding tree-aware sort and filter semantics for every
   consumer is a phase, not a task. **Out of task 59**, recorded as open question 5 below; the
   consumer builds its engine host-side, and a second consumer wanting one is the signal to lift it.

### The API

```ts
interface AVGridOptions<R> {
    /** Give one column a tree gutter. The host's rows are already flat and in display order. */
    treeColumn?: TreeColumnOptions<R>;
    /**
     * A chevron was pressed, or → / ← on a focused tree cell. The host rebuilds its rows.
     * Optional on purpose: leave it out and the tree is a static, indented view — the chevrons
     * still show open / closed, they just do nothing, and → / ← are plain column navigation.
     */
    onTreeToggle?: (row: R, expanded: boolean) => void;
}

interface TreeColumnOptions<R> {
    key: string;                        // which column gets the gutter
    depth: (row: R) => number;          // 0 for a root row
    hasChildren: (row: R) => boolean;   // chevron (true) or an equally wide stub (false)
    expanded: (row: R) => boolean;      // which way the chevron points
    indentSize?: number;                // px per level; default 16
    chevrons?: boolean | ((row: R) => boolean); // default true; false removes the chevron slot —
                                        // for the grid, or per row: (r) => depth(r) > 0
    path?: (row: R) => string;          // the copy value; default: the cell's displayed text
}
```

```js
// The usage snippet — a static tree, then the same tree made collapsible.
create({
    rows: flatRowsInDisplayOrder,
    columns: [{ key: "dimension", pinned: "left", render: (c) => c.highlight(c.row.label) }, …],
    treeColumn: { key: "dimension", depth: (r) => r.depth, hasChildren: (r) => r.children > 0, expanded: (r) => expanded[r.id] },
});
// …collapsible: add one function. The host's engine does the rest.
grid.setOptions({ onTreeToggle: (row, open) => { expanded[row.id] = open; grid.setRows(flatten()); } });
```

Five things the shape encodes, each a review decision:

- **Two zones in the cell.** av-grid owns the **gutter** (indents and chevron / stub, driven by
  `depth`, `hasChildren`, `expanded`); the **content** is the column's ordinary rendering — the
  default text with search highlighting, `formatValue`, or `render` returning a string **or an
  Element** — in its own host element after the gutter. A tree column renders its content exactly
  like any other column; the consumer puts the icon, the label and any action buttons there through
  `render`, with `c.highlight()` for the search words. There is deliberately **no `label`**: a
  second label function would not be seen by the search box or the text filter (which read
  `formatValue`), so a match would mark text the user cannot see.
- **The gesture follows the callback.** No `onTreeToggle`, no expand / collapse: the chevron is
  drawn inert (no pointer cursor, no `data-clickable`), and the arrows do what they do on every
  other cell. The precedent is `disableSorting`: state shown, affordance off. Per-row control comes
  from the data — `hasChildren` `false` is a stub, not a chevron.
- **`chevrons` removes the slot, for the grid or per row.** `false` is the pure indented look:
  guides only, labels move left by the slot's width. A **function** decides per row — the case
  that asked for it (2026-09-08): a host whose first level is always expanded wants **no chevron
  and no slot on depth-0 rows**, so section-like roots start flush at the cell's edge while their
  children keep one guide and a chevron: `chevrons: (r) => depth(r) > 0`. A row without a slot has
  **no gesture** either — no press, and `←` / `→` are plain navigation on it — because the host
  has said its state is not the user's to change. Persephone's `hideChevron` and its
  `SectionItem` row, folded into one field.
- **The chevron is a `<span>`, never a `<button>`.** `GridInteractions.focusRoot` deliberately
  leaves focus alone on a press that lands on a button, so a `<button>` chevron would move
  keyboard focus off the grid root and the arrows would die — the reason the select column is a
  span too. `aria-expanded` goes on the **gridcell** (allowed on that role); `treeitem` would
  conflict with the grid roles.
- **`←` / `→` fall through, never go dead.** `FocusModel` treats both as column navigation on
  every cell. On the focused tree cell *with* `onTreeToggle`: `→` expands a collapsed folder,
  otherwise moves right as today; `←` collapses an expanded folder, otherwise moves left as today.
  Persephone's `←`-to-parent exists because its tree has no columns; here the columns win.

### The work

1. **The option**, validated at `create()` and on `setOptions`: `key` names a column in
   `options.columns` (the full set — a hidden tree column is legal and does nothing); it may be
   `pinned: "left"` (the natural placement) and may not be the select column or any
   `isStatusColumn` chrome; `depth`, `hasChildren`, `expanded` are functions; `onTreeToggle`, when
   given, is a function. Error text in the library's voice, with the snippet above.
2. **Rendering** — the tree column's cell is `[data-part="tree-indent"]` × depth, then (unless
   `chevrons` is `false`, or a function returning `false` for this row) `[data-part="tree-chevron"]` holding `.avg-tree-chevron` (a span with the
   chevron glyph, `data-expanded`) or `.avg-tree-stub`, then `.avg-tree-content` holding what the
   column would have rendered on its own. Class hooks and `--avg-tree-*` tokens (indent size, guide
   colour, chevron colour) in the stylesheet. **Gutter and content are diffed separately**: the
   gutter on its three values, grown and shrunk in place (`TreeIndents.sync`'s pattern — a cell
   recycled from depth 8 to depth 2 must lose six guides, not hide them); the content host by the
   same rules `renderDataCell` applies to any cell today — the `written` map skips an unchanged
   `render` string, an Element is replaced. So the second invariant's repaint skip holds on the
   part av-grid controls, and the consumer pays for their content what every `render` column pays
   now. `CellContext` is built for the tree column only when the column has a hook that needs one,
   as today.
3. **Gesture** — the chevron press is resolved on **`pointerdown`**, never `click` (the third
   invariant: a real press repaints the cell in between; the precedent is the boolean checkbox
   toggle in `GridInteractions.onCellPointerDown`, which does exactly this). A press on the chevron
   calls `onTreeToggle(row, !expanded(row))`, moves no focus and starts no range drag, and is
   excluded from `onCellClick` / `cell.onClick`. A press anywhere in the **content** zone is an
   ordinary cell press: focus moves, a drag may start, and the click reaches `onCellClick` with the
   event, so the consumer resolves their own action buttons from `e.target` as any `render` column
   does today. Keyboard as above, in `FocusModel`'s arrow cases, only for the tree column, only
   with `onTreeToggle` set. **After calling `onTreeToggle` the grid requests a repaint itself.**
   Usually the host's `setRows(flatten())` repaints anyway, but not always: collapsing a folder
   whose children are all filtered out changes no row, and the chevron would stay pointing the
   wrong way until something else painted. One `requestRepaint()` is cheaper than documenting the
   edge.
3b. **Editing** — a tree column may be editable like any column. The editor mounts over the
   **content zone only**, so the gutter stays visible while a value is typed and the cell keeps
   its shape; `Column.editor` and the default input both get the content host as their anchor.
   A pivot's tree column is usually `readonly`, so this is the general rule, not the expected
   case — one test that the editor's box excludes the gutter is enough.
4. **Copy** — precedence in `CopyPasteModel`: the column's own `copyValue` (the host's word, as
   everywhere), then `treeColumn.path(row)`, then the cell's displayed text. A pasted tree cell
   reads `PENN › AETNA`, never indentation whitespace.
5. **Sorting and filtering** — nothing tree-aware, by design. Document: a host showing a tree
   passes `disableSorting` or sorts within siblings itself; a local filter that drops a parent but
   keeps a child leaves the child orphaned, so tree hosts pair with `externalFilter` and filter in
   their engine. The docs name both, with the minimal engine example.
6. **React**: `treeColumn` is lane 3 (`Object.is` on the object — a new identity repaints, which is
   what a toggle needs anyway, since `expanded` closes over the map); `onTreeToggle` is a
   **top-level** callback so lane 2 proxies it — the reason it is not inside the object. Test both
   lanes; test that a host re-creating the object with the *same* functions still causes exactly
   one `setOptions` and no re-create.

### Verification

- Unit: depth 0 leaf, depth 2 folder expanded / collapsed, `chevrons: false`, and `chevrons: (r) =>
  depth(r) > 0` (a depth-0 row has no slot and its content starts at the cell edge; its depth-1
  child has one guide and a chevron), render the documented markup; a slotless row ignores a
  chevron press and `←` / `→` navigate on it even with `onTreeToggle` set; a cell recycled from depth 8 to depth 2 holds exactly two guides; the gutter of an
  unchanged row does zero DOM writes across two paints; a `render` returning an Element lands in
  `.avg-tree-content` and the gutter beside it is untouched.
- Unit: with `onTreeToggle`, a chevron `pointerdown` calls it with the negated state, fires no
  `onCellClick`, moves no focus; a press in the content zone moves focus and reaches `onCellClick`
  with the event.
- Unit: keyboard — `→` on a collapsed folder toggles; `→` on an expanded folder or a leaf moves
  right; `←` on an expanded folder toggles; `←` on a leaf moves left. Without `onTreeToggle`, all
  four move.
- Unit: no `onTreeToggle` — the chevron press does nothing and the chevron carries no clickable
  marker; `aria-expanded` still reports the state.
- Unit: `getSelectionText()` over a tree cell yields `path`; with a column `copyValue`, that wins.
- Unit: `onTreeToggle` on a folder whose children are filtered out repaints the chevron with no
  `setRows`; an editor opened on a tree cell is positioned over the content zone, not the gutter.
- Unit: validation — unknown `key`, `key` equal to the select column, a non-function `depth`.
- React: the two lanes as in work item 6.
- Board: `AVGridBoard` with a three-level tree over a host-side engine (a 30-line `expanded` map
  and a flatten), 10,000 rows, pinned-left tree column beside grouped columns, `render` with an icon
  and an action button in the content, the first level always expanded and slotless
  (`chevrons: (r) => r.depth > 0`); scroll and toggle while watching the paint timings, then
  flip `chevrons` to `false` and remove `onTreeToggle` live. **Benchmark row**: the cell renderer changes, so
  `tasks/benchmark-results.md` gets one — the gate is the tree column costing nothing on a grid
  that does not use it, and a flat-cost ratio on one that does.

### Deliverables

- `docs/api.md`: a *Tree column* section — the two options, the two zones and the markup / class
  hooks / tokens, the gesture-follows-the-callback rule, `chevrons` (grid-wide and per row, with the always-expanded-roots example), the copy precedence, the
  keyboard fall-through, the "host owns the rows" statement with the minimal engine example, the
  sort and filter caveats, the action-buttons-are-yours note. The DOM contract gains the three
  `data-part` values and the classes.
- `docs/react-api.md`: `treeColumn` in the lane-3 list, `onTreeToggle` in the lane-2 list, and why
  the callback is not inside the object.
- `docs/capabilities.md`: the row. `goal.md`: the amended non-goal (done with this plan).
- Release: shipped with task 58 as **2.10.0** (decision log).

## Task tracker

| # | Task | Status |
|---|------|--------|
| 1–57 | Phases 1–16 | see `plan-done-01.md` … `plan-done-12.md` — ✅ Done |
| 58 | `disableColumnReorder` — header drag-reorder off by host choice, sort / filter / resize / `hidden` untouched | ✅ Done — 2.10.0 |
| 59 | `treeColumn` — the tree gutter (indent guides, chevron / stub) on one column, the consumer rendering the content; gesture only with `onTreeToggle`; `←` / `→` fall through; path as copy value; over a host-derived flat row list | ✅ Done — 2.10.0 |

## Decision log

| Decision | Why | Cost / notes |
|---|---|---|
| **58: one predicate, `AVGridModel.reorderEnabled()`, for the three readers** — `HeaderCell` (`draggable`), `onDragStart` (a primed drag), `reorderAllowed` (the drop) | Three places gated on `hasGroups`; a fourth condition in three places would drift. Pinning stays a per-column condition at the callers | A drag primed before the option flipped is refused at the drop — tested |
| **58: no boolean coercion, no validator** | No boolean option is validated in this library; `HeaderCell` reads the option by truthiness, the same as `disableFiltering`. The plan's "coerce like `multiSort`" applied to options read as booleans by arity logic, which this is not | — |
| **58: the review's "no repaint path" claim was wrong and is corrected in the task text** | `setOptions` ends in `refresh()`; the paint is deferred to the frame. Recorded rather than silently fixed so the next reader of the draft does not chase the same ghost | The live-toggle test awaits the paint and asserts `disableFiltering` flips on the same path |
| **58: per-column `reorderable: false` declined for now** | The grid-level switch is what was asked and matches `disableSorting`; a per-column flag mirroring `resizable` is additive later if a consumer asks | — |
| **59: two zones in the cell — the gutter is av-grid's, the content is the column's ordinary rendering in `.avg-tree-content`** (author's direction, 2026-09-08) | The consumer wants its own icon, label and action buttons; a second `label` function would not be seen by the search or the text filter. The content host is a separate element, so `render` returning an Element is fine — it costs what any `render` column costs | `renderDataCell` writes into `target` (the host, or the cell); `setMode` / `written` are keyed by the element written, so the existing skip logic applies unchanged one level down. `EditingModel.ownsCell` checks the grandparent too |
| **59: the gesture exists only with `onTreeToggle`** (author's direction) — and under React that makes it **presence-sensitive**, lane 3, not a proxied callback | A proxy standing in for an absent callback would turn the gesture on. `onGetOptions` / `onGridContextMenu` are the precedent | Documented: give it a stable identity. `treeColumn` is a lane-3 object whose `expanded` closes over host state, so a new object per toggle is expected and is the repaint a toggle needs |
| **59: `chevrons: boolean \| (row) => boolean`** removes the slot for the grid or per row; a slotless row has no gesture (author's direction: an always-expanded first level) | One field covers Persephone's `hideChevron` and its `SectionItem` row; a function matches the other three per-row readers | `(r) => depth(r) > 0` is the documented example |
| **59: the chevron is a `<span>`, resolved on `pointerdown`; a press on a stub, an inert chevron or the content is an ordinary cell press** | `focusRoot` leaves focus alone on a `<button>`, so a button chevron would take the keyboard off the grid; the boolean box is the pointerdown precedent. Making an inert chevron swallow the press would leave a dead spot in a static tree | The click and double-click that follow a toggling press are not cell events; `e.button === 0` required |
| **59: `→` / `←` fall through** — toggle only on the focused tree cell, with the gesture on, in the direction that changes state | `FocusModel` treats both as column navigation on every cell; Persephone's `←`-to-parent exists because its tree has no columns | One branch in `onContentKeyDown`, guarded by `options.treeColumn` so a grid without a tree pays a property read |
| **59: `toggle()` marks that row dirty (`update({ rows: [gridRow] })`), not `requestRepaint()`** | `requestRepaint` alone re-paints nothing when no cell is dirty — found by the "host changes no row" test. The row index is known at both call sites (the pressed cell, the focused row), so no search | The host's `setRows` marks the rest |
| **59: guides are drawn centred in every indent, not as a left border on every guide after the first** | The reference's border sat at a height that resolved to zero and was never seen; centred under the parent's chevron is the classic look and needs no `data-first` rule (the marker stays for hosts). The "16 + 17 × (N − 1)" width was a `box-sizing` accident and is not ported | `--avg-tree-indent`, `--avg-tree-guide`, `--avg-tree-chevron` tokens |
| **59: copy precedence — `copyValue`, then `path`, then the displayed text** | `copyValue` is the host's word everywhere; `path` is the tree's default for the tree cell only | `CopyPasteModel.cellText`, one lookup |
| **59: validated at `create()` and whenever `setOptions` carries `treeColumn` or `onTreeToggle`; a `setColumns` that drops the tree key is lenient** | A bad option must leave the grid as it was (checked before anything is applied); a column set without the tree key simply draws no gutter, the same leniency `hidden` gets | `validateTreeColumn` in `src/validate.ts` |
| **59: `goal.md`'s non-goal amended** to *a tree row engine*; the gutter on one column is in | The plan and the goal must not contradict each other; the engine stays out (open question 5) | — |
| **One release after all — 2.10.0 carries both tasks** (author's call, 2026-09-08, over the plan's two-release split) | The split assumed 58 would land days ahead of 59; both were implemented, tested and board-verified in one session, and they share `options.ts`, the docs tables and the board — splitting the commit would have been busywork | Additive surface, minor per `docs/releasing.md`; verified in the browser before the tag (screenshots, `measureTree` 14/14, the 100k gate unmoved) |

## Open questions

The five open questions this plan carried (the popovers' control-size tokens; a grid-level
`textFilterOps` default; `textFilterLabels`; a runtime setter that degrades instead of throwing; a
tree row engine in the library) move forward unchanged to [`plan.md`](plan.md). None is committed.
