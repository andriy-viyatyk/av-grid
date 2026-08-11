/**
 * Which filters are applied — and nothing about which rows survive them.
 *
 * Ported from `filters/useFilters.tsx` with the React context removed. What was a provider
 * holding state, an `onApplyFilter` callback and a `localStorage` round-trip becomes a plain
 * model owned by the grid, which the header cells, the filter bar and the popover all reach
 * directly. The apply logic is the reference's, unchanged in shape: **upsert by `columnKey`,
 * delete when the value is nullish** — so "apply a filter with no values" and "remove the
 * filter" are the same call, which is what makes the popover's Clear button one line.
 *
 * The split from `RowsModel` is deliberate and load-bearing: this model owns the list,
 * `RowsModel` owns the pipeline that reads it. Neither knows the other's internals, which is
 * why a filter change costs exactly one `updateRows()` however it arrived.
 *
 * Persistence is the one place the port diverges. The reference writes `localStorage`
 * directly; a library may not assume it is allowed to. So the storage is injected, and
 * passing `persistFilters` at all is the host's consent to write.
 */

import { defaultCompare, filterRows, formatDisplayValue } from "../gridUtils";
import { validateFilters } from "../validate";
import type {
    AnyFilter,
    Column,
    DisplayOption,
    Filter,
    FilterStorage,
    PersistFiltersOptions,
} from "../types";
import type { AVGridModel } from "./AVGridModel";

/** Bumped when the stored shape changes; a config written by an older version is discarded. */
export const FILTERS_CONFIG_VERSION = "1";

export const filtersStorageKey = (name: string): string => `Filters-${name}`;

/** The ISO form `JSON.stringify` gives a `Date`, and the only string shape revived back into one. */
const dateRegex =
    /^\d{4}-(0\d|1[0-2])-([0-2]\d|3[01])T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)\.\d{3}Z$/;

function resolveStorage(
    persist: PersistFiltersOptions | undefined,
): FilterStorage | undefined {
    if (!persist?.name) return undefined;
    if (persist.storage) return persist.storage;
    try {
        return typeof localStorage === "undefined" ? undefined : localStorage;
    } catch {
        // A sandboxed document can throw on the *access*, not just the write.
        return undefined;
    }
}

function reviveValue(value: any, isDateFilter: boolean): any {
    const raw = value !== null && typeof value === "object" && "value" in value
        ? (value as DisplayOption).value
        : value;

    if (typeof raw !== "string" || !(isDateFilter || dateRegex.test(raw))) {
        return value;
    }
    const revived = new Date(raw);
    if (isNaN(revived.getTime())) return value;

    return value !== null && typeof value === "object" && "value" in value
        ? { ...(value as DisplayOption), value: revived }
        : revived;
}

/**
 * Turn what `JSON.parse` gave back into filters, reviving ISO date strings into `Date`s.
 *
 * The reference replaced each option *object* with a bare `Date`, so a restored filter lost
 * its labels and `filtersMatch` had to accept two shapes to cope. Here the `Date` goes back
 * where it came from — inside the option — and the shape is the same before and after a
 * reload. That is a reference bug fixed, not a divergence for its own sake.
 */
export function reviveFilters<R>(
    filters: readonly any[],
    /** Needed only to find a custom filter's `deserialize`; omit for the built-in type. */
    columns?: readonly Column<R>[],
): Filter[] {
    return filters.map((filter) => {
        const f = filter as AnyFilter;

        // A custom filter's value has whatever shape its own `getValue` gave it, so the date
        // revival below — which assumes an options array — must not touch it. `deserialize` is
        // the definition's chance to rebuild anything JSON could not carry.
        const definition = columns?.find((c) => String(c.key) === f.columnKey)?.filter;
        if (definition) {
            return definition.deserialize
                ? { ...f, value: definition.deserialize(f.value) }
                : f;
        }

        if (!Array.isArray(f.value)) return f;

        const isDateFilter =
            f.displayFormat === "date" || f.displayFormat === "dateTime";
        return { ...f, value: f.value.map((v) => reviveValue(v, isDateFilter)) };
    });
}

