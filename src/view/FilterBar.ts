/**
 * The filter bar: one removable chip per applied filter.
 *
 * ```js
 * // Mounted by the grid, directly above it.
 * const grid = AVGrid.create("#host", { rows, filterBar: true });
 *
 * // Or placed by hand, anywhere on the page — a toolbar, a sidebar, another panel entirely.
 * const grid = AVGrid.create("#grid", { rows });
 * const bar = AVGrid.createFilterBar("#toolbar", { grid });
 * ```
 *
 * Ported from `filters/FilterBar.tsx`, which was two components over UIKit's `Tag` and
 * `IconButton` and read its filters from a React context. Here the bar is a plain element that
 * subscribes to the grid's internal `onFiltersChanged`, so both mounting paths are the same
 * object and any number of bars can watch one grid.
 *
 * A chip reads `ColumnName: open,pending (+3)`. Clicking its body reopens the filter popover
 * **anchored to the chip**, which is what makes the bar an editing surface rather than a
 * read-out; the ✕ removes that one filter, and the ✕ at the right end removes all of them. With
 * no filters applied the bar takes no space at all.
 *
 * **Not ported:** the reference's "rows are frozen while editing" refresh button. Freezing is a
 * Persephone editing concern that happens to have been rendered in the filter bar.
 */

import type { AVGridModel } from "../model/AVGridModel";
import type { Column, DisplayFormat, Filter } from "../types";
import { formatDisplayValue } from "../gridUtils";
import { createIconButton } from "./Button";
import { chevronDownIcon, chevronUpIcon, closeIcon } from "./icons";
import { showFilterPopover } from "./FilterPopover";

/**
 * How much of the value list a chip shows before it becomes a count.
 *
 * The reference's number, and worth keeping: it is short enough that a filter on twenty values
 * cannot push the other chips off the bar, and long enough that the common one- or two-value
 * filter is shown in full.
 */
const MAX_LABEL_CHARS = 25;

/** The same name the checklist gives a blank label, so one option reads the same in both. */
const EMPTY_LABEL = "(empty)";

/** The gap between a chip and the popover it opens. Clears the chip's border and padding. */
const CHIP_OFFSET: [number, number] = [0, 4];

/**
 * One option, as text.
 *
 * The reference formatted the option's *label* — `formatDispayValue(option.label, format)` —
 * which round-trips a date through a string and back. Here a `Date` is formatted from the value
 * it still has, and everything else uses the label it was given. That matters for the options
 * the grid supplies itself: `(null)` re-parsed as a date is `NaN`, which the reference would
 * have rendered as an empty chip.
 */
function optionText(option: any, displayFormat?: DisplayFormat): string {
    if (option?.value instanceof Date) {
        return formatDisplayValue(option.value, displayFormat);
    }
    const label = option?.label ?? String(option?.value ?? "");
    return label.length ? label : EMPTY_LABEL;
}

/**
 * The value list of an `"options"` filter, truncated to `maxCharCount` with the remainder as a
 * count: `open,pending (+3)`.
 *
 * Ported from `optionsFilterValues()`, character budget and all — including that the budget is
 * spent on the values and not on the commas between them, so the result runs a little over. It
 * is a label, not a layout constraint; the chip ellipsizes anything that still does not fit.
 */
export function optionsFilterValues(filter: Filter, maxCharCount: number): string {
    const values = Array.isArray(filter.value) ? [...filter.value] : [];
    let text = "";

    while (text.length < maxCharCount && values.length) {
        let part = optionText(values.shift(), filter.displayFormat);
        if (text.length + part.length > maxCharCount) {
            part = part.substring(0, maxCharCount - text.length);
        }
        text += `${text ? "," : ""}${part}`;
    }

    return values.length ? `${text} (+${values.length})` : text;
}

/**
 * The chip's text: a custom filter's own `label`, else the built-in value list.
 *
 * The host's label is not truncated. `MAX_LABEL_CHARS` exists because a checklist of twenty
 * values would push every other chip off the bar; a `label` that long is the definition's
 * decision, and the chip ellipsizes what does not fit.
 *
 * Guarded, because it is host code on the bar's redraw path: a throw here would leave the bar
 * permanently stale rather than showing one wrong chip.
 */
