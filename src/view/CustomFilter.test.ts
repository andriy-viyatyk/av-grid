// @vitest-environment happy-dom

/**
 * A filter type of the host's own: `Column.filter`.
 *
 * The subject is spread over five files — `validate` (loud at `create()`), `gridUtils` (the row
 * test), `FilterPopover` (which body opens), `CustomFilterContent` (the panel around it) and
 * `FilterBar` (the chip) — so the suite is organized by what a host does rather than by file.
 *
 * The definition under test is the plan's date-range one, with its dates parsed **once** in
 * `getValue` and compared as numbers in `match`, because that is the shape the docs tell a host
 * to write and the shape the benchmark measures.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AVGrid } from "../AVGrid";
import type { AVGridOptions } from "../options";
import type { FilterDefinition } from "../types";

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

interface Row {
    id: number;
    name: string;
    status: string;
    created: string;
}

const rows: Row[] = [
    { id: 1, name: "Ada", status: "open", created: "2024-01-05" },
    { id: 2, name: "Alan", status: "done", created: "2024-02-10" },
    { id: 3, name: "Grace", status: "open", created: "2024-03-15" },
    { id: 4, name: "Edsger", status: "done", created: "2024-04-20" },
];

interface RangeValue {
    from: string;
    to: string;
    fromMs: number;
    toMs: number;
}

/** Calls recorded by the definition below, so a test can assert on what the grid did to it. */
const calls = {
    create: 0,
    destroy: 0,
    focus: 0,
    match: 0,
    contexts: [] as any[],
};

function makeRangeFilter(
    overrides: Partial<FilterDefinition<Row>> = {},
): FilterDefinition<Row> {
    return {
        name: "dateRange",
        create: (ctx) => {
            calls.create++;
            calls.contexts.push(ctx);
            const el = document.createElement("div");
            const from = document.createElement("input");
            from.type = "date";
            from.setAttribute("data-from", "");
            const to = document.createElement("input");
            to.type = "date";
            to.setAttribute("data-to", "");
            const applied = ctx.value as RangeValue | undefined;
            from.value = applied?.from ?? "";
            to.value = applied?.to ?? "";
            el.append(from, to);
            return {
                element: el,
                // Parsed here, once per apply — which is what makes `match` two comparisons.
                getValue: (): RangeValue | undefined =>
                    from.value || to.value
                        ? {
                              from: from.value,
                              to: to.value,
                              fromMs: from.value ? Date.parse(from.value) : -Infinity,
                              toMs: to.value ? Date.parse(to.value) : Infinity,
                          }
                        : undefined,
                focus: () => {
                    calls.focus++;
                    from.focus();
                },
                destroy: () => {
                    calls.destroy++;
                },
            };
        },
        label: (value: RangeValue) => `${value.from || "…"} – ${value.to || "…"}`,
        match: (value: RangeValue, row) => {
            calls.match++;
            const ms = Date.parse(row.created);
            return ms >= value.fromMs && ms <= value.toMs;
        },
        ...overrides,
    };
}

const grids: AVGrid<any>[] = [];

function create<R>(options: AVGridOptions<R>): AVGrid<R> {
    const host = document.createElement("div");
    document.body.append(host);
    const grid = withLayout(() => AVGrid.create<R>(host, options));
    grids.push(grid);
    return grid;
}

/** A grid whose `created` column is filtered by the date range, with a filter bar. */
function rangeGrid(
    definition: FilterDefinition<Row> = makeRangeFilter(),
    options: Partial<AVGridOptions<Row>> = {},
): AVGrid<Row> {
    return create<Row>({
        rows,
        filterBar: true,
        // `created` first: the header only renders the columns that fit the (stubbed) 300px
        // viewport, and `showFilterPopover` has nothing to anchor to for one that does not.
        columns: [
            { key: "created", name: "Created", filter: definition },
            { key: "id" },
            { key: "name" },
            { key: "status" },
        ],
        ...options,
    });
}

const settle = (): Promise<void> =>
    new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );

const click = (el: Element): void => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
};

const popover = (): HTMLElement | null =>
    document.body.querySelector(".avg-filter-popover");

const body = (): HTMLElement | null =>
    document.body.querySelector(".avg-custom-filter-body");

