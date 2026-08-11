# av-grid — Implementation Plan 02: customization (tasks 21–26)

The task-by-task build order for the current phase. [`goal.md`](goal.md) is the *what* and
*why*; this document is the *in what order*, with a definition of done for each step.

**How to use this document:** work one task at a time, top to bottom. A task is finished only
when every line in its **Done when** list is true. Update the **Status** column as you go, and
record any decision that changes the plan in *Decision log* at the bottom rather than silently
diverging.

**Before starting any task here, read the decision log in
[`plan-done-01.md`](plan-done-01.md).** That is the archived plan for tasks 1–20 — the port
itself — and its log records every deliberate divergence from the Persephone reference, several
reference bugs that were fixed rather than carried over, and the traps that cost a debugging
session each. It is the single highest-value thing to read before touching this code.

Reference paths and the read-only rule: [`../CLAUDE.md`](../CLAUDE.md).

---

## Task tracker

| # | Task | Phase | Status |
|---|------|-------|--------|
| 1–20 | The port — engine, grid, behaviour, filters, docs | see [`plan-done-01.md`](plan-done-01.md) | ✅ Done |
| 21 | Styling hooks — `cellClass`, `rowClass`, `headerClass` | Customization | ✅ Done |
| 22 | Custom cell editors — `column.editor` | Customization | ✅ Done |
| 23 | Custom filters — `column.filter` | Customization | ✅ Done |
| 24 | `copyValue`, and the value-precedence table | Customization | ✅ Done |
| 25 | Customization docs, example, and board | Customization | ⬜ Not started |
| 26 | Custom sorting — `sortValue` | Customization | ✅ Done |

Status values: ⬜ Not started · 🟡 In progress · ✅ Done · ⏸️ Blocked (say why).

Order is 21 → 24 → 22 → 23 → 26 → 25: the two cheap render-path tasks first, then the two large
ones, then 25 last because it documents and demonstrates all of them.

---

## Standing rules for every task

Carried forward from plan 01 unchanged. Applied to all tasks; not repeated in each one.

- **Read the reference file before writing the port of it.** The Persephone file is the
  specification. When behaviour is unclear, read it rather than inventing.
- **`npm run typecheck` passes.** Strict mode, no `any` in the public surface, no `@ts-ignore`.
- **No runtime dependency is added.** Ever.
- **After any task that touches the render path, re-run the benchmark and append a row to
  [`benchmark-results.md`](benchmark-results.md).** A regression is the only kind of bug that
  matters here. Tasks 21, 22 and 23 all touch it.
- **Verify in a browser, not only in tests.** happy-dom does no layout, so a green suite can sit
  on top of a grid that renders as a blank box.
- **Structural DOM gets stable `data-*` attributes.** State never goes in generated class names.
- **Write the usage snippet before the implementation** for any new public surface. If the
  snippet is awkward, fix the API first.

---

## Phase 6 — Customization (tasks 21–26)

Five of the six extension points a host reaches for exist already: `render`, `headerRender`,
`formatValue`, `options`, `onCellClass`. This phase closes the gaps found by asking the only
question that decides anything here — *if a board author said "colour the overdue rows red",
"give me a date picker", "let me filter by date range", what would I write without reading the
docs?* — and by noticing that one of the six does not work.

**The governing rule for the whole phase: a hook that is not supplied must cost nothing.**
`DataCell` builds a `CellContext` only when `render` or `onCellClass` is set, and every hook
added here has to stay inside that discipline. A grid with no customization must paint exactly
as many cells, allocate exactly as many objects, and mutate exactly as many nodes as it does
today.

**The second rule: extend, do not replace.** Every hook here is additive on top of the built-in
behaviour — classes are appended to the state classes, a custom filter joins the built-in
`"options"` one on other columns, `copyValue` overrides only copy. Nothing added here can put
the grid in a state it could not reach on its own.

### Task 21 — Styling hooks

The class hook exists, at the wrong granularity. Styling one column means writing a grid-level
callback that starts with `if (cell.column.key === "score")`, and styling a *row* — the
commonest ask of the three — has no name at all.

**The snippet, written first**

