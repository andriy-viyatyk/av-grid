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

**[`tasks/plan.md`](tasks/plan.md) — the build order.** Twenty tasks in five phases, each with
a definition of done, plus the settled API decisions and a decision log. Work top to bottom;
task 5 is a hard performance gate.

**Read the decision log at the bottom of `plan.md` before starting a task.** It records every
place the port deliberately diverges from the reference, and why — including several reference
bugs that are fixed rather than carried over.

## 📊 Current state

**Phase 1 (the engine) is complete and the performance gate has passed.** Tasks 1–5 are done;
task 6 (`AVGrid.create()`) is next.

100,000 rows × 20 columns in a real browser: first paint 5.6 ms, 60 fps scrolling at both the
top and row 99,000, zero cell allocations while scrolling, and a **flat-cost ratio of 1.02×** —
the number the whole project exists to produce. Full results and history in
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
        plan.md                  ← the 20-task build order + decision log
        benchmark-results.md     ← performance history; append after render-path changes
    src/
        index.ts                 ← public entry point
        types.ts                 ← public type surface (Column, CellFocus, Filter, …)
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
        RenderGridTest/          ← the 100k-row performance harness
    docs/api.md                  ← API reference (task 19)
    examples/                    ← runnable standalone examples (task 20)
```

Tests sit next to their subject as `*.test.ts`. Everything runs in the node environment except
`RenderGrid.test.ts`, which needs a DOM and opts into happy-dom with a per-file
`// @vitest-environment happy-dom` docblock.

## Commands

```
npm test              # vitest, all tests
npm run test:watch
npm run typecheck     # tsc --noEmit, strict
npm run build         # typecheck + vite lib build to dist/ (ESM + UMD)
npm run build:board   # bundle src/ into test-boards/RenderGridTest/lib/
```

## Test boards — how to actually run the grid

The unit tests run under happy-dom, which does **no layout**. So a passing test suite says
nothing about whether the grid renders or performs. That is what the boards under
`test-boards/` are for: real browser, real layout, driveable through the Persephone MCP tools.

[`test-boards/RenderGridTest/`](test-boards/RenderGridTest/CLAUDE.md) is the performance
harness and the general-purpose debugger. To use it:

```
npm run build:board                     # its lib/ is a gitignored build artifact
open_board { path: ".../test-boards/RenderGridTest" }
list_pages                              # find editor: "board-view" → pageId
browser_evaluate { pageId, expression: "window.bench.runBenchmark()" }
browser_take_screenshot { pageId }       # verify visually — a11y snapshots hide layout bugs
```

After editing board files, apply the changes with **`board_refresh { pageId }`** — boards do
not auto-reload. After editing `src/`, run `npm run build:board` first.

Everything is on `window.bench` (`runBenchmark`, `measurePaintCost`, `measureScrollFps`,
`scrollTo`, `grid`), so a whole session can run without clicking. `grid.stats` and
`grid.pool.stats` expose paint timings and pool hit/miss counts; `grid.resetStats()` isolates a
phase.

**Add a board here for any subsystem that needs eyes on it** — selection, editing, filtering.
Rewrite each board's `CLAUDE.md` to document that board once it works.

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

## Two invariants that carry the performance

Everything else is ordinary code. These two are not — both are easy to break with a change
that looks like a cleanup, and breaking either one costs the project its reason to exist.

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
