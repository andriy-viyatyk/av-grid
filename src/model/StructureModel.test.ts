// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { AVGrid } from "../AVGrid";
import type { AVGridOptions } from "../options";

/**
 * Rows and columns added and deleted.
 *
 * Four things this file is really guarding, none of them obvious from the method signatures:
 *
 * 1. **An index is a display index.** Inserting at 0 on a descending sort puts the row at the
 *    top of what the user sees, not at the top of the array behind it.
 * 2. **Adding while sorted or filtered freezes the order**, so the new row stays where it was
 *    put instead of sorting away or failing the filter and vanishing.
 * 3. **A deleted row is deselected**, so `getSelected()` and `getSelectedRows()` keep agreeing.
 * 4. **The callbacks fire before the change and `false` cancels it**, matching `onEdit`.
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
        score: (i + 1) * 10,
    }));
}

const grids: AVGrid<any>[] = [];

/** Columns: 0 name, 1 score (number), 2 id (readonly). */
function grid(count = 5, extra: Partial<AVGridOptions<Row>> = {}): AVGrid<Row> {
    const host = document.createElement("div");
    document.body.append(host);
    const g = withLayout(() =>
        AVGrid.create<Row>(host, {
            rows: rows(count),
            columns: [
                { key: "name", name: "Name", width: 120 },
                { key: "score", name: "Score", width: 80, dataType: "number" },
                { key: "id", name: "ID", width: 60, readonly: true },
            ],
            getRowKey: (r) => String(r.id),
            editable: true,
            canAddRows: true,
            canDeleteRows: true,
            canAddColumns: true,
            canDeleteColumns: true,
            ...extra,
        }),
    );
    grids.push(g);
    return g;
}

function key(e: Partial<KeyboardEvent> & { code: string }): KeyboardEvent {
    return new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...e,
    } as KeyboardEventInit);
}

afterEach(() => {
    while (grids.length) grids.pop()?.destroy();
    document.body.textContent = "";
});

describe("adding rows", () => {
    it("appends when no index is given", () => {
        const g = grid(3);
        g.addRows([{ id: 99, name: "Ada", score: 1 }]);
        expect(g.getVisibleRows().map((r) => r.name)).toEqual([
            "Row 1",
            "Row 2",
            "Row 3",
            "Ada",
        ]);
    });

    it("inserts at a display index", () => {
        const g = grid(3);
        g.addRows([{ id: 99, name: "Ada", score: 1 }], 1);
        expect(g.getVisibleRows().map((r) => r.name)).toEqual([
            "Row 1",
            "Ada",
            "Row 2",
            "Row 3",
        ]);
    });

    it("puts the row where the user sees it, not where the array happens to be", () => {
        const g = grid(3, { sort: { key: "name", direction: "desc" } });
        expect(g.getVisibleRows().map((r) => r.name)).toEqual([
            "Row 3",
            "Row 2",
            "Row 1",
        ]);

        g.addRows([{ id: 99, name: "Ada", score: 1 }], 0);
        // Display order first — the point of the test.
        expect(g.getVisibleRows()[0].name).toBe("Ada");
        // And ahead of the row it was inserted above in the source array too, so a later
        // `getRows()` round trip preserves the relative order the user chose.
        const source = g.getRows().map((r) => r.name);
        expect(source.indexOf("Ada")).toBeLessThan(source.indexOf("Row 3"));
    });

    it("holds a sorted grid still, so the new row does not sort away", () => {
        const g = grid(3, { sort: { key: "name", direction: "asc" } });
        const added = g.addRow();
        expect(added).toBeDefined();
        // "" sorts before "Row 1"; frozen, it stays at the end where it was added.
        expect(g.getVisibleRows()[3]).toBe(added);
    });

    it("keeps a row that the active filter would have dropped", () => {
        const g = grid(5, { searchString: "Row 1" });
        expect(g.getVisibleRows()).toHaveLength(1);
        g.addRow();
        expect(g.getVisibleRows()).toHaveLength(2);
    });

    it("gives every blank row its own key", () => {
        const g = grid(2);
        g.addRow();
        g.addRow();
        const keys = g.getVisibleRows().map((r) => String(r.id));
        expect(new Set(keys).size).toBe(keys.length);
    });

    it("uses newRow when given one", () => {
        const g = grid(1, { newRow: (i) => ({ id: 500 + i, name: "blank", score: 7 }) });
        expect(g.addRow()?.name).toBe("blank");
    });

    it("fires onAddRows before the insert, with the rows and the index", () => {
        const onAddRows = vi.fn();
        const g = grid(3, { onAddRows });
        const row = { id: 99, name: "Ada", score: 1 };
        g.addRows([row], 1);
        expect(onAddRows).toHaveBeenCalledWith({ rows: [row], index: 1 });
    });

    it("adds nothing when onAddRows returns false", () => {
        const g = grid(3, { onAddRows: () => false });
        expect(g.addRows([{ id: 99, name: "Ada", score: 1 }])).toEqual([]);
        expect(g.getVisibleRows()).toHaveLength(3);
    });

    it("lets onAddRows fill the rows in before they land", () => {
        const g = grid(1, {
            onAddRows: (e) => {
                e.rows.forEach((r) => (r.name = "filled"));
            },
        });
        expect(g.addRow()?.name).toBe("filled");
    });

    it("selects what it added", () => {
        const g = grid(3);
        g.focusCell(0, 0);
        g.addRows([{ id: 99, name: "Ada", score: 1 }]);
        expect(g.getFocus()?.rowKey).toBe("99");
    });
});

