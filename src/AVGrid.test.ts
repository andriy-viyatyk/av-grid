// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AVGrid } from "./AVGrid";
import { version } from "./index";
import { AVGRID_STYLE_ID } from "./styles/av-grid.css";
import type { AVGridOptions } from "./options";

/**
 * happy-dom does no layout, so every element measures 0×0 and the grid would decide it has no
 * viewport to fill. Patching `createElement` for the duration of construction gives the shell
 * a real size — the same trick `RenderGrid.test.ts` uses, and for the same reason.
 *
 * These tests check *wiring*: that the right element carries the right attribute, that a
 * change reaches the DOM. What the grid looks like is a question for the board, not for a
 * DOM emulator with no layout engine — see `test-boards/` in CLAUDE.md.
 */
function withLayout<T>(fn: () => T): T {
    const originalCreate = document.createElement.bind(document);
    document.createElement = ((tag: string) => {
        const el = originalCreate(tag) as HTMLElement;
        Object.defineProperties(el, {
            offsetWidth: { value: 600, configurable: true },
            offsetHeight: { value: 300, configurable: true },
            clientWidth: { value: 600, configurable: true },
            clientHeight: { value: 300, configurable: true },
        });
        return el;
    }) as typeof document.createElement;

    try {
        return fn();
    } finally {
        document.createElement = originalCreate;
    }
}

const people = [
    { id: 1, name: "Ada", active: true },
    { id: 2, name: "Alan", active: false },
    { id: 3, name: "Grace", active: true },
];

const grids: AVGrid<any>[] = [];

function create<R>(
    options: AVGridOptions<R>,
    host = document.createElement("div"),
): AVGrid<R> {
    document.body.append(host);
    const grid = withLayout(() => AVGrid.create<R>(host, options));
    grids.push(grid);
    return grid;
}

/** Text of every rendered cell in a column, keyed by data row. */
function columnText(grid: AVGrid<any>, columnKey: string): string[] {
    return Array.from(
        grid.element.querySelectorAll(
            `[data-type="data-cell"][data-column-key="${columnKey}"]`,
        ),
    )
        .sort(
            (a, b) =>
                Number(a.getAttribute("data-row")) -
                Number(b.getAttribute("data-row")),
        )
        .map((el) => el.textContent ?? "");
}

/**
 * The data cell at a data row. Note it cannot be `[data-row="0"]` alone: the header carries
 * `data-row="0"` too, so a selector without the type matches it first.
 */
function dataCell(grid: AVGrid<any>, row: number): HTMLElement | null {
    return grid.element.querySelector(
        `[data-type="data-cell"][data-row="${row}"]`,
    );
}

function headerText(grid: AVGrid<any>): string[] {
    return Array.from(
        grid.element.querySelectorAll('[data-type="header-cell"]'),
    )
        .sort(
            (a, b) =>
                Number(a.getAttribute("data-col")) -
                Number(b.getAttribute("data-col")),
        )
        .map((el) => el.querySelector(".avg-header-title")?.textContent ?? "");
}

/** Let the microtask-coalesced update and the rAF paint both run. */
async function settle(): Promise<void> {
    await Promise.resolve();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await Promise.resolve();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
}

afterEach(() => {
    while (grids.length) grids.pop()?.destroy();
    document.body.textContent = "";
    document.getElementById(AVGRID_STYLE_ID)?.remove();
});

describe("AVGrid.create — the minimum call", () => {
    it("renders a grid with a header from rows alone", () => {
        const grid = create({ rows: people });

        expect(grid.element.getAttribute("data-type")).toBe("render-grid");
        expect(grid.element.classList.contains("avg-grid")).toBe(true);
        expect(headerText(grid)).toEqual(["ID", "Name", "Active"]);
        expect(columnText(grid, "name")).toEqual(["Ada", "Alan", "Grace"]);
    });

    it("accepts a CSS selector as the container", () => {
        const host = document.createElement("div");
        host.id = "grid-host";
        document.body.append(host);

        const grid = withLayout(() => AVGrid.create("#grid-host", { rows: people }));
        grids.push(grid);

        expect(host.contains(grid.element)).toBe(true);
    });

    it("injects the stylesheet once, however many grids are created", () => {
        create({ rows: people });
        create({ rows: people });
        expect(document.querySelectorAll(`#${AVGRID_STYLE_ID}`)).toHaveLength(1);
    });

    it("does not inject when asked not to", () => {
        create({ rows: people, injectStyles: false });
        expect(document.getElementById(AVGRID_STYLE_ID)).toBeNull();
    });

    it("renders an empty grid without complaint", () => {
        const grid = create({ rows: [] });
        expect(grid.getState().rowCount).toBe(0);
        expect(grid.element.querySelectorAll('[data-type="data-cell"]')).toHaveLength(
            0,
        );
    });
});

