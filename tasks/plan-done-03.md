# av-grid — Implementation Plan 03: the Persephone adoption gaps (tasks 27–32)

**Archived — all six tasks are ✅, shipped as 2.2.0.** Its **decision log still applies**, exactly
as [`plan-done-01.md`](plan-done-01.md)'s and [`plan-done-02.md`](plan-done-02.md)'s do. There is no
active `plan.md` — phase 8 has not been opened yet. Start one when it is.

Phase 7. Five additive options and one docs task, all driven by **one consumer**: Persephone is
replacing its own internal React grid (`src/renderer/uikit/AVGrid/`) with this library, and these
are the gaps that adoption found. They ship together as **2.2.0**.

[`goal.md`](goal.md) is the *what* and *why* of the project; this document is the *in what order*,
with a definition of done for each step.

**How to use this document:** work one task at a time, top to bottom. A task is finished only when
every line in its **Done when** list is true. Update the **Status** column as you go, and record
any decision that changes the plan in *Decision log* at the bottom rather than silently diverging.

**Before starting any task here, read the decision logs in
[`plan-done-01.md`](plan-done-01.md) and [`plan-done-02.md`](plan-done-02.md).** They record every
deliberate divergence from the Persephone reference, several reference bugs that were fixed rather
than carried over, and the traps that cost a debugging session each. Two of them are directly
relevant to this phase and are quoted where they apply.

Reference paths and the read-only rule: [`../CLAUDE.md`](../CLAUDE.md). Restated because this phase
is *about* Persephone and the temptation to "just fix it on both sides" is real:

> **Persephone is a read-only reference.** Never modify anything under `C:\projects\persephone`.
> Read from it freely; write only inside `C:\projects\av-grid`.

---

## Task tracker

| # | Task | Phase | Status |
|---|------|-------|--------|
| 1–20 | The port | see [`plan-done-01.md`](plan-done-01.md) | ✅ Done |
| 21–26 | Customization | see [`plan-done-02.md`](plan-done-02.md) | ✅ Done |
| 27 | `highlightString` — mark words without filtering rows | Adoption | ✅ Done |
| 28 | Built-in context-menu item `id`s | Adoption | ✅ Done |
| 29 | `rowNoun` — what the grid calls a row | Adoption | ✅ Done |
| 30 | `whiteSpaceY` — expose the trailing-slack height | Adoption | ✅ Done |
| 31 | `extraElement` — a host element after the last row | Adoption | ✅ Done |
| 32 | Docs, example, and the 2.2.0 release | Adoption | ✅ Done |

Status values: ⬜ Not started · 🟡 In progress · ✅ Done · ⏸️ Blocked (say why).

Order is 27 → 28 → 29 → 30 → 31 → 32. The two isolated model/view changes first, then `rowNoun`
which edits the file task 28 just touched, then the two that work together (`whiteSpaceY` is what
lets `extraElement` reserve its own room), then docs and release last because they cover all five.

**Nothing here is a breaking change.** Every task adds an option or an `id`; no existing signature,
default or rendered output moves. That is what makes 2.2.0 a minor, and it is a constraint on the
implementations, not just a description of them — see the standing rules.

---

## Standing rules for every task

Carried forward from plans 01 and 02 unchanged, plus two specific to this phase.

- **`npm run typecheck` passes.** Strict mode, no `any` in the public surface, no `@ts-ignore`.
- **`npm test` passes**, and each task adds the tests its neighbours have.
- **No runtime dependency is added.** Ever.
- **Verify in a browser, not only in tests.** happy-dom does no layout, so a green suite can sit on
  top of a grid that renders as a blank box. Tasks 30 and 31 are *only* verifiable in a browser.
- **After any task that touches the render path, re-run the benchmark and append a row to
  [`benchmark-results.md`](benchmark-results.md).** Task 30 touches `renderInfo`'s size arithmetic
  and therefore qualifies. Task 31 appends one element outside the pooled cells, which
  `syncRegion` never reconciles — no benchmark row required, but say so in the log rather than
  leaving it unexplained.
