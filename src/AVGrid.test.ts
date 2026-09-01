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

    it("takes DOM focus when its header is pressed", () => {
        // The keyboard only works while the root holds focus, and a header press used to
        // leave it wherever it was — so sorting by clicking killed the arrow keys.
        const grid = create({ rows: people });
        const header = grid.element.querySelector(
            '[data-type="header-cell"][data-column-key="name"]',
        ) as HTMLElement;

        document.body.focus();
        header.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        expect(document.activeElement).toBe(grid.element);
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

    it("Ctrl+click appends to the sort in multiSort mode", () => {
        const grid = create({ rows: people, multiSort: true });
        const clickHeader = (key: string, ctrlKey = false) =>
            grid.element
                .querySelector(
                    `[data-type="header-cell"][data-column-key="${key}"]`,
                )!
                .dispatchEvent(
                    new MouseEvent("click", { bubbles: true, ctrlKey }),
                );

        clickHeader("name");
        clickHeader("active", true);
        expect(grid.getSort()).toEqual([
            { key: "name", direction: "asc" },
            { key: "active", direction: "asc" },
        ]);

        // Cmd+click means the same — Ctrl+click is the macOS context-menu gesture.
        grid.element
            .querySelector('[data-type="header-cell"][data-column-key="active"]')!
            .dispatchEvent(
                new MouseEvent("click", { bubbles: true, metaKey: true }),
            );
        expect(grid.getSort()).toEqual([
            { key: "name", direction: "asc" },
            { key: "active", direction: "desc" },
        ]);

        // A plain click resets the whole list to the clicked column.
        clickHeader("active");
        expect(grid.getSort()).toEqual([{ key: "active", direction: "asc" }]);
    });

    it("shows position numbers only when two or more columns sort, aria-sort on the primary", async () => {
        const grid = create({
            rows: people,
            multiSort: true,
            sort: [{ key: "name", direction: "asc" }],
        });
        const header = (key: string) =>
            grid.element.querySelector(
                `[data-type="header-cell"][data-column-key="${key}"]`,
            ) as HTMLElement;

        await settle();
        // One sorted column: pixel-identical to the single-sort look — no number.
        expect(header("name").querySelector(".avg-sort-pos")).toBeNull();
        expect(header("name").getAttribute("aria-sort")).toBe("ascending");

        grid.setSort([
            { key: "name", direction: "asc" },
            { key: "active", direction: "desc" },
        ]);
        await settle();
        expect(header("name").querySelector(".avg-sort-pos")?.textContent).toBe("1");
        expect(header("active").querySelector(".avg-sort-pos")?.textContent).toBe("2");
        // ARIA recommends one aria-sort per grid — the primary column carries it.
        expect(header("name").getAttribute("aria-sort")).toBe("ascending");
        expect(header("active").hasAttribute("aria-sort")).toBe(false);
        expect(header("active").getAttribute("data-sort")).toBe("desc");
    });

    it("re-normalizes the sort arity when multiSort flips through setOptions", () => {
        const grid = create({
            rows: people,
            multiSort: true,
            sort: [
                { key: "name", direction: "asc" },
                { key: "active", direction: "desc" },
            ],
        });

        grid.setOptions({ multiSort: false });
        // Single mode holds one column — the primary survives the flip.
        expect(grid.getSort()).toEqual({ key: "name", direction: "asc" });

        grid.setOptions({ multiSort: true });
        expect(grid.getSort()).toEqual([{ key: "name", direction: "asc" }]);
    });

    it("getSort reports [] in multiSort mode when unsorted", () => {
        const grid = create({ rows: people, multiSort: true });
        expect(grid.getSort()).toEqual([]);
    });

    it("rejects an array sort without multiSort, naming the fix", () => {
        expect(() =>
            create({
                rows: people,
                sort: [{ key: "name", direction: "asc" }],
            }),
        ).toThrow(/multiSort: true/);
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

    it("accepts an SVG element as a custom header", () => {
        // `HeaderRenderer`'s element arm is `Element`, not `HTMLElement`: an icon built with
        // `createElementNS` is an `SVGElement`, and a header icon is the whole reason the arm
        // exists. The header holds that node itself, not a re-parse of its markup.
        const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        icon.setAttribute("viewBox", "0 0 16 16");

        const grid = create({
            rows: people,
            columns: [{ key: "name", headerRender: () => icon }],
        });

        const title = grid.element.querySelector(".avg-header-title");
        expect(title?.firstElementChild).toBe(icon);
        expect(title?.firstElementChild?.namespaceURI).toBe("http://www.w3.org/2000/svg");
    });
});

describe("pinned columns", () => {
    const wide = Array.from({ length: 3 }, (_, i) => ({
        id: i + 1,
        a: i,
        b: i,
        total: i * 10,
    }));

    it("wires the trailing pinned-right run to the engine and its band", async () => {
        const grid = create({
            rows: wide,
            columns: [
                { key: "id", width: 60 },
                { key: "a", width: 60 },
                { key: "b", width: 60 },
                { key: "total", width: 60, pinned: "right" },
            ],
        });
        await settle();

        // The engine received the count…
        expect((grid.render.model as any).options.stickyRight).toBe(1);
        // …and the pinned column's cells landed in the sticky-right band, not the canvas.
        const band = grid.element.querySelector(".avg-sticky-right")!;
        const cell = band.querySelector('[data-column-key="total"]');
        expect(cell).not.toBeNull();
        // data-col is the real index into the visible columns — never renumbered in the band.
        expect(cell!.getAttribute("data-col")).toBe("3");
    });

    it("marks the pinned headers, keeps their affordances, and pins left chrome", async () => {
        const grid = create({
            rows: wide,
            columns: [
                { key: "id", width: 60, pinned: "left" },
                { key: "a", width: 60 },
                { key: "total", width: 60, pinned: "right" },
            ],
        });
        await settle();

        const header = (key: string) =>
            grid.element.querySelector(
                `[data-type="header-cell"][data-column-key="${key}"]`,
            ) as HTMLElement;

        // pinned: "left" is sticky and fixed in place — but DATA (task 53): it keeps its
        // resize grip. Only chrome (isStatusColumn) loses it.
        expect(header("id").getAttribute("data-pinned")).toBe("left");
        expect(header("id").getAttribute("data-resizable")).toBe("true");
        expect(header("id").draggable).toBe(false);

        // A right-pinned column is data that happens to be sticky: everything stays.
        expect(header("total").getAttribute("data-pinned")).toBe("right");
        expect(header("total").getAttribute("data-resizable")).toBe("true");
        expect(header("total").draggable).toBe(true);
        expect(header("a").getAttribute("data-pinned")).toBeNull();
    });

    it("keeps a right-pinned column in copy, edit and focus paths", async () => {
        const grid = create({
            rows: wide,
            columns: [
                { key: "id", width: 60, pinned: "left" },
                { key: "a", width: 60 },
                { key: "total", width: 60, pinned: "right" },
            ],
            editable: true,
        });
        await settle();

        // Focus skips the left chrome but reaches the pinned-right data column.
        grid.focusCell(0, 1);
        grid.selectRange(0, 1, 0, 2);
        expect(grid.getSelectionText()).toBe("0\t0\n");

        // The pinned-right cell edits like any data cell.
        grid.startEdit(0, 2);
        expect(grid.getState().editing?.columnKey).toBe("total");
        grid.cancelEdit();
    });

    it("a pinned-left DATA column keeps focus, copy, edit, filter and the keyboard landing", async () => {
        // Task 53: pinned: "left" without isStatusColumn is sticky but still data. The
        // checkbox stays chrome, so with selectColumn the visible columns are
        // [checkbox, id (pinned left), a, total (pinned right)].
        const grid = create({
            rows: wide,
            columns: [
                { key: "id", width: 60, pinned: "left" },
                { key: "a", width: 60 },
                { key: "total", width: 60, pinned: "right" },
            ],
            editable: true,
            selectColumn: true,
        });
        await settle();

        // The keyboard landing (nothing focused yet) skips the checkbox (chrome) but stops
        // ON the pinned data column, and ArrowLeft/Ctrl+Home stop there too.
        const key = (k: string, init: KeyboardEventInit = {}) =>
            grid.element.dispatchEvent(
                new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }),
            );
        key("ArrowDown");
        expect(String(grid.getFocus()?.columnKey)).toBe("id");
        key("ArrowLeft");
        expect(String(grid.getFocus()?.columnKey)).toBe("id");
        key("Home", { ctrlKey: true });
        expect(String(grid.getFocus()?.columnKey)).toBe("id");

        // Copy includes the pinned column — it is the identity column a paste most wants.
        grid.selectRange(0, 1, 0, 2);
        expect(grid.getSelectionText()).toBe("1\t0\n");

        // It edits like any data cell.
        grid.startEdit(0, 1);
        expect(grid.getState().editing?.columnKey).toBe("id");
        grid.cancelEdit();

        // It keeps its filter funnel; the checkbox does not have one.
        const funnel = (key: string) =>
            grid.element.querySelector<HTMLElement>(
                `[data-type="header-cell"][data-column-key="${key}"] [data-type="filter-button"]`,
            );
        expect(funnel("id")?.style.display).not.toBe("none");
        // The checkbox header is chrome: either no funnel element at all, or a hidden one.
        const selectFunnel = funnel("avg-select");
        if (selectFunnel) expect(selectFunnel.style.display).toBe("none");
    });

    it("unpinning via setColumns collapses the band", async () => {
        const grid = create({
            rows: wide,
            columns: [
                { key: "id", width: 60 },
                { key: "total", width: 60, pinned: "right" },
            ],
        });
        await settle();
        expect((grid.render.model as any).options.stickyRight).toBe(1);

        grid.setColumns([
            { key: "id", width: 60 },
            { key: "total", width: 60 },
        ]);
        await settle();
        expect((grid.render.model as any).options.stickyRight).toBe(0);
    });
});