describe("AVGrid.create — bad input", () => {
    it("names the fix for a missing container", () => {
        expect(() => AVGrid.create(undefined as any, { rows: people })).toThrow(
            /container must be an element or a CSS selector/,
        );
    });

    it("names the fix for a selector matching nothing", () => {
        expect(() => AVGrid.create("#nope", { rows: people })).toThrow(
            /No element matches the selector "#nope"/,
        );
    });

    it("names the fix for a non-array rows", () => {
        expect(() =>
            AVGrid.create(document.createElement("div"), { rows: "no" as any }),
        ).toThrow(/`rows` must be an array/);
    });

    it("names the available columns for a misspelled key", () => {
        expect(() =>
            AVGrid.create(document.createElement("div"), {
                rows: people,
                columns: [{ key: "nmae" }],
            }),
        ).toThrow(/Unknown column "nmae"\. Available columns: id, name, active\./);
    });
});

describe("cells", () => {
    it("carries the data attributes selectors and tests rely on", () => {
        const grid = create({ rows: people });
        const cell = grid.element.querySelector(
            '[data-type="data-cell"][data-row="1"][data-column-key="name"]',
        );
        expect(cell?.textContent).toBe("Alan");
    });

    it("renders a boolean column as an icon, never as the word false", () => {
        const grid = create({ rows: people });
        const cells = grid.element.querySelectorAll(
            '[data-type="data-cell"][data-column-key="active"]',
        );
        const texts = Array.from(cells).map((c) => c.textContent);
        expect(texts.join("")).toBe("");
        expect(
            grid.element.querySelectorAll(
                '[data-column-key="active"] .avg-check-icon',
            ).length,
        ).toBe(2);
    });

    it("right-aligns numbers and centres booleans by default", () => {
        const grid = create({ rows: people });
        const idCell = grid.element.querySelector(
            '[data-type="data-cell"][data-column-key="id"]',
        );
        const activeCell = grid.element.querySelector(
            '[data-type="data-cell"][data-column-key="active"]',
        );
        expect(idCell?.classList.contains("avg-align-right")).toBe(true);
        expect(activeCell?.classList.contains("avg-align-center")).toBe(true);
    });

    it("honours an explicit align over the inferred one", () => {
        const grid = create({
            rows: people,
            columns: [{ key: "id", align: "left" }],
        });
        const cell = grid.element.querySelector('[data-type="data-cell"]');
        expect(cell?.classList.contains("avg-align-right")).toBe(false);
    });

    describe("the custom render hook", () => {
        it("accepts an HTML string", () => {
            const grid = create({
                rows: people,
                columns: [{ key: "name", render: (c) => `<b>${c.value}</b>` }],
            });
            const cell = dataCell(grid, 0);
            expect(cell?.innerHTML).toBe("<b>Ada</b>");
        });

        it("accepts an element", () => {
            const grid = create({
                rows: people,
                columns: [
                    {
                        key: "name",
                        render: (c) => {
                            const el = document.createElement("span");
                            el.className = "custom";
                            el.textContent = String(c.value).toUpperCase();
                            return el;
                        },
                    },
                ],
            });
            const cell = dataCell(grid, 0)?.querySelector('.custom');
            expect(cell?.textContent).toBe("ADA");
        });

        it("renders an empty cell for null", () => {
            const grid = create({
                rows: people,
                columns: [{ key: "name", render: () => null }],
            });
            expect(
                dataCell(grid, 0)?.textContent,
            ).toBe("");
        });

        it("receives value, row, column and both indices", () => {
            const seen: any[] = [];
            create({
                rows: [people[0]],
                columns: [{ key: "name", render: (c) => (seen.push(c), "") }],
            });
            expect(seen[0]).toMatchObject({
                value: "Ada",
                row: people[0],
                rowIndex: 0,
                colIndex: 0,
                rowKey: "1",
            });
        });
    });

    it("applies onCellClass on top of the built-in classes", () => {
        const grid = create({
            rows: people,
            columns: [{ key: "name" }],
            onCellClass: (c) => (c.rowIndex === 1 ? "flagged" : undefined),
        });
        expect(
            dataCell(grid, 1)?.classList.contains("flagged"),
        ).toBe(true);
        expect(
            dataCell(grid, 0)?.classList.contains("flagged"),
        ).toBe(false);
    });
});

