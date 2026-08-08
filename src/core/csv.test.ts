import { describe, expect, it } from "vitest";
import { csvToRecords, recordsToCsv } from "./csv";

describe("recordsToCsv", () => {
    it("writes a header row and one row per record", () => {
        const csv = recordsToCsv(
            [
                { id: 1, name: "Ann" },
                { id: 2, name: "Bo" },
            ],
            ["id", "name"],
        );
        expect(csv).toBe("id,name\n1,Ann\n2,Bo\n");
    });

    it("omits the header when asked", () => {
        const csv = recordsToCsv([{ id: 1 }], ["id"], { header: false });
        expect(csv).toBe("1\n");
    });

    it("takes only the requested columns, in the requested order", () => {
        const csv = recordsToCsv([{ a: 1, b: 2, c: 3 }], ["c", "a"], { header: false });
        expect(csv).toBe("3,1\n");
    });

    it("uses the tab delimiter the clipboard path passes", () => {
        const csv = recordsToCsv([{ a: "x", b: "y" }], ["a", "b"], {
            header: false,
            delimiter: "\t",
        });
        expect(csv).toBe("x\ty\n");
    });

    it("quotes only fields that need it", () => {
        const csv = recordsToCsv(
            [{ plain: "no quotes", comma: "a,b", quote: 'say "hi"', nl: "one\ntwo" }],
            ["plain", "comma", "quote", "nl"],
            { header: false },
        );
        expect(csv).toBe('no quotes,"a,b","say ""hi""","one\ntwo"\n');
    });

    it("does not quote a comma-containing field when the delimiter is a tab", () => {
        const csv = recordsToCsv([{ a: "a,b" }], ["a"], {
            header: false,
            delimiter: "\t",
        });
        expect(csv).toBe("a,b\n");
    });

    it("renders booleans unquoted and nullish values as empty", () => {
        const csv = recordsToCsv(
            [{ t: true, f: false, n: null, u: undefined, missing: undefined }],
            ["t", "f", "n", "u", "missing"],
            { header: false },
        );
        expect(csv).toBe("true,false,,,\n");
    });

    it("renders dates as ISO strings", () => {
        const csv = recordsToCsv([{ d: new Date("2026-08-08T12:00:00.000Z") }], ["d"], {
            header: false,
        });
        expect(csv).toBe("2026-08-08T12:00:00.000Z\n");
    });

    it("names an undefined column 'undefined', as the reference did", () => {
        const csv = recordsToCsv([{}], [undefined], { header: true });
        expect(csv).toBe("undefined\n\n");
    });

    it("returns an empty string for no records and no header", () => {
        expect(recordsToCsv([], ["a"], { header: false })).toBe("");
    });
});

describe("csvToRecords", () => {
    it("splits tab-delimited text into a grid by default", () => {
        expect(csvToRecords("a\tb\nc\td")).toEqual([
            ["a", "b"],
            ["c", "d"],
        ]);
    });

    it("honours an explicit delimiter", () => {
        expect(csvToRecords("a,b", false, ",")).toEqual([["a", "b"]]);
    });

    it("returns [] for empty or whitespace-only input", () => {
        expect(csvToRecords("")).toEqual([]);
        expect(csvToRecords("   \n  ")).toEqual([]);
    });

    it("unquotes fields and unescapes doubled quotes", () => {
        expect(csvToRecords('"a,b",“plain”,"say ""hi"""', false, ",")).toEqual([
            ["a,b", "“plain”", 'say "hi"'],
        ]);
    });

    it("keeps delimiters and newlines that appear inside quotes", () => {
        expect(csvToRecords('"one\ttwo"\tx', false, "\t")).toEqual([["one\ttwo", "x"]]);
        expect(csvToRecords('"one\ntwo"\tx', false, "\t")).toEqual([["one\ntwo", "x"]]);
    });

    it("handles CRLF line endings", () => {
        expect(csvToRecords("a\tb\r\nc\td")).toEqual([
            ["a", "b"],
            ["c", "d"],
        ]);
    });

    it("skips empty lines", () => {
        expect(csvToRecords("a\n\nb")).toEqual([["a"], ["b"]]);
    });

    it("treats whitespace-only input as empty, even when it is all delimiters", () => {
        // The reference's `!csv?.trim()` guard short-circuits before parsing, so "\t\t"
        // yields no rows rather than one row of three empty fields.
        expect(csvToRecords("\t\t")).toEqual([]);
    });

    it("keeps empty fields in a row that has content", () => {
        expect(csvToRecords("a\t\tc")).toEqual([["a", "", "c"]]);
        expect(csvToRecords("a\t\tc\n\t\t")).toEqual([
            ["a", "", "c"],
            ["", "", ""],
        ]);
    });

    it("relaxes column count — rows may differ in length", () => {
        expect(csvToRecords("a\tb\tc\nd")).toEqual([["a", "b", "c"], ["d"]]);
    });

    it("relaxes quotes — a quote mid-field is literal", () => {
        expect(csvToRecords('12" pipe\tx')).toEqual([['12" pipe', "x"]]);
    });

    it("maps rows onto the header when withColumns is true", () => {
        expect(csvToRecords("id\tname\n1\tAnn", true)).toEqual([
            { id: "1", name: "Ann" },
        ]);
    });

    it("fills missing trailing fields with empty strings when mapping to records", () => {
        expect(csvToRecords("id\tname\n1", true)).toEqual([{ id: "1", name: "" }]);
    });

    it("returns [] when withColumns is true and there is only a header", () => {
        expect(csvToRecords("id\tname", true)).toEqual([]);
    });
});

describe("round trip", () => {
    it("survives Excel's awkward cases through TSV", () => {
        const rows = [
            { a: "plain", b: 'has "quotes"' },
            { a: "has\ttab", b: "has\nnewline" },
            { a: "", b: "trailing space " },
        ];

        const tsv = recordsToCsv(rows, ["a", "b"], {
            header: false,
            delimiter: "\t",
        });
        const parsed = csvToRecords(tsv, false, "\t");

        expect(parsed).toEqual([
            ["plain", 'has "quotes"'],
            ["has\ttab", "has\nnewline"],
            ["", "trailing space "],
        ]);
    });
});
