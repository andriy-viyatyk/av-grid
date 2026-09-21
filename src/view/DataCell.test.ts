// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { AVGrid } from "../AVGrid";
import { CellPool } from "../render/CellPool";
import { renderDataCell, renderFooterCell } from "./DataCell";
import { renderHeaderCell } from "./HeaderCell";
import type { RenderCellParams } from "../render/types";
import { AVGRID_STYLE_ID } from "../styles/av-grid.css";
import type { AVGridOptions } from "../options";

/**
 * happy-dom does no layout, so every element measures 0×0 and the grid would decide it has no
 * viewport to fill. Patching `createElement` for the duration of construction gives the shell a
 * real size — the same trick `AVGrid.test.ts` and `RenderGrid.test.ts` use.
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

const grids: AVGrid<any>[] = [];

function create<R>(options: AVGridOptions<R>): AVGrid<R> {
    const host = document.createElement("div");
    document.body.append(host);
    const grid = withLayout(() => AVGrid.create<R>(host, options));
    grids.push(grid);
    return grid;
}

/** Let the microtask-coalesced update and the rAF paint both run. */
async function settle(): Promise<void> {
    await Promise.resolve();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await Promise.resolve();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
}

function cellAt(grid: AVGrid<any>, row: number, columnKey: string): HTMLElement {
    const el = grid.element.querySelector<HTMLElement>(
        `[data-type="data-cell"][data-row="${row}"][data-column-key="${columnKey}"]`,
    );
    if (!el) throw new Error(`no cell at row ${row}, column ${columnKey}`);
    return el;
}

/**
 * Mark the element a cell's markup produced, so a later assertion can tell whether the markup was
 * re-assigned: `innerHTML =` replaces the subtree, so the marked node would be gone.
 */
function markContent(cell: HTMLElement): void {
    const child = cell.firstElementChild;
    if (!child) throw new Error("cell has no rendered content to mark");
    child.setAttribute("data-test-marked", "yes");
}

function isMarked(cell: HTMLElement): boolean {
    return cell.firstElementChild?.getAttribute("data-test-marked") === "yes";
}

afterEach(() => {
    while (grids.length) grids.pop()?.destroy();
    document.body.textContent = "";
    document.getElementById(AVGRID_STYLE_ID)?.remove();
});

/**
 * A `render` column's markup is compared against what was last *assigned*, not against
 * `innerHTML`.
 *
 * The distinction is invisible until the markup is written in a form the HTML serializer does not
 * reproduce — a self-closed tag, an SVG attribute the parser re-cases — at which point reading
 * `innerHTML` back can never compare equal and the cell re-parses on every repaint that touches
 * it. Cheap, but permanent, and undiscoverable from the hook that caused it.
 */
