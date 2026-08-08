// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { Popover } from "./Popover";

/**
 * happy-dom does no layout, so every rect here is stubbed. That makes these tests a check on
 * the placement *arithmetic* — flip, align, clamp — and nothing more; whether a popover
 * actually appears where it should is a board question, not a happy-dom one.
 */
function rect(left: number, top: number, width: number, height: number): DOMRect {
    return {
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
        x: left,
        y: top,
        toJSON: () => ({}),
    } as DOMRect;
}

function anchorAt(left: number, top: number, width = 100, height = 20): HTMLElement {
    const el = document.createElement("button");
    el.getBoundingClientRect = () => rect(left, top, width, height);
    document.body.appendChild(el);
    return el;
}

/** Size the popover itself, which is otherwise 0×0 under happy-dom. */
function sized<T>(popover: Popover<T>, width: number, height: number): Popover<T> {
    popover.root.getBoundingClientRect = () => {
        const max = parseInt(popover.root.style.maxHeight || "", 10);
        return rect(0, 0, width, Number.isFinite(max) ? Math.min(height, max) : height);
    };
    return popover;
}

const open: Popover<any>[] = [];
function make<T = void>(...args: ConstructorParameters<typeof Popover<T>>): Popover<T> {
    const popover = new Popover<T>(...args);
    open.push(popover);
    return popover;
}

afterEach(() => {
    open.splice(0).forEach((p) => p.destroy());
    document.body.innerHTML = "";
});

describe("opening and closing", () => {
    it("mounts on show and unmounts on close", async () => {
        const popover = make({ anchor: anchorAt(10, 10) });
        popover.content.textContent = "body";

        const closed = popover.show();
        expect(document.body.contains(popover.root)).toBe(true);
        expect(popover.isOpen).toBe(true);

        popover.close();
        await closed;
        expect(document.body.contains(popover.root)).toBe(false);
        expect(popover.isOpen).toBe(false);
    });

    it("resolves the promise with whatever close() was given", async () => {
        const popover = make<string>({ anchor: anchorAt(10, 10) });
        const closed = popover.show();
        popover.close("applied");
        await expect(closed).resolves.toBe("applied");
    });

    it("resolves undefined when dismissed rather than closed with a result", async () => {
        const popover = make<string>({ anchor: anchorAt(10, 10) });
        const closed = popover.show();
        document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        await expect(closed).resolves.toBeUndefined();
    });

    it("returns the same promise when show() is called twice", () => {
        const popover = make({ anchor: anchorAt(10, 10) });
        expect(popover.show()).toBe(popover.show());
    });

    it("is safe to close twice", async () => {
        const popover = make({ anchor: anchorAt(10, 10) });
        const closed = popover.show();
        popover.close();
        popover.close();
        await expect(closed).resolves.toBeUndefined();
    });
});

describe("dismissal", () => {
    it("closes on Escape, and stops the key reaching anything else", async () => {
        const popover = make({ anchor: anchorAt(10, 10) });
        const closed = popover.show();

        const seen = vi.fn();
        document.body.addEventListener("keydown", seen);
        const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
        popover.root.dispatchEvent(event);

        await expect(closed).resolves.toBeUndefined();
        // The grid cancels an edit on Escape; a popover over it must win.
        expect(seen).not.toHaveBeenCalled();
    });

    it("ignores keys that are not Escape", () => {
        const popover = make({ anchor: anchorAt(10, 10) });
        void popover.show();
        popover.root.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
        expect(popover.isOpen).toBe(true);
    });

    it("closes on an outside pointerdown but not on one inside", () => {
        const outside = document.createElement("div");
        document.body.appendChild(outside);
        const popover = make({ anchor: anchorAt(10, 10) });
        void popover.show();

        popover.content.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        expect(popover.isOpen).toBe(true);

        outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        expect(popover.isOpen).toBe(false);
    });

    it("leaves the anchor to whoever opened it", () => {
        const anchor = anchorAt(10, 10);
        const popover = make({ anchor });
        void popover.show();
        anchor.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        // Closing here would race the opener's own toggle.
        expect(popover.isOpen).toBe(true);
    });

    it("honours ignoreOutside", () => {
        const chip = document.createElement("div");
        chip.className = "avg-filter-chip";
        document.body.appendChild(chip);

        const popover = make({ anchor: anchorAt(10, 10), ignoreOutside: ".avg-filter-chip" });
        void popover.show();
        chip.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        expect(popover.isOpen).toBe(true);
    });

    it("takes every document listener with it when it closes", () => {
        const add = vi.spyOn(document, "addEventListener");
        const remove = vi.spyOn(document, "removeEventListener");

        const popover = make({ anchor: anchorAt(10, 10) });
        void popover.show();
        const added = add.mock.calls.map((c) => c[0]).sort();
        popover.close();
        const removed = remove.mock.calls.map((c) => c[0]).sort();

        expect(added.length).toBeGreaterThan(0);
        expect(removed).toEqual(added);
        add.mockRestore();
        remove.mockRestore();
    });
});

