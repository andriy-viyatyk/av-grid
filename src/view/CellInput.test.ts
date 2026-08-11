// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createCellInput } from "./CellInput";
import type { CellEditor, EditorContext } from "../model/EditingModel";

/**
 * Where the caret starts, which is the whole of what `EditOrigin` decides.
 *
 * happy-dom does no layout, so the click-to-position path measures zero and falls back — which is
 * itself worth pinning, since it is what a host with a hidden grid gets. The measurement is then
 * exercised against faked metrics: a `Range` whose width is ten pixels per character, which is
 * exactly what the binary search is entitled to assume about the numbers it is given.
 */

interface Row {
    name: string;
}

const editors: CellEditor[] = [];

function build(over: Partial<EditorContext<Row>> = {}): HTMLInputElement {
    const ctx: EditorContext<Row> = {
        value: "Lovelace",
        row: { name: "Lovelace" },
        column: { key: "name" } as any,
        openedBy: "key",
        setValue: vi.fn(),
        commit: vi.fn(),
        cancel: vi.fn(),
        commitAndPass: vi.fn(),
        ...over,
    };
    const editor = createCellInput(ctx);
    editors.push(editor);
    document.body.append(editor.element);
    return editor.element as HTMLInputElement;
}

/**
 * Ten pixels a character, in an input whose text starts at x=100 and ends at x=300. Applied to the
 * prototypes because the elements under test are created inside `createCellInput`.
 */
function installMetrics(): () => void {
    const rangeProto = Range.prototype as any;
    const elProto = Element.prototype as any;
    const originalRange = rangeProto.getBoundingClientRect;
    const originalEl = elProto.getBoundingClientRect;

    rangeProto.getBoundingClientRect = function (this: Range) {
        const chars = this.endOffset - this.startOffset;
        return { width: chars * 10, height: 16, top: 0, bottom: 16, left: 0, right: chars * 10 };
    };
    elProto.getBoundingClientRect = function (this: Element) {
        if ((this as HTMLElement).tagName === "INPUT") {
            return { width: 200, height: 20, top: 0, bottom: 20, left: 100, right: 300 };
        }
        return { width: 0, height: 0, top: 0, bottom: 0, left: 0, right: 0 };
    };

    return () => {
        rangeProto.getBoundingClientRect = originalRange;
        elProto.getBoundingClientRect = originalEl;
    };
}

afterEach(() => {
    editors.splice(0).forEach((e) => e.destroy?.());
    document.body.innerHTML = "";
});

describe("where the caret starts", () => {
    it("selects the whole value when opened by Enter, F2 or startEdit()", () => {
        const input = build({ openedBy: "key" });
        editors[0].focus();

        expect(input.selectionStart).toBe(0);
        expect(input.selectionEnd).toBe("Lovelace".length);
    });

    it("puts the caret after the typed character, selecting nothing", () => {
        const input = build({ openedBy: "typing", value: "L" });
        editors[0].focus();

        expect(input.value).toBe("L");
        expect(input.selectionStart).toBe(1);
        expect(input.selectionEnd).toBe(1);
    });

    it("selects nothing on a click, even where the position cannot be measured", () => {
        const input = build({ openedBy: "pointer", pointerX: 140 });
        editors[0].focus();

        // No layout: the end of the text, which is the fallback, and never a selection.
        expect(input.selectionStart).toBe("Lovelace".length);
        expect(input.selectionEnd).toBe("Lovelace".length);
    });

    it("falls back to the end when the press carried no coordinate", () => {
        const input = build({ openedBy: "pointer" });
        editors[0].focus();

        expect(input.selectionStart).toBe("Lovelace".length);
    });
});

describe("clicking into the text", () => {
    let restore: () => void = () => {};

    afterEach(() => restore());

    it("lands on the boundary nearest the click", () => {
        restore = installMetrics();
        const input = build({ openedBy: "pointer", pointerX: 100 + 34 });
        editors[0].focus();

        // 34px in at 10px a character: past "Lov", and nearer the boundary after it than before.
        expect(input.selectionStart).toBe(3);
        expect(input.selectionEnd).toBe(3);
    });

    it("rounds to the far side of the glyph the click is past the middle of", () => {
        restore = installMetrics();
        build({ openedBy: "pointer", pointerX: 100 + 36 });
        const input = document.querySelector("input")!;
        editors[0].focus();

        expect(input.selectionStart).toBe(4);
    });

    it("clamps to the ends", () => {
        restore = installMetrics();
        const before = build({ openedBy: "pointer", pointerX: 40 });
        editors[0].focus();
        expect(before.selectionStart).toBe(0);

        const after = build({ openedBy: "pointer", pointerX: 280 });
        editors[1].focus();
        expect(after.selectionStart).toBe("Lovelace".length);
    });

    it("measures from the right edge in a right-aligned column", () => {
        restore = installMetrics();
        const input = build({ openedBy: "pointer", pointerX: 240 });
        // A numeric column is right-aligned, so the text ends at the input's right edge and
        // begins at 300 - 80 = 220 rather than at 100.
        input.style.textAlign = "right";
        editors[0].focus();

        expect(input.selectionStart).toBe(2);
    });

    it("puts an empty cell's caret at 0 without measuring anything", () => {
        restore = installMetrics();
        const input = build({ openedBy: "pointer", pointerX: 250, value: "" });
        editors[0].focus();

        expect(input.selectionStart).toBe(0);
    });

    it("leaves no measuring element behind", () => {
        restore = installMetrics();
        build({ openedBy: "pointer", pointerX: 150 });
        editors[0].focus();

        expect(document.querySelectorAll("span")).toHaveLength(0);
    });
});
