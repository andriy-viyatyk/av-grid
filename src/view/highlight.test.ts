import { describe, expect, it } from "vitest";
import { highlightMarkup } from "./highlight";
import { searchWords } from "../gridUtils";

const MARK = '<span class="avg-search-match">';

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
            `${MARK}An</span>na in ${MARK}An</span>napolis`,
        );
        expect(highlightMarkup("Ann of NY", ["ann", "ny"])).toBe(
            `${MARK}Ann</span> of ${MARK}NY</span>`,
        );
    });

    it("keeps the matched text's own case, not the search's", () => {
        expect(highlightMarkup("ANNA", ["anna"])).toBe(`${MARK}ANNA</span>`);
    });

    it("merges overlapping words into one run rather than nesting spans", () => {
        // Nested spans would paint the shared characters twice and read as a third colour.
        expect(highlightMarkup("banana", ["an", "ana"])).toBe(
            `b${MARK}anan</span>a`,
        );
    });

    it("merges two words that abut into one span", () => {
        expect(highlightMarkup("abc", ["a", "b"])).toBe(`${MARK}ab</span>c`);
    });

    it("swallows a word found inside a longer word's run", () => {
        expect(highlightMarkup("Annapolis", ["ann", "n"])).toBe(
            `${MARK}Ann</span>apolis`,
        );
    });

    it("escapes markup in the text, on both sides of a match", () => {
        expect(highlightMarkup("<b>&x</b>", ["x"])).toBe(
            `&lt;b&gt;&amp;${MARK}x</span>&lt;/b&gt;`,
        );
    });

    it("escapes markup inside the match itself", () => {
        expect(highlightMarkup("a<b", ["<b"])).toBe(`a${MARK}&lt;b</span>`);
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