describe("deleting rows", () => {
    it("deletes by row key", () => {
        const g = grid(3);
        expect(g.deleteRows(["2"])).toBe(true);
        expect(g.getVisibleRows().map((r) => r.id)).toEqual([1, 3]);
    });

    it("ignores keys that match nothing", () => {
        const g = grid(3);
        expect(g.deleteRows(["nope"])).toBe(false);
        expect(g.getVisibleRows()).toHaveLength(3);
    });

    it("fires onDeleteRows with the rows themselves, not just the keys", () => {
        const onDeleteRows = vi.fn();
        const g = grid(3, { onDeleteRows });
        const doomed = g.getVisibleRows()[1];
        g.deleteRows(["2"]);
        expect(onDeleteRows).toHaveBeenCalledWith({ rows: [doomed], rowKeys: ["2"] });
    });

    it("deletes nothing when onDeleteRows returns false", () => {
        const g = grid(3, { onDeleteRows: () => false });
        expect(g.deleteRows(["2"])).toBe(false);
        expect(g.getVisibleRows()).toHaveLength(3);
    });

    it("drops a deleted row from the checkbox selection", () => {
        const g = grid(3, { selectColumn: true });
        g.setSelected(["1", "2"]);
        g.deleteRows(["2"]);
        expect(g.getSelected()).toEqual(["1"]);
        expect(g.getSelectedRows()).toHaveLength(1);
    });

    it("closes an editor open on a row that is about to go", () => {
        const g = grid(3);
        g.startEdit(1, 0);
        expect(g.isEditing()).toBe(true);
        g.deleteRows(["2"]);
        expect(g.isEditing()).toBe(false);
    });

    it("moves the focus onto the row that took the deleted one's place", () => {
        const g = grid(3);
        g.focusCell(1, 1);
        g.deleteRows(["2"]);
        expect(g.getFocus()?.rowKey).toBe("3");
    });

    it("clamps the focus when the last row goes", () => {
        const g = grid(3);
        g.focusCell(2, 0);
        g.deleteRows(["3"]);
        expect(g.getFocus()?.rowKey).toBe("2");
    });

    it("clears the focus when the grid empties", () => {
        const g = grid(2);
        g.focusCell(0, 0);
        g.deleteRows(["1", "2"]);
        expect(g.getVisibleRows()).toHaveLength(0);
        expect(g.getFocus()).toBeUndefined();
    });

    it("deletes what the cell selection covers", () => {
        const g = grid(5);
        g.selectRange(1, 0, 2, 1);
        expect(g.deleteSelectedRows()).toBe(true);
        expect(g.getVisibleRows().map((r) => r.id)).toEqual([1, 4, 5]);
    });
});

