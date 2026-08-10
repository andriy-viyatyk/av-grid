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

import type { EditorContext, CellEditor } from "../model/EditingModel";

export function createCellInput<R>(ctx: EditorContext<R>): CellEditor {
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
            // Typing over a cell replaces it, so the caret goes after the character just
            // typed; opening with F2 or a double-click selects the value instead, so the next
            // keystroke can replace it or an arrow key can keep it.
            if (ctx.dontSelect) {
                const end = input.value.length;
                input.setSelectionRange?.(end, end);
            } else {
                input.select();
            }
        },
    };
}