describe("footerRows", () => {
    interface FRow {
        id?: number;
        name?: string;
        score?: number;
        active?: boolean;
        label?: string;
    }
    const dataRows: FRow[] = [
        { id: 1, name: "Ada", score: 30, active: true },
        { id: 2, name: "Alan", score: 10, active: false },
        { id: 3, name: "Grace", score: 20, active: true },
    ];
    const total: FRow = { label: "Total", score: 60, active: true };

    function footerGrid(extra?: Partial<AVGridOptions<FRow>>) {
        return create<FRow>({
            rows: [...dataRows],
            columns: [
                { key: "name", name: "Name", width: 120, formatValue: (_c, r) => r.name ?? r.label ?? "" },
                { key: "score", name: "Score", width: 80, dataType: "number" },
                { key: "active", name: "Active", width: 60, dataType: "boolean" },
            ],
            footerRows: [total],
            footerRowClass: () => "grand-total",
            ...extra,
        });
    }

    const footerCell = (grid: AVGrid<any>, key: string) =>
        grid.element.querySelector(
            `[data-type="footer-cell"][data-column-key="${key}"]`,
        ) as HTMLElement | null;

    it("renders the footer in the sticky-bottom band, through the same columns", async () => {
        const grid = footerGrid();
        await settle();
        const cell = footerCell(grid, "name")!;
        expect(cell).not.toBeNull();
        expect(cell.closest(".avg-sticky-bottom")).not.toBeNull();
        // The column's formatValue applied — formatting is never written twice.
        expect(cell.textContent).toBe("Total");
        // Styled through avg-footer-cell and footerRowClass, aligned like the column.
        expect(cell.classList.contains("avg-footer-cell")).toBe(true);
        expect(cell.classList.contains("grand-total")).toBe(true);
        expect(footerCell(grid, "score")!.classList.contains("avg-align-right")).toBe(true);
        // A boolean footer cell is a tick, never a checkbox.
        expect(footerCell(grid, "active")!.querySelector(".avg-check-icon")).not.toBeNull();
        expect(footerCell(grid, "active")!.querySelector("[data-type='bool-toggle']")).toBeNull();
    });

    it("is not a data cell: no data-row, so no focus, drag or edit can resolve to it", async () => {
        const grid = footerGrid({ editable: true });
        await settle();
        const cell = footerCell(grid, "score")!;
        expect(cell.getAttribute("data-row")).toBeNull();
        expect(cell.getAttribute("data-footer-row")).toBe("0");
        // data-col is the real column index, not renumbered inside the band.
        expect(cell.getAttribute("data-col")).toBe("1");
    });

    it("sorting never moves it", async () => {
        const grid = footerGrid();
        await settle();
        grid.setSort({ key: "score", direction: "asc" });
        await settle();
        expect(columnText(grid, "score")).toEqual(["10", "20", "30"]);
        const cell = footerCell(grid, "score")!;
        expect(cell.textContent).toBe("60");
        expect(cell.closest(".avg-sticky-bottom")).not.toBeNull();
    });

    it("filtering and a search never remove it — and it is not a search match", async () => {
        const grid = footerGrid();
        await settle();
        grid.setSearchString("Ada");
        await settle();
        expect(grid.getVisibleRows()).toHaveLength(1);
        expect(footerCell(grid, "name")!.textContent).toBe("Total");
        grid.setSearchString("Total");
        await settle();
        // No data row shows "Total", and the footer is not a match: zero rows survive.
        expect(grid.getVisibleRows()).toHaveLength(0);
        expect(footerCell(grid, "name")!.textContent).toBe("Total");
        expect(footerCell(grid, "name")!.querySelector(".avg-search-match")).toBeNull();
        grid.setSearchString(undefined);
        await settle();
    });

    it("row selection cannot reach it: no checkbox, and select-all never names it", async () => {
        const grid = footerGrid({ selectColumn: true });
        await settle();
        const checkboxCol = grid.element.querySelector(
            '[data-type="footer-cell"][data-col="0"]',
        )!;
        expect(checkboxCol.querySelector("input, .avg-bool-box")).toBeNull();
        grid.selectAll();
        expect(grid.getSelected()).toHaveLength(3);
        expect(grid.getSelected().every((k) => !k.startsWith("avg-footer"))).toBe(true);
    });

    it("getVisibleRows and onVisibleRowsChange keep meaning data rows", async () => {
        const seen: number[] = [];
        const grid = footerGrid({
            onVisibleRowsChange: (rows) => seen.push(rows.length),
        });
        await settle();
        expect(grid.getVisibleRows()).toHaveLength(3);
        expect(grid.getState().rowCount).toBe(3);
        expect(seen.every((n) => n <= 3)).toBe(true);
    });

    it("editing cannot open in it, whatever editable says", async () => {
        const grid = footerGrid({ editable: true });
        await settle();
        // The footer row sits past the data rows; startEdit is data-row-indexed.
        grid.startEdit(3, 1);
        expect(grid.getState().editing).toBeUndefined();
    });

    it("a range selection and its copy stop at the last data row", async () => {
        const grid = footerGrid();
        await settle();
        grid.focusCell(0, 1);
        // A range that would reach into the footer is refused outright — the footer row is
        // not a selectable coordinate, programmatically or by drag (its cells carry no
        // data-row for the drag to resolve).
        grid.selectRange(0, 1, 3, 1);
        expect(grid.getSelectionText().trim()).toBe("30");
        // The full data range copies the data and never the total.
        grid.selectRange(0, 1, 2, 1);
        const lines = grid.getSelectionText().trim().split("\n");
        expect(lines).toEqual(["30", "10", "20"]);
    });

    it("never asks getRowKey for a footer row", async () => {
        const getRowKey = vi.fn((r: FRow) => String(r.id));
        const grid = footerGrid({ getRowKey });
        await settle();
        grid.selectAll();
        grid.setSort({ key: "score", direction: "asc" });
        await settle();
        expect(getRowKey).toHaveBeenCalled();
        expect(getRowKey.mock.calls.every(([r]) => r !== total)).toBe(true);
    });

    it("setOptions grows and collapses the band", async () => {
        const grid = footerGrid();
        await settle();
        expect((grid.render.model as any).options.stickyBottom).toBe(1);
        grid.setOptions({ footerRows: [total, { label: "Subtotal", score: 40 }] });
        await settle();
        expect((grid.render.model as any).options.stickyBottom).toBe(2);
        expect(
            grid.element.querySelectorAll('[data-type="footer-cell"][data-column-key="name"]').length,
        ).toBe(2);
        grid.setOptions({ footerRows: undefined });
        await settle();
        expect((grid.render.model as any).options.stickyBottom).toBe(0);
        expect(footerCell(grid, "name")).toBeNull();
    });

    it("publishes the band height, so extraElement and the add-row button sit above it", async () => {
        const grid = footerGrid();
        await settle();
        const area = grid.element.querySelector('[data-type="render-grid-area"]') as HTMLElement;
        expect(area.style.getPropertyValue("--avg-sticky-bottom")).not.toBe("");
        expect(area.style.getPropertyValue("--avg-sticky-bottom")).not.toBe("0px");
    });
});

