// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { VirtualList, type VirtualListItem, type VirtualListOptions } from "./VirtualList";

/**
 * happy-dom does no layout, so the engine would measure a zero viewport and render nothing.
 * Pinning the size on every element created while the list is being constructed gives it a
 * real one — the same trick `RenderGrid.test.ts` uses, and the reason a passing suite here
 * still says nothing about how the list *looks*. That is the board's job.
 */
function makeList(over: Partial<VirtualListOptions> = {}, height = 200): VirtualList {
    const originalCreate = document.createElement.bind(document);
    document.createElement = ((tag: string) => {
        const el = originalCreate(tag) as HTMLElement;
        Object.defineProperties(el, {
            offsetWidth: { value: 300, configurable: true },
            offsetHeight: { value: height, configurable: true },
            clientWidth: { value: 300, configurable: true },
            clientHeight: { value: height, configurable: true },
        });
        return el;
    }) as typeof document.createElement;

    let list: VirtualList;
    try {
        list = new VirtualList({ items: items(5), ...over });
    } finally {
        document.createElement = originalCreate;
    }
    document.body.append(list.element);
    lists.push(list);
    return list;
}

function items(count: number, prefix = "option"): VirtualListItem[] {
    return Array.from({ length: count }, (_v, i) => ({ value: i, label: `${prefix} ${i}` }));
}

const rows = (list: VirtualList): HTMLElement[] =>
    Array.from(list.element.querySelectorAll<HTMLElement>(".avg-list-item[data-index]"));

const rowAt = (list: VirtualList, index: number): HTMLElement => {
    const row = rows(list).find((r) => r.getAttribute("data-index") === String(index));
    if (!row) throw new Error(`row ${index} is not rendered`);
    return row;
};

const labels = (list: VirtualList): string[] =>
    rows(list)
        .sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index))
        .map((r) => r.textContent ?? "");

const click = (el: Element): void => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
};

const key = (list: VirtualList, k: string, target?: Element): void => {
    (target ?? list.element).dispatchEvent(
        new KeyboardEvent("keydown", { key: k, bubbles: true }),
    );
};

async function nextFrame(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    await Promise.resolve();
}

let lists: VirtualList[] = [];

afterEach(() => {
    lists.splice(0).forEach((l) => l.destroy());
    document.body.innerHTML = "";
});

describe("rendering", () => {
    it("renders the items it was given", () => {
        const list = makeList({ items: items(4) });
        expect(labels(list)).toEqual(["option 0", "option 1", "option 2", "option 3"]);
    });

    it("renders a window, not forty thousand rows", () => {
        const list = makeList({ items: items(40_000) });
        // The whole point of the task: a 200px-tall body holds ~8 rows plus overscan.
        expect(rows(list).length).toBeLessThan(50);
        expect(rows(list).length).toBeGreaterThan(0);
    });

    it("falls back to the value when an item has no label", () => {
        const list = makeList({ items: [{ value: "solo" }] });
        expect(labels(list)).toEqual(["solo"]);
    });

    it("shows the empty message when nothing matches", () => {
        const list = makeList({ items: items(3), emptyLabel: "nothing here" });
        const empty = list.element.querySelector<HTMLElement>(".avg-list-empty")!;
        expect(empty.style.display).toBe("none");

        list.setSearch("zzz");
        expect(empty.style.display).toBe("");
        expect(empty.textContent).toBe("nothing here");
    });
});

