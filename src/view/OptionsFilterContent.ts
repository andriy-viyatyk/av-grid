/**
 * The body of an `"options"` filter popover: a searchable checklist of a column's values, with
 * select-all, **Apply** and **Clear**.
 *
 * Ported from `filters/OptionsFilterContent.tsx`, which was ~160 lines of React over `Button`
 * and `MultiListBox`. Everything that made it a component — `useState`, four `useMemo`s, the
 * option/item round-tripping `MultiListBox` forced — is gone; what is kept is its behaviour,
 * and four rules in particular:
 *
 * - already-selected options are **hoisted to the top**, so the current selection is visible
 *   without scrolling;
 * - an empty label renders as `(empty)` rather than a blank row;
 * - applying an **empty selection removes** the filter instead of filtering to nothing;
 * - `onGetOptions` **may return a promise**, and an overtaken response is discarded.
 *
 * **Why the list is keyed by index.** `VirtualList` addresses items by a `string | number`
 * value, and a filter option's value is whatever was in the column — a `Date`, a boolean,
 * `null`. So the list is given the option's *position* as its value and this class maps back.
 * That also makes the two identity questions separate ones: the list compares positions, and
 * carrying a selection across a re-fetch compares `optionKey`, where a `Date` is its instant.
 */

import type { AVGridModel } from "../model/AVGridModel";
import type { DisplayOption, Filter } from "../types";
import { VirtualList, type VirtualListItem } from "./VirtualList";
import { createButton } from "./Button";

/** Narrower than this and the labels are unreadable; the popover grows to the anchor's width. */
export const OPTIONS_FILTER_MIN_WIDTH = 260;

const EMPTY_LABEL = "(empty)";

export interface OptionsFilterContentOptions<R> {
    model: AVGridModel<R>;
    /** The filter being edited — normalized, with its current value if it has one. */
    filter: Filter;
    /** Apply and close. An empty value means the filter is removed. */
    onApply: (filter: Filter) => void;
    /** Minimum width, usually the anchor's. */
    width?: number;
    /**
     * How tall the body would like to be, given the options it just received.
     *
     * A virtualized list has to be told its height — it cannot take it from its rows, which is
     * the whole point of it. So the popover is sized from the outside, and asked again whenever
     * the option count changes. Ignored once the user has resized: a size they chose outranks
     * one computed for them.
     */
    onPreferredHeight?: (height: number) => void;
}

/** Search box, select-all row, buttons and padding — everything that is not a list row. */
const CHROME_HEIGHT = 34 + 25 + 41 + 8;
const ROW_HEIGHT = 24;
/** Below this the list is not worth opening; above it, it is taller than most anchors' room. */
const MIN_HEIGHT = 180;
const MAX_HEIGHT = 380;

/**
 * An option's identity across a re-fetch. Dates by instant, everything else by type and text —
 * `1` and `"1"` are different options and must not collapse into one.
 */
function optionKey(value: any): string {
    if (value instanceof Date) return `date:${value.getTime()}`;
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    return `${typeof value}:${String(value)}`;
}

function displayLabel(option: DisplayOption): string {
    const label = option.label ?? String(option.value ?? "");
    return label.length ? label : EMPTY_LABEL;
}

export class OptionsFilterContent<R> {
    /** Append this to the popover's content. */
    readonly element: HTMLDivElement;

    private readonly options: OptionsFilterContentOptions<R>;
    private readonly list: VirtualList;
    private readonly applyButton: HTMLButtonElement;

    /** The options currently offered, in list order. The list's values index into this. */
    private offered: DisplayOption[] = [];
    /** What is ticked — kept as options, not indices, so it survives a re-fetch. */
    private selected: DisplayOption[];
    /**
     * Which request the list is showing. A promise that resolves after a newer one was sent is
     * dropped: with a host fetching per keystroke, the slow first response would otherwise
     * arrive last and replace the right answer with a stale one.
     */
    private request = 0;

    constructor(options: OptionsFilterContentOptions<R>) {
        this.options = options;
        this.selected = Array.isArray(options.filter.value)
            ? [...(options.filter.value as DisplayOption[])]
            : [];

        this.element = document.createElement("div");
        this.element.className = "avg-filter-content";
        this.element.style.minWidth = `${Math.max(
            options.width ?? 0,
            OPTIONS_FILTER_MIN_WIDTH,
        )}px`;

        this.list = new VirtualList({
            className: "avg-filter-list",
            emptyLabel: "no values",
            searchPlaceholder: "search values…",
            // The host owns the narrowing only when it asked to: `onGetOptions` is re-called
            // with the search text either way, but a host that ignores the argument must still
            // get a working search box, so the list keeps filtering locally as well. Over the
            // built-in options that is a second pass on an already-narrowed list — free — and
            // over a host's it is the difference between a search that works and one that
            // silently does nothing.
            onChange: () => this.onSelectionChange(),
        });
        this.list.element.addEventListener("input", this.onSearchInput);
        this.element.appendChild(this.list.element);

        const buttons = document.createElement("div");
        buttons.className = "avg-filter-buttons";
        this.applyButton = createButton("Apply", "apply", { primary: true });
        buttons.append(this.applyButton, createButton("Clear", "clear"));
        this.element.appendChild(buttons);

        this.element.addEventListener("click", this.onClick);

        this.load(undefined);
    }

