/**
 * A virtualized list of selectable rows — the body of the filter popover, and later the cell
 * dropdown.
 *
 * ```ts
 * const list = new VirtualList({
 *     items: distinctValues,          // [{ value, label? }]
 *     selected: filter.value,
 *     onChange: (values) => (pending = values),
 * });
 * popover.content.append(list.element);
 * ```
 *
 * **Why this exists.** A distinct-values checklist over a 100k-row column can legitimately
 * produce tens of thousands of options, and the reference hands all of them to `MultiListBox`
 * at once. Unvirtualized that is 50,000 DOM rows inside a popover — the one place in the
 * design that would reintroduce exactly the cost this library exists to avoid.
 *
 * **Why it is not a port.** `ListBox` + `ListBoxModel` + `ListItem` + `SectionItem` +
 * `MultiListBox` is ~1,100 lines of React carrying sections, groups, traits and a
 * general-purpose item API. What is needed here is checkbox rows, a search box, select-all and
 * `scrollToIndex`, over the engine this project already owns. What *is* taken from the
 * reference is its behaviour, which is worth being precise about: the keyboard map from
 * `ListBoxModel.onKeyDown`, and `MultiListBox`'s rule that **search and select-all compose** —
 * the tri-state reflects the rows currently matching the search, and toggling it affects those
 * rows only, leaving a selection made under a different search alone.
 *
 * The three invariants that carry the grid's performance apply here unchanged: a row resolves
 * `p.previous ?? p.recycle?.()`, every listener is on the root, and no state a repaint would
 * overwrite is kept on an element.
 */

import { RenderGrid } from "../render/RenderGrid";
import type { RenderCellParams, RowAlign } from "../render/types";
import { applyCellStyle, setText } from "./cellDom";
import { checkedIcon, indeterminateIcon, uncheckedIcon } from "./icons";

export type VirtualListValue = string | number;

export interface VirtualListItem {
    value: VirtualListValue;
    /** Falls back to `String(value)`. An empty label is the caller's to name — see below. */
    label?: string;
    disabled?: boolean;
}

export interface VirtualListOptions {
    items?: VirtualListItem[];
    /** Initially selected values. */
    selected?: readonly VirtualListValue[];
    /** Checkboxes and a multi-value selection. `false` gives a single-pick list. Default true. */
    multiple?: boolean;
    /** Show the search box. Default true. */
    search?: boolean;
    searchPlaceholder?: string;
    /** Show the select-all row. Defaults to `multiple`. */
    selectAll?: boolean;
    selectAllLabel?: string;
    /** Shown in place of the rows when nothing matches. */
    emptyLabel?: string;
    rowHeight?: number;
    className?: string;
    /** Fired on every selection change, with the values in the order they were selected. */
    onChange?: (values: VirtualListValue[], items: VirtualListItem[]) => void;
    /** Enter, or a click in single-pick mode. */
    onActivate?: (item: VirtualListItem) => void;
    /**
     * Take over filtering. When set, the list stops matching the search text itself and just
     * reports what was typed — the caller narrows the options and calls `setItems`.
     *
     * This is the seam `onGetOptions(columns, filters, columnKey, search?)` needs: the
     * reference already assumed a host might narrow a million rows' worth of options at the
     * source rather than return every one.
     */
    onSearch?: (text: string) => void;
}

const DEFAULT_ROW_HEIGHT = 24;

const CHECKED = `<span class="avg-list-box avg-checked">${checkedIcon}</span>`;
const UNCHECKED = `<span class="avg-list-box">${uncheckedIcon}</span>`;
const INDETERMINATE = `<span class="avg-list-box avg-checked">${indeterminateIcon}</span>`;

export class VirtualList {
    /** The whole list — search box, select-all row and the scrolling body. Append this. */
    readonly element: HTMLDivElement;

    private readonly options: VirtualListOptions;
    private readonly body: HTMLDivElement;
    private readonly searchInput?: HTMLInputElement;
    private readonly selectAllRow?: HTMLDivElement;
    private readonly emptyEl: HTMLDivElement;
    /**
     * The engine underneath. Public for the same reason `AVGrid.render` is: paint timings and
     * pool hit/miss counts are how a change here is judged, and there is no measuring them
     * from outside.
     */
    readonly render: RenderGrid;