describe("focus", () => {
    it("focuses the popover and hands focus back on close", () => {
        const before = document.createElement("input");
        document.body.appendChild(before);
        before.focus();

        const popover = make({ anchor: anchorAt(10, 10) });
        void popover.show();
        expect(document.activeElement).toBe(popover.root);

        popover.close();
        expect(document.activeElement).toBe(before);
    });

    it("leaves focus alone when autoFocus is off", () => {
        const before = document.createElement("input");
        document.body.appendChild(before);
        before.focus();

        const popover = make({ anchor: anchorAt(10, 10), autoFocus: false });
        void popover.show();
        expect(document.activeElement).toBe(before);
    });
});

describe("placement", () => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    it("sits below the anchor with left edges aligned", () => {
        const popover = sized(make({ anchor: anchorAt(120, 40, 100, 20) }), 200, 150);
        void popover.show();
        // bottom-start: anchor.bottom (60) + the default 4px gap, and anchor.left.
        expect(popover.root.style.top).toBe("64px");
        expect(popover.root.style.left).toBe("120px");
        expect(popover.root.getAttribute("data-placement")).toBe("bottom-start");
    });

    it("aligns right edges for a -end placement", () => {
        const popover = sized(
            make({ anchor: anchorAt(400, 40, 100, 20), placement: "bottom-end" }),
            200,
            150,
        );
        void popover.show();
        // anchor.right (500) - width (200).
        expect(popover.root.style.left).toBe("300px");
    });

    it("flips above the anchor when there is no room below", () => {
        const popover = sized(make({ anchor: anchorAt(120, vh - 60, 100, 20) }), 200, 300);
        void popover.show();
        expect(popover.root.getAttribute("data-placement")).toBe("top-start");
    });

    it("does not flip into a worse squeeze", () => {
        // Pinned near the top: below is tight, above is tighter. Staying put keeps more of it.
        const popover = sized(make({ anchor: anchorAt(120, 10, 100, 20) }), 200, 4000);
        void popover.show();
        expect(popover.root.getAttribute("data-placement")).toBe("bottom-start");
    });

    it("caps its height to the space available and lets the content scroll", () => {
        const anchor = anchorAt(120, vh - 200, 100, 20);
        const popover = sized(make({ anchor }), 200, 900);
        void popover.show();
        const maxHeight = parseInt(popover.root.style.maxHeight, 10);
        expect(maxHeight).toBeGreaterThan(0);
        expect(maxHeight).toBeLessThan(900);
    });

    it("shifts back inside the viewport rather than hanging off the right edge", () => {
        const popover = sized(make({ anchor: anchorAt(vw - 40, 40, 30, 20) }), 300, 100);
        void popover.show();
        const left = parseInt(popover.root.style.left, 10);
        expect(left + 300).toBeLessThanOrEqual(vw - 8);
    });

    it("positions against a point", () => {
        const popover = sized(make({ anchor: { x: 250, y: 300 } }), 200, 100);
        void popover.show();
        expect(popover.root.style.left).toBe("250px");
        expect(popover.root.style.top).toBe("304px");
    });

    it("places to the side for a right placement", () => {
        const popover = sized(
            make({ anchor: anchorAt(100, 100, 60, 20), placement: "right-start" }),
            150,
            100,
        );
        void popover.show();
        expect(popover.root.style.left).toBe("164px"); // anchor.right + gap
        expect(popover.root.style.top).toBe("100px");
    });

    it("applies a custom offset", () => {
        const popover = sized(
            make({ anchor: anchorAt(100, 100, 60, 20), offset: [10, 20] }),
            150,
            100,
        );
        void popover.show();
        expect(popover.root.style.left).toBe("110px");
        expect(popover.root.style.top).toBe("140px");
    });

    it("matches the anchor's width when asked", () => {
        const popover = make({ anchor: anchorAt(100, 100, 260, 20), matchAnchorWidth: true });
        void popover.show();
        expect(popover.root.style.width).toBe("260px");
    });

    it("uses a supplied size over the anchor's width", () => {
        const popover = make({
            anchor: anchorAt(100, 100, 260, 20),
            matchAnchorWidth: true,
            size: { width: 400, height: 300 },
        });
        void popover.show();
        expect(popover.root.style.width).toBe("400px");
        expect(popover.root.style.height).toBe("300px");
    });

    it("does nothing when repositioned while closed", () => {
        const popover = make({ anchor: anchorAt(10, 10) });
        expect(() => popover.reposition()).not.toThrow();
        expect(popover.root.style.left).toBe("");
    });
});

describe("the resize handle", () => {
    it("is rendered only when resizable", () => {
        const plain = make({ anchor: anchorAt(10, 10) });
        expect(plain.root.querySelector(".avg-popover-resize")).toBeNull();

        const resizable = make({ anchor: anchorAt(10, 10), resizable: true });
        expect(resizable.root.querySelector(".avg-popover-resize")).not.toBeNull();
    });
});