describe("columns", () => {
    it("appends a column", () => {
        const g = grid(2);
        g.addColumns([{ key: "extra", name: "Extra", width: 60 }]);
        expect(g.getColumns().map((c) => c.key)).toEqual([
            "name",
            "score",
            "id",
            "extra",
        ]);
    });

    it("inserts at an index into getColumns()", () => {
        const g = grid(2);
        g.addColumns([{ key: "extra", name: "Extra", width: 60 }], 1);
        expect(g.getColumns().map((c) => c.key)).toEqual([
            "name",
            "extra",
            "score",
            "id",
        ]);
    });

    it("names a blank column after a key nothing else is using", () => {
        const g = grid(2);
        const added = g.addColumn();
        expect(added).toBeDefined();
        expect(g.getColumns().filter((c) => c.key === added!.key)).toHaveLength(1);
    });

    it("deletes by column key", () => {
        const g = grid(2);
        expect(g.deleteColumns(["score"])).toBe(true);
        expect(g.getColumns().map((c) => c.key)).toEqual(["name", "id"]);
    });

    it("fires the callbacks, and false cancels", () => {
        const onAddColumns = vi.fn();
        const g = grid(2, { onAddColumns, onDeleteColumns: () => false });
        const column = { key: "extra", name: "Extra" };
        g.addColumns([column], 3);
        expect(onAddColumns).toHaveBeenCalledWith({ columns: [column], index: 3 });
        expect(g.deleteColumns(["score"])).toBe(false);
        expect(g.getColumns()).toHaveLength(4);
    });

    it("never offers the grid's own checkbox column for deletion", () => {
        const g = grid(2, { selectColumn: true });
        g.selectRange(0, 0, 0, 1);
        g.model.models.structure.deleteSelectedColumns();
        // The selection covered the checkbox column and `name`; only `name` is the host's.
        expect(g.getColumns().map((c) => c.key)).toEqual(["score", "id"]);
    });
});

