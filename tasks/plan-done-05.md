# av-grid — Implementation Plan 05: the React wrapper — `av-grid/react` (tasks 38–43)

**Done.** Phase 9, shipped as 2.4.0. One deliverable: an official React wrapper, published as a **subpath export
`av-grid/react`** of this same package, so a React application writes `<AVGridReact rows={rows} …/>`
and gets the real grid — same instance, same performance, same options — with React owning nothing
but the mount point.

**Why now:** the first consumer is a React 19 + TypeScript + Vite SPA that needs exactly what this
grid is for — large datasets with Excel-like range selection and copy/paste. Today that consumer
would have to hand-roll the create/destroy/diff glue; every future React consumer would re-derive
the same ~200 lines and re-hit the same traps (StrictMode double-mount, callback identity). The
wrapper is library work, so it lives here.

**How to use this document:** work one task at a time, top to bottom. A task is finished only when
every line in its **Done when** list is true. Update the **Status** column as you go, and record
any decision that changes the plan in *Decision log* at the bottom rather than silently diverging.

**Before starting any task here, read the decision logs in
[`plan-done-01.md`](plan-done-01.md), [`plan-done-02.md`](plan-done-02.md),
[`plan-done-03.md`](plan-done-03.md) and [`plan-done-04.md`](plan-done-04.md).** They record every
deliberate divergence from the Persephone reference and the traps that each cost a debugging
session. Two are directly relevant to this phase:

- *"A controlled-props compatibility layer"* (plan 03, out of scope) — Persephone explicitly
  decided **against** emulating controlled React props over this library's imperative instance.
  That decision binds this wrapper too: `AVGridReact` is a **thin lifecycle adapter, not a
  controlled component**. Options flow down; state changes come back through the existing
  callbacks; a host that wants control uses the instance's getters/setters through the ref.
  Do not add `sort={…}` / `selection={…}` controlled props "while we're here".
- *"One flat options object, no required call order: anything you can pass to `create()` you can
  pass to `setOptions()` later, and the two run the same code"* (docs/api.md) — this is the load-
  bearing property the whole wrapper design leans on. If a future option ever breaks it, the
  wrapper breaks with it; the wrapper's tests should pin it.

## Ground rules (standing, carried forward)

- **The core stays dependency-free.** `react` and `react-dom` enter `devDependencies` (to build
  and test the wrapper) and `peerDependencies` marked **optional** via `peerDependenciesMeta` —
  never `dependencies`. A vanilla consumer must see zero change: same install footprint, same
  `dist/av-grid.js`, no React reachable from the core entry.
- **Everything is additive.** No existing option, signature, default, CSS selector or dist
  filename moves. This ships as a **minor** version (2.4.0) per [`docs/releasing.md`](../docs/releasing.md).
- **Persephone is a read-only reference** (`C:\projects\persephone`) — read freely, write only
  inside `C:\projects\av-grid`. Its old React `AVGrid` component is **not** the model for this
  wrapper: it was a controlled component, which plan 03 already rejected. Reference it only to
  see what a React consumer plausibly wants exposed.
- **No consumer names in this repo.** This is a public open-source package; motivate features by
  shape ("a React 19 + Vite SPA"), never by naming a private consumer's product or organization.

---

## Task tracker

| # | Task | Status |
|---|------|--------|
| 1–20 | The port | see [`plan-done-01.md`](plan-done-01.md) — ✅ Done |
| 21–26 | Customization | see [`plan-done-02.md`](plan-done-02.md) — ✅ Done |
| 27–32 | The adoption gaps | see [`plan-done-03.md`](plan-done-03.md) — ✅ Done |
| 33–37 | Persephone consolidation | see [`plan-done-04.md`](plan-done-04.md) — ✅ Done |
| 38 | Package plumbing: the `av-grid/react` subpath build | ✅ Done |
| 39 | `AVGridReact` — the component | ✅ Done |
| 40 | The instance ref | ✅ Done |
| 41 | `AVGridFilterBar` — the detached filter bar companion | ✅ Done |
| 42 | Tests | ✅ Done |
| 43 | Docs, example, release | ✅ Done |

Status values: ⬜ Not started · 🟡 In progress · ✅ Done · ⏸️ Blocked (say why).

---

## Task 38 — Package plumbing: the `av-grid/react` subpath build