    private items: VirtualListItem[] = [];
    /** The rows on screen: `items` narrowed by the search. */
    private filtered: VirtualListItem[] = [];
    /**
     * A Set for the membership test a repaint does per visible row, and an array because the
     * order options were picked in is what `onChange` reports and what the filter chip shows.
     */
    private readonly selectedSet = new Set<VirtualListValue>();
    private selectedOrder: VirtualListValue[] = [];
    private searchText = "";
    private _activeIndex = -1;

    constructor(options: VirtualListOptions) {
        this.options = options;
        const multiple = options.multiple !== false;

        this.element = document.createElement("div");
        this.element.className = `avg-list${options.className ? ` ${options.className}` : ""}`;
        this.element.setAttribute("data-type", "list");
        if (multiple) this.element.setAttribute("data-multiple", "");

        if (options.search !== false) {
            this.searchInput = document.createElement("input");
            this.searchInput.className = "avg-list-search";
            this.searchInput.type = "text";
            this.searchInput.placeholder = options.searchPlaceholder ?? "search…";
            this.element.appendChild(this.searchInput);
        }

        if (options.selectAll ?? multiple) {
            this.selectAllRow = document.createElement("div");
            this.selectAllRow.className = "avg-list-item avg-list-all";
            this.selectAllRow.setAttribute("data-list-action", "all");
            this.selectAllRow.innerHTML = `${UNCHECKED}<span class="avg-list-label"></span>`;
            setText(
                this.selectAllRow.lastElementChild as HTMLElement,
                options.selectAllLabel ?? "select all",
            );
            this.element.appendChild(this.selectAllRow);
        }

        this.body = document.createElement("div");
        this.body.className = "avg-list-body";
        this.element.appendChild(this.body);

        this.emptyEl = document.createElement("div");
        this.emptyEl.className = "avg-list-empty";
        setText(this.emptyEl, options.emptyLabel ?? "no matches");
        this.emptyEl.style.display = "none";
        this.element.appendChild(this.emptyEl);

        // State before engine, deliberately. `RenderGrid` paints synchronously in its own
        // constructor so a grid is on screen when it returns; building it against an empty
        // `filtered` would spend that paint on nothing and leave the list blank until the
        // next frame.
        this.items = options.items ?? [];
        this.filtered = this.items;
        this._activeIndex = this.filtered.length ? 0 : -1;
        for (const value of options.selected ?? []) {
            if (this.selectedSet.has(value)) continue;
            this.selectedSet.add(value);
            this.selectedOrder.push(value);
        }

        this.render = new RenderGrid(this.body, {
            name: "avg-list",
            className: "avg-list-grid",
            rowCount: () => this.filtered.length,
            columnCount: 1,
            rowHeight: options.rowHeight ?? DEFAULT_ROW_HEIGHT,
            // One column, the full width of the body. `fitToWidth` also drops the horizontal
            // whitespace allowance the grid keeps for a resizable last column.
            columnWidth: () => "100%",
            fitToWidth: true,
            renderCell: this.renderCell,
            height: "100%",
        });

        // Every listener on the root, resolved by `data-index` / `data-list-action`. A row is
        // pooled — the element that is option 3 now is option 400 after a scroll — so a
        // listener bound to one would fire against the wrong option.
        this.element.addEventListener("click", this.onClick);
        this.element.addEventListener("keydown", this.onKeyDown);
        this.searchInput?.addEventListener("input", this.onSearchInput);

        this.emptyEl.style.display = this.filtered.length ? "none" : "";
        this.syncSelectAll();
    }

    // =========================================================================================
    // Public surface
    // =========================================================================================

    /** The selected values, in the order they were picked. */
    getSelected(): VirtualListValue[] {
        return [...this.selectedOrder];
    }

    /** The selected items — the option objects, not just their values. */
    getSelectedItems(): VirtualListItem[] {
        const byValue = new Map(this.items.map((i) => [i.value, i]));
        return this.selectedOrder.map((v) => byValue.get(v) ?? { value: v });
    }

    setSelected(values: readonly VirtualListValue[], notify = false): void {
        this.selectedSet.clear();
        this.selectedOrder = [];
        for (const v of values) {
            if (this.selectedSet.has(v)) continue;
            this.selectedSet.add(v);
            this.selectedOrder.push(v);
        }
        this.syncSelectAll();
        this.render.model.update({ all: true });
        if (notify) this.emitChange();
    }

    setItems(items: VirtualListItem[]): void {
        this.items = items;
        this.applyFilter();
    }

    getItems(): readonly VirtualListItem[] {
        return this.items;
    }

    /** The rows currently on screen — `items` narrowed by the search. */
    getVisibleItems(): readonly VirtualListItem[] {
        return this.filtered;
    }