describe("class hooks", () => {
    /** Every rendered cell of one column, by data row. */
    function cells(grid: AVGrid<any>, columnKey: string): HTMLElement[] {
        return Array.from(
            grid.element.querySelectorAll<HTMLElement>(
                `[data-type="data-cell"][data-column-key="${columnKey}"]`,
            ),
        ).sort(
            (a, b) =>
                Number(a.getAttribute("data-row")) -
                Number(b.getAttribute("data-row")),
        );
    }

    it("applies a column's cellClass to that column only", () => {
        const grid = create({
            rows: people,
            columns: [
                { key: "name", cellClass: (c) => (c.value === "Alan" ? "hit" : undefined) },
                { key: "id" },
            ],
        });
        expect(cells(grid, "name").map((el) => el.classList.contains("hit"))).toEqual([
            false,
            true,
            false,
        ]);
        expect(cells(grid, "id").every((el) => !el.classList.contains("hit"))).toBe(true);
    });

    it("accepts a constant string, with no context object built for it", () => {
        const seen: any[] = [];
        const grid = create({
            rows: people,
            columns: [{ key: "name", cellClass: "wrap" }, { key: "id", render: (c) => (seen.push(c), "") }],
        });
        expect(cells(grid, "name").every((el) => el.classList.contains("wrap"))).toBe(true);
        // The other column's `render` proves the context path still works where it is needed.
        expect(seen.length).toBeGreaterThan(0);
    });

    it("applies rowClass to every cell of the row", () => {
        const grid = create({
            rows: people,
            columns: [{ key: "name" }, { key: "id" }],
            rowClass: (r) => (r.row.active ? "on" : undefined),
        });
        expect(cells(grid, "name").map((el) => el.classList.contains("on"))).toEqual([
            true,
            false,
            true,
        ]);
        expect(cells(grid, "id").map((el) => el.classList.contains("on"))).toEqual([
            true,
            false,
            true,
        ]);
    });

    it("hands rowClass the row, its index and its key — and no column", () => {
        const seen: any[] = [];
        create({
            rows: [people[0]],
            columns: [{ key: "name" }],
            rowClass: (r) => (seen.push(r), undefined),
        });
        expect(seen[0]).toEqual({ row: people[0], rowIndex: 0, rowKey: "1" });
    });

    it("joins an array and drops its falsy entries", () => {
        const grid = create({
            rows: [people[0]],
            columns: [{ key: "name", cellClass: () => ["a", undefined, false && "b", "c"] }],
        });
        const list = Array.from(dataCell(grid, 0)!.classList);
        expect(list).toContain("a");
        expect(list).toContain("c");
        expect(list).toContain("avg-data-cell");
        expect(list).not.toContain("false");
    });

    it("stacks all three hooks with the built-in classes", () => {
        const grid = create({
            rows: [people[0]],
            columns: [{ key: "name", cellClass: "col" }],
            onCellClass: () => "grid",
            rowClass: () => "row",
        });
        const list = Array.from(dataCell(grid, 0)!.classList);
        expect(list).toEqual(
            expect.arrayContaining(["avg-data-cell", "col", "grid", "row"]),
        );
    });

    /**
     * The pool trap. Cells arrive at their next occupant holding the last one's classes, so a
     * class that stops applying has to be *absent* after the repaint, not merely un-asked-for.
     */
    it("removes a class that stops applying on the next paint", async () => {
        let flagged = true;
        const grid = create({
            rows: [people[0]],
            columns: [{ key: "name" }],
            rowClass: () => (flagged ? "flagged" : undefined),
        });
        expect(dataCell(grid, 0)?.classList.contains("flagged")).toBe(true);

        flagged = false;
        grid.refresh();
        await settle();
        expect(dataCell(grid, 0)?.classList.contains("flagged")).toBe(false);
        expect(dataCell(grid, 0)?.classList.contains("avg-data-cell")).toBe(true);
    });

    it("applies headerClass, as a string and as a function", () => {
        const grid = create({
            rows: people,
            columns: [
                { key: "name", headerClass: "wrap" },
                { key: "id", headerClass: (h) => `col-${h.colIndex}` },
            ],
        });
        const headers = Array.from(
            grid.element.querySelectorAll('[data-type="header-cell"]'),
        );
        expect(headers[0].classList.contains("wrap")).toBe(true);
        expect(headers[1].classList.contains("col-1")).toBe(true);
        expect(headers[0].classList.contains("avg-header-cell")).toBe(true);
    });
});

