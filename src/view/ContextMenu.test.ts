// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { AVGrid } from "../AVGrid";
import type { AVGridOptions } from "../options";
import type { GridContextMenuEvent, MenuItem } from "../types";

/**
 * What the context menu offers, and who gets asked first.
 *
 * The menu's own behaviour — rows, keyboard, submenus — is `Menu.test.ts`. This suite is about
 * the grid: which items appear for a cell and which for a header, that they act on the
 * selection rather than on the cell under the pointer, and that a host can add to the list or
 * take it over entirely.
 */
function withLayout<T>(fn: () => T): T {
    const originalCreate = document.createElement.bind(document);
    document.createElement = ((tag: string) => {
        const el = originalCreate(tag) as HTMLElement;
        Object.defineProperties(el, {
            offsetWidth: { value: 300, configurable: true },
            offsetHeight: { value: 240, configurable: true },
            clientWidth: { value: 300, configurable: true },
            clientHeight: { value: 240, configurable: true },
        });
        return el;
    }) as typeof document.createElement;
    try {
        return fn();
    } finally {
        document.createElement = originalCreate;
    }
}

const rows = [
    { id: 1, name: "Ada", score: 10 },
    { id: 2, name: "Alan", score: 20 },
    { id: 3, name: "Grace", score: 30 },
];

const grids: AVGrid<any>[] = [];

function create<R>(options: AVGridOptions<R>): AVGrid<R> {
    const host = document.createElement("div");
    document.body.append(host);
    const grid = withLayout(() =>
        AVGrid.create<R>(host, {
            canAddRows: true,
            canDeleteRows: true,
            editable: true,
            ...options,
        }),
    );
    grids.push(grid);
    return grid;
}

/** The cell at a display row and column, as the DOM has it. */
function cell(grid: AVGrid<any>, row: number, col: number): HTMLElement {
    const el = grid.element.querySelector<HTMLElement>(
        `[data-type="data-cell"][data-row="${row}"][data-col="${col}"]`,
    );
    if (!el) throw new Error(`no cell at ${row},${col}`);
    return el;
}

function header(grid: AVGrid<any>, columnKey: string): HTMLElement {
    const el = Array.from(
        grid.element.querySelectorAll<HTMLElement>('[data-type="header-cell"]'),
    ).find((c) => c.getAttribute("data-column-key") === columnKey);
    if (!el) throw new Error(`no header for "${columnKey}"`);
    return el;
}

/** Right-click an element the way a mouse does: the press, then the contextmenu. */
function rightClick(el: Element): MouseEvent {
    el.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 2, buttons: 2 }),
    );
    const e = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 40,
        clientY: 60,
    });
    el.dispatchEvent(e);
    return e;
}

const menuLabels = (): string[] =>
    Array.from(document.querySelectorAll(".avg-menu .avg-menu-label")).map(
        (l) => l.textContent ?? "",
    );

const menuItem = (label: string): HTMLElement => {
    const el = Array.from(
        document.querySelectorAll<HTMLElement>('[data-type="menu-item"]'),
    ).find((r) => r.querySelector(".avg-menu-label")?.textContent === label);
    if (!el) throw new Error(`no menu item "${label}" in ${menuLabels().join(" | ")}`);
    return el;
};

const click = (el: Element): void => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
};

afterEach(() => {
    grids.splice(0).forEach((g) => g.destroy());
    document.body.innerHTML = "";
    vi.restoreAllMocks();
});

