# ReactApp — the `av-grid/react` wrapper, in a real browser

The visual check and driving harness for **the React wrapper** (tasks 38–43 of
[`plan-done-05.md`](../../tasks/plan-done-05.md)): `<AVGrid>` as a component, the three update
lanes, the controlled round trips (`sort`, `filters`, `selected`, `searchString`, `focus` held in
`useState` and echoed straight back), inline callback props, the detached `<AVGridFilterBar>`, the instance ref (`scrollToRow`,
`copySelection`, `clearFilters` wired to buttons), and the two React-in-the-grid adapters:
`reactEditor` is the city column's editor and `reactFilterBody` is the score column's filter
(`g.showFilterPopover("score")` opens it programmatically).

**This is a Vite app, not a Persephone board** — the wrapper needs a real React under it, so it
runs on a dev server and is opened by URL. It found the `isDragging` echo bug that happy-dom
could not (`src/react/AVGridReact.test.tsx` documents why), so drive it whenever a change touches
`src/react/` or a state round trip.

## Run it

```
cd test-boards/ReactApp
npm install        # first time only
npm run dev        # http://localhost:5199, strict port
```

Then open it in the Persephone browser:

```
open_url { url: "http://localhost:5199" }
browser_take_screenshot { pageId }        # a11y snapshots hide layout bugs — look
```

**`av-grid` is aliased to `../../src`** (see [`vite.config.ts`](vite.config.ts)), so edits to the
library source hot-reload into the app with **no build step** — no `npm run build:board`, no
tarball, no reinstall. The packaged entry points (`dist/react.js`, the `exports` map) are
exercised separately by [`examples/12-react.html`](../../examples/12-react.html).

## Driving it

The app exposes two handles for an agent:

- **`window.__grid`** — the live `AVGrid<Row>` instance (the same object the ref yields; null
  until mounted, and StrictMode remounts once in dev, so read it fresh per evaluate).
- **`window.__log`** — every `console.error`/`console.warn`/uncaught error since before React
  booted, as `[level, message]` pairs. **Check it after every interaction** — a React warning
  (a loop, a bad prop) lands here, not in the page.

Every control carries a stable id: `btn-rows-10k`, `btn-rows-100k`, `btn-rows-mutate`,
`chk-editable`, `chk-borders`, `inp-rowheight`, `inp-search`, `btn-scroll`, `btn-copy`,
`btn-clear-filters`, `btn-rerender`, plus the `#stats` line (row count, edit count, focus).

```js
// The shape of a round-trip check: interact, settle, then read both sides.
browser_evaluate { pageId, expression: `(async () => {
    window.__grid.focusCell(5, 1);
    await new Promise(r => setTimeout(r, 50));
    return {
        grid: window.__grid.getFocus()?.rowKey,
        stats: document.getElementById("stats").textContent,
        log: window.__log,
    };
})()` }
```

What must stay true, whatever else changes:

- **A round trip settles in one pass** — moving the focus/sort/filters produces exactly one
  callback and one re-render, never a loop. `#btn-rerender` proves a forced render sends nothing
  to the grid (`__log` stays empty, the grid does not repaint).
- **A plain click leaves `isDragging: false`** — the regression the browser caught. A real
  press–move–release must stay armed mid-gesture and release to false.
- **Inline callbacks fire the newest closure** — edit a cell after `#btn-rerender`; the edit
  count must keep climbing.
- **`node_modules/` is gitignored; the app source is not** — this folder is checked in.
