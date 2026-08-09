// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { AVGrid } from "../AVGrid";
import type { AVGridOptions } from "../options";
import type { RerenderInfo } from "../render/types";

/**
 * In-cell editing.
 *
 * The same shape as `SelectedModel.test.ts`. happy-dom does no layout, so what is checkable
 * here is behaviour and bookkeeping: what opens an editor, what commits it, what reaches the
 * row object, and how many cells a commit marks dirty. Whether the editor *looks* like a cell
 * is a question for the board, and is answered there.
 */
function installLayout(): () => void {
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
    return () => {
        document.createElement = originalCreate;
    };
}

function withLayout<T>(fn: () => T): T {
    const restore = installLayout();
    try {
        return fn();
    } finally {
        restore();
    }
}

interface Row {
    id: number;
    name: string;
    score: number;
    active: boolean;
    status: string;
}

function rows(count: number): Row[] {
    return Array.from({ length: count }, (_, i) => ({
        id: i + 1,
        name: `Row ${i + 1}`,
        score: (i * 7) % 100,
        active: i % 2 === 0,
        status: i % 3 === 0 ? "open" : "closed",
    }));
}

const grids: AVGrid<any>[] = [];

/** Columns: 0 name, 1 score (number), 2 active (boolean), 3 status (options), 4 id (readonly). */
function grid(count = 20, extra: Partial<AVGridOptions<Row>> = {}): AVGrid<Row> {
    const host = document.createElement("div");
    document.body.append(host);
    const g = withLayout(() =>
        AVGrid.create<Row>(host, {
            rows: rows(count),
            columns: [
                { key: "name", name: "Name", width: 120 },
                { key: "score", name: "Score", width: 80, dataType: "number" },
                { key: "active", name: "Active", width: 70, dataType: "boolean" },
                {
                    key: "status",
                    name: "Status",
                    width: 90,
                    options: ["open", "closed"],
                },
                { key: "id", name: "ID", width: 60, readonly: true },
            ],
            getRowKey: (r) => String(r.id),
            editable: true,
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

function editor(g: AVGrid<Row>): HTMLInputElement | null {
    return g.element.querySelector('input[data-type="cell-editor"]');
}

function selectEditor(g: AVGrid<Row>): HTMLElement | null {
    return g.element.querySelector('.avg-cell-select[data-type="cell-editor"]');
}

/** The dropdown's list lives on `document.body`, not inside the grid — it is a popover. */
function dropdownRows(): HTMLElement[] {
    return Array.from(
        document.querySelectorAll<HTMLElement>(
            ".avg-cell-select-popover .avg-list-item[data-index]",
        ),
    ).sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index));
}

/**
 * A paint with a measurable viewport in force, for the dropdown: its list is built *during*
 * the paint, and a `RenderGrid` that measures zero renders no rows at all.
 */
async function paintWithLayout(g: AVGrid<Row>): Promise<void> {
    const restore = installLayout();
    try {
        await paint(g);
        // Two more frames: the paint builds the editor, a microtask focuses it and opens the
        // popover, and the list inside it paints its rows on the frame after that.
        await Promise.resolve();
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    } finally {
        restore();
    }
}

/** A key on the grid root — which is where every key that is not inside the editor arrives. */
function key(g: AVGrid<Row>, init: KeyboardEventInit): void {
    g.element.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, ...init }),
    );
}

function keyOn(el: Element | null, init: KeyboardEventInit): void {
    el?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
}

function doubleClick(el: Element | null): void {
    el?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
}

