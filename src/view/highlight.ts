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
 * The class is the same idea as the reference's global `.highlighted-text`: colour only, no
 * background and no weight change. Weight would reflow the glyphs under the match, so the text
 * would shift as the user types.
 */

const OPEN = '<span class="avg-search-match">';
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

    return out + escapeText(text.slice(end));
}
