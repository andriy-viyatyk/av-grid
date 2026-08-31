# The React API — `av-grid/react`

A React application writes `<AVGrid rows={rows} columns={columns} />` and gets the real
grid: same instance, same options, same performance. React owns one `<div>`; the grid owns
everything inside it.

**This page is the React side only**: the component, its props and update behavior, the ref, the
filter bar, and hosting React components inside the grid's hooks. The vocabulary those props take
— every option, column field, callback signature, filter shape, keyboard binding and CSS token —
is defined once, framework-free, in [`api.md`](api.md); every one of them is a prop here, spelled
identically.

The wrapper is a **subpath export of this same package**, so its version can never drift from the
core's. `react` and `react-dom` are **optional peer dependencies** — a vanilla consumer installs
`av-grid` and never resolves a line of React.

```bash
npm install av-grid react react-dom
```

```tsx
import { AVGrid } from "av-grid/react";
import "av-grid/av-grid.css";           // or let the grid inject it — see Styling

const columns = [
    { key: "name", name: "Name", width: 200 },
    { key: "score", name: "Score", dataType: "number" },
];

export function People({ people }) {
    return (
        <AVGrid
            rows={people}
            columns={columns}
            editable
            onEdit={(e) => save(e.rowKey, e.columnKey, e.value)}
            style={{ height: 400 }}
        />
    );
}
```

**`AVGrid` here is the component**, and it is the same export as `AVGridReact` — two names for one
thing. The short one is what a React file wants; the long one stays unambiguous in a file that also
imports the `AVGrid` *class* from `av-grid`. The instance type is exported as `AVGridInstance`, so
a ref needs no second import:

```tsx
import { AVGrid, type AVGridInstance } from "av-grid/react";

const gridRef = useRef<AVGridInstance<Row>>(null);
```

**Give the host a height.** The grid measures the element it is mounted into, exactly as
[`AVGrid.create`](api.md) does. `style={{ height: 400 }}` works; so does a flex child with
`style={{ flex: "1 1 auto", minHeight: 0 }}`. A host with no height renders a grid one pixel tall
and no error.

---

## A thin adapter, not a controlled component

Options flow **down** as props. State changes come **back** through the callbacks the core already
has. A host that wants to *drive* the grid reaches the instance through the `ref` and calls the
documented methods.

The wrapper adds **no controlled-prop machinery of its own**: it does not re-push the grid's state
on every render, and it keeps no second copy of it. That was tried once against this library and
rejected (the *"controlled-props compatibility layer"* entry in
[`tasks/plan-done-03.md`](../tasks/plan-done-03.md)).

The mechanical consequence, worth stating because it is what people ask: **an imperative change is
not reverted by the next render.** The wrapper diffs its own previous props, never the grid's live
state. `gridRef.current.setFilters(…)` survives every re-render that does not itself pass a
different `filters` prop.

**None of which stops you writing `sort={sort}` or `focus={focus}`.** Every piece of grid state is
an ordinary option, so every piece of it is an ordinary prop, and they round-trip safely — the next
section.

---

## Props that hold grid state

**Every piece of the grid's state is an option, so every piece of it is a prop** — and you may hold
each in React state and echo its callback straight back down:

| Prop | Reported by | Also reachable as |
|---|---|---|
| `sort` | `onSortChange` | `getSort()` / `setSort()` |
| `filters` | `onFiltersChange` | `getFilters()` / `setFilters()` |
| `selected` (row keys) | `onSelectionChange` | `getSelected()` / `setSelected()` |
| `focus` (the focused cell and its range) | `onFocusChange` | `getFocus()` / `setFocus()` / `focusCell()` |
| `searchString` | *(host-owned — the grid never changes it itself)* | `getSearchString()` / `setSearchString()` |

```tsx
const [sort, setSort] = useState<SortColumn>();
const [filters, setFilters] = useState<Filter[]>();

<AVGrid
    rows={rows}
    columns={columns}
    sort={sort}
    filters={filters}
    onSortChange={setSort}
    onFiltersChange={setFilters}
/>
```

Click a header and the round trip is: the grid sorts → `onSortChange` → `setSort` → re-render → the
wrapper sends `setOptions({ sort })` → **the core compares by value, finds no change, and returns.**
One extra render, no second callback, no loop.

