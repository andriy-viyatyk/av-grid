// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createCellSelect } from "./CellSelect";
import type { EditorContext, MountedCellEditor } from "../types";

/**
 * The dropdown editor, driven through the editor contract rather than through a whole grid —
 * `EditingModel.test.ts` covers the grid end of it.
 *
 * happy-dom does no layout, so the list inside the popover would measure a zero viewport and
 * render nothing; every element created while the editor is being opened is given a size, the
 * same trick the other view suites use. What that leaves checkable is behaviour: what the
 * popover contains, what a pick writes, and what a dismissal does *not* write.
 */

interface Row {
    status: any;
}

function installLayout(): () => void {
    const originalCreate = document.createElement.bind(document);
    document.createElement = ((tag: string) => {
        const el = originalCreate(tag) as HTMLElement;
        Object.defineProperties(el, {
            offsetWidth: { value: 300, configurable: true },
            offsetHeight: { value: 200, configurable: true },
            clientWidth: { value: 300, configurable: true },
            clientHeight: { value: 200, configurable: true },
        });
        return el;
    }) as typeof document.createElement;
    return () => {
        document.createElement = originalCreate;
    };
}

interface Harness {
    editor: MountedCellEditor;
    ctx: EditorContext<Row>;
    setValue: ReturnType<typeof vi.fn>;
    commit: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    commitAndPass: ReturnType<typeof vi.fn>;
}

const editors: MountedCellEditor[] = [];

/** Build the editor, mount it, and open it — which is what `editorMounted` does in the grid. */
async function open(over: Partial<EditorContext<Row>> = {}): Promise<Harness> {
    const setValue = vi.fn();
    const commit = vi.fn();
    const cancel = vi.fn();
    const commitAndPass = vi.fn();

    const ctx: EditorContext<Row> = {
        value: "open",
        row: { status: "open" },
        column: { key: "status", options: ["open", "pending", "closed"] } as any,
        rowIndex: 0,
        colIndex: 0,
        rowKey: "1",
        openedBy: "key",
        setValue,
        commit,
        cancel,
        commitAndPass,
        ...over,
    };

    const restore = installLayout();
    let editor: MountedCellEditor;
    try {
        editor = createCellSelect(ctx);
        document.body.appendChild(editor.element);
        editor.focus();
        // The list paints its rows on the frame after `setItems`.
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    } finally {
        restore();
    }

    editors.push(editor);
    return { editor, ctx, setValue, commit, cancel, commitAndPass };
}

const popover = (): HTMLElement | null =>
    document.querySelector(".avg-cell-select-popover");

const rows = (): HTMLElement[] =>
    Array.from(
        document.querySelectorAll<HTMLElement>(
            ".avg-cell-select-popover .avg-list-item[data-index]",
        ),
    ).sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index));

const labels = (): string[] => rows().map((r) => r.textContent ?? "");

const searchBox = (): HTMLInputElement =>
    document.querySelector(".avg-cell-select-popover .avg-list-search") as HTMLInputElement;

const click = (el: Element): void => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
};

afterEach(() => {
    editors.splice(0).forEach((e) => e.destroy?.());
    document.body.innerHTML = "";
});

describe("the closed editor", () => {
    it("fills the cell with the current value and a caret", async () => {
        const { editor } = await open();
        expect(editor.element.className).toContain("avg-cell-editor");
        expect(editor.element.getAttribute("data-type")).toBe("cell-editor");
        expect(
            editor.element.querySelector(".avg-cell-select-value")!.textContent,
        ).toBe("open");
        expect(editor.element.querySelector(".avg-cell-select-caret > svg")).not.toBeNull();
    });

    it("shows nothing rather than the word undefined for an empty cell", async () => {
        const { editor } = await open({ value: undefined, row: { status: undefined } });
        expect(
            editor.element.querySelector(".avg-cell-select-value")!.textContent,
        ).toBe("");
    });
});