describe("the keyboard", () => {
    it("adds rows on ctrl+Insert, as many as are selected", () => {
        const g = grid(4);
        g.selectRange(1, 0, 2, 0);
        g.element.dispatchEvent(key({ code: "Insert", ctrlKey: true }));
        expect(g.getVisibleRows()).toHaveLength(6);
        // A blank row is `{}` plus its key: the same shape a cleared cell leaves behind.
        expect(g.getVisibleRows()[1].name).toBeUndefined();
    });

    it("deletes the selected rows on ctrl+Delete without clearing their cells first", () => {
        const onEdit = vi.fn();
        const g = grid(4, { onEdit });
        g.selectRange(1, 0, 1, 1);
        g.element.dispatchEvent(key({ code: "Delete", ctrlKey: true }));
        expect(g.getVisibleRows().map((r) => r.id)).toEqual([1, 3, 4]);
        expect(onEdit).not.toHaveBeenCalled();
    });

    it("still clears cells on a plain Delete", () => {
        const g = grid(3);
        g.selectRange(0, 0, 0, 0);
        g.element.dispatchEvent(key({ code: "Delete" }));
        expect(g.getVisibleRows()).toHaveLength(3);
        expect(g.getVisibleRows()[0].name).toBeUndefined();
    });

    it("does nothing on ctrl+Insert when the grid may not add rows", () => {
        const g = grid(3, { canAddRows: false });
        g.focusCell(0, 0);
        g.element.dispatchEvent(key({ code: "Insert", ctrlKey: true }));
        expect(g.getVisibleRows()).toHaveLength(3);
    });

    it("adds a column on ctrl+shift+Insert and deletes one on ctrl+shift+Delete", () => {
        const g = grid(2);
        g.focusCell(0, 1);
        g.element.dispatchEvent(key({ code: "Insert", ctrlKey: true, shiftKey: true }));
        expect(g.getColumns()).toHaveLength(4);
        g.focusCell(0, 1);
        g.element.dispatchEvent(key({ code: "Delete", ctrlKey: true, shiftKey: true }));
        expect(g.getColumns()).toHaveLength(3);
    });

    it("grows the grid by one row when ArrowDown runs off the end", () => {
        const g = grid(3);
        g.focusCell(2, 0);
        g.element.dispatchEvent(key({ code: "ArrowDown", key: "ArrowDown" }));
        expect(g.getVisibleRows()).toHaveLength(4);
        expect(g.getFocus()?.rowKey).toBe(String(g.getVisibleRows()[3].id));
    });

    it("offers only one blank row until it has been typed into", () => {
        const g = grid(3);
        g.focusCell(2, 0);
        g.element.dispatchEvent(key({ code: "ArrowDown", key: "ArrowDown" }));
        g.element.dispatchEvent(key({ code: "ArrowDown", key: "ArrowDown" }));
        expect(g.getVisibleRows()).toHaveLength(4);

        g.setCellValue(3, 0, "Ada");
        g.focusCell(3, 0);
        g.element.dispatchEvent(key({ code: "ArrowDown", key: "ArrowDown" }));
        expect(g.getVisibleRows()).toHaveLength(5);
    });

    it("does not grow on ArrowDown when the grid may not add rows", () => {
        const g = grid(3, { canAddRows: false });
        g.focusCell(2, 0);
        g.element.dispatchEvent(key({ code: "ArrowDown", key: "ArrowDown" }));
        expect(g.getVisibleRows()).toHaveLength(3);
    });

    it("wraps Tab off the last cell onto a new row", () => {
        const g = grid(2);
        g.focusCell(1, 2);
        g.element.dispatchEvent(key({ code: "Tab", key: "Tab" }));
        expect(g.getVisibleRows()).toHaveLength(3);
        expect(g.getFocus()?.columnKey).toBe("name");
    });

    it("takes the blank row back when the focus leaves it untouched", () => {
        const g = grid(3);
        g.focusCell(2, 0);
        g.element.dispatchEvent(key({ code: "ArrowDown", key: "ArrowDown" }));
        expect(g.getVisibleRows()).toHaveLength(4);

        g.element.dispatchEvent(key({ code: "ArrowUp", key: "ArrowUp" }));
        expect(g.getVisibleRows()).toHaveLength(3);
        expect(g.getFocus()?.rowKey).toBe("3");
    });

    it("takes it back when the focus moves anywhere else, not only up", () => {
        const g = grid(3);
        g.focusCell(2, 0);
        g.element.dispatchEvent(key({ code: "ArrowDown", key: "ArrowDown" }));
        g.focusCell(0, 1);
        expect(g.getVisibleRows()).toHaveLength(3);

        // And the mark went with it, so the next ArrowDown off the end still offers a row.
        g.focusCell(2, 0);
        g.element.dispatchEvent(key({ code: "ArrowDown", key: "ArrowDown" }));
        expect(g.getVisibleRows()).toHaveLength(4);
    });

    it("keeps it once it has been typed into", () => {
        const g = grid(3);
        g.focusCell(2, 0);
        g.element.dispatchEvent(key({ code: "ArrowDown", key: "ArrowDown" }));
        g.setCellValue(3, 0, "Ada");

        g.element.dispatchEvent(key({ code: "ArrowUp", key: "ArrowUp" }));
        expect(g.getVisibleRows()).toHaveLength(4);
        expect(g.getVisibleRows()[3].name).toBe("Ada");
    });

    it("keeps it while a range dragged off it still has it selected", () => {
        const g = grid(3);
        g.focusCell(2, 0);
        g.element.dispatchEvent(key({ code: "ArrowDown", key: "ArrowDown" }));
        // shift+ArrowUp extends the selection up off the new row without deselecting it.
        g.element.dispatchEvent(
            key({ code: "ArrowUp", key: "ArrowUp", shiftKey: true }),
        );
        expect(g.getVisibleRows()).toHaveLength(4);
    });

    it("does not manufacture rows when ArrowDown is held at the bottom", () => {
        const g = grid(3);
        g.focusCell(2, 0);
        for (let i = 0; i < 20; i++) {
            g.element.dispatchEvent(key({ code: "ArrowDown", key: "ArrowDown" }));
        }
        expect(g.getVisibleRows()).toHaveLength(4);
        g.element.dispatchEvent(key({ code: "ArrowUp", key: "ArrowUp" }));
        expect(g.getVisibleRows()).toHaveLength(3);
    });

    it("lets onDeleteRows keep the row it was asked about", () => {
        const g = grid(3, { onDeleteRows: () => false });
        g.focusCell(2, 0);
        g.element.dispatchEvent(key({ code: "ArrowDown", key: "ArrowDown" }));
        g.element.dispatchEvent(key({ code: "ArrowUp", key: "ArrowUp" }));
        expect(g.getVisibleRows()).toHaveLength(4);
    });

    it("adds a column when ctrl+ArrowRight runs off the last one", () => {
        const g = grid(2);
        g.focusCell(0, 2);
        g.element.dispatchEvent(
            key({ code: "ArrowRight", key: "ArrowRight", ctrlKey: true }),
        );
        expect(g.getColumns()).toHaveLength(4);
        expect(g.getFocus()?.columnKey).toBe(g.getColumns()[3].key);
    });
});

