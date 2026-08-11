/**
 * Clipboard copy, cut and paste.
 *
 * Ported from `AVGrid/model/CopyPasteModel.ts`, on top of the dependency-free
 * `core/csv.ts`. The shapes it copies in, the tiling rule when a small clipboard lands in a
 * big selection, and the "one cell copies its bare text" special case are all the reference's.
 * What changed is *how the clipboard is reached*, and it changed for a reason worth stating.
 *
 * | Reference | Here |
 * |---|---|
 * | ctrl+C → `navigator.clipboard.writeText()` from a keydown handler | the native `copy` event, filled in with `e.clipboardData` |
 * | ctrl+V → `navigator.clipboard.readText()` from a keydown handler | the native `paste` event, read from `e.clipboardData` |
 * | — | `cut`, which is copy plus the range delete that already existed |
 *
 * `navigator.clipboard` is permission-gated: `readText()` shows a paste prompt in Chrome every
 * time and is unavailable outright in Firefox, and both halves need a secure context. The
 * native clipboard events have none of those problems — the user pressing ctrl+V *is* the
 * permission — so they are the primary path, and the async API is the fallback for the
 * programmatic `grid.copySelection()` / `grid.paste()` calls, which have no event to ride on.
 *
 * The listeners themselves live in `GridInteractions` with every other listener the grid owns;
 * this class is the logic they call.
 */

import { csvToRecords, recordsToCsv } from "../core/csv";
import { columnDisplayValue } from "../gridUtils";
import type { CellContext, Column } from "../types";
import type { AVGridModel } from "./AVGridModel";
import type { GridSelection } from "./FocusModel";

/**
 * What shape the selection is copied in.
 *
 * - `copy` — tab-separated, no header row. What Excel and Sheets expect.
 * - `copyWithHeaders` — the same, with the column names on the first line.
 * - `copyAsJson` — an array of objects, keyed by column key, indented four spaces.
 * - `copyAsHtmlTable` — an HTML `<table>`, with tab-separated text as the plain-text
 *   alternative, so it pastes as a formatted table into a rich-text target and as cells into a
 *   spreadsheet.
 */
export type CopyMode = "copy" | "copyWithHeaders" | "copyAsJson" | "copyAsHtmlTable";

/** The rectangle a paste writes into. */
interface PasteTarget {
    rowStart: number;
    rowEnd: number;
    colStart: number;
    colEnd: number;
    /** True when a single-cell selection was grown to fit the clipboard. */
    expanded: boolean;
}

const HTML_ESCAPES: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
};