New source folder `src/react/` with its own entry (`src/react/index.ts`), built to
`dist/react.js` (+ `dist/react.d.ts`), exposed as the `./react` subpath export.

**The one real trap in this task — do not bundle a second copy of the core.** The react entry
imports the core (`AVGrid`, option types). If Vite bundles those imports, a consumer importing
both `av-grid` and `av-grid/react` ships the grid twice — and worse, gets two module instances
whose injected stylesheets and `instanceof` checks disagree. The react bundle must **externalize
the core** and import it at runtime from the sibling dist file:

- In `src/react/`, import the core through the package self-reference (`import { AVGrid } from
  "av-grid"` — Node and Vite resolve a package's own name via its `exports` map) **or** via a
  relative import that the build config rewrites; prefer the self-reference, it needs no rewrite.
- In the react build config, mark `react`, `react-dom`, `react/jsx-runtime` and `av-grid` as
  `external`, and map `av-grid` to `./av-grid.js` in the output so the published file carries a
  working relative import (`rollupOptions.output.paths` or `resolveId`).
- **ESM only.** No UMD for the react entry — React consumers have bundlers; a UMD build would
  drag in the externals question for no user.
- Vite lib mode takes one entry per config: either a second config file
  (`vite.config.react.ts`) chained in `npm run build`, or one config switched by env/mode.
  Either is fine; keep `npm run build` as the single command that produces everything.

`package.json` changes:

```jsonc
"exports": {
    ".": { /* unchanged */ },
    "./react": {
        "types": "./dist/react.d.ts",
        "import": "./dist/react.js"
    },
    "./av-grid.css": "./dist/av-grid.css"
},
"peerDependencies": { "react": ">=18", "react-dom": ">=18" },
"peerDependenciesMeta": {
    "react": { "optional": true },
    "react-dom": { "optional": true }
}
```

`react >=18` because the wrapper needs nothing newer than refs + effects; test against 19, do not
artificially exclude 18. TypeScript: `tsconfig.build.json` must emit `dist/react.d.ts`; the
wrapper is `.ts`/`.tsx` — if `.tsx`, add `"jsx": "react-jsx"` scoped so the core's typecheck is
untouched (the component renders one `<div>`; `createElement` in plain `.ts` is acceptable and
avoids the jsx config entirely — implementer's choice, record it).

**Done when:**

- [x] `npm run build` produces the unchanged core artifacts **plus** `dist/react.js` +
      `dist/react.d.ts`, and `dist/react.js` contains **no copy of the core** — grep it for a
      core-only identifier (e.g. `FocusModel`) and find nothing; its imports are `react`,
      `react-dom` (if used) and `./av-grid.js`.
- [~] `dist/av-grid.js` and `dist/av-grid.umd.cjs` **do** mention React nowhere — checked. They
      are *not* byte-identical to a pre-task build, because two additive core changes the wrapper
      needed landed in them: `CALLBACK_OPTION_KEYS` and the `setOptions` explicit-`undefined`
      rule. See the decision log. Nothing existing moved.
- [x] A scratch Vite app can `npm install <packed tarball>` and import both `av-grid` and
      `av-grid/react` with working types and exactly one grid module instance.
- [x] `npm run typecheck` and `npm test` stay green.

## Task 39 — `AVGridReact` — the component

The component itself: `<AVGridReact<R> rows={rows} columns={columns} onEdit={…} className style />`
— props are **`AVGridOptions<R>`** plus `className`/`style` for the host element.

Design, pinned:

- **Host element.** The component renders one `<div>` (the host), `className`/`style` applied to
  it. The grid fills the host; the host's size is the consumer's business — document that it
  needs a height, exactly as `AVGrid.create` does.
- **Mount/unmount.** `useLayoutEffect` (not `useEffect` — the grid measures its host; create
  before paint) with an empty dep array: `AVGrid.create(hostEl, initialOptions)` on mount,
  `grid.destroy()` in the cleanup. **StrictMode-safe by construction:** React 19 dev
  double-invokes mount→cleanup→mount; `destroy()` is already tested leak-free over 100 cycles
  (plan 01), so nothing special is needed — but the test in task 42 must prove it.
- **Updates — three lanes, diffed per render in one effect:**
  1. `rows`: on reference change → `grid.setRows(rows)` (keeps scroll, no teardown).
  2. **Callbacks (`on*` keys): never diffed, never re-sent.** At create time the wrapper passes
     **stable proxies** — one per callback option, each reading the latest prop from a ref
     (`callbacksRef.current.onEdit?.(e)`, preserving the return value: several callbacks are
     cancelable via `false`). The consumer may then write inline arrow props with no
     re-`setOptions` churn and no stale-closure bugs. The set of callback keys must be a
     **static exported list, not an `on` prefix heuristic** — add
     `export const CALLBACK_OPTION_KEYS = [...] as const` (typed `readonly (keyof
     AVGridOptions<never>)[]`, or a satisfies-checked equivalent) **to the core** next to
     `AVGridOptions` in `src/options.ts`, so it cannot drift from the type. Additive, tiny, and
     it keeps the wrapper honest. Current members (verify against `options.ts` at implementation
     time): `onSelectionChange`, `onEdit`, `onInvalidEdit`, `onAddRows`, `onDeleteRows`,
     `onAddColumns`, `onDeleteColumns`, `onGetOptions`, `onSortChange`, `onFiltersChange`,
     `onColumnResize`, `onColumnsReorder`, `onColumnsChange`, `onVisibleRowsChange`,
     `onFocusChange`, `onCellClick`, `onCellDoubleClick`, `onCellContextMenu`,
     `onGridContextMenu`, plus the class hooks **if** they are treated as callbacks — see the
     open decision below.
  3. Everything else: shallow-compare (`Object.is`) against the previous render's props, collect
     changed keys, one `grid.setOptions(changedPartial)` per commit. Keys that disappeared from
     the props are sent as `undefined` (resetting to default) — pin this in a test, it is the
     behavior a React user expects from removing a prop.
- **Open decision for the implementer (record in the log):** the four class hooks
  (`rowClass`/`cellClass` variants, `onCellClass` etc.) and per-column function fields sit on the
  paint path. Routing the *option-level* hooks through latest-ref proxies is correct and free;
  per-column functions live inside the `columns` array and are covered by lane 3's reference
  diff. Decide whether class hooks join `CALLBACK_OPTION_KEYS` (recommended: yes — same identity
  problem, and a stale class hook is a subtle bug) and say why.
- **`children` is not accepted.** The grid owns its DOM; React-rendered cell content (JSX
  renderers via portals into pooled cells) is **explicitly out of scope for this phase** — it is
  the one genuinely hard integration (portal lifecycle vs element pooling) and no consumer needs
  it yet. Custom `render`/`editor` hooks keep working as documented: they are vanilla-DOM
  factories and flow through like any option.

**Done when:**

- [x] The scratch Vite app from task 38 renders a 100k-row grid through `<AVGridReact>`;
      scrolling, range selection, Ctrl+C and editing all behave identically to example 09.
- [x] Changing the `rows` prop keeps scroll position; changing e.g. `readonly` repaints without
      recreating the instance (`getState()` identity or a `create` spy proves no teardown).
- [x] An inline `onEdit={…}` prop re-created every render triggers **zero** `setOptions` calls,
      and the *latest* closure fires (task 42 pins both).
- [x] `CALLBACK_OPTION_KEYS` exists in the core, is exported from the root entry, and a type-level
      check fails compilation if a new `on*` option is added to `AVGridOptions` without being
      classified.

## Task 40 — The instance ref

Expose the real `AVGrid<R>` instance through the component's `ref` (React 19 ref-as-prop; no
`forwardRef` needed on 19 — but the wrapper claims `>=18`, so use `forwardRef` if that is what
keeps 18 working, and note it). `ref.current` is `AVGrid<R> | null` — null before mount and after
unmount, the instance in between.

Expose the **real instance, not a facade**: every documented method (`getSelection`,
`copySelection`, `setFilters`, `scrollToRow`, …) is already the public API; wrapping it in a
second surface would drift. The docs (task 43) show the pattern:

```tsx
const gridRef = useRef<AVGrid<Row>>(null);
<AVGridReact ref={gridRef} rows={rows} … />
<button onClick={() => void gridRef.current?.copySelection("copyWithHeaders")} />
```

**Done when:**

- [x] `ref.current` is the instance after mount, `null` after unmount, correctly typed generic.
- [x] Calling a mutating method through the ref (e.g. `setFilters`) does not fight the prop diff:
      document (and pin in a test) that imperative state changes report back through callbacks
      and are **not** reverted by the next render, because the wrapper diffs its own previous
      props, not the grid's live state. This is the "thin adapter, not controlled component"
      rule made mechanical.

## Task 41 — `AVGridFilterBar` — the detached filter bar companion

`AVGrid.createFilterBar(container, { grid, className?, name? })` already supports mounting the
filter bar away from the grid. Wrap it: `<AVGridFilterBar grid={gridInstance} className name />`.

The ordering problem to solve deliberately: the natural consumer writes both components as
siblings, and the grid instance does not exist until `AVGridReact` mounts — so on the first
render the `grid` prop is `null`. Accept `grid: AVGrid<R> | null | undefined`, render the host
`<div>` always, create the bar in an effect **when `grid` becomes non-null**, destroy on cleanup
or when `grid` changes identity. The consumer holds the instance in state, set once from a ref
callback or a `useState` + ref pattern — show this verbatim in the docs, it is the one
non-obvious line:

```tsx
const [grid, setGrid] = useState<AVGrid<Row> | null>(null);
<AVGridFilterBar grid={grid} />
<AVGridReact ref={setGrid} rows={rows} … />   // ref callback → state → re-render → bar mounts
```

(Verify `createFilterBar`'s return contract for the teardown call — whatever it returns/needs is
what the effect cleanup uses; if it has no teardown today, that is a core gap to close first,
additively.)

**Done when:**

- [x] Filter bar renders detached from the grid, filters apply, chips appear/remove; unmounting
      the bar leaves the grid working; unmounting the grid then the bar throws nothing.
- [x] The null-first-render sequence above works untouched from the docs.

## Task 42 — Tests

`src/react/AVGridReact.test.tsx`, happy-dom per-file docblock (the pattern of `AVGrid.test.ts`),
React's own `act`/test renderer or `@testing-library/react` (devDependency; implementer's choice,
record it). happy-dom does no layout, so these are lifecycle/contract tests, not paint tests —
the browser check lives in task 43's example.

