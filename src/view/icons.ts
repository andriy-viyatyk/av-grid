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

/**
 * The busy spinner in a tree chevron's slot (task 64), copied from Persephone's `ProgressIcon`
 * so a host running both sees one spinner rather than two that nearly match.
 *
 * Ten tapered spokes, 36 degrees apart, `fill-opacity` stepping 0.1 -> 1.0 around the dial. The
 * stylesheet turns it with `steps(10)`, which is the other half of the copy: one step is exactly
 * one spoke, so each lands where the last one was and the dial ticks instead of sweeping. A
 * linear rotation of the same icon is a visibly different spinner.
 *
 * `fill="currentColor"` with graded opacity rather than stroke, so it tints from the slot's
 * `color` like every other icon here, and so it still reads as a spinner standing still — which
 * is the whole `prefers-reduced-motion` fallback.
 */
export const spinnerIcon =
    `<svg viewBox="0 0 32 32" width="32" height="32" fill="none" aria-hidden="true">` +
    `<path d="M17.4378 30.9492C17.4378 31.8057 16.794 32.5 15.9999 32.5C15.2058 32.5 14.562 31.8057 14.562 30.9492V26.6661C14.562 25.8097 15.2058 25.1154 15.9999 25.1154C16.794 25.1154 17.4378 25.8097 17.4378 26.6661V30.9492Z" fill="currentColor" fill-opacity="0.5" />` +
    `<path d="M25.8454 27.3629C26.36 28.0558 26.2564 28.9877 25.6139 29.4443C24.9715 29.9009 24.0335 29.7094 23.5188 29.0165L20.9453 25.5514C20.4307 24.8585 20.5343 23.9266 21.1768 23.47C21.8192 23.0134 22.7572 23.2049 23.2719 23.8978L25.8454 27.3629Z" fill="currentColor" fill-opacity="0.6" />` +
    `<path d="M30.4922 19.6273C31.3248 19.8919 31.8009 20.7054 31.5555 21.4442C31.3101 22.1831 30.4362 22.5674 29.6035 22.3028L25.4394 20.9792C24.6067 20.7146 24.1306 19.9011 24.376 19.1623C24.6214 18.4234 25.4954 18.0391 26.328 18.3037L30.4922 19.6273Z" fill="currentColor" fill-opacity="0.7" />` +
    `<path d="M29.6036 10.6972C30.4363 10.4325 31.3103 10.8169 31.5557 11.5557C31.8011 12.2945 31.325 13.108 30.4923 13.3727L26.3282 14.6962C25.4955 14.9609 24.6215 14.5765 24.3761 13.8377C24.1307 13.0989 24.6068 12.2854 25.4395 12.0207L29.6036 10.6972Z" fill="currentColor" fill-opacity="0.8" />` +
    `<path d="M23.5189 3.98348C24.0335 3.29059 24.9715 3.09904 25.614 3.55566C26.2564 4.01228 26.3601 4.94414 25.8454 5.63704L23.2719 9.10213C22.7573 9.79503 21.8192 9.98657 21.1768 9.52996C20.5343 9.07334 20.4307 8.14147 20.9453 7.44858L23.5189 3.98348Z" fill="currentColor" fill-opacity="0.9" />` +
    `<path d="M14.5622 2.05077C14.5622 1.1943 15.206 0.5 16.0001 0.5C16.7942 0.5 17.438 1.1943 17.438 2.05077V6.33386C17.438 7.19033 16.7942 7.88463 16.0001 7.88463C15.206 7.88463 14.5622 7.19033 14.5622 6.33386V2.05077Z" fill="currentColor" />` +
    `<path d="M6.15458 5.63709C5.63996 4.94419 5.74359 4.01232 6.38606 3.55571C7.02853 3.09909 7.96653 3.29063 8.48116 3.98353L11.0547 7.44862C11.5693 8.14152 11.4657 9.07339 10.8232 9.53C10.1808 9.98662 9.24277 9.79507 8.72815 9.10218L6.15458 5.63709Z" fill="currentColor" fill-opacity="0.1" />` +
    `<path d="M1.50783 13.3727C0.675156 13.1081 0.199073 12.2946 0.444473 11.5558C0.689873 10.8169 1.56383 10.4326 2.39651 10.6972L6.56063 12.0208C7.3933 12.2854 7.86939 13.0989 7.62399 13.8377C7.37859 14.5766 6.50463 14.9609 5.67195 14.6963L1.50783 13.3727Z" fill="currentColor" fill-opacity="0.2" />` +
    `<path d="M2.39637 22.3028C1.56369 22.5675 0.689736 22.1831 0.444336 21.4443C0.198936 20.7055 0.675019 19.892 1.5077 19.6273L5.67182 18.3038C6.50449 18.0391 7.37845 18.4235 7.62385 19.1623C7.86925 19.9011 7.39317 20.7146 6.56049 20.9793L2.39637 22.3028Z" fill="currentColor" fill-opacity="0.3" />` +
    `<path d="M8.48113 29.0165C7.96651 29.7094 7.0285 29.901 6.38604 29.4443C5.74357 28.9877 5.63993 28.0559 6.15456 27.363L8.72812 23.8979C9.24275 23.205 10.1808 23.0134 10.8232 23.47C11.4657 23.9267 11.5693 24.8585 11.0547 25.5514L8.48113 29.0165Z" fill="currentColor" fill-opacity="0.4" />` +
    `</svg>`;

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
