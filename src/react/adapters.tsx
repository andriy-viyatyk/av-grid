/**
 * React components inside the grid's DOM hooks — the two places it is safe.
 *
 * A cell editor and a filter popover body share the properties React needs to live inside a
 * pooled-DOM grid: **one instance at a time, opened by a user gesture, with an explicit
 * `destroy`**. So both get an adapter. Cell *content* (`Column.render`) deliberately does not —
 * it runs on the paint path, sixty times a second while scrolling, against recycled elements
 * that are evicted without notice; a React root per cell is precisely the cost this library
 * exists to avoid. Return an HTML string there instead.
 *
 * ```tsx
 * import { reactEditor, reactFilterBody } from "av-grid/react";
 *
 * { key: "city", editor: reactEditor((ctx) => <CityEditor ctx={ctx} />) }
 *
 * const minScore: FilterDefinition<Row> = {
 *     name: "min-score",
 *     create: reactFilterBody((ctx, setValue) => (
 *         <MinScoreFilter initial={ctx.value} onChange={setValue} />
 *     )),
 *     label: (v) => `score ≥ ${v}`,
 *     match: (v, row) => row.score >= v,
 * };
 * ```
 */

import type { ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type {
    CellEditor,
    CellEditorFactory,
    EditorContext,
    FilterBody,
    FilterBodyContext,
} from "av-grid";

/**
 * Mount a React element into a fresh host div, synchronously.
 *
 * `flushSync`, because the grid measures, positions and focuses the returned element in the
 * same tick the factory returns — a component that arrives on React's next tick would be
 * focused and measured while still empty.
 *
 * The unmount is deferred a microtask, because the grid calls `destroy` synchronously from
 * inside whatever event ended the edit — often a React event fired by the component itself,
 * and React refuses to unmount a root while it is rendering.
 */
function mount(node: ReactElement): { element: HTMLDivElement; unmount: () => void } {
    const element = document.createElement("div");
    const root = createRoot(element);
    flushSync(() => root.render(node));
    return { element, unmount: () => queueMicrotask(() => root.unmount()) };
}

/** Focus the first thing worth focusing — the component's control, not its wrapper. */
function focusFirstControl(element: HTMLElement): void {
    const control = element.querySelector<HTMLElement>(
        "input, select, textarea, button, [contenteditable], [tabindex]",
    );
    (control ?? element).focus();
}

/**
 * A React component as a `Column.editor`.
 *
 * The component receives the grid's `EditorContext` and drives the edit exactly as a DOM
 * editor would: `ctx.setValue(v)` records, `ctx.commit()` / `ctx.cancel()` end it. Everything
 * `docs/api.md` promises an editor — positioning, Escape and Tab, keeping the grid's keys and
 * clipboard out, teardown on every exit path — applies unchanged; the wrapper element carries
 * `avg-cell-editor` and fills the cell, so size the component to `100%` of it.
 *
 * ```tsx
 * { key: "due", editor: reactEditor((ctx) => <DatePicker ctx={ctx} />) }
 * ```
 */
export function reactEditor<R = any>(
    render: (ctx: EditorContext<R>) => ReactElement,
): CellEditorFactory<R> {
    return (ctx) => {
        const { element, unmount } = mount(render(ctx));
        return {
            element,
            focus: () => focusFirstControl(element),
            destroy: unmount,
        } satisfies CellEditor;
    };
}

/**
 * A React component as a `FilterDefinition.create` — the body of the filter popover.
 *
 * `FilterBody.getValue` is a pull: the grid reads it when Apply is pressed, but a React
 * component keeps its state inside. `setValue` is the bridge — call it whenever the value
 * changes (an `onChange`, not a submit), and whatever was recorded last is what Apply reads.
 * It starts as `ctx.value`, so opening and immediately applying keeps the current filter.
 * A nullish value removes the filter, the same rule as every other body. For a body with its
 * own notion of Enter, `ctx.apply(value)` applies and closes in one call.
 *
 * ```tsx
 * create: reactFilterBody((ctx, setValue) => (
 *     <MinScoreFilter initial={ctx.value} onChange={setValue} />
 * )),
 * ```
 */
export function reactFilterBody<R = any>(
    render: (ctx: FilterBodyContext<R>, setValue: (value: unknown) => void) => ReactElement,
): (ctx: FilterBodyContext<R>) => FilterBody {
    return (ctx) => {
        let value: unknown = ctx.value;
        const { element, unmount } = mount(
            render(ctx, (v) => {
                value = v;
            }),
        );
        return {
            element,
            getValue: () => value,
            focus: () => focusFirstControl(element),
            destroy: unmount,
        };
    };
}
