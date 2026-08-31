// @vitest-environment happy-dom

/**
 * The built-in `"text"` filter type: `filterType: "text"` — one input, three operators.
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
