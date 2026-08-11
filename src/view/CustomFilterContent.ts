/**
 * The body of a *custom* filter popover: a host's element, with the grid's Apply and Clear under
 * it.
 *
 * The counterpart of `OptionsFilterContent`, and deliberately the same shape — `element`,
 * `focus()`, `measure()`, `destroy()` — so `showFilterPopover` dispatches on the column and then
 * treats both identically. Everything below the body's own element is the grid's: the panel, the
 * two buttons, the click delegation, and the rule that an empty value removes the filter rather
 * than filtering to nothing.
 *
 * There is no equivalent of the checklist's preferred-height calculation. A host's element has an
 * intrinsic size, so the popover is left to take it.
 */

import type { Column, Filter, FilterBody, FilterDefinition } from "../types";
import { createButton } from "./Button";

export interface CustomFilterContentOptions<R> {
    column: Column<R>;
    definition: FilterDefinition<R>;
    /** The filter being edited — normalized, with its current value if it has one. */
    filter: Filter;
    /** Apply and close. A nullish value means the filter is removed. */
    onApply: (filter: Filter) => void;
    /** Close without applying — what `ctx.close()` calls. */
    onClose: () => void;
}

export class CustomFilterContent<R> {
    /** Append this to the popover's content. */
    readonly element: HTMLDivElement;

    private readonly options: CustomFilterContentOptions<R>;
    private readonly body: FilterBody;

    constructor(options: CustomFilterContentOptions<R>) {
        this.options = options;

        this.element = document.createElement("div");
        this.element.className = "avg-filter-content avg-custom-filter-content";

        this.body = options.definition.create({
            column: options.column,
            value: options.filter.value,
            filter: options.filter,
            // `apply` is `getValue` bypassed, for a body that applies on Enter or on a click of
            // its own. It is the same path the Apply button takes, so the two cannot disagree.
            apply: (value) => this.applyValue(value),
            close: () => options.onClose(),
        });
        if (!this.body || !(this.body.element instanceof HTMLElement)) {
            throw new Error(
                `av-grid: the "${options.definition.name}" filter on column ` +
                    `"${String(options.column.key)}" returned no element from \`create()\`. ` +
                    `Return { element, getValue }.`,
            );
        }
        if (typeof this.body.getValue !== "function") {
            throw new Error(
                `av-grid: the "${options.definition.name}" filter on column ` +
                    `"${String(options.column.key)}" returned no \`getValue\` from \`create()\`. ` +
                    `It is what Apply reads.`,
            );
        }

        const host = document.createElement("div");
        host.className = "avg-custom-filter-body";
        host.appendChild(this.body.element);

        const buttons = document.createElement("div");
        buttons.className = "avg-filter-buttons";
        // Never disabled, unlike the checklist's: only the body knows whether its value means
        // anything yet, and asking it on every keystroke would need a change event the
        // `FilterBody` contract does not have. Applying an empty value removes the filter, which
        // is the same thing Clear does, so the worst outcome of pressing it is Clear.
        buttons.append(
            createButton("Apply", "apply", { primary: true }),
            createButton("Clear", "clear"),
        );

        this.element.append(host, buttons);
        this.element.addEventListener("click", this.onClick);
    }

    /** Where the popover puts the focus on open — the body's choice, else its element. */
    focus(): void {
        if (this.body.focus) {
            this.body.focus();
            return;
        }
        const focusable = this.body.element.querySelector<HTMLElement>(
            "input, select, textarea, button, [tabindex]",
        );
        (focusable ?? this.body.element).focus?.();
    }

    /** Nothing to measure: a host's element sizes itself. Present so both bodies are one type. */
    measure(): void {}

    destroy(): void {
        this.element.removeEventListener("click", this.onClick);
        this.body.destroy?.();
        this.element.remove();
    }

    private onClick = (e: MouseEvent): void => {
        const action = (e.target as Element | null)?.closest?.("[data-action]");
        // `contains`, because the body is host DOM and may carry `data-action` of its own.
        if (!action || !this.element.contains(action)) return;
        if (this.body.element.contains(action)) return;

        switch (action.getAttribute("data-action")) {
            case "apply":
                this.applyValue(this.body.getValue());
                break;
            case "clear":
                this.applyValue(undefined);
                break;
        }
    };

    private applyValue(value: any): void {
        this.options.onApply({ ...this.options.filter, value });
    }
}
