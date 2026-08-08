// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { AVGrid } from "../AVGrid";
import type { AVGridOptions } from "../options";
import type { RerenderInfo } from "../render/types";
import { SELECT_COLUMN_KEY } from "../view/SelectColumn";

/**
 * Row selection and the checkbox column.
 *
 * The same shape as `FocusModel.test.ts`, and for the same reason: happy-dom does no layout,
 * so what is checkable here is behaviour and bookkeeping — which keys are selected, which
 * classes reach which element, and precisely which rows a selection change marks dirty. That
 * last group is the one the task's performance requirement rests on, because "select-all on
 * 100k rows does not stall" is a statement about the *size of the dirty set*, not about a
 * wall clock. The wall clock is measured on the board.
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

interface Row {
    id: number;
    name: string;
    score: number;
}

function rows(count: number): Row[] {
    return Array.from({ length: count }, (_, i) => ({
        id: i + 1,
        name: `Row ${i + 1}`,
        score: (i * 7) % 100,
    }));
}

const grids: AVGrid<any>[] = [];

function grid(count = 20, extra: Partial<AVGridOptions<Row>> = {}): AVGrid<Row> {
    const host = document.createElement("div");
    document.body.append(host);
    const g = withLayout(() =>
        AVGrid.create<Row>(host, {
            rows: rows(count),
            columns: [
                { key: "id", name: "ID", width: 60 },
                { key: "name", name: "Name", width: 120 },
                { key: "score", name: "Score", width: 80 },
            ],
            getRowKey: (r) => String(r.id),
            selectColumn: true,
            ...extra,
        }),
    );
    grids.push(g);
    return g;
}

function cellAt(g: AVGrid<Row>, row: number, col: number): HTMLElement | null {
    return g.element.querySelector(
        `[data-type="data-cell"][data-row="${row}"][data-col="${col}"]`,
    );
}

function classesAt(g: AVGrid<Row>, row: number, col: number): string[] {
    const el = cellAt(g, row, col);
    return el ? Array.from(el.classList) : [];
}

function headerCell(g: AVGrid<Row>, col: number): HTMLElement | null {
    return g.element.querySelector(
        `[data-type="header-cell"][data-col="${col}"]`,
    );
}

function click(el: Element | null): void {
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
}

function pointerDown(el: Element | null): void {
    el?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
}

/** Collect every dirty set the grid produces while `fn` runs. */
function captureDirty(g: AVGrid<Row>, fn: () => void): RerenderInfo[] {
    const captured: RerenderInfo[] = [];
    const spy = vi
        .spyOn(g.render.model, "update")
        .mockImplementation((info?: RerenderInfo) => {
            captured.push(info ?? {});
        });
    try {
        fn();
    } finally {
        spy.mockRestore();
    }
    return captured;
}

/** Let the microtask-coalesced dirty set and the rAF paint both run. */
function paint(g: AVGrid<Row>): Promise<void> {
    return new Promise((resolve) => {
        void Promise.resolve().then(() => {
            g.render.model.updateRenderInfo();
            requestAnimationFrame(() => resolve());
        });
    });
}

afterEach(() => {
    while (grids.length) grids.pop()?.destroy();
    document.body.textContent = "";
});

