/**
 * The body of a `"text"` filter popover: one text input and a row of operator chips — by default
 * contains, equals, starts with; `Column.textFilterOps` names others, including the two text-free
 * state operators *is empty* / *is not empty* — with **Apply** and **Clear** under them.
 *
 * The third body `showFilterPopover` can build, beside the checklist and a host's custom
 * element, and deliberately the same shape — `element`, `focus()`, `measure()`, `destroy()` —
 * so the dispatch stays a switch with no special cases after it.
 *
 * The rules it shares with the checklist:
 *
 * - applying **empty text removes** the filter instead of filtering to nothing — for the
 *   comparing operators; a text-free operator applies as `{ op }` whatever the input holds;
 * - the value it produces is JSON-shaped (`{ op, text }`), so persistence needs no `serialize`;
 * - **Enter applies**, exactly as the Apply button does.
 *
 * The input comes first in the DOM — stretched to the popover's width — so Alt+↓ opens the
 * popover with the caret already in it. The operators are a row of chips under it, one always
 * pressed: buttons carrying radio semantics (`role="radiogroup"` / `role="radio"` /
 * `aria-checked`), cyclable with the arrow keys as a radio group is.
 */

import type { Filter, TextFilterOp, TextFilterValue } from "../types";
import {
    DEFAULT_TEXT_FILTER_OPS,
    textFilterOpLabel,
    textFilterOpNeedsText,
} from "../textFilterOps";
import { createButton } from "./Button";

/** Narrower and the input is not worth typing into; matches the checklist's floor. */
export const TEXT_FILTER_MIN_WIDTH = 260;

const PLACEHOLDER = "filter text…";
const PLACEHOLDER_UNUSED = "no text needed";

export interface TextFilterContentOptions {
    /** The filter being edited — normalized, with its current `{ op, text }` if it has one. */
    filter: Filter;
    /**
     * The chips to offer, in order — `Column.textFilterOps`, or the default three. An applied
     * op the list omits is appended, so the pressed chip always exists.
     */
    ops?: readonly TextFilterOp[];
    /** Apply and close. A nullish value means the filter is removed. */
    onApply: (filter: Filter) => void;
}

export class TextFilterContent {
    /** Append this to the popover's content. */
    readonly element: HTMLDivElement;

    private readonly options: TextFilterContentOptions;
    private readonly input: HTMLInputElement;
    private readonly chips: HTMLButtonElement[] = [];
    private readonly ops: readonly TextFilterOp[];
    private op: TextFilterOp;

    constructor(options: TextFilterContentOptions) {
        this.options = options;
        const current = options.filter.value as TextFilterValue | undefined;
        const offered = options.ops ?? DEFAULT_TEXT_FILTER_OPS;
        // The applied op is always a chip, even when the column's list left it out: a filter
        // restored from persistence, or set through `setFilters`, may name one — and without
        // its chip nothing would be pressed and the roving tabindex would have nothing to land on.
        this.ops =
            current?.op && !offered.includes(current.op) ? [...offered, current.op] : offered;
        this.op = current?.op ?? this.ops[0];

        this.element = document.createElement("div");
        this.element.className = "avg-filter-content avg-text-filter-content";
        this.element.style.minWidth = `${TEXT_FILTER_MIN_WIDTH}px`;

        const body = document.createElement("div");
        body.className = "avg-text-filter-body";

        this.input = document.createElement("input");
        this.input.type = "text";
        this.input.className = "avg-text-filter-input";
        this.input.value = current?.text ?? "";
        this.input.addEventListener("keydown", this.onKeyDown);
        body.appendChild(this.input);

        // The operators, as one row of chips under the input — buttons wearing radio
        // semantics, so a screen reader hears the same one-of-three a radio group is.
        const group = document.createElement("div");
        group.className = "avg-text-filter-ops";
        group.setAttribute("role", "radiogroup");
        group.setAttribute("aria-label", "Match");
        group.addEventListener("keydown", this.onGroupKeyDown);
        for (const op of this.ops) {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "avg-text-filter-op";
            chip.setAttribute("role", "radio");
            chip.setAttribute("data-op", op);
            chip.textContent = textFilterOpLabel(op);
            chip.addEventListener("click", () => this.selectOp(op));
            this.chips.push(chip);
            group.appendChild(chip);
        }
        this.syncChips();
        body.appendChild(group);

        const buttons = document.createElement("div");
        buttons.className = "avg-filter-buttons";
        // Never disabled: applying empty text removes the filter, which is what Clear does, so
        // the worst outcome of pressing it is Clear — the same reasoning as the custom body's.
        buttons.append(
            createButton("Apply", "apply", { primary: true }),
            createButton("Clear", "clear"),
        );

        this.element.append(body, buttons);
        this.element.addEventListener("click", this.onClick);
    }