- **Structural DOM gets stable `data-*` attributes.** State never goes in generated class names.
- **Write the usage snippet before the implementation** for any new public surface. If the snippet
  is awkward, fix the API first.
- **Phase-specific: additive only.** No existing option's default changes, and no existing CSS
  *selector* changes what it does. If an implementation seems to need either, stop and record it —
  it means the design is wrong, because the whole point of shipping these as one minor is that the
  consumer can adopt them without reading a migration note.
- **Phase-specific: every new option must be settable through `setOptions()` as well as
  `create()`**, per the library's *one flat options object, no required call order* rule. The
  consumer's React shim pushes changed options through `setOptions` on every update, so an option
  that only works at `create()` is an option it cannot use.

---

## Phase 7 — The adoption gaps (tasks 27–32)

### Where these came from

Persephone's own grid is being deleted and replaced with this library. Its epic is
`C:\projects\persephone\doc\epics\EPIC-057.md` and the task driving this phase is
`C:\projects\persephone\doc\tasks\US-1019-adopt-av-grid\README.md` — both read-only, both useful
context, neither required reading to do the work here.

Twelve Persephone files consume the old grid. Every prop they pass has a direct equivalent here
**except** the five below. That is the entire gap list, measured against the actual call sites
rather than against the old grid's 40-property interface — most of which nothing passes.

The governing decision on the consumer's side is worth knowing because it is why this phase exists
at all rather than a set of workarounds over there:

> **When av-grid is not enough, the answer is to enhance av-grid.** Every gap — a missing option, a
> behaviour that does not fit, a hook that cannot express what a consumer needs — is resolved
> upstream in the library, not worked around in the host. No prop faked in a shim, no reach past a
> public façade into internals, no CSS compensating for markup the library should have produced.

So these are specified as *library* features with the consumer as the motivating example, not as
Persephone-shaped holes. Each one should read as though a board author asked for it.

---

### Task 27 — `highlightString`

**Why.** `searchString` does two things: it narrows the rows *and* marks the words that kept them.
That is exactly right for a search box. It is wrong when the words come from somewhere the grid is
not — a search-results panel that navigated the user here, a URL fragment, a filter applied
upstream. There the rows are already the right rows, and hiding the ones that happen not to contain
the term is a bug.

Persephone's grid editor has had a separate `highlightString` prop for exactly this since before the
port; it is fed from a page-navigation option (`highlightText`) when the user jumps to a grid from a
search result.

**Snippet first:**

```js
AVGrid.create(el, { rows, highlightString: "connection refused" });
grid.setOptions({ highlightString: term });   // must work here too
```

**Design.** One option, and the highlighted set becomes the **union** of both sources.
`filterRows` is not touched — that is what makes it highlight-only.

- `src/options.ts` — declare `highlightString?: string` immediately after `highlightSearch`
  (~line 276). Document that `highlightSearch: false` silences both, and that both may be set at
  once.
- `src/model/AVGridModel.ts` — `syncSearchWords` (~line 223) is the only place that decides what is
  marked. It becomes:

  ```ts
  // before
  syncSearchWords = (): void => {
      this.data.searchWords =
          this.options.highlightSearch === false
              ? EMPTY_WORDS
              : searchWords(this.options.searchString);
  };

  // after
  syncSearchWords = (): void => {
      if (this.options.highlightSearch === false) {
          this.data.searchWords = EMPTY_WORDS;
          return;
      }
      const search = searchWords(this.options.searchString);
      const extra = searchWords(this.options.highlightString);
      this.data.searchWords = extra.length ? [...search, ...extra] : search;
  };
  ```

  **Keep the shared-empty-array property.** `searchWords` returns the *same* `NO_WORDS` instance for
  every empty input specifically so the common case allocates nothing, and `data.searchWords` is
  read on the per-cell paint path. The `extra.length ?` branch above is what preserves it: with no
  `highlightString`, the result is `search` by identity, unchanged from today. Do not write
  `[...search, ...extra]` unconditionally.
