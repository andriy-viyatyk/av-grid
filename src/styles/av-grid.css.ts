/**
 * The grid's entire appearance, as one static stylesheet.
 *
 * Ported from the `styled(RenderGrid)` block at the top of `AVGrid.tsx` (lines ~29–198) and
 * the two component-level styled blocks in `HeaderCell.tsx` and `DataCell.tsx`. Emotion
 * generated a class name per style object at runtime; here there is one sheet, written once,
 * and the *only* thing that varies is the value of a CSS custom property.
 *
 * That is what makes the theming requirement in task 9 achievable: setting `--avg-*` (or
 * `--p-*`) on any ancestor re-tints the grid with **no JavaScript and no repaint**. The
 * browser does it. Nothing in `src/` reads a colour.
 *
 * Every token falls back to its Persephone `--p-*` equivalent where one exists, then to a
 * neutral light default, so the grid looks deliberate on a bare HTML page and matches the
 * app on a board.
 *
 * This file is the single source of truth; `dist/av-grid.css` is generated from it at build
 * time by `scripts/build-css.mjs`.
 */

export const AVGRID_STYLE_ID = "av-grid-styles";

export const css = `
[data-type="render-grid"].avg-grid {
    --avg-font-family: var(--p-font-family, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif);
    --avg-font-size: var(--p-font-base, 13px);
    --avg-text: var(--p-text, #202020);
    --avg-text-muted: var(--p-text-muted, #767676);
    --avg-bg: var(--p-bg, #ffffff);
    --avg-accent: var(--p-accent, #0078d4);

    --avg-border-color: color-mix(in srgb, var(--avg-text) 22%, transparent);
    --avg-header-bg: color-mix(in srgb, var(--avg-text) 7%, var(--avg-bg));
    --avg-header-text: var(--avg-text);
    --avg-cell-bg: var(--avg-bg);
    --avg-cell-text: var(--avg-text);

    --avg-hover-bg: color-mix(in srgb, var(--avg-text) 6%, transparent);
    --avg-selection-bg: color-mix(in srgb, var(--avg-accent) 18%, transparent);
    --avg-selection-border: var(--avg-accent);
    /* The selection outline while the grid does not have focus. */
    --avg-selection-border-blurred: var(--avg-text-muted);

    --avg-cell-padding-x: 4px;

    font-family: var(--avg-font-family);
    font-size: var(--avg-font-size);
    color: var(--avg-text);
    background-color: var(--avg-bg);
    outline: none;
}

/* ---------------------------------------------------------------- header */

.avg-grid .avg-header-cell {
    display: inline-flex;
    align-items: center;
    box-sizing: border-box;
    position: absolute;
    padding-left: var(--avg-cell-padding-x);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    background-color: var(--avg-header-bg);
    color: var(--avg-header-text);
    border-bottom: solid 1px var(--avg-border-color);
    user-select: none;
    cursor: default;
}

.avg-grid .avg-header-title {
    overflow: hidden;
    text-overflow: ellipsis;
    margin-right: 4px;
}

.avg-grid .avg-flex-space {
    flex: 1 1 auto;
}

.avg-grid .avg-sort-icon {
    display: none;
    flex: 0 0 auto;
    align-items: center;
    color: var(--avg-text-muted);
    margin-right: 2px;
}

.avg-grid .avg-header-cell[data-sort] .avg-sort-icon {
    display: inline-flex;
}

/* The resize grip: three faint dashes, revealed on hover over the right edge. */
.avg-grid .avg-header-cell[data-resizable="true"] {
    padding-right: 10px;
}

.avg-grid .avg-header-cell[data-resizable="true"]::after {
    content: "";
    cursor: col-resize;
    position: absolute;
    inset-block: 0;
    inset-inline-end: 0;
    inline-size: 10px;
}

.avg-grid .avg-header-cell[data-resizable="true"]:hover::after {
    background: linear-gradient(
        to bottom,
        transparent 0%,
        transparent 20%,
        var(--avg-border-color) 30%,
        transparent 40%,
        var(--avg-border-color) 50%,
        transparent 60%,
        var(--avg-border-color) 70%,
        transparent 80%,
        transparent 100%
    );
    background-size: 4px 100%;
    background-position: center;
    background-repeat: no-repeat;
}

.avg-grid .avg-header-cell.avg-drag-source {
    opacity: 0.4;
}

.avg-grid .avg-header-cell.avg-drag-over {
    box-shadow: inset 2px 0 0 0 var(--avg-accent);
}

.avg-grid .avg-filter-button {
    display: none;
    position: absolute;
    right: 10px;
    top: 50%;
    transform: translateY(-50%);
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    border-radius: 3px;
    cursor: pointer;
    color: var(--avg-text-muted);
    background-color: var(--avg-header-bg);
}

.avg-grid .avg-header-cell:hover .avg-filter-button,
.avg-grid .avg-filter-button.avg-column-filtered {
    display: inline-flex;
}

.avg-grid .avg-filter-button.avg-column-filtered {
    color: var(--avg-accent);
}

/* ------------------------------------------------------------ data cells */

.avg-grid .avg-data-cell {
    display: inline-flex;
    align-items: center;
    box-sizing: border-box;
    position: absolute;
    padding: 0 var(--avg-cell-padding-x);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    background-color: var(--avg-cell-bg);
    color: var(--avg-cell-text);
    border-bottom: solid 1px var(--avg-border-color);
    border-right: solid 1px var(--avg-border-color);
    outline: none;
    user-select: none;
}

.avg-grid .avg-data-cell[data-col="0"] {
    border-left: solid 1px var(--avg-border-color);
}

.avg-grid .avg-align-center {
    justify-content: center;
}

.avg-grid .avg-align-right {
    justify-content: flex-end;
}

/*
 * Every state tint is painted on ::before, an overlay covering the cell. Two reasons, both
 * from the reference: the cell's own background stays available for a host to set, and the
 * selection border can be drawn on the same layer as the selection fill without a second
 * element.
 */
.avg-grid .avg-data-cell::before {
    content: "";
    position: absolute;
    inset: 0;
    background-color: transparent;
    pointer-events: none;
}

.avg-grid .avg-row-selected::before,
.avg-grid .avg-data-cell.avg-in-selection::before {
    background-color: var(--avg-selection-bg);
}

.avg-grid .avg-data-cell.avg-row-hovered:not(.avg-editing)::after {
    content: "";
    position: absolute;
    inset: 0;
    background-color: var(--avg-hover-bg);
    pointer-events: none;
}

/* Selection edges — muted while the grid is blurred, accent-coloured once it has focus. */
.avg-grid .avg-data-cell.avg-in-selection-top:not(.avg-focused)::before {
    border-top: 1px solid var(--avg-selection-border-blurred);
}
.avg-grid .avg-data-cell.avg-in-selection-bottom:not(.avg-focused)::before {
    border-bottom: 1px solid var(--avg-selection-border-blurred);
}
.avg-grid .avg-data-cell.avg-in-selection-left:not(.avg-focused)::before {
    border-left: 1px solid var(--avg-selection-border-blurred);
}
.avg-grid .avg-data-cell.avg-in-selection-right:not(.avg-focused)::before {
    border-right: 1px solid var(--avg-selection-border-blurred);
}

.avg-grid:focus-within .avg-data-cell.avg-in-selection-top:not(.avg-focused)::before {
    border-top-color: var(--avg-selection-border);
}
.avg-grid:focus-within .avg-data-cell.avg-in-selection-bottom:not(.avg-focused)::before {
    border-bottom-color: var(--avg-selection-border);
}
.avg-grid:focus-within .avg-data-cell.avg-in-selection-left:not(.avg-focused)::before {
    border-left-color: var(--avg-selection-border);
}
.avg-grid:focus-within .avg-data-cell.avg-in-selection-right:not(.avg-focused)::before {
    border-right-color: var(--avg-selection-border);
}

.avg-grid .avg-data-cell.avg-focused::before {
    background-color: var(--avg-selection-bg);
    border: 1px solid var(--avg-selection-border-blurred);
}

.avg-grid:focus-within .avg-data-cell.avg-focused::before {
    border-color: var(--avg-selection-border);
}

/* Borderless variant — the static grid lines only. Selection and focus keep their borders. */
.avg-grid[data-cell-borders="off"] .avg-header-cell {
    border-bottom: none;
}

.avg-grid[data-cell-borders="off"] .avg-data-cell,
.avg-grid[data-cell-borders="off"] .avg-data-cell[data-col="0"] {
    border: none;
}

/* ------------------------------------------------------- select column */

/*
 * The checkbox column is an ordinary column whose render hook returns markup, so it needs no
 * layout of its own — only centring, a pointer cursor and the accent tint when checked. The
 * header's title span holds the select-all box, which is why the header rule targets padding.
 */
.avg-grid .avg-header-cell[data-column-key="--select-column--"] {
    padding-left: 0;
    justify-content: center;
}

/*
 * The title span normally holds text, so its inline content sits on a baseline with descender
 * space below it — which lifts an icon inside it a couple of pixels above the cell's centre.
 * Making the span a flex box takes the baseline out of it and centres the checkbox on both
 * axes, so it lines up with the boxes in the column below and with the labels beside it.
 */
.avg-grid .avg-header-cell[data-column-key="--select-column--"] .avg-header-title {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-right: 0;
    overflow: visible;
}

/*
 * The header's flex spacer is what pushes the filter funnel to the right edge — and it also
 * absorbs every free pixel, so the justify-content above has nothing left to centre with. The
 * select column has no funnel, so the spacer has no job here.
 *
 * (No backticks in this file's comments: the whole sheet is one template literal.)
 */
.avg-grid .avg-header-cell[data-column-key="--select-column--"] .avg-flex-space {
    display: none;
}

.avg-grid .avg-select-box {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    color: var(--avg-text-muted);
    cursor: pointer;
}

.avg-grid .avg-select-box.avg-checked {
    color: var(--avg-accent);
}

.avg-grid .avg-data-cell[data-column-key="--select-column--"],
.avg-grid .avg-header-cell[data-column-key="--select-column--"] {
    cursor: pointer;
}

/* -------------------------------------------------------------- editing */

/*
 * The editor fills its cell, inset by one pixel so the focus outline the cell already draws
 * stays visible around it. It inherits the grid's font rather than the browser's control font,
 * so the text does not jump size or family when a cell opens for editing.
 */
.avg-grid .avg-cell-editor {
    position: absolute;
    inset: 1px;
    box-sizing: border-box;
    width: auto;
    padding: 0 3px;
    margin: 0;
    border: none;
    outline: none;
    border-radius: 0;
    font: inherit;
    color: var(--avg-cell-text);
    background-color: var(--avg-cell-bg);
}

.avg-grid select.avg-cell-editor {
    padding-left: 1px;
}

/* The hover tint is suppressed over an open editor — see the ::after rule above. */
.avg-grid .avg-data-cell.avg-editing::before {
    border: 1px solid var(--avg-selection-border);
    background-color: transparent;
}

/* ---------------------------------------------------------------- pieces */

.avg-grid .avg-check-icon {
    width: 16px;
    height: 16px;
    flex: 0 0 auto;
    color: var(--avg-text-muted);
}

/*
 * The add-row and add-column affordances. Both sit outside the pooled cells: the row button in
 * the slack below the last row, the column button at the right end of the header band — so both
 * scroll with the content they extend, rather than floating over the viewport.
 */
.avg-grid .avg-add-row {
    position: absolute;
    bottom: 1px;
    left: 4px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
    color: var(--avg-text-muted);
    opacity: 0.6;
}

.avg-grid .avg-add-row:hover {
    opacity: 1;
    color: var(--avg-accent);
}

.avg-grid .avg-add-column {
    position: absolute;
    top: 0;
    right: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 100%;
    padding: 0;
    border: none;
    background-color: var(--avg-header-bg);
    font: inherit;
    cursor: pointer;
    user-select: none;
    color: var(--avg-text-muted);
    opacity: 0.6;
}

.avg-grid .avg-add-column:hover {
    opacity: 1;
    color: var(--avg-accent);
}

/* --- Popover ---------------------------------------------------------------------------
   Mounted on document.body, so it is outside the grid root and inherits none of the tokens
   defined there. It repeats the theme contract rather than reaching for it: a popover has to
   look like it belongs to the grid it was opened from, and both read the same --p-* tokens. */
.avg-popover {
    --avg-font-family: var(--p-font-family, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif);
    --avg-font-size: var(--p-font-base, 13px);
    --avg-text: var(--p-text, #202020);
    --avg-text-muted: var(--p-text-muted, #767676);
    --avg-bg: var(--p-bg, #ffffff);
    --avg-accent: var(--p-accent, #0078d4);
    --avg-border-color: color-mix(in srgb, var(--avg-text) 22%, transparent);
    --avg-hover-bg: color-mix(in srgb, var(--avg-text) 6%, transparent);

    position: fixed;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    overflow: hidden;
    font-family: var(--avg-font-family);
    font-size: var(--avg-font-size);
    color: var(--avg-text);
    background-color: var(--avg-bg);
    border: solid 1px var(--avg-border-color);
    border-radius: 6px;
    box-shadow: 0 2px 8px color-mix(in srgb, var(--avg-text) 25%, transparent);
    outline: none;
}

.avg-popover-content {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: auto;
}

.avg-popover-resize {
    position: absolute;
    right: 1px;
    bottom: 1px;
    width: 14px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: nwse-resize;
    color: var(--avg-text-muted);
    opacity: 0.6;
    user-select: none;
    touch-action: none;
    z-index: 1;
}

.avg-popover-resize:hover {
    opacity: 1;
}

.avg-popover-resize > svg {
    width: 12px;
    height: 12px;
}

/* Opened above its anchor, the popover grows upward, so the grip moves to the top corner. */
.avg-popover[data-placement^="top"] .avg-popover-resize {
    top: 1px;
    bottom: auto;
    cursor: nesw-resize;
    transform: rotate(-90deg);
}

/* --- VirtualList -----------------------------------------------------------------------
   Mounted wherever its caller puts it — inside a popover, usually — so like the popover it
   defines its own tokens rather than inheriting the grid's. */
.avg-list {
    --avg-text: var(--p-text, #202020);
    --avg-text-muted: var(--p-text-muted, #767676);
    --avg-bg: var(--p-bg, #ffffff);
    --avg-accent: var(--p-accent, #0078d4);
    --avg-border-color: color-mix(in srgb, var(--avg-text) 22%, transparent);
    --avg-hover-bg: color-mix(in srgb, var(--avg-text) 6%, transparent);
    --avg-selection-bg: color-mix(in srgb, var(--avg-accent) 18%, transparent);

    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    color: var(--avg-text);
}

.avg-list-search {
    flex: 0 0 auto;
    margin: 4px;
    padding: 3px 6px;
    font: inherit;
    color: var(--avg-text);
    background-color: transparent;
    border: solid 1px var(--avg-border-color);
    border-radius: 4px;
    outline: none;
}

.avg-list-search:focus {
    border-color: var(--avg-accent);
}

.avg-list-body {
    flex: 1 1 auto;
    min-height: 0;
}

/* The rows are engine-rendered, so the item rule has to cover both the pooled cells and the
   select-all row, which is an ordinary element above the scroll area. */
.avg-list-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 6px;
    box-sizing: border-box;
    white-space: nowrap;
    overflow: hidden;
    cursor: pointer;
    user-select: none;
}

.avg-list-all {
    display: flex;
    flex: 0 0 auto;
    height: 24px;
    border-bottom: solid 1px var(--avg-border-color);
    color: var(--avg-text-muted);
}

.avg-list-item:hover {
    background-color: var(--avg-hover-bg);
}

.avg-list-item[data-selected] {
    background-color: var(--avg-selection-bg);
}

.avg-list-item[data-active] {
    outline: solid 1px var(--avg-accent);
    outline-offset: -1px;
}

.avg-list-item[data-disabled] {
    color: var(--avg-text-muted);
    cursor: default;
    opacity: 0.6;
}

.avg-list-label {
    overflow: hidden;
    text-overflow: ellipsis;
}

.avg-list-box {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    color: var(--avg-text-muted);
}

.avg-list-box.avg-checked {
    color: var(--avg-accent);
}

.avg-list-box > svg {
    width: 14px;
    height: 14px;
}

/* A single-pick list has no checkboxes — the row highlight is the selection. */
.avg-list:not([data-multiple]) .avg-list-box {
    display: none;
}

.avg-list-empty {
    padding: 8px;
    color: var(--avg-text-muted);
    text-align: center;
}

/* --- Filter popover --------------------------------------------------------------------
   The body of a filter popover: the checklist, then the two buttons. It sets a min-width and
   lets the popover take its width from it, so a narrow column still gets a readable list. */
.avg-filter-popover .avg-popover-content {
    /* The content scrolls nothing itself — the list inside it does, and a scrollbar on both
       would let the buttons scroll out of reach. */
    overflow: hidden;
}

.avg-filter-content {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
}

.avg-filter-list {
    padding: 0 2px;
}

.avg-filter-buttons {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding: 6px;
    border-top: solid 1px var(--avg-border-color);
}

.avg-button {
    padding: 3px 12px;
    font: inherit;
    color: var(--avg-text);
    background-color: transparent;
    border: solid 1px var(--avg-border-color);
    border-radius: 4px;
    cursor: pointer;
    user-select: none;
}

.avg-button:hover:not(:disabled) {
    border-color: var(--avg-accent);
    color: var(--avg-accent);
}

.avg-button-primary {
    color: var(--avg-bg);
    background-color: var(--avg-accent);
    border-color: var(--avg-accent);
}

.avg-button-primary:hover:not(:disabled) {
    color: var(--avg-bg);
    opacity: 0.85;
}

.avg-button:disabled {
    opacity: 0.45;
    cursor: default;
}

.avg-icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 2px;
    color: inherit;
    background-color: transparent;
    border: none;
    border-radius: 3px;
    cursor: pointer;
}

.avg-icon-button:hover {
    color: var(--avg-accent);
}

/* Lit while its own popover is open — set from the model, so a repaint keeps it. */
.avg-grid .avg-filter-button.avg-filter-open {
    display: inline-flex;
    color: var(--avg-accent);
}

.avg-grid .avg-empty {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--avg-text-muted);
    pointer-events: none;
}
`;

/**
 * Add the stylesheet to a document, at most once.
 *
 * Idempotent by element id, so any number of grids across any number of `create()` calls
 * share one `<style>`. Injecting rather than requiring a CSS import is deliberate: the
 * minimum call must produce a grid that *looks* like a grid, and a library whose first
 * impression is unstyled text costs more than one `<style>` tag does.
 *
 * Pass `injectStyles: false` and link `av-grid.css` yourself to opt out.
 */
export function injectStyles(doc?: Document): void {
    const target = doc ?? (typeof document !== "undefined" ? document : undefined);
    if (!target || target.getElementById(AVGRID_STYLE_ID)) return;

    const style = target.createElement("style");
    style.id = AVGRID_STYLE_ID;
    style.textContent = css;
    // Prepended, not appended, so a host stylesheet of equal specificity wins.
    target.head.prepend(style);
}
