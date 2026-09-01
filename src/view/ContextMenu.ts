/**
 * The grid's context menu: what right-clicking offers, and the two ways a host can change it.
 *
 * ```js
 * // Nothing at all — right-click a cell and get Copy / Paste / Insert / Delete.
 * AVGrid.create(el, { rows });
 *
 * // Your own items, above the built-in ones.
 * getContextMenuItems: (e) => [{ label: `Open ${e.rowKey}`, onClick: () => open(e.row) }]
 *
 * // Your own menu instead, given the point and the items the grid would have shown.
 * onGridContextMenu: (e, items) => myMenu.show(e.x, e.y, items)
 * ```
 *
 * Ported from `AVGrid/model/ContextMenuModel.tsx`, which the plan deferred past v1 because its
 * only hard dependency was Persephone's app shell — it called `showAppPopupMenu`, a function
 * that reaches for the running application's popup layer. `Menu` replaced that, so the port is
 * the rest of the file: the item list, the labels that count what the selection covers, and the
 * rule that an open editor gets the browser's own menu instead of the grid's.
 *
 * It is a function here, not a model. The reference class held no state — it subscribed to one
 * event and built an array — and the menu it opens is view code, which the model layer
 * deliberately does not import.
 *
 * Three divergences from the reference, all in `plan-done-01.md`'s decision log:
 *
 * 1. **Insert is never disabled.** There, inserting into a sorted or filtered grid was offered
 *    greyed out with `Filtered or Sorted` where the shortcut goes. Here `addRows` freezes the
 *    row order instead, so the row lands where the user put it and the item just works.
 * 2. **The custom items get the whole event**, not just the selected rows — a header right-click
 *    can be told apart from a cell one, and the point is there for a host drawing its own menu.
 * 3. **`onGridContextMenu` replaces the menu rather than suppressing it.** The reference had no
 *    equivalent; this is the hook the scope note in `goal.md` asked for, and it receives the
 *    generated items so a host menu can offer the same actions without rebuilding them.
 */

import { isChromeColumn } from "../gridUtils";
import type { AVGridModel } from "../model/AVGridModel";
import type { GridContextMenuEvent, MenuItem } from "../types";
import { copyIcon, deleteIcon, pasteIcon, plusIcon } from "./icons";
import { Menu } from "./Menu";

/**
 * `1 row` / `3 rows` — the labels count what the action will actually touch.
 *
 * The noun is `options.rowNoun` for the row items, so a grid of links offers `Insert 3 links`.
 * The column items keep saying "column": nothing has asked to rename those, and one option that
 * renamed both would be one option meaning two things.
 */