describe("selection", () => {
    it("toggles on click and reports the change", () => {
        const onChange = vi.fn();
        const list = makeList({ items: items(4), onChange });

        click(rowAt(list, 1));
        expect(list.getSelected()).toEqual([1]);
        expect(onChange).toHaveBeenLastCalledWith([1], [{ value: 1, label: "option 1" }]);

        click(rowAt(list, 1));
        expect(list.getSelected()).toEqual([]);
    });

    it("keeps the order values were picked in", () => {
        const list = makeList({ items: items(5) });
        click(rowAt(list, 3));
        click(rowAt(list, 0));
        click(rowAt(list, 4));
        expect(list.getSelected()).toEqual([3, 0, 4]);
    });

    it("marks a selected row in the DOM", async () => {
        const list = makeList({ items: items(4) });
        click(rowAt(list, 2));
        await nextFrame();
        expect(rowAt(list, 2).hasAttribute("data-selected")).toBe(true);
        expect(rowAt(list, 1).hasAttribute("data-selected")).toBe(false);
    });

    it("ignores a disabled item", () => {
        const list = makeList({ items: [{ value: 0, label: "a", disabled: true }] });
        click(rowAt(list, 0));
        expect(list.getSelected()).toEqual([]);
    });

    it("setSelected replaces the selection, and stays quiet unless asked", () => {
        const onChange = vi.fn();
        const list = makeList({ items: items(4), onChange });
        list.setSelected([2, 3]);
        expect(list.getSelected()).toEqual([2, 3]);
        expect(onChange).not.toHaveBeenCalled();

        list.setSelected([1], true);
        expect(onChange).toHaveBeenCalledWith([1], [{ value: 1, label: "option 1" }]);
    });

    it("de-duplicates what it is given", () => {
        const list = makeList({ items: items(4) });
        list.setSelected([2, 2, 3]);
        expect(list.getSelected()).toEqual([2, 3]);
    });

    it("resolves selected values back to their items", () => {
        const list = makeList({ items: items(3) });
        list.setSelected([1]);
        expect(list.getSelectedItems()).toEqual([{ value: 1, label: "option 1" }]);
    });

    it("keeps a value whose item is gone", () => {
        const list = makeList({ items: items(3) });
        list.setSelected([99]);
        // A filter can hold a value the current option set no longer offers; dropping it here
        // would silently widen the filter.
        expect(list.getSelectedItems()).toEqual([{ value: 99 }]);
    });
});

describe("single-pick mode", () => {
    it("replaces the selection and activates", () => {
        const onActivate = vi.fn();
        const onChange = vi.fn();
        const list = makeList({ items: items(4), multiple: false, onActivate, onChange });

        click(rowAt(list, 1));
        click(rowAt(list, 3));
        expect(list.getSelected()).toEqual([3]);
        expect(onActivate).toHaveBeenCalledTimes(2);
        expect(onChange).toHaveBeenLastCalledWith([3], [{ value: 3, label: "option 3" }]);
    });

    it("has no select-all row", () => {
        const list = makeList({ items: items(4), multiple: false });
        expect(list.element.querySelector(".avg-list-all")).toBeNull();
    });
});

