import { describe, expect, it } from "vitest";
import { highlightMarkup, highlightText } from "./highlight";
import { searchWords } from "./gridUtils";

const MARK = '<span class="avg-search-match">';

/**
 * Marked output is wrapped in one inline box. Not decoration — a data cell is `inline-flex`,
 * and flex drops the whitespace *between* items, so a mark that splits the text rendered
 * "Alan Dijkstra" as "AlanDijkstra".
 */
const wrapped = (inner: string) => `<span class="avg-search-text">${inner}</span>`;

describe("searchWords", () => {
    it("lowercases and splits on any whitespace", () => {
        expect(searchWords("Ann  NY\tOH\nTX")).toEqual([
            "ann",
            "ny",
            "oh",
            "tx",
        ]);
    });

    it("returns the same empty array for every empty search", () => {
        // The no-search case runs on every paint of every grid; it must not allocate.
        expect(searchWords(undefined)).toBe(searchWords("   "));
        expect(searchWords("")).toHaveLength(0);
    });
});

describe("highlightMarkup", () => {
    it("returns null when nothing matches, so the caller keeps the plain-text path", () => {
        expect(highlightMarkup("Anna", ["bob"])).toBeNull();
        expect(highlightMarkup("", ["a"])).toBeNull();
    });

    it("wraps every occurrence of every word, case-insensitively", () => {
        expect(highlightMarkup("Anna in Annapolis", ["an"])).toBe(
            wrapped(`${MARK}An</span>na in ${MARK}An</span>napolis`),
        );
        expect(highlightMarkup("Ann of NY", ["ann", "ny"])).toBe(
            wrapped(`${MARK}Ann</span> of ${MARK}NY</span>`),
        );
    });

    it("keeps the matched text's own case, not the search's", () => {
        expect(highlightMarkup("ANNA", ["anna"])).toBe(
            wrapped(`${MARK}ANNA</span>`),
        );
    });

    it("merges overlapping words into one run rather than nesting spans", () => {
        // Nested spans would paint the shared characters twice and read as a third colour.
        expect(highlightMarkup("banana", ["an", "ana"])).toBe(
            wrapped(`b${MARK}anan</span>a`),
        );
    });

    it("merges two words that abut into one span", () => {
        expect(highlightMarkup("abc", ["a", "b"])).toBe(
            wrapped(`${MARK}ab</span>c`),
        );
    });

    it("swallows a word found inside a longer word's run", () => {
        expect(highlightMarkup("Annapolis", ["ann", "n"])).toBe(
            wrapped(`${MARK}Ann</span>apolis`),
        );
    });

    it("escapes markup in the text, on both sides of a match", () => {
        expect(highlightMarkup("<b>&x</b>", ["x"])).toBe(
            wrapped(`&lt;b&gt;&amp;${MARK}x</span>&lt;/b&gt;`),
        );
    });

    it("escapes markup inside the match itself", () => {
        expect(highlightMarkup("a<b", ["<b"])).toBe(
            wrapped(`a${MARK}&lt;b</span>`),
        );
    });

    it("never returns markup the DOM would serialise differently", () => {
        // `DataCell` compares against the string it last wrote rather than reading `innerHTML`
        // back. That is only safe while the two agree, so this pins the escaping to exactly the
        // characters a browser escapes in a text node — a quote must pass through untouched.
        const out = highlightMarkup(`say "hi" & <go>`, ["hi"])!;
        expect(out).toContain(`"hi"`.replace("hi", `${MARK}hi</span>`));
        expect(out).not.toContain("&quot;");
        expect(out).toContain("&amp;");
    });
});

describe("highlightText — the exported helper", () => {
    it("returns escaped text when there is no search", () => {
        expect(highlightText("a<b", undefined)).toBe("a&lt;b");
        expect(highlightText("plain", "")).toBe("plain");
    });

    it("marks the words of a search string it splits itself", () => {
        expect(highlightText("Ada Lovelace", "ada lace")).toBe(
            wrapped(`${MARK}Ada</span> Love${MARK}lace</span>`),
        );
    });

    it("survives a value that is not a string", () => {
        // A `render` hook hands it whatever the row held; it must not throw on a number,
        // a null or a Date.
        expect(highlightText(42, "4")).toBe(wrapped(`${MARK}4</span>2`));
        expect(highlightText(null, "a")).toBe("");
        expect(highlightText(undefined, "a")).toBe("");
    });
});

describe("the layout wrapper", () => {
    it("wraps a marked run, so the spaces around it survive flex layout", () => {
        // A data cell is `inline-flex`. Without this wrapper the text node and the mark are two
        // flex items, and flex discards the whitespace between them — "Alan Dijkstra" rendered
        // as "AlanDijkstra". Inside one inline box the space is ordinary inline content.
        const out = highlightMarkup("Alan Dijkstra", ["dijkstra"])!;
        expect(out).toBe(wrapped(`Alan ${MARK}Dijkstra</span>`));
    });

    it("does not wrap when nothing matched, so an unmarked cell is untouched", () => {
        // The plain path has to stay a bare text node: it is the hot one, and a wrapper there
        // would be an element per cell per repaint.
        expect(highlightMarkup("Alan", ["zz"])).toBeNull();
        expect(highlightText("Alan Dijkstra", "zz")).toBe("Alan Dijkstra");
    });
});
