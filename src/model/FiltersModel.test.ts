import { beforeEach, describe, expect, it, vi } from "vitest";
import { AVGridModel } from "./AVGridModel";
import {
    FILTERS_CONFIG_VERSION,
    filtersStorageKey,
    hasStoredFilters,
    readStoredFilters,
    reviveFilters,
    writeStoredFilters,
} from "./FiltersModel";
import { resolveOptions } from "../validate";
import type { AVGridOptions } from "../options";
import type { Filter, FilterStorage } from "../types";

interface Row {
    id: number;
    first: string;
    last: string;
    status: string;
    due: Date;
}

const rows: Row[] = [
    { id: 1, first: "Ada", last: "Lovelace", status: "open", due: new Date("2026-01-01T00:00:00.000Z") },
    { id: 2, first: "Grace", last: "Hopper", status: "closed", due: new Date("2026-02-01T00:00:00.000Z") },
    { id: 3, first: "Alan", last: "Turing", status: "open", due: new Date("2026-01-01T00:00:00.000Z") },
];

const columns = [
    { key: "id", name: "ID" },
    { key: "first", name: "First" },
    { key: "last", name: "Last" },
    { key: "status", name: "Status", filterType: "options" as const },
    { key: "due", name: "Due", displayFormat: "date" as const },
    {
        key: "full",
        name: "Full Name",
        // A computed column: no such property on the row.
        formatValue: (_c: any, row: Row) => `${row.first} ${row.last}`,
    },
];

function makeModel(options?: Partial<AVGridOptions<Row>>) {
    const model = new AVGridModel<Row>(
        resolveOptions<Row>({ rows, columns, ...options } as AVGridOptions<Row>),
    );
    const updates: any[] = [];
    model.setRenderModel({
        update: (r: any) => updates.push(r),
        requestRepaint: () => updates.push("repaint"),
    } as any);
    return { model, updates };
}

/** A `localStorage` stand-in, so nothing here touches the real one. */
function makeStorage(seed?: Record<string, string>): FilterStorage & { map: Map<string, string> } {
    const map = new Map<string, string>(Object.entries(seed ?? {}));
    return {
        map,
        getItem: (k) => map.get(k) ?? null,
        setItem: (k, v) => void map.set(k, v),
        removeItem: (k) => void map.delete(k),
    };
}

const names = (model: AVGridModel<Row>) => model.data.rows.map((r) => r.first);