describe("renderDataCell — a render column's markup is written at most once per change", () => {
    const rows = [
        { id: 1, name: "Ada", score: 10 },
        { id: 2, name: "Alan", score: 20 },
    ];

    it("does not rewrite unchanged markup on a repaint", async () => {
        const grid = create({
            rows,
            columns: [
                { key: "name" },
                { key: "score", render: (c) => `<b>${c.value}</b>` },
            ],
        });

        const cell = cellAt(grid, 0, "score");
        expect(cell.innerHTML).toBe("<b>10</b>");
        markContent(cell);

        grid.refresh();
        await settle();

        expect(isMarked(cellAt(grid, 0, "score"))).toBe(true);
    });

    it("skips markup the serializer would not round-trip", async () => {
        // The case the `innerHTML` comparison could not skip: a self-closed tag comes back from
        // the serializer as `></path>`, so the strings never matched and every repaint re-parsed.
        const grid = create({
            rows,
            columns: [
                { key: "name" },
                {
                    key: "score",
                    render: (c) =>
                        `<svg width="20" height="10" viewBox="0 0 20 10">` +
                        `<path d="M 0 0 L ${c.value} 10" stroke="#f00" /></svg>`,
                },
            ],
        });

        const cell = cellAt(grid, 0, "score");
        markContent(cell);

        grid.refresh();
        await settle();

        expect(isMarked(cellAt(grid, 0, "score"))).toBe(true);
    });

    it("rewrites when the markup changes", async () => {
        const grid = create({
            rows: rows.map((r) => ({ ...r })),
            columns: [
                { key: "name" },
                { key: "score", render: (c) => `<b>${c.value}</b>` },
            ],
        });

        const cell = cellAt(grid, 0, "score");
        markContent(cell);

        grid.setRows([{ id: 1, name: "Ada", score: 99 }, rows[1]]);
        await settle();

        const next = cellAt(grid, 0, "score");
        expect(next.innerHTML).toBe("<b>99</b>");
        expect(isMarked(next)).toBe(false);
    });

    it("rewrites after the content shape changed under the element", async () => {
        // A cell that goes markup → plain text → markup again must not be told its markup is
        // already there: `setMode` cleared the element in between.
        let withMarkup = true;
        const grid = create({
            rows,
            columns: [
                { key: "name" },
                {
                    key: "score",
                    render: (c) => (withMarkup ? `<b>${c.value}</b>` : String(c.value)),
                },
            ],
        });

        expect(cellAt(grid, 0, "score").innerHTML).toBe("<b>10</b>");

        withMarkup = false;
        grid.refresh();
        await settle();
        expect(cellAt(grid, 0, "score").innerHTML).toBe("10");

        withMarkup = true;
        grid.refresh();
        await settle();
        expect(cellAt(grid, 0, "score").innerHTML).toBe("<b>10</b>");
    });

    it("keeps the same guarantee for the search-highlight path", async () => {
        const grid = create({ rows, searchString: "Ada" });
        await settle();

        const cell = cellAt(grid, 0, "name");
        expect(cell.querySelector(".avg-search-match")).not.toBeNull();
        markContent(cell);

        grid.refresh();
        await settle();

        expect(isMarked(cellAt(grid, 0, "name"))).toBe(true);
    });
});

/**
 * A text cell's content lives in one `.avg-cell-text` span, and that span survives repaints.
 *
 * The wrapper is not cosmetic: `text-overflow` applies to block containers, and a data cell is
 * `inline-flex`, so a bare text node in it became an anonymous flex item that inherited neither
 * `overflow` nor `text-overflow` — the cell's own `text-overflow: ellipsis` had no effect at all,
 * and a clipped value was cut mid-glyph. The wrapper is the box the declaration can reach.
 *
 * The reuse assertions are the hot-path contract. `setText` writes through the existing text node
 * precisely so a repaint allocates nothing; wrapping the text would undo that if the span were
 * rebuilt per paint, so these tests pin the span's identity across a `refresh()` and check it is
 * rebuilt only when the content shape actually changed under a pooled element.
 */
