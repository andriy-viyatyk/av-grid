/**
 * The options editor — used when a column carries `options`.
 *
 * ```ts
 * // Nothing new to write: a column with `options` gets this editor.
 * AVGrid.create("#host", {
 *     rows,
 *     editable: true,
 *     columns: [
 *         { key: "status", options: ["open", "pending", "closed"] },   // pick one
 *         { key: "city", options: knownCities, freeText: true },       // or type your own
 *     ],
 * });
 * ```
 *
 * **One editor, two modes.** The text is typed *in the cell*, into an input that sits where the
 * value was — exactly where `CellInput` puts it — and the list under it is a filtered view of the
 * options driven by that text. There is no search box in the popup: the cell *is* the search box,
 * and the focus never leaves it. What differs is what a commit takes:
 *
 * - **strict** (the default) — only an option, or empty to clear. After every keystroke the best
 *   match is highlighted (an exact match, case-sensitive then not, else the first in list order),
 *   and Enter or Tab commits it. Text matching nothing is never written: Enter does nothing (the
 *   input is marked `aria-invalid`), Tab cancels and moves on, and leaving the cell keeps the old
 *   value unless the text *is* an option — a prefix is never auto-picked on the way out.
 * - **suggest** (`freeText: true`) — nothing is highlighted while typing, so Enter keeps what was
 *   typed. An option is taken only when the user arrowed to it, clicked it, or typed its name
 *   (case-insensitively); anything else commits as typed. With no matching suggestion the popup
 *   hides and the editor is a plain text box.
 *
 * **Why it is not a `<select>`.** A native dropdown cannot be themed — its popup is drawn by the
 * platform — so this is `Popover` + `VirtualList` in single-pick mode, which brings: 10,000 options
 * open instantly (virtualized); **the picked value keeps its type** (the list addresses options by
 * *position*, so a numeric or `Date` option commits as itself rather than as `String(value)`, which
 * `defaultValidate`'s identity check against `column.options` needs); and theming by the grid's
 * own tokens.
 *
 * **Why the popup never takes the focus.** An outside click must commit through the blur rule,
 * and a click on a row must not blur the input first — so the popover swallows `mousedown` (the
 * event whose default action moves focus) and is told not to dismiss itself on Escape or on an
 * outside press: Escape reaches the input, and an outside press is reported here in the document's
 * capture phase, before whatever the press lands on can act — a press on another grid cell moves
 * the grid's focus, which would otherwise commit the edit first.
 *
 * `Column.options` may be an array, a function, or a function returning a promise. All three
 * resolve on every open, so a column can look its choices up when the cell is opened rather than
 * at definition time; the user may type while a promise is pending.
 *
 * Listeners are bound to elements created for this one edit and discarded with it, which the
 * root-delegation invariant allows: it is about pooled elements. The list's own rows are pooled,
 * and `VirtualList` delegates on its root as always.
 */

import type { EditorContext, MountedCellEditor } from "../types";
import { caretIndexAt } from "./CellInput";
import { chevronDownIcon } from "./icons";
import { Popover } from "./Popover";
import { VirtualList } from "./VirtualList";

/** The list's padding — everything in the popover that is not a row. */
const PADDING_HEIGHT = 8;
const ROW_HEIGHT = 24;
/** Two rows — enough that a list still loading, or saying nothing matches, is not a sliver. */
const MIN_ROWS = 2;
const MAX_HEIGHT = 320;

function label(value: unknown): string {
    return value === null || value === undefined ? "" : String(value);
}

/** What ending the edit should do — or `stay`, for a strict Enter with nothing to commit. */
type Decision = { kind: "commit"; value: unknown } | { kind: "keep" } | { kind: "stay" };