```js
AVGrid.create(el, {
    rows,
    columns: [
        { key: "status", cellClass: (c) => `status-${c.value}` },
        { key: "score",  cellClass: (c) => (c.value < 50 ? "low" : undefined) },
        { key: "note",   cellClass: "wrap", headerClass: "wrap" },
    ],
    rowClass: (r) => (r.row.overdue ? "overdue" : undefined),
});
```

**Build**
- `Column.cellClass?: string | ((cell: CellContext<R>) => string | string[] | undefined)`.
- `Column.headerClass?: string | ((header: HeaderContext<R>) => string | string[] | undefined)`.
- `AVGridOptions.rowClass?: (row: RowContext<R>) => string | string[] | undefined`, with
  `RowContext = { row, rowIndex, rowKey }` — the cell context minus the column, so a hook that
  is handed one reads like every other hook here.
- All three accept an array as well as a string, because that is what a caller composing
  conditions produces and joining it themselves is a papercut.
- `onCellClass` stays. It is the grid-wide arm of the same idea, it is documented and shipped,
  and the two do not overlap: order of application is built-in state classes → `cellClass` →
  `onCellClass` → `rowClass`, all additive.

**Done when**
- A cell's class list is `avg-data-cell`, the state classes, and then every hook's contribution,
  and a class that stops applying is *gone* on the next paint — pooled cells come back dirty and
  a class left behind is the exact bug the pool invites.
- The context object is still built lazily: a grid with none of these hooks allocates nothing
  per cell.
- **The docs say how to make the class actually win.** Plan 01's last decision row is this trap:
  the stylesheet is injected during `create()`, so it lands *after* the page's `<style>`, and
  `.avg-data-cell` setting `color` is exactly as specific as a bare `.low`. Every snippet here
  writes `.avg-data-cell.low`, and `rowClass` snippets write `.avg-data-cell.overdue`.
- Benchmark: a full repaint of every visible cell with all three hooks set still mutates **0**
  DOM nodes and the flat-cost ratio is unchanged. Append the row.

### Task 22 — Custom cell editors

`editRender` cannot work. It is handed a `CellContext` — value, row, column, indices — and
nothing else, so whatever it draws has no way to record a value, commit it or cancel. Meanwhile
`EditorContext` and `CellEditor` in `EditingModel` are precisely the right interface and are
internal. The task is to make the working one public and delete the broken one.

**The snippet, written first**

```js
{
    key: "due",
    editor: (ctx) => {
        const input = document.createElement("input");
        input.type = "date";
        input.value = ctx.value ?? "";
        input.addEventListener("input", () => ctx.setValue(input.value));
        input.addEventListener("blur", () => ctx.commit());
        return input;
    },
}
```

Returning a bare element is the common case. Return `{ element, focus?, destroy? }` when the
editor owns something beyond it — a picker panel on `document.body`, a listener on the document
— exactly as `CellSelect` does.

**Build**
- `Column.editor?: (ctx: EditorContext<R>) => HTMLElement | CellEditor`, replacing `editRender`.
  `EditorContext` gains `rowIndex` / `colIndex` / `rowKey` so it is a superset of what
  `editRender` received; both it and `CellEditor` are exported from `src/index.ts`.
- **Escape and Tab work without the editor doing anything.** The model binds one `keydown` on
  the editor's element: Escape cancels, Tab commits and passes the key back to the grid, unless
  the editor called `preventDefault()`. Today `CellInput` implements both itself, so a custom
  editor that did not know about `commitAndPass` would trap focus in the cell — and an agent
  will not guess `commitAndPass`. It stays on the context for an editor that wants it.
- **A column with an `editor` opens it, whatever its `dataType`.** `openEdit` currently returns
  early for `dataType: "boolean"`, which is right for the built-in checkbox and wrong for a
  column that supplied its own control.
- Blur policy stays the editor's own — commit-on-blur lives in `CellInput`, not in the model,
  which is what lets a picker take focus without the edit closing under it. Document that; it is
  the non-obvious half of writing one.

**Done when**
- A date-picker editor built from the snippet above reads, writes, commits, cancels, and moves
  on with Tab, with nothing in the grid special-cased for it.