describe("pasting past the end", () => {
    it("grows the grid to fit the clipboard", () => {
        const g = grid(2);
        g.focusCell(1, 0);
        expect(g.pasteText("Ada\t1\nGrace\t2\nAlan\t3")).toBe(true);
        expect(g.getVisibleRows()).toHaveLength(4);
        expect(g.getVisibleRows().map((r) => r.name)).toEqual([
            "Row 1",
            "Ada",
            "Grace",
            "Alan",
        ]);
    });

    it("drops the overflow instead when the grid may not add rows", () => {
        const g = grid(2, { canAddRows: false });
        g.focusCell(1, 0);
        g.pasteText("Ada\t1\nGrace\t2\nAlan\t3");
        expect(g.getVisibleRows()).toHaveLength(2);
        expect(g.getVisibleRows()[1].name).toBe("Ada");
    });

    it("grows sideways too, when columns are allowed", () => {
        const g = grid(2);
        g.focusCell(0, 2);
        g.pasteText("a\tb\tc");
        expect(g.getColumns()).toHaveLength(5);
    });
});

describe("the add-row affordance", () => {
    it("is present only when canAddRows is on, and adds a row when clicked", () => {
        const g = grid(2, { canAddRows: false });
        expect(g.element.querySelector(".avg-add-row")).toBeNull();

        g.setOptions({ canAddRows: true, addRowLabel: "add person" });
        const button = g.element.querySelector(".avg-add-row") as HTMLElement;
        expect(button).not.toBeNull();
        expect(button.textContent).toBe("+ add person");

        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(g.getVisibleRows()).toHaveLength(3);
    });

    it("is removed again when the option goes away", () => {
        const g = grid(2);
        expect(g.element.querySelector(".avg-add-row")).not.toBeNull();
        g.setOptions({ canAddRows: false });
        expect(g.element.querySelector(".avg-add-row")).toBeNull();
    });

    it("adds a column when the header + is clicked", () => {
        const g = grid(2);
        const button = g.element.querySelector(".avg-add-column") as HTMLElement;
        expect(button).not.toBeNull();
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(g.getColumns()).toHaveLength(4);
    });
});