    get search(): string {
        return this.searchText;
    }

    /** The highlighted row, as an index into the *visible* rows. -1 when the list is empty. */
    get activeIndex(): number {
        return this._activeIndex;
    }

    getActiveItem(): VirtualListItem | undefined {
        return this.filtered[this._activeIndex];
    }

    setActiveIndex(index: number): void {
        this.setActive(Math.max(-1, Math.min(index, this.filtered.length - 1)));
    }

    /** Set the search text programmatically; the input follows. */
    setSearch(text: string): void {
        this.searchText = text;
        if (this.searchInput && this.searchInput.value !== text) this.searchInput.value = text;
        this.applyFilter();
    }

    focus(): void {
        // The search box when there is one: typing is the first thing a user does to a list of
        // forty thousand options, and the arrow keys still work from there — they bubble to
        // the root, which is where the keyboard map lives.
        if (this.searchInput) this.searchInput.focus();
        else this.render.model.gridRef.current?.focus({ preventScroll: true });
    }

    scrollToIndex(index: number, align: RowAlign = "nearest"): void {
        void this.render.model.scrollToRow(index, align);
    }

    /** Re-measure after the list is mounted, or after its container is resized. */
    measure(): void {
        this.render.model.checkSize();
    }

    destroy(): void {
        this.element.removeEventListener("click", this.onClick);
        this.element.removeEventListener("keydown", this.onKeyDown);
        this.searchInput?.removeEventListener("input", this.onSearchInput);
        this.render.destroy();
        this.element.remove();
    }

    // =========================================================================================
    // Rows
    // =========================================================================================

    private renderCell = (p: RenderCellParams): HTMLElement => {
        const el = (p.previous ?? p.recycle?.() ?? document.createElement("div")) as HTMLElement;
        const item = this.filtered[p.row];

        // A recycled element comes back exactly as its last occupant left it, so every
        // property set here is set unconditionally — and the children are rebuilt only when
        // the element is not already the right shape.
        if (el.childElementCount !== 2) {
            el.textContent = "";
            el.insertAdjacentHTML("afterbegin", `${UNCHECKED}<span class="avg-list-label"></span>`);
        }
        const box = el.firstElementChild as HTMLElement;
        const label = el.lastElementChild as HTMLElement;

        el.className = "avg-list-item";
        el.setAttribute("data-index", String(p.row));

        const selected = !!item && this.selectedSet.has(item.value);
        // `innerHTML` only when the state actually changed: it reparses markup, which is fine
        // on a click and wasteful on every scroll frame.
        const wanted = selected ? "1" : "0";
        if (box.getAttribute("data-checked") !== wanted) {
            box.innerHTML = selected ? CHECKED : UNCHECKED;
            box.setAttribute("data-checked", wanted);
        }
        if (selected) el.setAttribute("data-selected", "");
        else el.removeAttribute("data-selected");
        if (p.row === this._activeIndex) el.setAttribute("data-active", "");
        else el.removeAttribute("data-active");
        if (item?.disabled) el.setAttribute("data-disabled", "");
        else el.removeAttribute("data-disabled");

        setText(label, item ? (item.label ?? String(item.value)) : "");
        applyCellStyle(el, p.style);
        return el;
    };

    private applyFilter(): void {
        const text = this.searchText.trim().toLowerCase();
        // `onSearch` means the caller narrows the options at the source, so the list shows
        // exactly what it was given.
        this.filtered =
            !text || this.options.onSearch
                ? this.items
                : this.items.filter((i) =>
                      (i.label ?? String(i.value)).toLowerCase().includes(text),
                  );

        this._activeIndex = this.filtered.length ? 0 : -1;
        this.emptyEl.style.display = this.filtered.length ? "none" : "";
        this.syncSelectAll();
        this.render.model.update({ all: true });
        void this.render.model.scrollToRow(0, "top");
    }

    /**
     * The select-all box reflects the rows the search is currently showing, and nothing else.
     * Ported from `MultiListBox`, and the reason it matters: search for "north", tick all,
     * clear the search, and the box goes back to indeterminate rather than claiming everything
     * is selected.
     */
    private syncSelectAll(): void {
        if (!this.selectAllRow) return;
        let selected = 0;
        for (const item of this.filtered) if (this.selectedSet.has(item.value)) selected++;

        const state =
            this.filtered.length && selected === this.filtered.length
                ? "all"
                : selected
                  ? "some"
                  : "none";
        const box = this.selectAllRow.firstElementChild as HTMLElement;
        if (box.getAttribute("data-checked") === state) return;
        box.innerHTML =
            state === "all" ? CHECKED : state === "some" ? INDETERMINATE : UNCHECKED;
        box.setAttribute("data-checked", state);
        this.selectAllRow.setAttribute("data-state", state);
    }

