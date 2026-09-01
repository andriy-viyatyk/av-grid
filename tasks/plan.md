# av-grid — Implementation Plan 09: pinned-left data columns (task 53)

**Phase 13.** Phases 1–12 are done and shipped through **2.7.1**. One task is committed —
**task 53**, asked by a consumer on 2026-09-01: a `pinned: "left"` column that is still a
data column. **Before starting any task here, read the decision logs in `plan-done-01.md` …
`plan-done-08.md`** — every one of them still applies.

## Ground rules (standing, carried forward)

- Everything is additive; ships as a **minor** version per [`docs/releasing.md`](../docs/releasing.md).
- The core stays dependency-free; every new option reaches the React wrapper through lane 3 —
  verify by test.
- Design the API before implementing it; measure, don't assume (benchmark row per render-path
  change); verify in a browser, not only in tests.
- No consumer names in this repo.
- **Ask before adding a feature** that is not in this plan or in [`goal.md`](goal.md#scope).

## Task tracker

| # | Task | Status |
|---|------|--------|
| 1–52 | Phases 1–12 | see `plan-done-01.md` … `plan-done-08.md` — ✅ Done |
| 53 | `pinned: "left"` as a data column — split sticky from chrome | ✅ Done |

## Task 53 — `pinned: "left"` as a data column

**The ask** (a consumer, 2026-09-01): an identity column that stays visible while the rest
scrolls sideways, cannot be dragged out of first place, and is otherwise a normal data column —
resizable, focusable, part of range selection, copied, editable, filterable. Today `pinned:
"left"` ≡ `isStatusColumn`, so choosing stickiness costs all of that.

**Design: split "sticky" from "chrome".** One predicate, `isPinnedLeft()` (gridUtils), today
answers two questions. It keeps answering only the *geometry* one — "is this column in the left
sticky band?" A new `isChromeColumn()` = `column.isStatusColumn === true` answers the *behavior*
one — "is this column chrome, not data?" After the split:

- `isStatusColumn: true` — unchanged, means both: sticky **and** chrome (the checkbox column).
- `pinned: "left"` alone — sticky, **not reorderable** (that stays geometry: `draggable =
  !isPinnedLeft`, and the band hit-test already refuses drops across the band boundary), and
  otherwise a normal data column.

**This deliberately supersedes the phase-10 decision** "both spellings must stay exactly
equivalent forever" (plan-done-06 decision log). Every behavior change is a gained capability
on `pinned: "left"` columns; anyone who wants chrome semantics has `isStatusColumn` spelled for
it. Ships as **2.8.0 minor** with the split called out in the docs.

**The flips** (isPinnedLeft → isChromeColumn), each one line:
resizable + filter funnel (HeaderCell), pointerdown focus/range + Alt+↓ (GridInteractions),
copy (CopyPasteModel.copyColumns), editability (EditingModel.canEdit, AVGrid.cellContext,
ColumnsModel.firstEditable, FocusModel.focusNewRows fallback), delete-selected-columns filter
(StructureModel), the computed-column validation exemption (validate.ts), context-menu
add/delete gating (ContextMenu).

**Stays geometry** (isPinnedLeft): `lastIsStatusIndex` (the engine's stickyLeft count),
`data-pinned` attribute, `draggable`, cellContext's `pinned` echo, the reorder band hit-test.

**The two real pieces:**

1. **The keyboard focus clamp.** FocusModel's `firstColumn = lastIsStatusIndex + 1` (landing,
   ArrowLeft, Ctrl+Home, Shift+Tab wrap — the phase-10 task-49 fix) must become "first visible
   non-chrome column": a new `firstDataColumnIndex` computed in `ColumnsModel.updateColumnsData`
   next to `lastIsStatusIndex`, held on `AVGridData` with the same change-event pattern.
2. **Leading-run validation.** Right-pinned columns must be trailing; nothing enforces that
   left-pinned columns are *leading* — an interleaved one silently drags its unpinned
   predecessors into the sticky band. Add the mirror rule in `validateColumns`.

**Resize needs no new machinery**: the grip CSS keys off `data-resizable` alone (right-edge by
default; only `data-pinned="right"` flips it), and any width change already flows
`onColumnResize → updateColumns → data change → engine relayout`, which recomputes sticky
offsets — the right band proves it. Verify on the board, don't re-implement.

**Deliverables:**
- The split + flips + clamp + validation rule, with the gridUtils docblock rewritten (it
  currently teaches the two-spellings-one-fact story).
- Tests: a pinned-left data column is resizable/focusable/copied/editable/filterable; the
  checkbox keeps every chrome behavior; the keyboard clamp lands past chrome but **on** a
  pinned data column; leading-run validation raises with a named column; reorder still refuses
  crossing the band both ways.
- Board verification with screenshots: resize a left-pinned data column and watch the band
  offsets follow; focus/range/copy from it.
- Benchmark row (HeaderCell predicates are render-path).
- Docs: `docs/api.md` pinned section rewritten around the split, `docs/capabilities.md`,
  `CLAUDE.md`. React wrapper: columns ride lane 3 already — no wrapper change, note it.

## Decision log

| Decision | Why | Consequence |
|---|---|---|
| **The phase-10 "both spellings exactly equivalent forever" rule is superseded** (task 53, consumer ask, 2026-09-01) | The equivalence made stickiness cost every data affordance; the asking case — an identity column sticky at the left, resizable, copied, focusable — was inexpressible, and the screen shipped without stickiness rather than accept the losses | `pinned: "left"` alone is now sticky **data**; `isStatusColumn` alone still means chrome-and-sticky. Every change is a gained capability on `pinned: "left"`, so it ships as **2.8.0 minor**, but it *is* a behavior change: a 2.7.x `pinned: "left"` column becomes focusable, copyable, resizable, filterable. Docs and the api.md pinned section call it out |
| **Split as two predicates, not a new option** (task 53) | The four unrelated behaviors all keyed off one `isPinnedLeft()`; a `resizablePinned`-style flag would have multiplied options while leaving the fused predicate in place | `isPinnedLeft()` stays geometry-only (sticky band, `data-pinned`, `draggable`, band hit-test, `lastIsStatusIndex`); new internal `isChromeColumn()` (= `isStatusColumn === true`) carries behavior. Neither is exported — the public API is the two column fields |
| **The keyboard clamp keys off a new `firstDataColumnIndex`, not `lastIsStatusIndex + 1`** (task 53) | The phase-10 task-49 fix aimed the keyboard past the *sticky band*; with a pinned data column in the band, focus must land ON it | Computed in `ColumnsModel.updateColumnsData` beside `lastIsStatusIndex`, held as a plain field on `AVGridData` (nothing observes it alone — it only moves with `columns`). Landing, ArrowLeft, Ctrl+Home, Shift+Tab wrap all read it; pinned by a test that puts a checkbox *and* a pinned data column in the band |
| **Left-pinned columns must be the leading run** (task 53) | The mirror of the right-trailing rule was never enforced; an interleaved pinned-left column silently dragged every column before it into the sticky band (`lastIsStatusIndex` is "up to the last pinned-left index") | `validateColumns` raises naming both keys; hidden columns are skipped, consistent with the right rule and with runs being computed over visible columns |
| **A pinned-left data column is subject to the unknown-key check** (task 53) | The old exemption existed because chrome never reads the row property; a pinned *data* column does — a key no row has is the same rendering bug it is anywhere else | The exemption now keys off `isChromeColumn`; a test pins both directions. `render`/`formatValue` still exempt any column |
| **Resize needed no new machinery — verified, not assumed** (task 53) | The plan feared the sticky offsets; but the grip CSS keys off `data-resizable` alone and any width change flows through `onColumnResize → updateColumns → relayout`, which recomputes band offsets (the right band proved it since phase 10) | Verified live on AVGridBoard: grip drag 160 → 220 px, first scrolling header at exactly the band's new right edge (252 = 252). Benchmark row appended: gate 1.7 ms / 0.84× / 60 fps / 0 misses; `checkAll` 29/29 |
| **No React wrapper change** (task 53) | `pinned`/`isStatusColumn` are column fields; columns already ride lane 3 (`setOptions` diff) | Nothing to add; the existing lane-3 tests cover it |

## Open questions carried forward

Questions 1–5 from the previous revision (header focus, group collapse, `--avg-*` on `:root`,
a `loading` state, built-in range filters) were **removed 2026-09-01 at the consumer's request**
— each is handled on the consumer side for now. They live in the git history and in the
plan-done decision logs if a future consumer re-asks.

1. **A pinned-left column that is still a DATA column** (asked by a consumer, 2026-09-01). Today
   `pinned: "left"` is the same predicate as `isStatusColumn` — `isStatusColumn === true ||
   pinned === "left"` — and that one predicate decides four unrelated things:

   | Where | Effect of pinned-left today |
   |---|---|
   | header render | `resizable = column.resizable !== false && !isPinned` → **cannot be resized**, even with `resizable: true` |
   | header render | `draggable = !isPinned` → cannot be reordered *(the wanted half)* |
   | `onCellPointerDown` | returns early → **not focusable, no range selection from it** |
   | `copyColumns` | filtered out → **absent from every copy** |

   The asking case is the ordinary one: an identity column that should stay visible while the rest
   scrolls sideways, must not be dragged out of first place, and is otherwise a normal data column
   — resizable, focusable, and copied (it is the column a user most wants in a paste). None of that
   is expressible, so the screen shipped without stickiness and enforces "always first" in its own
   normalization instead.

   The shape to design: **separate "sticky" from "chrome"**. `isStatusColumn` keeps meaning both —
   it is the checkbox column's flag and must not change — while `pinned: "left"` on a column that is
   not a status column would mean *sticky and not reorderable*, with focus, range selection, copy
   and resize behaving as they do anywhere else. Resize is the part that makes this a task rather
   than a flag flip: the pinned band's width feeds the sticky offsets, so a drag on a left-pinned
   header has to recompute them. Right-pinned columns already resize (from their left edge), so the
   grip logic exists on that side to copy from.

   Not urgent — the consumer that asked has chosen to wait for it rather than accept the losses.
