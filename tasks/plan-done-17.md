# av-grid — Implementation Plan 17 (done): phase 21, a popover inside a modal dialog

**Phases 1–20 have shipped, through 2.11.2 (2026-09-14).** This plan holds the standing rules, the
open questions, and **phase 21 — task 63, every popover is unreachable when the grid is inside a
modal `<dialog>`** (reported by a consumer 2026-09-16; **shipped as 2.11.3 on 2026-09-16**). **Before starting anything, read the
decision logs in `plan-done-01.md` … `plan-done-16.md`** — every one of them still applies.

Task 63 is a defect. It is a **patch** if it ships as auto-detection with no new public option,
which is what is proposed below; adding a public `container` would make it a **minor**.

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
| 1–62 | Phases 1–20 | see `plan-done-01.md` … `plan-done-16.md` — ✅ Done |
| 63 | A popover opens outside an open modal `<dialog>`, where it is inert | ✅ Done — 2.11.3 |

## Task 63 — every popover is unreachable when the grid is inside a modal `<dialog>`

**The report** (a consumer, 2026-09-16). A grid mounted inside a native `<dialog>` opened with
`showModal()`. **Right-click produces no usable context menu.** Nothing in the host's options
suppresses it — no `getContextMenuItems`, no `onGridContextMenu`, no disable flag — and the same
grid's menu works normally on an ordinary page. `Ctrl+C` and `Ctrl+Shift+C` still copy, so the
selection and the copy path are unaffected; only the menu is lost. The consumer's grid also has
filtering on by default, so the header funnels are present and their popover is unreachable in
exactly the same way — a second symptom of one cause, not yet hit.

### The cause — `Popover` mounts at `document.body`, and a modal dialog makes that inert

1. `Popover.show()` ends with `this.doc.body.appendChild(this.root)` (`src/view/Popover.ts:167`).
   The class doc already states this as a known property: *"This is the first thing in the library
   that lives outside the grid's own DOM."*
2. `dialog.showModal()` puts the dialog element in the browser's **top layer** and makes everything
   else in the document **inert** — not hit-testable, and painted beneath the dialog's `::backdrop`.
   A body-level popover is therefore created correctly and then cannot be seen or clicked.
3. So the failure is total and silent: no error, no warning, and the promise `show()` returns never
   resolves until something else dismisses it.

Every popover entry point is affected, because all four go through the same class:

| Entry point | Anchor |
|---|---|
| `ContextMenu.ts:297` — `new Menu({ anchor: { x, y }, items })` | a **point** |
| `FilterPopover` (`showFilterPopover`) | the header funnel element |
| `FilterBar` chip editor | the chip element |
| `CellSelect.ts:85` | the cell's editor element |

### Two things are already right, and should not be re-solved

Both were checked against the source while writing this task:

- **`position: fixed` is what the popover already uses** (`src/styles/av-grid.css.ts:691`, with
  `z-index: 1000`). A fixed element is positioned against the viewport and is **not** clipped by an
  ancestor's `overflow: hidden`, so moving the root inside the dialog needs no change to the
  placement maths and survives the `overflow: hidden` that a dialog shell commonly carries. The
  `z-index` becomes irrelevant rather than wrong: the top layer paints above it regardless.
- **Escape already does the right thing.** `onDocumentKeyDown` (`src/view/Popover.ts:349`) calls
  `preventDefault()` and `stopPropagation()` in the capture phase, so Escape with a popover open
  closes the popover and **not** the surrounding dialog. Without the `preventDefault` the browser
  would fire the dialog's own `cancel` and both would close.

### Proposed design — resolve a host element, default unchanged

*(As planned, with one addition the review found: `showFilterPopover` takes a point too, so the
filter popover is a second point-anchored call site. What was actually done is in the decision
log below.)*

A single internal helper, and one line changed in `Popover.show()`:

```ts
// The element a popover should mount into: the nearest OPEN modal dialog, or the body.
// A modal dialog is in the top layer and makes the rest of the document inert, so a popover
// left at body level is created correctly and then cannot be reached.
function popoverHost(node: Element | null | undefined, doc: Document): HTMLElement {
    return node?.closest("dialog[open]") ?? doc.body;
}
```

- `PopoverOptions` gains an **internal, undocumented** `container?: HTMLElement`. `show()` uses
  `this.options.container ?? popoverHost(anchorElement, this.doc)`.
- For an **element** anchor the answer comes from the anchor itself, so the three element-anchored
  entry points need no change at all.
- For a **point** anchor there is no element to ask, so `ContextMenu.ts:297` passes the grid root:
  `container: popoverHost(gridRoot, doc)`. This is the only call site that has to change.
- A submenu should inherit its parent menu's container rather than resolve again — it is anchored
  to a row inside a popover that may already be inside the dialog, so `closest` would find the same
  answer, but inheriting states the intent and costs nothing.

