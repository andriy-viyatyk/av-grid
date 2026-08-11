/**
 * Paint the search words inside a cell's text.
 *
 * A port of `uikit/shared/highlight.ts`, which builds React nodes by splitting the text on one
 * token at a time and recursing into the pieces for the next token. That shape does not survive
 * the move: it allocates an array, a fragment and a node per piece, and this runs for every
 * visible cell of every repaint while a search is active. Here the whole cell becomes one
 * markup string, built in a single left-to-right pass, and `DataCell` assigns it only when it
 * differs from what it last wrote.
 *
 * The class is the same idea as the reference's global `.highlighted-text`, and one class is all
 * that is emitted: which of the three shapes it takes is decided by `data-search-highlight` on
 * the root, so the markup here is identical whichever the host chose.
 *
 * Not under `view/`, though `DataCell` is its main caller: there is no DOM in this file, and the
 * model layer needs it too, for `CellContext.highlight`. That is the one thing the model layer
 * does not do — reach into `view/`.
 */

import { searchWords } from "./gridUtils";

const OPEN = '<span class="avg-search-match">';
const OPEN_TEXT = '<span class="avg-search-text">';
const CLOSE = "</span>";

/**
 * Escape the three characters that would otherwise be read as markup.
 *
 * `&`, `<` and `>` and no others, deliberately: these are exactly the characters a browser
 * escapes when it serialises a text node, so a quote or a non-ASCII character passes through
 * unchanged. Anything more would be harmless in the DOM but would make the string we build
 * differ from the string the DOM would give back — and `DataCell` compares against what it
 * last wrote precisely to avoid reading `innerHTML` back on the hot path.
 */
function escapeText(text: string): string {
    if (text.indexOf("&") < 0 && text.indexOf("<") < 0 && text.indexOf(">") < 0) {
        return text;
    }
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

/**
 * `highlightMarkup`, but always a string — the escaped text when nothing matches.
 *
 * What `CellContext.highlight` is, and the form a host wants: a `render` hook has to return
 * *something* whether or not this cell matched, and it should not have to think about which
 * case it is in. The cheap `null` is for the internal caller alone, which uses it to stay off
 * the markup path entirely.
 */
export function markSearchWords(
    text: string,
    words: readonly string[],
): string {
    return (words.length ? highlightMarkup(text, words) : null) ?? escapeText(text);
}

/**
 * `markSearchWords`, taking the search string itself rather than pre-split words.
 *
 * The exported form, for marking text the grid never sees — a summary line above it, a panel
 * beside it, a `column.filter` body. **Inside a cell, use `CellContext.highlight`**, which is
 * this function already holding the grid's search and honouring `highlightSearch: false`:
 *
 * ```js
 * render: (c) => c.highlight(`${c.row.firstName} ${c.row.lastName}`)
 * ```
 */
export function highlightText(
    text: unknown,
    searchString: string | undefined,
): string {
    return markSearchWords(
        text === null || text === undefined ? "" : String(text),
        searchWords(searchString),
    );
}

function wrap(text: string, start: number, end: number): string {
    return OPEN + escapeText(text.slice(start, end)) + CLOSE;
}

/**
 * The HTML for `text` with every occurrence of every word wrapped, or `null` if nothing matches.
 *
 * `null` rather than the text itself, so the caller can tell the two cases apart and keep the
 * cheap path cheap: a cell with no match stays a single text node written through `setText`,
 * which is what nearly every cell is even while a search is active — the search kept the *row*,
 * usually on the strength of one other column.
 *
 * Words are matched case-insensitively and may overlap: searching `"an ana"` against
 * `"banana"` marks one run from the first `a` to the end rather than nesting one span inside
 * another, because a nested span would paint the same characters twice and read as a different
 * colour.
 */
export function highlightMarkup(
    text: string,
    words: readonly string[],
): string | null {
    if (!text) return null;

    const lower = text.toLowerCase();
    let ranges: number[][] | null = null;

    for (const word of words) {
        if (!word) continue;
        let from = lower.indexOf(word);
        while (from >= 0) {
            (ranges ??= []).push([from, from + word.length]);
            from = lower.indexOf(word, from + word.length);
        }
    }

    if (!ranges) return null;
    if (ranges.length > 1) ranges.sort((a, b) => a[0]! - b[0]!);

    // Coalesce into runs before emitting anything. Two words that overlap — `"an ana"` against
    // `"banana"` — or that simply abut must become one span: nesting would paint the shared
    // characters twice and read as a third colour, and even the flat version, one span per
    // word, would be several elements where the user sees a single marked run.
    let out = "";
    let at = 0;
    let start = -1;
    let end = -1;
    for (const range of ranges) {
        if (range[0]! <= end) {
            if (range[1]! > end) end = range[1]!;
            continue;
        }
        if (start >= 0) {
            out += escapeText(text.slice(at, start)) + wrap(text, start, end);
            at = end;
        }
        start = range[0]!;
        end = range[1]!;
    }
    out += escapeText(text.slice(at, start)) + wrap(text, start, end);
    out += escapeText(text.slice(end));

    // One wrapper around the whole run, and it is not decoration — it is what keeps the spaces.
    // A data cell is `inline-flex`, and flex discards whitespace *between* items: the moment a
    // mark splits the text, `Alan <span>Dijkstra</span>` becomes two items and renders as
    // "AlanDijkstra". Inside a single inline box the same space is ordinary inline content and
    // survives. The reference solves this by promoting such spaces to U+00A0; a wrapper is
    // better, because it leaves the text exactly the text — `textContent`, a selection and a
    // copy all read what the row actually holds.
    return OPEN_TEXT + out + CLOSE;
}
