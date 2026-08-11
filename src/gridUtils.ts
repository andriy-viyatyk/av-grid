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

/**
 * A filter paired with the column it names, resolved once for the whole pass rather than
 * once per row — the difference between one lookup and a hundred thousand.
 */
interface ResolvedFilter<R> {
    filter: Filter;
    column?: Column<R>;
}

function filterValue<R>(row: R, resolved: ResolvedFilter<R>): any {
    const { filter, column } = resolved;
    // A computed column has no row property to compare, so it is matched by what it *shows* —
    // the same rule the clipboard already copies by. `formatValue` only; `render` is not
    // called here, because it may return an element and it is host code inside the row loop.
    return column?.formatValue
        ? column.formatValue(column, row)
        : row[filter.columnKey as keyof R];
}

/**
 * Does one selected option match a row's value?
 *
 * `option` is normally a `DisplayOption`, but `filterRows` is public and a hand-written call
 * may pass bare values, so both shapes are read. Dates compare by instant: two `Date` objects
 * for the same moment are never `===`, and a filter restored from storage is always a
 * different object from the one in the row.
 */
function optionMatches(option: any, rowValue: any): boolean {
    const value =
        option !== null &&
        typeof option === "object" &&
        !(option instanceof Date) &&
        "value" in option
            ? option.value
            : option;

    if (rowValue instanceof Date && value instanceof Date) {
        return value.getTime() === rowValue.getTime();
    }
    return value === rowValue;
}

function filtersMatch<R>(row: R, filters?: ResolvedFilter<R>[]): boolean {
    let match = true;

    if (filters?.length) {
        for (const resolved of filters) {
            const filter = resolved.filter;
            const column = resolved.column;

            // A column with its own `filter` owns the whole row test: no value is read for it,
            // because a custom filter may compare several properties or none. Resolved once for
            // the pass, so this is a property read rather than a lookup per row.
            const definition = column?.filter;
            if (definition) {
                const value = filter.value;
                if (
                    value !== undefined &&
                    value !== null &&
                    !definition.match(value, row, column!)
                ) {
                    match = false;
                }
                if (!match) break;
                continue;
            }

            const rowValue = filterValue(row, resolved);

            switch (filter.type ?? "options") {
                case "options": {
                    const optFilter = filter as OptionsFilter;
                    // An empty selection filters nothing — the model removes such a filter
                    // rather than showing an empty grid, and this is the same rule one level
                    // down, for anyone calling `filterRows` directly.
                    if (optFilter.value?.length) {
                        if (!optFilter.value.some((o) => optionMatches(o, rowValue))) {
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
            // `columnDisplayValue`, not the raw property: a computed column — one with a
            // `formatValue` and no row property behind it — is on screen, so a search that
            // could not match it was a search the user could see failing. Deferred from task
            // 13 to here because it puts a host callback inside the row loop; measured on the
            // board rather than assumed, and it only runs while a search is active.
            const value = columnDisplayValue(c, row)?.toString().toLowerCase();

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

    const resolved = filters?.length
        ? filters.map<ResolvedFilter<R>>((filter) => ({
              filter,
              column: columns.find((c) => String(c.key) === filter.columnKey),
          }))
        : undefined;

    return rows.filter((r) => {
        if (!r) return false;
        const sMatch =
            !searchLower?.length ||
            searchLower.every((s) => searchStringMatch(r, columns, s));
        return sMatch && (!resolved?.length || filtersMatch(r, resolved));
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
    // Keyed by index, not by name: two columns may share a name — and a computed column has no
    // row property at all — so the name is not a usable identity. The labels go to `headerNames`.
    const keys = columns.map((_, i) => String(i));

    const records = rows.map((row) =>
        columns.reduce<{ [key: string]: any }>((acc, c, i) => {
            acc[keys[i]] = columnDisplayValue(c, row);
            return acc;
        }, {}),
    );

    return recordsToCsv(records, keys, {
        header: withHeaders,
        headerNames: names,
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