- `src/AVGrid.ts` — `setOptions` (~line 831). `highlightString` falls into `rest` and is assigned,
  but nothing recomputes the words. Extend the existing `highlightSearch` branch (~line 858), which
  already does precisely the right three things for the same reason:

  ```ts
  if ("highlightSearch" in options || "highlightString" in options) {
      this.syncSearchHighlight();          // no-op for highlightString, harmless
      this.model.syncSearchWords();
      this.model.requestRepaint();
  }
  ```

  Note that `setSearchString` already calls `syncSearchWords`, so the two paths stay consistent.

**Done when**
- [ ] `highlightString` is declared, documented in `options.ts`, and settable via both `create()`
      and `setOptions()`.
- [ ] Words from `highlightString` are marked in the cells; **no row is filtered out** by it.
- [ ] `searchString` and `highlightString` together mark the union.
- [ ] `highlightSearch: false` silences both.
- [ ] `CellContext.highlight()` (and the exported `highlightText`) mark `highlightString`'s words
      too — they read `data.searchWords`, so this should fall out, but assert it, because a custom
      `render` column going unmarked beside a plain one is the exact failure `highlight` exists for.
- [ ] With neither option set, `data.searchWords` is still the shared empty array (assert by
      identity, not by length — that is the property that keeps the paint path allocation-free).
- [ ] Tests in `src/model/AVGridModel.test.ts` (or `src/highlight.test.ts`, wherever the existing
      search-word tests live), including the identity assertion.

---

### Task 28 — Built-in context-menu item `id`s

**Why.** `onGridContextMenu(e, items)` hands the host the items the grid would have shown so it can
draw them in its own menu. A host whose menu renders icons differently — as components, as sprite
names, as anything but this library's SVG source strings — has to *re-icon* those items, and with no
stable identity on them the only handle is the label. Labels are localised, pluralised and counted
(`Insert 3 rows`), so matching on them is guesswork.

Persephone hits this hard: its menu takes `icon` as an icon *component* and calls
`createElement()` on it, which **throws** when handed a string. Without ids its only options are
label matching or no icons at all.

This also makes `gridContextMenuItems()` genuinely testable by identity rather than by label text,
which is worth having on its own.

**Snippet first:**

```js
onGridContextMenu: (e, items) => {
    for (const item of items) {
        if (item.id === "avg-copy") item.icon = myIcons.copy;
    }
    myMenu.show(e.x, e.y, items);
}
```

**Design.** `MenuItem.id` already exists — documented as *"Identity for keyboard navigation.
Defaults to the index and the label"* — so this sets a field the type already has. Add one to every
item built in `src/view/ContextMenu.ts`'s `gridContextMenuItems` (~lines 72–176):

| Item | `id` |
|---|---|
| Insert column *(header right-click)* | `avg-insert-column` |
| Delete column *(header right-click)* | `avg-delete-column` |
| Copy | `avg-copy` |
| Copy as… | `avg-copy-as` |
| ↳ With Headers | `avg-copy-as-headers` |
| ↳ JSON | `avg-copy-as-json` |
| ↳ Formatted (HTML Table) | `avg-copy-as-html` |
| Paste | `avg-paste` |
| Insert *n* rows | `avg-insert-rows` |
| Add *n* rows | `avg-add-rows` |
| Delete *n* rows | `avg-delete-rows` |
| Insert *n* columns | `avg-insert-columns` |
| Add *n* columns | `avg-add-columns` |
| Delete *n* columns | `avg-delete-columns` |

**The `avg-` prefix is deliberate and load-bearing.** Host items from `getContextMenuItems` are
prepended into the same array and may carry ids of their own; `id` is what the menu uses for
keyboard navigation, so a collision is a real bug rather than a cosmetic one. The prefix makes the
namespace explicit and makes `item.id?.startsWith("avg-")` a usable test for "this is the library's
own item".

