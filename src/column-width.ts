/**
 * Content-based column width detection.
 *
 * Ported as-is from `AVGrid/column-width.ts`, plus `detectColumnWidths` — the plural form the
 * inference path in `validate.ts` actually needs, so the caller does not have to write the
 * loop and the row sample twice.
 *
 * It measures by character count, not by text metrics. That is deliberate: a real measurement
 * would mean laying out 100,000 rows before the first paint. The estimate is good enough to
 * produce a grid that looks deliberate rather than uniform, and any column can be given an
 * explicit `width` when it matters.
 */

export interface ColumnWidthOptions {
    /** Approximate width of one character in pixels. Default: 8 (for ~14px font). */
    charWidth?: number;
    /** Padding added to content-based width. Default: 20. */
    padding?: number;
    /** Minimum column width. Default: 60. */
    minWidth?: number;
    /** Maximum column width. Default: 300. */
    maxWidth?: number;
    /**
     * Rows to sample. Default: 100. Scanning every row of a 100k-row grid to pick a width
     * costs more than the first paint does.
     */
    sampleSize?: number;
}

const DEFAULTS: Required<ColumnWidthOptions> = {
    charWidth: 8,
    padding: 20,
    minWidth: 60,
    maxWidth: 300,
    sampleSize: 100,
};

/**
 * Compute a width for one column by scanning row values. Takes the header name into account
 * as well, so a short column with a long name is not clipped.
 */
export function detectColumnWidth(
    rows: readonly Record<string, unknown>[],
    key: string,
    headerName: string,
    options?: ColumnWidthOptions,
): number {
    const { charWidth, padding, minWidth, maxWidth, sampleSize } = {
        ...DEFAULTS,
        ...options,
    };

    let width = headerName.length * charWidth + padding;

    const limit = Math.min(rows.length, sampleSize);
    for (let i = 0; i < limit; i++) {
        const value = rows[i]?.[key];
        if (value !== null && value !== undefined) {
            // `String(aDate)` is the 40-character `toString()` form, which the grid never
            // shows — measuring it would size every date column to the maximum.
            const text =
                value instanceof Date ? value.toLocaleString() : String(value);
            const w = text.length * charWidth + padding;
            if (w > width) width = w;
        }
    }

    return Math.max(minWidth, Math.min(width, maxWidth));
}

/** `detectColumnWidth` for a set of keys, sharing one pass of the options defaults. */
export function detectColumnWidths(
    rows: readonly Record<string, unknown>[],
    keys: readonly string[],
    options?: ColumnWidthOptions,
): Record<string, number> {
    const out: Record<string, number> = {};
    for (const key of keys) {
        out[key] = detectColumnWidth(rows, key, key, options);
    }
    return out;
}