/** Is there a stored filter config for this name? Answers before a grid exists. */
export function hasStoredFilters(persist: PersistFiltersOptions): boolean {
    const storage = resolveStorage(persist);
    if (!storage) return false;
    try {
        return Boolean(storage.getItem(filtersStorageKey(persist.name)));
    } catch {
        return false;
    }
}

/**
 * Read the stored filters, or `undefined` if there is nothing usable there.
 *
 * `undefined` and `[]` mean different things: nothing stored versus a stored decision to have
 * no filters. The first falls back to the `filters` option, the second overrides it.
 */
export function readStoredFilters<R>(
    persist: PersistFiltersOptions | undefined,
    columns?: readonly Column<R>[],
): Filter[] | undefined {
    const storage = resolveStorage(persist);
    if (!storage || !persist) return undefined;

    try {
        const raw = storage.getItem(filtersStorageKey(persist.name));
        if (!raw) return undefined;
        const config = JSON.parse(raw);
        if (
            config &&
            config.configVersion === FILTERS_CONFIG_VERSION &&
            Array.isArray(config.filters)
        ) {
            return reviveFilters(config.filters, columns);
        }
    } catch (e) {
        // A corrupt or foreign config is not worth throwing over — the grid renders unfiltered
        // and the next change overwrites it. Warn, because silence here is indistinguishable
        // from "the user had no filters".
        console.warn(
            `av-grid: could not restore filters from ${filtersStorageKey(persist.name)}:`,
            e,
        );
    }
    return undefined;
}

export function writeStoredFilters<R>(
    filters: readonly Filter[],
    persist: PersistFiltersOptions | undefined,
    /** Needed only to find a custom filter's `serialize`; omit for the built-in type. */
    columns?: readonly Column<R>[],
): void {
    const storage = resolveStorage(persist);
    if (!storage || !persist) return;

    try {
        const stored = columns
            ? filters.map((filter) => {
                  const definition = columns.find(
                      (c) => String(c.key) === filter.columnKey,
                  )?.filter;
                  return definition?.serialize
                      ? { ...filter, value: definition.serialize(filter.value) }
                      : filter;
              })
            : filters;
        storage.setItem(
            filtersStorageKey(persist.name),
            JSON.stringify({ configVersion: FILTERS_CONFIG_VERSION, filters: stored }),
        );
    } catch (e) {
        // Quota, or a private-mode store that accepts nothing. Filtering still works; only
        // remembering it does not.
        console.warn("av-grid: could not persist filters:", e);
    }
}

/** Dates compare by instant — a filter that has been through storage is never `===`. */
function sameOption(a: any, b: any): boolean {
    if (a === b) return true;
    if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
    if (a.label !== b.label) return false;
    if (a.value instanceof Date && b.value instanceof Date) {
        return a.value.getTime() === b.value.getTime();
    }
    return a.value === b.value;
}

/**
 * The distinct values of one column, as options — what the popover shows when the host has not
 * said otherwise.
 *
 * Ported from the reference's *host* implementation (`GridEditor.onGetOptions`), which every
 * Persephone grid had to write for itself. Here it is the default, so `filterType: "options"`
 * needs no host code at all — an `onGetOptions` option remains for a host whose values do not
 * live in the rows.
 *
 * The options **cascade**: they are computed over the rows the *other* filters and the search
 * box have already left, so a value that would select nothing is never offered. Two divergences
 * from the reference, both deliberate: the grid's `searchString` narrows them too (it hides
 * rows just as a filter does), and `search` matches the option *labels* rather than being fed
 * back in as a row search, which is what the popover's search box means by it.
 */