- An editor whose control lives outside the cell (a popover on `body`) is torn down by
  `destroy()` on commit, on cancel, on `grid.destroy()`, and when its row is scrolled out of
  view and the cell is recycled.
- Benchmark: a full repaint while a custom editor is open does **0** DOM mutations and hands
  back the same element, which is task 12's gate re-run against a host-supplied editor.

### Task 23 — Custom filters

The largest of the five. The popover has always been a dispatch point with one arm
(`filterType: "options"`); this gives a host the second one without the host having to know
anything about `Popover`, the filter bar, or persistence.

**The snippet, written first**

```js
const dateRangeFilter = {
    name: "dateRange",
    create: (ctx) => {                       // the popover body; the grid draws Apply / Clear
        const el = document.createElement("div");
        el.innerHTML = `<input type="date" data-from><input type="date" data-to>`;
        return {
            element: el,
            getValue: () => ({
                from: el.querySelector("[data-from]").value,
                to: el.querySelector("[data-to]").value,
            }),
        };
    },
    label: (value) => `${value.from || "…"} – ${value.to || "…"}`,   // the chip's text
    match: (value, row, column) => {                                  // keep the row?
        const v = row[column.key];
        return (!value.from || v >= value.from) && (!value.to || v <= value.to);
    },
};

columns: [{ key: "created", filter: dateRangeFilter }];
```

**Design decisions to hold to**

- **The definition goes on the column as an object, not into a registry.** A registry needs a
  call before `create()`, and *One flat options object, no required call order* forbids that.
  Reuse across columns is a shared `const`, which is what the snippet already shows.
- **The grid draws Apply and Clear.** The body returns `{ element, getValue, focus?, destroy? }`
  and nothing else, so every filter popover in a grid looks and behaves the same and a host
  writes the part only it can write. `ctx.apply(value)` is there for a body that wants Enter to
  apply; `ctx.close()` for one that dismisses itself.
- **`match(value, row, column)` is the only row test, and it is called per row.** No
  `prepare`-style predicate factory: two hooks for one job, and the escape hatch a host actually
  needs is *data*, not another callback — a definition whose `getValue` returns
  `{ from, to, fromMs, toMs }` has done its parsing once and its `match` is two integer
  comparisons. Say so in the docs, because the cost of getting it wrong is a host callback
  inside the 100k-row loop.
- **Persistence is JSON, with the hook to escape it.** The filter's `value` is stored as it
  stands, through the existing `Date`-reviving path; a definition adds `serialize` /
  `deserialize` only if its value is not JSON-shaped. `name` is what is persisted as the
  filter's `type`, and a stored filter whose definition is no longer on the column is dropped
  with a warning rather than silently filtering nothing.
- `filterType` keeps its meaning: `"options"` is still the default, `null` still takes the
  funnel off, and `filter` on a column wins over both.

**Done when**
- The date-range definition above filters, shows a chip reading its `label`, reopens from that
  chip anchored to it, clears from the chip's ✕, survives a reload under `persistFilters`, and
  cascades correctly — an `"options"` filter on another column still offers only the values the
  date range leaves reachable.
- A definition missing `match` (or `label`) fails loudly at `create()` with a message naming the
  column and the missing field, per rule 5 of *Who this API is for*.
- Benchmark: filtering 100,000 rows with a custom `match` costs one repaint and **0** DOM
  mutations, and the measured cost of the callback in the row loop is recorded — the honest
  comparison is against task 15's `+8.7%` for search, not against zero.

### Task 24 — `copyValue`, and the value-precedence table

Copy already agrees with the screen for a rendered cell — `CopyPasteModel.cellText` reduces
`render`'s output to its text. What is missing is the override for when that is the wrong text
(a cell rendering a bar chart, a badge, an icon), and, more importantly, a written statement of
which hook feeds which consumer. `formatValue` currently does four jobs and the docs mention
them in four different places.

**The snippet, written first**

```js
{
    key: "status",
    render: (c) => `<span class="dot ${c.value}"></span>${c.value}`,
    copyValue: (c) => c.value,
}
```

