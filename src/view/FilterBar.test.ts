// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { AVGrid } from "../AVGrid";
import type { AVGridOptions } from "../options";
import { optionsFilterValues } from "./FilterBar";

/** See `FilterPopover.test.ts` — happy-dom does no layout, so elements are given a size. */
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
    { id: 1, name: "Ada", status: "open", team: "platform" },
    { id: 2, name: "Alan", status: "done", team: "platform" },
    { id: 3, name: "Grace", status: "open", team: "data" },
    { id: 4, name: "Edsger", status: "", team: "data" },
];

const grids: AVGrid<any>[] = [];

function create<R>(options: AVGridOptions<R>): AVGrid<R> {
    const host = document.createElement("div");
    document.body.append(host);
    const grid = withLayout(() => AVGrid.create<R>(host, options));
    grids.push(grid);
    return grid;
}

const settle = (): Promise<void> =>
    new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );

const click = (el: Element): void => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
};

const bars = (): HTMLElement[] =>
    Array.from(document.body.querySelectorAll<HTMLElement>('[data-type="filter-bar"]'));

const bar = (): HTMLElement => {
    const el = bars()[0];
    if (!el) throw new Error("no filter bar in the document");
    return el;
};

/** Every chip's text, as `Name: values`. Column names are inferred capitalized. */
const chipTexts = (root: HTMLElement = bar()): string[] =>
    Array.from(root.querySelectorAll<HTMLElement>(".avg-filter-chip")).map((c) =>
        [
            c.querySelector(".avg-filter-chip-name")?.textContent ?? "",
            c.querySelector(".avg-filter-chip-values")?.textContent ?? "",
        ].join(" "),
    );

const chip = (columnKey: string, root: HTMLElement = bar()): HTMLElement => {
    const el = root.querySelector<HTMLElement>(
        `.avg-filter-chip[data-column-key="${columnKey}"]`,
    );
    if (!el) throw new Error(`no chip for "${columnKey}" in ${chipTexts(root).join(" | ")}`);
    return el;
};

const chipBody = (columnKey: string, root: HTMLElement = bar()): HTMLElement =>
    chip(columnKey, root).querySelector<HTMLElement>(".avg-filter-chip-body")!;

const popover = (): HTMLElement | null =>
    document.body.querySelector(".avg-filter-popover");

afterEach(() => {
    grids.splice(0).forEach((g) => g.destroy());
    document.body.innerHTML = "";
    vi.restoreAllMocks();
});

describe("the value label", () => {
    const filter = (values: any[], displayFormat?: any) => ({
        columnKey: "c",
        displayFormat,
        value: values.map((v) => ({ value: v, label: String(v) })),
    });

    it("joins the values with commas", () => {
        expect(optionsFilterValues(filter(["open", "done"]), 25)).toBe("open,done");
    });

    it("counts the overflow it could not fit", () => {
        const values = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];
        // Four values plus their commas is exactly the budget, so the last two become a count.
        expect(optionsFilterValues(filter(values), 25)).toBe(
            "alpha,bravo,charlie,delta (+2)",
        );
    });

    it("cuts a single long value at the budget", () => {
        expect(optionsFilterValues(filter(["a".repeat(40)]), 25)).toBe("a".repeat(25));
    });

    it("names a blank value rather than showing a gap", () => {
        expect(optionsFilterValues(filter([""]), 25)).toBe("(empty)");
    });

    it("formats a Date from its value, not from its label", () => {
        const date = new Date(2024, 0, 2);
        const value = [{ value: date, label: "(null)" }];
        expect(optionsFilterValues({ columnKey: "c", displayFormat: "date", value }, 25)).toBe(
            date.toLocaleDateString(),
        );
    });

    it("is empty for a filter with no value", () => {
        expect(optionsFilterValues({ columnKey: "c" }, 25)).toBe("");
    });
});