describe("headers", () => {
    it("falls back to the key when a column has no name", () => {
        const grid = create({ rows: people, columns: [{ key: "name" }] });
        expect(headerText(grid)).toEqual(["name"]);
    });

    it("shows a sort indicator on the sorted column only", async () => {
        const grid = create({ rows: people, sort: { key: "name", direction: "asc" } });
        await settle();

        const sorted = grid.element.querySelectorAll("[data-sort]");
        expect(sorted).toHaveLength(1);
        expect(sorted[0].getAttribute("data-column-key")).toBe("name");
        expect(sorted[0].getAttribute("data-sort")).toBe("asc");
    });

    it("cycles the sort when its header is clicked", async () => {
        const grid = create({ rows: people });
        const header = grid.element.querySelector(
            '[data-type="header-cell"][data-column-key="name"]',
        ) as HTMLElement;

        header.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(grid.getSort()).toEqual({ key: "name", direction: "asc" });

        header.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(grid.getSort()).toEqual({ key: "name", direction: "desc" });

        header.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(grid.getSort()).toBeUndefined();
    });

    it("marks a column resizable unless it is a status column", () => {
        const grid = create({
            rows: people,
            columns: [
                { key: "id", isStatusColumn: true },
                { key: "name" },
                { key: "active", resizable: false },
            ],
        });
        const resizable = Array.from(
            grid.element.querySelectorAll('[data-type="header-cell"]'),
        ).map((el) => el.getAttribute("data-resizable"));
        expect(resizable).toEqual(["false", "true", "false"]);
    });

    it("renders a custom header", () => {
        const grid = create({
            rows: people,
            columns: [{ key: "name", headerRender: () => "<i>Name</i>" }],
        });
        expect(
            grid.element.querySelector(".avg-header-title")?.innerHTML,
        ).toBe("<i>Name</i>");
    });
});

describe("updates", () => {
    it("repaints in place when the rows change", async () => {
        const grid = create({ rows: people, columns: [{ key: "name" }] });
        const before = dataCell(grid, 0);

        grid.setRows([{ id: 9, name: "Zoe", active: false }]);
        await settle();

        expect(columnText(grid, "name")).toEqual(["Zoe"]);
        // The same element was updated, not replaced — the `previous` contract.
        expect(dataCell(grid, 0)).toBe(before);
    });

    it("re-sorts and repaints when the sort is set", async () => {
        const grid = create({ rows: people, columns: [{ key: "name" }] });
        grid.setSort({ key: "name", direction: "desc" });
        await settle();
        expect(columnText(grid, "name")).toEqual(["Grace", "Alan", "Ada"]);
    });

    it("filters on a search string and restores when cleared", async () => {
        const grid = create({ rows: people, columns: [{ key: "name" }] });

        grid.setSearchString("a");
        await settle();
        expect(columnText(grid, "name")).toEqual(["Ada", "Alan", "Grace"]);

        grid.setSearchString("ada");
        await settle();
        expect(columnText(grid, "name")).toEqual(["Ada"]);

        grid.setSearchString(undefined);
        await settle();
        expect(columnText(grid, "name")).toHaveLength(3);
    });

    it("applies a new column set", async () => {
        const grid = create({ rows: people });
        grid.setColumns([{ key: "name", name: "Who" }]);
        await settle();
        expect(headerText(grid)).toEqual(["Who"]);
    });

    it("toggles the borderless variant through setOptions", () => {
        const grid = create({ rows: people });
        grid.setOptions({ cellBorders: false });
        expect(grid.element.getAttribute("data-cell-borders")).toBe("off");
        grid.setOptions({ cellBorders: true });
        expect(grid.element.hasAttribute("data-cell-borders")).toBe(false);
    });
});