Minimum set, each pinning a decision from tasks 39–41:

- [x] **StrictMode:** mount inside `<StrictMode>` → exactly one *live* instance; the
      double-mount's first instance was destroyed; no warning output.
- [x] **Unmount destroys:** `destroyed: true` via the captured instance's `getState()`.
- [x] **Rows lane:** new `rows` reference → `setRows` (spy), no `create`, no `setOptions`.
- [x] **Diff lane:** changing one scalar option → one `setOptions` with exactly that key;
      removing a prop sends `{ key: undefined }`.
- [x] **Callback lane:** re-rendering with a new inline `onEdit` → zero `setOptions`; committing
      an edit fires the **latest** closure; a canceling callback's `false` still cancels through
      the proxy.
- [x] **Ref:** instance after mount, null after unmount; imperative `setFilters` via ref is not
      reverted by an unrelated re-render.
- [x] **Filter bar:** null-then-instance `grid` prop mounts the bar once; cleanup on unmount.
- [x] **Compile-time:** `CALLBACK_OPTION_KEYS` exhaustiveness check (a new unclassified `on*`
      option fails `npm run typecheck`).

**Done when:** all of the above exist and `npm test` + `npm run typecheck` are green, with the
core's existing suites untouched.

## Task 43 — Docs, example, release