describe("opening", () => {
    it("opens the grid's own menu over a cell, and suppresses the browser's", () => {
        const grid = create({ rows });
        const e = rightClick(cell(grid, 0, 0));

        expect(document.querySelector(".avg-menu")).not.toBeNull();
        expect(e.defaultPrevented).toBe(true);
        expect(menuLabels()).toContain("Copy");
    });

    it("offers the column items over a header, and nothing about rows", () => {
        const grid = create({ rows, canAddColumns: true, canDeleteColumns: true });
        rightClick(header(grid, "name"));

        expect(menuLabels()).toEqual(["Insert column", "Delete column"]);
    });

    it("leaves right-click alone when disableContextMenu is set", () => {
        const grid = create({ rows, disableContextMenu: true });
        const e = rightClick(cell(grid, 0, 0));

        expect(document.querySelector(".avg-menu")).toBeNull();
        expect(e.defaultPrevented).toBe(false);
    });

    it("still fires onCellContextMenu, menu or no menu", () => {
        const onCellContextMenu = vi.fn();
        const grid = create({ rows, disableContextMenu: true, onCellContextMenu });
        rightClick(cell(grid, 1, 0));

        expect(onCellContextMenu).toHaveBeenCalledOnce();
        expect(onCellContextMenu.mock.calls[0][0].rowKey).toBe("2");
    });

    it("keeps the platform menu over an open editor", async () => {
        const grid = create({ rows });
        grid.startEdit(0, 0);
        // The editor is written by the paint that the edit marked dirty, not by `startEdit`.
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const input = grid.element.querySelector(".avg-cell-editor");
        if (!input) throw new Error("no editor");

        const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
        input.dispatchEvent(e);

        expect(document.querySelector(".avg-menu")).toBeNull();
        expect(e.defaultPrevented).toBe(false);
    });

    it("replaces an already-open menu rather than stacking a second one", () => {
        const grid = create({ rows });
        rightClick(cell(grid, 0, 0));
        rightClick(cell(grid, 1, 0));

        expect(document.querySelectorAll(".avg-menu")).toHaveLength(1);
    });

    it("closes with the grid", () => {
        const grid = create({ rows });
        rightClick(cell(grid, 0, 0));
        expect(document.querySelector(".avg-menu")).not.toBeNull();

        grid.destroy();
        expect(document.querySelector(".avg-menu")).toBeNull();
    });
});

describe("what the items do", () => {
    it("counts the selection, not the cell under the pointer", () => {
        const grid = create({ rows });
        grid.selectRange(0, 0, 2, 0);
        rightClick(cell(grid, 1, 0));

        expect(menuLabels()).toContain("Delete 3 rows");
        expect(menuLabels()).toContain("Insert 3 rows");
    });

    it("deletes what the selection covers", () => {
        const onDeleteRows = vi.fn();
        const grid = create({ rows: [...rows], onDeleteRows });
        grid.selectRange(1, 0, 2, 0);
        rightClick(cell(grid, 1, 0));

        click(menuItem("Delete 2 rows"));

        expect(grid.getRows()).toHaveLength(1);
        expect(onDeleteRows.mock.calls[0][0].rowKeys).toEqual(["2", "3"]);
    });

    it("inserts above the selection", () => {
        const grid = create({ rows: [...rows] });
        grid.focusCell(1, 0);
        rightClick(cell(grid, 1, 0));

        click(menuItem("Insert 1 row"));

        expect(grid.getRows()).toHaveLength(4);
        expect(grid.getRows()[1].name).toBeUndefined();
    });

    it("leaves out what the grid cannot do", () => {
        const grid = create({
            rows,
            canAddRows: false,
            canDeleteRows: false,
            editable: false,
        });
        rightClick(cell(grid, 0, 0));

        expect(menuLabels()).toEqual(["Copy", "Copy as..."]);
    });

    it("drops the clipboard group when the clipboard is off", () => {
        const grid = create({ rows, disableClipboard: true });
        rightClick(cell(grid, 0, 0));

        expect(menuLabels()).not.toContain("Copy");
        expect(menuLabels()).toContain("Delete 1 row");
    });
});

/**
 * The ids are public contract from the release that ships them: a host drawing its own menu
 * re-icons the items by identity, because the labels are counted, pluralised and localisable.
 * Asserted by identity here for exactly that reason.
 */
