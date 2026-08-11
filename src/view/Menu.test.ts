// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { Menu, MENU_SEARCH_THRESHOLD, MENU_SUBMENU_DELAY_MS, showMenu } from "./Menu";
import type { MenuItem } from "../types";

/**
 * happy-dom does no layout, so nothing here checks where a menu lands — `Popover.test.ts`
 * covers the placement arithmetic and the board covers whether it looks right. What is testable
 * here is what a menu *is*: which rows it draws, which one the keys are on, and what the
 * promise resolves with.
 */

const open: Menu[] = [];
function make(items: MenuItem[], anchor = { x: 10, y: 10 }): Menu {
    const menu = new Menu({ anchor, items });
    open.push(menu);
    return menu;
}

function rows(): HTMLElement[] {
    return Array.from(document.querySelectorAll('[data-type="menu-item"]'));
}

function labels(): string[] {
    return rows().map((r) => r.querySelector(".avg-menu-label")?.textContent ?? "");
}

function key(name: string): void {
    const root = document.querySelector(".avg-menu") as HTMLElement;
    root.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
}

afterEach(() => {
    open.splice(0).forEach((m) => m.close());
    document.body.innerHTML = "";
    vi.useRealTimers();
});

describe("rows", () => {
    it("draws a row per visible item, with its hotkey", () => {
        const menu = make([
            { label: "Copy", hotKey: "(Ctrl+C)" },
            { label: "Paste", invisible: true },
            { label: "Delete" },
        ]);
        void menu.show();

        expect(labels()).toEqual(["Copy", "Delete"]);
        expect(rows()[0].querySelector(".avg-menu-hotkey")?.textContent).toBe("(Ctrl+C)");
    });

    it("passes a hidden item's separator to the next visible one", () => {
        const menu = make([
            { label: "First" },
            { label: "Hidden", invisible: true, startGroup: true },
            { label: "Second" },
        ]);
        void menu.show();

        expect(rows()[1].hasAttribute("data-start-group")).toBe(true);
    });

    it("never draws a separator above the first row", () => {
        const menu = make([{ label: "First", startGroup: true }, { label: "Second" }]);
        void menu.show();

        expect(rows()[0].hasAttribute("data-start-group")).toBe(false);
    });

    it("marks the selected item and starts the keyboard on it", () => {
        const menu = make([{ label: "Asc" }, { label: "Desc", selected: true }]);
        void menu.show();

        expect(rows()[1].querySelector(".avg-menu-check")).not.toBeNull();
        expect(rows()[1].hasAttribute("data-active")).toBe(true);
    });
});