**Build**
- `Column.copyValue?: (cell: CellContext<R>) => any`. Used by ctrl+C, ctrl+X, Copy as… and
  `grid.getSelectionText()` — every path through `CopyPasteModel`, so they cannot disagree.
- One table, in `docs/api.md` and referenced from the column type, giving for each consumer —
  screen, sort, search, filter options, copy, paste — which hook supplies it and in what order.
  Copy becomes `copyValue` → `formatValue` → `displayFormat` → text of `render` → `row[key]`.
- **Paste stays with `validate`**, deliberately: a `pasteValue` hook would be a second place to
  coerce an incoming value, and `validate` already runs on typing, pasting and range-delete
  alike. Record it as considered and declined rather than leaving the asymmetry unexplained.

**Done when** a column whose `render` returns an icon copies text a spreadsheet can use, the
table exists and matches the code in every row, and `CopyPasteModel`'s tests cover the
precedence order top to bottom.

### Task 26 — Custom sorting — `sortValue`

Added after task 24, from a question asked while reviewing it: *a status column should sort by
priority, not alphabetically — can it?* It can, and the answer is worse than it should be.
`Column.rowCompare` has existed since the port and does exactly this; it was documented by one line
in the type block and nothing else, which is why the question came up at all. Task 24's precedence
table now carries the priority snippet, so **the gap left is ergonomics and cost, not capability**.

**The snippet, written first**

```js
const RANK = { critical: 0, high: 1, normal: 2, low: 3 };

columns: [
    { key: "priority", sortValue: (row) => RANK[row.priority] },   // the new hook
    { key: "name", rowCompare: (a, b) => natural(a.name, b.name) }, // still there for the rest
];
```

`sortValue` is the 90% case written the short way: a projection, sorted by the same typed
comparison the grid already applies to numbers, strings, dates and booleans. `rowCompare` stays for
an order that is genuinely pairwise — a natural sort, a locale with options, a tie-break across two
properties.

**Build**
- `Column.sortValue?: (row: R) => any`, ranking below `rowCompare` and above `row[key]`: one more
  row in task 24's precedence table, and it is the *only* line of that table this task changes.
- **Decorate–sort–undecorate.** `Array.sort` calls a comparator O(n log n) times, so a hook read
  inside one runs ~1.7 million times on 100,000 rows. `sortValue` is instead read **once per row**
  into a parallel array, which is sorted and unwrapped — n calls, not n log n. That is the reason
  the hook is worth adding rather than telling a host to write the comparator: it is both shorter
  *and* the fast way round, and a host cannot get the fast way from `rowCompare` at all.
- `RowsModel.sort` is the only place that changes shape. It must keep returning the same array when
  there is nothing to sort, and keep sorting-then-reversing for `"desc"`.

**Done when**
- The priority snippet sorts ascending and descending, and a `sortValue` returning `undefined` for
  some rows puts them at one end rather than scrambling the rest.
- `rowCompare` still wins where both are set, with a test that says so.
- Benchmark: sorting 100,000 rows by `sortValue` against the same order expressed as a
  `rowCompare`, on the board, as alternating pairs — the expected result is that `sortValue` is
  *faster* despite being the higher-level hook, and if it is not, the decoration is not paying for
  itself and the plan changes here rather than silently.
- Task 24's table gains its row; the `dataType` note stays true.

### Task 25 — Customization docs, example, and board

**Build**
- `docs/api.md`: the three class hooks, `editor` (with the popup-editor and blur notes),
  the filter-definition interface, `copyValue`, and the precedence table. `editRender` moves to
  the removed-names table next to the misspellings it already lists.
- `examples/customization.html` — one standalone file doing all of them: status colours from
  `cellClass`, an overdue row from `rowClass`, a date-picker `editor`, a date-range `filter`, a
  `copyValue` on a rendered column, and a priority `sortValue` (task 26). Copy-pasteable whole,
  like the other ten.
- A `CustomizationBoard` under `test-boards/`, scaffolded with `create_board` per
  *Creating a new board*, and its `CLAUDE.md` written once it works.

**Done when** the example has been opened in a browser and driven — every hook exercised by
hand, screenshotted — and `CLAUDE.md`'s *Current state* records what customization now covers.

---

## Decision log