**Why not a public option.** Nothing a host can do today fixes this, and a host should not have to
know where the library mounts its own popovers — which is the argument for auto-detection rather
than surface. Keeping `container` internal also keeps this a patch. If a consumer later needs to
mount into something that is not a dialog (a shadow root, a `popover`-attribute element, a portal),
the option is already there and can be published then, as a minor.

**Why `dialog[open]` and not `:modal`.** `:modal` matches only a dialog opened with `showModal()`,
which is exactly the failing case and would be the more precise selector — but `Element.closest`
with `:modal` is newer than the rest of the library's baseline. `dialog[open]` also matches a
non-modal `show()` dialog, where mounting inside is harmless (that dialog is not in the top layer
and nothing is inert, so the popover works either way). Worth a sentence in the decision log.

### Known limit to record rather than fix

If the dialog — or anything between it and the popover — carries `transform`, `filter`,
`perspective`, `backdrop-filter`, `will-change` or `contain`, that element becomes the containing
block for `position: fixed` descendants: the viewport coordinates stop meaning what they mean and
`overflow: hidden` starts clipping. That is a pre-existing property of fixed positioning, not
something this change introduces, and it is worth a line in the docs beside the new behaviour so
that a host animating its dialog open knows why a popover lands in the wrong place.

### Verification

Per the ground rules, **in a browser and not only in tests**: jsdom implements `<dialog>` as an
element but not `showModal()`, the top layer, or inertness — a consumer already has to polyfill
`showModal`/`close` to test anything in this area, and a polyfill cannot reproduce the bug. A unit
test can assert only the mounting decision (that `root.parentElement` is the dialog rather than the
body), which is worth having and is not evidence the defect is gone.

- An example page with a grid inside a `showModal()` dialog: right-click shows the menu, a menu row
  runs, a submenu opens, Escape closes the menu and leaves the dialog open, Escape again closes the
  dialog.
- The same page with a filterable column: the funnel popover opens, applies and dismisses.
- An ordinary page: `root.parentElement === document.body`, unchanged.
- The React wrapper needs nothing — no option crosses the lanes.

## Decision log

| Decision | Why | Cost / notes |
|---|---|---|
| **63: `popoverHost(node, doc)` — `node?.closest("dialog[open]") ?? doc.body` — and an internal `container` on `PopoverOptions`**, resolved in `show()` rather than in the constructor | A modal dialog is in the top layer and makes the rest of the document inert, so a body-level popover is built correctly and is then invisible and unclickable, with no error. Resolving at *mount* time and not at construction is what makes a host that opens its dialog around an already-live grid work: the dialog can open between `new Popover` and `show()` | One `closest()` per popover open. Nothing per frame, and no render-path file in the diff |
| **63: `container` stays internal and undocumented** | A host should not have to know where the library mounts its own popovers — auto-detection is the fix, and keeping the option unpublished keeps this a **patch**. It is the option to publish, as a minor, if a consumer ever needs a shadow root or a portal | The three element-anchored entry points (the funnel, the filter-bar chip, the cell dropdown) needed no change at all |
| **63: the plan said one call site had to change; there are two.** `showFilterPopover` is public and takes `anchor?: Element \| Point` — a host reopening a filter from its own chip passes a point — so `FilterPopover` resolves from the grid root on the point arm, exactly as `ContextMenu` does | Found in review before implementing. A point carries no position in the tree, so it is the anchor *kind*, not the entry point, that decides who has to pass a container | `model.renderModel?.gridRef.current` was already reachable in both files |
| **63: a submenu inherits its parent's mount host** (`Popover.mountedIn`) rather than resolving again | Its anchor is a row inside the parent's root, so `closest` would give the same dialog — stating the intent costs nothing and does not depend on that remaining true | `mountedIn` is `undefined` while closed, which the tests pin |
| **63: `dialog[open]`, not `:modal`** | `:modal` matches exactly the failing case and would be more precise, but it is newer than the rest of this library's baseline. `dialog[open]` also matches a non-modal `show()` dialog, where mounting inside is harmless — nothing is inert there, so the popover works from either parent | — |
| **63: the `transform` limit is documented, not fixed** | A `transform`, `filter`, `perspective`, `backdrop-filter`, `will-change` or `contain` between the dialog and the popover makes that element the containing block for `position: fixed`, so viewport coordinates stop meaning viewport coordinates and `overflow: hidden` starts clipping. That is a property of fixed positioning and predates this change; a dialog animated open with a transform is how a host meets it | One paragraph in `docs/api.md` and in the example's header comment |
| **63: verified in a real browser with `elementFromPoint`, not by mounting alone** | happy-dom has a `<dialog>` element but no `showModal()`, no top layer and no inertness, so a unit test can only assert *which element the root ended up in* — which would have passed before the fix on any polyfill. Hit-testing the middle of the open menu inside a real `showModal()` dialog is the assertion that actually distinguishes the two | `examples/16-dialog.html`; nine of the new tests fail on 2.11.2 |

## Open questions

The six open questions this plan carried move forward unchanged to [`plan.md`](plan.md). None is
committed.