/** Type into the open editor, as a user would. */
function type(g: AVGrid<Row>, text: string): void {
    const input = editor(g);
    if (!input) throw new Error("no editor is open");
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

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

describe("opening an editor", () => {
    it("opens on F2 with the cell's current value", async () => {
        const g = grid();
        g.focusCell(2, 0);
        key(g, { key: "F2", code: "F2" });
        await paint(g);

        expect(g.isEditing()).toBe(true);
        expect(editor(g)?.value).toBe("Row 3");
        expect(g.getState().editing).toEqual({ rowKey: "3", columnKey: "name" });
    });

    it("opens on Enter, and on a double-click", async () => {
        const g = grid();
        g.focusCell(1, 0);
        key(g, { key: "Enter", code: "Enter" });
        expect(g.isEditing()).toBe(true);
        g.cancelEdit();

        await paint(g);
        doubleClick(cellAt(g, 1, 0));
        expect(g.isEditing()).toBe(true);
    });

    it("opens on a printable key, with that key as the value", async () => {
        const g = grid();
        g.focusCell(0, 0);
        key(g, { key: "x", code: "KeyX" });
        await paint(g);

        expect(editor(g)?.value).toBe("x");
        // Typing replaces the cell, so the edit counts as changed before anything else arrives.
        expect(g.getEdit()?.changed).toBe(true);
    });

    it("ignores modified keys, so ctrl+C is not a keystroke", () => {
        const g = grid();
        g.focusCell(0, 0);
        key(g, { key: "c", code: "KeyC", ctrlKey: true });
        expect(g.isEditing()).toBe(false);
    });

    it("does not open on a readonly column, or when the grid is not editable", () => {
        const g = grid();
        g.focusCell(0, 4);
        key(g, { key: "F2", code: "F2" });
        expect(g.isEditing()).toBe(false);

        const plain = grid(20, { editable: false });
        plain.focusCell(0, 0);
        key(plain, { key: "F2", code: "F2" });
        expect(plain.isEditing()).toBe(false);
    });

    it("does not open on a multi-cell selection", () => {
        const g = grid();
        g.selectRange(0, 0, 3, 0);
        key(g, { key: "a", code: "KeyA" });
        expect(g.isEditing()).toBe(false);
    });

    it("gives an options column a dropdown carrying its choices", async () => {
        const g = grid();
        g.focusCell(0, 3);
        key(g, { key: "F2", code: "F2" });
        await paintWithLayout(g);

        const select = selectEditor(g);
        expect(select).not.toBeNull();
        expect(select!.textContent).toContain("open");
        expect(dropdownRows().map((r) => r.textContent)).toEqual([
            "open",
            "closed",
        ]);
    });

    it("marks one cell dirty, not the row", () => {
        const g = grid();
        g.focusCell(2, 0);
        const dirty = captureDirty(g, () =>
            key(g, { key: "F2", code: "F2" }),
        );
        const cells = dirty.flatMap((d) => d.cells ?? []);
        expect(cells).toEqual([{ row: 3, col: 0 }]);
        expect(dirty.some((d) => d.all || d.rows)).toBe(false);
    });
});

describe("committing and cancelling", () => {
    it("Enter writes the value and reports it", async () => {
        const edits: any[] = [];
        const g = grid(20, { onEdit: (e) => void edits.push(e) });
        g.focusCell(0, 0);
        key(g, { key: "F2", code: "F2" });
        await paint(g);

        type(g, "renamed");
        keyOn(editor(g), { key: "Enter", code: "Enter" });

        expect(g.isEditing()).toBe(false);
        expect(g.getRows()[0].name).toBe("renamed");
        expect(edits).toHaveLength(1);
        expect(edits[0]).toMatchObject({
            value: "renamed",
            previousValue: "Row 1",
            columnKey: "name",
            rowKey: "1",
            rowIndex: 0,
            colIndex: 0,
        });
    });

    it("Escape cancels, leaving the row untouched", async () => {
        const g = grid();
        g.focusCell(0, 0);
        key(g, { key: "F2", code: "F2" });
        await paint(g);

        type(g, "discarded");
        keyOn(editor(g), { key: "Escape", code: "Escape" });

        expect(g.isEditing()).toBe(false);
        expect(g.getRows()[0].name).toBe("Row 1");
    });

    it("blur commits", async () => {
        const g = grid();
        g.focusCell(0, 0);
        key(g, { key: "F2", code: "F2" });
        await paint(g);

        type(g, "by blur");
        editor(g)?.dispatchEvent(new FocusEvent("blur"));

        expect(g.isEditing()).toBe(false);
        expect(g.getRows()[0].name).toBe("by blur");
    });

    it("Tab commits and moves the focus one cell right", async () => {
        const g = grid();
        g.focusCell(0, 0);
        key(g, { key: "F2", code: "F2" });
        await paint(g);

        type(g, "tabbed");
        keyOn(editor(g), { key: "Tab", code: "Tab" });

        expect(g.getRows()[0].name).toBe("tabbed");
        expect(g.getFocus()?.columnKey).toBe("score");
        expect(g.isEditing()).toBe(false);
    });

    it("moving the focus elsewhere commits the open edit", async () => {
        const g = grid();
        g.focusCell(0, 0);
        key(g, { key: "F2", code: "F2" });
        await paint(g);

        type(g, "committed by focus");
        g.focusCell(5, 1);

        expect(g.isEditing()).toBe(false);
        expect(g.getRows()[0].name).toBe("committed by focus");
    });

    it("commits nothing when the value was not changed", async () => {
        const onEdit = vi.fn();
        const g = grid(20, { onEdit });
        g.focusCell(0, 0);
        key(g, { key: "F2", code: "F2" });
        await paint(g);

        keyOn(editor(g), { key: "Enter", code: "Enter" });
        expect(onEdit).not.toHaveBeenCalled();
    });

    it("onEdit returning false rejects the write", async () => {
        const g = grid(20, { onEdit: () => false });
        g.focusCell(0, 0);
        key(g, { key: "F2", code: "F2" });
        await paint(g);

        type(g, "rejected");
        keyOn(editor(g), { key: "Enter", code: "Enter" });

        expect(g.getRows()[0].name).toBe("Row 1");
    });

    it("coerces the value to the column's dataType", async () => {
        const g = grid();
        g.focusCell(0, 1);
        key(g, { key: "F2", code: "F2" });
        await paint(g);

        type(g, "42");
        keyOn(editor(g), { key: "Enter", code: "Enter" });

        expect(g.getRows()[0].score).toBe(42);
    });

    it("keeps an undeclared column numeric when its cell already was", async () => {
        // No `dataType` on this column at all — the value's own type is the only signal, and
        // without this a single edit would turn the column into strings and change how it
        // sorts.
        const g = grid(20, { columns: [{ key: "score", name: "Score" }] });
        g.focusCell(0, 0);
        key(g, { key: "F2", code: "F2" });
        await paint(g);

        type(g, "97.5");
        keyOn(editor(g), { key: "Enter", code: "Enter" });
        expect(g.getRows()[0].score).toBe(97.5);

        // Text stays text: the rule is "it was a number and still parses as one", not
        // "numbers win".
        key(g, { key: "F2", code: "F2" });
        await paint(g);
        type(g, "n/a");
        keyOn(editor(g), { key: "Enter", code: "Enter" });
        expect(g.getRows()[0].score).toBe("n/a");
    });

    it("a column's own validate wins over the default coercion", async () => {
        const g = grid(20, {
            columns: [
                {
                    key: "name",
                    name: "Name",
                    validate: (_c, _r, v) => String(v).toUpperCase(),
                },
            ],
        });
        g.focusCell(0, 0);
        key(g, { key: "F2", code: "F2" });
        await paint(g);

        type(g, "shouty");
        keyOn(editor(g), { key: "Enter", code: "Enter" });

        expect(g.getRows()[0].name).toBe("SHOUTY");
    });

    it("reports a value that is not one of the column's options, and writes nothing", async () => {
        const onInvalidEdit = vi.fn();
        const g = grid(20, { onInvalidEdit });
        g.focusCell(0, 3);
        key(g, { key: "F2", code: "F2" });
        await paint(g);

        // Straight through the model: a dropdown cannot produce this, but `setCellValue` and a
        // custom editor both can.
        expect(g.setCellValue(0, 3, "nonsense")).toBe(false);
        expect(g.getRows()[0].status).toBe("open");
        expect(onInvalidEdit).toHaveBeenCalledTimes(1);
        expect(onInvalidEdit.mock.calls[0][0]).toMatchObject({
            value: "nonsense",
            rowIndex: 0,
            colIndex: 3,
        });
    });

    it("a dropdown pick commits immediately", async () => {
        const g = grid();
        g.focusCell(0, 3);
        key(g, { key: "F2", code: "F2" });
        await paintWithLayout(g);

        dropdownRows()[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(g.isEditing()).toBe(false);
        expect(g.getRows()[0].status).toBe("closed");
        expect(document.querySelector(".avg-cell-select-popover")).toBeNull();
    });
});

describe("booleans, and the range keys", () => {
    it("Space flips each boolean in the selection", () => {
        const g = grid();
        const before = g.getRows().slice(0, 3).map((r) => r.active);
        g.selectRange(0, 2, 2, 2);
        key(g, { key: " ", code: "Space" });

        expect(g.getRows().slice(0, 3).map((r) => r.active)).toEqual(
            before.map((v) => !v),
        );
        expect(g.isEditing()).toBe(false);
    });

    it("Enter makes every boolean in the selection the opposite of the focused one", () => {
        const g = grid();
        // Focus lands on the end corner of a range, which is row 2 here.
        g.selectRange(0, 2, 2, 2);
        const focusValue = g.getRows()[2].active;
        key(g, { key: "Enter", code: "Enter" });

        const after = g.getRows().slice(0, 3).map((r) => r.active);
        expect(after).toEqual([!focusValue, !focusValue, !focusValue]);
    });

    it("a double-click toggles a boolean instead of opening an editor", async () => {
        const g = grid();
        await paint(g);
        const before = g.getRows()[1].active;
        g.focusCell(1, 2);
        doubleClick(cellAt(g, 1, 2));

        expect(g.isEditing()).toBe(false);
        expect(g.getRows()[1].active).toBe(!before);
    });

    it("Delete clears every editable cell in the selection", () => {
        const g = grid();
        g.selectRange(0, 0, 2, 1);
        key(g, { key: "Delete", code: "Delete" });

        for (const row of g.getRows().slice(0, 3)) {
            expect(row.name).toBeUndefined();
            expect(row.score).toBeNull();
        }
        // The row beyond the selection is untouched.
        expect(g.getRows()[3].name).toBe("Row 4");
    });

    it("Delete leaves a readonly column alone", () => {
        const g = grid();
        g.selectRange(0, 0, 0, 4);
        key(g, { key: "Delete", code: "Delete" });
        expect(g.getRows()[0].id).toBe(1);
    });

    it("a range delete marks the viewport once, not a cell per row", () => {
        const g = grid(1000);
        g.selectRange(0, 0, 999, 1);
        const dirty = captureDirty(g, () =>
            key(g, { key: "Delete", code: "Delete" }),
        );
        expect(dirty).toHaveLength(1);
        expect(dirty[0]).toEqual({ all: true });
    });
});

describe("the editor element", () => {
    it("survives a repaint of its own cell", async () => {
        const g = grid();
        g.focusCell(0, 0);
        key(g, { key: "F2", code: "F2" });
        await paint(g);

        const input = editor(g);
        expect(input).not.toBeNull();

        g.refresh();
        await paint(g);

        // The same element, still parented to the same cell: re-creating it would throw away
        // the caret, the selection and any composition in flight.
        expect(editor(g)).toBe(input);
        expect(cellAt(g, 0, 0)?.contains(input!)).toBe(true);
        expect(cellAt(g, 0, 0)?.className).toContain("avg-editing");
    });

    it("is gone from the DOM once the edit closes", async () => {
        const g = grid();
        g.focusCell(0, 0);
        key(g, { key: "F2", code: "F2" });
        await paint(g);
        expect(editor(g)).not.toBeNull();

        g.cancelEdit();
        await paint(g);
        expect(editor(g)).toBeNull();
    });

    it("closes when the grid is destroyed, without committing", async () => {
        const onEdit = vi.fn();
        const g = grid(20, { onEdit });
        g.focusCell(0, 0);
        key(g, { key: "F2", code: "F2" });
        await paint(g);
        type(g, "never saved");

        g.destroy();
        expect(onEdit).not.toHaveBeenCalled();
        expect(g.getRows()[0].name).toBe("Row 1");
    });
});