describe("search", () => {
    it("narrows the rows", async () => {
        const list = makeList({ items: [{ value: "Ada" }, { value: "Alan" }, { value: "Grace" }] });
        list.setSearch("a");
        await nextFrame();
        expect(labels(list)).toEqual(["Ada", "Alan", "Grace"]);

        list.setSearch("al");
        await nextFrame();
        expect(labels(list)).toEqual(["Alan"]);
    });

    it("matches case-insensitively on the label", async () => {
        const list = makeList({ items: [{ value: 1, label: "North" }, { value: 2, label: "South" }] });
        list.setSearch("NOR");
        await nextFrame();
        expect(labels(list)).toEqual(["North"]);
    });

    it("filters as the box is typed into", () => {
        const list = makeList({ items: items(20) });
        const input = list.element.querySelector<HTMLInputElement>(".avg-list-search")!;
        input.value = "option 1";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        // "option 1" also matches 10-19.
        expect(list.getVisibleItems().length).toBe(11);
    });

    it("hands filtering to the host when onSearch is set", () => {
        const onSearch = vi.fn();
        const list = makeList({ items: items(5), onSearch });
        const input = list.element.querySelector<HTMLInputElement>(".avg-list-search")!;
        input.value = "zzz";
        input.dispatchEvent(new Event("input", { bubbles: true }));

        expect(onSearch).toHaveBeenCalledWith("zzz");
        // The list shows what it was given; the host narrows the options at the source.
        expect(list.getVisibleItems().length).toBe(5);
    });

    it("can be left out entirely", () => {
        const list = makeList({ items: items(3), search: false });
        expect(list.element.querySelector(".avg-list-search")).toBeNull();
    });

    it("can be hidden and shown again, and hiding clears it", async () => {
        const list = makeList({ items: items(20) });
        const input = list.element.querySelector<HTMLInputElement>(".avg-list-search")!;
        list.setSearch("option 1");
        expect(list.getVisibleItems().length).toBe(11);

        list.setSearchVisible(false);
        expect(list.searchVisible).toBe(false);
        expect(input.style.display).toBe("none");
        // No text the user can no longer see keeps narrowing the rows.
        expect(list.search).toBe("");
        expect(list.getVisibleItems().length).toBe(20);

        list.setSearchVisible(true);
        expect(list.searchVisible).toBe(true);
        expect(input.style.display).toBe("");
    });

    it("keeps focus inside the list when the box it was in is hidden", () => {
        const list = makeList({ items: items(3) });
        list.focus();
        expect(document.activeElement?.classList.contains("avg-list-search")).toBe(true);

        list.setSearchVisible(false);
        expect(list.element.contains(document.activeElement)).toBe(true);
        expect(document.activeElement?.classList.contains("avg-list-search")).toBe(false);
    });

    it("ignores setSearchVisible on a list built without one", () => {
        const list = makeList({ items: items(3), search: false });
        list.setSearchVisible(true);
        expect(list.searchVisible).toBe(false);
        expect(list.element.querySelector(".avg-list-search")).toBeNull();
    });

    it("keeps a selection made under a different search", () => {
        const list = makeList({ items: [{ value: 1, label: "north" }, { value: 2, label: "south" }] });
        list.setSearch("north");
        click(rowAt(list, 0));
        list.setSearch("");
        expect(list.getSelected()).toEqual([1]);
    });
});

describe("select all", () => {
    const boxState = (list: VirtualList): string | null =>
        list.element.querySelector(".avg-list-all")?.getAttribute("data-state") ?? null;

    it("selects and clears everything", () => {
        const list = makeList({ items: items(5) });
        click(list.element.querySelector(".avg-list-all")!);
        expect(list.getSelected()).toEqual([0, 1, 2, 3, 4]);
        expect(boxState(list)).toBe("all");

        click(list.element.querySelector(".avg-list-all")!);
        expect(list.getSelected()).toEqual([]);
        expect(boxState(list)).toBe("none");
    });

    it("goes indeterminate for a partial selection", () => {
        const list = makeList({ items: items(5) });
        click(rowAt(list, 0));
        expect(boxState(list)).toBe("some");
    });

    it("applies to the rows the search is showing, and only those", () => {
        const list = makeList({
            items: [
                { value: 1, label: "north" },
                { value: 2, label: "northeast" },
                { value: 3, label: "south" },
            ],
        });
        list.setSearch("north");
        click(list.element.querySelector(".avg-list-all")!);
        expect(list.getSelected()).toEqual([1, 2]);

        // Ported from MultiListBox: clearing the search must not claim everything is selected.
        list.setSearch("");
        expect(boxState(list)).toBe("some");
    });

    it("clears only the visible rows", () => {
        const list = makeList({
            items: [
                { value: 1, label: "north" },
                { value: 2, label: "south" },
            ],
        });
        list.setSelected([1, 2]);
        list.setSearch("north");
        click(list.element.querySelector(".avg-list-all")!);
        expect(list.getSelected()).toEqual([2]);
    });

    it("skips disabled items", () => {
        const list = makeList({
            items: [
                { value: 1, label: "a" },
                { value: 2, label: "b", disabled: true },
            ],
        });
        click(list.element.querySelector(".avg-list-all")!);
        expect(list.getSelected()).toEqual([1]);
    });
});