function plural(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The items the grid would show for this event.
 *
 * Exported because `onGridContextMenu` receives them and a host may want to filter or reorder
 * them, and because it is the honest way to test what the menu offers without opening one.
 *
 * **Every built-in item carries a stable `id`, prefixed `avg-`** — `avg-copy`, `avg-paste`,
 * `avg-insert-rows`, and the rest; the full table is in `docs/api.md` and it is public contract,
 * so renaming one is a breaking change. A host drawing its own menu matches on the id rather
 * than the label, because the labels are counted and pluralised (`Insert 3 rows`) and a host
 * that re-icons the items has nothing else to match on. The prefix is load-bearing twice over:
 * host items from `getContextMenuItems` share this array and `id` is what the menu uses for
 * keyboard navigation, so a collision is a real bug — and `item.id?.startsWith("avg-")` is a
 * usable test for "this is the library's own item".
 */
export function gridContextMenuItems<R>(
    model: AVGridModel<R>,
    e: GridContextMenuEvent<R>,
): MenuItem[] {
    const options = model.options;
    const { copyPaste, structure } = model.models;
    const { rows, columns } = e.selectedCount;
    const rowNoun = options.rowNoun ?? "row";

    const items: MenuItem[] = [];

    // Host items first, above the built-in group — the reference's order, and the right one: an
    // action specific to this grid is what the user came to the menu for.
    const custom = options.getContextMenuItems?.(e) ?? [];
    items.push(...custom);

    if (e.target === "header" && e.column) {
        const columnKey = String(e.column.key);
        items.push(
            {
                id: "avg-insert-column",
                label: "Insert column",
                icon: plusIcon,
                startGroup: custom.length > 0,
                invisible: !structure.canAddColumns || isChromeColumn(e.column),
                // By key, not by the header's display index: `addColumns` indexes the host's
                // own column list, which the checkbox column is not in.
                onClick: () => {
                    const at = options.columns.findIndex(
                        (c) => String(c.key) === columnKey,
                    );
                    structure.addBlankColumns(1, at < 0 ? undefined : at);
                },
            },
            {
                id: "avg-delete-column",
                label: "Delete column",
                icon: deleteIcon,
                invisible: !structure.canDeleteColumns || isChromeColumn(e.column),
                onClick: () => structure.deleteColumns([columnKey]),
            },
        );
        return items.filter((i) => !i.invisible);
    }

    if (e.target !== "cell" || rows === 0) {
        return items.filter((i) => !i.invisible);
    }

    items.push(
        {
            id: "avg-copy",
            label: "Copy",
            icon: copyIcon,
            hotKey: "(Ctrl+C)",
            startGroup: custom.length > 0,
            invisible: !copyPaste.enabled,
            onClick: () => void copyPaste.copySelection(),
        },
        {
            id: "avg-copy-as",
            label: "Copy as...",
            icon: copyIcon,
            invisible: !copyPaste.enabled,
            items: [
                {
                    id: "avg-copy-as-headers",
                    label: "With Headers",
                    hotKey: "(Ctrl+Shift+C)",
                    onClick: () => void copyPaste.copySelection("copyWithHeaders"),
                },
                {
                    id: "avg-copy-as-json",
                    label: "JSON",
                    onClick: () => void copyPaste.copySelection("copyAsJson"),
                },
                {
                    id: "avg-copy-as-html",
                    label: "Formatted (HTML Table)",
                    onClick: () => void copyPaste.copySelection("copyAsHtmlTable"),
                },
            ],
        },
        {
            id: "avg-paste",
            label: "Paste",
            icon: pasteIcon,
            hotKey: "(Ctrl+V)",
            // The clipboard read needs a permission the async API only grants from a user
            // gesture, and a menu click is one — see `CopyPasteModel.paste`.
            invisible: !copyPaste.enabled || !options.editable,
            onClick: () => void copyPaste.paste(),
        },
        {
            id: "avg-insert-rows",
            label: `Insert ${plural(rows, rowNoun)}`,
            icon: plusIcon,
            hotKey: "(Ctrl+Insert)",
            startGroup: true,
            invisible: !structure.canAddRows,
            onClick: () => structure.insertRowsAtSelection(),
        },
        {
            id: "avg-add-rows",
            label: `Add ${plural(rows, rowNoun)}`,
            icon: plusIcon,
            hotKey: rows === 1 ? "(Last Row ↓)" : undefined,
            invisible: !structure.canAddRows,
            onClick: () => structure.addBlankRows(rows),
        },
        {
            id: "avg-delete-rows",
            label: `Delete ${plural(rows, rowNoun)}`,
            icon: deleteIcon,
            hotKey: "(Ctrl+Delete)",
            invisible: !structure.canDeleteRows,
            onClick: () => structure.deleteSelectedRows(),
        },
        // Columns are `minor`: a grid whose columns are the host's schema gets these too, and
        // dimming them keeps a right-click on a cell reading as being about rows.
        {
            id: "avg-insert-columns",
            label: `Insert ${plural(columns, "column")}`,
            icon: plusIcon,
            hotKey: "(Ctrl+Shift+Insert)",
            startGroup: true,
            minor: true,
            invisible: !structure.canAddColumns,
            onClick: () => structure.insertColumnsAtSelection(),
        },
        {
            id: "avg-add-columns",
            label: `Add ${plural(columns, "column")}`,
            icon: plusIcon,
            minor: true,
            invisible: !structure.canAddColumns,
            onClick: () => structure.addBlankColumns(columns),
        },
        {
            id: "avg-delete-columns",
            label: `Delete ${plural(columns, "column")}`,
            icon: deleteIcon,
            hotKey: "(Ctrl+Shift+Delete)",
            minor: true,
            invisible: !structure.canDeleteColumns,
            onClick: () => structure.deleteSelectedColumns(),
        },
    );

    // Filtered here rather than left to the menu, because these are also what a host's own menu
    // receives — and a host should not have to know what `invisible` means to draw them.
    return items.filter((i) => !i.invisible);
}

/**
 * Build the event object for a right-click.
 *
 * `selection` is a lazy getter: the built-in items need only the counts, and a grid with
 * 100,000 rows selected would otherwise copy 100,000 references on every right-click.
 */
export function gridContextMenuEvent<R>(
    model: AVGridModel<R>,
    e: MouseEvent,
    hit:
        | { target: "cell"; rowIndex: number; colIndex: number }
        | { target: "header"; colIndex: number }
        | { target: "grid" },
): GridContextMenuEvent<R> {
    const focus = model.models.focus;
    let cachedSelection: ReturnType<typeof focus.getGridSelection> | undefined;
    let resolved = false;

    const base = {
        x: e.clientX,
        y: e.clientY,
        target: hit.target,
        selectedCount: focus.selectedCount,
        event: e,
        get selection() {
            if (!resolved) {
                resolved = true;
                cachedSelection = focus.getGridSelection();
            }
            return cachedSelection;
        },
    };

    if (hit.target === "header") {
        return { ...base, column: model.data.columns[hit.colIndex] };
    }
    if (hit.target === "cell") {
        const context = model.cellContext(hit.rowIndex, hit.colIndex);
        return {
            ...base,
            column: context?.column,
            row: context?.row,
            rowKey: context?.rowKey,
            rowIndex: hit.rowIndex,
            colIndex: hit.colIndex,
        };
    }
    return base;
}

/**
 * Open the grid's context menu, or hand the event to the host that asked to draw its own.
 *
 * Returns whether the browser's menu was suppressed — `false` means nothing was shown and the
 * platform menu should be left alone, which is what a right-click on an open editor wants.
 */
export function showGridContextMenu<R>(
    model: AVGridModel<R>,
    event: GridContextMenuEvent<R>,
): boolean {
    const items = gridContextMenuItems(model, event);

    const onGridContextMenu = model.options.onGridContextMenu;
    if (onGridContextMenu) {
        onGridContextMenu(event, items);
        return true;
    }

    if (!items.length) return false;

    // One at a time, and closed on `destroy()`: the menu lives on `document.body`, outside
    // everything the grid's own teardown reaches. Structural rather than typed, like
    // `flags.filterPopover`, so the model layer keeps not knowing about the view.
    model.flags.contextMenu?.close();
    const menu = new Menu({ anchor: { x: event.x, y: event.y }, items });
    model.flags.contextMenu = { close: menu.close };
    void menu.show().then(() => {
        if (model.flags.contextMenu?.close === menu.close) {
            model.flags.contextMenu = undefined;
        }
    });
    return true;
}
