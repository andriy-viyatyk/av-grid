/**
 * The dropdown editor — used when a column carries `options`.
 *
 * ```ts
 * // Nothing new to write: a column with `options` gets this editor.
 * AVGrid.create("#host", {
 *     rows,
 *     editable: true,
 *     columns: [{ key: "status", options: ["open", "pending", "closed"] }],
 * });
 * ```
 *
 * **Why it is not a `<select>` any more.** The first port of this file used a native element,
 * on the argument that it is keyboard-navigable, type-ahead searchable and screen-reader
 * correct for free. All of that is still true, and one thing outweighed it: a native dropdown
 * cannot be themed. Its popup is drawn by the platform, so a grid sitting in a dark Persephone
 * board opened a white list in a system font — the one place in the library where the `--p-*`
 * contract stopped at the edge of an element. That was a task-9 debt the port carried quietly
 * until both primitives existed to pay it off.
 *
 * So this is `Popover` + `VirtualList` in single-pick mode, which is also what the reference
 * did (`uikit/Select` over `ListBox`), and it brings three things the native element could not:
 *
 * - **10,000 options open instantly**, because the list is virtualized like everything else;
 * - **the picked value keeps its type** — the list addresses options by *position*, so a
 *   numeric or `Date` option commits as itself rather than as `String(value)`, which is what
 *   `defaultValidate`'s identity check against `column.options` needs to pass;
 * - **type-to-edit seeds the search box** instead of the value. Typing `p` over a status cell
 *   opens the list narrowed to "pending", where the native element replaced the cell's value
 *   with the literal string `"p"` and left `defaultValidate` to reject it.
 *
 * `Column.options` may be an array, a function, or a function returning a promise. All three
 * resolve here, so a column can look its choices up when the cell is opened rather than at
 * definition time.
 */

import type { CellEditor, EditorContext } from "../model/EditingModel";
import { chevronDownIcon } from "./icons";
import { Popover } from "./Popover";
import { VirtualList } from "./VirtualList";

/** Search box and padding — everything in the popover that is not a list row. */
const CHROME_HEIGHT = 30 + 8;
const ROW_HEIGHT = 24;
/** The search box and two rows — enough that a list still loading is not a sliver. */
const MIN_HEIGHT = CHROME_HEIGHT + 2 * ROW_HEIGHT;
const MAX_HEIGHT = 320;

function label(value: unknown): string {
    return value === null || value === undefined ? "" : String(value);
}

export function createCellSelect<R>(ctx: EditorContext<R>): CellEditor {
    // The value the cell actually holds. On a type-to-edit `ctx.value` is the character that
    // started it, not the cell's value — that character is the search text, below.
    const current = ctx.dontSelect ? (ctx.row as any)[ctx.column.key] : ctx.value;
    const initialSearch = ctx.dontSelect ? label(ctx.value) : "";

    const element = document.createElement("div");
    element.className = "avg-cell-editor avg-cell-select";
    element.setAttribute("data-type", "cell-editor");
    // Focusable, so the microtask in `editorMounted` has something to focus before the popover
    // is up, and so the cell does not lose focus to the body in the frame between the two.
    element.tabIndex = -1;
    element.innerHTML = `<span class="avg-cell-select-value"></span><span class="avg-cell-select-caret">${chevronDownIcon}</span>`;
    const valueEl = element.firstElementChild as HTMLElement;
    valueEl.textContent = label(current);

    const list = new VirtualList({
        className: "avg-cell-select-list",
        multiple: false,
        // Always, rather than above some option count. It is where a type-to-edit's first
        // character lands, and it is the replacement for the native element's type-ahead —
        // which only ever matched a prefix, and only within a second of the last keystroke.
        search: true,
        searchPlaceholder: "search…",
        emptyLabel: "no options",
        onActivate: (item) => pick(Number(item.value)),
    });
    if (initialSearch) list.setSearch(initialSearch);

    const popover = new Popover({
        anchor: element,
        placement: "bottom-start",
        // Flush under the cell's border rather than the 4px a filter popover stands off by:
        // this one is the cell, continued.
        offset: [0, 1],
        className: "avg-cell-select-popover",
        matchAnchorWidth: true,
        // The editor element already has the focus and the popover is a continuation of it;
        // letting the popover take it would hand it back on close, to an element the commit is
        // about to remove. Focus goes to the list, explicitly, below.
        autoFocus: false,
    });
    popover.content.appendChild(list.element);
    popover.root.addEventListener("keydown", onPopoverKeyDown);

    /** Resolved options, in list order. The list's values index into this. */
    let values: any[] = [];
    let picked = false;
    let disposed = false;

    function fill(resolved: readonly any[]): void {
        if (disposed) return;
        const currentLabel = label(current);
        // The cell's own value first when it is not among the choices, so opening the editor
        // never silently changes what the cell holds. Kept from the `<select>` version.
        values = resolved.some((v) => label(v) === currentLabel)
            ? [...resolved]
            : [current, ...resolved];

        list.setItems(values.map((v, index) => ({ value: index, label: label(v) })));

        const selected = values.findIndex((v) => label(v) === currentLabel);
        if (selected >= 0) {
            // Selection is by value and so survives the search; the highlight and the scroll
            // are by *visible* position, which the search changes — hence the second lookup.
            list.setSelected([selected]);
            const visible = list.getVisibleItems().findIndex((i) => i.value === selected);
            if (visible >= 0) {
                list.setActiveIndex(visible);
                list.scrollToIndex(visible, "center");
            }
        }

        popover.content.style.height = `${Math.min(
            MAX_HEIGHT,
            Math.max(MIN_HEIGHT, CHROME_HEIGHT + values.length * ROW_HEIGHT),
        )}px`;
        popover.reposition();
        list.measure();
    }

    function pick(index: number): void {
        if (index < 0 || index >= values.length) return;
        picked = true;
        ctx.setValue(values[index]);
        popover.close();
        ctx.commit();
    }

    function onPopoverKeyDown(e: KeyboardEvent): void {
        if (e.key !== "Tab") return;
        // Tab commits what is highlighted and moves on, which is what a native select did —
        // there, arrowing through the list *was* changing the value.
        e.preventDefault();
        const active = list.getActiveItem();
        if (active) {
            picked = true;
            ctx.setValue(values[Number(active.value)]);
        }
        popover.close();
        ctx.commitAndPass(e);
    }

    return {
        element,
        focus: () => {
            element.focus({ preventScroll: true });

            void popover.show().then(() => {
                // Dismissed — Escape, or a pointer somewhere else. Cancel rather than commit:
                // the only way to change a value here is to pick one, so a dismissal has
                // nothing to write, and a type-to-edit has a typed character sitting in the
                // edit that must *not* be written.
                if (!picked && !disposed) ctx.cancel();
            });

            const source = ctx.column.options;
            const resolved = typeof source === "function" ? source() : (source ?? []);
            if (resolved instanceof Promise) {
                // Empty until it arrives; the list stays focused and fills underneath.
                fill([]);
                void resolved.then(fill, (e) => {
                    console.warn("av-grid: column options failed to resolve:", e);
                    fill([]);
                });
            } else {
                fill(resolved);
            }

            list.focus();
        },
        destroy: () => {
            disposed = true;
            popover.root.removeEventListener("keydown", onPopoverKeyDown);
            popover.destroy();
            list.destroy();
            element.remove();
        },
    };
}
