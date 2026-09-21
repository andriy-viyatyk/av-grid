# av-grid — Implementation Plan 18 (done): phase 22, `treeColumn.busy`

**Phases 1–21 had shipped through 2.11.3 (2026-09-16).** Phase 22 held one task — **task 64,
`treeColumn.busy`** (requested by a consumer, 2026-09-21; **shipped as 2.12.0 on 2026-09-21**).
Additive; shipped as a minor. `plan-done-16.md`'s shared-pool rule bore on it directly, and the
review before implementing found where.

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
| 1–63 | Phases 1–21 | see `plan-done-01.md` … `plan-done-17.md` — ✅ Done |
| 64 | `treeColumn.busy` — a spinner in the chevron's slot while a node's children load | ✅ Done — 2.12.0 |

## Task 64 — `treeColumn.busy`: a spinner in the chevron's slot while a node's children load

**The request** (a consumer, 2026-09-21). A grid whose deepest level is **fetched on expand**: the
rows above it arrive in one query, and pressing a chevron issues a request for that node's children.
The fetch takes long enough to see. The host wants the chevron **replaced** by a spinner for the
duration — not a spinner beside it — with the gesture off while it spins.

**Why replaced, in the consumer's words:** *"so user can click once to expand and not flick multiple
times to expand/collapse multiple times."* A spinner next to a live chevron leaves the toggle armed
during the fetch, and a reader whose row has not moved yet clicks it again — and again. Taking the
chevron away removes the affordance for exactly as long as the affordance would misbehave.

**What exists today, and why it is not enough.** `TreeColumnOptions` has `depth`, `hasChildren`,
`expanded`, `chevrons`, `indentSize` and `path`. Two partial routes exist and both are compromises:

- **`chevrons: (row) => !loading(row)`** removes the slot *and* the gesture — *"a row without a slot
  has no gesture either"* — which is the behavior wanted. But the slot is gone, so the content shifts
  left by its width and the row jumps as it loads and again as it finishes. Making it a `stub`
  instead is not an option the host can ask for: `stub` is what `hasChildren: false` produces.
- **Drawing the spinner in the cell's own content** (`render`, or the `avg-tree-content` host) keeps
  the slot, but the spinner then sits *after* the chevron rather than in place of it, and the chevron
  is still live.

So the one thing a host cannot express is the state this task adds: *this row has children, they are
on their way, and the slot belongs to the wait*.

**This does not take up open question 5** (a tree row engine in the library). The host still owns the
row set, still owns `expanded`, and still decides when a fetch starts and ends. `busy` is a fourth
appearance of an existing slot, nothing more.

### The work

1. **`busy?: (row) => boolean`** on `TreeColumnOptions`, beside `expanded`. Default: absent, and an
   absent predicate is not called — the option costs a paint nothing when unused, as `chevrons` does.
   Only consulted when the slot exists and `hasChildren(row)` is true: a stub cannot be busy, and a
   row with no slot has nothing to draw into.
2. **A fourth slot kind in `DataCell.ts`.** The slot is already a small state machine —
   `state.chevron` is `"none" | "stub" | "open" | "closed"` and the block at lines ~199-227 repaints
   only when the kind or `interactive` changes. Add `"busy"`: class `avg-tree-busy`, the chevron's
   SVG replaced by the spinner element, `data-expanded` removed, `data-inert` set. Keep `data-part`
   as `tree-chevron` — it is the same slot in the same position, and the DOM contract should say that
   rather than mint a second part name.
3. **The shared-pool rule applies** (`plan-done-16.md`): the spinner's element and class must be
   cleared by every other branch of the same block, exactly as `data-expanded` and `data-inert`
   already are. A cell recycled from a busy row into an ordinary one must not keep the spinner. This
   is the trap that phase 20 cost a session to find; the test below pins it.