describe("the keyboard", () => {
    /**
     * Asserted on `activeIndex` rather than on `[data-active]` in the DOM: moving the active
     * row scrolls it into view, and happy-dom's scrollTop assignment produces no scroll and no
     * layout, so a row past the initial window is simply never rendered here. The one DOM
     * check below covers the attribute itself.
     */
    it("marks the active row in the DOM", async () => {
        const list = makeList({ items: items(10) });
        key(list, "ArrowDown");
        await nextFrame();
        expect(rowAt(list, 1).hasAttribute("data-active")).toBe(true);
        expect(rowAt(list, 0).hasAttribute("data-active")).toBe(false);
    });

    it("moves with the arrows and stops at both ends", () => {
        const list = makeList({ items: items(10) });
        key(list, "ArrowDown");
        expect(list.activeIndex).toBe(1);

        key(list, "ArrowUp");
        key(list, "ArrowUp");
        expect(list.activeIndex).toBe(0);

        for (let i = 0; i < 20; i++) key(list, "ArrowDown");
        expect(list.activeIndex).toBe(9);
    });

    it("jumps to the ends with Home and End", () => {
        const list = makeList({ items: items(10) });
        key(list, "End");
        expect(list.activeIndex).toBe(9);
        key(list, "Home");
        expect(list.activeIndex).toBe(0);
    });

    it("pages", () => {
        const list = makeList({ items: items(200) });
        key(list, "PageDown");
        expect(list.activeIndex).toBeGreaterThan(1);
        const down = list.activeIndex;
        key(list, "PageUp");
        expect(list.activeIndex).toBeLessThan(down);
    });

    it("toggles the active row with Space and Enter", () => {
        const list = makeList({ items: items(5) });
        key(list, "ArrowDown");
        key(list, " ");
        expect(list.getSelected()).toEqual([1]);
        key(list, "Enter");
        expect(list.getSelected()).toEqual([]);
    });

    it("lets Space through when it is being typed into the search box", () => {
        const list = makeList({ items: items(5) });
        const input = list.element.querySelector<HTMLInputElement>(".avg-list-search")!;
        key(list, " ", input);
        // Typing "new york" must be possible in a searchable list.
        expect(list.getSelected()).toEqual([]);
    });

    it("activates on Enter", () => {
        const onActivate = vi.fn();
        const list = makeList({ items: items(5), onActivate });
        key(list, "Enter");
        expect(onActivate).toHaveBeenCalledWith({ value: 0, label: "option 0" });
    });

    it("does nothing on an empty list", () => {
        const list = makeList({ items: [] });
        expect(() => key(list, "ArrowDown")).not.toThrow();
        expect(list.getSelected()).toEqual([]);
    });
});

describe("moveActive", () => {
    it("moves by rows, clamped to the ends", () => {
        const list = makeList({ items: items(10) });
        list.moveActive(3);
        expect(list.activeIndex).toBe(3);
        list.moveActive(-1);
        expect(list.activeIndex).toBe(2);
        list.moveActive(100);
        expect(list.activeIndex).toBe(9);
        list.moveActive(-100);
        expect(list.activeIndex).toBe(0);
    });

    it("goes to the ends, and pages", () => {
        const list = makeList({ items: items(200) });
        list.moveActive("last");
        expect(list.activeIndex).toBe(199);
        list.moveActive("first");
        expect(list.activeIndex).toBe(0);
        list.moveActive("pageDown");
        const page = list.activeIndex;
        expect(page).toBeGreaterThan(1);
        list.moveActive("pageUp");
        expect(list.activeIndex).toBe(0);
    });

    it("lands on a row from no highlight at all", () => {
        const list = makeList({ items: items(10) });
        list.setActiveIndex(-1);
        expect(list.activeIndex).toBe(-1);
        list.moveActive(1);
        expect(list.activeIndex).toBe(0);
        list.setActiveIndex(-1);
        list.moveActive("last");
        expect(list.activeIndex).toBe(9);
    });

    it("does nothing on an empty list", () => {
        const list = makeList({ items: [] });
        list.moveActive(1);
        expect(list.activeIndex).toBe(-1);
    });
});