These ids become **public contract** the moment they ship — they belong in `docs/api.md`, and
renaming one later is a breaking change. Choose them once, here.

**Done when**
- [ ] Every built-in item carries the `id` above, submenu children included.
- [ ] No duplicate ids in any single menu, including when host items are present. Assert this — it
      is the failure mode the prefix exists to prevent.
- [ ] Keyboard navigation, submenu opening and the search box (items > 20) all still behave
      identically. Explicit ids were always supported, so this should be a no-op; check it in a
      browser rather than assuming, because the default was index-plus-label and these are not.
- [ ] The id table is in `docs/api.md`'s context-menu section, stated as a stable contract.
- [ ] `src/view/ContextMenu.test.ts` asserts the ids by identity for a cell right-click and a header
      right-click.

---

### Task 29 — `rowNoun`

**Why.** Not every grid holds "rows". A grid of links holds links; a grid of environment variables
holds variables. The context menu says `Insert 3 rows` and the add-row button says `add row`, and
on those grids both read as though the grid does not know what it contains.

Persephone's old grid had an `entity` prop for this, used by four of its call sites. The consumer
could rewrite the labels host-side now that task 28 gives it ids — but that means re-deriving
`Insert 3 rows` from an id and a count, *including the pluralisation*, in the host. One option
lets the grid compose it, and every consumer gets it.

**Snippet first:**

```js
AVGrid.create(el, { rows: links, rowNoun: "link", canAddRows: true, canDeleteRows: true });
// menu reads "Insert 3 links" / "Delete 1 link"; the button reads "+ add link"
```

**Design.** One option, default `"row"`, feeding the two places a row is named.

- `src/options.ts` — declare `rowNoun?: string` next to `addRowLabel` (~line 175). Document that
  it is a *singular* noun and the grid pluralises it, that `addRowLabel` overrides the button text
  outright, and that columns are unaffected.
- `src/view/ContextMenu.ts` — the three `plural(rows, "row")` calls become
  `plural(rows, options.rowNoun ?? "row")`. **The column labels keep saying "column"** — do not add
  a `columnNoun`. Nothing asks for it, and the consumer's four sites all rename rows only.
- `src/AVGrid.ts` — `syncAffordances` (~line 1149) already reads `addRowLabel`; its default becomes
  `` `add ${rowNoun ?? "row"}` `` instead of the literal `"add row"`. The `title` derives from the
  same label, so it follows.

Naming: `rowNoun` rather than `entity`. `entity` is what the reference called it and it is vaguer —
it does not say that the value is a *word* the grid will inflect, and a host reading `entity: "link"`
cannot tell whether it will be shown to a user.

**Done when**
- [ ] `rowNoun` affects the three row labels in the context menu and the add-row button's text and
      title.
- [ ] Pluralisation works (`1 link` / `3 links`) through the existing `plural()`.
- [ ] Column labels are unchanged.
- [ ] `addRowLabel` still wins over the `rowNoun`-derived default.
- [ ] Default with no `rowNoun` is byte-identical to today's output. Assert this — it is the
      additive-only rule, and the labels are the easiest thing in this phase to change by accident.
- [ ] Settable via `setOptions()`; the button text updates without a re-create.
- [ ] Tests alongside task 28's in `src/view/ContextMenu.test.ts`.

---

### Task 30 — `whiteSpaceY`

**Why.** The grid reserves 20 px of slack below the last row so it can scroll clear of the bottom
edge (`whiteSpace` in `src/render/renderInfo.ts:92`). The engine has always taken a
`whiteSpaceY` / `whiteSpaceX` override — `RenderGridModel.options.whiteSpaceY:90`, read at `:453` —
but `AVGridOptions` never exposed it, so a grid can neither shrink the slack nor reserve more.

Reserving more is what task 31 needs: a footer element taller than 20 px otherwise overlaps the last
row. This is the honest way to give it room, as opposed to having `extraElement` silently change the
grid's geometry.

**Snippet first:**

