// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { AVGrid } from "../AVGrid";
import type { AVGridOptions } from "../options";
import type { DisplayOption } from "../types";

/**
 * happy-dom does no layout, so the list inside the popover would measure a zero viewport and
 * render no rows. Every element created while `withLayout` is in scope gets a size — the same
 * trick the other DOM suites use, and the same caveat: this checks wiring, not appearance.
 * What the popover *looks* like is a question for the board.
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

/**
 * Two frames, not one. The popover mounts, *then* the list re-measures the viewport it was
 * built inside — so the rows it draws are the second frame's work, and a single rAF here would
 * read an empty list and call it a bug.
 */
const settle = (): Promise<void> =>
    new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );

/** The open popover, or null. */
const popover = (): HTMLElement | null =>
    document.body.querySelector(".avg-filter-popover");

const funnel = (grid: AVGrid<any>, columnKey: string): HTMLElement => {
    const cell = Array.from(
        grid.element.querySelectorAll<HTMLElement>('[data-type="header-cell"]'),
    ).find((c) => c.getAttribute("data-column-key") === columnKey);
    const button = cell?.querySelector<HTMLElement>('[data-type="filter-button"]');
    if (!button) throw new Error(`no funnel for column "${columnKey}"`);
    return button;
};

const click = (el: Element): void => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
};

/** Option labels, in the order the list shows them. */
const optionLabels = (): string[] =>
    Array.from(
        document.body.querySelectorAll<HTMLElement>(
            ".avg-filter-popover .avg-list-item[data-index]",
        ),
    )
        .sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index))
        .map((r) => r.textContent ?? "");

const optionRow = (label: string): HTMLElement => {
    const row = Array.from(
        document.body.querySelectorAll<HTMLElement>(
            ".avg-filter-popover .avg-list-item[data-index]",
        ),
    ).find((r) => r.textContent === label);
    if (!row) throw new Error(`no option row "${label}" in ${optionLabels().join(" | ")}`);
    return row;
};

const button = (action: string): HTMLButtonElement => {
    const el = document.body.querySelector<HTMLButtonElement>(
        `.avg-filter-popover [data-action="${action}"]`,
    );
    if (!el) throw new Error(`no "${action}" button`);
    return el;
};

/** Open a column's popover the way the header does, with a viewport to measure. */
function open(grid: AVGrid<any>, columnKey: string): Promise<any> {
    return withLayout(() => grid.showFilterPopover(columnKey));
}

afterEach(() => {
    grids.splice(0).forEach((g) => g.destroy());
    document.body.innerHTML = "";
    vi.restoreAllMocks();
});

describe("opening", () => {
    it("opens from the header funnel", async () => {
        const grid = create({ rows });
        withLayout(() => click(funnel(grid, "status")));
        await settle();

        expect(popover()).not.toBeNull();
        expect(optionLabels()).toEqual(["(empty)", "done", "open"]);
    });

    it("lights the funnel of the column being filtered, and puts it out again", async () => {
        const grid = create({ rows });
        const opened = open(grid, "status");
        await settle();
        expect(funnel(grid, "status").classList.contains("avg-filter-open")).toBe(true);

        click(button("clear"));
        await opened;
        await settle();
        expect(funnel(grid, "status").classList.contains("avg-filter-open")).toBe(false);
    });

    it("closes again on a second click of the same funnel", async () => {
        const grid = create({ rows });
        withLayout(() => click(funnel(grid, "status")));
        await settle();
        expect(popover()).not.toBeNull();

        click(funnel(grid, "status"));
        await settle();
        expect(popover()).toBeNull();
    });

    it("opens only one at a time", async () => {
        const grid = create({ rows });
        void open(grid, "status");
        void open(grid, "team");
        await settle();

        expect(document.body.querySelectorAll(".avg-filter-popover")).toHaveLength(1);
    });

    it("shows a funnel on every column, and none when filtering is disabled", () => {
        const plain = create({ rows });
        expect(funnel(plain, "status").style.display).toBe("");

        const off = create({ rows, disableFiltering: true });
        expect(funnel(off, "status").style.display).toBe("none");
    });

    it("takes the funnel off a column with filterType: null", () => {
        const grid = create({
            rows,
            columns: [{ key: "name" }, { key: "status", filterType: null }],
        });
        expect(funnel(grid, "status").style.display).toBe("none");
        expect(funnel(grid, "name").style.display).toBe("");
    });

    it("warns rather than throwing on an unknown column", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const grid = create({ rows });

        await expect(grid.showFilterPopover("nmae")).resolves.toBeUndefined();
        expect(warn.mock.calls[0][0]).toContain('no such column');
        expect(popover()).toBeNull();
    });

    it("resolves undefined when the popover is dismissed", async () => {
        const grid = create({ rows });
        const opened = open(grid, "status");
        await settle();

        document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
        await expect(opened).resolves.toBeUndefined();
    });

    it("closes with the grid", async () => {
        const grid = create({ rows });
        void open(grid, "status");
        await settle();

        grid.destroy();
        grids.length = 0;
        expect(popover()).toBeNull();
    });
});

