/**
 * The text editor — an `<input>` that fills the cell it is opened in.
 *
 * A rewrite of `CellInput.tsx`, which wrapped Persephone's UIKit `Input` and spent most of its
 * body overriding that component's chrome back out again (its 26px height, its 8px padding, its
 * border and radius) so it would sit flush in a cell. With no component library underneath,
 * there is nothing to override: the element is a bare input and the stylesheet positions it.
 *
 * Everything that ends an edit is bound here, on an element created for this one edit and
 * discarded with it. That is not a violation of the root-delegation rule in `CLAUDE.md` — that
 * rule exists because *pooled* elements change identity between frames, and this one never
 * outlives its edit.
 */

import type { EditorContext, MountedCellEditor } from "../types";

/**
 * Which character boundary the given client x falls on, or `undefined` when it cannot be worked
 * out — so a caller can fall back rather than land the caret somewhere invented.
 *
 * The text is measured by real layout rather than by canvas metrics: a hidden span carrying the
 * input's own computed font, and a `Range` over its text node, which gets kerning, ligatures and
 * `letter-spacing` right because it *is* the same shaping the input will do. It runs once, when
 * an editor opens, so a handful of rect reads costs nothing that anyone can perceive.
 *
 * `undefined` covers the environment with no layout at all — happy-dom, or a `display: none`
 * ancestor — where every rect is zero and a search would confidently answer 0 for any x.
 */
function caretIndexAt(input: HTMLInputElement, clientX: number): number | undefined {
    const text = input.value;
    if (!text) return 0;
    const doc = input.ownerDocument;
    const host = input.parentElement ?? doc.body;
    if (!host || typeof doc.createRange !== "function") return undefined;

    const cs = getComputedStyle(input);
    const span = doc.createElement("span");
    span.style.cssText =
        "position:absolute;top:0;left:-9999px;visibility:hidden;white-space:pre;" +
        "pointer-events:none;margin:0;padding:0;border:0";
    span.style.font = cs.font;
    span.style.letterSpacing = cs.letterSpacing;
    span.textContent = text;
    host.append(span);

    try {
        const node = span.firstChild;
        if (!node) return undefined;
        const range = doc.createRange();
        if (typeof range.getBoundingClientRect !== "function") return undefined;
        const widthTo = (i: number): number => {
            range.setStart(node, 0);
            range.setEnd(node, i);
            return range.getBoundingClientRect().width;
        };

        const full = widthTo(text.length);
        if (!(full > 0)) return undefined;

        // Where the text starts, which is not the input's left edge for a right-aligned column.
        const rect = input.getBoundingClientRect();
        const num = (v: string): number => parseFloat(v) || 0;
        const left = rect.left + num(cs.borderLeftWidth) + num(cs.paddingLeft);
        const right = rect.right - num(cs.borderRightWidth) - num(cs.paddingRight);
        const align = cs.textAlign;
        const origin =
            align === "right" || align === "end"
                ? right - full
                : align === "center"
                  ? left + (right - left - full) / 2
                  : left;

        const target = clientX - origin;
        if (target <= 0) return 0;
        if (target >= full) return text.length;

        // Binary search for the boundary before the point, then take whichever of the two
        // neighbours is nearer: clicking the right half of a glyph puts the caret after it.
        let lo = 0;
        let hi = text.length;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (widthTo(mid) <= target) lo = mid;
            else hi = mid;
        }
        return target - widthTo(lo) <= widthTo(hi) - target ? lo : hi;
    } finally {
        span.remove();
    }
}

export function createCellInput<R>(ctx: EditorContext<R>): MountedCellEditor {
    const input = document.createElement("input");
    input.className = "avg-cell-editor";
    // A text input even for a number column, deliberately. `type="number"` rejects the very
    // first keystroke of a type-to-edit when it is not a digit, refuses `setSelectionRange`,
    // and adds a spinner nobody asked for. The column's `dataType` already coerces the value
    // on commit, through `defaultValidate`.
    input.type = "text";
    input.setAttribute("data-type", "cell-editor");
    input.value = ctx.value === null || ctx.value === undefined ? "" : String(ctx.value);

    input.addEventListener("input", () => ctx.setValue(input.value));

    input.addEventListener("keydown", (e: KeyboardEvent) => {
        switch (e.key) {
            case "Enter":
                e.preventDefault();
                ctx.commit();
                break;
            case "Escape":
                e.preventDefault();
                ctx.cancel();
                break;
            case "Tab":
            case "ArrowUp":
            case "ArrowDown":
                // Commit, then let the grid move the focus one cell — the grid's own key
                // handling, reached directly because the event came from an input.
                //
                // A cell editor is a single-line input, so the vertical arrows have nothing to
                // do inside it and the horizontal ones have everything: left and right move the
                // caret through the text, up and down move to the next record. That split is
                // the reference's, and it is what makes a column editable at typing speed —
                // otherwise Tab is the only way out and every row ends with a reach for Enter.
                e.preventDefault();
                ctx.commitAndPass(e);
                break;
            default:
                // Everything else belongs to the caret: the horizontal arrows move within the
                // text, Home and End go to its ends, and the grid must not also act on them.
                e.stopPropagation();
                break;
        }
    });

    // Clicking elsewhere commits, which is what every spreadsheet does and what makes an
    // editor left open by a distracted user harmless.
    input.addEventListener("blur", () => ctx.commit());

    // A pointer inside the editor is editing text, not selecting a range.
    input.addEventListener("pointerdown", (e) => e.stopPropagation());
    input.addEventListener("dblclick", (e) => e.stopPropagation());

    return {
        element: input,
        focus: () => {
            input.focus();
            // Enter, F2 and `startEdit()` select the value: the user named the cell, not a place
            // in it, so the next keystroke should replace what is there. A click named a place —
            // the caret goes where it landed, and nothing is selected, because someone who meant
            // to replace the value would have typed over the cell instead of reaching for it.
            // Typing already replaced the value with one character, so the caret follows it.
            if (ctx.openedBy === "key") {
                input.select();
                return;
            }
            const end = input.value.length;
            const at =
                ctx.openedBy === "pointer" && ctx.pointerX !== undefined
                    ? (caretIndexAt(input, ctx.pointerX) ?? end)
                    : end;
            input.setSelectionRange?.(at, at);
        },
    };
}
