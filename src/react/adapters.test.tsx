// @vitest-environment happy-dom
/**
 * The two adapters that host React components inside the grid's DOM hooks.
 *
 * The contract under test is timing, both ways round: the component must be **in the element
 * before the factory returns** (the grid measures and focuses it synchronously), and the root
 * must unmount **after** the event that triggered `destroy` (the grid calls it from inside the
 * React event that committed, and React refuses a synchronous unmount from its own event).
 * The live press-and-commit sequence is verified in the browser — `test-boards/ReactApp/`.
 */

import { describe, expect, it, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { AVGrid } from "av-grid";
import type { EditorContext, FilterBodyContext } from "av-grid";
import { reactEditor, reactFilterBody } from "./adapters";

const microtasks = () => new Promise<void>((r) => setTimeout(r, 0));

/** Two animation frames — the grid paints on rAF, so cells exist only after this. */
async function settle(): Promise<void> {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
}

// happy-dom does no layout, so every element pretends to have a size — the same patch
// AVGridReact.test.tsx uses, and the reason the end-to-end test can render cells at all.
let originalCreateElement: typeof document.createElement;

beforeAll(() => {
    originalCreateElement = document.createElement.bind(document);
    document.createElement = ((tag: string) => {
        const el = originalCreateElement(tag) as HTMLElement;
        Object.defineProperties(el, {
            offsetWidth: { value: 600, configurable: true },
            offsetHeight: { value: 300, configurable: true },
            clientWidth: { value: 600, configurable: true },
            clientHeight: { value: 300, configurable: true },
        });
        return el;
    }) as typeof document.createElement;
});

afterAll(() => {
    document.createElement = originalCreateElement;
});

/** Write an input's value past React's value tracker, so the input event is not deduped. */
function nativeSetValue(input: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(input),
        "value",
    )?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
}

let errors: unknown[][];
let restoreError: typeof console.error;

beforeEach(() => {
    errors = [];
    restoreError = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
});

afterEach(() => {
    console.error = restoreError;
    expect(errors).toEqual([]); // React warns through console.error; any warning is a failure
});

// -------------------------------------------------------------------------------------------

function editorContext(overrides?: Partial<EditorContext>): EditorContext {
    return {
        value: "Lviv",
        row: { city: "Lviv" },
        column: { key: "city" },
        rowIndex: 0,
        colIndex: 0,
        rowKey: "0",
        openedBy: "key",
        pointerX: undefined,
        setValue: vi.fn(),
        commit: vi.fn(),
        cancel: vi.fn(),
        commitAndPass: vi.fn(),
        ...overrides,
    };
}

function CityEditor({ ctx }: { ctx: EditorContext }) {
    const [v, setV] = useState(String(ctx.value ?? ""));
    return (
        <select
            value={v}
            onChange={(e) => {
                setV(e.target.value);
                ctx.setValue(e.target.value);
                ctx.commit();
            }}
        >
            <option>Kyiv</option>
            <option>Lviv</option>
        </select>
    );
}