Append here whenever the plan changes during implementation — what changed, and why. The log for
tasks 1–20 is in [`plan-done-01.md`](plan-done-01.md) and is still required reading.

| Date | Task | Decision |
|------|------|----------|
| 2026-08-11 | 21–25 | **Phase 6 planned: customization.** Written before any of it is built, from the five things a board author asks for. Four decisions worth pinning: (a) **`editRender` is removed, not extended** — it received a `CellContext`, so a custom editor could draw a control and had no way to record a value, commit or cancel; `column.editor` receives the `EditorContext` the internal `CellInput`/`CellSelect` already use, which is the interface that works. (b) **A custom filter is an object on the column, not a registered type** — a registry means a call before `create()`, which *One flat options object, no required call order* forbids; reuse across columns is a shared `const`. (c) **The grid keeps drawing Apply/Clear**, so a filter definition writes only the body it alone can write and every popover in a grid still behaves the same. (d) **`match(value, row, column)` is the only row test** — no predicate-factory second hook; a definition that needs its parsing done once puts the parsed form in its own `value`, which is data rather than another callback. |
| 2026-08-11 | 24 | **`pasteValue` considered and declined.** `validate` already coerces an incoming value on typing, pasting and range-delete alike, so a paste-only hook would be a second place to do one job. `copyValue` has no such counterpart because copy is the only direction where a custom `render` leaves the text ambiguous. |
| 2026-08-11 | — | **`plan.md` split.** The port's plan had grown past 650 lines and every task in it was done, so it is archived as `plan-done-01.md` — unedited, and pointed at from here, because its decision log is the project's institutional memory — and `plan.md` restarts at the current phase. The pattern for next time: when a plan's tasks are all ✅, archive it as `plan-done-<nn>.md` and open a new `plan.md` carrying forward the standing rules and a pointer back. |
| 2026-08-11 | 21 | **`ClassValue` accepts an array, and `rowClass` takes a context object rather than `(row, index)`.** The array because a caller composing conditions produces one and `.filter(Boolean).join(" ")` at every call site is a papercut; the context object because every other hook in the library takes one, and `RowContext` is exactly `CellContext` minus the column — a row hook that was handed a column would invite a rule that reads it. |
| 2026-08-11 | 21 | **A constant-string `cellClass` builds no context object.** The laziness rule is per *hook shape*, not per hook: `typeof cellClass === "function"` is what pulls a `CellContext` into existence, so `cellClass: "wrap"` — the common case for a layout class — stays on the allocation-free path. |
| 2026-08-11 | 21 | **`rowClass` allocates a second small object per cell, and that is where the hooks' cost is.** Measured at +0.012–0.015 ms on a full repaint with all four live, 0 DOM mutations, flat ratio 0.96× — accepted rather than optimized. A per-row cache would need a paint generation to invalidate against, which is machinery in the hot path to save 12 µs. Documented as "called once per cell, not once per row" instead. |
| 2026-08-11 | 21 | **The hook cost cannot be measured in blocks.** Timing one configuration for 60 repaints and then the other reported the *bare* grid slower than the hooked one — a full repaint costs ~0.05–0.1 ms and the webview's timer quantizes near 0.1 ms, so block ordering swamps a 12 µs difference. Alternating the two configurations within each of 40 pairs, run twice with the order inside the pair reversed, gives 1.24× and 1.32×. Third instance of this trap after `measureRangeDrag` and the 100k example; benchmark-results.md now states it as a rule. |
| 2026-08-11 | 22 | **`CellEditor.focus` became optional, and the grid adopts a host's element rather than requiring it to know three things.** `adopt()` adds `avg-cell-editor` (which is what positions the element inside the cell — without it a host's editor lays out in flow, the same trap as a cell renderer that forgets `position: absolute`), sets `data-type="cell-editor"` so `GridInteractions` treats its keys and clipboard as a control's, and binds Escape/Tab. It runs over the built-in editors too rather than only the custom path: on those all three steps are no-ops, and having one path is what keeps them no-ops. |
| 2026-08-11 | 22 | **The grid's fallback editor keys test `!isEditing` before `defaultPrevented`.** `preventDefault()` is the documented way for an editor to claim a key, and it is not enough on its own: a `KeyboardEvent` dispatched without `cancelable` — a synthetic one, and every one in the test suite — leaves `defaultPrevented` false however hard the handler before it called `preventDefault`, so `CellInput`'s Tab committed and then the fallback committed again, moving two cells. The edit no longer being open is the signal that always holds. |
| 2026-08-11 | 22 | **A fifth way an edit can end, found by writing task 22's teardown test: eviction.** `releaseCell` fires when the editing cell is *repainted* as a different coordinate, which is not what a long scroll does — the pool **evicts** the element, removes it from the DOM, and hands the new coordinate a different one, so nothing repaints it and nothing noticed. The edit stayed open around a detached element, and a `CellSelect`-style editor would have left its popover on `document.body`. `onViewportScrolled`, called from the scroll listener `GridInteractions` already had, closes it. Pre-existing — it affected the built-in editors identically — and only visible in a browser, because the pool needs real layout to evict anything. |
| 2026-08-11 | 22 | **The eviction check reads the render window, not `element.isConnected`.** The window is recomputed synchronously inside `onScroll`, before the paint that evicts anything, so `rendered.top..rendered.bottom` is both cheap and already correct. The first version waited a frame and looked at the DOM, which made the answer depend on whether the paint's frame had been queued before the check's — it is, some of the time, and the test failed intermittently for exactly that reason. `rendered` rather than `visible`: overscan rows have cells too. |
| 2026-08-11 | 22 | **A boolean column with an `editor` shows a tick, not a checkbox.** Four places decide whether a boolean toggles or opens an editor, and `DataCell` is a fifth that has to agree: the checkbox's press is intercepted by `GridInteractions` and toggles, so leaving the box in place would make the editor unreachable by pointer. Collected into `EditingModel.togglesInsteadOfEditing`, and Space now opens the editor rather than falling through to type-to-edit with a literal `" "` as the value. |
| 2026-08-11 | 23 | **A filter definition is validated at `create()`, and the filter's `type` is taken from the column rather than written.** `validateColumns` checks `name` / `create` / `label` / `match` and names the column and the missing field, because a `match` that is not there filters nothing and a missing `label` draws a blank chip — both silent. And a host writes `{ columnKey, value }` for a custom filter exactly as for a built-in one: `type` is filled in from `column.filter.name`, and a filter that *does* name a type the column is not filtered by is rejected rather than quietly matched by something else. That rejection is what makes a stored filter whose definition has gone fall out through the restore path that already existed — validated one at a time, dropped with a warning, the grid still renders.
| 2026-08-11 | 23 | **A custom value is passed through untouched, in both directions.** `validateFilters` normalizes an `"options"` value — bare values expanded into `{ value, label }` — and must not touch a value whose shape is the definition's; `reviveFilters` likewise skips the ISO-date revival, which assumes an options array. That is what `serialize` / `deserialize` are for, and the board's own range filter needs them for a reason worth recording: `Infinity` does not survive `JSON.stringify`, so its bounds are rebuilt from the two numbers that do.
| 2026-08-11 | 23 | **The two popover bodies are made one internal type, not one class with a branch.** `FilterPopoverBody` — `element`, `focus()`, `measure()`, `destroy()` — is satisfied by `OptionsFilterContent` as it stands and by the new `CustomFilterContent`, so `showFilterPopover` dispatches once and everything after that line is shared: the panel, the flag that lights the funnel, the promise, the teardown. `measure()` is a no-op on the custom body, which is honest rather than lazy: a host's element sizes itself, so the checklist's preferred-height arithmetic has nothing to compute and the popover is left with no explicit size and no resize grip.
| 2026-08-11 | 23 | **Apply is never disabled on a custom body, and that is a decision rather than an omission.** The checklist disables it with nothing ticked because it can see the selection; a `FilterBody` has no change event, and inventing one to grey out a button would put a host callback on every keystroke. Applying a nullish value removes the filter, so the worst a premature Apply can do is Clear.
| 2026-08-11 | 23 | **A host `label` is guarded and untruncated.** Guarded because it runs on the bar's redraw path, where a throw would leave every chip stale rather than one chip wrong — it falls back to the definition's `name`. Untruncated because `MAX_LABEL_CHARS` exists to stop twenty checklist values pushing the other chips off the bar; how long a custom label is was decided by whoever wrote it, and the chip ellipsizes the rest.
| 2026-08-11 | 23 | **`sameFilter` compares a custom value with `JSON.stringify`, not `===`.** `getValue` builds a fresh object every apply, so identity would report every `setFilters` as a change and a host echoing `onFiltersChange` straight back would loop over a 100,000-row filter pass. The stringify comparison is the same one persistence relies on; a value it cannot take falls back to identity.
| 2026-08-11 | 24 | **The precedence table found two documented claims that were false, and one real asymmetry.** Writing the table meant reading each consumer rather than recalling it: `formatValue` was documented as "used for sorting, filtering and clipboard copy" and sorting never reads it — `defaultCompare` compares `row[key]` by its runtime type — and `dataType` was documented as governing "the comparator", which it also does not. Both corrected in the docs and in the type's own docblock, and both now have a test. The asymmetry is deliberate and stays: **copy prefers `formatValue` over `render`, while the screen prefers `render`** — a `formatValue` is already the plain text a spreadsheet wants, so copy takes it rather than parsing markup to find the same string, and a column that wants the rendered text copied now says so with `copyValue`. A comment in `CopyPasteModel` claiming the two orders matched has been fixed, along with the test name that repeated it. |
| 2026-08-11 | 24 | **`copyValue` is *cheaper* than the fallback it overrides — 0.16× on 1,000 cells.** Not because a host callback is fast but because reducing `render`'s output to text costs an `innerHTML` write into a scratch element and a `textContent` read per cell. Second time in this phase that a customization hook came out ahead of the built-in path it replaces, after task 23's `match`; the pattern is that the built-in paths are general and the hooks are specific. |
| 2026-08-11 | 24 | **No `hasCopyValue` in `getState()`.** The snapshot reports `hasRender` / `hasOptions` because both change what a *cell* is on screen, which is what a post-mortem of a rendering complaint needs. A copy hook cannot be the explanation of anything visible, so it would be a field nobody reads. |
| 2026-08-11 | 26 | **Custom sorting is task 26, and it is an ergonomics task rather than a capability one.** Asked while task 24 was in review: can a status column sort by priority? `Column.rowCompare` has done exactly that since the port — the real defect was that it was documented by one line in a type block, which is why the question arose. Task 24's precedence table now carries the priority snippet, so 26 is left with `sortValue`, a projection instead of a comparator. It earns its place on cost as much as on shape: a hook read *inside* a comparator runs O(n log n) times, ~1.7 million on 100,000 rows, and a decorate–sort–undecorate reads it n times — the short way round is also the fast one, and a host cannot get the fast one out of `rowCompare` at all. |
| 2026-08-11 | 26 | **`sortValue` lives on `AVGridData` next to `rowCompare` and shares its change flag.** They are one fact — how the rows are ordered — and the flag is what `RowsModel` reacts to. Keeping them separate would have been the bug the existing direction-only guard already warns about: two columns with a `sortValue` both resolve to the same memorized *value* comparator, so `rowCompare`'s identity does not move and the sort would silently not re-run. The guard in `sortChanged` now compares both. |
| 2026-08-11 | 26 | **Twelve times fewer calls is a wash on a cheap projection, and 2.7× on a real one — and the docs say so.** Decorate–sort–undecorate takes a table-lookup `sortValue` from 10.8 ms to 10.3 ms on 100,000 rows (100,000 calls against 1,209,558 counted), because the wrapper object per row eats almost all of the saving; the same transform takes a projection that lowercases and concatenates from 46.9 ms to 17.5 ms. The plan predicted "faster" and asked for the plan to change if it was not, so the honest answer is recorded rather than the flattering half: it never loses, and it wins in proportion to what the projection does. |
| 2026-08-11 | 26 | **No `sortValue` in the `getState()` column snapshot, same reasoning as `copyValue`.** `sorted` already reports whether a column *is* the sort, which is the question a post-mortem asks; how it orders is the column definition's business. |
