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
| [`docs/api.md`](docs/api.md) | The complete public surface: options, columns, methods, callbacks, filters, keyboard, CSS tokens, DOM contract |
| [`docs/architecture.md`](docs/architecture.md) | The source tree file by file, and the mapping back to Persephone |
| [`docs/capabilities.md`](docs/capabilities.md) | What the grid does today and what each subsystem measures, by subsystem |
| [`docs/invariants.md`](docs/invariants.md) | The three rules below, in full, with what breaking each one cost |
| [`docs/boards.md`](docs/boards.md) | Running and creating the test boards |
| [`tasks/benchmark-results.md`](tasks/benchmark-results.md) | Performance history. **Append a row after any render-path change** |

**There is no active `plan.md`.** Both phases are archived, and phase 7 has not been opened.
A plan is archived as `plan-done-<nn>.md` once all its tasks are ✅; the next `plan.md` starts at
the new phase, carrying forward the standing rules and a pointer back to the logs. **Every archived
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

**The gate holds at 100,000 rows**: first paint ~6 ms, 60 fps at the top and at row 99,000, a
flat-cost ratio around 1.0×, and a full repaint of every visible cell doing **zero DOM mutations**.
Per-subsystem gates and every measured number are in
[`docs/capabilities.md`](docs/capabilities.md).

**Open questions**, neither urgent:

- Whether the `--avg-*` defaults should move to `:root`, so an ancestor's `--avg-*` works. Today an
  ancestor's `--p-*` reaches everything and its `--avg-*` is shadowed — see
  [Theming](docs/capabilities.md#theming).
- What phase 7 is. Nothing is planned past phase 6; open a new `tasks/plan.md` when there is.

## Commands

```
npm test              # vitest, all tests
npm run test:watch
npm run typecheck     # tsc --noEmit, strict
npm run build         # typecheck + vite lib build to dist/ (ESM + UMD) + dist/av-grid.css
npm run build:board   # bundle src/ into each board's lib/
```

Tests sit next to their subject as `*.test.ts`, in the node environment — except
`RenderGrid.test.ts` and `AVGrid.test.ts`, which opt into happy-dom with a per-file
`// @vitest-environment happy-dom` docblock.

## Test boards — how to actually run the grid

happy-dom does **no layout**, so a green suite says nothing about whether the grid renders or
performs. The boards under `test-boards/` are the real browser: [`RenderGridTest/`](test-boards/RenderGridTest/CLAUDE.md)
(`window.bench`, the 100k gate), [`AVGridBoard/`](test-boards/AVGridBoard/CLAUDE.md) (`window.avg`,
the whole grid) and [`CustomizationBoard/`](test-boards/CustomizationBoard/CLAUDE.md)
(`window.custom`, 20 pass/fail claims from the docs).

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