```js
AVGrid.create(el, { rows, whiteSpaceY: 24, extraElement: footer });   // a 24px footer, room reserved
AVGrid.create(el, { rows, whiteSpaceY: 0 });                          // no trailing slack at all
```

**Design.** A pass-through, and nothing more. `src/options.ts` declares `whiteSpaceY?: number`
(default 20) in the Layout section beside `overscanRow` / `overscanColumn`; `src/AVGrid.ts` forwards
it to `this.render.setOptions({ whiteSpaceY })` in the constructor and in `setOptions` alongside the
existing `rowHeight` / `fitToWidth` / `overscan*` forwards (~lines 878–893).

Expose **`whiteSpaceY` only, not `whiteSpaceX`.** There is a live consumer for the vertical one and
none for the horizontal, and the horizontal slack interacts with `fitToWidth` and percentage column
widths through `columnsFitted` — which plan 02's log records as having already produced one spurious
horizontal scrollbar. Adding a second control over that arithmetic with nothing asking for it is how
that bug comes back. Say so in `options.ts` so the asymmetry does not read as an oversight.

**This is a render-path change** — it feeds `calcInnerSize`. Benchmark row required.

**Done when**
- [ ] `whiteSpaceY` reaches the engine from both `create()` and `setOptions()`.
- [ ] Default behaviour with the option absent is unchanged (`whiteSpace`, 20).
- [ ] `whiteSpaceY: 0` removes the trailing slack; a large value adds it. Verified in a browser by
      scrolling to the bottom, not from a test.
- [ ] `whiteSpaceX` is *not* exposed, and `options.ts` says why.
- [ ] A benchmark row is appended to `benchmark-results.md`.

---

### Task 31 — `extraElement`

**Why.** A grid often needs one thing after the last row that is not a row: a "Load more" footer, an
empty-state line, a total. Today the only element the grid puts there is its own add-row button.

Persephone's git-tree does exactly this — a centred, full-width **"Load more · Load all"** footer
band on an opaque background, drawn under the last commit.

**Snippet first:**

```js
const footer = document.createElement("div");
footer.textContent = "Load more";
const grid = AVGrid.create(el, { rows, extraElement: footer, whiteSpaceY: 24 });
grid.setOptions({ extraElement: null });   // and it goes away
```

**Design.** Parent the host's element into the scrolling content region and **position it by
default**, letting the host override.

- `src/options.ts` — `extraElement?: HTMLElement | null`, Presentation section. Document: the grid
  parents it and never inspects, clears or destroys it; it is removed from the DOM on `destroy()`
  but not disposed, because the host made it; and it lives in the trailing slack, so pair it with
  `whiteSpaceY` (task 30) if it is taller than 20 px.
- `src/AVGrid.ts` — a `syncExtraElement()` called from `syncAffordances()`, which `setOptions`
  already calls unconditionally. Hold the currently-parented element in a private field; when the
  option's identity changes, `previous.remove()` then add the new one via
  `this.render.addOverlay(el, "content")` — the existing hook for exactly this, whose docblock at
  `src/render/RenderGrid.ts:216` explains why it is safe against the paint (`syncRegion` only ever
  removes elements it appended itself, so an overlay is invisible to reconciliation and is never
  recycled out from under its listeners). Add `class="avg-extra"` and
  `data-avg-slot="content-end"`. Remove it in `destroy()` beside the add-row button (~line 1060).
- `src/styles/av-grid.css.ts` — a default that is a full-width footer band:

  ```css
  .avg-grid .avg-extra {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
  }
  ```

**Why the library positions it at all**, when it deliberately does *not* position an
element-returning cell renderer: there the engine writes `top` and `left` and the host only has to
add `position`. Here nothing writes anything, so a bare host element lays out in flow inside a
container full of absolutely positioned cells and lands at the top-left *behind* them — an invisible
element that is still hoverable. That is not a trap worth preserving. One class's worth of
specificity is trivial to override (`.avg-grid .avg-extra.my-chip { left: 4px; right: auto; }`), and
the default is what the known use wants. Set **no** colour, size or padding — a footer band that
needs an opaque background gets it from the host, because only the host knows what the grid's
background is.