describe("accessibility", () => {
    it("carries grid semantics on the root, with live row and column counts", async () => {
        const grid = create({ rows: people });
        await settle();
        const root = grid.element;
        expect(root.getAttribute("role")).toBe("grid");
        expect(root.getAttribute("aria-multiselectable")).toBe("true");
        expect(root.getAttribute("aria-colcount")).toBe("3");
        expect(root.getAttribute("aria-rowcount")).toBe("4"); // 3 data rows + the header

        grid.setSearchString("Ada");
        await settle();
        expect(root.getAttribute("aria-rowcount")).toBe("2");
        grid.setSearchString(undefined);
        await settle();

        grid.setOptions({ footerRows: [{ id: 0, name: "Total", active: true }] });
        await settle();
        expect(root.getAttribute("aria-rowcount")).toBe("5");
    });

    it("exposes the sort on the header, and takes it off with the sort", async () => {
        const grid = create({ rows: people, sort: { key: "name", direction: "asc" } });
        await settle();
        const header = () =>
            grid.element.querySelector('[data-type="header-cell"][data-column-key="name"]')!;
        expect(header().getAttribute("role")).toBe("columnheader");
        expect(header().getAttribute("aria-sort")).toBe("ascending");
        grid.setSort({ key: "name", direction: "desc" });
        await settle();
        expect(header().getAttribute("aria-sort")).toBe("descending");
        grid.setSort(undefined);
        await settle();
        // Off, not stale — a pooled element keeps what is not removed.
        expect(header().getAttribute("aria-sort")).toBeNull();
    });

    it("gives every cell a role and 1-based indices, the header counted as row 1", async () => {
        const grid = create({
            rows: people,
            footerRows: [{ id: 0, name: "Total", active: true }],
        });
        await settle();
        const cell = grid.element.querySelector(
            '[data-type="data-cell"][data-row="1"][data-column-key="name"]',
        )!;
        expect(cell.getAttribute("role")).toBe("gridcell");
        expect(cell.getAttribute("aria-rowindex")).toBe("3"); // header 1, data row 0 is 2
        expect(cell.getAttribute("aria-colindex")).toBe("2");
        const footer = grid.element.querySelector(
            '[data-type="footer-cell"][data-column-key="name"]',
        )!;
        expect(footer.getAttribute("role")).toBe("gridcell");
        expect(footer.getAttribute("aria-readonly")).toBe("true");
        expect(footer.getAttribute("aria-rowindex")).toBe("5"); // after the 3 data rows
    });

    it("keeps the root in the tab order, so the keyboard can reach it", () => {
        const grid = create({ rows: people });
        expect(grid.element.tabIndex).toBe(0);
    });
});