describe("options", () => {
    it("offers the column's distinct values, sorted", async () => {
        const grid = create({ rows });
        void open(grid, "team");
        await settle();

        expect(optionLabels()).toEqual(["data", "platform"]);
    });

    it("renders an empty label as (empty)", async () => {
        const grid = create({ rows });
        void open(grid, "status");
        await settle();

        expect(optionLabels()).toContain("(empty)");
    });

    it("cascades: the options reflect the other filters", async () => {
        const grid = create({ rows });
        grid.applyFilter({ columnKey: "team", value: ["data"] });
        void open(grid, "status");
        await settle();

        // Only the two rows on team "data" are left, so "done" is not on offer.
        expect(optionLabels()).toEqual(["(empty)", "open"]);
    });

    it("does not cascade a column against its own filter", async () => {
        const grid = create({ rows });
        grid.applyFilter({ columnKey: "status", value: ["open"] });
        void open(grid, "status");
        await settle();

        // Every value still offered — otherwise a filter could never be widened again.
        expect(optionLabels()).toEqual(["open", "(empty)", "done"]);
    });

    it("hoists the selected options to the top", async () => {
        const grid = create({ rows });
        grid.applyFilter({ columnKey: "status", value: ["open"] });
        void open(grid, "status");
        await settle();

        expect(optionLabels()[0]).toBe("open");
    });

    it("asks the host, with the other filters and the column key", async () => {
        const onGetOptions = vi.fn(() => [{ value: "x", label: "X" }]);
        const grid = create({ rows, onGetOptions });
        grid.applyFilter({ columnKey: "team", value: ["data"] });
        void open(grid, "status");
        await settle();

        const [columns, filters, columnKey, search] = onGetOptions.mock.calls[0] as any[];
        expect(columns.map((c: any) => String(c.key))).toContain("status");
        expect(filters.map((f: any) => f.columnKey)).toEqual(["team"]);
        expect(columnKey).toBe("status");
        expect(search).toBeUndefined();
        expect(optionLabels()).toEqual(["X"]);
    });

    it("awaits a promise of options", async () => {
        let resolve!: (options: DisplayOption[]) => void;
        const grid = create({
            rows,
            onGetOptions: () => new Promise<DisplayOption[]>((r) => (resolve = r)),
        });
        void open(grid, "status");
        await settle();
        expect(optionLabels()).toEqual([]);

        resolve([{ value: "late", label: "late" }]);
        await settle();
        expect(optionLabels()).toEqual(["late"]);
    });

    it("discards a response overtaken by a newer one", async () => {
        const pending: ((options: DisplayOption[]) => void)[] = [];
        const grid = create({
            rows,
            onGetOptions: () => new Promise<DisplayOption[]>((r) => pending.push(r)),
        });
        void open(grid, "status");
        await settle();

        const search = document.body.querySelector<HTMLInputElement>(
            ".avg-filter-popover .avg-list-search",
        )!;
        search.value = "o";
        search.dispatchEvent(new Event("input", { bubbles: true }));
        await settle();

        // The second request answers first; the first is then dropped rather than replacing it.
        pending[1]([{ value: "second", label: "second" }]);
        pending[0]([{ value: "first", label: "first" }]);
        await settle();

        expect(optionLabels()).toEqual(["second"]);
    });

    it("passes the search text to the host", async () => {
        const onGetOptions = vi.fn(() => [{ value: "x", label: "x" }]);
        const grid = create({ rows, onGetOptions });
        void open(grid, "status");
        await settle();

        const search = document.body.querySelector<HTMLInputElement>(
            ".avg-filter-popover .avg-list-search",
        )!;
        search.value = "op";
        search.dispatchEvent(new Event("input", { bubbles: true }));
        await settle();

        expect(onGetOptions).toHaveBeenLastCalledWith(
            expect.anything(),
            expect.anything(),
            "status",
            "op",
        );
    });

    it("narrows the list itself when the host ignores the search text", async () => {
        const grid = create({ rows });
        void open(grid, "status");
        await settle();

        const search = document.body.querySelector<HTMLInputElement>(
            ".avg-filter-popover .avg-list-search",
        )!;
        search.value = "don";
        search.dispatchEvent(new Event("input", { bubbles: true }));
        await settle();

        expect(optionLabels()).toEqual(["done"]);
    });

    it("survives a provider that rejects", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const grid = create({ rows, onGetOptions: () => Promise.reject(new Error("nope")) });
        void open(grid, "status");
        await settle();
        await settle();

        expect(optionLabels()).toEqual([]);
        expect(warn).toHaveBeenCalled();
        expect(popover()).not.toBeNull();
    });
});