- **`docs/react.md`** — the wrapper's page: install (peer deps), the minimum call, the three
  update lanes in one table, the ref pattern, the filter bar pattern, the "thin adapter, not
  controlled component" statement with the plan-03 pointer, theming (nothing React-specific:
  set `--p-*` on an ancestor, exactly as [Theming](../docs/capabilities.md#theming) says), and
  the explicit non-goals (JSX cell renderers/portals, controlled props, SSR).
- **README** — a short "React" section under Install: the minimum call + a link to
  `docs/react.md`. Update `docs/api.md` only with a one-line pointer near `AVGrid.create` (the
  API reference stays framework-free).
- **Example** — the examples are deliberately no-build HTML. Follow that: `examples/13-react.html`
  loading `react`/`react-dom` as ESM from esm.sh and the wrapper from the local `dist/`, no JSX
  (plain `createElement` — three calls). Register it in `examples/index.html`,
  `examples/README.md`, and correct the "twelve examples" counts to thirteen. This example is
  also the real-browser verification happy-dom cannot give — drive it before calling the phase
  done.
- **Release** — version `2.4.0` per [`docs/releasing.md`](../docs/releasing.md) (additive minor).
  Update `CLAUDE.md`'s *Current state* (phase 9 done, what shipped) and the *Where everything is*
  table (`docs/react.md`, `plan-done-04.md`/`plan-done-05.md` rows) in the closing commit.

**Done when:**

- [x] `docs/react.md` exists and every code sample in it runs as written against the packed
      tarball.
- [x] `examples/13-react.html` works from a static file server with no build step, and the
      grid in it passes a by-hand smoke: scroll, range-select, Ctrl+C into a spreadsheet, edit.
- [x] README + example counts updated; `CLAUDE.md` reflects the phase; version bumped and the
      release flow of `docs/releasing.md` followed.

---

## Out of scope for this phase (deliberately)

- **React-rendered cell content** (JSX `render`/`editor` via portals into pooled cells). The
  pooling contract makes this a real sub-project — portals must mount/unmount on cell recycle —
  and no consumer needs it: the vanilla-DOM customization hooks already work from React. If it
  is ever wanted, it is its own phase with its own benchmark rows.
- **Controlled props** (`sort`, `selection`, `filters` as props). Rejected once in plan 03 by the
  consumer that tried it; the ref + callbacks cover the need.
- **SSR / RSC support.** The grid renders to a live DOM by design; the wrapper mounts in an
  effect, which never runs on the server — that is the support. Document it, build nothing.
- **A separate `av-grid-react` package.** One ~250-line file does not justify a second publish
  pipeline; the subpath export keeps versions atomically in sync.

---

## Decision log

Append here whenever the plan changes during implementation — what changed, and why. The logs of
plans 01–04 are still required reading.

| Date | Task | Decision |
|------|------|----------|
| 2026-08-31 | 38 | **Types land at `dist/react/index.d.ts`, not `dist/react.d.ts`.** `tsc -p tsconfig.build.json` emits declarations mirroring `src/`, so the react entry's types come out under `dist/react/`. Rather than post-process a file into place, `exports["./react"].types` points at where tsc actually put them. `dist/react.js` (the bundle) and `dist/react/` (the types) coexist without collision. |
| 2026-08-31 | 38 | **`.tsx`, with `"jsx": "react-jsx"` on the root tsconfig.** The plan left it to the implementer. `.tsx` won because the *test* file wants JSX regardless, and one jsx setting for both beats `createElement` in the source and JSX in the test. The core is plain `.ts` and the setting does not touch it. The core's typecheck is unchanged. |
| 2026-08-31 | 38 | **`paths: { "av-grid": ["./src/index.ts"] }` in `tsconfig.json`, and the matching `resolve.alias` in `vite.config.ts`.** The wrapper imports the core by the package's own name — the specifier its published `.d.ts` must carry — but before `dist/` exists there is nothing for that name to resolve to. The mapping points it back at source for typecheck, tests and board builds; `vite.config.react.ts` declares it `external` instead and rewrites it to `./av-grid.js` in the output. |
| 2026-08-31 | 39 | **`className` and `style` are the *host element's*, and `className` is `Omit`ted from the forwarded options.** The plan said "props are `AVGridOptions` plus className/style"; those two names collide, since the core already has a `className` option that classes the grid *root*. A React author means the element the component renders, and `style` has to go there anyway (the grid measures its host). The grid root still carries `.avg-grid`, so `.my-grid .avg-grid { … }` reaches it — documented in `docs/react.md`. |
| 2026-08-31 | 39 | **The class hooks *do* join `CALLBACK_OPTION_KEYS`** — the plan's open decision, answered yes: `onCellClass` and `rowClass` have the same identity problem as any other callback and a stale one is a subtle bug. **But they are proxied only when the host passes them on the first render**, because `DataCell.ts` checks their mere presence to decide whether to build a `CellContext` per cell. An always-installed proxy would put that allocation on every grid, supplied or not. They are exported as `PAINT_PATH_CALLBACK_KEYS` so the rule lives in the core next to the reason for it. |
| 2026-08-31 | 39 | **Five function options are deliberately *not* callbacks:** `getRowKey`, `newRow`, `newColumn`, `onGetOptions`, `onGridContextMenu`. For each, *absence* means something specific (infer a key, use the built-in blank row, offer distinct values, draw the grid's own menu), so a proxy standing in for an absent one changes behaviour. They go through lane 3 and the docs tell hosts to give them a stable identity. `_EveryFunctionOptionIsClassified` in `options.ts` fails `npm run typecheck` if a new function option joins neither list. |
| 2026-08-31 | 39 | **Rows ride inside `setOptions` when anything else changed in the same commit.** Lane 1's `setRows()` is the fast path for a rows-only change. But the core applies columns *before* rows on purpose — row filtering matches against the columns — so splitting a commit that changed both into `setRows()` then `setOptions({columns})` would apply them the wrong way round. When `changedCount > 0`, `rows` is added to the payload instead. Pinned by a test. |
| 2026-08-31 | 39 | **Core change: `setOptions` now treats an explicitly-present `undefined` as "back to the default".** Six keys were guarded by `rest.x !== undefined`, so `setOptions({ rowHeight: undefined })` cleared the resolved value in `model.options` while the engine kept the old one — a half-applied state. They are now `"x" in rest`, with this layer's defaults restated where they differ from the engine's (`overscanRow` is 4 here, 0 in `RenderGridModel`), and `getRowKey`/`rowHeight` get their resolver defaults put back. This is what makes "removing a prop resets the option" true rather than aspirational; it is also a plain bug fix for any vanilla caller. Verified end to end in the browser: clearing the `rowHeight` prop takes the rows back to 24 px. |
| 2026-08-31 | 39 | **`AVGrid` is exported from `av-grid/react` as the component's primary name**, with `AVGridReact` kept as an alias of the same export, and `AVGridProps` alongside `AVGridReactProps`. `<AVGridReact>` reads as boilerplate in a file that has no other `AVGrid` in it, which is the common case. The collision with the core's `AVGrid` *class* is real but loud — importing both in one file is a compile error, not a silent bug — and the case that actually needed the class was the ref type, so `AVGridInstance<R>` is exported too: a plain type alias over the class, which cannot drift from it. This keeps the "no re-export of the core's runtime" rule intact; only a type name crosses. |
| 2026-08-31 | 39 | **`sort`, `filters`, `selected` and `searchString` work as controlled props today, and are now documented and tested as such.** This looked like it contradicted plan 03's controlled-props rejection; it does not. That rejection was of a *compatibility layer* that pushes the grid's state back down on every render. These four are already ordinary options, so lane 3 already carries them, and the round trip terminates because each core setter guards on **value**: `SortColumnModel` on key + direction, `FiltersModel` filter by filter, `SelectedModel` on set membership. Three tests now drive the full loop — internal change → callback → React state → prop → `setOptions` → no-op — and assert exactly one extra render and exactly one callback. The guards were load-bearing before this and nobody had written them down; if one is ever removed, those tests are what fails. |
| 2026-08-31 | 39 | **`focus` is deliberately still ref-only.** It is the one piece of grid state that is not an option, and `FocusModel.applyFocus` guards on `next === previous` — **reference** equality — so echoing a `CellFocus` object back down would re-apply it, re-fire `onFocusChange`, and loop. Making it a prop is a core change (a new option, plus a value comparison on the focus path, which is the interaction hot path) rather than a wrapper change, so it is not being done unasked. Recorded in `docs/react.md` under Non-goals with what it would take. |
| 2026-08-31 | 39 | **`focus` is an option after all** — asked for, and the audit that came with it found it was the *only* gap: every other `get*`/`set*` pair on `AVGrid` already had one (`rows`, `columns`, `sort`, `searchString`, `filters`, `selected`), and everything else on the instance is derived (`getVisibleRows`, `getSelection`, `getSelectedRows`, `isFiltered`) or transient (`getEdit`, the scroll position). So the prop set is now complete rather than nearly complete, which is the property worth having: a host can hand back everything it was given. Two things had to change to make it safe — the identity guard in `applyFocus` became a value comparison, and `isDragging` stopped being host-writable. Both have their own rows below. |
| 2026-08-31 | 39 | **`initFocus`, not `setFocus`, at create.** A `focus` passed to `create()` is applied without firing `onFocusChange`: nothing has *changed* yet, and reporting a value the host supplied back to a callback it may not have finished wiring is noise at best. `SelectedModel` treats the `selected` option the same way. It is called late in the constructor, after the rows and columns exist, because a focus carrying keys only has to resolve its indices against them — which is what makes a restored focus land on the right row after a sort. |
| 2026-08-31 | 39 | **`isDragging` is the pointer's, never the host's — found in the browser, not in the tests.** Driven as a controlled React prop, a plain click left the grid with `isDragging: true`: the echo carries the *previous* event's value, so the `pointerdown` value ("a drag is in flight") arrives after the `pointerup` that ended it. Restoring a focus from `sessionStorage` is the same bug with no pointer in the room. `FocusModel.setFocus` now discards the incoming flag and keeps the live one — allocating only when the two actually differ — and `initFocus` forces it false. Checked both ways round: an echo mid-gesture must **not** end a live drag, which is why the fix keeps the current value rather than forcing false. The happy-dom suite could not have caught this; it needs a real event sequence across three separate tasks. Three tests now pin it, and it is documented on the option. |
| 2026-08-31 | 39 | **`src/react/` is written as a reference implementation, not only as working code.** It is the file a consumer opens to see what hosting the grid in React involves, so it uses JSX rather than `createElement`, and the component body is four named hooks — `useLatest`, `useWrapperState`, `useGridLifecycle`, `useOptionSync` — with the shared mutable state in one documented object instead of five loose refs. Behaviour is identical; all 24 wrapper tests passed unchanged across the rewrite, which is what made it safe to do. **The order the hooks are called in is load-bearing** and says so in a comment: effects run in call order, so the latest-props ref must be registered before the create effect, and the create effect before the ref handle and the option diff. |
| 2026-08-31 | 39 | **JSX adds a third bare import, `react/jsx-runtime`, to `dist/react.js`.** It is already in `vite.config.react.ts`'s `external` list, so the bundle is still free of React — but `examples/12-react.html` resolves bare specifiers through an import map, and that map had two entries. A no-build example is exactly where this breaks silently: the page renders its header and nothing else. Third entry added, and the example re-driven in the browser to confirm. Anything that changes how `src/react/` compiles has to be re-checked against that import map. |
| 2026-08-31 | 40 | **`forwardRef`, not React 19 ref-as-prop.** The package claims `react >=18`, and `forwardRef` is the form that works on both. It is deprecated in 19's types but not removed, and the public export is cast back to a generic function type so `<AVGridReact<Row> ref={…}>` keeps its row type. |
| 2026-08-31 | 41 | **`AVGridFilterBar` takes `barClassName` for the bar and `className` for its host.** Same collision as task 39's, resolved the same way, but here both are worth having: the bar element is the thing a host usually wants to style, and `AVGrid.createFilterBar` already accepts a `className` for it. |
| 2026-08-31 | 42 | **`@testing-library/react` as the test renderer** (devDependency), with a per-file `// @vitest-environment happy-dom` docblock and `document.createElement` patched for the whole file — React builds the host element during a commit, so `AVGrid.test.ts`'s patch-around-construction trick does not reach it. `cleanup()` is called by hand: vitest runs without `globals`, so RTL's auto-cleanup never registers. |
| 2026-08-31 | 42 | **Row fixtures are rebuilt per test.** The grid writes a committed edit straight into the row object, so a module-level fixture carried one test's edit into the next and broke an unrelated filter assertion. Cost one debugging pass; worth the line here. |
| 2026-08-31 | 43 | **The example is `12-react.html`, not `13-`.** The plan assumed twelve numbered examples; there were eleven. Counts updated to "twelve runnable files" (numbered) and "thirteen" where the Persephone board is counted with them. |
| 2026-08-31 | — | **`docs/react.md` → `docs/react-api.md`, and `api.md` went back to framework-free.** The two docs now split by *audience*, because the reader is an AI agent writing one kind of consumer: an agent writing vanilla JS reads `api.md` and meets no JSX; an agent writing React reads `react-api.md` and finds the component, the props, the adapters and the custom-chips pattern in one place. The three "**In React**, …" asides that had crept into `api.md` (near `create()`, `editor`, `column.filter`) were removed; what remains is a single routing line near `AVGrid.create` — "Writing React? read `react-api.md`" — because the one real failure mode left is an agent landing in the wrong document, and a signpost is not a mixed approach. `react-api.md` states the inverse contract at its top: everything in `api.md` is a prop, spelled identically, defined once. Older rows in this log say `docs/react.md`; they were true when written. |
| 2026-08-31 | — | **The filter bar became decomposable rather than configurable.** The ask was chips in a host's own header, mixed with its own controls, with its own clear button. Instead of growing the bar a render-prop system, the audit found every chip behavior already public except one — reopen is `showFilterPopover(key, { anchor })`, remove is `removeFilter(key)`, remove-all is `clearFilters()`, redraw is `onFiltersChange` — and the one gap was the chip's *text*: the truncation budget, the custom filter's `label()` dispatch and the `displayFormat` of values all lived privately in `FilterBar.ts`. So the additions are exactly two: `grid.describeFilter(filter)` → `{ name, values, title }`, the same strings the built-in chip shows so a custom bar and the built-in one cannot disagree, and `clearButton: false` on `createFilterBar` / `FilterBarOptions` / `<AVGridFilterBar>` for the bar embedded next to a host's own clear control. A custom React chips row is ~15 lines and lives in `test-boards/ReactApp/` beside the built-in bar; verified live — popover anchored to the custom chip, custom ✕, host clear-all, custom `min-score` label on the chip — with zero console errors. |
| 2026-08-31 | — | **`reactEditor` and `reactFilterBody` shipped in `av-grid/react`, after the phase closed.** The line between them and cell content is the design: an editor and a filter body are singletons opened by a user gesture with an explicit `destroy` — exactly what a `createRoot` needs — while `Column.render` runs on the pooled paint path where a React root per cell would cost the library its reason to exist, so it deliberately gets no adapter. Two timing traps live in the adapters so consumers cannot hit them: `flushSync` on mount (the grid measures and focuses the element in the tick the factory returns; React's next-tick render would be measured empty) and a `queueMicrotask` before `root.unmount()` (the grid calls `destroy` from inside the React event that committed, where a synchronous unmount throws). Both were found the hard way in the browser before the API existed. `react-dom/client` joined the externals — the react bundle now imports five bare specifiers and still contains no core and no react-dom. Verified in happy-dom (9 tests, including destroy-from-inside-own-event and an end-to-end `startEdit` through a real grid) and live in `test-boards/ReactApp/`: the editor commits through the real edit path, and the filter body filters 100 000 → 10 000 rows through the real popover's Apply. |
| 2026-08-31 | — | **The scratch app was promoted to `test-boards/ReactApp/` after the phase closed.** `temp/` is gitignored, so the harness that caught the `isDragging` echo bug would have evaporated with the next cleanup. It now lives beside the boards, checked in, with one structural change: `av-grid` is **aliased to `../../src`** in its Vite config instead of installing a packed tarball, so library edits hot-reload into the app with no build or reinstall — the tarball route verified *packaging*, which stays covered by `examples/12-react.html` importing the built `dist/`. References to `temp/react-app/` in the rows above are historical and correct for their time. |
| 2026-08-31 | 43 | **Verified in a real browser, not only in happy-dom** — a scratch React 19 + Vite app under `temp/react-app/` installed from the packed tarball and driven through the Persephone browser. What it showed: 100 000 rows through `<AVGridReact>` scrolling at a **16.6 ms median frame** (60 fps) with the cell pool flat at ~259 elements; a re-render with four inline arrow callbacks making **zero** core calls; a new `rows` reference making exactly one `setRows` and **keeping the scroll at 54 000**; one `setOptions` carrying exactly the changed key; clearing a prop resetting the option to its default; editing, focus, filters, search highlighting and copy-with-headers all reporting back into React state; one grid instance and one injected stylesheet under `StrictMode`; and **no console error or warning at any point**. |
| 2026-08-31 | plan | **Phase 9 planned.** Wrapper as a subpath export with optional peers; thin lifecycle adapter (plan 03's controlled-props rejection carried forward as a ground rule); three update lanes with latest-ref callback proxies over a core-exported `CALLBACK_OPTION_KEYS`; JSX cell renderers, controlled props and SSR pinned out of scope before any code exists. |