describe("mounting", () => {
    it("adds no bar unless asked", () => {
        create({ rows, filters: [{ columnKey: "status", value: ["open"] }] });
        expect(bars()).toHaveLength(0);
    });

    it("mounts above the grid with filterBar: true", () => {
        const grid = create({ rows, filterBar: true });
        const wrap = grid.element.parentElement!;
        expect(wrap.className).toBe("avg-grid-wrap");
        expect(wrap.firstElementChild).toBe(grid.getFilterBar()!.element);
        expect(wrap.children[1]).toBe(grid.element);
    });

    it("takes no space until something is filtered", () => {
        const grid = create({ rows, filterBar: true });
        const el = grid.getFilterBar()!.element;
        expect(el.classList.contains("avg-filter-bar-empty")).toBe(true);

        grid.applyFilter({ columnKey: "status", value: ["open"] });
        expect(el.classList.contains("avg-filter-bar-empty")).toBe(false);

        grid.clearFilters();
        expect(el.classList.contains("avg-filter-bar-empty")).toBe(true);
    });

    it("shows the filters a grid was created with", () => {
        const grid = create({
            rows,
            filterBar: true,
            filters: [{ columnKey: "status", value: ["open"] }],
        });
        expect(chipTexts(grid.getFilterBar()!.element)).toEqual(["Status: open"]);
    });

    it("mounts anywhere through createFilterBar", () => {
        const grid = create({ rows });
        const host = document.createElement("div");
        document.body.append(host);

        const standalone = AVGrid.createFilterBar(host, { grid, name: "toolbar" });
        grid.applyFilter({ columnKey: "team", value: ["data"] });

        expect(host.firstElementChild).toBe(standalone.element);
        expect(standalone.element.getAttribute("data-name")).toBe("toolbar");
        expect(chipTexts(standalone.element)).toEqual(["Team: data"]);
        standalone.destroy();
    });

    it("refuses a bar with no grid", () => {
        const host = document.createElement("div");
        expect(() => AVGrid.createFilterBar(host, {} as any)).toThrow(/grid/);
    });

    it("keeps two grids' bars apart", () => {
        const a = create({ rows, filterBar: true });
        const b = create({ rows, filterBar: true });

        a.applyFilter({ columnKey: "status", value: ["open"] });
        b.applyFilter({ columnKey: "team", value: ["data"] });

        expect(chipTexts(a.getFilterBar()!.element)).toEqual(["Status: open"]);
        expect(chipTexts(b.getFilterBar()!.element)).toEqual(["Team: data"]);
    });

    it("lets one grid have two bars, both live", () => {
        const grid = create({ rows, filterBar: true });
        const host = document.createElement("div");
        document.body.append(host);
        const second = AVGrid.createFilterBar(host, { grid });

        grid.applyFilter({ columnKey: "status", value: ["open"] });
        expect(chipTexts(grid.getFilterBar()!.element)).toEqual(["Status: open"]);
        expect(chipTexts(second.element)).toEqual(["Status: open"]);

        // And either of them can edit: removing from the second updates the first.
        click(second.element.querySelector('[data-action="remove"]')!);
        expect(chipTexts(grid.getFilterBar()!.element)).toEqual([]);
        second.destroy();
    });

    it("goes away with the grid", () => {
        const grid = create({ rows, filterBar: true });
        const el = grid.getFilterBar()!.element;
        grids.splice(grids.indexOf(grid), 1);
        grid.destroy();
        expect(el.isConnected).toBe(false);
        expect(document.body.querySelector(".avg-grid-wrap")).toBeNull();
    });

    it("can be turned off later, and back on", () => {
        const grid = create({ rows, filterBar: true });
        grid.setOptions({ filterBar: false });
        expect(bars()).toHaveLength(0);

        grid.setOptions({ filterBar: true });
        expect(bars()).toHaveLength(1);
    });

    it("says where to get a bar for a grid created without one", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const grid = create({ rows });
        grid.setOptions({ filterBar: true });

        expect(bars()).toHaveLength(0);
        expect(warn.mock.calls[0][0]).toMatch(/createFilterBar/);
    });
});

describe("chips", () => {
    it("shows one chip per filter, named by the column", () => {
        const grid = create({ rows, filterBar: true });
        grid.setFilters([
            { columnKey: "status", value: ["open", "done"] },
            { columnKey: "team", value: ["data"] },
        ]);
        expect(chipTexts()).toEqual(["Status: open,done", "Team: data"]);
    });

    it("uses the name the column was given", () => {
        const grid = create({
            rows,
            filterBar: true,
            columns: [{ key: "status", name: "State" }],
        });
        grid.applyFilter({ columnKey: "status", value: ["open"] });
        expect(chipTexts()).toEqual(["State: open"]);
    });

    it("puts every value in the title, however many the label showed", () => {
        const grid = create({ rows, filterBar: true });
        grid.applyFilter({
            columnKey: "name",
            value: ["Ada", "Alan", "Grace", "Edsger", "Barbara"],
        });
        expect(chipBody("name").title).toBe("Name: Ada, Alan, Grace, Edsger, Barbara");
    });

    it("removes one filter from its own remove button", () => {
        const grid = create({ rows, filterBar: true });
        grid.setFilters([
            { columnKey: "status", value: ["open"] },
            { columnKey: "team", value: ["data"] },
        ]);
        click(chip("status").querySelector('[data-action="remove"]')!);

        expect(chipTexts()).toEqual(["Team: data"]);
        expect(grid.getFilters().map((f) => f.columnKey)).toEqual(["team"]);
    });

    it("removes them all from the bar's remove-all button", () => {
        const grid = create({ rows, filterBar: true });
        grid.setFilters([
            { columnKey: "status", value: ["open"] },
            { columnKey: "team", value: ["data"] },
        ]);
        click(bar().querySelector('[data-action="clear-all"]')!);

        expect(grid.getFilters()).toEqual([]);
        expect(chipTexts()).toEqual([]);
    });

    it("keeps a chip element that has not changed", () => {
        const grid = create({ rows, filterBar: true });
        grid.applyFilter({ columnKey: "status", value: ["open"] });
        const before = chip("status");

        grid.applyFilter({ columnKey: "team", value: ["data"] });
        // A second filter redraws the bar, and the first chip is the same element — which is
        // what keeps an open popover's anchor in the document.
        expect(chip("status")).toBe(before);
        expect(chip("team")).not.toBe(before);
    });

    it("rebuilds a chip whose value changed", () => {
        const grid = create({ rows, filterBar: true });
        grid.applyFilter({ columnKey: "status", value: ["open"] });
        const before = chip("status");

        grid.applyFilter({ columnKey: "status", value: ["done"] });
        expect(chip("status")).not.toBe(before);
        expect(chipTexts()).toEqual(["Status: done"]);
    });

    it("tracks a filter applied from anywhere at all", () => {
        const grid = create({ rows, filterBar: true });
        // Not through the bar and not through the popover — the model is the single source.
        grid.model.models.filters.applyFilter({ columnKey: "team", value: ["data"] });
        expect(chipTexts()).toEqual(["Team: data"]);
    });

    it("leaves the host's own onFiltersChange alone", () => {
        const onFiltersChange = vi.fn();
        const grid = create({ rows, filterBar: true, onFiltersChange });
        grid.applyFilter({ columnKey: "status", value: ["open"] });

        expect(onFiltersChange).toHaveBeenCalledTimes(1);
        expect(chipTexts()).toEqual(["Status: open"]);
    });
});

