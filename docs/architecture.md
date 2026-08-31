# Architecture — the source tree, and what came from where

av-grid is a port of the React grid inside **Persephone**. This file holds the file-by-file map of
what exists, and the mapping back to the reference. For the rules that govern how the render path
is written, see [`invariants.md`](invariants.md); for the public surface, [`api.md`](api.md).

## Project layout

```
av-grid/
    CLAUDE.md                    ← the entry point: rules, pointers, current state
    tasks/
        goal.md                  ← the goal, scope, and API design principles
        plan-done-01.md          ← the port, tasks 1–20 — done; its decision log still applies
        plan-done-02.md          ← phase 6, customization, tasks 21–26 — done; ditto
        benchmark-results.md     ← performance history; append after render-path changes
    docs/
        api.md                   ← the complete public surface
        architecture.md          ← you are here
        capabilities.md          ← what the grid does today, and what it measures
        invariants.md            ← the three rules that carry the performance
        boards.md                ← running and creating the test boards
    scripts/
        build-css.mjs            ← emits dist/av-grid.css from the stylesheet module
    src/
        index.ts                 ← public entry point
        AVGrid.ts                ← AVGrid.create() — the façade wiring models to the engine
        options.ts               ← AVGridOptions, the surface an agent writes by hand
        validate.ts              ← loud validation + inference for the minimum call
        types.ts                 ← public type surface (Column, CellFocus, Filter, …)
        gridUtils.ts             ← formatting, comparison, row filtering
        column-width.ts          ← content-based width detection
        model/                   ← grid state, ported from AVGrid/model/
            AVGridModel.ts       ← the hub every other model hangs off
            AVGridData.ts        ← derived data + batched change events
            AVGridEvents.ts      ← the internal event bus
            CopyPasteModel.ts    ← copy/cut/paste, on the native clipboard events
            ColumnsModel.ts      ← visible columns, resize, reorder
            RowsModel.ts         ← filter → sort pipeline
            FiltersModel.ts      ← which filters are applied, and their persistence
            SortColumnModel.ts   ← sort state and its comparator
            FocusModel.ts        ← focus, keyboard nav, range selection
            SelectedModel.ts     ← row selection, by row key
            EditingModel.ts      ← in-cell editing: open, commit, cancel, validate
            StructureModel.ts    ← rows and columns added and deleted
        view/                    ← the DOM, rewritten rather than transliterated
            ContextMenu.ts       ← what right-click offers, and the two hooks that change it
            Menu.ts              ← the menu itself: rows, submenus, keyboard, search
            FilterBar.ts         ← removable chips: edit from one, remove one, remove all
            DataCell.ts          ← the hot path; allocation-light
            CellInput.ts         ← the text editor; owned by EditingModel, never pooled
            CellSelect.ts        ← the dropdown editor, for a column with `options`
            DefaultEditFormatter.ts ← which of the two a cell gets
            HeaderCell.ts        ← label, sort indicator, resize grip, filter funnel
            GroupHeader.ts       ← the column-group band: overlay divs, not pooled cells
            FilterPopover.ts     ← showFilterPopover(): dispatch on filterType, resolve on close
            OptionsFilterContent.ts ← the checklist body: search, select-all, Apply, Clear
            TextFilterContent.ts ← the "text" body: full-width input, operator chips, Enter applies
            CustomFilterContent.ts ← a host definition's body, wrapped in the grid's Apply / Clear
            Button.ts            ← the two buttons the filter UI needs, and nothing else
            Popover.ts           ← the floating panel: anchor, flip, clamp, dismiss, resize
            VirtualList.ts       ← virtualized checklist: search, select-all, keyboard
            SelectColumn.ts      ← the checkbox column, as an ordinary Column
            GridInteractions.ts  ← every listener, all of them delegated from the root
            cellDom.ts           ← setText / applyCellStyle, the two per-cell operations
            highlight.ts         ← the search-word markup a matching cell gets
            icons.ts             ← SVG source strings
        styles/
            av-grid.css.ts       ← the whole stylesheet; single source of truth
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
            CellPool.ts          ← element recycling, optionally keyed by cell kind
        measured/                ← measured row heights: an opt-in companion over the engine
            MeasuredRowHeights.ts ← height policy; no DOM, so it unit-tests without a browser
            MeasuredRowGrid.ts   ← DOM observation + the RenderGrid it owns
        react/                   ← the `av-grid/react` entry; imports the core by package name
            index.ts             ← the subpath's whole surface: two components, two prop types
            AVGridReact.tsx      ← create/destroy in a layout effect + the three update lanes
            AVGridFilterBar.tsx  ← the detached filter bar, mounted when the instance arrives
    test-boards/                 ← Persephone boards used to run and debug the grid
        RenderGridTest/          ← the engine alone: the 100k-row performance harness
        AVGridBoard/             ← the whole grid: rendering, interaction, theming
        CustomizationBoard/      ← the host hooks: every documented claim, checked
        ReactApp/                ← the React wrapper under a real React 19 (a Vite app, not a board)
    examples/                    ← thirteen runnable standalone examples
    temp/                        ← gitignored scratch space: notes, working files, nothing shipped
```

Tests sit next to their subject as `*.test.ts`. Everything runs in the node environment except
`RenderGrid.test.ts`, `AVGrid.test.ts`, `measured/MeasuredRowGrid.test.ts` and
`react/AVGridReact.test.tsx`, which need a DOM and opt into happy-dom with a per-file
`// @vitest-environment happy-dom` docblock.

**`measured/` is deliberately outside `render/`.** It is composed *over* the engine rather than
being part of it: it constructs a `RenderGrid`, supplies its `rowHeight` and wraps its
`renderCell`, and reaches it through two public seams (`RerenderInfo.fromRow`, and the
`onCellAttached` / `onCellReleased` shell callbacks). Nothing in `render/` imports it. That is what
keeps a `ResizeObserver`, two `WeakMap`s and a debounce off the scroll path of every grid that does
not ask for them — including the one the 100,000-row benchmark measures.

## Reference implementation — Persephone

The React implementation being ported lives in the Persephone project:

```
C:\projects\persephone\src\renderer\uikit\
    AVGrid\        ← grid behavior: columns, rows, selection, focus, editing, copy/paste, filters
    RenderGrid\    ← the virtualization engine: visible-window math + cell-level dirty tracking
```

> **Persephone is a read-only reference. Never modify anything under `C:\projects\persephone`.**
> Read from it freely; write only inside `C:\projects\av-grid`.

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
| `shared/highlight.ts` | Wraps search words in `.highlighted-text`, as React nodes | **Rewritten** as `src/view/highlight.ts` — one markup string per cell instead of a node tree, because it runs for every visible cell of every repaint |

Per-file port status for everything under `AVGrid/` and `RenderGrid/` is in
[`tasks/goal.md`](../tasks/goal.md#file-inventory-and-port-status).

Persephone's own docs are worth reading when board integration comes up:
`C:\projects\persephone\assets\board-template\CLAUDE.md` (the board authoring guide, including the
`--p-*` theme contract) and `C:\projects\persephone\boards-assets\manifest.json` (how third-party
components are vendored into boards).