describe("picking", () => {
    it("runs the item and resolves with it", async () => {
        const onClick = vi.fn();
        const menu = make([{ label: "Copy", onClick }]);
        const closed = menu.show();

        rows()[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onClick).toHaveBeenCalledOnce();
        expect(await closed).toEqual(expect.objectContaining({ label: "Copy" }));
        expect(document.querySelector(".avg-menu")).toBeNull();
    });

    it("resolves undefined when it is dismissed", async () => {
        const menu = make([{ label: "Copy" }]);
        const closed = menu.show();

        menu.close();
        expect(await closed).toBeUndefined();
    });

    it("ignores a disabled item", async () => {
        const onClick = vi.fn();
        const menu = make([{ label: "Paste", disabled: true, onClick }]);
        void menu.show();

        rows()[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onClick).not.toHaveBeenCalled();
        expect(menu.isOpen).toBe(true);
    });

    it("runs the item before the menu closes, so it can read the grid's state", async () => {
        let openWhenRun: boolean | undefined;
        const menu = make([
            { label: "Copy", onClick: () => (openWhenRun = menu.isOpen) },
        ]);
        void menu.show();

        rows()[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(openWhenRun).toBe(true);
    });
});

describe("keyboard", () => {
    it("moves the highlight with the arrows and picks with Enter", async () => {
        const onClick = vi.fn();
        const menu = make([{ label: "One" }, { label: "Two", onClick }]);
        const closed = menu.show();

        key("ArrowDown");
        expect(rows()[0].hasAttribute("data-active")).toBe(true);
        key("ArrowDown");
        expect(rows()[1].hasAttribute("data-active")).toBe(true);
        key("ArrowUp");
        expect(rows()[0].hasAttribute("data-active")).toBe(true);

        key("ArrowDown");
        key("Enter");
        expect(onClick).toHaveBeenCalledOnce();
        expect(await closed).toEqual(expect.objectContaining({ label: "Two" }));
    });

    it("stops at both ends rather than wrapping", () => {
        const menu = make([{ label: "One" }, { label: "Two" }]);
        void menu.show();

        key("ArrowUp");
        key("ArrowUp");
        expect(rows()[0].hasAttribute("data-active")).toBe(true);
        key("End");
        key("ArrowDown");
        expect(rows()[1].hasAttribute("data-active")).toBe(true);
    });
});

describe("search", () => {
    const many = (count: number): MenuItem[] =>
        Array.from({ length: count }, (_, i) => ({ label: `Item ${i}` }));

    it("stays out of the way until there are enough items to need it", () => {
        const small = make(many(MENU_SEARCH_THRESHOLD));
        void small.show();
        expect(document.querySelector(".avg-menu-search")).toBeNull();
        small.close();

        const big = make(many(MENU_SEARCH_THRESHOLD + 1));
        void big.show();
        expect(document.querySelector(".avg-menu-search")).not.toBeNull();
    });

    it("narrows the rows, and Enter takes the only match", async () => {
        const onClick = vi.fn();
        const items = many(MENU_SEARCH_THRESHOLD + 1);
        items[7] = { label: "Unique", onClick };
        const menu = make(items);
        const closed = menu.show();

        const search = document.querySelector(".avg-menu-search") as HTMLInputElement;
        search.value = "uniq";
        search.dispatchEvent(new Event("input", { bubbles: true }));

        expect(labels()).toEqual(["Unique"]);
        key("Enter");
        expect(onClick).toHaveBeenCalledOnce();
        expect(await closed).toEqual(expect.objectContaining({ label: "Unique" }));
    });
});

describe("submenus", () => {
    const nested: MenuItem[] = [
        { label: "Copy" },
        { label: "Copy as...", items: [{ label: "JSON" }, { label: "CSV" }] },
    ];

    it("opens on ArrowRight and closes on ArrowLeft, leaving the parent up", () => {
        const menu = make(nested);
        void menu.show();

        key("ArrowDown");
        key("ArrowDown");
        key("ArrowRight");
        expect(document.querySelectorAll(".avg-menu")).toHaveLength(2);

        // The submenu is the one with the focus, so the key goes to its root.
        const sub = document.querySelectorAll(".avg-menu")[1] as HTMLElement;
        sub.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));

        expect(document.querySelectorAll(".avg-menu")).toHaveLength(1);
        expect(menu.isOpen).toBe(true);
    });

    it("opens on a click without waiting for the hover delay", () => {
        const menu = make(nested);
        void menu.show();

        rows()[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(document.querySelectorAll(".avg-menu")).toHaveLength(2);
        expect(menu.isOpen).toBe(true);
    });

    it("opens on hover only after the delay", () => {
        vi.useFakeTimers();
        const menu = make(nested);
        void menu.show();

        rows()[1].dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        vi.advanceTimersByTime(MENU_SUBMENU_DELAY_MS - 1);
        expect(document.querySelectorAll(".avg-menu")).toHaveLength(1);

        vi.advanceTimersByTime(1);
        expect(document.querySelectorAll(".avg-menu")).toHaveLength(2);
    });

    it("takes the whole chain down when a leaf is picked", async () => {
        const onClick = vi.fn();
        const menu = make([
            { label: "Copy as...", items: [{ label: "JSON", onClick }] },
        ]);
        const closed = menu.show();

        rows()[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
        const leaf = document.querySelectorAll('[data-type="menu-item"]')[1] as HTMLElement;
        leaf.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onClick).toHaveBeenCalledOnce();
        expect(await closed).toEqual(expect.objectContaining({ label: "JSON" }));
        expect(document.querySelector(".avg-menu")).toBeNull();
    });

    it("closes a submenu when the pointer moves to a different item", () => {
        const menu = make(nested);
        void menu.show();

        rows()[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(document.querySelectorAll(".avg-menu")).toHaveLength(2);

        rows()[0].dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        expect(document.querySelectorAll(".avg-menu")).toHaveLength(1);
    });
});

describe("showMenu", () => {
    it("mounts and resolves in one call", async () => {
        const closed = showMenu({ anchor: { x: 0, y: 0 }, items: [{ label: "Only" }] });
        expect(document.querySelector(".avg-menu")).not.toBeNull();

        rows()[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(await closed).toEqual(expect.objectContaining({ label: "Only" }));
    });
});
