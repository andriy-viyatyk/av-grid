/**
 * A positioned floating panel — the shell the filter popover, the filter chip editor and
 * (later) the cell dropdown all open into.
 *
 * Written fresh rather than ported. The reference's `Popover.tsx` is a thin React wrapper
 * whose entire behaviour — placement, flipping, viewport clamping, live repositioning — comes
 * from `@floating-ui/react`, and this library has no runtime dependencies. What is ported is
 * the *contract*, which is worth keeping exactly: anchored to an element **or** to a point,
 * flips instead of clipping, closes on outside pointerdown and Escape, optionally resizable
 * with the new size reported back.
 *
 * The one addition is that `show()` returns a promise resolving when the popover closes. The
 * reference reached the same shape one level up, in `showFilterPopover`; down here it costs
 * nothing and makes the caller read as a single statement:
 *
 * ```ts
 * const popover = new Popover<Filter>({ anchor: funnelButton, resizable: true });
 * popover.content.append(body);
 * const applied = await popover.show();   // undefined if dismissed
 * ```
 *
 * This is the first thing in the library that lives outside the grid's own DOM, which has two
 * consequences. It carries its own copy of the `--avg-*` token block, because those are
 * defined on the grid root and `document.body` is not inside it. And it owns document-level
 * listeners, so every exit path — Escape, outside click, `close()`, `destroy()` — goes through
 * `close()`, which is the only place they come off.
 */

import { resizeHandleIcon } from "./icons";

/** `side-align`. `bottom-start` means below the anchor, left edges aligned. */
export type PopoverPlacement =
    | "bottom-start"
    | "bottom-end"
    | "bottom"
    | "top-start"
    | "top-end"
    | "top"
    | "right-start"
    | "right-end"
    | "left-start"
    | "left-end";

export interface PopoverSize {
    width: number;
    height: number;
}

export interface PopoverOptions {
    /**
     * What to position against: an element (a header funnel, a filter chip) or a point in
     * viewport coordinates (a context menu at the pointer). The reference supports both and
     * the two entry points into the filter popover use them differently.
     *
     * **Not a pooled cell.** A data cell is recycled into a different row the moment it
     * scrolls out, so a popover anchored to one silently re-anchors to whatever the element
     * became. Anchor to a header cell, a chip, or a point.
     */
    anchor: Element | { x: number; y: number };
    /** Default `"bottom-start"`. Flipped to the opposite side when it will not fit. */
    placement?: PopoverPlacement;
    /** `[cross, main]` — `main` is the gap from the anchor, `cross` shifts along its edge. */
    offset?: [number, number];
    /** Added to the popover root, for a caller that wants to style its own popover. */
    className?: string;
    /** Match the anchor's width — for a dropdown that should line up with its input. */
    matchAnchorWidth?: boolean;
    /** Render a drag handle in the corner. */
    resizable?: boolean;
    /** Starting size, e.g. one the host remembered from the last time it was resized. */
    size?: PopoverSize;
    minWidth?: number;
    minHeight?: number;
    /** Fired during a resize drag with the live size. */
    onResize?: (size: PopoverSize) => void;
    /**
     * A CSS selector; an outside pointerdown landing on a match does not close the popover.
     * The anchor itself is always exempt — see `onDocumentPointerDown`.
     */
    ignoreOutside?: string;
    /** Focus the popover on open, and restore the previous focus on close. Default `true`. */
    autoFocus?: boolean;
    /** Defaults to the anchor's document, or the global one. */
    document?: Document;
}

/** Distance kept between the popover and the edge of the viewport. */
const VIEWPORT_MARGIN = 8;
/** A popover is never squeezed below this, even where there is no room — it scrolls instead. */
const MIN_AVAILABLE_HEIGHT = 100;

interface Rect {
    top: number;
    left: number;
    bottom: number;
    right: number;
    width: number;
    height: number;
}

export class Popover<T = void> {
    /** The outer, positioned element. Styling and `data-*` hooks live here. */
    readonly root: HTMLDivElement;
    /** Where the caller puts its content. Scrolls when the content outgrows the popover. */
    readonly content: HTMLDivElement;

    private readonly options: PopoverOptions;
    private readonly doc: Document;
    private readonly placement: PopoverPlacement;
    private readonly offset: [number, number];

    private open = false;
    private resolve?: (value: T | undefined) => void;
    private promise?: Promise<T | undefined>;
    private manualSize?: PopoverSize;
    private previousFocus: Element | null = null;
    private observer?: ResizeObserver;
    /** The placement actually used, after flipping. The resize handle reads it. */
    private resolvedPlacement: PopoverPlacement;