    // =========================================================================================
    // Interaction
    // =========================================================================================

    private onSearchInput = (): void => {
        this.searchText = this.searchInput?.value ?? "";
        if (this.options.onSearch) this.options.onSearch(this.searchText);
        this.applyFilter();
    };

    private onClick = (e: MouseEvent): void => {
        const target = e.target as Element | null;
        if (!target) return;

        if (target.closest('[data-list-action="all"]')) {
            this.toggleAll();
            return;
        }
        const row = target.closest("[data-index]");
        if (!row) return;
        const index = Number(row.getAttribute("data-index"));
        const item = this.filtered[index];
        if (!item || item.disabled) return;

        this.setActive(index);
        if (this.options.multiple === false) {
            this.setSelected([item.value]);
            this.emitChange();
            this.options.onActivate?.(item);
        } else {
            this.toggle(item);
        }
    };

    private onKeyDown = (e: KeyboardEvent): void => {
        const count = this.filtered.length;
        const page = Math.max(1, this.render.model.visibleRowCount);
        const move = (to: number): void => {
            e.preventDefault();
            this.setActive(Math.max(0, Math.min(count - 1, to)));
            if (this._activeIndex >= 0) this.scrollToIndex(this._activeIndex);
        };

        switch (e.key) {
            case "ArrowDown":
                if (count) move(this._activeIndex + 1);
                break;
            case "ArrowUp":
                if (count) move(this._activeIndex - 1);
                break;
            case "Home":
                if (count) move(0);
                break;
            case "End":
                if (count) move(count - 1);
                break;
            case "PageDown":
                if (count) move(this._activeIndex + page);
                break;
            case "PageUp":
                if (count) move(this._activeIndex - page);
                break;
            case " ":
            case "Enter": {
                const item = this.filtered[this._activeIndex];
                if (!item || item.disabled) return;
                // Space in the search box is a space, not a toggle — the list is searchable
                // and a user typing "new york" must be able to type the gap.
                if (e.key === " " && e.target === this.searchInput) return;
                e.preventDefault();
                if (this.options.multiple === false) {
                    this.setSelected([item.value]);
                    this.emitChange();
                } else {
                    this.toggle(item);
                }
                if (e.key === "Enter") this.options.onActivate?.(item);
                break;
            }
        }
    };

    private setActive(index: number): void {
        if (index === this._activeIndex) return;
        const previous = this._activeIndex;
        this._activeIndex = index;
        // Two rows dirty, not the viewport: the one losing the highlight and the one gaining
        // it. Holding ArrowDown through 40,000 options repaints two rows per keystroke.
        const rows = [previous, index].filter((r) => r >= 0);
        if (rows.length) this.render.model.update({ rows });
    }

    private toggle(item: VirtualListItem): void {
        if (this.selectedSet.has(item.value)) {
            this.selectedSet.delete(item.value);
            this.selectedOrder = this.selectedOrder.filter((v) => v !== item.value);
        } else {
            this.selectedSet.add(item.value);
            this.selectedOrder.push(item.value);
        }
        const index = this.filtered.indexOf(item);
        if (index >= 0) this.render.model.update({ rows: [index] });
        this.syncSelectAll();
        this.emitChange();
    }

    private toggleAll(): void {
        const visible = this.filtered.filter((i) => !i.disabled);
        const allSelected = visible.length > 0 && visible.every((i) => this.selectedSet.has(i.value));

        if (allSelected) {
            for (const item of visible) this.selectedSet.delete(item.value);
            const gone = new Set(visible.map((i) => i.value));
            this.selectedOrder = this.selectedOrder.filter((v) => !gone.has(v));
        } else {
            for (const item of visible) {
                if (this.selectedSet.has(item.value)) continue;
                this.selectedSet.add(item.value);
                this.selectedOrder.push(item.value);
            }
        }
        this.syncSelectAll();
        // One mark for the whole operation: `all` repaints only what is on screen, so ticking
        // 40,000 options costs the same paint as ticking one.
        this.render.model.update({ all: true });
        this.emitChange();
    }

    private emitChange(): void {
        this.options.onChange?.(this.getSelected(), this.getSelectedItems());
    }
}