describe("the selection itself", () => {
    it("starts empty", () => {
        const g = grid();
        expect(g.getSelected()).toEqual([]);
        expect(g.getSelectedRows()).toEqual([]);
        expect(g.getState().selectedCount).toBe(0);
        expect(g.getState().allSelected).toBe(false);
    });

    it("takes an initial selection from the options", () => {
        const g = grid(20, { selected: ["2", "5"] });
        expect(g.getSelected().sort()).toEqual(["2", "5"]);
        expect(g.isSelected("2")).toBe(true);
        expect(g.isSelected("3")).toBe(false);
    });

    it("setSelected replaces, toggleSelected flips one row", () => {
        const g = grid();
        g.setSelected(["1", "2"]);
        expect(g.getSelected().sort()).toEqual(["1", "2"]);

        g.toggleSelected("2");
        expect(g.getSelected()).toEqual(["1"]);
        g.toggleSelected("9");
        expect(g.getSelected().sort()).toEqual(["1", "9"]);

        g.setSelected(undefined);
        expect(g.getSelected()).toEqual([]);
    });

    it("accepts a Set as readily as an array", () => {
        const g = grid();
        g.setSelected(new Set(["4"]));
        expect(g.getSelected()).toEqual(["4"]);
    });

    it("getSelectedRows returns the row objects in display order", () => {
        const g = grid();
        g.setSelected(["7", "3"]);
        expect(g.getSelectedRows().map((r) => r.id)).toEqual([3, 7]);
    });

    it("selectAll / clearSelected, and allSelected follows", () => {
        const g = grid(20);
        g.selectAll();
        expect(g.getSelected()).toHaveLength(20);
        expect(g.getState().allSelected).toBe(true);

        g.clearSelected();
        expect(g.getSelected()).toEqual([]);
        expect(g.getState().allSelected).toBe(false);
    });

    it("fires onSelectionChange with the keys, once per change", () => {
        const onSelectionChange = vi.fn();
        const g = grid(20, { onSelectionChange });

        g.setSelected(["1"]);
        expect(onSelectionChange).toHaveBeenCalledTimes(1);
        expect(onSelectionChange).toHaveBeenLastCalledWith(["1"]);

        // Setting the same selection again is not a change.
        g.setSelected(["1"]);
        expect(onSelectionChange).toHaveBeenCalledTimes(1);

        g.toggleSelected("2");
        expect(onSelectionChange).toHaveBeenCalledTimes(2);
    });

    it("selects only the displayed rows when a filter is applied", () => {
        const g = grid(20, { searchString: "Row 1" });
        // "Row 1", "Row 1x" — 11 of 20.
        const visible = g.getVisibleRows().length;
        g.selectAll();
        expect(g.getSelected()).toHaveLength(visible);
        expect(visible).toBeLessThan(20);
    });

    it("keeps its keys across a sort, and stays 'all selected'", () => {
        const g = grid(20);
        g.setSelected(["1", "2"]);
        g.setSort({ key: "score", direction: "desc" });
        expect(g.getSelected().sort()).toEqual(["1", "2"]);

        g.selectAll();
        g.setSort({ key: "name", direction: "asc" });
        expect(g.getState().allSelected).toBe(true);
    });

    it("drops to 'not all selected' when rows are added under it", () => {
        const g = grid(5);
        g.selectAll();
        expect(g.getState().allSelected).toBe(true);

        g.setRows(rows(6));
        expect(g.getState().allSelected).toBe(false);
        expect(g.getSelected()).toHaveLength(5);
    });
});

