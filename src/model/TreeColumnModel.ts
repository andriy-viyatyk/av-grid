/**
 * The tree gutter's three questions, answered once for the renderer, the pointer, the keyboard
 * and the clipboard: which column carries the gutter, what a row's gutter looks like, and whether
 * the user may toggle it.
 *
 * Deliberately small. The host owns the row set and the `expanded` state — this model reads
 * `treeColumn`'s functions and calls `onTreeToggle`; it never decides which rows exist. That is
 * the boundary phase 17 drew (see `tasks/plan.md`, task 59): the *gutter* is av-grid's, the
 * *engine* is the host's.
 */

import type { Column, TreeColumnOptions } from "../types";
import type { AVGridModel } from "./AVGridModel";

/** What the renderer draws in front of a tree cell's content. */
export interface TreeGutter {
    depth: number;
    /**
     * `none` — no slot at all (`chevrons` said so); `stub` — a leaf's alignment spacer;
     * `busy` — the slot is the wait, its children are on their way (task 64).
     */
    chevron: "open" | "closed" | "stub" | "none" | "busy";
    /** May the user toggle this row — `onTreeToggle` set, a chevron shown, children present. */
    interactive: boolean;
    /**
     * Which way the chevron *would* point. Kept while `busy` replaces it, because the node's
     * expanded state does not change just because the slot stopped showing it — `aria-expanded`
     * is written from this, not from the slot's kind.
     */
    expanded: boolean;
}

export class TreeColumnModel<R> {
    constructor(private readonly model: AVGridModel<R>) {}

    get options(): TreeColumnOptions<R> | undefined {
        return this.model.options.treeColumn;
    }

    /** Is this the column with the gutter? One string compare — the renderer asks per cell. */
    isTreeColumn(column: Column<R>): boolean {
        const tree = this.model.options.treeColumn;
        return tree !== undefined && String(column.key) === tree.key;
    }

    /** Pixels per level, resolved. */
    get indentSize(): number {
        return this.model.options.treeColumn?.indentSize ?? 16;
    }

    private hasSlot(tree: TreeColumnOptions<R>, row: R): boolean {
        const c = tree.chevrons;
        if (c === undefined || c === true) return true;
        if (c === false) return false;
        return Boolean(c(row));
    }

    gutter(row: R): TreeGutter {
        const tree = this.model.options.treeColumn!;
        const depth = Math.max(0, tree.depth(row) | 0);
        if (!this.hasSlot(tree, row)) {
            return { depth, chevron: "none", interactive: false, expanded: false };
        }
        if (!tree.hasChildren(row)) {
            return { depth, chevron: "stub", interactive: false, expanded: false };
        }
        const expanded = tree.expanded(row);
        // `busy` last, and only here: a stub cannot be waiting for children it does not have,
        // and a row with no slot has nowhere to put the spinner. An absent predicate is never
        // called, so the option costs a paint nothing until it is used.
        if (tree.busy?.(row)) {
            return { depth, chevron: "busy", interactive: false, expanded };
        }
        return {
            depth,
            chevron: expanded ? "open" : "closed",
            interactive: typeof this.model.options.onTreeToggle === "function",
            expanded,
        };
    }

    /**
     * The gesture exists only with `onTreeToggle`, only on a chevron, only on a folder — and
     * not while the row is busy, which is `interactive: false` above. That one flag is what
     * takes the click, the double-click and the arrow keys off together: every gate in
     * `GridInteractions` and `onArrow` already reads it.
     */
    canToggle(row: R): boolean {
        if (this.model.options.treeColumn === undefined) return false;
        return this.gutter(row).interactive;
    }

    /**
     * Ask the host for the other state, then repaint. The host usually answers with
     * `setRows(flatten())`, which repaints anyway — but collapsing a folder whose children are all
     * filtered out changes no row, and the chevron would otherwise keep pointing the wrong way.
     */
    toggle(row: R, dataRow: number): boolean {
        if (!this.canToggle(row)) return false;
        const tree = this.model.options.treeColumn!;
        this.model.options.onTreeToggle!(row, !tree.expanded(row));
        // That row, not the viewport: the host's own `setRows` (if any) marks the rest.
        this.model.update({ rows: [this.model.dataRowToGridRow(dataRow)] });
        return true;
    }

    /**
     * `→` expands a collapsed folder, `←` collapses an expanded one — on the focused tree cell,
     * with the gesture on. Anything else returns `false` and the key moves the focus as it does
     * on every other cell, so the arrows never go dead on a tree.
     */
    onArrow(
        row: R,
        dataRow: number,
        column: Column<R>,
        key: "ArrowLeft" | "ArrowRight",
    ): boolean {
        if (!this.isTreeColumn(column) || !this.canToggle(row)) return false;
        const expanded = this.model.options.treeColumn!.expanded(row);
        if (key === "ArrowRight" ? expanded : !expanded) return false;
        return this.toggle(row, dataRow);
    }

    /** The copy value `path` provides for a tree cell, or `undefined` to fall through. */
    pathOf(column: Column<R>, row: R): string | undefined {
        const tree = this.model.options.treeColumn;
        if (!tree || !tree.path || String(column.key) !== tree.key) return undefined;
        return tree.path(row);
    }
}