function filterValues<R>(
    filter: Filter,
    maxCharCount: number,
    column?: Column<R>,
): string {
    const definition = column?.filter;
    if (definition) {
        try {
            return definition.label(filter.value, column!);
        } catch (e) {
            console.warn(
                `av-grid: the "${definition.name}" filter's \`label\` threw for column ` +
                    `"${filter.columnKey}":`,
                e,
            );
            return definition.name;
        }
    }
    return optionsFilterValues(filter, maxCharCount);
}

/** Every value, for the chip's tooltip — the whole list the label had to cut short. */
function fullValues<R>(filter: Filter, column?: Column<R>): string {
    // A custom filter has one label and no list behind it, so the tooltip is that label.
    if (column?.filter) return filterValues(filter, MAX_LABEL_CHARS, column);
    const values = Array.isArray(filter.value) ? filter.value : [];
    return values.map((o) => optionText(o, filter.displayFormat)).join(", ");
}

export interface FilterBarOptions<R = any> {
    /** The grid whose filters this bar shows. */
    model: AVGridModel<R>;
    /** Added to the bar's root element. */
    className?: string;
    /** Emitted as `data-name`, for finding this bar in a test or a devtools tree. */
    name?: string;
}

export class FilterBar<R = any> {
    /** The bar's root. Append it wherever you want the bar to be. */
    readonly element: HTMLDivElement;

    private readonly model: AVGridModel<R>;
    private readonly chips: HTMLDivElement;
    private readonly clearButton: HTMLButtonElement;
    private readonly subscription: { unsubscribe: () => void };

    /**
     * Chips by column key, kept across redraws so an open popover's anchor stays in the
     * document. Rebuilt only when the chip's own text changes — which is what `data-signature`
     * on the element records.
     */
    private readonly chipElements = new Map<string, HTMLElement>();

    /** Which chip's popover is open, so its caret points up and it stays lit. */
    private openKey?: string;

    private destroyed = false;

    constructor(options: FilterBarOptions<R>) {
        this.model = options.model;

        const doc = document;
        this.element = doc.createElement("div");
        this.element.className = ["avg-filter-bar", options.className]
            .filter(Boolean)
            .join(" ");
        this.element.setAttribute("data-type", "filter-bar");
        if (options.name) this.element.setAttribute("data-name", options.name);

        this.chips = doc.createElement("div");
        this.chips.className = "avg-filter-bar-chips";
        this.clearButton = createIconButton(closeIcon, "clear-all", {
            title: "Remove all filters",
            className: "avg-filter-bar-clear",
        });
        this.element.append(this.chips, this.clearButton);

        // One listener for the whole bar, resolved by `data-action` — the same rule the grid
        // itself follows, and the reason a chip can be rebuilt without unbinding anything.
        this.element.addEventListener("click", this.onClick);
        this.subscription = this.model.events.onFiltersChanged.subscribe(this.refresh);

        this.refresh();
    }

