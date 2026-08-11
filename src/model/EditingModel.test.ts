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

/**
 * A press and its release on a cell. `MouseEvent` because happy-dom has no `PointerEvent`
 * constructor, and the release because a press that is never let go leaves the range drag it
 * armed listening on `window` — which is not a state a real pointer can be left in.
 */
function press(el: Element | null, init: MouseEventInit = {}): void {
    pressAndHold(el, init);
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
}

function pressAndHold(el: Element | null, init: MouseEventInit = {}): void {
    el?.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0, ...init }),
    );
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
        expect(g.getState().editing).toEqual({
            rowKey: "3",
            columnKey: "name",
            changed: false,
        });
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

    it("opens on a single press of the cell that already has the focus", async () => {
        const g = grid();
        await paint(g);

        // Cold cell: the first press focuses it and nothing more.
        press(cellAt(g, 3, 0));
        expect(g.isEditing()).toBe(false);
        expect(g.getFocus()?.rowKey).toBe("4");

        // Second press, same cell — this is what a double-click is made of, and it is also
        // what a deliberate single click on an already-focused cell does.
        press(cellAt(g, 3, 0));
        expect(g.isEditing()).toBe(true);
        expect(g.getState().editing).toMatchObject({ rowKey: "4", columnKey: "name" });
    });

    it("does not open when a modifier says the press means something else", async () => {
        const g = grid();
        await paint(g);
        press(cellAt(g, 3, 0));

        for (const modifier of [
            { shiftKey: true },
            { ctrlKey: true },
            { metaKey: true },
            { altKey: true },
            { button: 2 },
        ]) {
            press(cellAt(g, 3, 0), modifier);
            expect(g.isEditing()).toBe(false);
        }
    });

    it("leaves a boolean and a readonly column to the keyboard", async () => {
        const g = grid();
        await paint(g);

        // A checkbox already shows both of its states; pressing it twice must not put a text
        // box over it. Space and a double-click still toggle.
        press(cellAt(g, 3, 2));
        press(cellAt(g, 3, 2));
        expect(g.isEditing()).toBe(false);
        expect(g.getRows()[3].active).toBe(false);

        press(cellAt(g, 3, 4));
        press(cellAt(g, 3, 4));
        expect(g.isEditing()).toBe(false);
    });

    it("does not arm a range drag with the press that opened the editor", async () => {
        const g = grid();
        await paint(g);
        press(cellAt(g, 3, 0));
        pressAndHold(cellAt(g, 3, 0));

        // A drag that had been armed would extend the selection to wherever the pointer went
        // next — here, over the input the user is placing a caret in.
        window.dispatchEvent(
            new MouseEvent("pointermove", { bubbles: true, clientX: 10, clientY: 300 }),
        );
        expect(g.isEditing()).toBe(true);
        expect(g.getSelection()?.rowRange).toEqual([3, 3]);
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

    it("ArrowDown and ArrowUp commit and move a row, ending the edit", async () => {
        const g = grid();
        g.focusCell(3, 0);
        key(g, { key: "F2", code: "F2" });
        await paint(g);

        type(g, "moved down");
        keyOn(editor(g), { key: "ArrowDown", code: "ArrowDown" });

        expect(g.getRows()[3].name).toBe("moved down");
        expect(g.isEditing()).toBe(false);
        expect(g.getFocus()?.rowKey).toBe("5");
        expect(g.getFocus()?.columnKey).toBe("name");

        key(g, { key: "F2", code: "F2" });
        await paint(g);
        type(g, "moved up");
        keyOn(editor(g), { key: "ArrowUp", code: "ArrowUp" });

        expect(g.getRows()[4].name).toBe("moved up");
        expect(g.getFocus()?.rowKey).toBe("4");
    });

    it("leaves the horizontal arrows to the caret", async () => {
        const g = grid();
        g.focusCell(3, 0);
        key(g, { key: "F2", code: "F2" });
        await paint(g);

        // A cell editor is one line of text, so left and right belong to the caret inside it —
        // moving a cell with them would make the value unreachable past its first character.
        keyOn(editor(g), { key: "ArrowLeft", code: "ArrowLeft" });
        keyOn(editor(g), { key: "ArrowRight", code: "ArrowRight" });

        expect(g.isEditing()).toBe(true);
        expect(g.getFocus()?.rowKey).toBe("4");
        expect(g.getFocus()?.columnKey).toBe("name");
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

describe("the boolean cell's checkbox", () => {
    /**
     * Move the pointer onto a cell. The grid reads hover from `pointermove`, on the root —
     * `mousemove` is not delivered at all once a press has called `preventDefault()`.
     */
    function hover(g: AVGrid<Row>, row: number, col: number): void {
        cellAt(g, row, col)?.dispatchEvent(
            new MouseEvent("pointermove", { bubbles: true }),
        );
    }

    function toggleBox(g: AVGrid<Row>, row: number, col: number): HTMLElement | null {
        return (
            cellAt(g, row, col)?.querySelector<HTMLElement>(
                '[data-type="bool-toggle"]',
            ) ?? null
        );
    }

    function click(el: Element | null): void {
        el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }

    it("is in every editable boolean cell, hovered or not, and shows its state", async () => {
        const g = grid();
        await paint(g);

        // Row 0 is active, row 1 is not. Nothing has been hovered or focused, and the hit
        // target is there anyway — an empty box for the unchecked cell.
        expect(toggleBox(g, 0, 2)?.className).toBe("avg-bool-box avg-checked");
        expect(toggleBox(g, 1, 2)?.className).toBe("avg-bool-box");
        expect(cellAt(g, 0, 2)?.querySelector(".avg-check-icon")).not.toBeNull();
        expect(toggleBox(g, 1, 2)?.innerHTML).toBe("");
    });

    it("frames its glyph for the cell under the pointer, and only that cell", async () => {
        const g = grid();
        await paint(g);

        // At rest a checked cell is a bare tick; hovered, the tick becomes a framed box. Both
        // are inside the same wrapper, so the target does not move when the glyph changes.
        expect(cellAt(g, 0, 2)?.querySelector(".avg-check-icon")).not.toBeNull();

        hover(g, 0, 2);
        await paint(g);
        expect(cellAt(g, 0, 2)?.querySelector(".avg-check-icon")).toBeNull();
        expect(toggleBox(g, 0, 2)?.className).toBe("avg-bool-box avg-checked");
        expect(toggleBox(g, 0, 2)?.innerHTML).not.toBe("");

        // A different cell in the *same* row. Row hover would have framed this one too, and
        // only one cell of the row is ever under the pointer.
        hover(g, 0, 0);
        await paint(g);
        expect(cellAt(g, 0, 2)?.querySelector(".avg-check-icon")).not.toBeNull();
    });

    it("is absent wherever an edit could not land", async () => {
        const g = grid();
        await paint(g);
        expect(toggleBox(g, 1, 0)).toBeNull();

        // A readonly boolean column keeps its tick, and keeps it when hovered — there is no box
        // for the glyph to change into.
        const readonly = grid(20, {
            columns: [
                { key: "name", name: "Name", width: 120 },
                { key: "active", name: "Active", width: 70, dataType: "boolean", readonly: true },
            ],
        });
        await paint(readonly);
        hover(readonly, 0, 1);
        await paint(readonly);
        expect(toggleBox(readonly, 0, 1)).toBeNull();
        expect(cellAt(readonly, 0, 1)?.querySelector(".avg-check-icon")).not.toBeNull();

        const notEditable = grid(20, { editable: false });
        await paint(notEditable);
        expect(toggleBox(notEditable, 1, 2)).toBeNull();
    });

    it("flips the cell on the first press, with no focus or hover first", async () => {
        const onEdit = vi.fn();
        const g = grid(20, { onEdit });
        await paint(g);

        expect(g.getFocus()).toBeUndefined();
        expect(g.getRows()[1].active).toBe(false);
        const dirty = captureDirty(g, () => press(toggleBox(g, 1, 2)));

        expect(g.getRows()[1].active).toBe(true);
        expect(onEdit).toHaveBeenCalledTimes(1);
        // It selects the cell as well as editing it, which is what a press on a cell does.
        expect(g.getFocus()?.columnKey).toBe("active");
        // The press moves the focus as well, so it marks the cells the focus left and arrived
        // at. What matters is that the edit itself marks the written row — a computed column
        // anywhere in it reads the value that just changed — and that nothing marks the
        // viewport.
        expect(dirty).toContainEqual({ rows: [2] });
        expect(dirty.some((d) => d.all)).toBe(false);
    });

    /**
     * The regression that made a real mouse take two clicks per record while every synthetic
     * test passed: a press held for a frame — which is every real click — repaints the cell for
     * the focus it just moved, and the box the press landed on is replaced. `click` is then
     * dispatched on the cell instead, with the box nowhere in its path.
     */
    it("flips once when the box is replaced between the press and the click", async () => {
        const onEdit = vi.fn();
        const g = grid(20, { onEdit });
        await paint(g);

        const box = toggleBox(g, 1, 2);
        pressAndHold(box);
        await paint(g);
        expect(box?.isConnected).toBe(false);

        window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
        click(cellAt(g, 1, 2));

        expect(g.getRows()[1].active).toBe(true);
        expect(onEdit).toHaveBeenCalledTimes(1);
    });

    it("changes nothing when the press lands on the cell beside the box", async () => {
        const onEdit = vi.fn();
        const g = grid(20, { onEdit });
        await paint(g);

        press(cellAt(g, 1, 2));
        click(cellAt(g, 1, 2));

        expect(g.getRows()[1].active).toBe(false);
        expect(onEdit).not.toHaveBeenCalled();
        // It still selects the cell, which is the whole point of the box being the only target.
        expect(g.getFocus()?.columnKey).toBe("active");
    });

    it("acts on the cell under the pointer, not on the selection around it", async () => {
        const g = grid();
        await paint(g);
        g.selectRange(0, 2, 4, 2);
        await paint(g);

        press(toggleBox(g, 1, 2));

        expect(g.getRows().slice(0, 5).map((r) => r.active)).toEqual([
            true,
            true,
            true,
            false,
            true,
        ]);
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

/**
 * What a written value marks dirty.
 *
 * One row for a single write, one `all` for a bulk one — and nothing per cell, because a host's
 * `render` may read any part of the row and there is no way to know which part.
 */
describe("repainting after an edit", () => {
    it("repaints the whole row, so a computed column is not left stale", async () => {
        // The bug this exists for: editing "name" left the computed column showing the old
        // value until something unrelated repainted it — hovering the row was the usual way to
        // discover it, which makes the grid look like it needs poking.
        const g = grid(20, {
            columns: [
                { key: "name", name: "Name", width: 120 },
                {
                    key: "id",
                    name: "Label",
                    width: 160,
                    render: (c) => `${c.row.name} #${c.row.id}`,
                },
            ],
        });
        await paint(g);
        const computed = (): string | undefined =>
            cellAt(g, 0, 1)?.textContent ?? undefined;
        expect(computed()).toBe("Row 1 #1");

        g.focusCell(0, 0);
        key(g, { key: "F2", code: "F2" });
        await paint(g);
        type(g, "renamed");

        keyOn(editor(g), { key: "Enter", code: "Enter" });
        await paint(g);
        expect(computed()).toBe("renamed #1");

        // And the mark that did it is the row, not the written cell — captured on a second
        // edit, because `captureDirty` replaces `update` and so suppresses the very repaint the
        // assertion above needs. `RenderGridModel` merges these into one dirty set and paints
        // once per frame, so the two cannot be observed in the same pass.
        g.focusCell(1, 0);
        const dirty = captureDirty(g, () => g.setCellValue(1, 0, "again"));
        expect(dirty).toEqual([{ rows: [2] }]);
    });

    it("still marks bulk writes once, not a row per cell", () => {
        // A paste, a range delete and a boolean sweep write through the same `editCellAt` with
        // `silent`, so the row-level mark above must not reach them: 1,000 rows would otherwise
        // build a dirty set far larger than the viewport it ends up repainting.
        const g = grid(1000);
        g.selectRange(0, 0, 999, 1);
        const dirty = captureDirty(g, () => g.pasteText("x\ty"));
        expect(dirty).toEqual([{ all: true }]);
    });

    // And even an unbatched caller could not flood the engine: marks accumulate into one dirty
    // set and paint once per animation frame, which `RenderGrid.test.ts` pins directly in
    // "coalesces several model updates into one paint". The two mechanisms are independent, and
    // between them a bulk write costs one paint however it is routed.
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
