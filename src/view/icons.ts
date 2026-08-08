/**
 * The four icons the grid draws, as SVG source strings.
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