    /** Redraw from the model. Called for you whenever the filters change. */
    refresh = (): void => {
        if (this.destroyed) return;

        const filters = this.model.models.filters.filters;
        const next: HTMLElement[] = [];
        const live = new Set<string>();

        for (const filter of filters) {
            const key = filter.columnKey;
            const column = this.columnFor(key);
            const signature = this.signature(filter, column);
            let chip = this.chipElements.get(key);
            if (!chip || chip.getAttribute("data-signature") !== signature) {
                chip = this.buildChip(filter, signature, column);
                this.chipElements.set(key, chip);
            }
            live.add(key);
            next.push(chip);
        }

        for (const key of Array.from(this.chipElements.keys())) {
            if (!live.has(key)) this.chipElements.delete(key);
        }

        this.chips.replaceChildren(...next);
        // Hidden rather than empty: an empty bar is a strip of border and background that looks
        // like a rendering fault, and it would push the grid down for nothing.
        this.element.classList.toggle("avg-filter-bar-empty", !filters.length);
        this.syncOpen();
    };

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.element.removeEventListener("click", this.onClick);
        this.subscription.unsubscribe();
        // Only if it is ours: another bar, or the header funnel, may own the open popover.
        if (this.openKey && this.model.flags.filterPopover?.columnKey === this.openKey) {
            this.model.flags.filterPopover.close();
        }
        this.chipElements.clear();
        this.element.remove();
    }

    // =========================================================================================
    // Chips
    // =========================================================================================

    /** What a chip renders, as one string. Different signature, different chip. */
    private signature(filter: Filter, column?: Column<R>): string {
        return `${filter.columnName ?? filter.columnKey} ${filterValues(
            filter,
            MAX_LABEL_CHARS,
            column,
        )}`;
    }

    /** The column a filter names, for its `filter` definition. Undefined if it has gone. */
    private columnFor(columnKey: string): Column<R> | undefined {
        return this.model.data.columns.find((c) => String(c.key) === columnKey);
    }

    private buildChip(
        filter: Filter,
        signature: string,
        column?: Column<R>,
    ): HTMLElement {
        const chip = document.createElement("span");
        chip.className = "avg-filter-chip";
        chip.setAttribute("data-signature", signature);
        // The key goes on the chip rather than being looked up by position: chips are rebuilt
        // as the filters change, and a handler that read an index would act on the wrong one.
        chip.setAttribute("data-column-key", filter.columnKey);

        const body = document.createElement("span");
        body.className = "avg-filter-chip-body";
        body.setAttribute("data-action", "edit");
        body.title = `${filter.columnName ?? filter.columnKey}: ${fullValues(filter, column)}`;

        const name = document.createElement("span");
        name.className = "avg-filter-chip-name";
        name.textContent = `${filter.columnName ?? filter.columnKey}:`;

        const values = document.createElement("span");
        values.className = "avg-filter-chip-values";
        values.textContent = filterValues(filter, MAX_LABEL_CHARS, column);

        const caret = document.createElement("span");
        caret.className = "avg-filter-chip-caret";
        caret.innerHTML = chevronDownIcon;

        body.append(name, values, caret);
        chip.append(
            body,
            createIconButton(closeIcon, "remove", {
                title: "Remove filter",
                className: "avg-filter-chip-remove",
            }),
        );
        return chip;
    }

    /** Point the open chip's caret up and light it. Nothing else about the chip changes. */
    private syncOpen(): void {
        for (const [key, chip] of this.chipElements) {
            const open = key === this.openKey;
            chip.classList.toggle("avg-filter-chip-open", open);
            const caret = chip.querySelector(".avg-filter-chip-caret");
            if (caret) caret.innerHTML = open ? chevronUpIcon : chevronDownIcon;
        }
    }

    // =========================================================================================
    // Interaction
    // =========================================================================================

    private onClick = (e: MouseEvent): void => {
        const target = (e.target as Element | null)?.closest?.("[data-action]");
        if (!target || !this.element.contains(target)) return;

        const action = target.getAttribute("data-action");
        if (action === "clear-all") {
            this.model.models.filters.clearFilters();
            return;
        }

        const columnKey = target
            .closest(".avg-filter-chip")
            ?.getAttribute("data-column-key");
        if (!columnKey) return;

        if (action === "remove") {
            this.model.models.filters.removeFilter(columnKey);
        } else if (action === "edit") {
            void this.edit(columnKey, target);
        }
    };

    /**
     * Open this chip's popover, anchored to the chip body, and keep the chip lit until it
     * closes.
     *
     * A second click closes instead of reopening — `Popover` exempts its own anchor from
     * outside-dismissal so that this decision is made here, exactly as the header funnel makes
     * it. The ✕ is *outside* the anchor, so clicking it while the popover is open dismisses it
     * and removes the filter, which is the one thing a user doing that can have meant.
     */
    private async edit(columnKey: string, anchor: Element): Promise<void> {
        if (this.model.flags.filterPopover?.columnKey === columnKey) {
            this.model.flags.filterPopover.close();
            return;
        }

        this.openKey = columnKey;
        this.syncOpen();
        try {
            await showFilterPopover(this.model, columnKey, {
                anchor,
                offset: CHIP_OFFSET,
            });
        } finally {
            // Only if it is still this chip's: a click on another chip opens that one before
            // this promise settles, and clearing the flag then would unlight the wrong chip.
            if (this.openKey === columnKey) {
                this.openKey = undefined;
                this.syncOpen();
            }
        }
    }
}
