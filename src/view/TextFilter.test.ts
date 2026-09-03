// @vitest-environment happy-dom

/**
 * The built-in `"text"` filter type: `filterType: "text"` — one input, operator chips (three by
 * default; `textFilterOps` adds `blank` / `notBlank`), and the host `filterLabel` hook.
 *
 * Like `CustomFilter.test.ts`, the subject is spread over several files — `validate` (the value
 * normalization), `gridUtils` (the row test), `FilterPopover` (which body opens),
 * `TextFilterContent` (the body itself) and `FilterBar` (the chip) — so the suite is organized
 * by what a host does rather than by file.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { AVGrid } from "../AVGrid";
import type { AVGridOptions } from "../options";
import type { Filter, TextFilterValue } from "../types";
import { filterRows } from "../gridUtils";

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
    created: Date;
}

const rows: Row[] = [
    { id: 1, name: "Ada Smith", status: "open", created: new Date(2024, 0, 5) },
    { id: 2, name: "Alan Smithee", status: "done", created: new Date(2024, 1, 10) },
    { id: 3, name: "Grace", status: "open", created: new Date(2024, 2, 15) },
    { id: 4, name: "smith", status: "done", created: new Date(2024, 3, 20) },
];

const grids: AVGrid<any>[] = [];

function create<R>(options: AVGridOptions<R>): AVGrid<R> {
    const host = document.createElement("div");
    document.body.append(host);
    const grid = withLayout(() => AVGrid.create<R>(host, options));
    grids.push(grid);
    return grid;
}

/** A grid whose `name` column is a text filter, with a filter bar. */
function textGrid(options: Partial<AVGridOptions<Row>> = {}): AVGrid<Row> {
    return create<Row>({
        rows,
        filterBar: true,
        // `name` first: the header only renders the columns that fit the (stubbed) 300px
        // viewport, and `showFilterPopover` has nothing to anchor to for one that does not.
        columns: [
            { key: "name", name: "Name", filterType: "text" },
            { key: "id" },
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

const textInput = (): HTMLInputElement => {
    const el = document.body.querySelector<HTMLInputElement>(
        ".avg-filter-popover .avg-text-filter-input",
    );
    if (!el) throw new Error("no text input in the popover");
    return el;
};

const chip = (op: string): HTMLButtonElement => {
    const el = document.body.querySelector<HTMLButtonElement>(
        `.avg-filter-popover .avg-text-filter-ops [data-op="${op}"]`,
    );
    if (!el) throw new Error(`no "${op}" chip`);
    return el;
};

const isChecked = (op: string): boolean =>
    chip(op).getAttribute("aria-checked") === "true";

const button = (action: string): HTMLButtonElement => {
    const el = document.body.querySelector<HTMLButtonElement>(
        `.avg-filter-popover [data-action="${action}"]`,
    );
    if (!el) throw new Error(`no "${action}" button`);
    return el;
};

const chipText = (columnKey: string): string => {
    const el = document.body.querySelector(
        `.avg-filter-chip[data-column-key="${columnKey}"]`,
    );
    if (!el) throw new Error(`no chip for "${columnKey}"`);
    return [
        el.querySelector(".avg-filter-chip-name")?.textContent ?? "",
        el.querySelector(".avg-filter-chip-values")?.textContent ?? "",
    ].join(" ");
};

function open(grid: AVGrid<any>, columnKey: string): Promise<any> {
    return withLayout(() => grid.showFilterPopover(columnKey));
}

const names = (grid: AVGrid<Row>): string[] =>
    grid.getVisibleRows().map((r) => r.name);

afterEach(() => {
    grids.splice(0).forEach((g) => g.destroy());
    document.body.innerHTML = "";
    vi.restoreAllMocks();
});

// =============================================================================================
// The row test — each operator, through the public API
// =============================================================================================

describe("the row test", () => {
    it("contains, case-insensitively", () => {
        const grid = textGrid();
        grid.setFilters([{ columnKey: "name", value: { op: "contains", text: "SMITH" } }]);
        expect(names(grid)).toEqual(["Ada Smith", "Alan Smithee", "smith"]);
    });

    it("equals — the whole displayed string, case-insensitively", () => {
        const grid = textGrid();
        grid.setFilters([{ columnKey: "name", value: { op: "equals", text: "Smith" } }]);
        expect(names(grid)).toEqual(["smith"]);
    });

    it("startsWith, case-insensitively", () => {
        const grid = textGrid();
        grid.setFilters([
            { columnKey: "name", value: { op: "startsWith", text: "a" } },
        ]);
        expect(names(grid)).toEqual(["Ada Smith", "Alan Smithee"]);
    });

    it("a bare string normalizes to contains", () => {
        const grid = textGrid();
        grid.setFilters([{ columnKey: "name", value: "smith" }]);
        expect(names(grid)).toEqual(["Ada Smith", "Alan Smithee", "smith"]);
        const [filter] = grid.getFilters();
        expect(filter.value).toEqual({ op: "contains", text: "smith" });
    });

    it("`op` may be omitted and defaults to contains", () => {
        const grid = textGrid();
        grid.setFilters([{ columnKey: "name", value: { text: "smith" } as any }]);
        expect(names(grid)).toEqual(["Ada Smith", "Alan Smithee", "smith"]);
    });

    it("the text is trimmed, so a pasted trailing space cannot fail `equals`", () => {
        const grid = textGrid();
        grid.setFilters([{ columnKey: "name", value: { op: "equals", text: " smith " } }]);
        expect(names(grid)).toEqual(["smith"]);
    });

    it("empty (or all-whitespace) text is no filter at all", () => {
        const grid = textGrid();
        grid.setFilters([{ columnKey: "name", value: "   " }]);
        expect(names(grid)).toHaveLength(4);
        expect(grid.getFilters()[0]?.value).toBeUndefined();
    });

    it("matches the displayed text of a formatValue column", () => {
        const grid = create<Row>({
            rows,
            columns: [
                {
                    key: "label",
                    filterType: "text",
                    formatValue: (_c, row) => `#${row.id} ${row.name}`,
                },
                { key: "name" },
            ],
        });
        grid.setFilters([{ columnKey: "label", value: { op: "startsWith", text: "#1" } }]);
        expect(names(grid)).toEqual(["Ada Smith"]);
    });

    it("matches the displayed text of a displayFormat column — what the cell shows", () => {
        const grid = create<Row>({
            rows,
            columns: [
                { key: "created", filterType: "text", displayFormat: "date" },
                { key: "name" },
            ],
        });
        // The cell shows the *formatted* date, so that is what the filter matches. The exact
        // string is locale-dependent; derive the needle from what one row displays.
        const shown = new Date(2024, 2, 15).toLocaleDateString();
        grid.setFilters([{ columnKey: "created", value: { op: "equals", text: shown } }]);
        expect(names(grid)).toEqual(["Grace"]);
    });

    it("a nullish cell never matches", () => {
        const sparse = [{ id: 1, name: "Ada" }, { id: 2, name: null as any }];
        const grid = create({
            rows: sparse,
            columns: [{ key: "name", filterType: "text" }, { key: "id" }],
        });
        grid.setFilters([{ columnKey: "name", value: "a" }]);
        expect(grid.getVisibleRows()).toHaveLength(1);
    });

    it("filterRows (public) reads a bare-string value without normalization", () => {
        const columns = [{ key: "name", filterType: "text" } as any];
        const kept = filterRows(rows, columns, undefined, [
            { columnKey: "name", type: "text", value: "grace" } as Filter,
        ]);
        expect(kept.map((r) => r.name)).toEqual(["Grace"]);
    });
});

// =============================================================================================
// Validation
// =============================================================================================

describe("validation", () => {
    it("rejects an unknown op, naming the three", () => {
        expect(() =>
            textGrid({
                filters: [
                    { columnKey: "name", value: { op: "endsWith" as any, text: "x" } },
                ],
            }),
        ).toThrow(/"contains", "equals", "startsWith"/);
    });

    it("rejects a non-string text", () => {
        expect(() =>
            textGrid({
                filters: [{ columnKey: "name", value: { op: "contains", text: 42 as any } }],
            }),
        ).toThrow(/text.*must be a string/);
    });

    it("rejects a value that is neither string nor object", () => {
        expect(() =>
            textGrid({ filters: [{ columnKey: "name", value: 42 }] }),
        ).toThrow(/string or \{ op, text \}/);
    });

    it("still rejects a type that names no definition and no built-in", () => {
        expect(() =>
            textGrid({
                filters: [{ columnKey: "id", type: "slider" as any, value: 1 }],
            }),
        ).toThrow(/"options".*"text"/s);
    });
});

// =============================================================================================
// The popover body
// =============================================================================================

describe("the popover", () => {
    it("opens the text body — not the checklist — for filterType: \"text\"", async () => {
        const grid = textGrid();
        void open(grid, "name");
        await settle();

        expect(popover()).not.toBeNull();
        expect(popover()!.querySelector(".avg-text-filter-content")).not.toBeNull();
        expect(popover()!.querySelector(".avg-filter-list")).toBeNull();
        // Intrinsic size: no resize grip, like a custom body.
        expect(popover()!.querySelector('[data-type="popover-resize"]')).toBeNull();
    });

    it("focuses the input on open", async () => {
        const grid = textGrid();
        void open(grid, "name");
        await settle();

        expect(document.activeElement).toBe(textInput());
    });

    it("the operators are chips carrying radio semantics, contains preselected", async () => {
        const grid = textGrid();
        void open(grid, "name");
        await settle();

        const group = popover()!.querySelector('[role="radiogroup"]');
        expect(group?.getAttribute("aria-label")).toBe("Match");
        expect(group?.querySelectorAll('[role="radio"]')).toHaveLength(3);
        expect(isChecked("contains")).toBe(true);
        // Exactly one is in the tab order — the roving-tabindex pattern.
        expect(
            [...group!.querySelectorAll('[role="radio"]')].filter(
                (c) => (c as HTMLElement).tabIndex === 0,
            ),
        ).toHaveLength(1);
        // The labels spell the operator as the filter-bar chip will.
        expect(group?.textContent).toContain("starts with");
    });

    it("arrow keys cycle the chips, as they would a radio group", async () => {
        const grid = textGrid();
        void open(grid, "name");
        await settle();

        const group = popover()!.querySelector('[role="radiogroup"]')!;
        group.dispatchEvent(
            new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
        );
        expect(isChecked("equals")).toBe(true);
        group.dispatchEvent(
            new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
        );
        expect(isChecked("contains")).toBe(true);
    });

    it("applies on the Apply button", async () => {
        const grid = textGrid();
        void open(grid, "name");
        await settle();

        textInput().value = "smith";
        chip("startsWith").click();
        click(button("apply"));

        expect(names(grid)).toEqual(["smith"]);
        expect(grid.getFilters()[0].value).toEqual({ op: "startsWith", text: "smith" });
    });

    it("applies on Enter in the input", async () => {
        const grid = textGrid();
        const closed = open(grid, "name");
        await settle();

        textInput().value = "grace";
        textInput().dispatchEvent(
            new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );

        const applied = await closed;
        expect(applied?.value).toEqual({ op: "contains", text: "grace" });
        expect(names(grid)).toEqual(["Grace"]);
    });

    it("applying empty text removes the filter — Apply on empty is Clear", async () => {
        const grid = textGrid({ filters: [{ columnKey: "name", value: "smith" }] });
        expect(names(grid)).toHaveLength(3);

        void open(grid, "name");
        await settle();
        textInput().value = "   ";
        click(button("apply"));

        expect(grid.getFilters()).toHaveLength(0);
        expect(names(grid)).toHaveLength(4);
    });

    it("Clear removes the filter", async () => {
        const grid = textGrid({ filters: [{ columnKey: "name", value: "smith" }] });
        void open(grid, "name");
        await settle();
        click(button("clear"));

        expect(grid.getFilters()).toHaveLength(0);
    });

    it("reopens onto the applied value", async () => {
        const grid = textGrid({
            filters: [{ columnKey: "name", value: { op: "equals", text: "smith" } }],
        });
        void open(grid, "name");
        await settle();

        expect(textInput().value).toBe("smith");
        expect(isChecked("equals")).toBe(true);
    });
});

// =============================================================================================
// The chip
// =============================================================================================

describe("the chip", () => {
    it("reads `Name: contains smith`", () => {
        const grid = textGrid({ filters: [{ columnKey: "name", value: "smith" }] });
        void grid;
        expect(chipText("name")).toContain("Name");
        expect(chipText("name")).toContain("contains smith");
    });

    it("spells startsWith as the switch is labelled", () => {
        const grid = textGrid({
            filters: [{ columnKey: "name", value: { op: "startsWith", text: "smi" } }],
        });
        void grid;
        expect(chipText("name")).toContain("starts with smi");
        expect(chipText("name")).not.toContain("startsWith");
    });

    it("describeFilter carries the same text for a host's own chips", () => {
        const grid = textGrid({ filters: [{ columnKey: "name", value: "smith" }] });
        const [filter] = grid.getFilters();
        expect(grid.describeFilter(filter).values).toBe("contains smith");
    });
});

// =============================================================================================
// Persistence
// =============================================================================================

describe("persistence", () => {
    it("round-trips through storage with no serialize — the value is JSON-shaped", () => {
        const store = new Map<string, string>();
        const storage = {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => void store.set(k, v),
            removeItem: (k: string) => void store.delete(k),
        };

        const first = textGrid({
            persistFilters: { name: "text-test", storage },
        });
        first.setFilters([{ columnKey: "name", value: { op: "equals", text: "smith" } }]);
        first.destroy();

        const second = textGrid({
            persistFilters: { name: "text-test", storage },
        });
        expect(second.getFilters()[0]?.value).toEqual({ op: "equals", text: "smith" });
        expect(names(second)).toEqual(["smith"]);
    });
});

// =============================================================================================
// The value shape is public surface
// =============================================================================================

describe("the value a host reads", () => {
    it("holds exactly { op, text } — nothing derived leaks in", () => {
        const grid = textGrid();
        grid.setFilters([{ columnKey: "name", value: "Smith" }]);
        const value = grid.getFilters()[0].value as TextFilterValue;
        expect(Object.keys(value).sort()).toEqual(["op", "text"]);
        // The needle is lowercased per pass, never written back: the host reads what was typed.
        expect(value.text).toBe("Smith");
    });
});

// =============================================================================================
// Task 54 — blank / notBlank: the two text-free state operators
// =============================================================================================

interface Sparse {
    id: number;
    email: string | null | undefined;
}

const sparse: Sparse[] = [
    { id: 1, email: "ada@example.test" },
    { id: 2, email: null },
    { id: 3, email: undefined },
    { id: 4, email: "" },
    { id: 5, email: "   " },
    { id: 6, email: "grace@example.test" },
];

/** `email` is a text filter with every operator; a 300px viewport fits it first. */
function sparseGrid(options: Partial<AVGridOptions<Sparse>> = {}): AVGrid<Sparse> {
    return create<Sparse>({
        rows: sparse,
        filterBar: true,
        columns: [
            {
                key: "email",
                name: "Email",
                filterType: "text",
                textFilterOps: ["contains", "equals", "startsWith", "blank", "notBlank"],
            },
            { key: "id" },
        ],
        ...options,
    });
}

const ids = (grid: AVGrid<Sparse>): number[] => grid.getVisibleRows().map((r) => r.id);

describe("blank / notBlank — the row test", () => {
    it("blank keeps null, undefined, empty and whitespace-only cells", () => {
        const grid = sparseGrid();
        grid.setFilters([{ columnKey: "email", value: { op: "blank" } }]);
        expect(ids(grid)).toEqual([2, 3, 4, 5]);
    });

    it("notBlank is the exact complement", () => {
        const grid = sparseGrid();
        grid.setFilters([{ columnKey: "email", value: { op: "notBlank" } }]);
        expect(ids(grid)).toEqual([1, 6]);
    });

    it("every row satisfies exactly one of the two", () => {
        const grid = sparseGrid();
        grid.setFilters([{ columnKey: "email", value: { op: "blank" } }]);
        const blank = ids(grid);
        grid.setFilters([{ columnKey: "email", value: { op: "notBlank" } }]);
        const notBlank = ids(grid);
        expect([...blank, ...notBlank].sort((a, b) => a - b)).toEqual(sparse.map((r) => r.id));
    });

    it("reads the DISPLAYED text — a formatter that shows nothing is empty", () => {
        const grid = create<Sparse>({
            rows: sparse,
            columns: [
                {
                    key: "email",
                    filterType: "text",
                    // Present values whose display is blank: `is empty` means "shows nothing".
                    formatValue: (_c, row) => (row.id === 1 ? "" : (row.email ?? "(none)")),
                },
                { key: "id" },
            ],
        });
        grid.setFilters([{ columnKey: "email", value: { op: "blank" } }]);
        // Row 1 displays "" → empty; rows 2–3 display "(none)" → not empty; 4–5 display "" / "   ".
        expect(ids(grid)).toEqual([1, 4, 5]);
    });

    it("is accepted on a column whose chip list is the default three", () => {
        const grid = textGrid();
        grid.setFilters([{ columnKey: "name", value: { op: "blank" } }]);
        expect(names(grid)).toEqual([]);
        grid.setFilters([{ columnKey: "name", value: { op: "notBlank" } }]);
        expect(names(grid)).toHaveLength(4);
    });

    it("round-trips through getFilters as exactly { op }", () => {
        const grid = sparseGrid();
        grid.setFilters([{ columnKey: "email", value: { op: "blank" } }]);
        const [filter] = grid.getFilters();
        expect(filter.value).toEqual({ op: "blank" });
        expect(Object.keys(filter.value as object)).toEqual(["op"]);
        // ...and is accepted straight back.
        grid.setFilters(grid.getFilters());
        expect(ids(grid)).toEqual([2, 3, 4, 5]);
    });

    it("a text supplied beside blank is dropped, not rejected", () => {
        const grid = sparseGrid();
        grid.setFilters([{ columnKey: "email", value: { op: "blank", text: "ignored" } as any }]);
        expect(grid.getFilters()[0].value).toEqual({ op: "blank" });
        expect(ids(grid)).toEqual([2, 3, 4, 5]);
    });

    it("filterRows (public) matches blank without normalization", () => {
        const columns = [{ key: "email", filterType: "text" } as any];
        const kept = filterRows(sparse, columns, undefined, [
            { columnKey: "email", type: "text", value: { op: "notBlank" } } as Filter,
        ]);
        expect(kept.map((r) => r.id)).toEqual([1, 6]);
    });
});

describe("blank / notBlank — validation", () => {
    it("names all five operators for an unknown op", () => {
        expect(() =>
            sparseGrid({
                filters: [{ columnKey: "email", value: { op: "endsWith" as any, text: "x" } }],
            }),
        ).toThrow(/"contains", "equals", "startsWith", "blank", "notBlank"/);
    });

    it("rejects an unknown entry in textFilterOps, naming the column", () => {
        expect(() =>
            create<Sparse>({
                rows: sparse,
                columns: [
                    { key: "email", filterType: "text", textFilterOps: ["contains", "regex" as any] },
                ],
            }),
        ).toThrow(/Column "email".*textFilterOps.*"regex"/s);
    });

    it("rejects an empty list and a duplicate", () => {
        expect(() =>
            create<Sparse>({
                rows: sparse,
                columns: [{ key: "email", filterType: "text", textFilterOps: [] }],
            }),
        ).toThrow(/non-empty/);
        expect(() =>
            create<Sparse>({
                rows: sparse,
                columns: [
                    { key: "email", filterType: "text", textFilterOps: ["blank", "blank"] },
                ],
            }),
        ).toThrow(/"blank" twice/);
    });

    it("rejects textFilterOps on a column that is not a text filter", () => {
        expect(() =>
            create<Sparse>({
                rows: sparse,
                columns: [{ key: "email", textFilterOps: ["blank"] }],
            }),
        ).toThrow(/Column "email".*filterType: "options"/s);
    });
});

describe("blank / notBlank — the popover", () => {
    it("renders exactly the named chips, in the named order", async () => {
        const grid = create<Sparse>({
            rows: sparse,
            columns: [
                {
                    key: "email",
                    name: "Email",
                    filterType: "text",
                    textFilterOps: ["blank", "contains", "notBlank"],
                },
                { key: "id" },
            ],
        });
        void open(grid, "email");
        await settle();

        const chips = [...popover()!.querySelectorAll('[role="radio"]')];
        expect(chips.map((c) => c.getAttribute("data-op"))).toEqual([
            "blank",
            "contains",
            "notBlank",
        ]);
        expect(chips.map((c) => c.textContent)).toEqual(["is empty", "contains", "is not empty"]);
        // The first named chip is the preselected one when nothing is applied.
        expect(isChecked("blank")).toBe(true);
    });

    it("a default column still shows three chips — nothing changed for it", async () => {
        const grid = textGrid();
        void open(grid, "name");
        await settle();
        expect(popover()!.querySelectorAll('[role="radio"]')).toHaveLength(3);
    });

    it("Apply on `is empty` with an empty input APPLIES the filter — it does not clear", async () => {
        const grid = sparseGrid();
        void open(grid, "email");
        await settle();

        chip("blank").click();
        expect(textInput().value).toBe("");
        click(button("apply"));

        expect(grid.getFilters()[0]?.value).toEqual({ op: "blank" });
        expect(ids(grid)).toEqual([2, 3, 4, 5]);
    });

    it("text typed beside `is empty` is ignored and not stored", async () => {
        const grid = sparseGrid();
        void open(grid, "email");
        await settle();

        textInput().value = "stray";
        chip("notBlank").click();
        click(button("apply"));

        expect(grid.getFilters()[0]?.value).toEqual({ op: "notBlank" });
    });

    it("Enter applies from the input with a text-free operator selected", async () => {
        const grid = sparseGrid();
        const closed = open(grid, "email");
        await settle();

        chip("blank").click();
        textInput().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

        const applied = await closed;
        expect(applied?.value).toEqual({ op: "blank" });
    });

    it("the input says the text is not used under a text-free chip, and recovers", async () => {
        const grid = sparseGrid();
        void open(grid, "email");
        await settle();

        expect(textInput().placeholder).toBe("filter text…");
        chip("blank").click();
        expect(textInput().placeholder).toBe("no text needed");
        expect(textInput().disabled).toBe(false);
        chip("contains").click();
        expect(textInput().placeholder).toBe("filter text…");
    });

    it("arrow keys cycle all five chips in DOM order", async () => {
        const grid = sparseGrid();
        void open(grid, "email");
        await settle();

        const group = popover()!.querySelector('[role="radiogroup"]')!;
        const right = () =>
            group.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
        right();
        right();
        right();
        expect(isChecked("blank")).toBe(true);
        right();
        expect(isChecked("notBlank")).toBe(true);
        right();
        expect(isChecked("contains")).toBe(true);
    });

    it("shows the applied op's chip even when the column's list omits it", async () => {
        // The default three chips, but a `blank` filter applied from the API / persistence.
        const grid = textGrid({ filters: [{ columnKey: "name", value: { op: "blank" } }] });
        void open(grid, "name");
        await settle();

        const chips = [...popover()!.querySelectorAll('[role="radio"]')];
        expect(chips.map((c) => c.getAttribute("data-op"))).toEqual([
            "contains",
            "equals",
            "startsWith",
            "blank",
        ]);
        expect(isChecked("blank")).toBe(true);
        // ...and the roving tabindex has somewhere to land.
        expect(chips.filter((c) => (c as HTMLElement).tabIndex === 0)).toHaveLength(1);
    });
});

describe("blank / notBlank — the chip and persistence", () => {
    it("the chip reads `Email: is empty` — the word alone, no trailing text", () => {
        const grid = sparseGrid({ filters: [{ columnKey: "email", value: { op: "blank" } }] });
        expect(chipText("email")).toBe("Email: is empty");
        const [filter] = grid.getFilters();
        expect(grid.describeFilter(filter)).toEqual({
            name: "Email",
            values: "is empty",
            title: "Email: is empty",
        });
    });

    it("persists and restores as { op }", () => {
        const store = new Map<string, string>();
        const storage = {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => void store.set(k, v),
            removeItem: (k: string) => void store.delete(k),
        };
        const first = sparseGrid({ persistFilters: { name: "blank-test", storage } });
        first.setFilters([{ columnKey: "email", value: { op: "notBlank" } }]);
        first.destroy();

        const second = sparseGrid({ persistFilters: { name: "blank-test", storage } });
        expect(second.getFilters()[0]?.value).toEqual({ op: "notBlank" });
        expect(ids(second)).toEqual([1, 6]);
    });
});

// =============================================================================================
// Task 55 — filterLabel: the host's word on a chip
// =============================================================================================

describe("filterLabel", () => {
    it("replaces the chip's text for a text filter, and describeFilter agrees", () => {
        const grid = sparseGrid({
            filters: [{ columnKey: "email", value: { op: "blank" } }],
            filterLabel: (filter) =>
                filter.type === "text" && (filter.value as TextFilterValue)?.op === "blank"
                    ? "has no value"
                    : undefined,
        });
        expect(chipText("email")).toBe("Email: has no value");
        const [filter] = grid.getFilters();
        expect(grid.describeFilter(filter)).toEqual({
            name: "Email",
            values: "has no value",
            title: "Email: has no value",
        });
    });

    it("replaces the chip's text for an options filter, receiving the built-in text", () => {
        const seen: string[] = [];
        const grid = textGrid({
            filters: [{ columnKey: "status", value: ["open", "done"] }],
            filterLabel: (_filter, column, defaultText) => {
                seen.push(`${String(column?.key)}|${defaultText}`);
                return "either";
            },
        });
        void grid;
        expect(seen[0]).toBe("status|open,done");
        expect(chipText("status")).toBe("status: either");
    });

    it("undefined keeps the built-in text", () => {
        const grid = textGrid({
            filters: [{ columnKey: "name", value: "smith" }],
            filterLabel: () => undefined,
        });
        void grid;
        expect(chipText("name")).toBe("Name: contains smith");
    });

    it("runs after a custom definition's label and receives it", () => {
        const grid = create<Row>({
            rows,
            filterBar: true,
            columns: [
                {
                    key: "id",
                    name: "Id",
                    filter: {
                        name: "min",
                        create: () => ({ element: document.createElement("div"), getValue: () => 2 }),
                        match: (value: number, row: Row) => row.id >= value,
                        label: (value: number) => `≥ ${value}`,
                    },
                },
                { key: "name" },
            ],
            filters: [{ columnKey: "id", value: 3 }],
            filterLabel: (_f, _c, defaultText) => `at least ${defaultText.replace("≥ ", "")}`,
        });
        void grid;
        expect(chipText("id")).toBe("Id: at least 3");
    });

    it("a throw warns naming the column and the chip shows the default", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const grid = textGrid({
            filters: [{ columnKey: "name", value: "smith" }],
            filterLabel: () => {
                throw new Error("boom");
            },
        });
        void grid;
        expect(chipText("name")).toBe("Name: contains smith");
        expect(warn).toHaveBeenCalled();
        expect(String(warn.mock.calls[0][0])).toMatch(/filterLabel.*"name"/);
    });

    it("a changed answer rebuilds the chip on the next refresh", () => {
        let word = "first";
        const grid = textGrid({
            filters: [{ columnKey: "name", value: "smith" }],
            filterLabel: () => word,
        });
        expect(chipText("name")).toBe("Name: first");
        word = "second";
        // Any filters change redraws the bar; the signature differs, so the chip is rebuilt.
        grid.setFilters([{ columnKey: "name", value: "smithee" }]);
        expect(chipText("name")).toBe("Name: second");
    });

    it("can be set later through setOptions", () => {
        const grid = textGrid({ filters: [{ columnKey: "name", value: "smith" }] });
        expect(chipText("name")).toBe("Name: contains smith");
        grid.setOptions({ filterLabel: () => "later" });
        grid.setFilters([{ columnKey: "name", value: "smith" }, { columnKey: "status", value: ["open"] }]);
        expect(chipText("name")).toBe("Name: later");
    });
});