const input = (which: "from" | "to"): HTMLInputElement => {
    const el = document.body.querySelector<HTMLInputElement>(
        `.avg-filter-popover [data-${which}]`,
    );
    if (!el) throw new Error(`no "${which}" input in the popover`);
    return el;
};

const button = (action: string): HTMLButtonElement => {
    const el = document.body.querySelector<HTMLButtonElement>(
        `.avg-filter-popover [data-action="${action}"]`,
    );
    if (!el) throw new Error(`no "${action}" button`);
    return el;
};

const chip = (columnKey: string): HTMLElement | null =>
    document.body.querySelector(`.avg-filter-chip[data-column-key="${columnKey}"]`);

const chipText = (columnKey: string): string => {
    const el = chip(columnKey);
    if (!el) throw new Error(`no chip for "${columnKey}"`);
    return [
        el.querySelector(".avg-filter-chip-name")?.textContent ?? "",
        el.querySelector(".avg-filter-chip-values")?.textContent ?? "",
    ].join(" ");
};

/** Open a column's popover the way the header funnel does. */
function open(grid: AVGrid<any>, columnKey: string): Promise<any> {
    return withLayout(() => grid.showFilterPopover(columnKey));
}

/** Type into the range inputs and press Apply. */
function applyRange(from: string, to: string): void {
    input("from").value = from;
    input("to").value = to;
    click(button("apply"));
}

const names = (grid: AVGrid<Row>): string[] =>
    grid.getVisibleRows().map((r) => r.name);

beforeEach(() => {
    calls.create = 0;
    calls.destroy = 0;
    calls.focus = 0;
    calls.match = 0;
    calls.contexts = [];
});

afterEach(() => {
    grids.splice(0).forEach((g) => g.destroy());
    document.body.innerHTML = "";
    vi.restoreAllMocks();
});

describe("the popover", () => {
    it("opens the column's own body instead of the checklist", async () => {
        const grid = rangeGrid();
        void open(grid, "created");
        await settle();

        expect(popover()).not.toBeNull();
        expect(body()).not.toBeNull();
        // The checklist is not built at all — not built and hidden.
        expect(popover()!.querySelector(".avg-filter-list")).toBeNull();
        expect(calls.create).toBe(1);
    });

    it("still draws the grid's Apply and Clear", async () => {
        const grid = rangeGrid();
        void open(grid, "created");
        await settle();

        expect(button("apply")).not.toBeNull();
        expect(button("clear")).not.toBeNull();
        // Unlike the checklist's, Apply is live from the start: only the body knows whether its
        // value means anything, and applying nothing is the same as Clear.
        expect(button("apply").disabled).toBe(false);
    });

    it("has no resize grip — a host's body sizes itself", async () => {
        const grid = rangeGrid();
        void open(grid, "created");
        await settle();

        expect(popover()!.querySelector('[data-type="popover-resize"]')).toBeNull();
    });

    it("focuses what the body asked for", async () => {
        const grid = rangeGrid();
        void open(grid, "created");
        await settle();

        expect(calls.focus).toBe(1);
    });

    it("focuses the first control when the body has no opinion", async () => {
        const definition = makeRangeFilter();
        const grid = rangeGrid({
            ...definition,
            create: (ctx) => {
                const built = definition.create(ctx);
                return { element: built.element, getValue: built.getValue };
            },
        });
        void open(grid, "created");
        await settle();

        expect(document.activeElement).toBe(input("from"));
    });

    it("checks the body it was handed", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const grid = rangeGrid({
            ...makeRangeFilter(),
            create: () => ({}) as any,
        });

        expect(await open(grid, "created")).toBeUndefined();
        expect(popover()).toBeNull();
        expect(warn.mock.calls[0]?.[0]).toContain("failed to build its body");
    });
});