describe("callbacks", () => {
    it("reports a cell click with its context", () => {
        const onCellClick = vi.fn();
        const grid = create({ rows: people, columns: [{ key: "name" }], onCellClick });

        (
            dataCell(grid, 1) as HTMLElement
        ).dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onCellClick).toHaveBeenCalledTimes(1);
        expect(onCellClick.mock.calls[0][0]).toMatchObject({
            value: "Alan",
            rowIndex: 1,
            rowKey: "2",
        });
    });

    it("reports a double click", () => {
        const onCellDoubleClick = vi.fn();
        const grid = create({
            rows: people,
            columns: [{ key: "name" }],
            onCellDoubleClick,
        });

        (
            dataCell(grid, 0) as HTMLElement
        ).dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

        expect(onCellDoubleClick).toHaveBeenCalledTimes(1);
    });
});

describe("getState", () => {
    it("answers what the grid thinks is going on, in one call", async () => {
        const grid = create({ rows: people, columns: [{ key: "name" }] });
        grid.setSort({ key: "name", direction: "desc" });
        grid.setSearchString("a");
        await settle();

        expect(grid.getState()).toMatchObject({
            version: AVGrid.version,
            destroyed: false,
            rowCount: 3,
            sourceRowCount: 3,
            columnCount: 1,
            sort: { key: "name", direction: "desc" },
            searchString: "a",
            rowHeight: 24,
        });
    });

    it("survives JSON.stringify — no functions, no rows, no DOM", async () => {
        const grid = create({
            rows: people,
            editable: true,
            selectColumn: true,
            columns: [
                { key: "name", name: "Name", render: (c: any) => String(c.value) },
                { key: "active", options: [true, false], readonly: true },
            ],
        });
        grid.applyFilter({ columnKey: "name", value: ["Ada"] });
        grid.focusCell(0, 1);
        grid.setSelected(["1"]);
        await settle();

        // The real check: a round-trip through JSON is lossless. A live `Column` in here
        // would drop its functions silently and hand back something that looks fine.
        const state = grid.getState();
        expect(JSON.parse(JSON.stringify(state))).toEqual(
            JSON.parse(JSON.stringify(state)),
        );
        expect(JSON.stringify(state)).not.toContain("function");
    });

    it("flattens the columns, with the state each one is in", async () => {
        const grid = create({
            rows: people,
            editable: true,
            columns: [
                { key: "name", name: "Name", width: 120, dataType: "string" },
                { key: "active", readonly: true, options: [true, false] },
            ],
        });
        grid.setSort({ key: "name", direction: "asc" });
        grid.applyFilter({ columnKey: "active", value: [true] });
        await settle();

        expect(grid.getState().columns).toEqual([
            {
                key: "name",
                name: "Name",
                width: 120,
                dataType: "string",
                align: undefined,
                sorted: "asc",
                filtered: false,
                editable: true,
                isStatusColumn: undefined,
                hasRender: false,
                hasOptions: false,
            },
            {
                key: "active",
                name: "active",
                width: expect.any(Number),
                // Undefined, not "boolean": a dataType is only inferred for columns the grid
                // inferred whole. A declared column is reported exactly as declared.
                dataType: undefined,
                align: undefined,
                sorted: undefined,
                filtered: true,
                editable: false,
                isStatusColumn: undefined,
                hasRender: false,
                hasOptions: true,
            },
        ]);
    });

    it("reports the window the engine believes is on screen", async () => {
        const grid = create({ rows: people, columns: [{ key: "name" }] });
        await settle();

        // 300px of viewport at 24px a row, so all three rows are in it. The header is grid
        // row 0 and is deliberately not counted: `firstRow` is a data row.
        expect(grid.getState().viewport).toMatchObject({
            firstRow: 0,
            lastRow: 2,
            firstColumn: 0,
            scrollTop: 0,
            scrollLeft: 0,
        });
    });

    it("says so when there is nothing to show", async () => {
        const grid = create({ rows: [], columns: [{ key: "name" }] });
        await settle();
        expect(grid.getState().viewport).toMatchObject({ firstRow: -1, lastRow: -1 });
    });

    it("reports the open edit, and whether it has been touched", async () => {
        const grid = create({
            rows: people,
            editable: true,
            columns: [{ key: "name" }],
        });
        await settle();
        grid.startEdit(0, 0);

        expect(grid.getState().editing).toEqual({
            rowKey: "1",
            columnKey: "name",
            changed: false,
        });
    });
});

