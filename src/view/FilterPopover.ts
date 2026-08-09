/**
 * The filter popover — the dispatch point between a column and the body that filters it.
 *
 * ```js
 * const applied = await showFilterPopover(model, { columnKey: "status" });
 * ```
 *
 * Ported from `filters/FilterPopover.tsx`. There, the open popover was state in a React
 * context, rendered by a component mounted next to the grid; here it is a function that mounts
 * a `Popover`, and the shape the reference reached one level up — **a promise that resolves
 * when the popover closes** — is the whole API. It resolves with the filter that was applied,
 * or `undefined` if the popover was dismissed.
 *
 * The body is chosen by the column's `filterType`, falling back to the filter's own `type`,
 * exactly as the reference does: there is one type today and this is where the second one goes.
 */

import type { AVGridModel } from "../model/AVGridModel";
import type { Filter, Point } from "../types";
import { Popover, type PopoverSize } from "./Popover";
import {
    OptionsFilterContent,
    OPTIONS_FILTER_MIN_WIDTH,
} from "./OptionsFilterContent";

export interface ShowFilterPopoverOptions {
    /**
     * What to anchor to. Defaults to the column's own funnel button, so the common call is
     * `showFilterPopover(model, { columnKey })` and nothing else.
     *
     * Never a data cell: cells are pooled, so one scrolled out from under an open popover
     * re-anchors it to a different row.
     */
    anchor?: Element | Point;
    /** `[cross, main]` — passed through to `Popover`, for a caller nudging it off its anchor. */
    offset?: [number, number];
    /** Open at a size the host remembered from the last time the user resized it. */
    size?: PopoverSize;
    /** Fired while the user drags the resize grip, with the live size. */
    onResize?: (size: PopoverSize) => void;
}

/** The funnel in the header of `columnKey`, if that column is currently rendered. */
function funnelFor<R>(model: AVGridModel<R>, columnKey: string): Element | undefined {
    const root = model.renderModel?.gridRef.current;
    // Scanned rather than selected: a column key is host-supplied and can hold anything a
    // JavaScript property can, which is not the same set an attribute selector can express.
    const cells = root?.querySelectorAll('[data-type="header-cell"]');
    if (!cells) return undefined;
    for (const cell of Array.from(cells)) {
        if (cell.getAttribute("data-column-key") !== columnKey) continue;
        return cell.querySelector('[data-type="filter-button"]') ?? cell;
    }
    return undefined;
}

/**
 * Open the filter popover for one column and resolve when it closes.
 *
 * Applying inside the popover goes through `FiltersModel.applyFilter`, so the rows are already
 * filtered by the time the promise resolves — the return value is for a caller that wants to
 * know *what* was applied, not a value it has to do something with.
 */
export function showFilterPopover<R>(
    model: AVGridModel<R>,
    columnKey: string,
    options: ShowFilterPopoverOptions = {},
): Promise<Filter | undefined> {
    const filters = model.models.filters;
    const column = model.data.columns.find((c) => String(c.key) === columnKey);
    if (!column) {
        console.warn(
            `av-grid: showFilterPopover("${columnKey}") — no such column. ` +
                `Available: ${model.data.columns.map((c) => String(c.key)).join(", ")}.`,
        );
        return Promise.resolve(undefined);
    }

    const filter = filters.filterOrDefault(columnKey);
    const type = column.filterType ?? filter.type ?? "options";
    if (type !== "options") {
        console.warn(
            `av-grid: no filter body for filterType "${type}" on column "${columnKey}".`,
        );
        return Promise.resolve(undefined);
    }

    // One at a time. Two popovers over one grid would both be editing the same filter list, and
    // the second to apply would silently win.
    model.flags.filterPopover?.close();

    const anchor = options.anchor ?? funnelFor(model, columnKey);
    if (!anchor) {
        console.warn(
            `av-grid: showFilterPopover("${columnKey}") — the column is not rendered, ` +
                `so there is nothing to anchor to. Pass an anchor element or a point.`,
        );
        return Promise.resolve(undefined);
    }

    const anchorWidth = anchor instanceof Element ? anchor.clientWidth : 0;
    const width = Math.max(anchorWidth, OPTIONS_FILTER_MIN_WIDTH);
    // The reference carried this flag too, for the same reason: once the user has dragged the
    // popover to a size, the option count no longer gets to decide it.
    let resized = Boolean(options.size);

    const popover = new Popover<Filter>({
        anchor,
        className: "avg-filter-popover",
        placement: "bottom-start",
        offset: options.offset,
        resizable: true,
        size: options.size,
        minWidth: OPTIONS_FILTER_MIN_WIDTH,
        minHeight: 160,
        onResize: (size) => {
            resized = true;
            options.onResize?.(size);
        },
    });

    // Declared before it is built: the body reports its preferred height from inside its own
    // constructor, when the options resolve synchronously.
    let body: OptionsFilterContent<R>;
    body = new OptionsFilterContent<R>({
        model,
        filter,
        // Apply, then close with what was applied. Both, in that order: the popover's promise
        // is the caller's signal that the grid has already been filtered.
        onApply: (applied) => {
            filters.applyFilter(applied);
            popover.close(filters.filterFor(applied.columnKey));
        },
        width,
        onPreferredHeight: (height) => {
            if (resized) return;
            popover.setSize({ width, height });
            // The list only draws the rows its viewport holds, and the viewport just changed.
            body?.measure();
        },
    });
    popover.content.appendChild(body.element);

    // The funnel of the column being edited stays lit while the popover is open, so a user who
    // has scrolled sideways can see which column they are filtering.
    model.flags.filterPopover = { columnKey, close: popover.close };
    model.update({ rows: [0] });

    const closed = popover.show().then((applied) => {
        body.destroy();
        if (model.flags.filterPopover?.close === popover.close) {
            model.flags.filterPopover = undefined;
            model.update({ rows: [0] });
        }
        return applied;
    });

    // Both after the popover is on screen. The list measures its own viewport to know how many
    // rows to draw, and it was built inside a panel that had not been mounted yet — measured
    // then, it would have found zero and drawn nothing.
    body.measure();
    body.focus();
    return closed;
}