describe("editing from a chip", () => {
    it("opens the popover anchored to the chip", async () => {
        const grid = create({ rows, filterBar: true });
        grid.applyFilter({ columnKey: "status", value: ["open"] });

        withLayout(() => click(chipBody("status")));
        await settle();

        expect(popover()).not.toBeNull();
        expect(grid.model.flags.filterPopover?.columnKey).toBe("status");
        // The chip stays lit, and its caret turns over, while its popover is open.
        expect(chip("status").classList.contains("avg-filter-chip-open")).toBe(true);
    });

    it("puts the chip out again when the popover closes", async () => {
        const grid = create({ rows, filterBar: true });
        grid.applyFilter({ columnKey: "status", value: ["open"] });

        withLayout(() => click(chipBody("status")));
        await settle();
        grid.model.flags.filterPopover!.close();
        await settle();

        expect(popover()).toBeNull();
        expect(chip("status").classList.contains("avg-filter-chip-open")).toBe(false);
    });

    it("closes on a second click instead of reopening", async () => {
        const grid = create({ rows, filterBar: true });
        grid.applyFilter({ columnKey: "status", value: ["open"] });

        withLayout(() => click(chipBody("status")));
        await settle();
        withLayout(() => click(chipBody("status")));
        await settle();

        expect(popover()).toBeNull();
    });

    it("applies a changed selection back to the grid", async () => {
        const grid = create({ rows, filterBar: true });
        grid.applyFilter({ columnKey: "status", value: ["open"] });
        expect(grid.getVisibleRows()).toHaveLength(2);

        withLayout(() => click(chipBody("status")));
        await settle();

        const row = Array.from(
            document.body.querySelectorAll<HTMLElement>(
                ".avg-filter-popover .avg-list-item[data-index]",
            ),
        ).find((r) => r.textContent === "done");
        click(row!);
        click(document.body.querySelector('[data-action="apply"]')!);
        await settle();

        expect(grid.getFilters()[0].value.map((o: any) => o.value)).toEqual([
            "open",
            "done",
        ]);
        expect(chipTexts()).toEqual(["Status: open,done"]);
        expect(popover()).toBeNull();
    });

    it("removes the filter when the chip's remove button is clicked over an open popover", async () => {
        const grid = create({ rows, filterBar: true });
        grid.applyFilter({ columnKey: "status", value: ["open"] });

        withLayout(() => click(chipBody("status")));
        await settle();
        // The remove button is outside the popover's anchor, so it dismisses as well as removes.
        click(chip("status").querySelector('[data-action="remove"]')!);
        await settle();

        expect(grid.getFilters()).toEqual([]);
        expect(chipTexts()).toEqual([]);
    });

    it("closes its popover when the bar is destroyed under it", async () => {
        const grid = create({ rows });
        const host = document.createElement("div");
        document.body.append(host);
        const standalone = AVGrid.createFilterBar(host, { grid });
        grid.applyFilter({ columnKey: "status", value: ["open"] });

        withLayout(() => click(chipBody("status", standalone.element)));
        await settle();
        standalone.destroy();
        await settle();

        expect(popover()).toBeNull();
        expect(grid.model.flags.filterPopover).toBeUndefined();
    });
});