describe("applying", () => {
    it("filters the rows by the value getValue returned", async () => {
        const grid = rangeGrid();
        void open(grid, "created");
        await settle();

        applyRange("2024-02-01", "2024-03-31");
        expect(names(grid)).toEqual(["Alan", "Grace"]);
    });

    it("closes the popover and resolves with the applied filter", async () => {
        const grid = rangeGrid();
        const closed = open(grid, "created");
        await settle();

        applyRange("2024-02-01", "2024-03-31");
        const applied = await closed;

        expect(popover()).toBeNull();
        expect(applied?.columnKey).toBe("created");
        // The definition's name is the filter's type, taken from the column rather than written.
        expect(applied?.type).toBe("dateRange");
        expect(applied?.value.from).toBe("2024-02-01");
    });

    it("removes the filter when the body returns nothing", async () => {
        const grid = rangeGrid();
        void open(grid, "created");
        await settle();
        applyRange("2024-02-01", "2024-03-31");

        void open(grid, "created");
        await settle();
        applyRange("", "");

        expect(grid.getFilters()).toEqual([]);
        expect(names(grid)).toEqual(["Ada", "Alan", "Grace", "Edsger"]);
    });

    it("clears from Clear", async () => {
        const grid = rangeGrid();
        void open(grid, "created");
        await settle();
        applyRange("2024-02-01", "2024-03-31");

        void open(grid, "created");
        await settle();
        click(button("clear"));

        expect(grid.getFilters()).toEqual([]);
        expect(names(grid)).toHaveLength(4);
    });

    it("applies from ctx.apply, for a body with its own Enter", async () => {
        const grid = rangeGrid();
        void open(grid, "created");
        await settle();

        calls.contexts[0].apply({ fromMs: Date.parse("2024-03-01"), toMs: Infinity, from: "2024-03-01", to: "" });
        expect(names(grid)).toEqual(["Grace", "Edsger"]);
        expect(popover()).toBeNull();
    });

    it("closes without applying from ctx.close", async () => {
        const grid = rangeGrid();
        void open(grid, "created");
        await settle();

        calls.contexts[0].close();
        expect(popover()).toBeNull();
        expect(grid.getFilters()).toEqual([]);
    });

    it("shows the applied value when it reopens", async () => {
        const grid = rangeGrid();
        void open(grid, "created");
        await settle();
        applyRange("2024-02-01", "2024-03-31");

        void open(grid, "created");
        await settle();

        expect(calls.contexts[1].value.from).toBe("2024-02-01");
        expect(input("from").value).toBe("2024-02-01");
    });

    it("destroys the body on every way out", async () => {
        const grid = rangeGrid();

        // `await` after each ending, not for the DOM: teardown hangs off the popover's promise,
        // so it is a microtask behind the click that closed it.
        void open(grid, "created");
        await settle();
        applyRange("2024-02-01", "2024-03-31");
        await settle();
        expect(calls.destroy).toBe(1);

        void open(grid, "created");
        await settle();
        click(button("clear"));
        await settle();
        expect(calls.destroy).toBe(2);

        void open(grid, "created");
        await settle();
        // Dismissed by a pointerdown outside it, which is neither of the buttons.
        document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
        await settle();
        expect(calls.destroy).toBe(3);
        expect(body()).toBeNull();
    });
});

describe("the row test", () => {
    it("is called with the value, the row and the column", () => {
        const seen: any[] = [];
        const grid = rangeGrid({
            ...makeRangeFilter(),
            match: (value, row, column) => {
                seen.push({ value, row, column });
                return true;
            },
        });
        grid.applyFilter({ columnKey: "created", value: { fromMs: 0, toMs: 1 } });

        expect(seen).toHaveLength(4);
        expect(seen[0].value).toEqual({ fromMs: 0, toMs: 1 });
        expect(seen[0].row).toBe(rows[0]);
        expect(seen[0].column.key).toBe("created");
    });

    it("is not called at all until something is applied", () => {
        const grid = rangeGrid();
        expect(names(grid)).toHaveLength(4);
        expect(calls.match).toBe(0);
    });

    it("may read any property, not only the column's own", () => {
        const grid = rangeGrid({
            name: "openOnly",
            create: makeRangeFilter().create,
            label: () => "open only",
            // The whole point of `match(value, row, column)`: the column it hangs off is where
            // the funnel is, not a limit on what the filter can read.
            match: (_value, row) => row.status === "open",
        });
        grid.applyFilter({ columnKey: "created", value: true });

        expect(names(grid)).toEqual(["Ada", "Grace"]);
    });

    it("combines with a built-in filter on another column", () => {
        const grid = rangeGrid();
        grid.applyFilter({
            columnKey: "created",
            value: { fromMs: Date.parse("2024-02-01"), toMs: Infinity },
        });
        grid.applyFilter({ columnKey: "status", value: ["open"] });

        expect(names(grid)).toEqual(["Grace"]);
    });

    it("cascades into another column's option list", async () => {
        const grid = rangeGrid();
        grid.applyFilter({
            columnKey: "created",
            value: { fromMs: Date.parse("2024-03-01"), toMs: Infinity },
        });

        // The checklist on `status` may only offer what the date range leaves reachable.
        // Anchored by hand: `status` is off the right of the stubbed 300px viewport, so it has no
        // funnel in the document to anchor to.
        void withLayout(() =>
            grid.showFilterPopover("status", { anchor: document.body }),
        );
        await settle();
        const labels = Array.from(
            document.body.querySelectorAll<HTMLElement>(
                ".avg-filter-popover .avg-list-item[data-index]",
            ),
        ).map((r) => r.textContent);

        expect(labels.sort()).toEqual(["done", "open"]);
    });
});