describe("listbox semantics, single-pick only", () => {
    it("gives a single-pick list a listbox with option rows", async () => {
        const list = makeList({ items: items(5), multiple: false, selected: [1] });
        await nextFrame();
        const listbox = list.element.querySelector('[role="listbox"]')!;
        expect(listbox).not.toBeNull();
        expect(listbox.id).toBe(list.listId);
        for (const row of rows(list)) {
            const index = Number(row.dataset.index);
            expect(row.getAttribute("role")).toBe("option");
            expect(row.id).toBe(list.optionId(index));
            expect(row.getAttribute("aria-selected")).toBe(index === 1 ? "true" : "false");
        }
    });

    it("gives every list its own ids", () => {
        const a = makeList({ multiple: false });
        const b = makeList({ multiple: false });
        expect(a.listId).not.toBe(b.listId);
        expect(a.optionId(0)).not.toBe(b.optionId(0));
    });

    it("leaves a checklist exactly as it was — no roles, no ids", async () => {
        const list = makeList({ items: items(5), selected: [1] });
        await nextFrame();
        expect(list.element.querySelector("[role]")).toBeNull();
        expect(list.listId).toBeUndefined();
        expect(list.optionId(0)).toBeUndefined();
        for (const row of rows(list)) {
            expect(row.id).toBe("");
            expect(row.hasAttribute("aria-selected")).toBe(false);
        }
    });

    it("rewrites a recycled row's id and aria-selected — a pooled row arrives dirty", async () => {
        const list = makeList({ items: items(500), multiple: false, selected: [0, 1, 2] }, 100);
        await nextFrame();
        const seen = new Set(rows(list));
        expect(rows(list).some((r) => r.getAttribute("aria-selected") === "true")).toBe(true);

        const scroller = list.render.container;
        for (const y of [41, 97, 300, 2400, 6000]) {
            scroller.scrollTop = y;
            scroller.dispatchEvent(new Event("scroll"));
            await nextFrame();
        }

        const now = rows(list);
        // The window moved far past the first rows, so the elements on screen were handed on.
        expect(now.some((r) => seen.has(r))).toBe(true);
        for (const row of now) {
            const index = Number(row.dataset.index);
            expect(index).toBeGreaterThan(2);
            expect(row.id).toBe(list.optionId(index));
            expect(row.getAttribute("aria-selected")).toBe("false");
        }
    });

    it("reports no option id for an index without a row", () => {
        const list = makeList({ items: items(3), multiple: false });
        expect(list.optionId(-1)).toBeUndefined();
        expect(list.optionId(3)).toBeUndefined();
        list.setSearch("option 2");
        expect(list.optionId(0)).toBe(`${list.listId}-0`);
        expect(list.optionId(1)).toBeUndefined();
    });
});

describe("updating items", () => {
    it("re-renders on setItems", async () => {
        const list = makeList({ items: items(3) });
        list.setItems(items(2, "other"));
        // The repaint is frame-scheduled — the model knows immediately, the DOM next frame.
        expect(list.getVisibleItems().length).toBe(2);
        await nextFrame();
        expect(labels(list)).toEqual(["other 0", "other 1"]);
    });

    it("keeps the selection across a setItems", () => {
        const list = makeList({ items: items(3) });
        click(rowAt(list, 1));
        list.setItems(items(5));
        expect(list.getSelected()).toEqual([1]);
    });
});

describe("teardown", () => {
    it("takes its DOM with it", () => {
        const list = makeList({ items: items(3) });
        list.destroy();
        expect(document.body.contains(list.element)).toBe(false);
    });
});

describe("height", () => {
    it("is exactly its rows — no trailing whitespace a caller sized to them would scroll", async () => {
        const list = makeList({ items: items(3) });
        await nextFrame();
        expect(list.render.model.renderInfo.current.innerSize.height).toBe(3 * 24);
    });
});
