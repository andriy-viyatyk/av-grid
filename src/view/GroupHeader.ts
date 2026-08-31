/**
 * The column-group band — the top half of the two-row header (`Column.group`).
 *
 * **Not pooled cells.** The engine's `stickyTop` stays 1: when groups are active, row 0 is
 * simply twice as tall, header cells shrink to its lower half (see `HeaderCell.ts`), and this
 * band draws the upper half as an `addOverlay(el, "header")` overlay — one absolutely
 * positioned div per contiguous group run, in content-x coordinates. The sticky-top region is
 * a child of the scrolled canvas, so horizontal scrolling moves the band for free; nothing
 * here runs per scroll frame beyond a handful of guarded style writes that compare equal.
 *
 * That design is why none of the pooling invariants apply to a group cell: it is never
 * recycled, never evicted by a scroll, and invisible to `syncRegion` (which only removes
 * elements it appended itself). It is also why the paint cost is *once per visible group*,
 * not once per column.
 *
 * Positions come from the engine's own `renderInfo` — `columnStarts` / `columnLength`, the
 * same numbers the header cells beside the band are positioned by — so percentage widths and
 * `fitToWidth` stay exact. The band re-syncs on every engine state bump (cheap, guarded) and
 * rewrites *content* only when the columns or the group hooks change.
 */

import type { Unsubscribe } from "../core/observable";
import type { AVGridModel } from "../model/AVGridModel";
import type { RenderGrid } from "../render/RenderGrid";
import { getLength, getStarts } from "../render/renderInfo";
import type { ColumnGroupContext } from "../types";
import { appendClass } from "./cellDom";

const px = (n: number) => `${n}px`;

function setStyle(el: HTMLElement, prop: string, value: string): void {
    if (el.style.getPropertyValue(prop) !== value) {
        el.style.setProperty(prop, value);
    }
}

export class GroupHeader<R> {
    private readonly model: AVGridModel<R>;
    private readonly render: RenderGrid;

    private band?: HTMLDivElement;
    /** Group cells keyed by `startIndex:group`, reused across syncs so content survives. */
    private readonly cells = new Map<string, HTMLDivElement>();
    /** Set when the columns or the group hooks changed — the next sync rewrites content. */
    private contentDirty = true;

    private readonly unsubscribeRender: Unsubscribe;
    private readonly dataHandle: { unsubscribe: () => void };

    constructor(model: AVGridModel<R>, render: RenderGrid) {
        this.model = model;
        this.render = render;
        // The engine bumps its state whenever it recomputed the layout — a resize, a column
        // change, a scroll. The sync is O(visible columns) with guarded writes, so riding
        // every bump is cheaper than deciding which bumps matter.
        this.unsubscribeRender = render.model.state.subscribe(this.sync);
        this.dataHandle = model.data.onChange.subscribe((e) => {
            if (e.columns) this.contentDirty = true;
        });
    }

    /** Force a content rewrite — a group hook changed through `setOptions`. */
    markDirty = (): void => {
        this.contentDirty = true;
        this.sync();
    };

    sync = (): void => {
        const data = this.model.data;
        if (!data.hasGroups) {
            if (this.band) {
                this.band.remove();
                this.band = undefined;
                this.cells.clear();
            }
            return;
        }

        const columns = data.columns;
        const info = this.render.model.renderInfo.current;
        // Before the first layout pass the starts are an empty array — nothing to place yet;
        // the pass that fills them bumps the state and brings us back here.
        if (
            typeof info.columnStarts !== "number" &&
            info.columnStarts.length < columns.length
        ) {
            return;
        }

        if (!this.band) {
            const band = document.createElement("div");
            band.className = "avg-group-row";
            band.setAttribute("data-type", "group-row");
            // The header row's ARIA semantics are unchanged — the band is presentational.
            band.setAttribute("aria-hidden", "true");
            band.style.position = "absolute";
            band.style.left = "0";
            band.style.top = "0";
            this.render.addOverlay(band, "header");
            this.band = band;
            this.contentDirty = true;
        }

        const bandHeight = this.model.options.rowHeight;
        const active = new Set<string>();
        let i = 0;
        while (i < columns.length) {
            const group = columns[i].group;
            if (group === undefined) {
                i++;
                continue;
            }
            let end = i;
            while (end + 1 < columns.length && columns[end + 1].group === group) {
                end++;
            }

            const key = `${i}:${group}`;
            active.add(key);
            let el = this.cells.get(key);
            let fresh = false;
            if (!el) {
                el = document.createElement("div");
                el.setAttribute("data-type", "group-cell");
                this.band.append(el);
                this.cells.set(key, el);
                fresh = true;
            }

            const left = getStarts(info.columnStarts, i);
            let width = 0;
            for (let c = i; c <= end; c++) {
                width += getLength(info.columnLength, c);
            }
            setStyle(el, "position", "absolute");
            setStyle(el, "left", px(left));
            setStyle(el, "top", "0");
            setStyle(el, "width", px(width));
            setStyle(el, "height", px(bandHeight));

            if (fresh || this.contentDirty) {
                const context: ColumnGroupContext<R> = {
                    group,
                    columns: columns.slice(i, end + 1),
                };
                el.setAttribute("data-group", group);
                el.className = appendClass(
                    "avg-group-cell",
                    this.model.options.columnGroupClass?.(context),
                );
                const custom = this.model.options.columnGroupRender?.(context);
                if (custom === undefined || custom === null) {
                    el.textContent = group;
                    el.title = group;
                } else if (typeof custom === "string") {
                    el.innerHTML = custom;
                    el.removeAttribute("title");
                } else {
                    el.textContent = "";
                    el.appendChild(custom);
                    el.removeAttribute("title");
                }
            }

            i = end + 1;
        }

        for (const [key, el] of this.cells) {
            if (!active.has(key)) {
                el.remove();
                this.cells.delete(key);
            }
        }
        this.contentDirty = false;
    };

    destroy = (): void => {
        this.unsubscribeRender();
        this.dataHandle.unsubscribe();
        this.band?.remove();
        this.band = undefined;
        this.cells.clear();
    };
}