describe("the chip", () => {
    it("reads the definition's label", () => {
        const grid = rangeGrid();
        grid.applyFilter({
            columnKey: "created",
            value: { from: "2024-02-01", to: "2024-03-31", fromMs: 0, toMs: 1 },
        });

        expect(chipText("created")).toBe("Created: 2024-02-01 – 2024-03-31");
    });

    it("reopens the popover from the chip, anchored to it", async () => {
        const grid = rangeGrid();
        grid.applyFilter({
            columnKey: "created",
            value: { from: "2024-02-01", to: "", fromMs: 0, toMs: 1 },
        });

        withLayout(() =>
            click(chip("created")!.querySelector(".avg-filter-chip-body")!),
        );
        await settle();

        expect(body()).not.toBeNull();
        expect(calls.contexts[0].value.from).toBe("2024-02-01");
    });

    it("removes the filter from its ✕", () => {
        const grid = rangeGrid();
        grid.applyFilter({ columnKey: "created", value: { fromMs: 0, toMs: 1 } });

        click(chip("created")!.querySelector(".avg-filter-chip-remove")!);
        expect(grid.getFilters()).toEqual([]);
        expect(chip("created")).toBeNull();
    });

    it("survives a label that throws", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const grid = rangeGrid({
            ...makeRangeFilter(),
            label: () => {
                throw new Error("nope");
            },
        });
        grid.applyFilter({ columnKey: "created", value: { fromMs: 0, toMs: 1 } });

        // The bar still redraws, and the chip falls back to naming the filter type.
        expect(chipText("created")).toBe("Created: dateRange");
        expect(warn.mock.calls[0]?.[0]).toContain("`label` threw");
    });
});

describe("persistence", () => {
    const store = (): any => {
        const data = new Map<string, string>();
        return {
            data,
            getItem: (k: string) => data.get(k) ?? null,
            setItem: (k: string, v: string) => void data.set(k, v),
            removeItem: (k: string) => void data.delete(k),
        };
    };

    it("round-trips a JSON-shaped value across a reload", () => {
        const storage = store();
        const persist = { name: "custom", storage };
        const first = rangeGrid(makeRangeFilter(), { persistFilters: persist });
        first.applyFilter({
            columnKey: "created",
            value: { from: "2024-02-01", to: "", fromMs: Date.parse("2024-02-01"), toMs: Infinity },
        });

        // `Infinity` is not JSON — it stores as null — which is exactly why the parsed numbers
        // are recomputed by the definition rather than trusted from storage.
        const revived = rangeGrid(makeRangeFilter(), { persistFilters: persist });
        const [filter] = revived.getFilters();
        expect(filter.columnKey).toBe("created");
        expect(filter.type).toBe("dateRange");
        expect(filter.value.from).toBe("2024-02-01");
    });

    it("uses serialize and deserialize when the value is not JSON-shaped", () => {
        const storage = store();
        const persist = { name: "regexp", storage };
        const definition: FilterDefinition<Row> = {
            name: "nameMatches",
            create: makeRangeFilter().create,
            label: (value: RegExp) => value.source,
            match: (value: RegExp, row) => value.test(row.name),
            serialize: (value: RegExp) => value.source,
            deserialize: (stored: string) => new RegExp(stored),
        };

        const first = rangeGrid(definition, { persistFilters: persist });
        first.applyFilter({ columnKey: "created", value: /^A/ });
        expect(names(first)).toEqual(["Ada", "Alan"]);
        expect(JSON.parse(storage.data.get("Filters-regexp")).filters[0].value).toBe("^A");

        const revived = rangeGrid(definition, { persistFilters: persist });
        expect(revived.getFilters()[0].value).toBeInstanceOf(RegExp);
        expect(names(revived)).toEqual(["Ada", "Alan"]);
    });

    it("drops a stored filter whose definition has gone, with a warning", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const storage = store();
        const persist = { name: "gone", storage };
        const first = rangeGrid(makeRangeFilter(), { persistFilters: persist });
        first.applyFilter({ columnKey: "created", value: { fromMs: 0, toMs: 1 } });

        // The same grid, with the definition taken off the column — a released version that
        // dropped the filter type, met by a user whose stored filters still name it.
        const plain = create<Row>({
            rows,
            persistFilters: persist,
            columns: [{ key: "created" }, { key: "id" }, { key: "name" }, { key: "status" }],
        });

        expect(plain.getFilters()).toEqual([]);
        expect(names(plain)).toHaveLength(4);
        expect(warn.mock.calls[0]?.[0]).toContain("dropping stored filter");
    });
});