    constructor(options: PopoverOptions) {
        this.options = options;
        this.placement = options.placement ?? "bottom-start";
        this.resolvedPlacement = this.placement;
        this.offset = options.offset ?? [0, 4];
        this.manualSize = options.size;
        this.doc =
            options.document ??
            (options.anchor instanceof Element ? options.anchor.ownerDocument : document);

        this.root = this.doc.createElement("div");
        this.root.className = `avg-popover${options.className ? ` ${options.className}` : ""}`;
        this.root.setAttribute("data-type", "popover");
        this.root.tabIndex = -1;

        this.content = this.doc.createElement("div");
        this.content.className = "avg-popover-content";
        this.root.appendChild(this.content);

        if (options.resizable) {
            const handle = this.doc.createElement("div");
            handle.className = "avg-popover-resize";
            handle.setAttribute("data-type", "popover-resize-handle");
            handle.innerHTML = resizeHandleIcon;
            handle.addEventListener("pointerdown", this.onResizePointerDown);
            this.root.appendChild(handle);
        }
    }

    get isOpen(): boolean {
        return this.open;
    }

    /**
     * Mount, position, and resolve when the popover closes — with whatever `close()` was
     * given, or `undefined` if the user dismissed it. Calling `show()` on an open popover
     * returns the same promise rather than mounting a second time.
     */
    show(): Promise<T | undefined> {
        if (this.open) return this.promise!;
        this.open = true;
        this.promise = new Promise<T | undefined>((resolve) => {
            this.resolve = resolve;
        });

        this.previousFocus = this.doc.activeElement;
        this.doc.body.appendChild(this.root);
        this.reposition();

        if (this.options.autoFocus !== false) this.root.focus({ preventScroll: true });

        // Capture phase, deliberately. A popover opened from a `pointerdown` handler would
        // otherwise see the tail of that very event bubble up to the document and close
        // itself immediately. Document capture runs *before* the target, so by the time a
        // listener is added mid-dispatch that phase has already passed — the in-flight event
        // cannot reach it, and every later one arrives before anything else can act on it.
        this.doc.addEventListener("pointerdown", this.onDocumentPointerDown, true);
        this.doc.addEventListener("keydown", this.onDocumentKeyDown, true);
        // `true` on scroll: a scroll in any container, not just the document, moves the anchor.
        this.doc.defaultView?.addEventListener("scroll", this.reposition, true);
        this.doc.defaultView?.addEventListener("resize", this.reposition);

        if (typeof ResizeObserver !== "undefined") {
            // Content that arrives late — options resolved from a promise — changes the size
            // the placement was computed against.
            this.observer = new ResizeObserver(() => this.reposition());
            this.observer.observe(this.content);
        }
        return this.promise;
    }

    /** Close, resolving `show()`'s promise with `result`. Safe to call more than once. */
    close = (result?: T): void => {
        if (!this.open) return;
        this.open = false;

        this.doc.removeEventListener("pointerdown", this.onDocumentPointerDown, true);
        this.doc.removeEventListener("keydown", this.onDocumentKeyDown, true);
        this.doc.defaultView?.removeEventListener("scroll", this.reposition, true);
        this.doc.defaultView?.removeEventListener("resize", this.reposition);
        this.observer?.disconnect();
        this.observer = undefined;

        this.root.remove();
        // Back where the user was — otherwise closing a filter popover leaves the grid
        // unfocused and the next keystroke goes nowhere.
        if (this.options.autoFocus !== false && this.previousFocus instanceof HTMLElement) {
            this.previousFocus.focus({ preventScroll: true });
        }
        this.previousFocus = null;

        const resolve = this.resolve;
        this.resolve = undefined;
        resolve?.(result);
    };

    /** Drop the popover for good. Closes it first, so no listener outlives it. */
    destroy(): void {
        this.close();
        this.root.remove();
    }

    // =========================================================================================
    // Placement
    // =========================================================================================

