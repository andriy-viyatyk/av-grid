/**
 * Value formatting, comparison and row filtering.
 *
 * Ported from `AVGrid/avGridUtils.ts`. The logic is unchanged; the spellings are not —
 * `formatDispayValue` → `formatDisplayValue`, `tabDelimeter` → `tabDelimiter`.
 *
 * `filterRows` is ported in full even though the filter *models* arrive in task 15: the
 * search-string half is useful now, and having the shape settled means task 15 wires filters
 * in rather than rewriting this.
 */

import { isNullOrUndefined, memorize } from "./core/utils";
import { recordsToCsv } from "./core/csv";
import type {
    Column,
    DisplayFormat,
    Filter,
    OptionsFilter,
    RowCompare,
} from "./types";

/**
 * A comparator for one property, memorized by key so a re-sort reuses the same function
 * identity — which matters because `AVGridData.rowCompare` change detection is by identity.
 */
export const defaultCompare = memorize(
    (propertyKey?: string) =>
        (left: any, right: any): number => {
            const leftV = propertyKey ? left[propertyKey] : left;
            const rightV = propertyKey ? right[propertyKey] : right;

            if (isNullOrUndefined(leftV) !== isNullOrUndefined(rightV)) {
                return isNullOrUndefined(leftV) ? -1 : 1;
            }

            if (typeof leftV === "number" && typeof rightV === "number") {
                return leftV - rightV;
            }

            if (typeof leftV === "string" && typeof rightV === "string") {
                return leftV.localeCompare(rightV);
            }

            if (leftV instanceof Date && rightV instanceof Date) {
                return leftV.getTime() - rightV.getTime();
            }

            if (typeof leftV === "boolean" && typeof rightV === "boolean") {
                if (leftV === rightV) return 0;
                return leftV ? 1 : -1;
            }

            return 0;
        },
) as (propertyKey?: string) => RowCompare;

export function formatDisplayValue(
    value: any,
    format: DisplayFormat = "text",
): string {
    if (isNullOrUndefined(value)) {
        return "";
    }

    switch (format) {
        case "text":
            if (value instanceof Date) {
                return value.toLocaleString();
            }
            if (value || typeof value === "boolean") {
                return value.toString();
            }
            break;
        case "date":
        case "dateTime": {
            if (value instanceof Date) {
                return format === "date"
                    ? value.toLocaleDateString()
                    : value.toLocaleString();
            }
            if (typeof value === "string") {
                const dt = new Date(value);
                if (Number.isNaN(dt.getTime())) return "";
                return format === "date"
                    ? dt.toLocaleDateString()
                    : dt.toLocaleString();
            }
            break;
        }
        case "phone":
            if (typeof value === "string") {
                return value.length === 10
                    ? `(${value.substring(0, 3)}) ${value.substring(
                          3,
                          6,
                      )}-${value.substring(6)}`
                    : value;
            }
            break;
        default:
            break;
    }

    return "";
}

function filtersMatch<R>(row: R, filters?: Filter[]): boolean {
    let match = true;

    if (filters?.length) {
        for (const filter of filters) {
            const rowValue = row[filter.columnKey as keyof R];

            switch (filter.type) {
                case "options": {
                    const optFilter = filter as OptionsFilter;
                    if (optFilter.value?.length) {
                        if (rowValue instanceof Date) {
                            if (
                                !optFilter.value.find((o) =>
                                    o instanceof Date
                                        ? o.getTime() ===
                                          (rowValue as Date).getTime()
                                        : o.value === rowValue,
                                )
                            ) {
                                match = false;
                            }
                        } else if (
                            !optFilter.value.find((o) => o.value === rowValue)
                        ) {
                            match = false;
                        }
                    }
                    break;
                }
            }

            if (!match) break;
        }
    }

    return match;
}

function searchStringMatch<R>(
    row: R,
    columns: Column<R>[],
    searchLower?: string,
): boolean {
    if (searchLower) {
        return columns.some((c) => {
            const value = formatDisplayValue(
                row[c.key as keyof R],
                c.displayFormat,
            )
                ?.toString()
                .toLowerCase();

            return Boolean(value) && value.indexOf(searchLower) >= 0;
        });
    }
    return true;
}

/**
 * Narrow `rows` to those matching every word of `searchString` and every applied `filter`.
 *
 * Returns the *same array* when there is nothing to apply, which is what lets `setRows()` on
 * an unfiltered 100k-row grid avoid copying anything.
 */
export function filterRows<R>(
    rows: readonly R[],
    columns: Column<R>[],
    searchString?: string,
    filters?: Filter[],
): readonly R[] {
    if (!searchString?.length && !filters?.length) {
        return rows;
    }
    const searchLower = searchString
        ?.toLowerCase()
        .split(" ")
        .filter((s) => s);

    return rows.filter((r) => {
        if (!r) return false;
        const sMatch =
            !searchLower?.length ||
            searchLower.every((s) => searchStringMatch(r, columns, s));
        return sMatch && (!filters?.length || filtersMatch(r, filters));
    });
}

/** `"false"` / `"no"` read as false, so a CSV-ish string column can drive a boolean cell. */
export function falseString(v: any): boolean {
    return Boolean(
        v &&
            typeof v === "string" &&
            (v.toLowerCase() === "false" || v.toLowerCase() === "no"),
    );
}

export function gridBoolean(v: any): boolean {
    return Boolean(v && !falseString(v));
}

/** The value a cell shows: the column's own formatter, then `displayFormat`, then raw. */
export function columnDisplayValue<R>(column: Column<R>, row: R): any {
    if (column.formatValue) return column.formatValue(column, row);

    return column.displayFormat
        ? formatDisplayValue(row[column.key as keyof R], column.displayFormat)
        : row[column.key as keyof R];
}

export function rowsToCsvText<R>(
    rows?: readonly R[],
    columns?: Column<R>[],
    withHeaders?: boolean,
    tabDelimiter?: boolean | string,
): string | undefined {
    if (!rows?.length || !columns?.length) return undefined;

    const names = columns.map((c) => c.name ?? String(c.key));

    const records = rows.map((row) =>
        columns.reduce<{ [key: string]: any }>((acc, c, i) => {
            acc[names[i]] = columnDisplayValue(c, row);
            return acc;
        }, {}),
    );

    return recordsToCsv(records, names, {
        header: withHeaders,
        delimiter: tabDelimiter === true ? "\t" : (tabDelimiter as string),
    });
}

/** Coerce an edited value to the column's `dataType`. Used when no `validate` is supplied. */
export function defaultValidate<R>(col: Column<R>, _row: R, val: any): any {
    switch (col.dataType) {
        case "boolean":
            return typeof val === "string" &&
                (val.toLowerCase() === "false" ||
                    val.toLowerCase() === "no" ||
                    val.toLowerCase() === "0")
                ? false
                : Boolean(val);
        case "number": {
            const n = Number(val);
            return isNaN(n) ? null : n;
        }
        default:
            if (val && Array.isArray(col.options)) {
                return col.options.find((o) => o === val) ? val : undefined;
            }
            return val;
    }
}