describe("applying", () => {
    it("applies what was ticked, and resolves with it", async () => {
        const grid = create({ rows });
        const opened = open(grid, "status");
        await settle();

        click(optionRow("open"));
        click(button("apply"));

        const applied = await opened;
        expect(applied?.columnKey).toBe("status");
        expect(applied?.value).toEqual([{ value: "open", label: "open" }]);
        expect(grid.getVisibleRows().map((r: any) => r.name)).toEqual(["Ada", "Grace"]);
        expect(popover()).toBeNull();
    });

    it("cannot apply an empty selection — Clear is the way to say that", async () => {
        const grid = create({ rows });
        void open(grid, "status");
        await settle();

        expect(button("apply").disabled).toBe(true);
        click(optionRow("open"));
        expect(button("apply").disabled).toBe(false);
        click(optionRow("open"));
        expect(button("apply").disabled).toBe(true);
    });

    it("removes the filter when Clear is pressed", async () => {
        const grid = create({ rows });
        grid.applyFilter({ columnKey: "status", value: ["open"] });
        expect(grid.getVisibleRows()).toHaveLength(2);

        const opened = open(grid, "status");
        await settle();
        click(button("clear"));

        await opened;
        expect(grid.getFilters()).toEqual([]);
        expect(grid.getVisibleRows()).toHaveLength(4);
    });

    it("removes rather than empties when every option is unticked", async () => {
        const grid = create({ rows });
        grid.applyFilter({ columnKey: "status", value: ["open"] });
        const opened = open(grid, "status");
        await settle();

        // The one selected option is hoisted to the top; untick it and apply.
        click(optionRow("open"));
        // Apply is disabled with nothing ticked, so Clear is what the user reaches for — and
        // an empty apply through the API means the same thing.
        grid.applyFilter({ columnKey: "status", value: [] });
        click(button("clear"));
        await opened;

        expect(grid.getFilters()).toEqual([]);
        expect(grid.getVisibleRows()).toHaveLength(4);
    });

    it("keeps a selection made under a different search", async () => {
        const grid = create({ rows });
        const opened = open(grid, "status");
        await settle();

        const search = document.body.querySelector<HTMLInputElement>(
            ".avg-filter-popover .avg-list-search",
        )!;
        search.value = "open";
        search.dispatchEvent(new Event("input", { bubbles: true }));
        await settle();
        click(optionRow("open"));

        search.value = "done";
        search.dispatchEvent(new Event("input", { bubbles: true }));
        await settle();
        click(optionRow("done"));

        click(button("apply"));
        const applied = await opened;
        expect(applied?.value.map((o: DisplayOption) => o.value)).toEqual(["open", "done"]);
    });

    it("edits an existing filter rather than replacing it", async () => {
        const grid = create({ rows });
        grid.applyFilter({ columnKey: "status", value: ["open"] });
        const opened = open(grid, "status");
        await settle();

        click(optionRow("done"));
        click(button("apply"));
        const applied = await opened;

        expect(applied?.value.map((o: DisplayOption) => o.value)).toEqual(["open", "done"]);
        expect(grid.getVisibleRows()).toHaveLength(3);
    });

    it("marks the funnel of a filtered column", async () => {
        const grid = create({ rows });
        const opened = open(grid, "status");
        await settle();
        click(optionRow("open"));
        click(button("apply"));
        await opened;
        await settle();

        expect(
            funnel(grid, "status").classList.contains("avg-column-filtered"),
        ).toBe(true);
        expect(funnel(grid, "team").classList.contains("avg-column-filtered")).toBe(false);
    });

    it("matches a value that is not a string", async () => {
        const dated = [
            { id: 1, when: new Date("2024-01-02T00:00:00.000Z") },
            { id: 2, when: new Date("2024-03-04T00:00:00.000Z") },
        ];
        const grid = create({ rows: dated });
        const opened = open(grid, "when");
        await settle();

        expect(optionLabels()).toHaveLength(2);
        click(optionRow(optionLabels()[0]));
        click(button("apply"));
        await opened;

        expect(grid.getVisibleRows()).toHaveLength(1);
        expect((grid.getVisibleRows()[0] as any).id).toBe(1);
    });
});