Two things to document rather than solve:
- **`extraElement` and `canAddRows` share the strip.** The add-row button is at `bottom: 1px;
  left: 4px`; a full-width default footer will sit over it. A grid that wants both positions its own
  element clear. Do not add layout machinery for a combination no consumer has asked for — say what
  happens and move on.
- **Taller than the slack overlaps the last row.** That is what `whiteSpaceY` is for; an opaque
  background is the cheap alternative.

**Done when**
- [ ] `extraElement` appears below the last row, full width, and scrolls with the content.
- [ ] Passing a different element swaps it; passing `null`/`undefined` removes it. Both via
      `setOptions()`.
- [ ] The host's element is never mutated by the grid — no `replaceChildren`, no class stripping
      beyond adding `avg-extra`, no removal of its own children. A listener bound by the host still
      fires after a repaint and after a scroll that evicts every cell around it. **Test the scroll
      case specifically:** plan 02's log records an editor being silently detached by *pool
      eviction* during a long scroll, which is the same class of bug and was only visible in a
      browser, because the pool needs real layout to evict anything.
- [ ] `destroy()` detaches it and leaves it intact and reusable.
- [ ] With `whiteSpaceY` matching its height, it does not overlap the last row at full scroll.
- [ ] Verified in a browser at the top, at the bottom, and after a 100k-row scroll.
- [ ] The DOM-contract table in `docs/api.md` lists `avg-extra` and `data-avg-slot="content-end"`.

---

### Task 32 — Docs, example, and the 2.2.0 release

**Design.** Documentation is where this phase is actually consumed — the host adopting the library
reads `docs/api.md`, not the source.

- `docs/api.md`:
  - Options tables: `highlightString` (Sorting and filtering), `rowNoun` (Adding and deleting),
    `whiteSpaceY` (Layout), `extraElement` (Presentation).
  - *Search highlighting*: the two-sources union, and the one-line rule for which to reach for —
    `searchString` when the user is searching *this* grid, `highlightString` when the words came
    from outside it.
  - *The context menu*: the id table from task 28, marked as a stable contract, with the re-iconing
    snippet.
  - *DOM contract*: `avg-extra`, `data-avg-slot="content-end"`, and the positioning default with the
    override snippet.
- `docs/capabilities.md`: extend the customization and context-menu sections; five more host hooks
  is a capability change, not just an API one.
- One example page. Prefer extending an existing numbered example over adding an eleventh: a footer
  plus a highlight-only term plus a renamed row noun is one small grid, not a new topic. If it does
  earn its own page, number it (`11-…html`) and add it to `index.html` — plan 02's log records the
  one time an unnumbered example was added and had to be renamed.
- `../CLAUDE.md`: update *Current state* (phase 7 done, 2.2.0) and the *Where everything is* table's
  note that there is no active plan.
- Archive: rename this file to `plan-done-03.md` once tasks 27–32 are ✅, leave it unedited, and
  update the pointers in `CLAUDE.md` and in plan 02's opening note. **Keep the decision log** — it
  is the phase's institutional memory and the next plan is expected to read it.
- Release, per [`docs/releasing.md`](../docs/releasing.md) — read it before touching the version:

  ```bash
  npm test && npm run build
  npm version minor          # 2.1.0 → 2.2.0; syncs the two version constants and tags
  git push --follow-tags     # the tag starts the publish workflow
  gh run watch
  ```

  **`minor`, not `patch`** — five additions to the surface documented in `docs/api.md`. Nothing is
  breaking, so not `major`.

**Done when**
- [ ] All five options are in `docs/api.md`'s option tables and in the prose section each belongs to.
- [ ] The context-menu id table is published as a contract.
- [ ] `docs/capabilities.md` covers the five.
- [ ] An example demonstrates `extraElement` + `whiteSpaceY` + `rowNoun` + `highlightString`
      together, and is listed in `index.html` if it is a new page.
