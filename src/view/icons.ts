/**
 * Every icon the grid draws, as SVG source strings.
 *
 * Replaces the reference's `utils.tsx`, which rendered React icon components to markup with
 * `react-dom/server` — a whole rendering framework invoked to produce a constant. These are
 * constants.
 *
 * Each uses `currentColor`, so an icon is tinted by the CSS custom property on its container
 * and never needs to be re-rendered on a theme change.
 */

const svg = (body: string): string =>
    `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/** Ascending — the arrow points down, matching the reference's `FilterArrowDownIcon`. */
export const sortAscIcon = svg(`<path d="M8 3v10M4.5 9.5 8 13l3.5-3.5"/>`);

export const sortDescIcon = svg(`<path d="M8 13V3M4.5 6.5 8 3l3.5 3.5"/>`);

/** The funnel on a header cell that can be filtered. */
export const filterIcon = svg(`<path d="M2.5 3h11l-4.2 5v4.5L6.7 13.5V8z"/>`);

export const checkIcon = svg(`<path d="M3 8.5 6.5 12 13 4.5"/>`);

export const checkedIcon = svg(
    `<rect x="1.75" y="1.75" width="12.5" height="12.5" rx="2.5"/><path d="M4.5 8.2 7 10.7l4.5-5"/>`,
);

export const uncheckedIcon = svg(
    `<rect x="1.75" y="1.75" width="12.5" height="12.5" rx="2.5"/>`,
);

/** The drag grip in the corner of a resizable popover. */
export const resizeHandleIcon = svg(`<path d="M13 6 6 13M13 10.5l-2.5 2.5"/>`);

/** Remove — on a filter chip, and on the filter bar's "remove all". */
export const closeIcon = svg(`<path d="M4 4l8 8M12 4l-8 8"/>`);

/** A filter chip's disclosure: down when its popover is shut, up while it is open. */
export const chevronDownIcon = svg(`<path d="M4 6.5 8 10.5l4-4"/>`);

export const chevronUpIcon = svg(`<path d="M4 10.5 8 6.5l4 4"/>`);

/** A menu item that opens a submenu. */
export const chevronRightIcon = svg(`<path d="M6 4l4 4-4 4"/>`);

/** Copy — the context menu's clipboard group. */
export const copyIcon = svg(
    `<rect x="5.75" y="5.75" width="8.5" height="8.5" rx="1.5"/><path d="M11 3.75H3.75c-.55 0-1 .45-1 1V11"/>`,
);

export const pasteIcon = svg(
    `<path d="M6 2.75h4v2H6z"/><path d="M10 3.75h1.75c.55 0 1 .45 1 1v8.5c0 .55-.45 1-1 1h-7.5c-.55 0-1-.45-1-1v-8.5c0-.55.45-1 1-1H6"/>`,
);

/** Add — rows and columns alike, in the context menu. */
export const plusIcon = svg(`<path d="M8 3.5v9M3.5 8h9"/>`);

/** Delete — the trash can, on the context menu's destructive items. */
export const deleteIcon = svg(
    `<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M6.75 7v3.5M9.25 7v3.5"/>`,
);

/** The header checkbox when some rows are selected but not all. */
export const indeterminateIcon = svg(
    `<rect x="1.75" y="1.75" width="12.5" height="12.5" rx="2.5"/><path d="M4.5 8h7"/>`,
);