describe("validation", () => {
    const columns = (filter: any) => [{ key: "name" }, { key: "created", filter }];
    const build = (filter: any) => () =>
        create<Row>({ rows, columns: columns(filter) as any });

    it("names the column and the missing field", () => {
        expect(build({ name: "r", create: () => ({}), label: () => "" })).toThrow(
            /Column "created" .* no `match` function/s,
        );
        expect(build({ name: "r", create: () => ({}), match: () => true })).toThrow(
            /Column "created" .* no `label` function/s,
        );
        expect(build({ name: "r", label: () => "", match: () => true })).toThrow(
            /Column "created" .* no `create` function/s,
        );
    });

    it("requires a name, because that is what persistence stores", () => {
        expect(build({ create: () => ({}), label: () => "", match: () => true })).toThrow(
            /Column "created" has a `filter` with no `name`/,
        );
    });

    it("rejects a filter that is not a definition", () => {
        expect(build("dateRange")).toThrow(/must be a filter definition/);
        expect(build(() => true)).toThrow(/must be a filter definition/);
    });

    it("rejects a serialize that is not a function", () => {
        expect(
            build({
                name: "r",
                create: () => ({}),
                label: () => "",
                match: () => true,
                serialize: "json",
            }),
        ).toThrow(/`filter.serialize` must be a function/);
    });

    it("rejects a filter naming a type the column does not have", () => {
        const grid = rangeGrid();
        expect(() =>
            grid.applyFilter({ columnKey: "created", type: "somethingElse", value: 1 }),
        ).toThrow(/is filtered by "dateRange"/);
    });

    it("still rejects an unknown type on a column with no definition", () => {
        const grid = rangeGrid();
        expect(() =>
            grid.applyFilter({ columnKey: "status", type: "dateRange", value: 1 }),
        ).toThrow(/has no `filter` definition of that name/);
    });
});

describe("the funnel", () => {
    it("appears on a custom-filtered column", () => {
        const grid = rangeGrid();
        const cell = Array.from(
            grid.element.querySelectorAll<HTMLElement>('[data-type="header-cell"]'),
        ).find((c) => c.getAttribute("data-column-key") === "created");

        const funnel = cell?.querySelector<HTMLElement>('[data-type="filter-button"]');
        expect(funnel).not.toBeNull();
        expect(funnel!.style.display).not.toBe("none");
    });

    it("is still taken off by filterType: null", () => {
        const grid = rangeGrid(makeRangeFilter(), {
            columns: [
                { key: "created", filter: makeRangeFilter(), filterType: null },
                { key: "id" },
                { key: "name" },
                { key: "status" },
            ],
        });
        const cell = Array.from(
            grid.element.querySelectorAll<HTMLElement>('[data-type="header-cell"]'),
        ).find((c) => c.getAttribute("data-column-key") === "created");

        // The element is pooled, so it is hidden rather than removed — the same thing the
        // built-in filter type does for a column that opted out.
        const funnel = cell?.querySelector<HTMLElement>('[data-type="filter-button"]');
        expect(funnel!.style.display).toBe("none");
    });
});