function escapeHtml(value: string): string {
    return value.replace(/[&<>"]/g, (c) => HTML_ESCAPES[c]);
}

/** Everything the reference styled its copied table with, as inline CSS. */
const TABLE_STYLE =
    "font-family:sans-serif;font-size:12px;border:solid 1px #c0c0c0;border-collapse:collapse";
const CELL_STYLE = "border:none;border-bottom:solid 1px #c0c0c0;text-align:left;padding:2px 4px";

export class CopyPasteModel<R> {
    readonly model: AVGridModel<R>;

    constructor(model: AVGridModel<R>) {
        this.model = model;
        this.model.events.content.onKeyDown.subscribe(this.onContentKeyDown);
    }

    /** Clipboard handling is on unless the host turned it off. */
    get enabled(): boolean {
        return this.model.options.disableClipboard !== true;
    }

    // -----------------------------------------------------------------------
    // Reading the selection out
    // -----------------------------------------------------------------------

    /**
     * The columns a copy covers: the selected ones, minus the chrome, each with the index it
     * sits at — which `render` needs and a filtered array would have lost.
     *
     * A status column — the checkbox — is not data, and ctrl+A selects it along with
     * everything else. The reference had no select column when it wrote this and so copied a
     * column of empty strings into the user's spreadsheet.
     */
    private copyColumns(selection: GridSelection<R>): Array<{
        column: Column<R>;
        index: number;
    }> {
        const first = selection.colRange[0];
        return selection.columns
            .map((column, i) => ({ column, index: first + i }))
            .filter((c) => !c.column.isStatusColumn);
    }

    /**
     * What a cell *shows*, as text.
     *
     * Copy has to agree with the screen, and for a column with a custom `render` the screen is
     * the only place the value exists. A computed column — `render: (c) => `${c.row.first}
     * ${c.row.last}`` over a `key` no row has — is the case that makes this necessary: reading
     * `row[column.key]` gives `undefined`, so it copied as an empty column while showing a full
     * one. The reference had the same hole, in `columnDisplayValue`.
     *
     * `render` may return markup or an element, and neither belongs in a spreadsheet cell, so
     * both are reduced to their text. `formatValue` and `displayFormat` win over `render` here,
     * which is *not* the order `DataCell` paints in — on screen `render` wins over both. The
     * divergence is deliberate: a `formatValue` is already the plain text a spreadsheet wants,
     * and preferring it skips parsing a fragment of markup to find the same string. A column that
     * wants the rendered text copied instead says so with `copyValue`.
     *
     * `copyValue` wins over all of them: it exists precisely for the cell whose screen form —
     * a bar, a badge, an icon — reduces to text nobody wants pasted. It is the only hook here
     * that is copy-only, and every mode goes through this method, so they cannot disagree.
     */
    private cellText(column: Column<R>, row: R, rowIndex: number, colIndex: number): any {
        if (column.copyValue) {
            return column.copyValue(this.cellContext(column, row, rowIndex, colIndex));
        }

        if (column.formatValue || column.displayFormat || !column.render) {
            return columnDisplayValue(column, row);
        }

        const rendered = column.render(
            this.cellContext(column, row, rowIndex, colIndex),
        );
        if (rendered === null || rendered === undefined) return "";
        if (typeof rendered !== "string") return rendered.textContent ?? "";
        return rendered.includes("<") ? this.textOf(rendered) : rendered;
    }

    /**
     * The `CellContext` a hook is handed. Built only when one is set — `cellText`'s first branch
     * is the no-hook case and allocates nothing, which is the same discipline `DataCell` keeps.
     */
    private cellContext(
        column: Column<R>,
        row: R,
        rowIndex: number,
        colIndex: number,
    ): CellContext<R> {
        return {
            value: (row as any)[column.key],
            row,
            column,
            rowIndex,
            colIndex,
            rowKey: this.model.options.getRowKey(row),
        };
    }

    /** Reduce a fragment of markup to its text, through one reused detached element. */
    private textOf(html: string): string {
        const doc = this.model.renderModel?.gridRef.current?.ownerDocument ?? document;
        const scratch = (this.scratch ??= doc.createElement("div"));
        scratch.innerHTML = html;
        return scratch.textContent ?? "";
    }

    private scratch?: HTMLElement;

    /**
     * The selection as text, in one of the four shapes. Pure — nothing touches the clipboard,
     * which is what makes it the thing to call from a test or a host that has its own transport.
     */
    selectionText(mode: CopyMode = "copy"): string {
        const selection = this.model.models.focus.getGridSelection();
        if (!selection) return "";
        const columns = this.copyColumns(selection);
        const rows = selection.rows;
        if (!columns.length || !rows.length) return "";
        const firstRow = selection.rowRange[0];

        if (mode === "copyAsJson") {
            return JSON.stringify(
                rows.map((row, r) => {
                    const record: Record<string, any> = {};
                    for (const { column, index } of columns) {
                        record[String(column.key)] = this.cellText(
                            column,
                            row,
                            firstRow + r,
                            index,
                        );
                    }
                    return record;
                }),
                null,
                4,
            );
        }

        // One cell copies its bare text — no quoting, no trailing newline. Pasting a single
        // value into a search box or a shell should give the value, not a one-field CSV of it.
        if (rows.length === 1 && columns.length === 1 && mode === "copy") {
            const value = this.cellText(
                columns[0].column,
                rows[0],
                firstRow,
                columns[0].index,
            );
            return value === null || value === undefined ? "" : String(value);
        }

        // Keyed by index rather than by name, so two columns sharing a name stay two columns.
        const keys = columns.map((_, i) => String(i));
        const records = rows.map((row, r) => {
            const record: Record<string, any> = {};
            columns.forEach(({ column, index }, i) => {
                record[keys[i]] = this.cellText(column, row, firstRow + r, index);
            });
            return record;
        });

        return recordsToCsv(records, keys, {
            header: mode === "copyWithHeaders",
            headerNames: columns.map(
                ({ column }) => column.name ?? String(column.key),
            ),
            delimiter: "\t",
        });
    }

    /** The selection as an HTML table, for the `text/html` clipboard flavour. */
    selectionHtml(): string {
        const selection = this.model.models.focus.getGridSelection();
        if (!selection) return "";
        const columns = this.copyColumns(selection);
        if (!columns.length || !selection.rows.length) return "";
        const firstRow = selection.rowRange[0];

        const cell = (value: unknown, weight: number): string =>
            `<td style="${CELL_STYLE};font-weight:${weight}">${escapeHtml(
                value === null || value === undefined ? "" : String(value),
            )}</td>`;

        const head = `<tr>${columns
            .map(({ column }) => cell(column.name ?? String(column.key), 600))
            .join("")}</tr>`;
        const body = selection.rows
            .map(
                (row, r) =>
                    `<tr>${columns
                        .map(({ column, index }) =>
                            cell(this.cellText(column, row, firstRow + r, index), 400),
                        )
                        .join("")}</tr>`,
            )
            .join("");

        return `<table style="${TABLE_STYLE}"><thead>${head}</thead><tbody>${body}</tbody></table>`;
    }

    // -----------------------------------------------------------------------
    // Copy
    // -----------------------------------------------------------------------

    /**
     * Fill a native `copy` or `cut` event from the selection. Returns whether it wrote anything,
     * so the caller knows whether to `preventDefault()`.
     *
     * This is the path ctrl+C actually takes: no permission prompt, no secure-context
     * requirement, and the write happens synchronously inside the user gesture.
     */
    writeToEvent(e: ClipboardEvent, mode: CopyMode = "copy"): boolean {
        const data = e.clipboardData;
        if (!data) return false;

        const text = this.selectionText(mode);
        if (!text) return false;

        data.setData("text/plain", text);
        if (mode === "copyAsHtmlTable") {
            data.setData("text/html", this.selectionHtml());
        }
        return true;
    }

    /**
     * Copy the selection through the async clipboard API — the programmatic entry point, for
     * hosts and agents that are not inside a copy event.
     *
     * Falls back to a hidden `<textarea>` and `document.execCommand("copy")` when
     * `navigator.clipboard` is missing or refuses, which is the common case on `file://` pages
     * and inside sandboxed frames. Returns whether the text reached the clipboard.
     */
    async copySelection(mode: CopyMode = "copy"): Promise<boolean> {
        const text = this.selectionText(mode);
        if (!text) return false;

        if (mode === "copyAsHtmlTable") {
            const html = this.selectionHtml();
            const clipboard = navigator.clipboard as Clipboard | undefined;
            if (clipboard?.write && typeof ClipboardItem !== "undefined") {
                try {
                    await clipboard.write([
                        new ClipboardItem({
                            "text/html": new Blob([html], { type: "text/html" }),
                            "text/plain": new Blob([text], { type: "text/plain" }),
                        }),
                    ]);
                    return true;
                } catch {
                    // Fall through: plain text is a worse answer than a table, and a much
                    // better one than nothing.
                }
            }
        }

        try {
            await navigator.clipboard?.writeText(text);
            return true;
        } catch {
            return this.copyByExecCommand(text);
        }
    }

    private copyByExecCommand(text: string): boolean {
        const doc = this.model.renderModel?.gridRef.current?.ownerDocument ?? document;
        const area = doc.createElement("textarea");
        area.value = text;
        // Off-screen rather than hidden: `display:none` and `visibility:hidden` cannot be
        // selected, and an unselectable textarea copies nothing.
        area.style.cssText = "position:fixed;top:-9999px;opacity:0";
        area.setAttribute("aria-hidden", "true");
        doc.body.appendChild(area);
        try {
            area.select();
            return doc.execCommand?.("copy") ?? false;
        } catch {
            return false;
        } finally {
            area.remove();
            // The textarea stole focus to be selectable; give it back.
            this.model.focusGrid();
        }
    }

    /** Copy, then clear the cells — ctrl+X. Only the editable ones, exactly as Delete does. */
    async cut(): Promise<boolean> {
        if (!this.model.options.editable) return this.copySelection();
        const copied = await this.copySelection();
        if (copied) this.model.models.editing.deleteRange();
        return copied;
    }

    // -----------------------------------------------------------------------
    // Paste
    // -----------------------------------------------------------------------

    /** Paste from a native `paste` event. No permission prompt — the keystroke is the consent. */
    pasteFromEvent(e: ClipboardEvent): boolean {
        const text = e.clipboardData?.getData("text/plain");
        return text ? this.pasteText(text) : false;
    }

    /**
     * Read the clipboard and paste it. Requires clipboard-read permission, which the browser
     * may prompt for or deny outright — prefer letting the user press ctrl+V, or pass the text
     * to `pasteText` yourself.
     */
    async paste(): Promise<boolean> {
        try {
            const text = await navigator.clipboard?.readText();
            return text ? this.pasteText(text) : false;
        } catch {
            return false;
        }
    }

    /**
     * Paste tab-separated text into the selection.
     *
     * Two rules, both the reference's, both what a spreadsheet does:
     *
     * - **A single selected cell expands** to whatever the clipboard needs. On a grid with
     *   `canAddRows` / `canAddColumns` the grid grows to fit; without them the target is clamped
     *   to the last row and column that exist and the overflow is dropped rather than wrapped.
     * - **A larger selection tiles.** Two rows of clipboard into six rows of selection fills all
     *   six, which is how a user copies one row onto many.
     *
     * Every cell goes through `editCellAt`, so `validate`, `onEdit` and the readonly rules apply
     * to a paste exactly as they do to typing.
     */
    pasteText(text: string): boolean {
        if (!text) return false;

        let records = csvToRecords(text);
        // A single value with no delimiter in it parses to nothing worth having; the reference
        // wrapped it as one cell rather than dropping it, and pasting one value into a range is
        // a real thing people do.
        if (!records.length && text.length) records = [[text]];
        if (!records.length || !records[0].length) return false;

        const target = this.pasteTarget(records.length, records[0].length);
        if (!target) return false;

        let changed = false;
        for (let row = target.rowStart, sourceRow = 0; row <= target.rowEnd; row++) {
            for (let col = target.colStart, sourceCol = 0; col <= target.colEnd; col++) {
                const value = records[sourceRow]?.[sourceCol];
                // `silent` — one repaint at the end. A 10,000-cell paste that marked each cell
                // would build a dirty set larger than the viewport it is going to repaint.
                if (this.model.models.editing.editCellAt(row, col, value, true)) {
                    changed = true;
                }
                sourceCol = (sourceCol + 1) % records[0].length;
            }
            sourceRow = (sourceRow + 1) % records.length;
        }

        // The selection moves to what was pasted whether or not any value differed — the user
        // asked for that rectangle, and showing it is the feedback that the paste landed.
        if (target.expanded) {
            this.model.models.focus.selectRange(
                target.rowStart,
                target.colStart,
                target.rowEnd,
                target.colEnd,
            );
        }
        if (changed) this.model.update({ all: true });
        return changed;
    }

    private pasteTarget(rowCount: number, colCount: number): PasteTarget | undefined {
        const selection = this.model.models.focus.getGridSelection();
        if (!selection) return undefined;

        const [rowStart, rowEnd] = selection.rowRange;
        const [colStart, colEnd] = selection.colRange;
        if (rowStart !== rowEnd || colStart !== colEnd) {
            return { rowStart, rowEnd, colStart, colEnd, expanded: false };
        }

        // Grow to fit, when the grid is allowed to. Both are done before a single value is
        // written, so the loop that follows sees its final bounds and the whole paste is one
        // structural change rather than one per overflowing row.
        const structure = this.model.models.structure;
        const missingRows = rowStart + rowCount - this.model.data.rows.length;
        if (missingRows > 0 && structure.canAddRows) {
            structure.addBlankRows(missingRows, undefined, false);
        }
        const missingColumns = colStart + colCount - this.model.data.columns.length;
        if (missingColumns > 0 && structure.canAddColumns) {
            structure.addBlankColumns(missingColumns);
        }

        return {
            rowStart,
            colStart,
            rowEnd: Math.min(rowStart + rowCount - 1, this.model.data.rows.length - 1),
            colEnd: Math.min(colStart + colCount - 1, this.model.data.columns.length - 1),
            expanded: true,
        };
    }

    // -----------------------------------------------------------------------
    // Keyboard
    // -----------------------------------------------------------------------

    /**
     * ctrl+shift+C only.
     *
     * ctrl+C, ctrl+X and ctrl+V are *not* handled here: they produce native clipboard events,
     * which reach the clipboard without a permission prompt and would fire in addition to
     * anything done here. ctrl+shift+C produces no such event, so copy-with-headers has to go
     * through the async API — and note that Chrome binds ctrl+shift+C to its element inspector,
     * which wins whenever devtools is open.
     */
    private onContentKeyDown = (e: KeyboardEvent): void => {
        if (!this.enabled) return;
        if (!e.ctrlKey || !e.shiftKey || e.code !== "KeyC") return;
        if (!this.model.models.focus.focus) return;
        e.preventDefault();
        void this.copySelection("copyWithHeaders");
    };
}