describe("reactEditor", () => {
    it("mounts the component synchronously, so the grid can measure and focus it", () => {
        const editor = reactEditor((ctx) => <CityEditor ctx={ctx} />)(editorContext());
        expect(editor).not.toBeInstanceOf(HTMLElement);
        const { element } = editor as Exclude<typeof editor, HTMLElement>;
        const select = element.querySelector("select");
        expect(select).not.toBeNull();
        expect(select!.value).toBe("Lviv");
    });

    it("focus() lands on the component's control, not the wrapper", () => {
        const editor = reactEditor((ctx) => <CityEditor ctx={ctx} />)(editorContext());
        const { element, focus } = editor as { element: HTMLElement; focus: () => void };
        document.body.append(element);
        focus();
        expect(document.activeElement).toBe(element.querySelector("select"));
        element.remove();
    });

    it("the component drives the edit through the context it was handed", () => {
        const ctx = editorContext();
        const editor = reactEditor((c) => <CityEditor ctx={c} />)(ctx) as {
            element: HTMLElement;
        };
        document.body.append(editor.element);
        const select = editor.element.querySelector("select")!;
        select.value = "Kyiv";
        select.dispatchEvent(new Event("change", { bubbles: true }));
        expect(ctx.setValue).toHaveBeenCalledWith("Kyiv");
        expect(ctx.commit).toHaveBeenCalledTimes(1);
        editor.element.remove();
    });

    it("destroy() unmounts — deferred past the event that triggered it", async () => {
        const ctx = editorContext();
        const editor = reactEditor((c) => <CityEditor ctx={c} />)(ctx) as {
            element: HTMLElement;
            destroy: () => void;
        };
        editor.destroy();
        await microtasks();
        expect(editor.element.childElementCount).toBe(0);
    });

    it("survives destroy() called from inside the component's own event", async () => {
        // The real sequence: onChange → ctx.commit() → the grid tears the editor down while
        // React is still dispatching. A synchronous root.unmount() here throws; ours must not.
        let destroy!: () => void;
        const ctx = editorContext({
            commit: vi.fn(() => destroy()),
        });
        const editor = reactEditor((c) => <CityEditor ctx={c} />)(ctx) as {
            element: HTMLElement;
            destroy: () => void;
        };
        destroy = editor.destroy;
        document.body.append(editor.element);
        const select = editor.element.querySelector("select")!;
        select.value = "Kyiv";
        select.dispatchEvent(new Event("change", { bubbles: true }));
        await microtasks();
        expect(editor.element.childElementCount).toBe(0);
        editor.element.remove();
    });

    it("works end to end on a real grid: startEdit mounts it, commit writes the row", async () => {
        const host = document.createElement("div");
        document.body.append(host);
        const grid = AVGrid.create(host, {
            rows: [{ id: 1, city: "Lviv" }],
            columns: [
                { key: "id", name: "ID" },
                { key: "city", name: "City", editor: reactEditor((c) => <CityEditor ctx={c} />) },
            ],
            editable: true,
        });
        await settle();
        grid.startEdit(0, 1);
        await settle();
        const select = host.querySelector(".avg-cell-editor select") as HTMLSelectElement;
        expect(select).not.toBeNull();
        select.value = "Kyiv";
        select.dispatchEvent(new Event("change", { bubbles: true }));
        expect(grid.getRows()[0]!.city).toBe("Kyiv");
        await microtasks();
        expect(host.querySelector(".avg-cell-editor select")).toBeNull();
        grid.destroy();
        host.remove();
    });
});

// -------------------------------------------------------------------------------------------

function filterContext(overrides?: Partial<FilterBodyContext>): FilterBodyContext {
    return {
        column: { key: "score" },
        value: undefined,
        filter: { columnKey: "score", type: "min-score", value: undefined },
        apply: vi.fn(),
        close: vi.fn(),
        ...overrides,
    };
}

function MinScore({ initial, onChange }: { initial: unknown; onChange: (v: unknown) => void }) {
    const [v, setV] = useState(initial == null ? "" : String(initial));
    return (
        <input
            value={v}
            onChange={(e) => {
                setV(e.target.value);
                onChange(e.target.value === "" ? undefined : Number(e.target.value));
            }}
        />
    );
}

describe("reactFilterBody", () => {
    const create = reactFilterBody((ctx, setValue) => (
        <MinScore initial={ctx.value} onChange={setValue} />
    ));

    it("mounts synchronously and getValue starts as the applied value", () => {
        const body = create(filterContext({ value: 50 }));
        expect(body.element.querySelector("input")!.value).toBe("50");
        // Open → Apply with no interaction keeps the filter as it was.
        expect(body.getValue()).toBe(50);
    });

    it("getValue returns whatever the component recorded last", () => {
        const body = create(filterContext());
        document.body.append(body.element);
        const input = body.element.querySelector("input")!;
        nativeSetValue(input, "75");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        expect(body.getValue()).toBe(75);
        // Emptying records nullish, which is how Apply removes the filter.
        nativeSetValue(input, "");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        expect(body.getValue()).toBeUndefined();
        body.element.remove();
    });

    it("destroy() unmounts cleanly", async () => {
        const body = create(filterContext());
        body.destroy!();
        await microtasks();
        expect(body.element.childElementCount).toBe(0);
    });
});