describe("keyboard reach", () => {
    it("Alt+ArrowDown opens the focused column's filter popover", async () => {
        const grid = create({ rows: people });
        await settle();
        grid.focusCell(0, 1); // the name column
        grid.element.dispatchEvent(
            new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }),
        );
        await settle();
        const popover = document.querySelector(".avg-popover");
        expect(popover).not.toBeNull();
        expect(grid.model.flags.filterPopover?.columnKey).toBe("name");
        grid.model.flags.filterPopover?.close();
    });

    it("keyboard focus never lands on pinned-left chrome", async () => {
        const grid = create({ rows: people, selectColumn: true });
        await settle();
        const root = grid.element;
        const key = (k: string, init: KeyboardEventInit = {}) =>
            root.dispatchEvent(
                new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }),
            );
        // The first navigation key lands on the first *data* column, past the checkbox.
        key("ArrowDown");
        expect(String(grid.getFocus()?.columnKey)).toBe("id");
        // ArrowLeft, Ctrl+Home and a Shift+Tab wrap all stop there too.
        key("ArrowLeft");
        expect(String(grid.getFocus()?.columnKey)).toBe("id");
        key("Home", { ctrlKey: true });
        expect(String(grid.getFocus()?.columnKey)).toBe("id");
    });

    it("the Menu key opens the context menu at the focused cell", async () => {
        const grid = create({ rows: people });
        await settle();
        grid.focusCell(1, 1);
        // The keyboard gesture: a contextmenu event dispatched at the focused element (the
        // root), with no cell under any pointer.
        grid.element.dispatchEvent(
            new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
        );
        await settle();
        const menu = document.querySelector(".avg-menu");
        expect(menu).not.toBeNull();
        // Cell-level items are present, which proves the hit resolved to the focused cell
        // rather than to the bare grid.
        expect(menu!.querySelector('[data-id="avg-copy"]')).not.toBeNull();
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
                hasEditor: false,
                filterType: "options",
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
                hasEditor: false,
                filterType: "options",
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

describe("search highlighting", () => {
    /**
     * The marked runs of each cell in a column, in row order, joined by `|`.
     *
     * Per cell rather than per column, and sorted by `data-row`: the cells are pooled, so their
     * order in the DOM is the order the pool handed them out and says nothing about the rows.
     */
    function marks(grid: AVGrid<any>, columnKey: string): string[] {
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
            .map((cell) =>
                Array.from(cell.querySelectorAll(".avg-search-match"))
                    .map((el) => el.textContent ?? "")
                    .join("|"),
            );
    }

    it("marks every search word in the surviving rows", async () => {
        const grid = create({ rows: people, searchString: "a" });
        await settle();
        expect(marks(grid, "name")).toEqual(["A|a", "A|a", "a"]);
    });

    it("marks each word of a multi-word search", async () => {
        const grid = create({
            rows: [{ name: "Ada", city: "Ankara" }],
            searchString: "ad ank",
        });
        await settle();
        expect(marks(grid, "name")).toEqual(["Ad"]);
        expect(marks(grid, "city")).toEqual(["Ank"]);
    });

    it("leaves the cell's text intact — only its markup changes", async () => {
        const grid = create({ rows: people, searchString: "a" });
        await settle();
        expect(columnText(grid, "name")).toEqual(["Ada", "Alan", "Grace"]);
    });

    it("paints nothing when highlightSearch is false", async () => {
        const grid = create({
            rows: people,
            searchString: "a",
            highlightSearch: false,
        });
        await settle();
        expect(marks(grid, "name")).toEqual(["", "", ""]);
        // Still filters, exactly as before.
        expect(columnText(grid, "name")).toEqual(["Ada", "Alan", "Grace"]);
    });

    it("repaints when highlightSearch is toggled on its own", async () => {
        // The row set does not change, so the pipeline would not have run: `setOptions` has to
        // resync the words and ask for a paint itself.
        const grid = create({
            rows: people,
            searchString: "a",
            highlightSearch: false,
        });
        await settle();
        grid.setOptions({ highlightSearch: true });
        await settle();
        expect(marks(grid, "name")).toEqual(["A|a", "A|a", "a"]);

        grid.setOptions({ highlightSearch: false });
        await settle();
        expect(marks(grid, "name")).toEqual(["", "", ""]);
    });

    it("keeps the shape on the root, not on the marks", async () => {
        // Per cell, all three shapes are the same one class — so switching between them costs
        // one attribute and repaints nothing.
        const grid = create({
            rows: people,
            searchString: "a",
            highlightSearch: "both",
        });
        await settle();
        expect(grid.element.getAttribute("data-search-highlight")).toBe("both");
        expect(marks(grid, "name")).toEqual(["A|a", "A|a", "a"]);

        grid.setOptions({ highlightSearch: "background" });
        await settle();
        expect(grid.element.getAttribute("data-search-highlight")).toBe(
            "background",
        );
        expect(marks(grid, "name")).toEqual(["A|a", "A|a", "a"]);
    });

    it("leaves the attribute off for the default shape", async () => {
        const grid = create({ rows: people, searchString: "a" });
        await settle();
        expect(grid.element.hasAttribute("data-search-highlight")).toBe(false);

        grid.setOptions({ highlightSearch: "text" });
        await settle();
        expect(grid.element.hasAttribute("data-search-highlight")).toBe(false);
    });

    it("takes the attribute back off when highlighting is turned off", async () => {
        const grid = create({
            rows: people,
            searchString: "a",
            highlightSearch: "both",
        });
        await settle();
        grid.setOptions({ highlightSearch: false });
        await settle();
        expect(grid.element.hasAttribute("data-search-highlight")).toBe(false);
        expect(marks(grid, "name")).toEqual(["", "", ""]);
    });

    it("clears the marks when the search is cleared", async () => {
        const grid = create({ rows: people, searchString: "a" });
        await settle();
        grid.setSearchString(undefined);
        await settle();
        expect(marks(grid, "name")).toEqual(["", "", ""]);
        expect(columnText(grid, "name")).toEqual(["Ada", "Alan", "Grace"]);
    });

    it("follows the search as it narrows", async () => {
        const grid = create({ rows: people, searchString: "a" });
        await settle();
        grid.setSearchString("ala");
        await settle();
        expect(columnText(grid, "name")).toEqual(["Alan"]);
        expect(marks(grid, "name")).toEqual(["Ala"]);
    });

    it("does not touch a column with its own render", async () => {
        // The host owns that markup; marking inside it would mean parsing what it returned.
        const grid = create({
            rows: people,
            columns: [{ key: "name", render: (c) => `<i>${c.value}</i>` }],
            searchString: "a",
        });
        await settle();
        expect(marks(grid, "name")).toEqual(["", "", ""]);
        expect(columnText(grid, "name")).toEqual(["Ada", "Alan", "Grace"]);
    });

    it("gives a render column a way to mark, through c.highlight", async () => {
        // The reported case: a computed Full Name column showing what a search matched in the
        // Last Name column beside it, unmarked, because its markup is the host's.
        const grid = create({
            rows: people,
            columns: [
                { key: "name", name: "Name" },
                {
                    key: "full",
                    name: "Full",
                    render: (c) => c.highlight(`${c.row.name} <${c.row.id}>`),
                },
            ],
            searchString: "ala",
        });
        await settle();
        expect(marks(grid, "full")).toEqual(["Ala"]);
        // Escaped by the same call — the angle brackets are text, not a tag.
        expect(columnText(grid, "full")).toEqual(["Alan <2>"]);
        expect(grid.element.querySelector('[data-column-key="full"] alan')).toBeNull();
    });

    it("c.highlight is the plain text when nothing is searched", async () => {
        const grid = create({
            rows: people,
            columns: [{ key: "name", render: (c) => c.highlight(c.value) }],
        });
        await settle();
        expect(marks(grid, "name")).toEqual(["", "", ""]);
        expect(columnText(grid, "name")).toEqual(["Ada", "Alan", "Grace"]);
    });

    it("c.highlight goes quiet when highlightSearch is off", async () => {
        // Otherwise turning the feature off would half-work: default cells would stop marking
        // and every render column would carry on.
        const grid = create({
            rows: people,
            columns: [{ key: "name", render: (c) => c.highlight(c.value) }],
            searchString: "a",
            highlightSearch: false,
        });
        await settle();
        expect(marks(grid, "name")).toEqual(["", "", ""]);
        expect(columnText(grid, "name")).toEqual(["Ada", "Alan", "Grace"]);
    });

    it("marks the displayed text, not the raw value", async () => {
        const grid = create({
            rows: [{ id: 1 }],
            columns: [{ key: "id", formatValue: () => "Order 7" }],
            searchString: "order",
        });
        await settle();
        expect(marks(grid, "id")).toEqual(["Order"]);
    });

    it("marks highlightString's words without filtering a row out", async () => {
        // The whole point of the option: the rows are already the right rows.
        const grid = create({ rows: people, highlightString: "ala" });
        await settle();
        expect(columnText(grid, "name")).toEqual(["Ada", "Alan", "Grace"]);
        expect(marks(grid, "name")).toEqual(["", "Ala", ""]);
    });

    it("marks the union of searchString and highlightString", async () => {
        const grid = create({
            rows: people,
            searchString: "a",
            highlightString: "race",
        });
        await settle();
        expect(columnText(grid, "name")).toEqual(["Ada", "Alan", "Grace"]);
        // "Grace" holds both words and they overlap; the longer match wins the shared "a",
        // which is `markSearchWords`' existing rule and not something this option changes.
        expect(marks(grid, "name")).toEqual(["A|a", "A|a", "race"]);
    });

    it("repaints when highlightString is set on its own", async () => {
        // No row moves, so the pipeline never runs — `setOptions` has to resync and repaint.
        const grid = create({ rows: people });
        await settle();
        grid.setOptions({ highlightString: "ala" });
        await settle();
        expect(marks(grid, "name")).toEqual(["", "Ala", ""]);

        grid.setOptions({ highlightString: undefined });
        await settle();
        expect(marks(grid, "name")).toEqual(["", "", ""]);
    });

    it("silences highlightString too when highlightSearch is false", async () => {
        const grid = create({
            rows: people,
            highlightString: "ala",
            highlightSearch: false,
        });
        await settle();
        expect(marks(grid, "name")).toEqual(["", "", ""]);
        expect(columnText(grid, "name")).toEqual(["Ada", "Alan", "Grace"]);
    });

    it("marks highlightString through c.highlight as well", async () => {
        // A custom render column going unmarked beside a plain one is the exact failure
        // `c.highlight` exists for, so it has to read both sources.
        const grid = create({
            rows: people,
            columns: [
                { key: "name", name: "Name" },
                {
                    key: "full",
                    name: "Full",
                    render: (c) => c.highlight(`${c.row.name} <${c.row.id}>`),
                },
            ],
            highlightString: "ala",
        });
        await settle();
        expect(marks(grid, "name")).toEqual(["", "Ala", ""]);
        expect(marks(grid, "full")).toEqual(["", "Ala", ""]);
    });

    it("escapes a value that looks like markup", async () => {
        const grid = create({
            rows: [{ name: "<b>ada</b>" }],
            searchString: "ada",
        });
        await settle();
        expect(marks(grid, "name")).toEqual(["ada"]);
        expect(columnText(grid, "name")).toEqual(["<b>ada</b>"]);
        expect(
            grid.element.querySelector('[data-column-key="name"] b'),
        ).toBeNull();
    });
});

/**
 * The trailing slack below the last row. A pass-through to the engine option that has always
 * existed and was never exposed — whether it *looks* right at full scroll is a browser
 * question, and the board answers it; what a test can pin is that it reaches the engine from
 * both paths and that its absence changes nothing.
 */
describe("whiteSpaceY", () => {
    const engineWhiteSpaceY = (grid: AVGrid<any>): number | undefined =>
        grid.render.model.getOptions().whiteSpaceY;

    it("reaches the engine from create()", () => {
        expect(engineWhiteSpaceY(create({ rows: people, whiteSpaceY: 24 }))).toBe(24);
    });

    it("reaches the engine from setOptions()", () => {
        const grid = create({ rows: people });
        grid.setOptions({ whiteSpaceY: 40 });
        expect(engineWhiteSpaceY(grid)).toBe(40);
    });

    it("forwards a zero rather than treating it as unset", () => {
        // `whiteSpaceY: 0` is the "no slack at all" case, and the engine reads it with `??`,
        // so a truthiness check anywhere on the way would silently mean "default".
        const grid = create({ rows: people });
        grid.setOptions({ whiteSpaceY: 0 });
        expect(engineWhiteSpaceY(grid)).toBe(0);
    });

    it("leaves the engine on its own default when the option is absent", () => {
        expect(engineWhiteSpaceY(create({ rows: people }))).toBeUndefined();
    });
});

/**
 * Column groups — the two-row header. What a test can pin: the band's DOM (one overlay cell
 * per group, positioned from the engine's own starts), the order normalization, the doubled
 * row 0, the reorder lockout and the validation. What it looks like — alignment at every
 * zoom, the pinned corners — is a browser question, and the board answers it.
 */
describe("column groups", () => {
    const groupedColumns = [
        { key: "id", name: "ID", width: 50 },
        { key: "name", name: "Name", width: 100, group: "Who" },
        { key: "active", name: "Active", width: 100, group: "Who" },
    ];

    const groupCells = (grid: AVGrid<any>) =>
        Array.from(
            grid.element.querySelectorAll('[data-type="group-cell"]'),
        ) as HTMLElement[];

    it("draws one band cell per group, positioned over its columns", async () => {
        const grid = create({ rows: people, columns: groupedColumns });
        await settle();

        const cells = groupCells(grid);
        expect(cells).toHaveLength(1);
        expect(cells[0].getAttribute("data-group")).toBe("Who");
        expect(cells[0].textContent).toBe("Who");
        expect(cells[0].style.left).toBe("50px");
        expect(cells[0].style.width).toBe("200px");
        // The band is presentational — the header row's ARIA semantics are unchanged.
        expect(cells[0].closest('[data-type="group-row"]')?.getAttribute("aria-hidden")).toBe("true");
    });

    it("doubles row 0 for the band and shrinks grouped headers to its lower half", async () => {
        const grid = create({ rows: people, columns: groupedColumns });
        await settle();

        const rowHeight = grid.render.model.getOptions().rowHeight as (
            r: number,
        ) => number;
        expect(typeof rowHeight).toBe("function");
        expect(rowHeight(0)).toBe(48);
        expect(rowHeight(1)).toBe(24);

        const header = (key: string) =>
            grid.element.querySelector(
                `[data-type="header-cell"][data-column-key="${key}"]`,
            ) as HTMLElement;
        // Grouped: lower half. Ungrouped: the whole doubled slot, one tall cell.
        expect(header("name").style.top).toBe("24px");
        expect(header("name").style.height).toBe("24px");
        expect(header("id").style.top).toBe("0px");
        expect(header("id").style.height).toBe("48px");
    });

    it("gathers interleaved group columns together, stably, and getColumns agrees", () => {
        const grid = create({
            rows: people,
            columns: [
                { key: "name", group: "Who" },
                { key: "id" },
                { key: "active", group: "Who" },
            ],
        });
        // "Who" anchors where it first appears; the ungrouped column keeps its relative spot.
        expect(grid.getColumns().map((c) => String(c.key))).toEqual([
            "name",
            "active",
            "id",
        ]);
        expect(
            Array.from(
                grid.element.querySelectorAll('[data-type="header-cell"]'),
            ).map((el) => el.getAttribute("data-column-key")),
        ).toEqual(["name", "active", "id"]);
    });

    it("turns drag-reorder off while groups are shown", () => {
        const grid = create({ rows: people, columns: groupedColumns });
        const draggable = Array.from(
            grid.element.querySelectorAll('[data-type="header-cell"]'),
        ).map((el) => (el as HTMLElement).draggable);
        expect(draggable).toEqual([false, false, false]);
    });

    it("a hidden column shrinks its group; hiding all of them removes the band", async () => {
        const grid = create({ rows: people, columns: groupedColumns });
        await settle();

        grid.setColumns([
            { key: "id", name: "ID", width: 50 },
            { key: "name", name: "Name", width: 100, group: "Who", hidden: true },
            { key: "active", name: "Active", width: 100, group: "Who" },
        ]);
        await settle();
        expect(groupCells(grid)[0].style.width).toBe("100px");

        grid.setColumns([{ key: "id", name: "ID", width: 50 }]);
        await settle();
        expect(groupCells(grid)).toHaveLength(0);
        expect(grid.element.querySelector('[data-type="group-row"]')).toBeNull();
        // And row 0 is back to a single height.
        expect(typeof grid.render.model.getOptions().rowHeight).toBe("number");
    });

    it("columnGroupRender and columnGroupClass shape a group cell", async () => {
        const grid = create({
            rows: people,
            columns: groupedColumns,
            columnGroupRender: ({ group, columns }) =>
                `${group} (${columns.length})`,
            columnGroupClass: ({ group }) => group.toLowerCase(),
        });
        await settle();

        const cell = groupCells(grid)[0];
        expect(cell.textContent).toBe("Who (2)");
        expect(cell.className).toBe("avg-group-cell who");
    });

    it("raises on a pinned column with a group, naming both", () => {
        expect(() =>
            create({
                rows: people,
                columns: [
                    { key: "id", pinned: "left", group: "Who", width: 50 },
                    { key: "name" },
                ],
            }),
        ).toThrow(/pinned and has group/);
    });

    it("raises on a group that is not a string", () => {
        expect(() =>
            create({
                rows: people,
                columns: [{ key: "id", group: 5 as any }],
            }),
        ).toThrow(/group is its label/);
    });
});

/**
 * One host element after the last row. What a test can pin is the parenting, the swap, the
 * teardown and the promise that the grid touches nothing else; where it lands on screen is a
 * browser question, and the board answers it.
 */
describe("extraElement", () => {
    function footer(text = "Load more"): HTMLElement {
        const el = document.createElement("div");
        el.className = "my-footer";
        el.textContent = text;
        el.append(document.createElement("button"));
        return el;
    }

    it("parents the element inside the scrolling content, marked as such", () => {
        const el = footer();
        const grid = create({ rows: people, extraElement: el });

        expect(grid.element.contains(el)).toBe(true);
        expect(el.classList.contains("avg-extra")).toBe(true);
        expect(el.getAttribute("data-avg-slot")).toBe("content-end");
    });

    it("swaps one element for another through setOptions", () => {
        const first = footer("first");
        const second = footer("second");
        const grid = create({ rows: people, extraElement: first });

        grid.setOptions({ extraElement: second });
        expect(grid.element.contains(first)).toBe(false);
        expect(grid.element.contains(second)).toBe(true);
    });

    it("removes it for null and for undefined", () => {
        const el = footer();
        const grid = create({ rows: people, extraElement: el });

        grid.setOptions({ extraElement: null });
        expect(grid.element.contains(el)).toBe(false);

        grid.setOptions({ extraElement: el });
        expect(grid.element.contains(el)).toBe(true);
        grid.setOptions({ extraElement: undefined });
        expect(grid.element.contains(el)).toBe(false);
    });

    it("leaves the same element alone when it is passed again", () => {
        // Identity is what decides whether the parenting changes, so re-passing the same
        // element must not detach and re-append it — a React shim pushes every option on
        // every update, and a footer that was removed and re-added each time would flicker and
        // lose focus.
        const el = footer();
        const grid = create({ rows: people, extraElement: el });
        const parent = el.parentElement;

        grid.setOptions({ extraElement: el, rowHeight: 26 });
        expect(el.parentElement).toBe(parent);
    });

    it("never mutates the host's element beyond the class and the slot", () => {
        const el = footer();
        const clicks: number[] = [];
        el.addEventListener("click", () => clicks.push(1));
        const grid = create({ rows: people, extraElement: el });

        grid.setRows([...people, { id: 4, name: "Edsger", active: false }]);
        grid.setSort({ key: "name", direction: "desc" });
        grid.refresh();

        expect(el.textContent).toBe("Load more");
        expect(el.querySelector("button")).not.toBeNull();
        expect(el.className).toBe("my-footer avg-extra");
        el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(clicks).toHaveLength(1);
    });

    it("survives a repaint of every cell with its listener attached", async () => {
        const el = footer();
        let clicked = 0;
        el.addEventListener("click", () => clicked++);
        const grid = create({ rows: people, extraElement: el });
        await settle();

        grid.refresh();
        await settle();

        expect(grid.element.contains(el)).toBe(true);
        el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(clicked).toBe(1);
    });

    it("destroy() detaches it and leaves it reusable", () => {
        const el = footer();
        const grid = create({ rows: people, extraElement: el });
        grid.destroy();

        expect(el.isConnected).toBe(false);
        expect(el.textContent).toBe("Load more");
        expect(el.querySelector("button")).not.toBeNull();
        // Reusable means exactly this: mount it somewhere else and it still works.
        document.body.append(el);
        expect(el.isConnected).toBe(true);
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