describe("FiltersModel", () => {
    let model: AVGridModel<Row>;
    let updates: any[];

    beforeEach(() => {
        ({ model, updates } = makeModel());
        updates.length = 0;
    });

    describe("applying", () => {
        it("filters rows to the selected values", () => {
            model.models.filters.applyFilter({
                columnKey: "status",
                value: ["open"],
            });
            expect(names(model)).toEqual(["Ada", "Alan"]);
        });

        it("upserts by column key rather than stacking filters", () => {
            const filters = model.models.filters;
            filters.applyFilter({ columnKey: "status", value: ["open"] });
            filters.applyFilter({ columnKey: "status", value: ["closed"] });

            expect(filters.getFilters()).toHaveLength(1);
            expect(names(model)).toEqual(["Grace"]);
        });

        it("removes the filter when the value is empty, rather than showing no rows", () => {
            const filters = model.models.filters;
            filters.applyFilter({ columnKey: "status", value: ["open"] });
            filters.applyFilter({ columnKey: "status", value: [] });

            expect(filters.getFilters()).toEqual([]);
            expect(names(model)).toEqual(["Ada", "Grace", "Alan"]);
        });

        it("removes the filter when the value is missing entirely", () => {
            const filters = model.models.filters;
            filters.applyFilter({ columnKey: "status", value: ["open"] });
            filters.applyFilter({ columnKey: "status" });

            expect(filters.isFiltered("status")).toBe(false);
        });

        it("combines two filters as AND", () => {
            const filters = model.models.filters;
            filters.applyFilter({ columnKey: "status", value: ["open"] });
            filters.applyFilter({ columnKey: "first", value: ["Alan"] });
            expect(names(model)).toEqual(["Alan"]);
        });

        it("combines a filter with the search string", () => {
            model.models.filters.applyFilter({
                columnKey: "status",
                value: ["open"],
            });
            model.setSearchString("ada");
            expect(names(model)).toEqual(["Ada"]);
        });

        it("removeFilter and clearFilters both restore every row", () => {
            const filters = model.models.filters;
            filters.applyFilter({ columnKey: "status", value: ["open"] });
            filters.removeFilter("status");
            expect(names(model)).toHaveLength(3);

            filters.applyFilter({ columnKey: "status", value: ["open"] });
            filters.clearFilters();
            expect(names(model)).toHaveLength(3);
        });

        it("does nothing when removing a filter that is not applied", () => {
            const onFiltersChange = vi.fn();
            model.options.onFiltersChange = onFiltersChange;
            model.models.filters.removeFilter("status");
            model.models.filters.clearFilters();
            expect(onFiltersChange).not.toHaveBeenCalled();
        });
    });

    describe("normalizing", () => {
        it("expands bare values into labelled options", () => {
            model.models.filters.setFilters([
                { columnKey: "status", value: ["open"] },
            ]);
            expect((model.models.filters.getFilters()[0] as any).value).toEqual([
                { value: "open", label: "open" },
            ]);
        });

        it("fills in the column name and the filter type from the column", () => {
            model.models.filters.setFilters([
                { columnKey: "status", value: ["open"] },
            ]);
            const [filter] = model.models.filters.getFilters();
            expect(filter.columnName).toBe("Status");
            expect(filter.type).toBe("options");
        });

        it("takes the display format from the column, for the chips to format by", () => {
            model.models.filters.setFilters([
                { columnKey: "due", value: [rows[0].due] },
            ]);
            expect(model.models.filters.getFilters()[0].displayFormat).toBe("date");
        });

        it("keeps option objects as they are", () => {
            model.models.filters.setFilters([
                {
                    columnKey: "status",
                    value: [{ value: "open", label: "Open" }],
                },
            ]);
            expect((model.models.filters.getFilters()[0] as any).value[0].label).toBe("Open");
        });

        it("rejects an unknown column loudly", () => {
            expect(() =>
                model.models.filters.setFilters([
                    { columnKey: "staus", value: ["open"] },
                ]),
            ).toThrow(/Unknown column "staus"/);
        });

        it("rejects a value that is not an array", () => {
            expect(() =>
                model.models.filters.setFilters([
                    { columnKey: "status", value: "open" } as any,
                ]),
            ).toThrow(/must be an array/);
        });
    });

    describe("values that are not strings", () => {
        it("matches dates by instant, not by object identity", () => {
            model.models.filters.applyFilter({
                columnKey: "due",
                // A different Date object for the same moment — which is what a filter
                // restored from storage always is.
                value: [new Date("2026-01-01T00:00:00.000Z")],
            });
            expect(names(model)).toEqual(["Ada", "Alan"]);
        });

        it("filters a computed column by what it displays", () => {
            model.models.filters.applyFilter({
                columnKey: "full",
                value: ["Grace Hopper"],
            });
            expect(names(model)).toEqual(["Grace"]);
        });
    });

    describe("notifying", () => {
        it("reports the normalized list on every change", () => {
            const onFiltersChange = vi.fn();
            model.options.onFiltersChange = onFiltersChange;

            model.models.filters.applyFilter({
                columnKey: "status",
                value: ["open"],
            });

            expect(onFiltersChange).toHaveBeenCalledTimes(1);
            expect(onFiltersChange.mock.calls[0][0][0].columnName).toBe("Status");
        });

        it("ignores a set of the filters it already has, so an echo cannot loop", () => {
            const onFiltersChange = vi.fn();
            model.options.onFiltersChange = onFiltersChange;

            model.models.filters.applyFilter({
                columnKey: "status",
                value: ["open"],
            });
            model.models.filters.setFilters(model.models.filters.getFilters());

            expect(onFiltersChange).toHaveBeenCalledTimes(1);
        });

        it("marks the header row dirty, so the funnel indicator repaints", () => {
            updates.length = 0;
            model.models.filters.applyFilter({
                columnKey: "status",
                value: ["open"],
            });
            expect(updates).toContainEqual({ rows: [0] });
        });
    });

    describe("persistence", () => {
        it("writes nothing at all without persistFilters", () => {
            const storage = makeStorage();
            const { model } = makeModel();
            model.models.filters.applyFilter({
                columnKey: "status",
                value: ["open"],
            });
            expect(storage.map.size).toBe(0);
        });

        it("stores the filters under Filters-<name>", () => {
            const storage = makeStorage();
            const { model } = makeModel({ persistFilters: { name: "orders", storage } });

            model.models.filters.applyFilter({
                columnKey: "status",
                value: ["open"],
            });

            const raw = storage.getItem(filtersStorageKey("orders"));
            expect(raw).toBeTruthy();
            expect(JSON.parse(raw!).configVersion).toBe(FILTERS_CONFIG_VERSION);
        });

        it("restores them into the next grid, before its first render", () => {
            const storage = makeStorage();
            const first = makeModel({ persistFilters: { name: "orders", storage } });
            first.model.models.filters.applyFilter({
                columnKey: "status",
                value: ["open"],
            });

            const { model: restored } = makeModel({
                persistFilters: { name: "orders", storage },
            });
            // Not "after a repaint" — the rows are already narrowed by the time the model
            // constructor returns, because the restore happens before the first updateRows().
            expect(names(restored)).toEqual(["Ada", "Alan"]);
        });

        it("revives dates as Dates, inside the option they came from", () => {
            const storage = makeStorage();
            const first = makeModel({ persistFilters: { name: "dates", storage } });
            first.model.models.filters.applyFilter({
                columnKey: "due",
                value: [{ value: rows[0].due, label: "1 Jan" }],
            });

            const { model: restored } = makeModel({
                persistFilters: { name: "dates", storage },
            });
            const option = (restored.models.filters.getFilters()[0] as any).value[0];
            expect(option.value).toBeInstanceOf(Date);
            expect(option.value.getTime()).toBe(rows[0].due.getTime());
            // The reference replaced the whole option with a bare Date and lost this.
            expect(option.label).toBe("1 Jan");
            expect(names(restored)).toEqual(["Ada", "Alan"]);
        });

        it("prefers the stored filters over the filters option", () => {
            const storage = makeStorage();
            const first = makeModel({ persistFilters: { name: "orders", storage } });
            first.model.models.filters.applyFilter({
                columnKey: "status",
                value: ["closed"],
            });

            const { model: restored } = makeModel({
                filters: [{ columnKey: "status", value: ["open"] } as Filter],
                persistFilters: { name: "orders", storage },
            });
            expect(names(restored)).toEqual(["Grace"]);
        });

        it("falls back to the filters option when nothing is stored", () => {
            const storage = makeStorage();
            const { model } = makeModel({
                filters: [{ columnKey: "status", value: ["open"] } as Filter],
                persistFilters: { name: "empty", storage },
            });
            expect(names(model)).toEqual(["Ada", "Alan"]);
        });

        it("remembers a stored decision to have no filters", () => {
            const storage = makeStorage();
            const first = makeModel({ persistFilters: { name: "orders", storage } });
            first.model.models.filters.applyFilter({
                columnKey: "status",
                value: ["open"],
            });
            first.model.models.filters.clearFilters();

            const { model: restored } = makeModel({
                filters: [{ columnKey: "status", value: ["open"] } as Filter],
                persistFilters: { name: "orders", storage },
            });
            expect(names(restored)).toHaveLength(3);
        });

        it("discards a config written by an older version", () => {
            const storage = makeStorage({
                [filtersStorageKey("old")]: JSON.stringify({
                    configVersion: "0",
                    filters: [{ columnKey: "status", type: "options", value: ["open"] }],
                }),
            });
            const { model } = makeModel({ persistFilters: { name: "old", storage } });
            expect(names(model)).toHaveLength(3);
        });

        it("survives a corrupt config with a warning rather than a throw", () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            const storage = makeStorage({ [filtersStorageKey("bad")]: "{not json" });

            expect(() =>
                makeModel({ persistFilters: { name: "bad", storage } }),
            ).not.toThrow();
            expect(warn).toHaveBeenCalled();
            warn.mockRestore();
        });

        it("drops a stored filter whose column is gone, and keeps the rest", () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            const storage = makeStorage({
                [filtersStorageKey("stale")]: JSON.stringify({
                    configVersion: FILTERS_CONFIG_VERSION,
                    filters: [
                        { columnKey: "renamedAway", type: "options", value: ["x"] },
                        { columnKey: "status", type: "options", value: ["open"] },
                    ],
                }),
            });

            const { model } = makeModel({ persistFilters: { name: "stale", storage } });
            expect(model.models.filters.getFilters()).toHaveLength(1);
            expect(names(model)).toEqual(["Ada", "Alan"]);
            expect(warn).toHaveBeenCalled();
            warn.mockRestore();
        });

        it("keeps filtering when the store refuses the write", () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            const storage: FilterStorage = {
                getItem: () => null,
                setItem: () => {
                    throw new Error("QuotaExceededError");
                },
                removeItem: () => {},
            };
            const { model } = makeModel({ persistFilters: { name: "full", storage } });

            expect(() =>
                model.models.filters.applyFilter({
                    columnKey: "status",
                    value: ["open"],
                }),
            ).not.toThrow();
            expect(names(model)).toEqual(["Ada", "Alan"]);
            warn.mockRestore();
        });
    });

    describe("the storage helpers, without a grid", () => {
        it("answers whether a config exists before anything is created", () => {
            const storage = makeStorage();
            expect(hasStoredFilters({ name: "x", storage })).toBe(false);
            writeStoredFilters([{ columnKey: "status" }], { name: "x", storage });
            expect(hasStoredFilters({ name: "x", storage })).toBe(true);
        });

        it("tells nothing-stored apart from stored-and-empty", () => {
            const storage = makeStorage();
            expect(readStoredFilters({ name: "x", storage })).toBeUndefined();
            writeStoredFilters([], { name: "x", storage });
            expect(readStoredFilters({ name: "x", storage })).toEqual([]);
        });

        it("revives an ISO string even when the filter has no date format", () => {
            const [filter] = reviveFilters([
                {
                    columnKey: "due",
                    type: "options",
                    value: [{ value: "2026-01-01T00:00:00.000Z", label: "1 Jan" }],
                },
            ]);
            expect((filter as any).value[0].value).toBeInstanceOf(Date);
        });

        it("leaves a string that merely looks date-ish alone", () => {
            const [filter] = reviveFilters([
                { columnKey: "status", type: "options", value: [{ value: "2026-01-01", label: "x" }] },
            ]);
            expect((filter as any).value[0].value).toBe("2026-01-01");
        });
    });
});