describe("the select column", () => {
    it("is prepended to the displayed columns but not to the host's", () => {
        const g = grid();
        expect(g.getColumns().map((c) => c.key)).toEqual(["id", "name", "score"]);
        expect(String(g.model.data.columns[0].key)).toBe(SELECT_COLUMN_KEY);
        // Being a status column, it pins the left band.
        expect(g.model.data.lastIsStatusIndex).toBe(0);
    });

    it("is absent without the option", () => {
        const g = grid(20, { selectColumn: false });
        expect(String(g.model.data.columns[0].key)).toBe("id");
    });

    it("survives setColumns without duplicating", () => {
        const g = grid();
        g.setColumns([{ key: "name" }, { key: "id" }]);
        expect(g.model.data.columns.map((c) => String(c.key))).toEqual([
            SELECT_COLUMN_KEY,
            "name",
            "id",
        ]);
    });

    it("can be turned on and off after creation", () => {
        const g = grid(20, { selectColumn: false });
        g.setOptions({ selectColumn: true });
        expect(String(g.model.data.columns[0].key)).toBe(SELECT_COLUMN_KEY);
        g.setOptions({ selectColumn: false });
        expect(String(g.model.data.columns[0].key)).toBe("id");
    });

    it("clicking a checkbox cell toggles that row", async () => {
        const g = grid();
        await paint(g);

        click(cellAt(g, 2, 0));
        expect(g.getSelected()).toEqual(["3"]);

        click(cellAt(g, 2, 0));
        expect(g.getSelected()).toEqual([]);
    });

    it("clicking the checkbox does not move the cell focus or sort", async () => {
        const g = grid();
        await paint(g);

        pointerDown(cellAt(g, 2, 0));
        click(cellAt(g, 2, 0));
        expect(g.getFocus()).toBeUndefined();

        click(headerCell(g, 0));
        expect(g.getSort()).toBeUndefined();
    });

    it("the header checkbox selects everything, then clears it", async () => {
        const g = grid(20);
        await paint(g);

        click(headerCell(g, 0));
        expect(g.getSelected()).toHaveLength(20);

        click(headerCell(g, 0));
        expect(g.getSelected()).toEqual([]);
    });

    it("the header checkbox clears a partial selection rather than completing it", async () => {
        const g = grid(20);
        await paint(g);
        g.setSelected(["1"]);

        click(headerCell(g, 0));
        expect(g.getSelected()).toEqual([]);
    });

    it("paints the row tint and the checked box", async () => {
        const g = grid();
        g.setSelected(["3"]);
        await paint(g);

        expect(classesAt(g, 2, 1)).toContain("avg-row-selected");
        expect(classesAt(g, 1, 1)).not.toContain("avg-row-selected");
        expect(cellAt(g, 2, 0)?.innerHTML).toContain("avg-checked");
        expect(cellAt(g, 1, 0)?.innerHTML).not.toContain("avg-checked");
    });

    it("still fires onCellClick for ordinary columns", async () => {
        const onCellClick = vi.fn();
        const g = grid(20, { onCellClick });
        await paint(g);

        click(cellAt(g, 2, 1));
        expect(onCellClick).toHaveBeenCalledTimes(1);

        // …but not for the checkbox, which is grid chrome rather than data.
        click(cellAt(g, 2, 0));
        expect(onCellClick).toHaveBeenCalledTimes(1);
    });
});

describe("the dirty set", () => {
    it("toggling one row marks that row and nothing else", async () => {
        const g = grid();
        await paint(g);

        const dirty = captureDirty(g, () => g.toggleSelected("3"));
        const rowSets = dirty.map((d) => d.rows).filter(Boolean);
        expect(rowSets).toEqual([[0, 3]]); // grid row 3 = data row 2, plus the header checkbox
    });

    it("does not repaint the header when its checkbox state did not change", async () => {
        const g = grid();
        g.setSelected(["1", "2"]);
        await paint(g);

        // Already "some"; adding another keeps it "some".
        const dirty = captureDirty(g, () => g.toggleSelected("3"));
        expect(dirty.flatMap((d) => d.rows ?? [])).toEqual([3]);
    });

    it("marks nothing at all when the selection did not change", async () => {
        const g = grid();
        g.setSelected(["3"]);
        await paint(g);

        const dirty = captureDirty(g, () => g.setSelected(["3"]));
        expect(dirty).toEqual([]);
    });

    it("select-all on 100,000 rows marks only the rendered rows", async () => {
        const g = grid(100_000);
        await paint(g);

        const dirty = captureDirty(g, () => g.selectAll());
        const marked = dirty.flatMap((d) => d.rows ?? []);

        // Bounded by the viewport — 300px of 24px rows plus overscan and the header — and
        // emphatically not by the 100,000 rows whose state just changed.
        expect(marked.length).toBeGreaterThan(0);
        expect(marked.length).toBeLessThan(40);
        expect(dirty.some((d) => d.all)).toBe(false);
        expect(g.getSelected()).toHaveLength(100_000);
    });

    it("clearing a 100,000-row selection is just as narrow", async () => {
        const g = grid(100_000);
        g.selectAll();
        await paint(g);

        const dirty = captureDirty(g, () => g.clearSelected());
        expect(dirty.flatMap((d) => d.rows ?? []).length).toBeLessThan(40);
        expect(dirty.some((d) => d.all)).toBe(false);
    });
});