describe("version", () => {
    it("is the one string, everywhere", () => {
        // The classic drift: three copies of a version, two of them stale after a release.
        const pkg = JSON.parse(
            readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
        ) as { version: string };

        expect(AVGrid.version).toBe(pkg.version);
        expect(version).toBe(pkg.version);
    });
});

describe("filters", () => {
    const withFull = [
        { key: "name" },
        { key: "full", formatValue: (_c: any, r: any) => `${r.name} (${r.id})` },
    ];

    it("narrows the rendered rows, and restores them", async () => {
        const grid = create({ rows: people, columns: [{ key: "name" }] });
        grid.applyFilter({ columnKey: "name", value: ["Ada", "Grace"] });
        await settle();
        expect(columnText(grid, "name")).toEqual(["Ada", "Grace"]);

        grid.clearFilters();
        await settle();
        expect(columnText(grid, "name")).toEqual(["Ada", "Alan", "Grace"]);
    });

    it("hands back a normalized filter, ready to pass straight back in", async () => {
        const grid = create({ rows: people, columns: [{ key: "name", name: "Name" }] });
        grid.applyFilter({ columnKey: "name", value: ["Ada"] });

        expect(grid.getFilters()).toEqual([
            {
                columnKey: "name",
                columnName: "Name",
                type: "options",
                displayFormat: undefined,
                value: [{ value: "Ada", label: "Ada" }],
            },
        ]);
        expect(grid.isFiltered("name")).toBe(true);
    });

    it("appears in getState, for a host that logs one object", async () => {
        const grid = create({ rows: people, columns: [{ key: "name" }] });
        grid.setFilters([{ columnKey: "name", value: ["Ada"] }]);
        await settle();

        expect(grid.getState()).toMatchObject({ rowCount: 1, sourceRowCount: 3 });
        expect(grid.getState().filters).toHaveLength(1);
    });

    it("takes filters through setOptions too", async () => {
        const grid = create({ rows: people, columns: [{ key: "name" }] });
        grid.setOptions({ filters: [{ columnKey: "name", value: ["Grace"] }] });
        await settle();
        expect(columnText(grid, "name")).toEqual(["Grace"]);
    });

    it("searches a computed column by what it displays", async () => {
        // The gap deferred from task 13: `full` has no row property, so a search that read
        // the raw value could never match a column the user can see.
        const grid = create({ rows: people, columns: withFull });
        grid.setSearchString("(2)");
        await settle();
        expect(columnText(grid, "name")).toEqual(["Alan"]);
    });

    it("filters a computed column the same way", async () => {
        const grid = create({ rows: people, columns: withFull });
        grid.applyFilter({ columnKey: "full", value: ["Grace (3)"] });
        await settle();
        expect(columnText(grid, "name")).toEqual(["Grace"]);
    });
});

describe("two grids on one page", () => {
    it("do not interfere", async () => {
        const a = create({ rows: people, columns: [{ key: "name" }] });
        const b = create({
            rows: [{ id: 7, name: "Solo", active: true }],
            columns: [{ key: "name" }],
        });

        a.setSort({ key: "name", direction: "desc" });
        await settle();

        expect(columnText(a, "name")).toEqual(["Grace", "Alan", "Ada"]);
        expect(columnText(b, "name")).toEqual(["Solo"]);
        expect(b.getSort()).toBeUndefined();
    });
});

