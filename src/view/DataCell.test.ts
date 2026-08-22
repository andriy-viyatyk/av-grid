// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { AVGrid } from "../AVGrid";
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
});
