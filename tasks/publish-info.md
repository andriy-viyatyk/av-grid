# Publishing av-grid — name research and release notes

Research done **2026-08-08**, before publication. Everything here is a snapshot: npm and
GitHub state can change, so **re-verify the availability checks before you actually publish**
(commands are given below so you can re-run them in a minute).

Nothing in this document is decided yet. It exists so the name question does not have to be
researched twice.

---

## Summary

**The name `av-grid` is free of third-party conflicts — because you already own it.**

There is no competing `av-grid` package, project, or library. The only occupant of the name on
both npm and GitHub is your own 2021 React grid, the ancestor of the component being ported.

The one genuine risk is **confusability with AG Grid**, not ownership. See *The ag-grid
problem* below.

---

## What already exists under this name

### npm — `av-grid`

| Field | Value |
|-------|-------|
| Latest version | **1.0.5** |
| Published | 6 Feb 2021 |
| Description | "React Grid Component" |
| Author / maintainer | `viyatyk` — your own npm account |
| Repository | `git+https://github.com/andriy-viyatyk/av-grid.git` |
| Homepage | `https://github.com/andriy-viyatyk/av-grid#readme` |
| License | MIT |
| Dependencies | `react-resize-aware ^3.1.0` |
| Peer dependencies | `react ^16.0.0` |

This is the early React grid — sticky rows and columns, custom cell rendering, virtual
scrolling. The direct ancestor of Persephone's `AVGrid`, which is what this project ports.

### GitHub — `andriy-viyatyk/av-grid`

| Field | Value |
|-------|-------|
| Visibility | **Private** |
| Last push | 6 Feb 2021 |
| Stars | 0 |
| Archived | No |
| Description | *(empty)* |

**The repo name is occupied by your own private repo.** Before reusing it, open it and decide
whether anything inside is worth keeping — this research did not inspect its contents. Options:
make it public and replace the contents, rename the old repo to something like `av-grid-react`
and create a fresh `av-grid`, or publish the new library under a different repo name entirely.

### Other names checked

`avgrid` (no hyphen) — **available on npm.** Note it does not solve the ag-grid problem below.

---

## The ag-grid problem — the one real risk