    /**
     * Recompute the position. Called on open, on scroll, on resize, and whenever the content
     * changes size — and public, so a caller that knows it changed something can ask.
     */
    reposition = (): void => {
        if (!this.open) return;

        const view = this.doc.defaultView;
        const vw = view?.innerWidth ?? 0;
        const vh = view?.innerHeight ?? 0;
        const anchor = this.anchorRect();

        const [cross, main] = this.offset;
        const [side, align] = this.split(this.placement);

        // Room on each side of the anchor, gap and margin already taken out.
        const room = {
            bottom: vh - anchor.bottom - main - VIEWPORT_MARGIN,
            top: anchor.top - main - VIEWPORT_MARGIN,
            right: vw - anchor.right - main - VIEWPORT_MARGIN,
            left: anchor.left - main - VIEWPORT_MARGIN,
        };

        this.root.style.position = "fixed";
        this.root.style.maxHeight = "";
        if (this.manualSize) {
            this.root.style.width = `${this.manualSize.width}px`;
            this.root.style.height = `${this.manualSize.height}px`;
        } else if (this.options.matchAnchorWidth && anchor.width) {
            this.root.style.width = `${anchor.width}px`;
        }

        let size = this.root.getBoundingClientRect();
        const needed = side === "top" || side === "bottom" ? size.height : size.width;

        // Flip only when the opposite side is genuinely roomier — flipping into a squeeze
        // trades a clipped popover for a differently clipped one.
        let resolved = side;
        const opposite = { bottom: "top", top: "bottom", right: "left", left: "right" } as const;
        if (needed > room[side] && room[opposite[side]] > room[side]) resolved = opposite[side];

        // Vertical space is the one that runs out in practice — a 40,000-option filter list is
        // tall, not wide — so cap the height and let the content scroll inside.
        if (resolved === "top" || resolved === "bottom") {
            this.root.style.maxHeight = `${Math.max(MIN_AVAILABLE_HEIGHT, room[resolved])}px`;
            size = this.root.getBoundingClientRect();
        }

        let x: number;
        let y: number;
        if (resolved === "bottom" || resolved === "top") {
            y = resolved === "bottom" ? anchor.bottom + main : anchor.top - size.height - main;
            x =
                align === "end"
                    ? anchor.right - size.width + cross
                    : align === "center"
                      ? anchor.left + (anchor.width - size.width) / 2 + cross
                      : anchor.left + cross;
        } else {
            x = resolved === "right" ? anchor.right + main : anchor.left - size.width - main;
            y =
                align === "end"
                    ? anchor.bottom - size.height + cross
                    : align === "center"
                      ? anchor.top + (anchor.height - size.height) / 2 + cross
                      : anchor.top + cross;
        }

        // Shift back inside the viewport. `Math.max` last so a popover taller or wider than
        // the viewport hangs off the far edge rather than the near one, keeping the corner
        // nearest the anchor visible.
        x = Math.max(VIEWPORT_MARGIN, Math.min(x, vw - size.width - VIEWPORT_MARGIN));
        y = Math.max(VIEWPORT_MARGIN, Math.min(y, vh - size.height - VIEWPORT_MARGIN));

        this.root.style.left = `${Math.round(x)}px`;
        this.root.style.top = `${Math.round(y)}px`;

        this.resolvedPlacement = (
            align ? `${resolved}-${align}` : resolved
        ) as PopoverPlacement;
        this.root.setAttribute("data-placement", this.resolvedPlacement);
    };

    private anchorRect(): Rect {
        const anchor = this.options.anchor;
        if (anchor instanceof Element) return anchor.getBoundingClientRect();
        // A point is a zero-size rect, so every placement rule above applies to it unchanged.
        const { x, y } = anchor;
        return { top: y, left: x, bottom: y, right: x, width: 0, height: 0 };
    }

    private split(placement: PopoverPlacement): ["top" | "bottom" | "left" | "right", string] {
        const [side, align = "center"] = placement.split("-");
        return [side as "top" | "bottom" | "left" | "right", align];
    }

    // =========================================================================================
    // Dismissal and resize
    // =========================================================================================

    private onDocumentPointerDown = (e: Event): void => {
        const target = e.target as Element | null;
        if (!target || this.root.contains(target)) return;
        // The anchor is exempt: whoever opened the popover owns what a second click on it
        // means, and closing here would race their toggle.
        if (this.options.anchor instanceof Element && this.options.anchor.contains(target)) return;
        if (this.options.ignoreOutside && target.closest?.(this.options.ignoreOutside)) return;
        this.close();
    };

    private onDocumentKeyDown = (e: KeyboardEvent): void => {
        if (e.key !== "Escape") return;
        // Stopped, not just handled: the grid cancels an in-progress edit on Escape, and a
        // popover open over the grid is the outermost thing the key can mean.
        e.preventDefault();
        e.stopPropagation();
        this.close();
    };

    private onResizePointerDown = (e: PointerEvent): void => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();

        const handle = e.currentTarget as HTMLElement;
        const start = this.root.getBoundingClientRect();
        const startX = e.clientX;
        const startY = e.clientY;
        // Dragging a popover that opened *above* its anchor grows it upward, so the corner
        // being dragged moves the opposite way to the pointer's y.
        const upward = this.resolvedPlacement.startsWith("top");
        const minWidth = this.options.minWidth ?? start.width;
        const minHeight = this.options.minHeight ?? start.height;

        const onMove = (move: PointerEvent): void => {
            const dy = upward ? startY - move.clientY : move.clientY - startY;
            this.manualSize = {
                width: Math.max(minWidth, start.width + (move.clientX - startX)),
                height: Math.max(minHeight, start.height + dy),
            };
            this.reposition();
            this.options.onResize?.(this.manualSize);
        };
        const onEnd = (): void => {
            handle.removeEventListener("pointermove", onMove);
            handle.removeEventListener("pointerup", onEnd);
            handle.removeEventListener("lostpointercapture", onEnd);
        };

        handle.setPointerCapture(e.pointerId);
        handle.addEventListener("pointermove", onMove);
        handle.addEventListener("pointerup", onEnd);
        handle.addEventListener("lostpointercapture", onEnd);
    };
}