That holds because each setter guards on value, not identity — `SortColumnModel` on key and
direction, `FiltersModel` filter by filter, `SelectedModel` on set membership, `FocusModel` field
by field. `src/react/AVGridReact.test.tsx` pins all four round trips and
`src/model/FocusModel.test.ts` pins the focus guard directly, because an echo loop is exactly what
would appear if one of those guards were ever dropped.

The cost is one `setOptions` per commit in which the prop's *reference* changed. Keep the value in
state, as above, rather than rebuilding it during render, and that is one call per real change.

`focus` is worth a word, because it is the newest of the four and the one people reach for when
restoring a session: pass it **keys only** — `{ rowKey, columnKey, isDragging: false }` — and the
grid resolves the indices against the rows as they are now, so a restored focus lands on the right
row even after a sort. Add `selection` to restore a whole range. A focus passed on the first render
is applied without reporting itself back, so mounting does not fire `onFocusChange`.

---

## The three update lanes

Everything the wrapper does on a commit is one of these three.

| Lane | Prop | What the wrapper does |
|---|---|---|
| 1 | `rows` | A new array reference → `grid.setRows(rows)`. Scroll position is kept and no cell element is torn down. Same reference → nothing at all. |
| 2 | The callbacks | **Never diffed, never re-sent.** One stable proxy per callback is installed at `create()` and forwards to whatever the prop holds *now*, return value included. |
| 3 | Everything else | `Object.is` against the previous commit. One `setOptions()` per commit, carrying only the keys that changed. A prop that **disappeared** is sent as `undefined`, which resets that option to its default. |

So this component may be re-rendered as often as React likes, with inline arrow callbacks
re-created every time, and the grid receives **zero** calls:

```tsx
<AVGrid
    rows={rows}                                  // same reference → nothing
    columns={columns}                            // module-level constant → nothing
    onEdit={(e) => setEdits((n) => n + 1)}       // lane 2 → nothing, and the newest closure fires
    onFocusChange={(f) => setFocus(f)}           // lane 2 → nothing
/>
```

### Which props are callbacks

The list is exported from the core as `CALLBACK_OPTION_KEYS`, and a compile-time check in
`src/options.ts` fails the build if a function option is ever added without being classified — so
the list cannot drift from the type.

```ts
import { CALLBACK_OPTION_KEYS } from "av-grid";
```

It holds every option the grid calls to *report* or to *intercept*: `onSelectionChange`, `onEdit`,
`onInvalidEdit`, `onAddRows`, `onDeleteRows`, `onAddColumns`, `onDeleteColumns`, `onSortChange`,
`onFiltersChange`, `onColumnResize`, `onColumnsReorder`, `onColumnsChange`, `onVisibleRowsChange`,
`onFocusChange`, `onCellClick`, `onCellDoubleClick`, `onCellContextMenu`, `getContextMenuItems`,
`onCellClass` and `rowClass`.

**Five function options are not on it**, because their mere *presence* changes what the grid does,
so a proxy standing in for an absent one would change behaviour:

| Option | What absence means |
|---|---|
| `getRowKey` | The grid infers a row key |
| `newRow`, `newColumn` | The grid's own blank-row / blank-column defaults |
| `onGetOptions` | A filter popover offers the column's distinct values |
| `onGridContextMenu` | The grid draws its own context menu |

Give those five a **stable identity** — a module-level function, or `useCallback` — or lane 3 will
send a `setOptions` on every render. The same applies to `columns`: define it outside the component
or memoize it, exactly as you would for any array prop.

Two callbacks are on the paint path: `onCellClass` and `rowClass` are consulted per *cell*, and
their presence alone makes the cell renderer build a context object it otherwise skips. The
wrapper therefore proxies them **only when they are passed on the first render**. Pass them from
the start if you pass them at all; one that appears later still works, but goes through lane 3.

---

## `className` and `style` are the host element's

They land on the `<div>` this component renders — the element React is responsible for — which is
what a React author expects and where a **height** has to go anyway.

That means `className` here is *not* the core's `className` option (which puts a class on the grid
root). The grid root inside the host still carries `.avg-grid`, so a descendant selector reaches
it:

```css
.my-grid .avg-grid { border-radius: 6px; }
```

---

## The instance ref

`ref.current` is the real `AVGrid<R>` — `null` before mount and after unmount, the instance in
between. Not a facade: every documented method on it is already the public API, and wrapping it in
a second surface would only give the two something to drift apart over.

```tsx
import { useRef } from "react";
import { AVGrid, type AVGridInstance } from "av-grid/react";

function Toolbar({ rows }: { rows: Row[] }) {
    const gridRef = useRef<AVGridInstance<Row>>(null);

    return (
        <>
            <button onClick={() => void gridRef.current?.copySelection("copyWithHeaders")}>
                Copy
            </button>
            <button onClick={() => gridRef.current?.scrollToRow(50_000, "center")}>
                Jump to 50 000
            </button>
            <AVGrid ref={gridRef} rows={rows} style={{ height: 400 }} />
        </>
    );
}
```

---

## The detached filter bar

`filterBar: true` puts a bar of removable filter chips directly above the grid and needs nothing
from this page. `<AVGridFilterBar>` is for the other case: a bar mounted somewhere else — a
toolbar, a side panel, a header above unrelated content.

The one non-obvious line is that the grid instance does not exist on the first render, so the bar
is handed `null` first. That is the normal first value, not an error case: keep the instance in
state, set from the component's `ref`.

```tsx
const [grid, setGrid] = useState<AVGridInstance<Row> | null>(null);

<AVGridFilterBar grid={grid} />
<AVGrid ref={setGrid} rows={rows} columns={columns} style={{ height: 400 }} />
```

The ref callback puts the instance in state, the re-render hands it to the bar, and the bar
mounts. A grid can have any number of bars; they all show the same filters and any of them can
edit them.

Props: `grid` (required, nullable), `barClassName` and `name` for the bar element itself,
`clearButton={false}` to drop the remove-all ✕ (next section), and `className` / `style` for the
host `<div>`.

---

## Your own filter chips

`<AVGridFilterBar>` takes `clearButton={false}` for a bar embedded in a toolbar that has its own
clear control. And when the built-in chips themselves are not enough, render your own — `filters`
is already in your state if you round-trip it, and everything a chip does is one call on the ref:

```tsx
<div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
    {filters.map((f) => {
        const text = grid.describeFilter(f);   // { name, values, title } — the built-in chip's strings
        return (
            <span key={f.columnKey} title={text.title}>
                <button onClick={(e) => grid.showFilterPopover(f.columnKey, { anchor: e.currentTarget })}>
                    {text.name}: {text.values}
                </button>
                <button onClick={() => grid.removeFilter(f.columnKey)}>✕</button>
            </span>
        );
    })}
    <button onClick={() => grid.clearFilters()}>clear all</button>
</div>
```

`test-boards/ReactApp/` renders exactly this next to the built-in bar, so the two stay provably
interchangeable.

## React components inside the grid's hooks

The grid's customization hooks take DOM, because they run inside its own rendering. Two of them
are safe places to mount a real React component, and `av-grid/react` ships an adapter for each:

```tsx
import { reactEditor, reactFilterBody } from "av-grid/react";

// A component as a cell editor — ctx is the grid's EditorContext:
// ctx.setValue(v) records, ctx.commit() / ctx.cancel() end the edit.
{ key: "city", editor: reactEditor((ctx) => <CityEditor ctx={ctx} />) }

// A component as a filter popover body. Call setValue on every change (an onChange,
// not a submit) — Apply reads whatever was recorded last, starting from ctx.value.
const minScore: FilterDefinition<Row> = {
    name: "min-score",
    create: reactFilterBody((ctx, setValue) => (
        <MinScoreFilter initial={ctx.value} onChange={setValue} />
    )),
    label: (v) => `score ≥ ${v}`,
    match: (v, row) => row.score >= v,
};
{ key: "score", filter: minScore }
```

Why these two and not cell content: an editor and a filter body are **one instance at a time,
opened by a user gesture, with an explicit `destroy`** — exactly what a React root needs.
`Column.render` is the opposite: it runs on the paint path, sixty times a second while scrolling,
against pooled elements that are recycled dirty and evicted without notice. A React root per cell
is the cost this grid exists to avoid, so cell content stays an HTML string (or a cached DOM
element) — still written inside your React file, just not JSX:

```tsx
{ key: "score", render: (c) => `<b>${c.highlight(c.value)}</b>` }
```

Everything `docs/api.md` promises the DOM versions of these hooks — the editor's positioning,
Escape/Tab handling and teardown on every exit path; the filter's Apply/Clear, chip, persistence
and cascade — applies to the adapted ones unchanged. The adapters also absorb the two timing
traps: the component is mounted **synchronously** (`flushSync`), because the grid measures and
focuses the element in the same tick the factory returns; and the unmount is **deferred a
microtask**, because the grid calls `destroy` from inside the React event that committed, and
React refuses to unmount a root while it is rendering.

## Styling and theming

Nothing here is React-specific. The grid injects its stylesheet on first use, so the import of
`av-grid/av-grid.css` above is optional — set `injectStyles={false}` if you would rather link it
yourself, as a bundler-managed stylesheet or a CSP-friendly `<link>`.

Theming is the `--p-*` / `--avg-*` token contract described in
[Theming](capabilities.md#theming): set the tokens on any ancestor — the app shell, a themed
panel, `:root` — and every grid under it follows. There is no theme prop and there is not going to
be one.

---

## StrictMode, and what the wrapper does on mount

The grid is created in a `useLayoutEffect` (not `useEffect`: it measures its host, so it must
exist before the browser paints) and destroyed in that effect's cleanup.

React 19's development StrictMode double-invokes mount → cleanup → mount. That is safe here by
construction rather than by a guard: `destroy()` is tested leak-free over 100 create/destroy
cycles, and the second mount builds a fresh instance. One live grid, no warnings.

---

## Non-goals

- **JSX cell content.** `render` and `editor` are vanilla-DOM factories and work unchanged from
  React — they are ordinary options. Rendering *React* into pooled cells through portals is a
  different thing: the pooling contract means a cell element is recycled and evicted under the
  portal's feet, and no consumer has needed it. It would be its own phase, with its own benchmark
  numbers.
- **An editing session as a prop.** `startEdit()`, `commitEdit()`, `cancelEdit()` and `getEdit()`
  stay on the instance. An open editor is transient UI mid-keystroke, not state a host should be
  round-tripping through a render; the same goes for the scroll position, which has `scrollToRow()`
  and no option, because a prop that fights the user's own scrolling is a bug rather than a
  feature.
- **Controlled-prop machinery.** See above.
- **SSR / RSC.** The grid renders into a live DOM by design. The wrapper mounts in an effect,
  which never runs on the server, so a server render emits the empty host `<div>` and the grid
  appears on hydration. That is the support; there is nothing to configure.

---

## API summary

```ts
import { AVGrid, AVGridReact, AVGridFilterBar, reactEditor, reactFilterBody } from "av-grid/react";
import type {
    AVGridProps, AVGridReactProps, AVGridInstance, AVGridFilterBarProps,
} from "av-grid/react";
```

| Export | Shape |
|---|---|
| `AVGrid<R>` | The component: `AVGridOptions<R>` minus `className`, plus `className` / `style` for the host, plus `ref?: Ref<AVGridInstance<R>>` |
| `AVGridReact<R>` | The same export, under the name that cannot collide |
| `AVGridProps<R>`, `AVGridReactProps<R>` | The props type, likewise under both names |
| `AVGridInstance<R>` | What a `ref` yields — a type alias over the core's `AVGrid` class |
| `AVGridFilterBar<R>` | `{ grid: AVGridInstance<R> \| null, barClassName?, name?, clearButton?, className?, style? }` |
| `reactEditor<R>(render)` | `(ctx: EditorContext<R>) => ReactElement` → a `Column.editor` — see [React components inside the grid's hooks](#react-components-inside-the-grids-hooks) |
| `reactFilterBody<R>(render)` | `(ctx: FilterBodyContext<R>, setValue) => ReactElement` → a `FilterDefinition.create` |

Everything else — the option and column types, `CALLBACK_OPTION_KEYS` — comes from `av-grid`
itself. The React entry deliberately does not re-export the core's runtime.

The full option, column, method and callback reference is [`docs/api.md`](api.md); it stays
framework-free, and everything in it applies here unchanged.
