/**
 * The two DOM operations every cell performs on every paint.
 *
 * Both exist to avoid an allocation. They look trivial; they are on the hottest path in the
 * library, called for each of the ~250 cells a full repaint touches.
 */

import type { CellStyle } from "../render/types";
import type { ClassValue } from "../types";

/**
 * Append a class hook's return value to a class name being assembled.
 *
 * Returns the string it was given when the hook returned nothing, which is the common case for a
 * conditional hook — so a cell that does not match allocates no string at all. The whole class
 * name is assigned once, at the end, rather than through `classList` calls: see `DataCell`.
 */
export function appendClass(className: string, value: ClassValue): string {
    if (!value) return className;
    if (typeof value === "string") return `${className} ${value}`;
    let out = className;
    for (const part of value) if (part) out += ` ${part}`;
    return out;
}

/**
 * Set an element's text through its existing text node.
 *
 * `el.textContent = s` discards the child nodes and allocates a fresh text node — per cell,
 * per frame. Writing `nodeValue` on the node already there allocates nothing and does not
 * touch the child list at all.
 */
export function setText(el: HTMLElement, text: string): void {
    const first = el.firstChild;
    if (first && first.nodeType === 3 /* Node.TEXT_NODE */) {
        if (first.nodeValue !== text) first.nodeValue = text;
        // A previous custom renderer may have left siblings behind.
        while (first.nextSibling) el.removeChild(first.nextSibling);
    } else {
        el.textContent = "";
        el.appendChild(document.createTextNode(text));
    }
}

/**
 * Position and size a cell from the geometry the engine computed.
 *
 * Written property by property with a read-before-write guard: assigning an unchanged value
 * still marks the element dirty for style recalculation in some engines, and the comparison
 * is far cheaper than the recalc. `display` and `position` come from the stylesheet, so only
 * the four numbers are written here.
 */
export function applyCellStyle(el: HTMLElement, style: CellStyle): void {
    const s = el.style;

    const left = `${style.left}px`;
    if (s.left !== left) s.left = left;

    const top = `${style.top}px`;
    if (s.top !== top) s.top = top;

    const width = `${style.width}px`;
    if (s.width !== width) s.width = width;

    const height = `${style.height}px`;
    if (s.height !== height) s.height = height;
}