describe("the list", () => {
    it("opens against the editor, carrying the column's choices", async () => {
        await open();
        expect(popover()).not.toBeNull();
        expect(labels()).toEqual(["open", "pending", "closed"]);
    });

    it("marks the current value as selected", async () => {
        await open({ value: "pending", row: { status: "pending" } });
        const selected = rows().filter((r) => r.hasAttribute("data-selected"));
        expect(selected.map((r) => r.textContent)).toEqual(["pending"]);
    });

    it("offers the cell's own value when it is not one of the choices", async () => {
        await open({ value: "archived", row: { status: "archived" } });
        expect(labels()).toEqual(["archived", "open", "pending", "closed"]);
    });

    it("fills in from a function", async () => {
        await open({
            value: "a",
            row: { status: "a" },
            column: { key: "status", options: () => ["a", "b"] } as any,
        });
        expect(labels()).toEqual(["a", "b"]);
    });

    it("fills in from a promise, and stays open while it resolves", async () => {
        const options = Promise.resolve(["a", "b", "c"]);
        await open({ column: { key: "status", options: () => options } as any });
        expect(popover()).not.toBeNull();

        await options;
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
        expect(labels()).toEqual(["open", "a", "b", "c"]);
    });

    it("survives a provider that rejects", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const failed = Promise.reject(new Error("no"));
        await open({ column: { key: "status", options: () => failed } as any });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(popover()).not.toBeNull();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});

describe("picking", () => {
    it("writes the value and commits, in one click", async () => {
        const { setValue, commit } = await open();
        click(rows()[2]);

        expect(setValue).toHaveBeenCalledWith("closed");
        expect(commit).toHaveBeenCalledTimes(1);
    });

    it("closes the popover on the way out", async () => {
        await open();
        click(rows()[1]);
        expect(popover()).toBeNull();
    });

    it("keeps a non-string option's type, which a native select could not", async () => {
        const { setValue } = await open({
            value: 10,
            row: { status: 10 },
            column: { key: "status", options: [10, 20, 30] } as any,
        });
        click(rows()[1]);

        expect(setValue).toHaveBeenCalledWith(20);
        expect(setValue.mock.calls[0][0]).toBeTypeOf("number");
    });

    it("commits the highlighted option on Tab, and hands the key back", async () => {
        const { setValue, commitAndPass } = await open();
        rows()[0].dispatchEvent(
            new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
        );

        expect(setValue).toHaveBeenCalledWith("open");
        expect(commitAndPass).toHaveBeenCalledTimes(1);
        expect(popover()).toBeNull();
    });
});

describe("dismissal", () => {
    it("cancels on Escape rather than committing", async () => {
        const { cancel, commit } = await open();
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await Promise.resolve();

        expect(cancel).toHaveBeenCalledTimes(1);
        expect(commit).not.toHaveBeenCalled();
        expect(popover()).toBeNull();
    });

    it("cancels on a pointer landing somewhere else", async () => {
        const { cancel } = await open();
        const elsewhere = document.createElement("div");
        document.body.appendChild(elsewhere);
        elsewhere.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        await Promise.resolve();

        expect(cancel).toHaveBeenCalledTimes(1);
    });

    it("does not cancel after a pick", async () => {
        const { cancel } = await open();
        click(rows()[1]);
        await Promise.resolve();
        expect(cancel).not.toHaveBeenCalled();
    });
});

describe("type-to-edit", () => {
    it("seeds the search box, and leaves the cell's value alone", async () => {
        const { editor } = await open({
            value: "c",
            openedBy: "typing",
            row: { status: "open" },
        });

        expect(searchBox().value).toBe("c");
        expect(labels()).toEqual(["closed"]);
        expect(
            editor.element.querySelector(".avg-cell-select-value")!.textContent,
        ).toBe("open");
    });

    it("cancels when dismissed, so the typed character is never written", async () => {
        const { cancel, commit } = await open({
            value: "p",
            openedBy: "typing",
            row: { status: "closed" },
        });
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await Promise.resolve();

        expect(cancel).toHaveBeenCalledTimes(1);
        expect(commit).not.toHaveBeenCalled();
    });
});

describe("teardown", () => {
    it("takes the popover with it — it is outside the grid's own DOM", async () => {
        const { editor } = await open();
        expect(popover()).not.toBeNull();

        editor.destroy!();
        expect(popover()).toBeNull();
        expect(editor.element.isConnected).toBe(false);
    });

    it("does not cancel the edit it is being torn down for", async () => {
        const { editor, cancel } = await open();
        editor.destroy!();
        await Promise.resolve();
        expect(cancel).not.toHaveBeenCalled();
    });
});
