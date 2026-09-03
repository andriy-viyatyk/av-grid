# AV-Grid

**av-grid** is a dependency-free, framework-agnostic virtualized data grid written in
TypeScript that renders directly to the DOM. It targets **100,000+ rows** with no lag while
scrolling, selecting a range, or editing.

It is a port of the React grid inside **Persephone**, whose virtualization engine is already
framework-free — this project reimplements its rendering layer in plain DOM so the same
performance is available to any plain-JavaScript page. The first consumer is Persephone
Boards, which are written by AI agents; that shapes the API design.

## 🗺 Where everything is

| Read this | When |
|---|---|
| [`tasks/goal.md`](tasks/goal.md) | **Before starting any work.** The goal, success criteria, the architecture being ported, the per-file port status, the API design principles, and **scope** |
| [`tasks/plan-done-01.md`](tasks/plan-done-01.md) | The finished plan for the port, tasks 1–20. **Read its decision log before starting any task** — it records every deliberate divergence from the reference, several reference bugs fixed rather than carried over, and the traps that each cost a debugging session |
| [`tasks/plan-done-02.md`](tasks/plan-done-02.md) | The finished plan for phase 6, customization, tasks 21–26. **Its decision log applies too** |
| [`tasks/plan-done-03.md`](tasks/plan-done-03.md) | The finished plan for phase 7, the Persephone adoption gaps, tasks 27–32. **Its decision log applies too** |
| [`tasks/plan-done-04.md`](tasks/plan-done-04.md) | The finished plan for phase 8, the Persephone consolidation, tasks 33–37. **Its decision log applies too** |
| [`tasks/plan-done-05.md`](tasks/plan-done-05.md) | The finished plan for phase 9, the React wrapper, tasks 38–43. **Its decision log applies too** |
| [`tasks/plan-done-06.md`](tasks/plan-done-06.md) | The finished plan for phase 10, tasks 44–46 and 49–50: the wide-grid gate, pinned columns, `footerRows`, accessibility. **Its decision log applies too** — and it holds the full designs for the deferred tasks 47–48 |
| [`tasks/plan-done-07.md`](tasks/plan-done-07.md) | The finished plan for phase 11, tasks 47–48: `Column.group` (the two-row header) and multi-column sort. **Its decision log applies too** |
| [`tasks/plan-done-08.md`](tasks/plan-done-08.md) | The finished plan for phase 12, tasks 51–52: `externalFilter` / `externalSort` (the host owns the row set) and the built-in `"text"` filter type. **Its decision log applies too** — including the four review resolutions and the loan-ledger patch record |
| [`tasks/plan-done-09.md`](tasks/plan-done-09.md) | The finished plan for phase 13, task 53: `pinned: "left"` as a data column — sticky split from chrome. **Its decision log applies too** — it supersedes the phase-10 equivalence rule |
| [`tasks/plan-done-10.md`](tasks/plan-done-10.md) | The finished plan for phase 14, tasks 54–55: `blank` / `notBlank` on the built-in `"text"` filter (opt-in chips via `textFilterOps`) and `filterLabel`. **Its decision log applies too** |
| [`tasks/plan.md`](tasks/plan.md) | **The active plan** — phase 15, empty; it carries the standing rules and the open questions. Read the archived decision logs before starting anything |
| [`docs/api.md`](docs/api.md) | The complete public surface: options, columns, methods, callbacks, filters, keyboard, CSS tokens, DOM contract |
| [`docs/react-api.md`](docs/react-api.md) | The React API, agent-focused and self-routing: the `<AVGrid>` component and props, the three update lanes, the instance ref, the filter bar, `reactEditor` / `reactFilterBody`. `docs/api.md` stays vanilla-only |
| [`docs/architecture.md`](docs/architecture.md) | The source tree file by file, and the mapping back to Persephone |
| [`docs/capabilities.md`](docs/capabilities.md) | What the grid does today and what each subsystem measures, by subsystem |
| [`docs/invariants.md`](docs/invariants.md) | The three rules below, in full, with what breaking each one cost |
| [`docs/boards.md`](docs/boards.md) | Running and creating the test boards |
| [`docs/releasing.md`](docs/releasing.md) | Cutting a release: `npm version` → push the tag → Actions publishes. **Read before touching the version, the workflow, or `package.json`** |
| [`tasks/benchmark-results.md`](tasks/benchmark-results.md) | Performance history. **Append a row after any render-path change** |