4. **The gesture is off while busy.** `interactive` false for that row: no `onTreeToggle` from a
   click on the slot, and `→` / `←` on the focused tree cell do not toggle it either. The row stays
   focusable and navigable — it is loading, not disabled.
5. **`aria-busy="true"`** on the cell while the predicate holds, removed when it does not.
   `aria-expanded` is untouched: the node is not expanded until its children are there.
6. **The spinner: Persephone's, exactly** (author, 2026-09-21), with the host able to supply its
   own. The built-in is `ProgressIcon` from `persephone/src/renderer/theme/icons.ts` — ten tapered
   spokes 36 degrees apart, `fill-opacity` graded 0.1 → 1.0 — copied verbatim with its timing:
   `1.5s steps(10) infinite`, which is the other half of the copy, one step per spoke, so the dial
   ticks rather than sweeps. Sized to the chevron's existing 16px box (`.avg-tree-chevron,
   .avg-tree-stub, .avg-tree-busy` share it) and coloured from a new `--avg-tree-spinner`
   defaulting to `var(--avg-tree-chevron, var(--avg-text-muted))`, so a host that has themed the
   chevron gets a matching spinner for free. Under `prefers-reduced-motion` it simply stops — ten
   graded spokes still read as *working* standing still, so there is no second static mark to
   design. **`spinner?: (row) => string | Element | null | undefined`** replaces it: the same three
   arms as `Column.render`, called when a slot *enters* the busy state rather than per paint, and
   the element arm must return a fresh element each call because cells are pooled and appending a
   node moves it.
7. **React lane 3** — a plain per-row predicate on an option object, the same lane `expanded` and
   `chevrons` travel; verify by the wrapper's existing lane test.
8. **Docs**: `docs/api.md` `TreeColumnOptions` table and the DOM contract (`avg-tree-busy` under
   `data-part="tree-chevron"`); `docs/capabilities.md` under the tree subsystem.

### Verification

- Unit: with `busy` true for a row that has children, its slot carries `avg-tree-busy`, no
  `data-expanded`, `data-inert` set, and the cell `aria-busy="true"`; the parts list is unchanged in
  shape (`avg-tree-indent`… , `tree-chevron`, `avg-tree-content`).
- Unit: a click on that slot fires no `onTreeToggle`; `→` on the focused cell fires none either.
- Unit: flipping `busy` back to false restores the chevron, its SVG, the correct `data-expanded`, and
  drops `aria-busy` — and a cell **recycled** from a busy row to a non-tree row keeps nothing.
- Unit: `busy` absent leaves every existing tree test green, unchanged, and the predicate is never
  called when `hasChildren` is false.
- Board: a tree board with a node whose children arrive after a delay — the slot spins, the row does
  not jump, and repeated clicking during the wait does nothing.
- Benchmark: a row per `docs/releasing.md` if the paint path measures differently; the block is
  guarded on a kind change, so it should not.

## Decision log

| Decision | Why | Cost / notes |
|---|---|---|
| **64: `busy` is a fourth *slot kind*, not a second element** — `TreeGutter.chevron` gains `"busy"` beside `open` / `closed` / `stub` / `none` | The slot was already a four-state machine guarded on a kind change, so a fifth state costs one branch and inherits the guard: a spinning row that repaints for a hover or a selection rewrites nothing. It also keeps `data-part="tree-chevron"` honest — the same slot in the same place, which is what stops the row shifting as the fetch starts and ends (measured: 0 px) | One `busy?.(row)` per *folder* cell paint, and only where there is a slot; absent, the predicate is never called |
| **64: the gesture comes off through the existing `interactive` flag**, not a new gate | `canToggle`, `onArrow`, the `pointerdown` toggle, the click suppression and the double-click suppression all already read it, so one `false` takes the pointer and the keyboard off together and cannot drift apart | Verified in a real browser: six presses and a double-click on the spinner produced 0 toggles, `→` on the focused busy row navigated |
| **64: the plan's `aria-expanded` claim was wrong and the code would have dropped it.** A busy slot keeps the cell's `aria-expanded`, written from the new `TreeGutter.expanded` rather than from the slot's kind | The plan said the attribute was untouched; in fact `renderDataCell` wrote it only for `open` / `closed`, so a node would have *lost* its expanded state mid-fetch. Loading is not expanding, and a node that stops reporting either is worse than one reporting `false` | `aria-busy="true"` joins it while busy, and comes off with it |
| **64: `busy` must be listed in the branch that restores the chevron's SVG** | The one real bug the review found before implementing. That branch rewrote `innerHTML` only when the slot had been a stub or absent, so a slot leaving `busy` would have kept the spinner's markup and a row would come back from its fetch still spinning. The shared-pool rule (`plan-done-16.md`) one level in: here the "pool" is the slot and the occupants are the two icons | Pinned by a test that fails without it |
| **64: the header now clears `aria-expanded` and `aria-busy` when it claims an element** | The header shares the cell pool and has no `claim()`; `build()` is its equivalent and cleared children, `style`, `title` and `aria-sort` but not ARIA state a *data* cell had left. So `aria-expanded` had been leaking onto header cells since task 59 — found while adding `aria-busy`, which would have leaked the same way and announced a column header as loading | A pre-existing defect fixed in passing, and the third in this family after tasks 61 and 62 |
| **64: the spinner is Persephone's `ProgressIcon`, copied with its timing** | The author asked for exactly that spinner, and a host running both should see one spinner rather than two that nearly match. `steps(10)` is part of the copy, not decoration: ten spokes 36 degrees apart means one step lands each spoke where the last one was, and a linear rotation of the same icon is visibly a different spinner. Under `prefers-reduced-motion` it stops rather than swapping to a static mark — graded spokes already read as *working* standing still | Extracted from the reference file by script rather than retyped. Persephone stays untouched, as always |
| **64: `spinner` takes the row and may return a string, an element, or nothing** | The same three arms as `Column.render` and `HeaderRenderer`, so there is no new shape to learn, and `null` / `undefined` keeping the built-in is the same fallback rule headers use | Two pooling constraints are documented on the option: it is called on *entry* to the busy state, not per paint, and the element arm must return a fresh element each call, because appending moves a node |
| **64: passing the spinner factory down as a bound thunk cost 1.13× per scroll frame** | Found by running the tree gate rather than reasoning about it — `() => tree.options?.spinner?.(row)` is one closure allocated per tree cell per paint, for a call the slot makes only when it enters the busy state. Passing `tree.options` and `row` instead put the gutter back to **1.00×** | The standing "measure, don't assume" rule earning its keep again; the numbers are in `benchmark-results.md` |
| **64: nothing polls the row, and the docs say so twice** | The grid repaints when it is told to, so a `busy` that flips is seen only when something repaints that row. `toggle()` already repaints the toggled row *after* the callback, which makes the common case (`busy` set inside `onTreeToggle`) work with no host code at all; anything later rides the host's own `setRows` or `refresh()`. Left unsaid, this is the first support question the option would generate | Stated in the option's JSDoc, in `docs/api.md` with a runnable snippet, and demonstrated by `examples/17-tree-lazy.html` |
| **64: an example page rather than a board mode** | The plan asked for a board with a delayed node. The board's tree section is the *performance* gate and `busy` has no per-frame cost once the closure was gone; what needed showing was the interaction, and an example is both a real browser and something a consumer can read. The board's 14 tree checks were run anyway and stay green | `examples/17-tree-lazy.html`. The browser check drove it through `window.tree`: press → spinner with the row moved 0 px, 6 presses + a double-click → 0 toggles, `→` → navigates, fetch ends → chevron back with its own SVG |

## Open questions

The six open questions this plan carried move forward unchanged to [`plan.md`](plan.md). None is
committed.
