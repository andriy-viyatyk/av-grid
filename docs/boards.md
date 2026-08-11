# Test boards — how to actually run the grid

The unit tests run under happy-dom, which does **no layout**. So a passing test suite says nothing
about whether the grid renders or performs. That is what the boards under `test-boards/` are for:
real browser, real layout, driveable through the Persephone MCP tools.

| Board | What it is for |
|---|---|
| [`RenderGridTest/`](../test-boards/RenderGridTest/CLAUDE.md) | The engine alone, with a stub cell renderer. The 100k-row performance gate. `window.bench` |
| [`AVGridBoard/`](../test-boards/AVGridBoard/CLAUDE.md) | The whole grid: `AVGrid.create()`, inference, sorting, resize, reorder, theming. `window.avg` |
| [`CustomizationBoard/`](../test-boards/CustomizationBoard/CLAUDE.md) | The seven host hooks, and whether the docs are true: 20 pass/fail claims. `window.custom` |

Each board puts its whole harness on one global — `window.bench`, `window.avg`, `window.custom` —
so a session runs without clicking. Each exposes paint timings and pool hit/miss counts, and a
`resetStats()` that isolates a phase.

## Running one

```
npm run build:board                     # each lib/ is a gitignored build artifact
open_board { path: ".../test-boards/AVGridBoard" }
list_pages                              # find editor: "board-view" → pageId
browser_evaluate { pageId, expression: "window.avg.runBenchmark(100000)" }
browser_take_screenshot { pageId }      # verify visually — a11y snapshots hide layout bugs
```

After editing board files, apply the changes with **`board_refresh { pageId }`** — boards do not
auto-reload. After editing `src/`, run `npm run build:board` first.

> **The accessibility tree cannot see layout.** Three separate bugs in this project — a grid
> rendered as a narrow column, a `VirtualList` laid out in flow, a toolbar collapsed to 17 px —
> showed a perfect a11y snapshot and a green benchmark. Screenshot and look.

> **`document.hidden` invalidates every timing.** A backgrounded webview is throttled and
> `requestAnimationFrame` does not run, so anything awaiting a settle helper hangs. Keep the
> window visible while measuring.

## Creating a new board

**1. Read the boards guide first — `read_guide("boards")`.** It is the Persephone MCP
documentation for how boards are built: the sandbox and its offline-first CSP, the
`window.persephone` bridge, the `--p-*` theme contract, and the `browser_*` testing tools. Read it
before writing board files, not after the board fails to load.

**2. Scaffold with the `create_board` MCP tool, then write your files into it.** A board created
that way is **auto-trusted**. Board trust is granted per path, and a board Persephone did not
create renders a trust prompt instead of the page — `browser_evaluate` cannot reach it at all,
which makes a hand-created board folder useless for debugging. `create_board` also refuses a name
that already exists, so create first and populate second.

**3. Add the bundle step.** Each board gets its own `build:board:<name>` script in `package.json`,
chained into `build:board`.

**4. Rewrite the board's `CLAUDE.md` to document it once it works** — what it is for, how to drive
it, and the gotchas it cost to find.

**Add a board for any subsystem that needs eyes on it** — selection, editing, filtering.