**[`tasks/plan.md`](tasks/plan.md) is the active plan** — phase 15, deliberately empty: it
carries the standing rules and three open questions (control-size tokens for the popovers'
inputs; a grid-level `textFilterOps` default; `textFilterLabels` for the popover's own chips).
(Plan 09's earlier open questions 1–5 were removed at a consumer's request, 2026-09-01 —
handled consumer-side; the git history and the archived logs keep them if re-asked.)
A plan is archived as `plan-done-<nn>.md` once
all its tasks are ✅; the next `plan.md` starts at the new phase, carrying forward the standing rules
and a pointer back to the logs. **Every archived
decision log still applies** — they are read before starting a task, not filed away.

The React implementation being ported is `C:\projects\persephone\src\renderer\uikit\AVGrid\` (grid
behaviour) and `…\RenderGrid\` (the virtualization engine); the supporting modules and what became
of each are mapped in [`docs/architecture.md`](docs/architecture.md#reference-implementation--persephone).

> **Persephone is a read-only reference.** Never modify anything under `C:\projects\persephone`.
> Read from it freely; write only inside `C:\projects\av-grid`.

## 📊 Current state

**The port is done** — tasks 1–20, phases 1–5 — and so is **phase 6, customization** (tasks 21–26):
the class hooks, custom cell editors, custom filter types, `copyValue`, `sortValue`, and the docs,
example and board that cover them. There is a working, fast grid with sorting, filtering, selection,
keyboard navigation, editing, clipboard, a context menu, a filter bar, and full theming.

**Phase 7, the Persephone adoption gaps, is done too** (tasks 27–32, shipped as **2.2.0**): the five
additions Persephone's adoption of the library measured against its own call sites —
`highlightString` (mark words without filtering rows), stable `avg-` **ids on every built-in
context-menu item**, `rowNoun` (what this grid calls a row), `whiteSpaceY` (the trailing slack, now
exposed) and `extraElement` (one host element after the last row). All five are additive: no
existing option default, signature or CSS selector moved.

**Phase 8, the Persephone consolidation, is done as well** (tasks 33–37, shipped as **2.3.0** —
see [`tasks/plan-done-04.md`](tasks/plan-done-04.md)): the keyed cell pool, measured row heights,
the scroll-loss fix, after-paint scrolling, and `setOptions` applying shell layout.

**Phase 9, the React wrapper, is done** (tasks 38–43, shipped as **2.4.0** — see
[`tasks/plan-done-05.md`](tasks/plan-done-05.md)): `av-grid/react` is a subpath export of this same
package, with `react`/`react-dom` as **optional** peer dependencies, so a vanilla install pulls in
neither and `dist/av-grid.js` is unchanged. `<AVGridReact>` is a **thin lifecycle adapter, not a
controlled component**: three update lanes (`rows` → `setRows`; callbacks → stable proxies, never
re-sent; everything else → one diffed `setOptions`), the real instance through `ref`,
`<AVGridFilterBar>` for a bar mounted away from the grid, and **`reactEditor` / `reactFilterBody`**
— adapters that mount a React component as a `Column.editor` or a `FilterDefinition.create`, the
two hooks where a React root is safe (singleton, gesture-opened, explicit destroy; cell *content*
stays DOM, that is the pooling invariant). The component is exported as **`AVGrid`**
(with `AVGridReact` as the alias that cannot collide with the class). See
[`docs/react-api.md`](docs/react-api.md).

**Phase 10, the reporting-consumer features, is done** (tasks 44–46 and 49–50, shipping as
**2.5.0** — see [`tasks/plan-done-06.md`](tasks/plan-done-06.md); tasks 47–48 were deferred to
phase 11 by the author). The wide-grid gate proved the thesis holds sideways — **300 columns
scroll horizontally at a 0.99× flat ratio**, `hidden` costs nothing per hidden column, the filter
pass is row-bound. **`pinned: "left" | "right"`** pins columns positionally (right-pinned columns are data —
sorting, filtering, editing and copying like any column, resize grip on their left edge, reorder
confined to the band; `pinned: "left"` shipped as exactly `isStatusColumn`, an equivalence
**deliberately superseded by task 53** — left-pinned columns are data now too, chrome is
`isStatusColumn` alone). **`footerRows`** pins rows to the bottom through the same columns as the
data and is invisible to everything that treats a row as data — the exclusion list is one test
per line. And the **accessibility claim** is now explicit: keyboard-operable (17/17 board checks,
Alt+↓ opens the filter popover, the Menu key opens the context menu at the focused cell) with
`role="grid"`/`gridcell`/`columnheader`, live `aria-rowcount`/`colcount` and `aria-sort` — but
**not a fully conformant ARIA grid**, because there are deliberately no row elements; sorting has
no keyboard binding and says so. Shipping it fixed one engine defect: a cell migrating between
sticky regions in one paint is no longer evicted by the region losing it.

**Phase 11 is done** (tasks 47–48, shipped as **2.6.0** — see
[`tasks/plan-done-07.md`](tasks/plan-done-07.md)). **`Column.group`** is the two-row header: one
string on the columns that belong together and the band appears — no switch, interleaved columns
gathered stably, reorder off while groups show, pinned columns cannot group. The engine was not
touched: row 0 doubles via a per-row `rowHeight` function, grouped headers shrink to its lower
half, and the band is an `addOverlay(el, "header")` **overlay — one div per group, not pooled
cells**, positioned from the engine's own column geometry (aligned to 0.0 px, zero mutations per
scroll frame, measured). **`multiSort: true`** sorts by several columns — arity follows the
option (`sort`/`getSort()`/`onSortChange` hold arrays only when it is on; the single-column path
is untouched by construction), plain click resets, **Ctrl/Cmd+click appends a level**, position
numbers appear only with 2+ sorted columns, `aria-sort` stays on the primary. The list resolves
to one decorate tuple + one composite comparator, so `sortValue` keeps its once-per-row contract.
Sorting still has **no keyboard binding** — Ctrl+click is a pointer gesture; the gap stays named.

**Phase 12 is done** (tasks 51–52, shipped as **2.7.0** — see
[`tasks/plan-done-08.md`](tasks/plan-done-08.md)). **`externalFilter` / `externalSort`** let a
host that filters and sorts server-side keep the whole filter and sort UI while the grid never
re-filters or reorders the page it was handed — two independent flat booleans, the whole change
two guards in `RowsModel`, measured at 100k rows as 12–17 ms per filter change removed down to
0.2–0.4 ms. `FilterDefinition.match` is optional under the flag (typed `match?:` for everyone,
required-ness enforced at `create()`, re-checked when the flag is toggled off), `searchString`
deliberately stays local (`highlightString` is the server-search pairing), and the docs name the
checklist's exact failure under server-filtered rows — pass `onGetOptions`. **`filterType:
"text"`** is the built-in text filter: one full-width input over three operator chips — contains
/ equals / starts with, radio semantics, Enter applies — matching case-insensitively against the
*displayed* text (the search box's projection), with a public JSON value `{ op, text }` a host
reads to build a server predicate. A bare string normalizes to `contains`; trimmed-empty text is
no filter. The needle lowercases once per pass in `filterRows`' resolved tuple, never per row and
never into the value.

**Phase 13 is done** (task 53, shipped as **2.8.0** — see
[`tasks/plan-done-09.md`](tasks/plan-done-09.md)): **`pinned: "left"` as a data column**,
sticky split from chrome. `isPinnedLeft()` stays the *geometry* predicate (the
sticky band, `data-pinned`, `draggable`, the reorder band hit-test); a new `isChromeColumn()`
(= `isStatusColumn === true`) carries the *behavior* — focus, editing, copy, the funnel, the
resize grip, the context-menu column items, the keyboard clamp (now
`AVGridData.firstDataColumnIndex`, computed beside `lastIsStatusIndex`). So `pinned: "left"`
alone is a sticky, unreorderable, otherwise ordinary data column — the identity-column case —
and validation now enforces left-pinned columns are the **leading** run, mirroring the right.

**Phase 14 is done** (tasks 54–55, shipped as **2.9.0** — see
[`tasks/plan-done-10.md`](tasks/plan-done-10.md)). **`blank` / `notBlank`** are two text-free
*state* operators on the built-in `"text"` filter — *is empty* / *is not empty*, testing the same
displayed text the other three compare, empty after trim, `notBlank` the exact complement. The
**chips are opt-in per column** through `Column.textFilterOps` (default: the three comparisons,
so nothing changed for anyone); the **operators are not** — `{ op: "blank" }` validates and
matches on any text column, and the popover shows an applied op's chip even when the column's
list omits it. `TextFilterValue` is now a union discriminated on `op` (a deliberate compile-time
nudge for strict hosts reading `.text`), the operator table lives once in `src/textFilterOps.ts`,
and the checklist's `(null)` / `(undefined)` entries deliberately stay a different notion of
empty. **`filterLabel`** is the host's word on a filter-bar chip: grid-level, runs for every
filter type after a definition's own `label`, receives the built-in text, `undefined` keeps it,
and `describeFilter()` honours it — the bar now builds every chip from that one resolver. Measured
at 100k: the state operators cost at or under `contains`; no render-path file changed.

**Every piece of grid state is an option, so every piece of it is a prop.** `focus` was the last
one that was not, and it joined them in the same release: `sort`, `filters`, `selected`,
`searchString` and `focus` may all be held in host state and echoed straight back, because each
setter guards on **value** and returns early on no change — which is what makes the round trip
terminate. Those guards are load-bearing; `src/react/AVGridReact.test.tsx` and
`src/model/FocusModel.test.ts` drive the full loop so that removing one fails a test rather than
hanging a consumer. **`isDragging` is the exception**: it belongs to the pointer, and a
host-supplied focus never sets it.

**The gate holds at 100,000 rows**: first paint ~6 ms, 60 fps at the top and at row 99,000, a
flat-cost ratio around 1.0×, and a full repaint of every visible cell doing **zero DOM mutations**.
Per-subsystem gates and every measured number are in
[`docs/capabilities.md`](docs/capabilities.md).

**Open question**, not urgent:

- Whether the `--avg-*` defaults should move to `:root`, so an ancestor's `--avg-*` works. Today an
  ancestor's `--p-*` reaches everything and its `--avg-*` is shadowed — see
  [Theming](docs/capabilities.md#theming).

## Commands

```
npm test              # vitest, all tests
npm run test:watch
npm run typecheck     # tsc --noEmit, strict
npm run build         # typecheck + core lib (ESM + UMD) + dist/react.js + dist/av-grid.css
npm run build:board   # bundle src/ into each board's lib/
```

Tests sit next to their subject as `*.test.ts`, in the node environment — except
`RenderGrid.test.ts`, `AVGrid.test.ts` and `react/AVGridReact.test.tsx`, which opt into happy-dom
with a per-file `// @vitest-environment happy-dom` docblock.

`npm run build` produces the core (`dist/av-grid.js`, `dist/av-grid.umd.cjs`) **and** the React
entry (`dist/react.js` + `dist/react/*.d.ts`) from a second Vite config,
[`vite.config.react.ts`](vite.config.react.ts), which keeps `react` and the core **external** —
the react bundle must never contain a second copy of the grid.

## Test boards — how to actually run the grid

happy-dom does **no layout**, so a green suite says nothing about whether the grid renders or
performs. The boards under `test-boards/` are the real browser: [`RenderGridTest/`](test-boards/RenderGridTest/CLAUDE.md)
(`window.bench`, the 100k gate), [`AVGridBoard/`](test-boards/AVGridBoard/CLAUDE.md) (`window.avg`,
the whole grid), [`CustomizationBoard/`](test-boards/CustomizationBoard/CLAUDE.md)
(`window.custom`, 29 pass/fail claims from the docs) and [`ReactApp/`](test-boards/ReactApp/CLAUDE.md)
(`window.__grid`, the React wrapper under a real React 19 — a Vite dev app, not a board:
`npm run dev` there, then `open_url`; `av-grid` is aliased to `src/`, so **no build step**).

```
npm run build:board                     # each lib/ is a gitignored build artifact
open_board { path: ".../test-boards/AVGridBoard" }
browser_evaluate { pageId, expression: "window.avg.runBenchmark(100000)" }
browser_take_screenshot { pageId }      # a11y snapshots hide layout bugs — look
```

Boards do not auto-reload: apply file edits with **`board_refresh { pageId }`**, and run
`npm run build:board` first after editing `src/`. Full guide, including how to scaffold a new
board so it is trusted: [`docs/boards.md`](docs/boards.md).

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

Everything else is ordinary code. These three are not — each is easy to break with a change that
looks like a cleanup, and breaking any one costs the project its reason to exist. **The full
version, with what each one cost to learn, is [`docs/invariants.md`](docs/invariants.md) — read it
before changing `src/render/` or `src/view/`.**

**1. The scroll offset stays out of `inputChanged()`.** Scrolling goes through
`onScroll → updateRenderInfo(undefined, direction)`, which renders only the newly exposed cells.
Adding the offset "for symmetry" rebuilds every visible cell 60 times a second.

**2. A cell renderer resolves its element in this order:**

```js
const el = p.previous ?? p.recycle?.() ?? document.createElement("div");
```

`previous` is the element already at this coordinate — using it means the paint does **no** DOM
insertion or removal, and focus, an open editor and transitions all survive. `recycle()` comes back
**dirty**, so overwrite every property you set. Dropping `previous` costs ~12× on full repaints and
breaks editing; dropping `recycle` allocates on every scroll frame. Two corollaries:

- **A cell that owns something cannot rely on its own repaint to hear that it lost it** — a long
  scroll *evicts* the element instead of repainting it, and a renderer is never called for that.
  Ask the render window on the scroll.
- **The stylesheet has to position what a renderer returns absolutely**, and anything inserted
  between the host and the grid root must carry the root's `flex: 1 1 auto`. Both failures render
  wrong while every benchmark stays green.

**3. Listeners go on the root, never on a cell.** `GridInteractions` binds ten listeners for the
whole grid and resolves each event by reading `data-row` / `data-col` / `data-column-key` off the
nearest cell. This is a correctness requirement of pooling, not an optimization. So: **state a
handler wants to show goes on the model, not on the element** (a repaint reassigns `className`),
and **an affordance *inside* a cell must be resolved on `pointerdown`, never `click`** — a real
press repaints the cell in between, so the element the press landed on is gone by the time `click`
fires. A test that dispatches all three in one task cannot catch it; there has to be a frame in the
middle.