- [ ] `CLAUDE.md`'s *Current state* and plan pointers are updated; this file is `plan-done-03.md`.
- [ ] **2.2.0 is on npm** with provenance, the GitHub release exists, and `AVGrid.version`,
      the `version` export and `package.json` all agree (a test asserts this — it will fail if
      `npm version` was bypassed).
- [ ] `benchmark-results.md` has task 30's row.

---

## What is deliberately *not* in this phase

Recorded so it is not re-litigated, and so the consumer's own document and this one agree.

- **`columnNoun`.** See task 29. No consumer renames columns.
- **`whiteSpaceX`.** See task 30. It interacts with `fitToWidth` and percentage widths through
  `columnsFitted`, which has already produced one spurious horizontal scrollbar (plan 02's log,
  2026-08-11, "fix"). Nothing is asking for it.
- **A `MenuItem` shape adapter.** Not needed: `MenuItem` here and Persephone's
  `core/events/context-menu.ts` `MenuItem` are field-for-field identical, and Persephone's `icon` is
  typed loosely enough to accept this library's. Icons were the only real gap, which is task 28.
- **`persistFilters` for the consumer.** Persephone persists grid view state per page and per file
  in its own editor state, which one named `localStorage` key cannot express. It will use the
  initial-option-plus-callback pairs that already exist. No library change.
- **A controlled-props compatibility layer.** The consumer explicitly decided against emulating its
  old controlled React props over this library's imperative instance; each of its call sites absorbs
  the inversion itself. Nothing here should try to help with that.
- **Moving the `--avg-*` defaults to `:root`.** Still an open question in `CLAUDE.md`, still not
  urgent, and unrelated to adoption — the consumer sets `--p-*` at its own root, which already
  reaches everything.

---

## Decision log

Append here whenever the plan changes during implementation — what changed, and why. The logs for
tasks 1–20 ([`plan-done-01.md`](plan-done-01.md)) and 21–26
([`plan-done-02.md`](plan-done-02.md)) are still required reading.