export function defaultFilterOptions<R>(
    rows: readonly R[],
    columns: Column<R>[],
    filters: readonly Filter[],
    columnKey: string,
    search?: string,
    searchString?: string,
): DisplayOption[] {
    const column = columns.find((c) => String(c.key) === columnKey);
    const others = filters.filter((f) => f.columnKey !== columnKey);

    const distinct = new Set<any>();
    for (const row of filterRows(rows, columns, searchString, others)) {
        // The same rule the row filter matches by: a computed column has no row property, so
        // its distinct values are the ones it displays.
        distinct.add(
            column?.formatValue ? column.formatValue(column, row) : (row as any)?.[columnKey],
        );
    }

    const values = Array.from(distinct);
    values.sort(defaultCompare());

    const options = values.map<DisplayOption>((value) => ({
        value,
        // Only when true. An option becomes the filter's value, which is what `getFilters()`
        // hands back and what persistence writes — `italic: false` on every one of them is
        // noise in both.
        ...(value === undefined || value === null ? { italic: true } : undefined),
        // Named rather than blank: a row reading `(null)` is a value you can choose, an empty
        // row is a rendering bug. `(empty)` for the empty string is applied by the list body,
        // which is where the same rule has to hold for host-supplied options too.
        label:
            value === undefined
                ? "(undefined)"
                : value === null
                  ? "(null)"
                  : // The column's own formatting, so an option reads exactly as the cells it
                    // will keep — a date option that said `Tue Jan 02 2024 00:00:00 GMT+…`
                    // against cells reading `1/2/2024` is the same value twice over.
                    formatDisplayValue(value, column?.displayFormat),
    }));

    if (!search) return options;
    const lower = search.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(lower));
}

/**
 * Two custom filter values, compared by content.
 *
 * A definition's `getValue` builds a fresh object every time, so `===` would report every
 * `setFilters` as a change — and a host echoing `onFiltersChange` straight back would then loop.
 * `JSON.stringify` is the comparison that matches how the value is persisted; anything it cannot
 * take (a cycle, a function) falls back to identity.
 */
function sameCustomValue(a: any, b: any): boolean {
    if (a === b) return true;
    if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
    try {
        return JSON.stringify(a) === JSON.stringify(b);
    } catch {
        return false;
    }
}

function sameFilter(a: Filter, b: Filter): boolean {
    if (a === b) return true;
    if (!b || a.columnKey !== b.columnKey || a.type !== b.type) return false;

    const av = (a as AnyFilter).value;
    const bv = (b as AnyFilter).value;
    if (!Array.isArray(av) || !Array.isArray(bv)) return sameCustomValue(av, bv);
    return av.length === bv.length && av.every((o, i) => sameOption(o, bv[i]));
}

export class FiltersModel<R> {
    readonly model: AVGridModel<R>;

    constructor(model: AVGridModel<R>) {
        this.model = model;

        // Stored filters win over the `filters` option: the option is the grid's default, the
        // stored list is what this user last chose. Only when nothing is stored does the
        // option apply — which is also what makes `persistFilters` safe to add to an existing
        // grid without changing its first render.
        const stored = readStoredFilters(model.options.persistFilters, this.columns);
        if (stored) this.model.options.filters = this.restore(stored);
    }

    /**
     * Validate stored filters one at a time, dropping what no longer fits.
     *
     * Host input is validated loudly, because a typo there is a bug the author can fix.
     * Storage is different: a filter written months ago against a column that has since been
     * renamed is not a bug in today's code, and throwing out of `create()` over it would take
     * the whole grid down. So each is checked alone and a casualty is warned about.
     */
    private restore(stored: readonly Filter[]): Filter[] {
        const kept: Filter[] = [];
        for (const filter of stored) {
            try {
                kept.push(...this.validate([filter]));
            } catch (e) {
                console.warn(
                    `av-grid: dropping stored filter for column "${filter?.columnKey}":`,
                    e instanceof Error ? e.message : e,
                );
            }
        }
        return kept;
    }

    /** The applied filters, normalized. Treat as read-only; `setFilters` replaces it. */
    get filters(): Filter[] {
        return this.model.options.filters ?? [];
    }

    getFilters(): Filter[] {
        return [...this.filters];
    }

    filterFor(columnKey: string): Filter | undefined {
        return this.filters.find((f) => f.columnKey === columnKey);
    }

    /** Does this column have a filter on it? The header cell's funnel reads this. */
    isFiltered(columnKey: string): boolean {
        return this.filters.some((f) => f.columnKey === columnKey);
    }

    /**
     * The filter on this column, or a blank normalized one — what the popover opens onto.
     *
     * A column with no filter yet still has a `columnName`, a `type` and a `displayFormat`, so
     * the popover never has to reach back to the column set to find out what it is editing.
     */
    filterOrDefault(columnKey: string): Filter {
        const existing = this.filterFor(columnKey);
        return existing ?? this.validate([{ columnKey }])[0];
    }

