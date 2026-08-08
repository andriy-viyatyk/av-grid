/**
 * Delimited-text (CSV/TSV) serialize and parse, for clipboard copy/paste.
 *
 * **This is not a port.** `goal.md` lists `core/utils/csv-utils.ts` as "port as-is", but that
 * file is a thin wrapper over the `csv-stringify` and `csv-parse` npm packages — and av-grid
 * ships with zero runtime dependencies. So the two functions keep their signatures and their
 * observed behavior, and the implementation underneath is written here.
 *
 * The behavior that matters is Excel round-tripping: the grid copies TSV to the clipboard and
 * parses TSV back out of it, and a cell containing a tab, a newline, or a quote must survive
 * the trip. That means RFC 4180 quoting rules with a configurable delimiter.
 *
 * The reference's parser was configured `relax_quotes` + `relax_column_count` +
 * `skip_empty_lines`; those three leniencies are reproduced, because clipboard content from
 * the wild is frequently malformed and the reference chose to salvage it rather than throw.
 */

const QUOTE = '"';

export interface CsvStringifyOptions {
    /** Emit a header row of the column names. Default `true`. */
    header?: boolean;
    /**
     * Header labels, when they are not the property names.
     *
     * Without this, the property read off each record and the label written above it are the
     * same string — which breaks as soon as two columns share a name, because the second one
     * reads the first one's property. The grid's copy path therefore keys its records by
     * column *index* and passes the labels here.
     */
    headerNames?: Array<string | undefined>;
    /** Field separator. Default `","`; the grid's clipboard path passes `"\t"`. */
    delimiter?: string;
    /** Line separator. Default `"\n"`. */
    rowDelimiter?: string;
}

/** Render one value the way the reference's `cast` configuration did. */
function castValue(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "object") {
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }
    return String(value);
}

/** Quote only when the field would otherwise be ambiguous — matching csv-stringify. */
function quoteField(field: string, delimiter: string, rowDelimiter: string): string {
    const needsQuote =
        field.includes(QUOTE) ||
        field.includes(delimiter) ||
        field.includes("\r") ||
        field.includes("\n") ||
        (rowDelimiter.length > 0 && field.includes(rowDelimiter));

    if (!needsQuote) return field;
    return QUOTE + field.split(QUOTE).join(QUOTE + QUOTE) + QUOTE;
}

/**
 * Serialize records to delimited text, taking one field per entry in `columns`.
 *
 * `columns` are property names read off each record; an `undefined` entry becomes the
 * literal column name `"undefined"`, which is what the reference did and what a few callers
 * rely on for unnamed columns.
 */
export function recordsToCsv(
    records: readonly unknown[],
    columns: Array<string | undefined>,
    options: CsvStringifyOptions = {},
): string {
    const {
        header = true,
        headerNames,
        delimiter = ",",
        rowDelimiter = "\n",
    } = options;
    const names = columns.map((c) => (c === undefined ? "undefined" : c));

    const lines: string[] = [];
    if (header) {
        const labels = (headerNames ?? names).map((n) =>
            n === undefined ? "undefined" : n,
        );
        lines.push(
            labels.map((n) => quoteField(n, delimiter, rowDelimiter)).join(delimiter),
        );
    }

    for (const record of records) {
        const source = (record ?? {}) as Record<string, unknown>;
        lines.push(
            names
                .map((name) =>
                    quoteField(castValue(source[name]), delimiter, rowDelimiter),
                )
                .join(delimiter),
        );
    }

    // csv-stringify terminates the final row too, and CopyPasteModel's round-trip assumes it.
    return lines.length ? lines.join(rowDelimiter) + rowDelimiter : "";
}

/**
 * Split delimited text into a grid of raw strings.
 *
 * Leniencies carried over from the reference's parser configuration:
 * - **relax_quotes** — a quote that appears mid-field is treated as literal text rather than
 *   an error, and text after a closing quote is appended rather than rejected.
 * - **relax_column_count** — rows may differ in length; nothing is padded or truncated.
 * - **skip_empty_lines** — a line that yields a single empty field is dropped.
 */
function parseDelimited(text: string, delimiter: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = "";
    let inQuotes = false;
    // True once the current field has produced any character, so a quote appearing later is
    // known to be literal rather than an opening quote.
    let fieldStarted = false;

    const endField = () => {
        row.push(field);
        field = "";
        fieldStarted = false;
    };

    const endRow = () => {
        endField();
        // skip_empty_lines
        if (!(row.length === 1 && row[0] === "")) {
            rows.push(row);
        }
        row = [];
    };

    let i = 0;
    while (i < text.length) {
        const ch = text[i];

        if (inQuotes) {
            if (ch === QUOTE) {
                if (text[i + 1] === QUOTE) {
                    field += QUOTE;
                    i += 2;
                    continue;
                }
                inQuotes = false;
                i += 1;
                continue;
            }
            field += ch;
            i += 1;
            continue;
        }

        if (ch === QUOTE && !fieldStarted) {
            inQuotes = true;
            fieldStarted = true;
            i += 1;
            continue;
        }

        if (delimiter.length > 0 && text.startsWith(delimiter, i)) {
            endField();
            i += delimiter.length;
            continue;
        }

        if (ch === "\r") {
            endRow();
            i += text[i + 1] === "\n" ? 2 : 1;
            continue;
        }

        if (ch === "\n") {
            endRow();
            i += 1;
            continue;
        }

        field += ch;
        fieldStarted = true;
        i += 1;
    }

    endRow();
    return rows;
}

export function csvToRecords(
    csv: string,
    withColumns: true,
    delimiter?: string,
    onError?: (err: unknown) => void,
): Record<string, string>[];
export function csvToRecords(
    csv: string,
    withColumns?: false,
    delimiter?: string,
    onError?: (err: unknown) => void,
): string[][];
export function csvToRecords(
    csv: string,
    withColumns?: boolean,
    delimiter?: string,
    onError?: (err: unknown) => void,
): string[][] | Record<string, string>[];
export function csvToRecords(
    csv: string,
    withColumns = false,
    delimiter = "\t",
    onError?: (err: unknown) => void,
): string[][] | Record<string, string>[] {
    try {
        if (!csv?.trim()) {
            return [];
        }

        const rows = parseDelimited(csv, delimiter);
        if (!withColumns) {
            return rows;
        }

        const [header, ...body] = rows;
        if (!header) return [];

        return body.map((cells) => {
            const record: Record<string, string> = {};
            header.forEach((name, i) => {
                record[name] = cells[i] ?? "";
            });
            return record;
        });
    } catch (e) {
        console.error(e);
        onError?.(e);
        return [];
    }
}