`av-grid` and [`ag-grid`](https://www.ag-grid.com/) differ by a single character, and AG Grid is
the most prominent JavaScript data grid in existence.

This is not hypothetical. A web search for `"av-grid" javascript library data grid` returned
**exclusively AG Grid results**, and the search engine stated outright that the query probably
meant ag-grid, offering to search again "if you were looking for a different library called
av-grid."

**Why it matters for this project specifically.** Success criterion 6 in
[`goal.md`](goal.md#success-criteria) is that an agent which has never seen av-grid can guess
the API from convention. An agent that half-remembers `av-grid` as `ag-grid` will confidently
write AG Grid's API — `columnDefs`, `rowData`, `new agGrid.createGrid(el, gridOptions)` — which
is a *plausible, wrong* API rather than an obvious failure. Silent wrongness is the expensive
kind.

**Why it is smaller than it first looks.** In the boards workflow an agent does not choose the
library from memory. The `boards-assets/manifest.json` entry tells it exactly what to vendor,
and the board folder carries `docs/api.md` and the examples. The confusion window is API
*recall*, not library *selection* — and that window is covered by files you ship.

### If you keep the name, do these two things

1. **State it in the docs.** A line near the top of `docs/api.md`: *"av-grid is not AG Grid. It
   shares no API with it."* An agent that half-remembers will otherwise fill gaps from the more
   famous library. This belongs in the API-docs task.
2. **Keep the UMD global `AVGrid`** — capital V, visually distinct from AG Grid's `agGrid`.
   Already set in `vite.config.ts` (`build.lib.name`).

---

## Alternative names

All confirmed **available on npm as of 2026-08-08** — re-check before relying on any of them:

- `megagrid`
- `swiftgrid`
- `bigrid`
- `nanogrid`
- `persephone-grid`

Taken, for the record: `turbogrid`, `fastgrid`, `gridflow`.

If choosing among these: `swiftgrid` reads best as a general-purpose library; `persephone-grid`
is the option if you are happy tying the name to the ecosystem.

### The case for keeping `av-grid`

- You own it on both npm and GitHub — no negotiation, no squatting risk.
- "AV" is your initials; it is your brand across Persephone.
- Persephone's own source calls the component `AVGrid` throughout, so the name keeps the two
  codebases legible to each other.
- **The rename cost is rising.** The name is already in `src/`, `package.json`,
  `vite.config.ts`, the build scripts, the test boards, and the task docs. If this is going to
  change, changing it early is much cheaper than changing it late.

---

## Distribution

### The path is npm → jsDelivr

Persephone boards vendor components from jsDelivr, which serves directly from npm. Compare the
existing Tabulator entry in `C:\projects\persephone\boards-assets\manifest.json`:

```
https://cdn.jsdelivr.net/npm/tabulator-tables@6.5.1/dist/js/tabulator.min.js
```

Publishing to npm therefore makes this work with no separate hosting:

```
https://cdn.jsdelivr.net/npm/av-grid@2.0.0/dist/av-grid.js
https://cdn.jsdelivr.net/npm/av-grid@2.0.0/dist/av-grid.css
```

unpkg (`unpkg.com/av-grid@2.0.0/dist/…`) works the same way. **There is no "components server"
to publish to separately — npm is it.**

Remember the board CSP forbids remote network access: a board cannot load a CDN `<script>`.
The CDN URL is where an *agent* downloads the file from, to vendor it into the board folder as
a local frozen copy. Reference it from the board with a relative path (`lib/av-grid.js`).

### Version number

**Publish as `2.0.0`, not `1.1.0`.** npm requires the new version to exceed the existing
1.0.5, and this is a different library under the same name: no React, an entirely new API.
A major bump is both required and honest. `package.json` currently reads `0.0.0`.

---

## Pre-publish checklist

Re-verify the state of the world first — these are cheap:

```bash
# Does anyone else hold the name now? 404 = free, 200 = taken
curl -s -o /dev/null -w "%{http_code}\n" https://registry.npmjs.org/av-grid

# Full metadata for whatever is published today
curl -s https://registry.npmjs.org/av-grid/latest

# Your own repo's current state
gh repo view andriy-viyatyk/av-grid --json name,visibility,pushedAt,isArchived,stargazerCount
```

Then, before `npm publish`:

- [ ] Name decision made and recorded in the decision log in [`plan.md`](plan.md)
- [ ] "not AG Grid" line present in `docs/api.md` (if keeping `av-grid`)
- [ ] Version set to `2.0.0` in `package.json` (currently `0.0.0`)
- [ ] `repository`, `homepage`, `bugs` fields added to `package.json` — npm and jsDelivr both
      surface them, and the 1.0.5 entry already sets the precedent
- [ ] `files` array correct so only `dist/` ships (already set)
- [ ] `dist/av-grid.js`, `dist/av-grid.umd.cjs`, `dist/av-grid.css` and the `.d.ts` files all
      present after a clean `npm run build`
- [ ] The old React README replaced — the npm page will otherwise describe a React component
- [ ] GitHub repo decision made (reuse the private one, rename it, or use a new name)
- [ ] Repo made public, with a license file (MIT, matching `package.json` and the 1.0.5 entry)
- [ ] `npm publish --dry-run` reviewed — check the file list and the resulting tarball size
- [ ] After publishing: confirm the jsDelivr URLs resolve, then add an av-grid entry to
      `C:\projects\persephone\boards-assets\manifest.json` following the Tabulator entry's
      shape (`id`, `name`, `purpose`, `homepage`, `npm`, `testedVersion`, `vendor`, `skin`)

### Note on the boards-assets entry

av-grid is a **first-party** component, unlike the vendored third-party ones. Its manifest entry
will not need a separate `skin` file — the grid reads the `--p-*` palette natively through its
own `--avg-*` variables (see the theming contract in [`goal.md`](goal.md#theming-contract)), so
there is no stylesheet to tune. Say that explicitly in the entry's `cssVsJs` field, because
every other entry in that manifest has a skin and an agent will look for one.

Consider also whether the Tabulator entry should gain a line pointing at av-grid for large
datasets. Tabulator keeps grouping and tree data, which av-grid does not have; av-grid's
differentiator is scale. An agent picking between them needs that sentence — the "Excel viewer"
board chose Tabulator for a 100k-row file because nothing told it otherwise.
