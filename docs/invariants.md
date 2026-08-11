# Three invariants that carry the performance

Everything else in av-grid is ordinary code. These three are not — each is easy to break with a
change that looks like a cleanup, and breaking any one costs the project its reason to exist.

[`CLAUDE.md`](../CLAUDE.md) states the rules; this file records *why* each one exists and what it
cost to learn. Read it before changing anything under `src/render/` or `src/view/`.

---

## 1. The scroll offset stays out of `inputChanged()`

`RenderGridModel.inputChanged()` compares every input *except* the scroll offset, and carries a
comment saying so. Scrolling is handled by `onScroll → updateRenderInfo(undefined, direction)`,
which renders only the newly exposed cells.

Adding the offset "for symmetry" would report a change on every scroll frame, force
`updateRenderInfo({ all: true })`, and rebuild every visible cell 60 times a second.

---

## 2. A cell renderer resolves its element in this order

```js
const el = p.previous ?? p.recycle?.() ?? document.createElement("div");
```

- **`p.previous`** — the element already at this coordinate, present when the cell went dirty
  rather than scrolled in. Updating it in place means the paint does **no** DOM insertion or
  removal, and anything living on the element survives: focus, an open editor, a transition.
- **`p.recycle()`** — an element evicted on an earlier frame, for cells that genuinely just
  arrived. It comes back **dirty**, exactly as its last occupant left it, so overwrite every
  property you set.
- **`createElement`** — only when both miss.

Dropping `previous` costs ~12× on full repaints and breaks in-cell editing; dropping `recycle`
allocates on every scroll frame. Prefer `firstChild.nodeValue` over `textContent`, which allocates
a text node per cell per frame.

### A cell that owns something cannot rely on its own repaint to hear that it lost it

An element scrolled out of the window is often *evicted* — removed from the DOM and replaced at the
new coordinate by a different element — and a renderer is never called for an element that is
merely evicted.

`EditingModel` learned this the expensive way: `releaseCell`, which fires when the editing cell is
repainted as another coordinate, covers a short scroll and misses a long one, so an open editor was
left attached to nothing. The fix is to ask the render window on the scroll
(`onViewportScrolled`) rather than to wait for a paint that will not come.

### Whatever a renderer returns, the stylesheet has to position it absolutely

The engine writes `top` and `left`; nothing writes `position`. A cell class that forgets it lays
out in flow, which looks correct at the top of a list — the inline width forces a wrap — and shows
an empty band everywhere below, while every benchmark stays green, because a paint costs the same
whether or not the row ended up where it was told. `VirtualList` shipped that way in task 14b.

### The same trap one level out: sizing, not just position

**Anything inserted between the host and the grid root inherits the root's sizing contract.** The
engine writes `flex: 1 1 auto` on the root, so a wrapper that takes the root's place as the host's
child must carry it too — task 17's filter bar wrapper did not, fell back to the flex default of
`0 1 auto`, and sized itself to the grid's *intrinsic* width, rendering a full-page grid as a
narrow column down the left of its host. Green suite, green benchmark: a paint costs the same
whatever width the grid ended up.

---

## 3. Listeners go on the root, never on a cell

`GridInteractions` binds ten listeners for the whole grid and resolves each event by reading
`data-row` / `data-col` / `data-column-key` off the nearest cell.

This is not a micro-optimization — it is a correctness requirement of pooling. An element that was
a header cell one frame is a data cell the next, so a listener bound to a cell would have to be
removed on every recycle, and any one missed would fire against the wrong column.

For the same reason, **state that a handler wants to show goes on the model, not on the element**:
a repaint reassigns `className`, so a class set directly by an event handler vanishes on the next
frame. That is why the column-drag state lives on `model.flags` and `HeaderCell` reads it.

### The consequence that bites hardest: `pointerdown`, never `click`

**An affordance *inside* a cell must be resolved on `pointerdown`.** A real click holds the button
for ~100 ms, and any state the press itself changes — the focus it moves, the hover it triggers —
repaints the cell in between and rewrites its content, replacing the element the press landed on.
The browser then dispatches `click` on the nearest surviving ancestor, which is the cell, and the
affordance is nowhere in the event's path.

That is what made the boolean checkbox need two clicks: the first one appeared to do nothing, and
the second worked only because by then nothing was left to change.

It cannot be caught by dispatching `pointerdown` / `pointerup` / `click` in one task, which is what
a test does — there has to be a frame in the middle, as there is in every real press. `click` is
safe against the cell *itself*, because `data-row` / `data-col` are re-read from whatever element
survived.
