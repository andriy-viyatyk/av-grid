# av-grid — Implementation Plan 20: phase 24

**Phases 1–23 have shipped, through 2.12.1 (2026-09-24).** This plan holds the standing rules and
the open questions, and is where the next task is written. **Before starting anything, read the
decision logs in `plan-done-01.md` … `plan-done-19.md`** — every one of them still applies.

## Ground rules (standing, carried forward)

- Everything is additive; ships as a **minor** version per [`docs/releasing.md`](../docs/releasing.md)
  — unless a phase holds only a defect fix with no new surface, which ships as a **patch**.
- The core stays dependency-free; every new option reaches the React wrapper through lane 3 (or
  lane 2 for a callback) — verify by test.
- Design the API before implementing it; measure, don't assume (benchmark row per render-path
  change); verify in a browser, not only in tests.
- No consumer names in this repo.
- **Ask before adding a feature** that is not in this plan or in [`goal.md`](goal.md#scope).

## Task tracker

| # | Task | Status |
|---|------|--------|
| 1–65 | Phases 1–23 | see `plan-done-01.md` … `plan-done-19.md` — ✅ Done |
| 66 | The dropdown editor fits its options: no scrollbar on a short list, no search box up to ten options | ✅ Done |
| 67 | `Column.hideZero` — a numeric column shows its zeros as empty cells | ✅ Done |
| 68 | The options editor redesigned: text typed in the cell over a filtered list, strict by default, `Column.freeText` for suggest mode | ✅ Done |
| 69 | A popover placed beside its anchor (a submenu) is capped to the viewport height and scrolls, instead of hanging off the bottom | ✅ Done |
| 70 | The dropdown editor's first and last rows clear the popover's rounded corners: the active row's outline is no longer cut off | ✅ Done |

## Decision log

| Decision | Why | Cost / notes |
|---|---|---|
| 66.1 — `VirtualList` passes `whiteSpaceY: 0` to its engine | The dropdown editor sizes its popover to its rows, and the engine's default 20px of trailing slack made the list 20px taller than that box: three options measured 92px of content in a 72px body, and showed a scrollbar. A list has no last column to resize and no row to scroll clear of an edge, so the slack buys it nothing. Applies to every `VirtualList`, the checklist filter included | Measured by test: inner height = rows × rowHeight |
| 66.2 — the dropdown's search box shows only past ten options (`SEARCH_THRESHOLD`), decided when the options resolve | Up to ten options are read at a glance; a search box over three is noise. The count is only known in `fill`, since `options` may be a function or a promise, so the box is built always and shown or hidden there through a new `VirtualList.setSearchVisible` | A promise's options start at zero, so the box appears when they arrive; focus inside the list is carried across the change |
| 66.3 — a type-to-edit keeps the search box at any count | The typed character *is* the search text; hiding the box would drop the keystroke that opened the editor | — |
| 66.4 — hiding the box clears its text | A search the user can no longer see must not keep narrowing the rows | — |
| 67.1 — `hideZero` is a column option, default false, with no grid-level default | Asked for per column by a consumer: a column of offsets that is mostly zeros reads faster blank. Off by default because `0` and empty then look alike, which a library must not decide for every grid; a grid-wide switch was judged unneeded | — |
| 67.2 — display only, and only the default text path | Copy, sorting, the checklist's options, the search and the editor still see `0` — the value has not changed, and a hidden zero copied as blank would lose data. A column with `render`, `formatValue` or `displayFormat` writes its own text and is untouched. Footer cells share `displayText`, so a zero total is blank too | A search for "0" still matches the row, with nothing to mark |
| 68.1 — **approved by the author** (2026-10-14): one options editor, two modes. The text is typed *in the cell* (`input.avg-cell-select-input`, `CellInput`'s caret rules and `caretIndexAt`) and drives the list's filter; the popup is the `VirtualList` with no search box. **Supersedes 66.2–66.4** — there is no search box in this popup to show, hide or seed, so `SEARCH_THRESHOLD` is gone; `VirtualList.setSearchVisible` stays public for other callers | A search box in a popup under a cell is a second place to type for one value: the first keystroke went to the cell's editor and the rest to the list, and a short list hid the box altogether. Typing where the value is matches the text editor and every spreadsheet | 66.1 (`whiteSpaceY: 0`) still applies |
| 68.2 — strict is the default and the only rule without `freeText`: after each keystroke the best match is highlighted (exact case-sensitive, then case-insensitive, then list order); Enter/Tab commit it; with nothing highlighted empty text clears, unmatched text is never sent through `setValue` (Enter is a no-op with `aria-invalid`, Tab cancels and moves); blur commits only unchanged text or an exact option name (case-insensitive, trimmed) and never auto-picks a prefix | A strict column must not be able to hold text outside its options, and a blur is not a decision — picking a prefix on the way out would write a value the user never chose | Committing the cell's own value is a cancel, so a strict cell holding a value outside its options does not fire `onInvalidEdit` for nothing |
| 68.3 — `Column.freeText` (default false; meaningful only with `options`, silently ignored without, like `hideZero` on a non-number column) turns the options into suggestions: nothing highlighted while typing, so Enter/Tab/blur commit the highlighted suggestion if the user arrowed to one, else the option the text names (case-insensitive, trimmed, keeping its type), else the text exactly as typed. The current value is not prepended; with no match the popup hides | A combobox that pre-picks a suggestion turns Enter into "replace what I typed", which is the one thing a free-text column must not do | No dev warning without `options`: the library has no warning for the analogous `hideZero` case |
| 68.4 — `defaultValidate` rejects against an options **array** only when `!col.freeText`; a host `validate` still runs and can reject. Function/async options never reject a paste (unchanged, now documented) | A paste into a free-text column must be accepted, or `freeText` is only half true | — |
| 68.5 — the focus never leaves the input: the popover root cancels `mousedown` (not `pointerdown`, which would also suppress the compatibility mouse events), and `Popover` gains three **internal** options — `closeOnEscape: false`, `closeOnOutside: false`, `onOutside` — so Escape reaches the input and an outside press is reported in the document's capture phase. The `show().then(cancel)` coupling is gone | A row click must not blur-commit first, and an outside press on another grid cell must be decided *before* the grid's own pointerdown moves the focus (which would commit the edit's raw value through `onFocusMoved`). Verified in the board with trusted input, including a click on the list's scrollbar track | Internal like `container`: documented in JSDoc, not in `docs/api.md` |
| 68.6 — Escape is handled by the input and `preventDefault`ed, so inside a modal `<dialog>` it cancels the edit and the dialog stays open; Enter is ignored while `isComposing` | The dialog's close request is Escape's default action | Tested in happy-dom against a `<dialog open>`; the top-layer behaviour itself is not reproducible there |
| 68.7 — `VirtualList` gains `moveActive(n \| "first" \| "last" \| "pageUp" \| "pageDown")` (the list's own key map now runs through it), and `optionId(index)` and the `listId` getter (public, approved by the author), so the input can point `aria-activedescendant` and `aria-controls` at real ids. A single-pick list is an ARIA listbox (`role="listbox"` on the body, `role="option"` + `id` + `aria-selected` written on every paint, because rows are pooled); the checklist used by filters is unchanged | The editor's keys arrive at the input, not the list; the ids are the listbox contract | Benchmark row 2026-10-14: within frame noise |
| 68.8 — strict-mode users get the new editor too (no legacy flag), shipped as a **minor** (2.13.0). DOM contract change: `.avg-cell-select-value` is replaced by `input.avg-cell-select-input`, and the popup has no `.avg-list-search` | One editor is less to explain than two; a host that styled the old span has one selector to change | Release note drafted in the task report |
| 68.9 — filters untouched: the options checklist offers the rows' values and never reads `column.options` (array or function); proven by test for both `freeText` values | The editor's choices and the filter's choices are different questions | — |
| 69.1 — a `left`/`right` placement caps `maxHeight` at the viewport height less both margins (never under `MIN_AVAILABLE_HEIGHT`), then the existing clamp slides it inside | Only `top`/`bottom` placements were capped, so a submenu (`right-start`) of 60 items was clamped to the top margin and ran off the bottom with no scroll: the menu list scrolls only inside a capped root. Beside its anchor a popover may move vertically, so the whole viewport height is its room, not the room below the anchor | A defect fix with no new surface: a **patch**. Two placement tests (capped and clamped; a fitting one stays beside its anchor) |
| 69.2 — the popover's scroll listener ignores a scroll whose target is inside the popover (`onScroll`) | Once capped, the submenu's list scrolled — and every scroll event reached the capture-phase `reposition`, which clears `maxHeight` to measure: the overflow collapsed, the browser reset `scrollTop` to 0, and the list snapped back to its top on each wheel step or thumb drag. A popover's own content scrolling cannot move its anchor; a scroll in the parent menu (the submenu's anchor) is outside it and still repositions | Unit test confirmed failing without the guard |
| 70.1 — `.avg-cell-select-list` is padded `6px 2px` (was `0 2px`), the menu list's 6px, and `PADDING_HEIGHT` is 12 to match | The list sat flush against the popover's top edge, so its 11px corners cut the ends off the first row's active outline (and the last row's at the bottom of a scrolled-to-end list). The 8px `PADDING_HEIGHT` budgeted since task 66 was never laid out as padding — it was empty space under the last row. 6px clears an 11px corner by about 1px at the row's 2px inset; 4px would leave the outline touching it | A defect fix with no new surface: a **patch**. The height test now expects 12 + 3 × 24 |

## Open questions carried forward

1. **`--avg-control-h` and `--avg-radius` as tokens?** Raised by a consumer on 2026-09-03 and not
   committed — recorded so it is not lost. The filter popovers' input, search box, chips and
   buttons all carry class hooks (`.avg-text-filter-input`, `.avg-list-search`,
   `.avg-text-filter-op`, `.avg-button`), so a host can already restyle them; what it cannot do
   is restyle them *through tokens*, because the control padding and the 4px radius are literals
   in the stylesheet. A host whose own controls are 32px tall with an 8px radius therefore
   overrides rules rather than values — an override that breaks quietly the next time the library
   restyles its own controls. Two tokens would turn that block into two assignments. Against it:
   the stylesheet's structural values are deliberately not all tokenized, and every token is
   public surface forever.
2. **Should `textFilterOps` have a grid-level default?** Deliberately not in task 54 — a host that
   wants the chips everywhere sets the field while building columns. Worth revisiting only if a
   consumer asks with a case where that is not possible.
3. **`textFilterLabels` — the host's words on the popover's operator chips.** `filterLabel`
   (task 55) covers the bar chip only. A localized popover would need a map of op → label; not
   asked for yet.
4. **Should a runtime setter be able to *degrade* instead of throw?** Raised by a consumer on
   2026-09-07 with the task 57 report: the host had saved the hidden column in *its own* browser
   storage, so the throw came back on every reload and a regular user had no way out short of
   clearing site data in dev tools. `plan-done-01.md` decision 15 draws the line today: host input
   throws (a typo in `setFilters` is a bug the author can fix), *stored* input — `persistFilters` —
   is validated one filter at a time and dropped with a warning. That leniency is **not in play
   here**: the host keeps the grid state in its own storage and never uses `persistFilters`, so
   the state arrives as ordinary setter input and nothing on the library's restore path is
   involved. The only lever the library has is what a setter does with input it cannot use.
   Task 57 removes this particular cause; the question is whether the class of failure should
   stay reachable. If
   it is taken up, the shape most in keeping with the library: `create()` stays strict; the
   runtime setters and `setOptions` gain an opt-in, e.g. `onError: (error: AVGridError) => void`
   — when set, a setter that would throw calls it, drops the offending entries (a filter or a sort
   level naming an unknown column) the way the stored-filter restore does, warns, and keeps the
   grid standing; when unset, nothing changes. The React wrapper would surface it as a prop on
   lane 2. Not committed — ask before adding.
5. **A tree *row engine* in the library?** Raised with task 59 (2026-09-08) and deliberately left
   out of it. Task 59 draws the tree; the host derives the visible rows from its own `expanded`
   state, which keeps *"the host owns the row set"* intact. Lifting the engine — hierarchical input
   (`children` or a parent key), an owned `expanded` map, `expandAll` / `collapseAll`, sort within
   siblings, ancestor-retaining filters — would be a phase of its own and would have to decide
   tree-aware sort and filter semantics for every consumer. Persephone's `TreeModel` is the
   reference if it is taken up. The signal to take it up: a second consumer writing the same
   thirty lines. Not committed — ask before adding.
6. **A `title` hook on data cells?** Raised with task 61 (2026-09-11). Nothing in the public surface
   sets a native tooltip on a data cell — `cellClass` / `onCellClass` give classes, `render` gives
   contents — so a host that wants one has no way to ask. If added, it lands on the same line as
   task 61's `removeAttribute("title")` and the fix becomes *set or remove*, exactly as the header
   does it. Not asked for — ask before adding.