describe("built-in item ids", () => {
    /** Every id in the menu, submenu children included, in the order they are offered. */
    function ids(items: MenuItem[]): (string | undefined)[] {
        return items.flatMap((i) => [i.id, ...(i.items ? ids(i.items) : [])]);
    }

    function captureItems(options: Partial<AVGridOptions<any>> = {}) {
        let captured: MenuItem[] = [];
        const grid = create({
            rows,
            canAddColumns: true,
            canDeleteColumns: true,
            onGridContextMenu: (_e, items) => (captured = items),
            ...options,
        });
        return { grid, items: () => captured };
    }

    it("names every item a cell right-click offers", () => {
        const { grid, items } = captureItems();
        rightClick(cell(grid, 0, 0));

        expect(ids(items())).toEqual([
            "avg-copy",
            "avg-copy-as",
            "avg-copy-as-headers",
            "avg-copy-as-json",
            "avg-copy-as-html",
            "avg-paste",
            "avg-insert-rows",
            "avg-add-rows",
            "avg-delete-rows",
            "avg-insert-columns",
            "avg-add-columns",
            "avg-delete-columns",
        ]);
    });

    it("names the two a header right-click offers", () => {
        const { grid, items } = captureItems();
        rightClick(header(grid, "name"));

        expect(ids(items())).toEqual(["avg-insert-column", "avg-delete-column"]);
    });

    it("keeps the id stable while the label counts the selection", () => {
        const { grid, items } = captureItems();
        grid.selectRange(0, 0, 2, 0);
        rightClick(cell(grid, 0, 0));

        const del = items().find((i) => i.id === "avg-delete-rows");
        expect(del?.label).toBe("Delete 3 rows");
    });

    it("has no duplicate id, host items included", () => {
        // What the prefix exists to prevent: `id` drives the menu's keyboard navigation, so two
        // items sharing one is a real bug rather than a cosmetic one.
        const { grid, items } = captureItems({
            getContextMenuItems: () => [
                { id: "open", label: "Open" },
                { id: "reveal", label: "Reveal" },
            ],
        });
        rightClick(cell(grid, 0, 0));

        const all = ids(items()).filter((id): id is string => id !== undefined);
        expect(all).toHaveLength(new Set(all).size);
        expect(all.filter((id) => id.startsWith("avg-"))).toHaveLength(12);
    });

    it("is what a host matches on to re-icon the items", () => {
        // The motivating case: a menu whose `icon` is a component, not this library's SVG
        // source, has to replace every icon and only the id is a stable handle.
        const { grid, items } = captureItems();
        rightClick(cell(grid, 0, 0));

        for (const item of items()) {
            if (item.id === "avg-copy") item.icon = "<svg id='mine'/>";
        }
        expect(items().find((i) => i.id === "avg-copy")?.icon).toBe("<svg id='mine'/>");
    });
});

/**
 * `rowNoun` is what this grid calls one of its rows, and it reaches exactly two places: the three
 * row items here, and the add-row button. The column items keep saying "column".
 */