    /** Focus the input with its text selected, so typing replaces what is applied. */
    focus(): void {
        this.input.focus();
        this.input.select();
    }

    /** Nothing to measure: the body has an intrinsic size. Present so all bodies are one type. */
    measure(): void {}

    destroy(): void {
        this.element.removeEventListener("click", this.onClick);
        this.input.removeEventListener("keydown", this.onKeyDown);
        this.element.remove();
    }

    private selectOp(op: TextFilterOp): void {
        this.op = op;
        this.syncChips();
    }

    /**
     * One chip pressed, and only that one in the tab order — the roving-tabindex pattern. The
     * input follows the op: under a text-free operator it stays enabled (Enter still applies
     * from it) but says so, and whatever it holds is ignored on Apply.
     */
    private syncChips(): void {
        for (const chip of this.chips) {
            const selected = chip.getAttribute("data-op") === this.op;
            chip.setAttribute("aria-checked", String(selected));
            chip.tabIndex = selected ? 0 : -1;
            chip.classList.toggle("avg-text-filter-op-selected", selected);
        }
        const needsText = textFilterOpNeedsText(this.op);
        this.input.placeholder = needsText ? PLACEHOLDER : PLACEHOLDER_UNUSED;
        this.element.classList.toggle("avg-text-filter-text-unused", !needsText);
    }

    private onKeyDown = (e: KeyboardEvent): void => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        e.stopPropagation();
        this.apply();
    };

    /** Arrow keys cycle the chips, exactly as they would a radio group. */
    private onGroupKeyDown = (e: KeyboardEvent): void => {
        const forward = e.key === "ArrowRight" || e.key === "ArrowDown";
        const backward = e.key === "ArrowLeft" || e.key === "ArrowUp";
        if (!forward && !backward) return;
        e.preventDefault();
        e.stopPropagation();
        const index = this.ops.indexOf(this.op);
        const next = (index + (forward ? 1 : this.ops.length - 1)) % this.ops.length;
        this.selectOp(this.ops[next]);
        this.chips[next].focus();
    };

    private onClick = (e: MouseEvent): void => {
        const action = (e.target as Element | null)?.closest?.("[data-action]");
        if (!action || !this.element.contains(action)) return;

        switch (action.getAttribute("data-action")) {
            case "apply":
                this.apply();
                break;
            case "clear":
                this.options.onApply({ ...this.options.filter, value: undefined });
                break;
        }
    };

    private apply(): void {
        // A text-free operator is a filter by itself — `{ op }`, whatever the input holds. This
        // branch is the one that matters: without it, *is empty* + Apply would fall into the
        // empty-text rule below and *remove* the filter.
        if (!textFilterOpNeedsText(this.op)) {
            this.options.onApply({
                ...this.options.filter,
                value: { op: this.op } as TextFilterValue,
            });
            return;
        }
        // Trimmed, and `undefined` when trimmed-empty: the model reads a nullish value as
        // "remove this filter" — the same rule the checklist's empty selection follows.
        const text = this.input.value.trim();
        this.options.onApply({
            ...this.options.filter,
            value: text.length ? ({ op: this.op, text } as TextFilterValue) : undefined,
        });
    }
}
