// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createCellSelect } from "./CellSelect";
import type { EditorContext, MountedCellEditor } from "../types";

/**
 * The options editor, driven through the editor contract rather than through a whole grid —
 * `EditingModel.test.ts` covers the grid end of it.
 *
 * happy-dom does no layout, so the list inside the popover would measure a zero viewport and
 * render nothing; every element created while the editor is being opened is given a size, the
 * same trick the other view suites use. What that leaves checkable is behaviour: what the input
 * and the list show, what a commit writes, and what leaving does *not* write. Whether the caret
 * lands under the pointer, and whether the list's scrollbar still drags, are board questions.
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

const frame = (): Promise<void> =>
    new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

/** Lets a settled promise's `then` run, then the list paint it caused. */
async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const restore = installLayout();
    try {
        await frame();
        await frame();
    } finally {
        restore();
    }
}

/** Build the editor, mount it, and open it — which is what `editorMounted` does in the grid. */
async function open(
    over: Partial<EditorContext<Row>> = {},
    host: HTMLElement = document.body,
): Promise<Harness> {
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
        host.appendChild(editor.element);
        editor.focus!();
        // The list paints its rows on the frame after `setItems`.
        await frame();
        await frame();
    } finally {
        restore();
    }

    editors.push(editor);
    return { editor, ctx, setValue, commit, cancel, commitAndPass };
}

const freeColumn = (options: any = ["open", "pending", "closed"]) =>
    ({ key: "status", options, freeText: true }) as any;

const popover = (): HTMLElement | null => document.querySelector(".avg-cell-select-popover");

const rows = (): HTMLElement[] =>
    Array.from(
        document.querySelectorAll<HTMLElement>(
            ".avg-cell-select-popover .avg-list-item[data-index]",
        ),
    ).sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index));

const labels = (): string[] => rows().map((r) => r.textContent ?? "");

const active = (): string | undefined =>
    rows().find((r) => r.hasAttribute("data-active"))?.textContent ?? undefined;

const input = (): HTMLInputElement =>
    document.querySelector<HTMLInputElement>(".avg-cell-select-input")!;

/** Type into the cell — replacing its text, as a user would after selecting it. */
async function type(text: string): Promise<void> {
    const restore = installLayout();
    try {
        input().value = text;
        input().setSelectionRange(text.length, text.length);
        input().dispatchEvent(new Event("input", { bubbles: true }));
        await frame();
        await frame();
    } finally {
        restore();
    }
}

async function press(key: string, init: KeyboardEventInit = {}): Promise<KeyboardEvent> {
    const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    const restore = installLayout();
    try {
        input().dispatchEvent(e);
        await frame();
    } finally {
        restore();
    }
    return e;
}

const click = (el: Element): void => {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
};

/** Focus somewhere else on the page, which blurs the input for real. */
function focusElsewhere(): HTMLElement {
    const other = document.createElement("input");
    document.body.appendChild(other);
    other.focus();
    return other;
}

afterEach(() => {
    editors.splice(0).forEach((e) => e.destroy?.());
    document.body.innerHTML = "";
});

describe("the editor in the cell", () => {
    it("is an input holding the current value, plus the caret", async () => {
        const { editor } = await open();
        expect(editor.element.className).toContain("avg-cell-editor");
        expect(editor.element.className).toContain("avg-cell-select");
        expect(editor.element.getAttribute("data-type")).toBe("cell-editor");
        expect(input().tagName).toBe("INPUT");
        expect(input().value).toBe("open");
        expect(editor.element.contains(input())).toBe(true);
        expect(editor.element.querySelector(".avg-cell-select-caret > svg")).not.toBeNull();
        // The old closed-state span is gone from the DOM contract.
        expect(editor.element.querySelector(".avg-cell-select-value")).toBeNull();
    });

    it("shows nothing rather than the word undefined for an empty cell", async () => {
        await open({ value: undefined, row: { status: undefined } });
        expect(input().value).toBe("");
    });

    it("keeps the focus in the input, and has no search box in the popup", async () => {
        await open();
        expect(document.activeElement).toBe(input());
        expect(popover()).not.toBeNull();
        expect(document.querySelector(".avg-cell-select-popover .avg-list-search")).toBeNull();
    });
});