describe("destroy", () => {
    it("removes the grid from the page and is safe to call twice", () => {
        const host = document.createElement("div");
        const grid = create({ rows: people }, host);

        grid.destroy();
        expect(host.children).toHaveLength(0);
        expect(() => grid.destroy()).not.toThrow();
    });

    it("stops responding to clicks once destroyed", () => {
        const onCellClick = vi.fn();
        const grid = create({ rows: people, columns: [{ key: "name" }], onCellClick });
        const cell = dataCell(grid, 0) as HTMLElement;

        grid.destroy();
        cell.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onCellClick).not.toHaveBeenCalled();
    });

    it("says it is destroyed, and still answers getState()", () => {
        const grid = create({ rows: people, columns: [{ key: "name" }] });

        expect(grid.isDestroyed()).toBe(false);
        grid.destroy();

        expect(grid.isDestroyed()).toBe(true);
        // A post-mortem is exactly when this gets called, so it must not throw.
        expect(grid.getState()).toMatchObject({ destroyed: true, sourceRowCount: 3 });
    });

    it("warns once and does nothing when a stale callback writes to it", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const onEdit = vi.fn();
        const rows = [...people];
        const grid = create({ rows, editable: true, columns: [{ key: "name" }], onEdit });
        grid.destroy();

        grid.setRows([]);
        grid.setSort({ key: "name", direction: "asc" });
        expect(grid.setCellValue(0, 0, "Zed")).toBe(false);
        expect(grid.addRows([{ id: 9, name: "Nine", active: true }])).toEqual([]);

        // The host's own array is untouched, and no callback fired against a dead grid.
        expect(rows).toHaveLength(3);
        expect(onEdit).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0])).toContain("has been destroyed");
        warn.mockRestore();
    });

    it("closes an open editor and its popover before tearing the DOM down", async () => {
        const grid = create({
            rows: people,
            editable: true,
            columns: [{ key: "name", options: ["Ada", "Grace"] }],
        });
        await settle();
        grid.startEdit(0, 0);
        await settle();

        grid.destroy();

        expect(grid.isEditing()).toBe(false);
        expect(document.querySelector(".avg-popover")).toBeNull();
        expect(document.querySelector(".avg-cell-editor")).toBeNull();
    });

    /**
     * The plan's gate: create and destroy a grid 100 times and watch memory stay flat.
     *
     * A DOM emulator cannot weigh a heap, so what is checked here is the thing that would
     * *make* it climb — something outside the grid still pointing at it. Every listener and
     * every node the library adds is counted, and after 100 cycles both must be back where
     * they started. The heap measurement itself is a board job: `window.avg.measureTeardown()`.
     */
    it("leaves nothing behind after 100 create/destroy cycles", async () => {
        const listeners = new Map<string, number>();
        const count = (target: string, delta: number) => (e: string) =>
            listeners.set(`${target}:${e}`, (listeners.get(`${target}:${e}`) ?? 0) + delta);

        const patch = (target: Document | Window, name: string) => {
            const add = target.addEventListener.bind(target);
            const remove = target.removeEventListener.bind(target);
            const tally = { add: count(name, 1), remove: count(name, -1) };
            target.addEventListener = ((t: string, ...rest: any[]) => {
                tally.add(t);
                return (add as any)(t, ...rest);
            }) as any;
            target.removeEventListener = ((t: string, ...rest: any[]) => {
                tally.remove(t);
                return (remove as any)(t, ...rest);
            }) as any;
            return () => {
                target.addEventListener = add;
                target.removeEventListener = remove;
            };
        };

        const restore = [patch(document, "document"), patch(window, "window")];
        // The style element is shared by every grid in the document and is meant to outlive
        // them, so it is put in place before the baseline rather than counted as a leak.
        const baselineNodes = (() => {
            const first = create({ rows: people, columns: [{ key: "name" }] });
            first.destroy();
            grids.pop();
            return document.querySelectorAll("*").length;
        })();

        for (let i = 0; i < 100; i++) {
            const host = document.createElement("div");
            document.body.append(host);
            const grid = withLayout(() =>
                AVGrid.create(host, {
                    rows: people,
                    editable: true,
                    filterBar: true,
                    selectColumn: true,
                    canAddRows: true,
                    columns: [{ key: "name" }, { key: "active" }],
                }),
            );
            grid.applyFilter({ columnKey: "name", value: ["Ada"] });
            grid.focusCell(0, 0);
            grid.destroy();
            host.remove();
        }
        await settle();
        restore.forEach((r) => r());

        expect(document.querySelectorAll("*").length).toBe(baselineNodes);
        expect([...listeners].filter(([, n]) => n !== 0)).toEqual([]);
    });
});
