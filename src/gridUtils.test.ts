import { describe, expect, it } from "vitest";
import { defaultValidate, gatherByGroup, sortAsList, sortEquals } from "./gridUtils";

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