describe("opening", () => {
    it("by key: the value selected, every option listed, the current one highlighted", async () => {
        await open({ value: "pending", row: { status: "pending" } });
        expect(input().selectionStart).toBe(0);
        expect(input().selectionEnd).toBe("pending".length);
        expect(labels()).toEqual(["open", "pending", "closed"]);
        expect(active()).toBe("pending");
        const selected = rows().filter((r) => r.hasAttribute("data-selected"));
        expect(selected.map((r) => r.textContent)).toEqual(["pending"]);
    });

    it("by pointer: the same list, and a caret rather than a selection", async () => {
        await open({ openedBy: "pointer", pointerX: 5 });
        // happy-dom has no layout, so the caret falls back to the end of the text.
        expect(input().selectionStart).toBe(4);
        expect(input().selectionEnd).toBe(4);
        expect(labels()).toEqual(["open", "pending", "closed"]);
        expect(active()).toBe("open");
    });

    it("by typing: the character replaces the text and narrows the list", async () => {
        await open({ value: "c", openedBy: "typing", row: { status: "open" } });
        expect(input().value).toBe("c");
        expect(input().selectionStart).toBe(1);
        expect(labels()).toEqual(["closed"]);
        expect(active()).toBe("closed");
    });

    it("filters case-insensitively, on any part of the label", async () => {
        await open();
        await type("EN");
        expect(labels()).toEqual(["open", "pending"]);
    });

    it("offers the cell's own value first when it is not one of the choices", async () => {
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

    it("sizes the popover to its rows", async () => {
        await open();
        const content = document.querySelector<HTMLElement>(
            ".avg-cell-select-popover .avg-popover-content",
        )!;
        expect(content.style.height).toBe(`${12 + 3 * 24}px`);
    });
});

describe("strict (the default)", () => {
    it("highlights the first match after each keystroke", async () => {
        await open();
        await type("pe");
        expect(labels()).toEqual(["open", "pending"]);
        expect(active()).toBe("open");
    });

    it("ranks an exact match over the first, case-sensitive over not", async () => {
        const column = { key: "status", options: ["apple pie", "Apple", "apple"] } as any;
        await open({ value: "apple pie", row: { status: "apple pie" }, column });

        await type("app");
        expect(active()).toBe("apple pie");
        await type("apple");
        expect(active()).toBe("apple");
        await type("APPLE");
        expect(active()).toBe("Apple");
    });

    it("commits the highlighted option on Enter, without moving", async () => {
        const { setValue, commit, commitAndPass } = await open();
        await type("clo");
        await press("Enter");
        expect(setValue).toHaveBeenCalledWith("closed");
        expect(commit).toHaveBeenCalledTimes(1);
        expect(commitAndPass).not.toHaveBeenCalled();
    });

    it("commits the highlighted option on Tab, and hands the key back to move", async () => {
        const { setValue, commit, commitAndPass } = await open();
        await type("pend");
        const e = await press("Tab");
        expect(setValue).toHaveBeenCalledWith("pending");
        expect(commitAndPass).toHaveBeenCalledTimes(1);
        expect(commitAndPass.mock.calls[0][0]).toBe(e);
        expect(commit).not.toHaveBeenCalled();
    });

    it("does nothing on Enter when the text matches no option — the editor stays open", async () => {
        const { setValue, commit, cancel } = await open();
        await type("zzz");
        await press("Enter");
        expect(setValue).not.toHaveBeenCalled();
        expect(commit).not.toHaveBeenCalled();
        expect(cancel).not.toHaveBeenCalled();
        expect(popover()).not.toBeNull();
        expect(input().getAttribute("aria-invalid")).toBe("true");
        const empty = document.querySelector<HTMLElement>(".avg-cell-select-popover .avg-list-empty")!;
        expect(empty.style.display).toBe("");
        expect(empty.textContent).toBe("no matching options");

        await type("clo");
        expect(input().hasAttribute("aria-invalid")).toBe(false);
    });

    it("cancels and moves on Tab when the text matches no option", async () => {
        const { setValue, cancel, commitAndPass } = await open();
        await type("zzz");
        await press("Tab");
        expect(setValue).not.toHaveBeenCalled();
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(commitAndPass).toHaveBeenCalledTimes(1);
    });

    it("clears the cell on Enter with the text emptied", async () => {
        const { setValue, commit } = await open();
        await type("");
        expect(active()).toBeUndefined();
        await press("Enter");
        expect(setValue).toHaveBeenCalledWith("");
        expect(commit).toHaveBeenCalledTimes(1);
    });

    it("keeps the cell as it was when its own value is committed", async () => {
        const { setValue, cancel } = await open();
        await press("Enter");
        expect(setValue).not.toHaveBeenCalled();
        expect(cancel).toHaveBeenCalledTimes(1);
    });

    it("moves the highlight with the arrows, leaving the text alone", async () => {
        await open();
        await press("ArrowDown");
        expect(active()).toBe("pending");
        expect(input().value).toBe("open");
        await press("ArrowDown");
        await press("ArrowDown");
        expect(active()).toBe("closed");
        await press("ArrowUp");
        await press("ArrowUp");
        await press("ArrowUp");
        expect(active()).toBe("open");
    });

    it("keeps a non-string option's type, on a click and when typed by name", async () => {
        const column = { key: "status", options: [10, 20, 30] } as any;
        const first = await open({ value: 10, row: { status: 10 }, column });
        click(rows()[1]);
        expect(first.setValue).toHaveBeenCalledWith(20);
        first.editor.destroy!();
        document.body.innerHTML = "";

        const second = await open({ value: 10, row: { status: 10 }, column });
        await type("30");
        focusElsewhere();
        expect(second.setValue).toHaveBeenCalledWith(30);
        expect(second.setValue.mock.calls[0][0]).toBeTypeOf("number");
    });
});

describe("strict — leaving the cell", () => {
    it("cancels when the text is only a prefix — never auto-picks on the way out", async () => {
        const { setValue, commit, cancel } = await open();
        await type("clo");
        focusElsewhere();
        expect(setValue).not.toHaveBeenCalled();
        expect(commit).not.toHaveBeenCalled();
        expect(cancel).toHaveBeenCalledTimes(1);
    });

    it("commits text that names an option exactly, ignoring case and spaces", async () => {
        const { setValue, commit } = await open();
        await type(" CLOSED ");
        focusElsewhere();
        expect(setValue).toHaveBeenCalledWith("closed");
        expect(commit).toHaveBeenCalledTimes(1);
    });

    it("keeps the value when the text is unchanged", async () => {
        const { setValue, cancel } = await open();
        focusElsewhere();
        expect(setValue).not.toHaveBeenCalled();
        expect(cancel).toHaveBeenCalledTimes(1);
    });

    it("applies the same rule to a press outside, before the press acts", async () => {
        const { setValue, cancel } = await open();
        await type("clo");
        const elsewhere = document.createElement("div");
        document.body.appendChild(elsewhere);
        elsewhere.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        expect(setValue).not.toHaveBeenCalled();
        expect(cancel).toHaveBeenCalledTimes(1);
    });

    it("ignores a blur that leaves the input the active element — the window lost focus", async () => {
        const { commit, cancel } = await open();
        input().dispatchEvent(new FocusEvent("blur"));
        expect(commit).not.toHaveBeenCalled();
        expect(cancel).not.toHaveBeenCalled();
    });

    it("cancels, never writes the typed character, when typing opened it and it is left", async () => {
        const { setValue, commit, cancel } = await open({
            value: "p",
            openedBy: "typing",
            row: { status: "closed" },
        });
        focusElsewhere();
        expect(setValue).not.toHaveBeenCalled();
        expect(commit).not.toHaveBeenCalled();
        expect(cancel).toHaveBeenCalledTimes(1);
    });
});

describe("suggest (freeText: true)", () => {
    it("starts with the current value highlighted, and the first keystroke clears it", async () => {
        await open({ column: freeColumn() });
        expect(active()).toBe("open");
        await type("o");
        expect(labels()).toEqual(["open", "closed"]);
        expect(active()).toBeUndefined();
        expect(input().hasAttribute("aria-activedescendant")).toBe(false);
    });

    it("commits the text exactly as typed on Enter", async () => {
        const { setValue, commit } = await open({ column: freeColumn() });
        await type("  On hold ");
        await press("Enter");
        expect(setValue).toHaveBeenCalledWith("  On hold ");
        expect(commit).toHaveBeenCalledTimes(1);
    });

    it("commits the option the text names, ignoring case", async () => {
        const { setValue } = await open({ column: freeColumn() });
        await type("CLOSED");
        await press("Enter");
        expect(setValue).toHaveBeenCalledWith("closed");
    });

    it("↓ from nothing picks the first suggestion, ↑ from the first goes back to the text", async () => {
        const { setValue } = await open({ column: freeColumn() });
        await type("en");
        await press("ArrowDown");
        expect(active()).toBe("open");
        await press("ArrowDown");
        expect(active()).toBe("pending");
        await press("ArrowUp");
        await press("ArrowUp");
        expect(active()).toBeUndefined();
        expect(input().value).toBe("en");
        await press("Enter");
        expect(setValue).toHaveBeenCalledWith("en");
    });

    it("commits an arrowed-to suggestion, keeping its type", async () => {
        const { setValue, commitAndPass } = await open({
            value: 10,
            row: { status: 10 },
            column: freeColumn([10, 20, 30]),
        });
        await type("");
        await press("ArrowDown");
        await press("ArrowDown");
        await press("Tab");
        expect(setValue).toHaveBeenCalledWith(20);
        expect(commitAndPass).toHaveBeenCalledTimes(1);
    });

    it("does not offer the cell's own value as a suggestion", async () => {
        await open({ value: "on hold", row: { status: "on hold" }, column: freeColumn() });
        expect(labels()).toEqual(["open", "pending", "closed"]);
        expect(active()).toBeUndefined();
    });

    it("hides the popup when nothing matches, and is a plain text box", async () => {
        const { setValue } = await open({ column: freeColumn() });
        await type("zzz");
        expect(popover()!.style.display).toBe("none");
        expect(input().getAttribute("aria-expanded")).toBe("false");
        expect(input().hasAttribute("aria-invalid")).toBe(false);

        await type("pe");
        expect(popover()!.style.display).toBe("");
        expect(input().getAttribute("aria-expanded")).toBe("true");

        await type("zzz");
        await press("Enter");
        expect(setValue).toHaveBeenCalledWith("zzz");
    });

    it("is simply a text editor with no options", async () => {
        const { setValue } = await open({ value: "x", row: { status: "x" }, column: freeColumn([]) });
        expect(popover()!.style.display).toBe("none");
        await type("hello");
        await press("Enter");
        expect(setValue).toHaveBeenCalledWith("hello");
    });

    it("commits the typed text when the cell is left", async () => {
        const { setValue, commit } = await open({ column: freeColumn() });
        await type("clo");
        focusElsewhere();
        expect(setValue).toHaveBeenCalledWith("clo");
        expect(commit).toHaveBeenCalledTimes(1);
    });

    it("picks a suggestion on a click", async () => {
        const { setValue, commit } = await open({ column: freeColumn() });
        await type("e");
        click(rows()[1]);
        expect(setValue).toHaveBeenCalledWith("pending");
        expect(commit).toHaveBeenCalledTimes(1);
    });
});

describe("the keyboard", () => {
    it("pages with PageDown and PageUp", async () => {
        const many = Array.from({ length: 100 }, (_v, i) => `option ${i}`);
        await open({
            value: "option 0",
            row: { status: "option 0" },
            column: { key: "status", options: many } as any,
        });
        // By the announced row: happy-dom cannot scroll the list, so a row a page down may not
        // be rendered to look at.
        const at = (): number =>
            Number(/-(\d+)$/.exec(input().getAttribute("aria-activedescendant") ?? "")?.[1]);
        expect(at()).toBe(0);
        await press("PageDown");
        expect(at()).toBeGreaterThan(1);
        await press("PageUp");
        expect(at()).toBe(0);
    });

    it("keeps the text's keys away from the grid", async () => {
        const { editor } = await open();
        const outer = vi.fn();
        editor.element.parentElement!.addEventListener("keydown", outer);
        for (const key of ["ArrowLeft", "ArrowRight", "Home", "End", "Backspace", "Delete", " "]) {
            await press(key);
        }
        await press("a", { ctrlKey: true });
        await press("c", { ctrlKey: true });
        await press("v", { ctrlKey: true });
        await press("x", { ctrlKey: true });
        expect(outer).not.toHaveBeenCalled();
    });

    it("ignores Enter while an IME is composing", async () => {
        const { setValue, commit, cancel } = await open();
        await type("clo");
        await press("Enter", { isComposing: true });
        expect(setValue).not.toHaveBeenCalled();
        expect(commit).not.toHaveBeenCalled();
        expect(cancel).not.toHaveBeenCalled();
    });

    it("cancels on Escape", async () => {
        const { cancel, commit, setValue } = await open();
        await type("clo");
        const e = await press("Escape");
        expect(e.defaultPrevented).toBe(true);
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(commit).not.toHaveBeenCalled();
        expect(setValue).not.toHaveBeenCalled();
    });

    it("does not let Escape close an enclosing modal dialog", async () => {
        const dialog = document.createElement("dialog");
        dialog.setAttribute("open", "");
        document.body.appendChild(dialog);
        const { cancel } = await open({}, dialog);

        // The popover mounts inside the dialog, as every popover does (task 63).
        expect(dialog.contains(popover())).toBe(true);

        const dialogCancel = vi.fn();
        dialog.addEventListener("cancel", dialogCancel);
        const e = await press("Escape");
        expect(e.defaultPrevented).toBe(true);
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(dialog.hasAttribute("open")).toBe(true);
        expect(dialogCancel).not.toHaveBeenCalled();
    });
});

describe("a click on a row", () => {
    it("never takes the focus from the input, and commits the row", async () => {
        const { setValue, commit } = await open();
        const row = rows()[2];
        const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        row.dispatchEvent(down);
        expect(down.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(input());

        row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(setValue).toHaveBeenCalledWith("closed");
        expect(commit).toHaveBeenCalledTimes(1);
    });

    it("leaves pointerdown alone, so the list's own scrolling is untouched", async () => {
        await open();
        const down = new MouseEvent("pointerdown", { bubbles: true, cancelable: true });
        rows()[0].dispatchEvent(down);
        expect(down.defaultPrevented).toBe(false);
    });

    it("does not close the popover by itself on a press inside it", async () => {
        const { commit, cancel } = await open();
        popover()!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        expect(popover()).not.toBeNull();
        expect(commit).not.toHaveBeenCalled();
        expect(cancel).not.toHaveBeenCalled();
    });
});

describe("accessibility", () => {
    it("is a combobox controlling a listbox of options", async () => {
        await open();
        const box = input();
        expect(box.getAttribute("role")).toBe("combobox");
        expect(box.getAttribute("aria-autocomplete")).toBe("list");
        expect(box.getAttribute("aria-expanded")).toBe("true");

        const listbox = document.querySelector('.avg-cell-select-popover [role="listbox"]')!;
        expect(listbox).not.toBeNull();
        expect(box.getAttribute("aria-controls")).toBe(listbox.id);
        for (const row of rows()) {
            expect(row.getAttribute("role")).toBe("option");
            expect(row.id).toMatch(new RegExp(`^${listbox.id}-\\d+$`));
        }
        expect(rows()[0].getAttribute("aria-selected")).toBe("true");
        expect(rows()[1].getAttribute("aria-selected")).toBe("false");
    });

    it("announces the highlighted row through aria-activedescendant", async () => {
        await open();
        expect(input().getAttribute("aria-activedescendant")).toBe(rows()[0].id);
        await press("ArrowDown");
        expect(input().getAttribute("aria-activedescendant")).toBe(rows()[1].id);
    });
});

describe("options from a promise", () => {
    function deferred(): { promise: Promise<any[]>; resolve: (v: any[]) => void; reject: (e: unknown) => void } {
        let resolve!: (v: any[]) => void;
        let reject!: (e: unknown) => void;
        const promise = new Promise<any[]>((res, rej) => {
            resolve = res;
            reject = rej;
        });
        return { promise, resolve, reject };
    }

    it("fills in, and stays open while it resolves", async () => {
        const options = Promise.resolve(["a", "b", "c"]);
        await open({ column: { key: "status", options: () => options } as any });
        expect(popover()).not.toBeNull();
        await settle();
        expect(labels()).toEqual(["open", "a", "b", "c"]);
        expect(active()).toBe("open");
    });

    it("lets the user type while pending, and narrows what arrives to the text", async () => {
        const d = deferred();
        await open({ column: { key: "status", options: () => d.promise } as any });
        await type("b");
        d.resolve(["alpha", "beta", "gamma"]);
        await settle();
        expect(labels()).toEqual(["beta"]);
        expect(active()).toBe("beta");
    });

    it("strict: Enter while pending does nothing", async () => {
        const d = deferred();
        const { setValue, commit, cancel } = await open({
            column: { key: "status", options: () => d.promise } as any,
        });
        await type("b");
        await press("Enter");
        expect(setValue).not.toHaveBeenCalled();
        expect(commit).not.toHaveBeenCalled();
        expect(cancel).not.toHaveBeenCalled();
        d.resolve(["beta"]);
        await settle();
        await press("Enter");
        expect(setValue).toHaveBeenCalledWith("beta");
    });

    it("suggest: Enter while pending commits the text", async () => {
        const d = deferred();
        const { setValue, commit } = await open({ column: freeColumn(() => d.promise) });
        await type("brand new");
        await press("Enter");
        expect(setValue).toHaveBeenCalledWith("brand new");
        expect(commit).toHaveBeenCalledTimes(1);
    });

    it("survives a provider that rejects, with a warning and an empty list", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const failed = Promise.reject(new Error("no"));
        await open({ column: { key: "status", options: () => failed } as any });
        await settle();

        expect(popover()).not.toBeNull();
        expect(warn).toHaveBeenCalled();
        // Strict still offers the cell's own value; nothing else arrived.
        expect(labels()).toEqual(["open"]);
        warn.mockRestore();
    });

    it("ignores options arriving after the editor is gone", async () => {
        const d = deferred();
        const { editor } = await open({ column: { key: "status", options: () => d.promise } as any });
        editor.destroy!();
        d.resolve(["late"]);
        await settle();
        expect(popover()).toBeNull();
        expect(document.querySelector(".avg-list-item")).toBeNull();
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

    it("does not end the edit it is being torn down for", async () => {
        const { editor, cancel, commit } = await open();
        editor.destroy!();
        await Promise.resolve();
        expect(cancel).not.toHaveBeenCalled();
        expect(commit).not.toHaveBeenCalled();
    });
});