| Date | Task | Decision |
|------|------|----------|
| 2026-08-22 | 27–32 | **Phase 7 planned from a single consumer's measured gap list**, written before any of it is built. Five decisions pinned at planning time: (a) **`highlightString` is a second source of words, not a mode** — a `highlightOnly: boolean` modifier on `searchString` would have made one option mean two things depending on another, and a grid that wants both a live search box *and* an inherited term needs both at once. (b) **`rowNoun`, not the reference's `entity`** — the value is a word the grid inflects and shows to a user, and `entity` says none of that. (c) **`whiteSpaceY` is split out as its own task rather than folded into `extraElement`** — an element that silently changed the grid's geometry would be a footgun, and the engine option already existed and was simply unexposed. (d) **`extraElement` is positioned by the library's stylesheet, unlike an element-returning cell renderer** — there the engine writes `top`/`left` and the host adds `position`; here nothing writes anything, so an unpositioned element lays out in flow *behind* the absolutely positioned cells and is invisible but hoverable. One class is trivially overridable and the default is what the known use wants. (e) **Built-in menu ids are prefixed `avg-`** — host items share the array and `id` drives keyboard navigation, so a collision is a real bug, and the prefix also gives a host a test for "this item is the library's". |
| 2026-08-22 | 27 | **Kept as specified, with one thing worth pinning by identity.** `searchWords("")` returns the *same* `NO_WORDS` array for every empty input, and `data.searchWords` is read on the per-cell paint path, so the `extra.length ?` branch is what keeps the no-`highlightString` case allocation-free. The test asserts it by **identity across two grids**, not by length — a length check passes either way, which is what makes this the easy thing to break in a later cleanup. Also found and recorded rather than changed: `searchString: "a"` plus `highlightString: "race"` over "Grace" marks `race` once, not `a` and `race` — `markSearchWords` resolves overlaps by longest-match-wins, and this option does not change that. |
| 2026-08-22 | 28 | **Ids are a no-op at runtime, which is the whole reason to check them in a browser.** `Menu` already defaulted an item's id to its index-plus-label and resolves its active row by `prepared.find(p => p.id === ...)`, so explicit ids only replace the default — provided they are unique. Verified on the board rather than assumed: arrow navigation walks Copy → Copy as… → Paste and back, ArrowRight opens the submenu and ArrowDown lands on *With Headers*, and with 16 host items alongside the 9 built-in ones the **25-item menu grows its search box**, focuses it, and narrows to the two Delete rows. Host ids and `avg-` ids coexisted with no collision, which is what the prefix is for. |
| 2026-08-22 | 29 | **The default is asserted, not assumed.** `rowNoun`'s risk is not that it fails but that it silently changes the labels of every grid that never set it, so the test pins `Insert 2 rows` / `Add 2 rows` / `Delete 2 rows` by id. `rowNoun` is destructured in `gridContextMenuItems` once per menu rather than read three times, and `syncAffordances` derives the button default from it, so `addRowLabel` still wins outright — also pinned. |
| 2026-08-22 | 30 | **The option needed no engine change, and the reason is worth writing down.** `whiteSpaceY` is deliberately *not* in `RenderGridModel.inputChanged()`, so `render.setOptions({ whiteSpaceY })` alone would not recompute the geometry — but `AVGrid.setOptions` ends in `refresh()`, which is `update({ all: true })`, which reaches `updateRenderInfo()` on the microtask queue and recomputes `calcInnerSize` with the new value. So the pass-through is genuinely all that was needed, and adding a comparison to `inputChanged` would have been a second path to the same paint. Confirmed as geometry rather than as a timing: content height is **24,025 + the slack** at 0 / 20 / 24 / 80. |
| 2026-08-22 | 31 | **Verified against pool eviction, which is the failure mode that matters.** A 100,000-row scripted scroll **released 18,040 cells** and left the host's element connected, unmutated, and its click listener still firing — the same class of bug plan 02's log records for the editor, and the reason `addOverlay` is the right hook rather than an insertion of our own. A full repaint with the footer parented mutates **0** DOM nodes, so `syncRegion` never sees it; no benchmark row was needed for that half, and the row that exists is task 30's. |
| 2026-08-22 | 31 | **Writing the example is what showed the add-row collision is not merely worth documenting.** The plan said to state what happens and move on — correct for the library, wrong for a demonstration: the first render of `11-host-integration.html` had `canAddRows` on and the full-width band sat exactly over **+ add link**, so the page contradicted its own first sentence. The example now overrides `bottom` by the button's own 24px and reserves 28 + 24 through `whiteSpaceY`, which demonstrates the escape hatch and the reason `whiteSpaceY` exists in one rule. The library default is untouched. |
| 2026-08-22 | 32 | **The example earned its own page: `11-host-integration.html`.** The plan preferred extending an existing one, and the candidate was `10-customization.html` — but that page's identity is *every host hook in one file*, and these five are not hooks: they are what a host supplies **around** the rows. Numbered and listed in `index.html`, `examples/README.md` and the root README, with the four "eleven examples" counts corrected to twelve. Driven in a browser: the id-matched icons render as `📋 Copy` / `🗑 Delete 1 link`, the footer's own listener logs through the grid, `extraElement: null` and back remounts it intact, and search "ops" + highlight "status" marks the union over 3 rows and then 8. |
| 2026-08-22 | 31 | **The first design was wrong, and reading the consumer is what caught it.** `extraElement` was going to share a flex "content-end strip" with the add-row button, which meant de-positioning `.avg-add-row` — a change to a published selector, in a release whose whole point is that it is additive. Then the actual consumer turned out to be a *full-width footer band on an opaque background*, not a chip beside a button: it would have had to fight the strip's layout for nothing. The final design touches `.avg-add-row` not at all, adds one new class, and needed one fewer decision. Recorded because the general lesson is the phase's: these are library features with a consumer as the example, and the example is worth reading before the feature is designed. |