    /** Focus the search box, so a user can type straight into a list of forty thousand. */
    focus(): void {
        this.list.focus();
    }

    /** Re-measure once the popover holding this is on screen. */
    measure(): void {
        this.list.measure();
    }

    destroy(): void {
        this.element.removeEventListener("click", this.onClick);
        this.list.element.removeEventListener("input", this.onSearchInput);
        this.list.destroy();
        this.element.remove();
    }

    // =========================================================================================
    // Options
    // =========================================================================================

    private load(search: string | undefined): void {
        const token = ++this.request;
        const result = this.options.model.models.filters.getOptions(
            this.options.filter.columnKey,
            search,
        );

        if (Array.isArray(result)) {
            this.setOptions(result);
            return;
        }
        // Only a genuinely async provider gets a loading row — showing one for the synchronous
        // default would flash it on every keystroke.
        this.list.setItems([]);
        void Promise.resolve(result).then(
            (options) => {
                if (token === this.request) this.setOptions(options);
            },
            (e) => {
                if (token !== this.request) return;
                console.warn("av-grid: onGetOptions failed:", e);
                this.setOptions([]);
            },
        );
    }

    private setOptions(options: readonly DisplayOption[]): void {
        // Hoisted against the *filter's* value rather than the live selection: the point is to
        // show what is already filtered without scrolling, and re-sorting under a click the
        // user just made would move the next row out from under the pointer.
        const applied = new Set(
            (Array.isArray(this.options.filter.value)
                ? (this.options.filter.value as DisplayOption[])
                : []
            ).map((o) => optionKey(o?.value)),
        );

        const top: DisplayOption[] = [];
        const rest: DisplayOption[] = [];
        for (const option of options) {
            (applied.has(optionKey(option?.value)) ? top : rest).push(option);
        }
        this.offered = [...top, ...rest];

        const items = this.offered.map<VirtualListItem>((option, index) => ({
            value: index,
            label: displayLabel(option),
        }));
        this.list.setItems(items);

        // A selection made before the options changed is carried over by value, so typing in
        // the search box never silently unticks what is no longer on screen.
        const byKey = new Map(this.offered.map((o, i) => [optionKey(o?.value), i]));
        const indices: number[] = [];
        for (const option of this.selected) {
            const index = byKey.get(optionKey(option?.value));
            if (index !== undefined) indices.push(index);
        }
        this.list.setSelected(indices);
        this.syncApply();

        this.options.onPreferredHeight?.(
            Math.min(
                MAX_HEIGHT,
                Math.max(MIN_HEIGHT, CHROME_HEIGHT + this.offered.length * ROW_HEIGHT),
            ),
        );
    }

    private onSearchInput = (): void => {
        // The list has already narrowed what it holds; this re-asks the provider in case it can
        // offer more than it did — a host querying a database of values that were never all in
        // the browser. The built-in provider answers synchronously from the rows it has.
        this.load(this.list.search || undefined);
    };

    // =========================================================================================
    // Selection and the two buttons
    // =========================================================================================

    private onSelectionChange(): void {
        // Only the options currently offered can have been ticked or unticked, so a selection
        // held over from a previous search survives — the same rule `VirtualList` applies to
        // select-all one level down.
        const offeredKeys = new Set(this.offered.map((o) => optionKey(o?.value)));
        const kept = this.selected.filter((o) => !offeredKeys.has(optionKey(o?.value)));
        const picked = this.list
            .getSelected()
            .map((index) => this.offered[index as number])
            .filter(Boolean);

        this.selected = [...kept, ...picked];
        this.syncApply();
    }

    private syncApply(): void {
        // Apply with nothing ticked *is* Clear, and offering it twice invites the reading that
        // one of them means "show no rows".
        this.applyButton.disabled = !this.selected.length;
    }

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
        const seen = new Set<string>();
        const value: DisplayOption[] = [];
        for (const option of this.selected) {
            const key = optionKey(option?.value);
            if (seen.has(key)) continue;
            seen.add(key);
            value.push(option);
        }
        // `undefined`, not `[]`, when nothing is ticked: the model reads a nullish value as
        // "remove this filter", which is the whole reason apply and remove are one call.
        this.options.onApply({
            ...this.options.filter,
            value: value.length ? value : undefined,
        });
    }
}
