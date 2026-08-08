// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { AVGrid } from "../AVGrid";
import type { AVGridOptions } from "../options";
import type { RerenderInfo } from "../render/types";

/**
 * Clipboard copy, cut and paste.
 *
 * The claim this file has to make good on is a round trip: text the grid copies must come back
 * into the same cells when pasted, *including* a value containing a tab, a newline or a quote —
 * which is the whole reason the clipboard format is quoted CSV rather than raw joins.
 *
 * happy-dom has no real clipboard, so the two ends are tested where they are actually
 * reachable: `selectionText` produces the string, `pasteText` consumes one, and the native
 * `copy`/`cut`/`paste` events are dispatched with a hand-built `clipboardData`. Whether Excel
 * agrees is a question for a real browser and is checked on the board.
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
    note: string;
}

function rows(count: number): Row[] {
    return Array.from({ length: count }, (_, i) => ({
        id: i + 1,
        name: `Row ${i + 1}`,
        score: (i + 1) * 10,
        note: `note ${i + 1}`,
    }));
}

const grids: AVGrid<any>[] = [];

/** Columns: 0 name, 1 score (number), 2 note, 3 id (readonly). */
function grid(count = 10, extra: Partial<AVGridOptions<Row>> = {}): AVGrid<Row> {
    const host = document.createElement("div");
    document.body.append(host);
    const g = withLayout(() =>
        AVGrid.create<Row>(host, {
            rows: rows(count),
            columns: [
                { key: "name", name: "Name", width: 120 },
                { key: "score", name: "Score", width: 80, dataType: "number" },
                { key: "note", name: "Note", width: 140 },
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

/**
 * A clipboard event with a working `clipboardData`. happy-dom supplies neither `ClipboardEvent`
 * nor `DataTransfer`, and the two methods the grid uses are the whole interface.
 */
function clipboardEvent(
    type: "copy" | "cut" | "paste",
    text?: string,
): ClipboardEvent & { written: Map<string, string> } {
    const written = new Map<string, string>();
    if (text !== undefined) written.set("text/plain", text);

    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(e, {
        clipboardData: {
            value: {
                setData: (format: string, value: string) => {
                    written.set(format, value);
                },
                getData: (format: string) => written.get(format) ?? "",
            },
        },
        written: { value: written },
    });
    return e as ClipboardEvent & { written: Map<string, string> };
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

afterEach(() => {
    while (grids.length) grids.pop()?.destroy();
    document.body.textContent = "";
});

describe("copying", () => {
    it("copies one cell as its bare text, with no quoting or newline", () => {
        const g = grid();
        g.focusCell(2, 0);
        expect(g.getSelectionText()).toBe("Row 3");
    });

    it("copies a range as tab-separated rows", () => {
        const g = grid();
        g.selectRange(0, 0, 1, 1);
        expect(g.getSelectionText()).toBe("Row 1\t10\nRow 2\t20\n");
    });

    it("adds the column names on request", () => {
        const g = grid();
        g.selectRange(0, 0, 1, 1);
        expect(g.getSelectionText("copyWithHeaders")).toBe(
            "Name\tScore\nRow 1\t10\nRow 2\t20\n",
        );
    });

    it("quotes a value containing a tab, a newline or a quote", () => {
        const g = grid();
        g.getRows()[0].note = 'a\tb\nc"d';
        g.selectRange(0, 2, 1, 2);
        expect(g.getSelectionText()).toBe('"a\tb\nc""d"\nnote 2\n');
    });

    it("copies the displayed value, not the raw one", () => {
        const g = grid(3, {
            columns: [
                {
                    key: "score",
                    name: "Score",
                    formatValue: (_c, r) => `${r.score}%`,
                },
            ],
        });
        g.selectRange(0, 0, 1, 0);
        expect(g.getSelectionText()).toBe("10%\n20%\n");
    });

    it("keeps two columns that share a name as two columns", () => {
        const g = grid(3, {
            columns: [
                { key: "name", name: "Label", width: 100 },
                { key: "note", name: "Label", width: 100 },
            ],
        });
        g.selectRange(0, 0, 0, 1);
        expect(g.getSelectionText("copyWithHeaders")).toBe(
            "Label\tLabel\nRow 1\tnote 1\n",
        );
    });

    it("leaves the checkbox column out", () => {
        const g = grid(3, { selectColumn: true });
        // ctrl+A selects every column, the grid's own included.
        g.element.dispatchEvent(
            new KeyboardEvent("keydown", { bubbles: true, code: "KeyA", ctrlKey: true }),
        );
        expect(g.getSelectionText()).toBe(
            "Row 1\t10\tnote 1\t1\nRow 2\t20\tnote 2\t2\nRow 3\t30\tnote 3\t3\n",
        );
    });

    it("copies as JSON, keyed by column key", () => {
        const g = grid();
        g.selectRange(0, 0, 0, 1);
        expect(JSON.parse(g.getSelectionText("copyAsJson"))).toEqual([
            { name: "Row 1", score: 10 },
        ]);
    });

    it("copies as an HTML table, escaping the values", () => {
        const g = grid();
        g.getRows()[0].note = "<b>&</b>";
        g.selectRange(0, 2, 0, 2);
        const html = g.model.models.copyPaste.selectionHtml();
        expect(html).toContain("<table");
        expect(html).toContain("&lt;b&gt;&amp;&lt;/b&gt;");
    });

    it("returns nothing when nothing is selected", () => {
        const g = grid();
        expect(g.getSelectionText()).toBe("");
    });
});

describe("the native clipboard events", () => {
    it("fills a copy event and takes it over", () => {
        const g = grid();
        g.selectRange(0, 0, 1, 1);

        const e = clipboardEvent("copy");
        g.element.dispatchEvent(e);

        expect(e.written.get("text/plain")).toBe("Row 1\t10\nRow 2\t20\n");
        expect(e.defaultPrevented).toBe(true);
    });

    it("leaves a copy event alone when nothing is selected", () => {
        const g = grid();
        const e = clipboardEvent("copy");
        g.element.dispatchEvent(e);
        expect(e.defaultPrevented).toBe(false);
    });

    it("ignores a copy raised inside the cell editor", async () => {
        const g = grid();
        g.focusCell(0, 0);
        g.startEdit(0, 0);
        g.render.model.updateRenderInfo();
        await new Promise((r) => requestAnimationFrame(r));

        const input = g.element.querySelector('input[data-type="cell-editor"]');
        expect(input).not.toBeNull();

        const e = clipboardEvent("copy");
        input!.dispatchEvent(e);
        // The text selected inside the input is the browser's to copy, not the grid's.
        expect(e.written.size).toBe(0);
        expect(e.defaultPrevented).toBe(false);
    });

    it("pastes from a paste event", () => {
        const g = grid();
        g.selectRange(0, 0, 1, 1);
        g.element.dispatchEvent(clipboardEvent("paste", "Ada\t36\nGrace\t45\n"));

        expect(g.getRows()[0].name).toBe("Ada");
        expect(g.getRows()[0].score).toBe(36);
        expect(g.getRows()[1].name).toBe("Grace");
        expect(g.getRows()[1].score).toBe(45);
    });

    it("cuts: copies, then clears the cells", () => {
        const g = grid();
        g.selectRange(0, 0, 0, 0);

        const e = clipboardEvent("cut");
        g.element.dispatchEvent(e);

        expect(e.written.get("text/plain")).toBe("Row 1");
        expect(g.getRows()[0].name).toBe(undefined);
    });

    it("does nothing at all when the clipboard is disabled", () => {
        const g = grid(10, { disableClipboard: true });
        g.selectRange(0, 0, 1, 1);

        const copy = clipboardEvent("copy");
        g.element.dispatchEvent(copy);
        expect(copy.defaultPrevented).toBe(false);

        g.element.dispatchEvent(clipboardEvent("paste", "Ada\t36\n"));
        expect(g.getRows()[0].name).toBe("Row 1");
    });
});

describe("pasting", () => {
    it("expands a single selected cell to fit, and selects what landed", () => {
        const g = grid();
        g.focusCell(1, 0);
        expect(g.pasteText("Ada\t36\nGrace\t45\n")).toBe(true);

        expect(g.getRows()[1].name).toBe("Ada");
        expect(g.getRows()[2].score).toBe(45);
        expect(g.getSelection()?.rowRange).toEqual([1, 2]);
        expect(g.getSelection()?.colRange).toEqual([0, 1]);
    });

    it("clamps an expansion to the rows that exist", () => {
        const g = grid(3);
        g.focusCell(2, 0);
        g.pasteText("a\nb\nc\n");

        expect(g.getRows()[2].name).toBe("a");
        expect(g.getVisibleRows()).toHaveLength(3);
    });

    it("repeats a small clipboard across a larger selection", () => {
        const g = grid();
        g.selectRange(0, 0, 2, 0);
        g.pasteText("same");

        expect(g.getRows().slice(0, 3).map((r) => r.name)).toEqual([
            "same",
            "same",
            "same",
        ]);
    });

    it("skips a readonly column and writes the rest", () => {
        const g = grid();
        // Columns 2 and 3 — note, then the readonly id.
        g.selectRange(0, 2, 0, 3);
        g.pasteText("hello\t999");

        expect(g.getRows()[0].note).toBe("hello");
        expect(g.getRows()[0].id).toBe(1);
    });

    it("runs each cell through validate and onEdit", () => {
        const edits: string[] = [];
        const g = grid(10, {
            onEdit: (e) => {
                edits.push(`${e.columnKey}:${e.value}`);
            },
        });
        g.selectRange(0, 0, 1, 1);
        g.pasteText("Ada\t36\nGrace\tnope\n");

        // "nope" is not a number, so the number column takes null rather than the string.
        expect(edits).toEqual([
            "name:Ada",
            "score:36",
            "name:Grace",
            "score:null",
        ]);
    });

    it("lets onEdit reject a cell without stopping the paste", () => {
        const g = grid(10, { onEdit: (e) => e.columnKey !== "score" });
        g.selectRange(0, 0, 0, 1);
        g.pasteText("Ada\t36");

        expect(g.getRows()[0].name).toBe("Ada");
        expect(g.getRows()[0].score).toBe(10);
    });

    it("marks the viewport once, not a cell per pasted row", () => {
        const g = grid(1000);
        g.selectRange(0, 0, 999, 1);

        const dirty = captureDirty(g, () => {
            g.pasteText("Ada\t36\n");
        });

        expect(dirty).toHaveLength(1);
        expect(dirty[0]).toEqual({ all: true });
    });

    it("does nothing without a selection", () => {
        const g = grid();
        expect(g.pasteText("Ada")).toBe(false);
    });

    it("does nothing on a grid that is not editable", () => {
        const g = grid(10, { editable: false });
        g.selectRange(0, 0, 0, 1);
        expect(g.pasteText("Ada\t36")).toBe(false);
        expect(g.getRows()[0].name).toBe("Row 1");
    });
});

describe("the round trip", () => {
    it("brings a value containing tabs, newlines and quotes back intact", () => {
        const g = grid();
        g.getRows()[0].note = 'has\ta tab\nand a newline and a "quote"';
        g.getRows()[1].note = "plain";
        g.refresh();

        g.selectRange(0, 2, 1, 2);
        const copied = g.getSelectionText();

        // Paste it four rows down, into the same column.
        g.focusCell(4, 2);
        expect(g.pasteText(copied)).toBe(true);

        expect(g.getRows()[4].note).toBe(g.getRows()[0].note);
        expect(g.getRows()[5].note).toBe("plain");
        expect(g.getSelection()?.rowRange).toEqual([4, 5]);
    });

    it("round-trips a whole multi-column block", () => {
        const g = grid();
        g.selectRange(0, 0, 2, 2);
        const copied = g.getSelectionText();

        g.focusCell(5, 0);
        g.pasteText(copied);

        expect(g.getRows().slice(5, 8).map((r) => [r.name, r.score, r.note])).toEqual([
            ["Row 1", 10, "note 1"],
            ["Row 2", 20, "note 2"],
            ["Row 3", 30, "note 3"],
        ]);
    });
});
