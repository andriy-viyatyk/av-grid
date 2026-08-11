# av-grid on a Persephone board

A board that runs the grid with the app's own theme, filters that survive a reload, and a
board-supplied context-menu item. **There is no theming code in it** — that is the point.

## Install it

A board folder is not trusted just for existing: a board Persephone did not create renders a
trust prompt instead of the page. So scaffold one and copy these files into it, rather than
opening this folder directly.

```
create_board { name: "av-grid-board", dir: "<somewhere>" }   → { boardRoot }
```

Then, into `boardRoot`:

1. Copy `index.html`, `app.js`, `style.css` and `board-manifest.json` from here, **keeping the
   scaffolded `board-base.css`** — it is already linked by `index.html` and carries the `--p-*`
   defaults (page background, text, monospace font, themed scrollbars, themed focus ring).
2. Build the library and vendor it in — a board is offline-first and its CSP blocks remote
   network, so a CDN URL fails silently:

   ```
   npm run build                      # in the av-grid repo
   mkdir <boardRoot>/lib
   copy dist/av-grid.js   <boardRoot>/lib/
   copy dist/av-grid.js.map <boardRoot>/lib/
   ```

   The stylesheet does **not** need copying: the grid injects it on first use. Pass
   `injectStyles: false` and copy `dist/av-grid.css` instead if you would rather link it.

3. `open_board { path: boardRoot }`, then `board_refresh { pageId }` after any later edit —
   boards do not auto-reload.

## What to look at

**The theme.** Press `Ctrl+Alt+]` / `Ctrl+Alt+[` to cycle Persephone's themes with the focus
inside the board. The grid re-tints — header band, grid lines, selection, the filter chips, the
popovers — and `grid.render.stats.paints` does not move. Every `--avg-*` token falls back to its
`--p-*` counterpart, Persephone injects those on `<html>` before the first paint, and nothing in
the library reads a colour, so the browser does all of it.

`style.css` contains not one `--avg-*` override. Override one only where you want the grid to
differ from the app deliberately.

**The host's height.** `.grid-host` carries `flex: 1 1 auto; min-height: 0`. Without
`min-height: 0` a flex item refuses to shrink below its content and the grid grows the page
instead of scrolling inside it.

**`persist_filters` across a reload.** Filter a column, hit Reload, and the chip is still there.
A board reload is a real page load, so this is the difference between the user's filters
surviving it and not.

**`persephone.onThemeChange`** is at the bottom of `app.js` and the grid does not need it. It is
what a chart or a canvas next to the grid would use — anything coloured from JavaScript has to
re-read the palette on every fire and must never cache it across a switch.

## Driving it as an agent

```
list_pages                                    # editor: "board-view" → pageId
browser_evaluate { pageId, expression: "window.grid.getState()" }
browser_take_screenshot { pageId }             # a11y snapshots hide layout bugs
```

`ui.log` in the board folder is the black box: CSP violations, uncaught errors and every
`console.error` / `console.warn` land there. Read it first if the board renders blank.