describe("renderDataCell — the text wrapper", () => {
    const rows = [
        { id: 1, name: "Ada", score: 10, when: new Date(Date.UTC(2020, 0, 2)) },
        { id: 2, name: "Alan", score: 20, when: new Date(Date.UTC(2021, 5, 6)) },
    ];

    it("wraps a plain text cell's content and puts the text inside", () => {
        const grid = create({ rows, columns: [{ key: "name" }, { key: "score" }] });

        const cell = cellAt(grid, 0, "name");
        const inner = cell.firstElementChild as HTMLElement;
        expect(inner?.className).toBe("avg-cell-text");
        expect(cell.children.length).toBe(1);
        expect(inner.textContent).toBe("Ada");
        // The text is still the text: a selection, a copy and `textContent` all read the row.
        expect(cell.textContent).toBe("Ada");
    });

    it("keeps the same wrapper element across a repaint", async () => {
        const grid = create({ rows, columns: [{ key: "name" }, { key: "score" }] });

        const inner = cellAt(grid, 0, "name").firstElementChild!;
        inner.setAttribute("data-test-marked", "yes");

        grid.refresh();
        await settle();

        expect(cellAt(grid, 0, "name").firstElementChild).toBe(inner);
    });

    it("keeps the wrapper when only the text changes", async () => {
        const grid = create({
            rows: rows.map((r) => ({ ...r })),
            columns: [{ key: "name" }, { key: "score" }],
        });

        const inner = cellAt(grid, 0, "name").firstElementChild!;
        grid.setRows([{ ...rows[0]!, name: "Grace" }, rows[1]!]);
        await settle();

        const next = cellAt(grid, 0, "name");
        expect(next.firstElementChild).toBe(inner);
        expect(next.textContent).toBe("Grace");
    });

    it("rebuilds the wrapper after the content shape changed under the element", async () => {
        // text → markup → text. `setMode` clears the element in between, so the wrapper is gone
        // and the cell must not be told its text is already there.
        let withMarkup = false;
        const grid = create({
            rows,
            columns: [
                { key: "name" },
                {
                    key: "score",
                    render: (c) => (withMarkup ? `<b>${c.value}</b>` : String(c.value)),
                },
            ],
        });

        withMarkup = true;
        grid.refresh();
        await settle();
        expect(cellAt(grid, 0, "score").innerHTML).toBe("<b>10</b>");

        withMarkup = false;
        grid.refresh();
        await settle();
        expect(cellAt(grid, 0, "score").innerHTML).toBe("10");
    });

    it("uses the same wrapper class for a matched cell as for an unmatched one", async () => {
        // A search keeps the *row*, usually on the strength of one column — so the kept row has a
        // marked cell and an unmarked one side by side, which is exactly the comparison that
        // matters: they must be the same kind of box or a highlight would shift the text.
        const grid = create({
            rows,
            columns: [{ key: "name" }, { key: "score" }],
            searchString: "Ad",
        });
        await settle();

        const matched = cellAt(grid, 0, "name").firstElementChild as HTMLElement;
        expect(matched.className).toBe("avg-cell-text");
        expect(matched.querySelector(".avg-search-match")).not.toBeNull();

        const unmatched = cellAt(grid, 0, "score").firstElementChild as HTMLElement;
        expect(unmatched.className).toBe("avg-cell-text");
        expect(unmatched.querySelector(".avg-search-match")).toBeNull();
    });

    it("gives a render hook that returns nothing an empty wrapper, not a bare cell", () => {
        const grid = create({
            rows,
            columns: [{ key: "name" }, { key: "score", render: () => null }],
        });

        const cell = cellAt(grid, 0, "score");
        expect(cell.firstElementChild?.className).toBe("avg-cell-text");
        expect(cell.textContent).toBe("");
    });

    it("leaves a boolean cell and an element-returning render hook unwrapped", () => {
        const grid = create({
            rows: [
                { id: 1, flag: true, tag: "a" },
                { id: 2, flag: false, tag: "b" },
            ],
            columns: [
                { key: "flag", dataType: "boolean" },
                {
                    key: "tag",
                    render: () => {
                        const el = document.createElement("i");
                        el.textContent = "x";
                        return el;
                    },
                },
            ],
        });

        expect(cellAt(grid, 0, "flag").querySelector(".avg-cell-text")).toBeNull();
        expect(cellAt(grid, 0, "tag").querySelector(".avg-cell-text")).toBeNull();
        expect(cellAt(grid, 0, "tag").firstElementChild?.tagName).toBe("I");
    });

    it("takes an SVG element from a render hook, in the SVG namespace", () => {
        // The element arm is `Element`: an `<svg>` from `createElementNS` is an `SVGElement`, a
        // sibling of `HTMLElement`, and an icon column is the reason the arm exists. The cell holds
        // that very node — asserting the namespace too, because the same tag name parsed out of a
        // *string* would land in the HTML namespace and look identical to `tagName`.
        const icons = new Map<number, SVGSVGElement>();
        const grid = create({
            rows: [
                { id: 1, tag: "a" },
                { id: 2, tag: "b" },
            ],
            columns: [
                { key: "tag" },
                {
                    key: "icon",
                    formatValue: () => "",
                    render: (c) => {
                        const existing = icons.get(c.row.id);
                        if (existing) return existing;
                        const svg = document.createElementNS(
                            "http://www.w3.org/2000/svg",
                            "svg",
                        );
                        svg.setAttribute("viewBox", "0 0 16 16");
                        icons.set(c.row.id, svg);
                        return svg;
                    },
                },
            ],
        });

        const child = cellAt(grid, 0, "icon").firstElementChild;
        expect(child).toBe(icons.get(1));
        expect(child?.namespaceURI).toBe("http://www.w3.org/2000/svg");
    });

    it("re-appends a stable render element on repaint rather than dropping it", async () => {
        // The element branch has no `written` guard — it clears the cell and appends on every
        // paint. A renderer handing back the *same* node therefore keeps it, which is what makes
        // an icon column that caches per row correct. Pinned because a future `written`-style
        // optimisation must not start skipping a node whose identity did not change.
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        const grid = create({
            rows: [{ id: 1, tag: "a" }],
            columns: [
                { key: "tag" },
                { key: "icon", formatValue: () => "", render: () => svg },
            ],
        });

        expect(cellAt(grid, 0, "icon").firstElementChild).toBe(svg);

        grid.refresh();
        await settle();

        expect(cellAt(grid, 0, "icon").firstElementChild).toBe(svg);
        expect(cellAt(grid, 0, "icon").childElementCount).toBe(1);
    });

    /**
     * Task 61 — a recycled cell keeps the header's `title`, `aria-sort` and `draggable`. The
     * three renderers share one unkeyed pool, and `release()` hands an element on as it was
     * left, so these go **through the pool**: a header rendered, released, then taken by a
     * data or footer cell. Calling `renderDataCell` on a hand-built element would assert
     * nothing about the bug.
     */
    describe("a cell recycled from the header carries none of the header's state (task 61)", () => {
        const params = (
            pool: CellPool,
            row: number,
            col: number,
            previous?: HTMLElement,
        ): RenderCellParams =>
            ({
                row,
                col,
                style: {},
                key: `${row}:${col}`,
                renderInfo: {},
                recycle: pool.acquire,
                setReuseKey: pool.setReuseKey,
                previous,
            }) as unknown as RenderCellParams;

        const make = () =>
            create({
                rows: [{ id: 1, total: 5 }, { id: 2, total: 7 }],
                columns: [
                    { key: "id", name: "ID" },
                    { key: "total", name: "Total" },
                ],
                footerRows: [{ id: 0, total: 12 }],
                sort: { key: "total", direction: "asc" },
            });

        /** Render the `Total` header (sorted, reorderable) into a fresh element and pool it. */
        const releasedHeader = (grid: AVGrid<any>, pool: CellPool): HTMLElement => {
            const header = renderHeaderCell(grid.model, params(pool, 0, 1)) as HTMLElement;
            expect(header.getAttribute("data-type")).toBe("header-cell");
            expect(header.title).toBe("Total");
            expect(header.getAttribute("aria-sort")).toBe("ascending");
            expect(header.draggable).toBe(true);
            expect(pool.release(header)).toBe(true);
            return header;
        };

        it("a data cell taken from the pool has no title, no aria-sort and is not draggable", () => {
            const grid = make();
            const pool = new CellPool();
            const header = releasedHeader(grid, pool);

            const cell = renderDataCell(grid.model, params(pool, 1, 0)) as HTMLElement;
            expect(cell).toBe(header); // through the pool, not a fresh element
            expect(cell.getAttribute("data-type")).toBe("data-cell");
            expect(cell.getAttribute("role")).toBe("gridcell");
            expect(cell.hasAttribute("title")).toBe(false);
            expect(cell.hasAttribute("aria-sort")).toBe(false);
            expect(cell.draggable).toBe(false);
        });

        it("a footer cell taken from the pool is clean the same way", () => {
            const grid = make();
            const pool = new CellPool();
            const header = releasedHeader(grid, pool);

            // Footer rows sit after the data rows in the engine's row space; row 0 is the header.
            const footerRow = 1 + grid.model.data.rows.length;
            const cell = renderFooterCell(grid.model, params(pool, footerRow, 0)) as HTMLElement;
            expect(cell).toBe(header);
            expect(cell.getAttribute("data-type")).toBe("footer-cell");
            expect(cell.hasAttribute("title")).toBe(false);
            expect(cell.hasAttribute("aria-sort")).toBe(false);
            expect(cell.hasAttribute("data-row")).toBe(false);
            expect(cell.draggable).toBe(false);
        });

        it("the reverse direction: a data cell recycled into the header gets the header's own state", () => {
            const grid = make();
            const pool = new CellPool();
            const data = renderDataCell(grid.model, params(pool, 1, 0)) as HTMLElement;
            expect(pool.release(data)).toBe(true);

            const header = renderHeaderCell(grid.model, params(pool, 0, 1)) as HTMLElement;
            expect(header).toBe(data);
            expect(header.title).toBe("Total");
            expect(header.getAttribute("aria-sort")).toBe("ascending");
            expect(header.draggable).toBe(true);
        });

        it("a header whose headerRender returns markup has no title, and a plain header keeps its own", () => {
            const grid = create({
                rows: [{ id: 1, m: 1 }],
                columns: [
                    { key: "id", name: "Plain" },
                    { key: "m", name: "Markup", headerRender: () => "<b>M</b>" } as any,
                ],
            });
            const pool = new CellPool();
            const plain = renderHeaderCell(grid.model, params(pool, 0, 0)) as HTMLElement;
            expect(plain.title).toBe("Plain");
            // Not recycled — re-rendered in place — and still carrying its title: the guard
            // against fixing task 61 by clearing too widely.
            const again = renderHeaderCell(grid.model, params(pool, 0, 0, plain)) as HTMLElement;
            expect(again).toBe(plain);
            expect(again.title).toBe("Plain");

            const markup = renderHeaderCell(grid.model, params(pool, 0, 1)) as HTMLElement;
            expect(markup.hasAttribute("title")).toBe(false);
        });
    });

    /**
     * Task 62 — the element-keyed caches (`mode`, `written`, `treeState`) survive a foreign
     * occupant. Driven through the pool like task 61's: a data cell painted, released, taken by a
     * header, released, taken by a data cell again whose markup renders to the *same* string —
     * the case where the `written` check would skip the write and leave the header's children.
     */
    describe("a cell recycled from the header holds its own contents (task 62)", () => {
        const params = (
            pool: CellPool,
            row: number,
            col: number,
            previous?: HTMLElement,
        ): RenderCellParams =>
            ({
                row,
                col,
                style: {},
                key: `${row}:${col}`,
                renderInfo: {},
                recycle: pool.acquire,
                setReuseKey: pool.setReuseKey,
                previous,
            }) as unknown as RenderCellParams;
        const kids = (el: HTMLElement) =>
            Array.from(el.children).map((c) => c.className.split(" ")[0]);
        const HEADER_KIDS = ["avg-sort-icon", "avg-header-title", "avg-flex-space", "avg-filter-button"];

        const make = (render: (c: any) => any) =>
            create({
                rows: [{ id: 1, v: "same" }, { id: 2, v: "same" }],
                columns: [
                    { key: "id", name: "ID" },
                    { key: "v", name: "Value", render },
                ],
                footerRows: [{ id: 0, v: "same" }],
            });

        /** Paint the header of column 0 into the released `el` and release it again. */
        const throughHeader = (grid: AVGrid<any>, pool: CellPool, el: HTMLElement) => {
            expect(pool.release(el)).toBe(true);
            const header = renderHeaderCell(grid.model, params(pool, 0, 0)) as HTMLElement;
            expect(header).toBe(el);
            expect(kids(header)).toEqual(HEADER_KIDS);
            expect(pool.release(header)).toBe(true);
        };

        it("data → header → data with byte-identical markup ends holding the markup, not the header", () => {
            const grid = make(() => '<b class="val">V</b>');
            const pool = new CellPool();
            const first = renderDataCell(grid.model, params(pool, 1, 1)) as HTMLElement;
            expect(kids(first)).toEqual(["val"]);
            throughHeader(grid, pool, first);

            const second = renderDataCell(grid.model, params(pool, 2, 1)) as HTMLElement;
            expect(second).toBe(first);
            expect(kids(second)).toEqual(["val"]);
            expect(second.textContent).toBe("V");
        });

        it("footer → header → footer, the same way", () => {
            const grid = make(() => '<b class="val">V</b>');
            const pool = new CellPool();
            const footerRow = 1 + grid.model.data.rows.length;
            const first = renderFooterCell(grid.model, params(pool, footerRow, 1)) as HTMLElement;
            expect(kids(first)).toEqual(["val"]);
            throughHeader(grid, pool, first);

            const second = renderFooterCell(grid.model, params(pool, footerRow, 1)) as HTMLElement;
            expect(second).toBe(first);
            expect(kids(second)).toEqual(["val"]);
        });

        it("the null and node arms of `render` stay clean across the header too", () => {
            const nullGrid = make(() => null);
            const pool = new CellPool();
            const a = renderDataCell(nullGrid.model, params(pool, 1, 1)) as HTMLElement;
            throughHeader(nullGrid, pool, a);
            const b = renderDataCell(nullGrid.model, params(pool, 2, 1)) as HTMLElement;
            expect(b).toBe(a);
            expect(kids(b)).toEqual(["avg-cell-text"]);
            expect(b.textContent).toBe("");

            const node = document.createElement("i");
            node.className = "own";
            const nodeGrid = make(() => node);
            const pool2 = new CellPool();
            const c = renderDataCell(nodeGrid.model, params(pool2, 1, 1)) as HTMLElement;
            throughHeader(nodeGrid, pool2, c);
            const d = renderDataCell(nodeGrid.model, params(pool2, 2, 1)) as HTMLElement;
            expect(d).toBe(c);
            expect(kids(d)).toEqual(["own"]);
        });

        it("a plain text cell and a searched cell recycled from the header show their own text", () => {
            const grid = create({
                rows: [{ id: 1, v: "alpha" }, { id: 2, v: "alpha" }],
                columns: [{ key: "id", name: "ID" }, { key: "v", name: "Value" }],
            });
            const pool = new CellPool();
            const a = renderDataCell(grid.model, params(pool, 1, 1)) as HTMLElement;
            throughHeader(grid, pool, a);
            const b = renderDataCell(grid.model, params(pool, 2, 1)) as HTMLElement;
            expect(b).toBe(a);
            expect(kids(b)).toEqual(["avg-cell-text"]);
            expect(b.textContent).toBe("alpha");

            grid.setSearchString("alp");
            const c = renderDataCell(grid.model, params(pool, 1, 1, b)) as HTMLElement;
            expect(c.querySelector(".avg-search-match")?.textContent).toBe("alp");
            throughHeader(grid, pool, c);
            const d = renderDataCell(grid.model, params(pool, 2, 1)) as HTMLElement;
            expect(d).toBe(c);
            expect(d.querySelector(".avg-search-match")?.textContent).toBe("alp");
            expect(d.querySelector(".avg-header-title")).toBeNull();
        });

        describe("the tree column", () => {
            type Node = { id: string; label: string; depth: number; kids: number };
            const treeGrid = () =>
                create<Node>({
                    rows: [
                        { id: "m1", label: "Market 1", depth: 0, kids: 1 },
                        { id: "p1", label: "Payer A", depth: 1, kids: 0 },
                    ],
                    columns: [{ key: "id" }, { key: "label" }],
                    treeColumn: {
                        key: "label",
                        depth: (r) => r.depth,
                        hasChildren: (r) => r.kids > 0,
                        expanded: () => true,
                    },
                });

            it("recycled through the header, rebuilds its gutter and content host", () => {
                const grid = treeGrid();
                const pool = new CellPool();
                const a = renderDataCell(grid.model, params(pool, 1, 1)) as HTMLElement;
                expect(kids(a)).toEqual(["avg-tree-chevron", "avg-tree-content"]);
                expect(a.getAttribute("aria-expanded")).toBe("true");
                throughHeader(grid, pool, a);

                const b = renderDataCell(grid.model, params(pool, 2, 1)) as HTMLElement;
                expect(b).toBe(a);
                expect(kids(b)).toEqual(["avg-tree-indent", "avg-tree-stub", "avg-tree-content"]);
                expect(b.querySelector(".avg-tree-content .avg-cell-text")?.textContent).toBe("Payer A");
                expect(b.hasAttribute("aria-expanded")).toBe(false);
            });

            it("repainted in place, keeps its content host and its text span", () => {
                // Before task 62 the content host was emptied and its span recreated on every
                // paint — `setMode` compared a `data-type` the host never carries.
                const grid = treeGrid();
                const pool = new CellPool();
                const cell = renderDataCell(grid.model, params(pool, 1, 1)) as HTMLElement;
                const host = cell.querySelector(".avg-tree-content")!;
                const span = host.firstElementChild!;
                expect(span.className).toBe("avg-cell-text");

                const again = renderDataCell(grid.model, params(pool, 1, 1, cell)) as HTMLElement;
                expect(again).toBe(cell);
                expect(cell.querySelector(".avg-tree-content")).toBe(host);
                expect(host.firstElementChild).toBe(span);
                expect(span.textContent).toBe("Market 1");
            });

            it("a busy cell recycled through the header keeps nothing of the spinner (task 64)", () => {
                const grid = create<Node>({
                    rows: [
                        { id: "m1", label: "Market 1", depth: 0, kids: 1 },
                        { id: "p1", label: "Payer A", depth: 1, kids: 0 },
                    ],
                    columns: [{ key: "id" }, { key: "label" }],
                    treeColumn: {
                        key: "label",
                        depth: (r) => r.depth,
                        hasChildren: (r) => r.kids > 0,
                        expanded: () => false,
                        busy: (r) => r.id === "m1",
                    },
                });
                const pool = new CellPool();
                const a = renderDataCell(grid.model, params(pool, 1, 1)) as HTMLElement;
                expect(kids(a)).toEqual(["avg-tree-busy", "avg-tree-content"]);
                expect(a.getAttribute("aria-busy")).toBe("true");
                expect(a.getAttribute("aria-expanded")).toBe("false");

                // The header's own claim point: `aria-busy` and `aria-expanded` are state a data
                // cell leaves *about* an element rather than in it, so `textContent = ""` cannot
                // clear them and a header would announce itself as loading.
                expect(pool.release(a)).toBe(true);
                const header = renderHeaderCell(grid.model, params(pool, 0, 0)) as HTMLElement;
                expect(header).toBe(a);
                expect(header.hasAttribute("aria-busy")).toBe(false);
                expect(header.hasAttribute("aria-expanded")).toBe(false);
                expect(pool.release(header)).toBe(true);

                const b = renderDataCell(grid.model, params(pool, 2, 1)) as HTMLElement;
                expect(b).toBe(a);
                expect(kids(b)).toEqual(["avg-tree-indent", "avg-tree-stub", "avg-tree-content"]);
                expect(b.hasAttribute("aria-busy")).toBe(false);
                expect(b.querySelector("svg")).toBeNull();
            });

            it("a tree cell's element taken by a footer cell drops the gutter and aria-expanded", () => {
                const grid = create<Node>({
                    rows: [{ id: "m1", label: "Market 1", depth: 0, kids: 1 }],
                    columns: [{ key: "id" }, { key: "label" }],
                    footerRows: [{ id: "f", label: "Total", depth: 0, kids: 0 }],
                    treeColumn: {
                        key: "label",
                        depth: (r) => r.depth,
                        hasChildren: (r) => r.kids > 0,
                        expanded: () => true,
                    },
                });
                const pool = new CellPool();
                const a = renderDataCell(grid.model, params(pool, 1, 1)) as HTMLElement;
                expect(a.getAttribute("aria-expanded")).toBe("true");
                expect(pool.release(a)).toBe(true);
                const f = renderFooterCell(grid.model, params(pool, 2, 1)) as HTMLElement;
                expect(f).toBe(a);
                expect(kids(f)).toEqual(["avg-cell-text"]);
                expect(f.textContent).toBe("Total");
                expect(f.hasAttribute("aria-expanded")).toBe(false);
            });
        });
    });
});
