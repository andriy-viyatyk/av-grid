import { describe, expect, it } from "vitest";
import { defaultValidate, filterRows, gatherByGroup, sortAsList, sortEquals } from "./gridUtils";
import { defaultFilterOptions } from "./model/FiltersModel";

describe("gatherByGroup", () => {
    it("gathers interleaved group columns, anchored where the group first appears", () => {
        const a = { key: "a", group: "G" };
        const b: { key: string; group?: string } = { key: "b" };
        const c = { key: "c", group: "G" };
        const d = { key: "d", group: "H" };
        expect(gatherByGroup([a, b, c, d])).toEqual([a, c, b, d]);
    });

    it("returns the same array when nothing moves — identity is change detection", () => {
        const columns = [
            { key: "a", group: "G" },
            { key: "b", group: "G" },
            { key: "c" },
        ];
        expect(gatherByGroup(columns)).toBe(columns);
        const ungrouped: { key: string; group?: string }[] = [{ key: "a" }, { key: "b" }];
        expect(gatherByGroup(ungrouped)).toBe(ungrouped);
    });

    it("keeps ungrouped columns' relative order around the gathered groups", () => {
        const cols: { key: string; group?: string }[] = [
            { key: "x" },
            { key: "a", group: "G" },
            { key: "y" },
            { key: "b", group: "G" },
            { key: "z" },
        ];
        expect(gatherByGroup(cols).map((c) => c.key)).toEqual([
            "x",
            "a",
            "b",
            "y",
            "z",
        ]);
    });
});

describe("multi-valued option filters", () => {
    const rows = [
        { id: 1, tags: ["x", "y"] },
        { id: 2, tags: ["y"] },
        { id: 3, tags: ["x", "x", "z"] },
        { id: 4, tags: [] },
    ];
    const columns = [{ key: "tags", filterValues: (row: (typeof rows)[number]) => row.tags }];

    it("matches when any value is selected and flattens distinct values", () => {
        const filters = [{ columnKey: "tags", value: ["z", "y"] }];
        expect(filterRows(rows, columns, undefined, filters).map((row) => row.id)).toEqual([1, 2, 3]);
        expect(defaultFilterOptions(rows, columns, [], "tags").map((option) => option.value)).toEqual(["x", "y", "z"]);
    });

    it("counts each option once per row and omits counts by default", () => {
        const plain = defaultFilterOptions(rows, columns, [], "tags");
        expect(plain.every((option) => option.count === undefined)).toBe(true);
        const counted = defaultFilterOptions(rows, columns, [], "tags", undefined, undefined, columns, true);
        expect(counted.map(({ value, count }) => [value, count])).toEqual([["x", 2], ["y", 2], ["z", 1]]);
    });

    it("filters generated options by every word in any order", () => {
        const sourceRows = [
            { id: 1, tag: "ALPHA EAST NURSE" },
            { id: 2, tag: "ALPHA EAST LAB" },
            { id: 3, tag: "NURSE BETA ALPHA" },
        ];
        const options = defaultFilterOptions(sourceRows, [{ key: "tag" }], [], "tag", " nurse alpha ");
        expect(options.map((option) => option.value)).toEqual(["ALPHA EAST NURSE", "NURSE BETA ALPHA"]);
    });
});

describe("sortAsList / sortEquals", () => {
    it("unpacks either arity, [] for unsorted", () => {
        expect(sortAsList(undefined)).toEqual([]);
        expect(sortAsList({ key: "a", direction: "asc" })).toEqual([
            { key: "a", direction: "asc" },
        ]);
        const list = [{ key: "a", direction: "asc" as const }];
        expect(sortAsList(list)).toBe(list);
    });

    it("compares by value across arities", () => {
        expect(
            sortEquals({ key: "a", direction: "asc" }, [
                { key: "a", direction: "asc" },
            ]),
        ).toBe(true);
        expect(
            sortEquals(
                [{ key: "a", direction: "asc" }],
                [{ key: "a", direction: "desc" }],
            ),
        ).toBe(false);
        expect(sortEquals(undefined, [])).toBe(true);
    });
});

describe("defaultValidate against options", () => {
    const row = {};

    it("rejects a value outside an options array", () => {
        const col = { key: "status", options: ["open", "closed"] };
        expect(defaultValidate(col, row, "open")).toBe("open");
        expect(defaultValidate(col, row, "nonsense")).toBeUndefined();
    });

    it("accepts it when the column is freeText — the options are only suggestions", () => {
        const col = { key: "status", options: ["open", "closed"], freeText: true };
        expect(defaultValidate(col, row, "nonsense")).toBe("nonsense");
        expect(defaultValidate(col, row, "open")).toBe("open");
    });

    it("never rejects against function options, which cannot be resolved here", () => {
        const col = { key: "status", options: () => ["open"] };
        expect(defaultValidate(col, row, "nonsense")).toBe("nonsense");
    });

    it("lets an empty value through, which is how a cell is cleared", () => {
        const col = { key: "status", options: ["open"] };
        expect(defaultValidate(col, row, "")).toBe("");
    });
});
