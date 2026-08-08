/**
 * The dropdown editor — used when a column carries `options`.
 *
 * A rewrite of `CellSelect.tsx`, which wrapped UIKit's `Select`: a popover, a filterable list
 * box, and a bridge translating `Column.options` into `IListBoxItem`s. None of that can be
 * ported without a component library, and a native `<select>` is not a poor substitute for it —
 * it is keyboard-navigable, type-ahead searchable and screen-reader correct for free, in about
 * forty lines.
 *
 * `Column.options` may be an array, a function, or a function returning a promise. All three
 * resolve here, so a column can look its choices up when the cell is opened rather than at
 * definition time.
 */

import type { CellEditor, EditorContext } from "../model/EditingModel";

function label(value: unknown): string {
    return value === null || value === undefined ? "" : String(value);
}

export function createCellSelect<R>(ctx: EditorContext<R>): CellEditor {
    const select = document.createElement("select");
    select.className = "avg-cell-editor";
    select.setAttribute("data-type", "cell-editor");

    const fill = (values: any[]): void => {
        select.textContent = "";
        const current = label(ctx.value);
        // The cell's own value first when it is not among the choices, so opening the editor
        // never silently changes what the cell holds.
        const all = values.some((v) => label(v) === current)
            ? values
            : [ctx.value, ...values];

        for (const value of all) {
            const option = document.createElement("option");
            option.value = label(value);
            option.textContent = label(value);
            select.appendChild(option);
        }
        select.value = current;
    };

    const source = ctx.column.options;
    const resolved = typeof source === "function" ? source() : source ?? [];
    if (resolved instanceof Promise) {
        // Empty until it arrives; the select stays focused and fills underneath.
        fill([]);
        void resolved.then((values) => {
            fill(values);
            select.focus();
        });
    } else {
        fill(resolved);
    }

    // A pick is the whole interaction — there is nothing else to do in a dropdown, so it
    // commits and closes rather than waiting for an Enter the user has no reason to press.
    select.addEventListener("change", () => {
        ctx.setValue(select.value);
        ctx.commit();
    });

    select.addEventListener("keydown", (e: KeyboardEvent) => {
        switch (e.key) {
            case "Escape":
                e.preventDefault();
                ctx.cancel();
                break;
            case "Enter":
                e.preventDefault();
                ctx.setValue(select.value);
                ctx.commit();
                break;
            case "Tab":
                e.preventDefault();
                ctx.setValue(select.value);
                ctx.commitAndPass(e);
                break;
            default:
                // Arrows change the selected option; type-ahead jumps to a choice.
                e.stopPropagation();
                break;
        }
    });

    select.addEventListener("blur", () => ctx.commit());
    select.addEventListener("pointerdown", (e) => e.stopPropagation());

    return { element: select, focus: () => select.focus() };
}