    /**
     * The options to offer for one column — the host's `onGetOptions`, or the distinct values
     * of the column when there is none.
     *
     * Handed the *other* filters, never this column's own: a checklist that excluded the values
     * you had already unticked could never be used to tick them back on.
     */
    getOptions(
        columnKey: string,
        search?: string,
    ): DisplayOption[] | Promise<DisplayOption[]> {
        const columns = this.model.data.columns;
        const others = this.filters.filter((f) => f.columnKey !== columnKey);
        const host = this.model.options.onGetOptions;
        return host
            ? host(columns, others, columnKey, search)
            : defaultFilterOptions(
                  this.model.options.rows,
                  columns,
                  this.filters,
                  columnKey,
                  search,
                  this.model.options.searchString,
              );
    }

    setFilters = (filters: readonly Filter[] | undefined): void => {
        const next = this.validate(filters);
        if (this.same(next, this.filters)) return;
        this.model.options.filters = next;
        this.filtersChanged();
    };

    /**
     * Upsert one filter by `columnKey`, or remove it when the value is empty.
     *
     * The reference's `onApplyFilter`, and the reason the popover needs no separate remove
     * path: applying an empty selection removes the filter instead of filtering to nothing.
     *
     * ```js
     * grid.applyFilter({ columnKey: "status", value: ["open"] });   // apply
     * grid.applyFilter({ columnKey: "status" });                    // remove
     * ```
     */
    applyFilter = (filter: Filter): void => {
        const [normalized] = this.validate([filter]);
        const value = (normalized as AnyFilter).value;
        if (value === undefined || value === null || (Array.isArray(value) && !value.length)) {
            this.removeFilter(normalized.columnKey);
            return;
        }

        const current = this.filters;
        const exists = current.some((f) => f.columnKey === normalized.columnKey);
        this.model.options.filters = exists
            ? current.map((f) =>
                  f.columnKey === normalized.columnKey ? normalized : f,
              )
            : [...current, normalized];
        this.filtersChanged();
    };

    removeFilter = (columnKey: string): void => {
        const current = this.filters;
        const next = current.filter((f) => f.columnKey !== columnKey);
        if (next.length === current.length) return;
        this.model.options.filters = next;
        this.filtersChanged();
    };

    clearFilters = (): void => {
        if (!this.filters.length) return;
        this.model.options.filters = [];
        this.filtersChanged();
    };

    /**
     * The columns to resolve a filter against — the live set, or the option when the data model
     * has not built one yet, which is the case while this model's own constructor runs.
     */
    private get columns(): Column<R>[] {
        return this.model.data.columns.length
            ? this.model.data.columns
            : this.model.options.columns;
    }

    private validate = (filters: readonly Filter[] | undefined): Filter[] =>
        validateFilters<R>(filters, this.columns);

    /**
     * Same filters? A `setFilters` that changes nothing must not re-run the pipeline — a host
     * echoing `onFiltersChange` straight back would otherwise loop, and re-filtering 100k rows
     * is not free.
     *
     * Compared by value rather than by identity, because it has to be: `getFilters()` hands
     * back a normalized copy, and `setFilters()` normalizes again on the way in, so the very
     * round-trip this guards against never produces the same objects.
     */
    private same = (a: readonly Filter[], b: readonly Filter[]): boolean =>
        a.length === b.length && a.every((f, i) => sameFilter(f, b[i]));

    private filtersChanged = (): void => {
        writeStoredFilters(
            this.filters,
            this.model.options.persistFilters,
            this.columns,
        );
        this.model.models.rows.updateRows();
        this.model.options.onFiltersChange?.(this.getFilters());
        // The filter bar redraws from this. Internal, and separate from the host callback above,
        // so a host passing `onFiltersChange` does not displace the bar's own subscription.
        this.model.events.onFiltersChanged.send(this.getFilters());
        // The header row carries the funnel state, and `updateRows` has already marked
        // everything — but a frozen grid short-circuits that, so mark it explicitly.
        this.model.update({ rows: [0] });
    };
}