export function createCellSelect<R>(ctx: EditorContext<R>): MountedCellEditor {
    const freeText = ctx.column.freeText === true;
    // On a type-to-edit `ctx.value` is the character that started it, not the cell's value.
    const typed = ctx.openedBy === "typing";
    const current = typed ? (ctx.row as any)[ctx.column.key] : ctx.value;
    const currentLabel = label(current);

    const element = document.createElement("div");
    element.className = "avg-cell-editor avg-cell-select";
    element.setAttribute("data-type", "cell-editor");
    if (freeText) element.setAttribute("data-free-text", "");
    element.innerHTML =
        `<input class="avg-cell-select-input" type="text" autocomplete="off" spellcheck="false">` +
        `<span class="avg-cell-select-caret" aria-hidden="true">${chevronDownIcon}</span>`;
    const input = element.firstElementChild as HTMLInputElement;
    const caret = element.lastElementChild as HTMLElement;
    input.value = typed ? label(ctx.value) : currentLabel;

    const list = new VirtualList({
        className: "avg-cell-select-list",
        multiple: false,
        // The input in the cell is the search box; the list only narrows to it.
        search: false,
        emptyLabel: "no matching options",
        onActivate: (item) => finish(commitOf(values[Number(item.value)])),
    });

    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    if (list.listId) input.setAttribute("aria-controls", list.listId);

    const popover = new Popover({
        anchor: element,
        placement: "bottom-start",
        // Flush under the cell's border rather than the 4px a filter popover stands off by:
        // this one is the cell, continued.
        offset: [0, 1],
        className: "avg-cell-select-popover",
        matchAnchorWidth: true,
        // The input keeps the focus for the whole edit; see the file comment.
        autoFocus: false,
        closeOnEscape: false,
        closeOnOutside: false,
        onOutside: () => leave(),
    });
    popover.content.appendChild(list.element);

    /** Resolved options in list order — plus, in strict mode, the cell's own value first. */
    let values: unknown[] = [];
    /** `label(values[i]).toLowerCase()`, computed once per fill rather than per keystroke. */
    let lowered: string[] = [];
    /** Options from a promise that has not settled yet. */
    let pending = false;
    /** No keystroke yet — the open-time highlight (the current value) still stands. */
    let pristine = !typed;
    let popupVisible = false;
    let done = false;
    let disposed = false;

    // =========================================================================================
    // The list
    // =========================================================================================

    function fill(resolved: unknown, settled: boolean): void {
        if (disposed) return;
        pending = !settled;
        const options = Array.isArray(resolved) ? [...resolved] : [];
        // Strict: the cell's own value first when it is not among the choices, so opening the
        // editor never silently changes what the cell holds. Suggest: the text box already holds
        // it, and offering it back as a suggestion would only repeat it.
        values =
            freeText || options.some((v) => label(v) === currentLabel)
                ? options
                : [current, ...options];
        lowered = values.map((v) => label(v).toLowerCase());

        // `setItems` re-applies the current search text, so options arriving mid-typing land
        // already narrowed to it.
        list.setItems(values.map((v, index) => ({ value: index, label: label(v) })));
        const selected = values.findIndex((v) => label(v) === currentLabel);
        list.setSelected(selected >= 0 ? [selected] : []);

        if (pristine) {
            // Opened by key or pointer, nothing typed: the whole list, the current value
            // highlighted and centred. The search is empty, so a value index is a row index.
            list.setActiveIndex(selected);
            if (selected >= 0) list.scrollToIndex(selected, "center");
        } else {
            highlightForText();
        }
        sync();
    }

    /** The keystroke rule: what is highlighted after the text changed. */
    function highlightForText(): void {
        const text = input.value.trim();
        if (freeText || !text) {
            // Suggest never pre-picks — Enter must keep what was typed. Strict with no text has
            // nothing to match, and Enter then clears.
            list.setActiveIndex(-1);
            return;
        }
        const visible = list.getVisibleItems();
        let index = visible.findIndex((item) => item.label === text);
        if (index < 0) {
            const lower = text.toLowerCase();
            index = visible.findIndex((item) => lowered[Number(item.value)] === lower);
        }
        if (index < 0) index = visible.length ? 0 : -1;
        list.setActiveIndex(index);
        if (index >= 0) list.scrollToIndex(index);
    }

    /** Popup visibility and size, and every ARIA attribute the input carries. */
    function sync(): void {
        if (disposed) return;
        const count = list.getVisibleItems().length;
        // Suggest with nothing to suggest is a plain text box; strict always shows the list,
        // which then says that nothing matches.
        const visible = popover.isOpen && (!freeText || count > 0);
        if (visible !== popupVisible) {
            popupVisible = visible;
            popover.root.style.display = visible ? "" : "none";
        }
        input.setAttribute("aria-expanded", visible ? "true" : "false");

        const id = visible ? list.optionId(list.activeIndex) : undefined;
        if (id) input.setAttribute("aria-activedescendant", id);
        else input.removeAttribute("aria-activedescendant");

        const invalid = !freeText && !pending && count === 0 && input.value.trim() !== "";
        if (invalid) input.setAttribute("aria-invalid", "true");
        else input.removeAttribute("aria-invalid");

        if (!visible) return;
        const rows = freeText ? Math.max(1, count) : Math.max(MIN_ROWS, count);
        popover.content.style.height = `${Math.min(
            MAX_HEIGHT,
            PADDING_HEIGHT + rows * ROW_HEIGHT,
        )}px`;
        popover.reposition();
        list.measure();
    }

    // =========================================================================================
    // Ending the edit
    // =========================================================================================

    /** The option the text names: an exact match first, then a case-insensitive one. */
    function optionNamed(text: string): number {
        const trimmed = text.trim();
        const exact = values.findIndex((v) => label(v) === trimmed);
        if (exact >= 0) return exact;
        return lowered.indexOf(trimmed.toLowerCase());
    }

    function commitOf(value: unknown): Decision {
        // Committing what the cell already holds is keeping it. Cancelling rather than writing
        // it back matters for a strict cell whose value is not among its options: the write
        // would be rejected by `defaultValidate` and reported through `onInvalidEdit` for nothing.
        if (value === current || (label(value) === "" && currentLabel === "")) {
            return { kind: "keep" };
        }
        return { kind: "commit", value };
    }

    function decide(trigger: "enter" | "tab" | "blur"): Decision {
        const text = input.value;
        const active = popupVisible ? list.getActiveItem() : undefined;

        if (freeText) {
            if (active) return commitOf(values[Number(active.value)]);
            if (text === currentLabel) return { kind: "keep" };
            const named = optionNamed(text);
            // Exactly as typed otherwise — no trim: the text is the value.
            return commitOf(named >= 0 ? values[named] : text);
        }

        if (trigger === "blur") {
            // Leaving never auto-picks: only text that *is* an option, or untouched text.
            if (text === currentLabel) return { kind: "keep" };
            const named = optionNamed(text);
            return named >= 0 ? commitOf(values[named]) : { kind: "keep" };
        }
        if (pending && trigger === "enter") return { kind: "stay" };
        if (active) return commitOf(values[Number(active.value)]);
        if (text.trim() === "") return commitOf("");
        return trigger === "enter" ? { kind: "stay" } : { kind: "keep" };
    }

    /** Act on a decision. `e` is the Tab that should move the focus on afterwards. */
    function finish(decision: Decision, e?: KeyboardEvent): void {
        if (done || disposed || decision.kind === "stay") return;
        done = true;
        if (decision.kind === "commit") {
            ctx.setValue(decision.value);
            if (e) ctx.commitAndPass(e);
            else ctx.commit();
        } else {
            ctx.cancel();
            // Cancelled, then moved: `commitAndPass` on a closed edit only hands the key back.
            if (e) ctx.commitAndPass(e);
        }
    }

    /** Focus went elsewhere, or a press landed outside — the blur rule. */
    function leave(): void {
        finish(decide("blur"));
    }

    // =========================================================================================
    // Input
    // =========================================================================================

    function onInput(): void {
        pristine = false;
        list.setSearch(input.value);
        highlightForText();
        sync();
    }

    function onKeyDown(e: KeyboardEvent): void {
        // An IME owns every key until the composition ends — Enter there confirms a candidate.
        if (e.isComposing || e.keyCode === 229) {
            e.stopPropagation();
            return;
        }
        switch (e.key) {
            case "ArrowDown":
            case "ArrowUp": {
                e.preventDefault();
                e.stopPropagation();
                if (!popupVisible) return;
                const up = e.key === "ArrowUp";
                if (up && list.activeIndex <= 0) {
                    // Suggest: back above the first suggestion — nothing highlighted, the typed
                    // text stands. Strict stays on the first row; from none, ↑ has nowhere to go.
                    if (freeText) list.setActiveIndex(-1);
                } else {
                    list.moveActive(up ? -1 : 1);
                }
                sync();
                return;
            }
            case "PageDown":
            case "PageUp":
                e.preventDefault();
                e.stopPropagation();
                if (!popupVisible) return;
                list.moveActive(e.key === "PageUp" ? "pageUp" : "pageDown");
                sync();
                return;
            case "Enter":
            case "NumpadEnter":
                // Commits without moving.
                e.preventDefault();
                e.stopPropagation();
                finish(decide("enter"));
                return;
            case "Tab":
                e.preventDefault();
                finish(decide("tab"), e);
                return;
            case "Escape":
                // Handled here, and prevented: inside a modal `<dialog>` the default action of
                // Escape closes the dialog, and this key means only "cancel the edit".
                e.preventDefault();
                finish({ kind: "keep" });
                return;
            default:
                // Everything else is the text's — the caret keys, Space, the clipboard keys.
                e.stopPropagation();
        }
    }

    function onBlur(): void {
        if (done || disposed) return;
        // The window lost focus (another app, devtools): the input is still the active element
        // and will be again. Only a blur that moved the focus *within the page* leaves.
        if (input.ownerDocument.activeElement === input) return;
        leave();
    }

    /** A press on a row, the list's padding or its scrollbar must not take the focus. */
    function keepFocus(e: Event): void {
        e.preventDefault();
    }

    /** A press inside the editor is editing text, not selecting a range in the grid. */
    function stop(e: Event): void {
        e.stopPropagation();
    }

    function onCaretDown(e: Event): void {
        e.preventDefault();
        if (input.ownerDocument.activeElement !== input) input.focus({ preventScroll: true });
    }

    input.addEventListener("input", onInput);
    input.addEventListener("keydown", onKeyDown);
    input.addEventListener("blur", onBlur);
    element.addEventListener("pointerdown", stop);
    element.addEventListener("dblclick", stop);
    caret.addEventListener("mousedown", onCaretDown);
    // `mousedown`, not `pointerdown`: moving the focus is mousedown's default action, and
    // cancelling a pointerdown would suppress the compatibility mouse events as well.
    popover.root.addEventListener("mousedown", keepFocus);

    return {
        element,
        focus: () => {
            input.focus({ preventScroll: true });
            // Where the caret starts is `CellInput`'s rule: a key named the cell, so the value
            // is selected; a click named a place in it; typing put one character there.
            if (ctx.openedBy === "key") {
                input.select();
            } else {
                const end = input.value.length;
                const at =
                    ctx.openedBy === "pointer" && ctx.pointerX !== undefined
                        ? (caretIndexAt(input, ctx.pointerX) ?? end)
                        : end;
                input.setSelectionRange?.(at, at);
            }

            void popover.show();
            popupVisible = true;
            if (typed) list.setSearch(input.value);

            const source = ctx.column.options;
            let resolved: unknown;
            try {
                resolved = typeof source === "function" ? source() : (source ?? []);
            } catch (e) {
                console.warn("av-grid: column options failed to resolve:", e);
                resolved = [];
            }
            if (resolved instanceof Promise) {
                // Empty until it arrives; the input stays live and the list fills underneath.
                fill([], false);
                void resolved.then(
                    (options) => fill(options, true),
                    (e) => {
                        console.warn("av-grid: column options failed to resolve:", e);
                        fill([], true);
                    },
                );
            } else {
                fill(resolved, true);
            }
        },
        destroy: () => {
            disposed = true;
            input.removeEventListener("blur", onBlur);
            input.removeEventListener("input", onInput);
            input.removeEventListener("keydown", onKeyDown);
            element.removeEventListener("pointerdown", stop);
            element.removeEventListener("dblclick", stop);
            caret.removeEventListener("mousedown", onCaretDown);
            popover.root.removeEventListener("mousedown", keepFocus);
            popover.destroy();
            list.destroy();
            element.remove();
        },
    };
}