describe("rowNoun", () => {
    const labelById = (items: MenuItem[], id: string): string | undefined =>
        items.find((i) => i.id === id)?.label;

    function captureItems(options: Partial<AVGridOptions<any>> = {}) {
        let captured: MenuItem[] = [];
        const grid = create({
            rows,
            canAddColumns: true,
            canDeleteColumns: true,
            onGridContextMenu: (_e, items) => (captured = items),
            ...options,
        });
        return { grid, items: () => captured };
    }

    it("names the row items and leaves the column ones alone", () => {
        const { grid, items } = captureItems({ rowNoun: "link" });
        grid.selectRange(0, 0, 2, 0);
        rightClick(cell(grid, 0, 0));

        expect(labelById(items(), "avg-insert-rows")).toBe("Insert 3 links");
        expect(labelById(items(), "avg-add-rows")).toBe("Add 3 links");
        expect(labelById(items(), "avg-delete-rows")).toBe("Delete 3 links");
        expect(labelById(items(), "avg-insert-columns")).toBe("Insert 1 column");
        expect(labelById(items(), "avg-delete-columns")).toBe("Delete 1 column");
    });

    it("pluralises through the same plural() as before", () => {
        const { grid, items } = captureItems({ rowNoun: "link" });
        grid.selectRange(1, 0, 1, 0);
        rightClick(cell(grid, 1, 0));

        expect(labelById(items(), "avg-delete-rows")).toBe("Delete 1 link");
    });

    it("is byte-identical to today's labels when it is not set", () => {
        // The additive-only rule: these labels are the easiest thing in this phase to change by
        // accident, so the default is pinned rather than assumed.
        const { grid, items } = captureItems();
        grid.selectRange(0, 0, 1, 0);
        rightClick(cell(grid, 0, 0));

        expect(labelById(items(), "avg-insert-rows")).toBe("Insert 2 rows");
        expect(labelById(items(), "avg-add-rows")).toBe("Add 2 rows");
        expect(labelById(items(), "avg-delete-rows")).toBe("Delete 2 rows");
    });

    it("names the add-row button, and addRowLabel still wins", () => {
        const grid = create({ rows, canAddRows: true, rowNoun: "link" });
        const button = (): HTMLElement =>
            grid.element.querySelector(".avg-add-row") as HTMLElement;
        expect(button().textContent).toBe("+ add link");
        expect(button().title).toBe("add link (Ctrl+Insert)");

        grid.setOptions({ addRowLabel: "new entry" });
        expect(button().textContent).toBe("+ new entry");
    });

    it("updates the button through setOptions, without a re-create", () => {
        const grid = create({ rows, canAddRows: true });
        const button = (): HTMLElement =>
            grid.element.querySelector(".avg-add-row") as HTMLElement;
        expect(button().textContent).toBe("+ add row");

        grid.setOptions({ rowNoun: "variable" });
        expect(button().textContent).toBe("+ add variable");
        expect(button().title).toBe("add variable (Ctrl+Insert)");
    });

    it("reaches the menu through setOptions too", () => {
        const { grid, items } = captureItems();
        grid.setOptions({ rowNoun: "link" });
        rightClick(cell(grid, 0, 0));

        expect(labelById(items(), "avg-delete-rows")).toBe("Delete 1 link");
    });
});

describe("host hooks", () => {
    it("puts getContextMenuItems above the built-in ones", () => {
        const getContextMenuItems = vi.fn(
            (e: GridContextMenuEvent<any>): MenuItem[] => [
                { label: `Open ${e.rowKey}` },
            ],
        );
        const grid = create({ rows, getContextMenuItems });
        rightClick(cell(grid, 2, 0));

        expect(menuLabels()[0]).toBe("Open 3");
        expect(menuLabels()).toContain("Copy");

        const e = getContextMenuItems.mock.calls[0][0];
        expect(e.target).toBe("cell");
        expect(e.x).toBe(40);
        expect(e.y).toBe(60);
        expect(e.column?.key).toBe("id");
        expect(e.selectedCount.rows).toBe(1);
        expect(e.selection?.rows).toHaveLength(1);
    });

    it("hands the whole menu to onGridContextMenu instead of drawing one", () => {
        const onGridContextMenu = vi.fn();
        const grid = create({ rows, onGridContextMenu });
        const e = rightClick(cell(grid, 0, 0));

        expect(document.querySelector(".avg-menu")).toBeNull();
        // Suppressed anyway: the host said it would draw a menu, and two is one too many.
        expect(e.defaultPrevented).toBe(true);

        const [event, items] = onGridContextMenu.mock.calls[0];
        expect(event.x).toBe(40);
        expect(items.map((i: MenuItem) => i.label)).toContain("Copy");
        // Already filtered — a host should not have to know what `invisible` means.
        expect(items.every((i: MenuItem) => !i.invisible)).toBe(true);
    });

    it("gives the host items that work when clicked", () => {
        let captured: MenuItem[] = [];
        const grid = create({
            rows: [...rows],
            onGridContextMenu: (_e, items) => (captured = items),
        });
        grid.selectRange(0, 0, 0, 0);
        rightClick(cell(grid, 0, 0));

        captured.find((i) => i.label === "Delete 1 row")?.onClick?.();
        expect(grid.getRows()).toHaveLength(2);
    });
});
