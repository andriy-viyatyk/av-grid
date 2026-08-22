/**
 * The public type surface.
 *
 * Ported from `AVGrid/avGridTypes.ts`, with React removed and the reference's naming quirks
 * corrected. Three classes of change, all deliberate — see the decision log in
 * `tasks/plan-done-01.md`:
 *
 * 1. **Misspellings fixed.** `haderRenderer`, `cellFormater`, `editFormater`, `resizible`
 *    are gone. An agent types the correct spelling and must not be silently ignored.
 * 2. **The `T` prefix dropped.** `TSortColumn` → `SortColumn`, `TFilter` → `Filter`. The
 *    prefix is a Persephone house style, not something a consumer would guess.
 * 3. **`cellRenderer` and `cellFormater` collapsed into one `render` hook.** In React they
 *    differed because one was a `ComponentType` and the other a function returning a
 *    `ReactNode`. In the DOM both are "a function that produces cell content", so keeping
 *    two would be two ways to do one thing.
 *
 * Dropped entirely: `TAVGridContext` (React context — the model is passed directly) and the
 * `React.MouseEvent` / `React.DragEvent` handler types (replaced with DOM events).
 */

import type { GridSelection, SelectedCount } from "./model/FocusModel";
import type { Percent, RenderCellParams } from "./render/types";

export type { Percent };

export type Point = { x: number; y: number };

export type SortDirection = "asc" | "desc";

export interface SortColumn {
    key: string;
    direction: SortDirection;
}

export type DataType = "string" | "number" | "boolean";

export type DisplayFormat =
    | "text"
    | "date"
    | "dateTime"
    | "phone"
    | `date:${string}`
    | `utcToLocal:${string}`;

export type Alignment = "left" | "center" | "right";

export type RowCompare<R = any> = (left: R, right: R) => number;

// ---------------------------------------------------------------------------
// Cell rendering
// ---------------------------------------------------------------------------

/**
 * What a `render` hook receives. Small and flat on purpose: an agent writing
 * `` render: (cell) => `<b>${cell.value}</b>` `` should not have to learn a type to do it.
 */
export interface CellContext<R = any> {
    /** The cell's value — `row[column.key]`, before any formatting. */
    value: any;
    row: R;
    column: Column<R>;
    /** Index into the currently displayed rows (after sorting and filtering). */
    rowIndex: number;
    colIndex: number;
    rowKey: string;
    /**
     * Escape `text` and mark the active search words in it, as an HTML string.
     *
     * What a `render` column uses to highlight like every other column does. A default cell
     * marks the search itself, but a `render` column's markup belongs to the host — the grid
     * cannot mark inside it without parsing what the hook returned — so the hook asks:
     *
     * ```js
     * render: (c) => c.highlight(`${c.row.firstName} ${c.row.lastName}`)
     * ```
     *
     * Safe to use unconditionally: with no search, or with `highlightSearch: false`, it is
     * simply the escaped text. **It escapes**, so it is also the right way to put any untrusted
     * value into a `render` string, search or no search.
     *
     * Mark only the text. Wrapping markup — `` `<b>${c.highlight(name)}</b>` `` — is fine; the
     * other way round, `c.highlight("<b>" + name)`, escapes the tag and shows it.
     */
    highlight: (text: unknown) => string;
}

/**
 * Produces a cell's content. Return an HTML string (the common case) or a DOM element (when
 * you need to attach listeners). Returning `null` or `undefined` renders an empty cell.
 *
 * The string form inserts markup as-is. Boards are sandboxed, but the caller still owns
 * escaping untrusted values.
 *
 * The element arm is `Element`, not `HTMLElement`, and that distinction is load-bearing: an
 * `<svg>` built through `createElementNS` is an `SVGElement`, a *sibling* of `HTMLElement` rather
 * than a subtype — and an icon is the most common reason to return an element at all. The cell
 * only appends what it is handed, so any `Element` is safe. `Column.editor` stays narrower on
 * purpose: an editor is focused and read for its value.
 */
export type CellRenderer<R = any> = (
    cell: CellContext<R>,
) => string | Element | null | undefined;

/**
 * What a row-level hook receives — `CellContext` minus the column, because a row has no one
 * column. Today that is `rowClass`.
 */
export interface RowContext<R = any> {
    row: R;
    /** Index into the currently displayed rows (after sorting and filtering). */
    rowIndex: number;
    rowKey: string;
}

export interface HeaderContext<R = any> {
    column: Column<R>;
    colIndex: number;
}

/**
 * What a class hook may return. An array is accepted because that is what composing conditions
 * produces, and joining it yourself is a papercut; `undefined`, `null` and `false` entries are
 * dropped, so `[a && "x", b && "y"]` works.
 *
 * ⚠ **A class aimed at a cell has to out-specify `.avg-data-cell`.** The grid's stylesheet is
 * injected during `create()`, so it lands *after* the page's own `<style>`, and `.avg-data-cell`
 * setting `color` is exactly as specific as a bare `.low`. Write `.avg-data-cell.low`.
 */
export type ClassValue =
    | string
    | (string | undefined | null | false)[]
    | undefined
    | null
    | false;

/** A class hook: a constant string, or a function of what is being painted. */
export type ClassHook<C> = string | ((context: C) => ClassValue);

/**
 * Produces a header's label. Same three arms as `CellRenderer`, and the element arm is `Element`
 * for the same reason — a header icon is an `SVGElement`. Returning `null` or `undefined` falls
 * back to `column.name`, which is also what keeps the native `title` tooltip: a custom label owns
 * its own hover text.
 */
export type HeaderRenderer<R = any> = (
    header: HeaderContext<R>,
) => string | Element | null | undefined;

/**
 * Low-level renderer used by the engine itself, which addresses cells by grid coordinates
 * rather than by row object. Internal — column authors use `CellRenderer`.
 */
export interface GridCellParams<R = any> extends RenderCellParams {
    className?: string;
    columns: Column<R>[];
    rows: R[];
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

export interface Column<R = any> {
    /** Property name on the row object. Also the column's identity everywhere in the API. */
    key: keyof R | string;
    /** Header label. Defaults to `key` when omitted. */
    name?: string;
    width?: number | Percent;
    hidden?: boolean;

    /**
     * Extra class names for this column's cells, on top of the built-in state classes.
     *
     * ```js
     * { key: "score", cellClass: (c) => (c.value < 50 ? "low" : undefined) }
     * { key: "note",  cellClass: "wrap" }
     * ```
     *
     * Applied before the grid-wide `onCellClass` and before `rowClass`; all three are additive.
     * Style it as `.avg-data-cell.low` — see `ClassValue` for why the bare class loses.
     */
    cellClass?: ClassHook<CellContext<R>>;

    /** Extra class names for this column's header cell. Same shape as `cellClass`. */
    headerClass?: ClassHook<HeaderContext<R>>;

    /** Custom cell content. See `CellRenderer`. */
    render?: CellRenderer<R>;
    /** Custom header content. */
    headerRender?: HeaderRenderer<R>;
    /**
     * The control this column's cells are edited with — a date picker, a colour swatch, a
     * lookup box. Replaces the built-in text box or dropdown for this column only.
     *
     * See `CellEditorFactory` for the shape and for the one thing it must decide itself.
     * A column with an `editor` opens it whatever its `dataType`, including `"boolean"`, which
     * otherwise toggles rather than opening anything.
     */
    editor?: CellEditorFactory<R>;

    /**
     * The column's plain-text projection: what it shows, what the search box matches, what a
     * filter tests and what a copy writes.
     *
     * Not sorting — that compares `row[key]` directly, so a computed column needs a `rowCompare`
     * as well. See *Which hook feeds what* in [`docs/api.md`](../docs/api.md) for the whole table.
     */
    formatValue?: (column: Column<R>, row: R) => string;

    /**
     * What this column's cells copy, when what they *show* is the wrong thing to put in a
     * spreadsheet — a bar chart, a badge, an icon, a colour swatch.
     *
     * ```js
     * {
     *     key: "status",
     *     render: (c) => `<span class="dot ${c.value}"></span>${c.value}`,
     *     copyValue: (c) => c.value,
     * }
     * ```
     *
     * Used by every copy path — ctrl+C, ctrl+X, Copy as… and `getSelectionText()` — so they
     * cannot disagree, and it wins over `formatValue`, `displayFormat` and the text of `render`.
     * The return value is not stringified before `copyAsJson`, so a number copies as a number.
     *
     * Copy only: paste coerces through `validate`. See *Which hook feeds what* in
     * [`docs/api.md`](../docs/api.md) for the whole precedence table.
     */
    copyValue?: (cell: CellContext<R>) => any;

    dataType?: DataType;
    displayFormat?: DisplayFormat;
    align?: Alignment;

    resizable?: boolean;
    readonly?: boolean;
    /** Marks a non-data column (row selection checkbox, row number) pinned to the left. */
    isStatusColumn?: boolean;

    /**
     * The value this column sorts by, in place of `row[key]`. The short form of a custom sort,
     * and the one to reach for first — an order the value does not have on its own:
     *
     * ```js
     * const RANK = { critical: 0, high: 1, normal: 2, low: 3 };
     * { key: "priority", sortValue: (row) => RANK[row.priority] }
     * ```
     *
     * Whatever it returns is compared the way the grid compares anything: numbers numerically,
     * strings by `localeCompare`, `Date`s by instant, booleans false-first, and nullish values at
     * the ascending end. **Read once per row**, not once per comparison — the rows are decorated
     * with their sort values, sorted, and undecorated, so a 100,000-row sort calls this 100,000
     * times rather than the ~1.7 million a comparator is called.
     *
     * `rowCompare` wins where both are set.
     */
    sortValue?: (row: R) => any;

    /**
     * This column's sort order as a comparator, for an order that is genuinely pairwise: a
     * natural sort, a locale with collation options, a tie-break across two properties. Prefer
     * `sortValue` when the order is a projection — it is shorter *and* called n times instead of
     * n log n.
     *
     * Ascending only: a descending header click reverses the sorted array, so a comparator never
     * sees the direction.
     */
    rowCompare?: RowCompare<R>;
    /**
     * Which filter body the header funnel opens. Defaults to `"options"` — every column is
     * filterable unless you say otherwise; pass `null` to take the funnel off this one, or
     * `disableFiltering: true` to take it off all of them.
     *
     * The reference made this opt-in per column, so a grid whose author had not thought about
     * filtering had none. Here the default is on, because the author is usually an agent and a
     * missing funnel is invisible.
     */
    filterType?: FilterType | null;

    /**
     * A filter type of this column's own, in place of the built-in checklist: a date range, a
     * number range, a slider. See `FilterDefinition`.
     *
     * Wins over `filterType` — except `filterType: null`, which still takes the funnel off the
     * column and so turns this off with it.
     */
    filter?: FilterDefinition<R>;

    /** Coerce/reject an edited value. Return the value to commit. */
    validate?: (column: Column<R>, row: R, value: any) => any;
    /** Choices for the in-cell editor. May be computed, and may be async. */
    options?: any[] | (() => any[] | Promise<any[]>);
}

export type OnColumnResize = (columnKey: string, width: number) => void;
export type OnColumnsReorder = (sourceKey: string, targetKey: string) => void;

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/**
 * Which filter body a column opens. `"options"` is the built-in checklist; any other string is
 * the `name` of a `FilterDefinition` supplied as the column's `filter`.
 *
 * The `(string & {})` arm is what keeps `"options"` in an editor's autocomplete while still
 * accepting a custom name — a plain `string` would offer nothing.
 */
export type FilterType = "options" | (string & {});

/**
 * One applied column filter.
 *
 * Only `columnKey` and `value` are worth writing by hand — everything else is filled in from
 * the column, so the shortest useful filter is:
 *
 * ```js
 * grid.setFilters([{ columnKey: "status", value: ["open", "pending"] }]);
 * ```
 *
 * The reference required `columnName` and `type` on every filter because its host always
 * built them from a column it already had. Here a filter is something an agent writes, so
 * both are optional on the way in and always present on the way out: `getFilters()` returns
 * the normalized form, which is what the filter bar's chips read.
 */
export interface Filter {
    columnKey: string;
    /**
     * What the filter keeps. Its shape is the filter type's — for `"options"`, the values to
     * keep. Empty or absent means no filter at all, which is why applying one and removing it
     * are the same call.
     *
     * Typed loosely on purpose: this is the field every caller writes, and it is narrowed by
     * `OptionsFilter` once the type is known.
     */
    value?: any;
    /** Chip label in the filter bar. Filled in from the column's `name` when omitted. */
    columnName?: string;
    /** Defaults to the column's `filterType`, then to `"options"`. */
    type?: FilterType;
    displayFormat?: DisplayFormat;
}

/** A filter known to carry a value. The reference's `TAnyFilter`. */
export interface AnyFilter extends Filter {
    value: any;
}

export interface DisplayOption<T = any> {
    value: T;
    label: string;
    italic?: boolean;
}

/**
 * Accepted as either the full option objects or bare values — `["open"]` normalizes to
 * `[{ value: "open", label: "open" }]`, because a filter written by hand should not have to
 * repeat itself.
 */
export type OptionsFilterValue = DisplayOption[];

export interface OptionsFilter extends Filter {
    type?: "options";
    value?: OptionsFilterValue | readonly any[];
}

/**
 * Supplies the options a filter popover offers. May return a promise — the list shows a
 * loading row until it resolves, and a response overtaken by a newer one is discarded.
 *
 * ```js
 * onGetOptions: async (columns, filters, columnKey, search) =>
 *     (await fetch(`/values/${columnKey}?q=${search ?? ""}`)).json()
 * ```
 *
 * `filters` is the *other* applied filters, never this column's own, so a host can offer
 * cascading options — only the values still reachable. `search` is what the user has typed into
 * the popover's search box; ignore it and the list narrows the returned options itself.
 *
 * Omit this entirely and the column's distinct values are used, already cascaded.
 */
export type GetFilterOptions<R = any> = (
    columns: Column<R>[],
    filters: Filter[],
    columnKey: string,
    search?: string,
) => DisplayOption[] | Promise<DisplayOption[]>;

// ---------------------------------------------------------------------------
// Custom filters
// ---------------------------------------------------------------------------

/**
 * What a filter body is given: the column, the value currently applied, and the two things only
 * the grid can do — apply and close.
 *
 * `value` is `undefined` the first time the popover opens on a column, and the value the body
 * last returned from `getValue()` every time after, so a reopened filter shows what is applied.
 */
export interface FilterBodyContext<R = any> {
    column: Column<R>;
    /** The applied value, or `undefined` when this column has no filter yet. */
    value: any;
    /** The whole applied filter, normalized. Rarely needed — `value` is the interesting part. */
    filter: Filter;
    /**
     * Apply a value and close, exactly as the grid's Apply button does. For a body that wants
     * Enter, or a swatch that applies on click. A nullish value removes the filter.
     */
    apply: (value: any) => void;
    /** Close without applying. */
    close: () => void;
}

/**
 * The body of a filter popover: the part only the host can write. The grid draws the panel
 * around it and the Apply / Clear buttons under it.
 */
export interface FilterBody {
    element: HTMLElement;
    /** The value to filter by, read when Apply is pressed. Nullish removes the filter. */
    getValue: () => any;
    /** Put the focus somewhere useful when the popover opens. Defaults to the element. */
    focus?: () => void;
    /** Release anything owned beyond `element`, which the grid removes itself. */
    destroy?: () => void;
}

/**
 * A filter type of your own — the second arm of the popover's dispatch, and the whole of what a
 * host has to write to get one. No registration call: the definition is an object on the column,
 * shared between columns with a `const`.
 *
 * ```js
 * const dateRangeFilter = {
 *     name: "dateRange",
 *     create: (ctx) => {
 *         const el = document.createElement("div");
 *         el.innerHTML = `<input type="date" data-from><input type="date" data-to>`;
 *         return {
 *             element: el,
 *             getValue: () => ({
 *                 from: el.querySelector("[data-from]").value,
 *                 to: el.querySelector("[data-to]").value,
 *             }),
 *         };
 *     },
 *     label: (value) => `${value.from || "…"} – ${value.to || "…"}`,
 *     match: (value, row, column) => {
 *         const v = row[column.key];
 *         return (!value.from || v >= value.from) && (!value.to || v <= value.to);
 *     },
 * };
 *
 * columns: [{ key: "created", filter: dateRangeFilter }]
 * ```
 *
 * ⚠ **`match` runs once per row.** Do the parsing in `getValue` and put the result in the value —
 * a value of `{ from, to, fromMs, toMs }` has parsed its dates once and its `match` is two
 * integer comparisons. The alternative is host code doing `new Date()` a hundred thousand times
 * inside the filter pass.
 */
export interface FilterDefinition<R = any> {
    /** Identifies this filter type. Stored as the filter's `type`, so keep it stable. */
    name: string;
    /** Build the popover body. Called each time the popover opens. */
    create: (ctx: FilterBodyContext<R>) => FilterBody;
    /** The chip's text in the filter bar, and its tooltip. */
    label: (value: any, column: Column<R>) => string;
    /** Keep this row? Called once per row, per filter, on every filter pass. */
    match: (value: any, row: R, column: Column<R>) => boolean;
    /**
     * Only if the value is not JSON-shaped. `persistFilters` stores it with `JSON.stringify` and
     * revives ISO date strings on the way back, which covers most values as they stand.
     */
    serialize?: (value: any) => any;
    deserialize?: (stored: any) => any;
}

// ---------------------------------------------------------------------------
// Filter persistence
// ---------------------------------------------------------------------------

/**
 * The slice of `localStorage` the grid uses, so any store can stand in for it.
 *
 * `localStorage` and `sessionStorage` both satisfy this structurally, so the common case is
 * `persistFilters: { name: "orders", storage: sessionStorage }` with nothing to implement.
 */
export interface FilterStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

/**
 * Opt in to remembering the applied filters across reloads.
 *
 * Passing this object *is* the consent: a library should not write to the host's storage
 * because it happened to be there, which is why there is no default-on form of this.
 *
 * ```js
 * AVGrid.create(el, { rows, persistFilters: { name: "orders" } });
 * ```
 */
export interface PersistFiltersOptions {
    /** Key suffix — filters are stored under `Filters-${name}`. Namespace it per grid. */
    name: string;
    /** Where to write. Defaults to `localStorage` when the page has one. */
    storage?: FilterStorage;
}

// ---------------------------------------------------------------------------
// Focus, selection, editing
// ---------------------------------------------------------------------------

/**
 * The focused cell, plus the range selection anchored on it.
 *
 * Both key and index are carried for each selection corner: keys survive sorting and
 * filtering, indices make the hot-path bounds test a pair of integer comparisons rather than
 * a map lookup. Keeping both is what lets range selection stay flat-cost at row 99,000.
 */
export type CellFocus<R = any> = {
    rowKey: string;
    columnKey: keyof R | string;
    isDragging: boolean;
    selection?: {
        rowKeyStart: string;
        rowKeyEnd: string;
        colKeyStart: keyof R | string;
        colKeyEnd: keyof R | string;
        rowStart: number;
        rowEnd: number;
        colStart: number;
        colEnd: number;
    };
};

/**
 * How an edit was opened, which is the only thing that decides where the caret starts.
 *
 * - `"key"` — Enter, F2, or `grid.startEdit()`: the value is **selected**, so the next keystroke
 *   replaces it and an arrow key keeps it. The user asked to edit *this cell*, not a place in it.
 * - `"pointer"` — a click on the focused cell: the caret goes **where the click landed**, falling
 *   back to the end of the text. Nothing is selected. Someone who wanted to replace the value
 *   would have typed over the cell instead of reaching for it with the mouse.
 * - `"typing"` — a printable key over the focused cell: the value **is** that character and the
 *   caret sits after it.
 *
 * The reference had a `dontSelect` boolean covering the first two and used it in `CellSelect` to
 * mean the third, which is one flag doing two unrelated jobs and has one impossible state.
 */
export type EditOrigin = "key" | "pointer" | "typing";

export type CellEdit<R = any> = {
    rowKey: string;
    columnKey: keyof R | string;
    value: any;
    openedBy: EditOrigin;
    /** Client x of the click that opened it, when `openedBy` is `"pointer"`. */
    pointerX?: number;
    changed: boolean;
};

/**
 * What a `Column.editor` factory is given: everything it needs to read the cell, record a new
 * value, and end the edit. The grid's own text box and dropdown are built from this same
 * context, so a custom editor is not a second-class one.
 */
export interface EditorContext<R = any> {
    /** The current edit value — the typed character for a type-to-edit, else the cell's value. */
    value: any;
    row: R;
    column: Column<R>;
    /** Index into the currently displayed rows (after sorting and filtering). */
    rowIndex: number;
    colIndex: number;
    rowKey: string;
    /** How the edit was opened. Decides where the caret lands — see `EditOrigin`. */
    openedBy: EditOrigin;
    /**
     * Where the pointer was, in client coordinates, when `openedBy` is `"pointer"`.
     *
     * The editor uses it to put the caret where the user clicked rather than at one end of the
     * text — which is what clicking into text means everywhere else on the platform.
     */
    pointerX?: number;
    /** Record a new value. Marks the edit changed, so a commit is not a no-op. */
    setValue: (value: any) => void;
    /** Write the recorded value and close. */
    commit: () => void;
    /** Close without writing. */
    cancel: () => void;
    /**
     * Commit, then hand the key back to the grid so it moves the focus — what Tab and the
     * vertical arrows do in the built-in editor.
     *
     * Rarely needed: the grid already binds Escape and Tab on the editor's element for you. Use
     * it to give another key the same "commit and move on" behaviour.
     */
    commitAndPass: (e: KeyboardEvent) => void;
}

/**
 * What an editor factory returns when a single element is not enough.
 *
 * `Column.editor` may return a bare `HTMLElement` — the common case — or this, when the editor
 * owns something beyond that element: a picker panel mounted on `document.body`, a listener on
 * the document, a timer. `destroy` is then the only chance to release it.
 */
export interface CellEditor {
    element: HTMLElement;
    /**
     * Put the caret in the control. Called once, after `element` is in the document — which is
     * why it is a callback rather than something the factory can do itself.
     *
     * Optional for a `Column.editor`; the grid falls back to `element.focus()`.
     */
    focus?: () => void;
    /**
     * Release anything the editor owns beyond `element`, which the grid removes itself. Called on
     * commit, on cancel, on `grid.destroy()`, and if the cell is recycled out from under the
     * edit.
     */
    destroy?: () => void;
}

/**
 * A cell editor factory. Return an element, or a `CellEditor` when the editor owns more than one.
 *
 * ```js
 * {
 *     key: "due",
 *     editor: (ctx) => {
 *         const input = document.createElement("input");
 *         input.type = "date";
 *         input.value = ctx.value ?? "";
 *         input.addEventListener("input", () => ctx.setValue(input.value));
 *         input.addEventListener("blur", () => ctx.commit());
 *         return input;
 *     },
 * }
 * ```
 *
 * Escape and Tab already work — the grid binds them on whatever element you return. What is
 * yours to decide is **when a blur commits**: the built-in text box commits on blur, and an
 * editor whose control lives in a popover must *not*, or it closes the moment its own panel
 * takes the focus.
 */
export type CellEditorFactory<R = any> = (
    ctx: EditorContext<R>,
) => HTMLElement | CellEditor;

/**
 * A `CellEditor` whose `focus` is settled — what the grid holds once an editor is built, having
 * filled in `element.focus()` for a host that left it out. The built-in editors are written to
 * this shape directly; a host never needs the name.
 */
export type MountedCellEditor = CellEditor & { focus: () => void };

/**
 * A committed edit, handed to `onEdit` just before the grid writes it.
 *
 * The reference's callback was `editRow(columnKey, rowKey, value)` — three positional
 * arguments, and a host that wanted the row had to go and find it by key. This carries the row
 * and column themselves, which is what a host almost always needs:
 *
 * ```js
 * onEdit: (edit) => save(edit.row.id, edit.columnKey, edit.value)
 * ```
 *
 * Return `false` from `onEdit` to reject the edit — the grid then writes nothing and the cell
 * keeps its old value.
 */
export interface CellEditEvent<R = any> {
    /** The value about to be written, after `validate` / `defaultValidate` coercion. */
    value: any;
    /** What the cell held before. */
    previousValue: any;
    row: R;
    column: Column<R>;
    columnKey: string;
    rowKey: string;
    /** Index into the currently displayed rows. */
    rowIndex: number;
    colIndex: number;
}

// ---------------------------------------------------------------------------
// Structure — rows and columns added and removed
// ---------------------------------------------------------------------------

/**
 * Rows are about to be added, handed to `onAddRows` before the grid inserts them.
 *
 * Return `false` to cancel, exactly as `onEdit` does. The rows are the objects that will be
 * inserted — mutate them to fill in whatever the grid could not know.
 *
 * ```js
 * onAddRows: (e) => { e.rows.forEach((r) => (r.id = nextId())); }
 * ```
 */
export interface AddRowsEvent<R = any> {
    rows: R[];
    /** Where they go, as an index into the currently displayed rows. */
    index: number;
}

/** Rows are about to be deleted. Return `false` from `onDeleteRows` to cancel. */
export interface DeleteRowsEvent<R = any> {
    rows: R[];
    rowKeys: string[];
}

/** Columns are about to be added. Return `false` from `onAddColumns` to cancel. */
export interface AddColumnsEvent<R = any> {
    columns: Column<R>[];
    /** Where they go, as an index into `grid.getColumns()`. */
    index: number;
}

/** Columns are about to be deleted. Return `false` from `onDeleteColumns` to cancel. */
export interface DeleteColumnsEvent<R = any> {
    columns: Column<R>[];
    columnKeys: string[];
}

/** An edit that could not be coerced to the column's type — see `onInvalidEdit`. */
export interface InvalidEditEvent<R = any> {
    /** What the user actually typed, before coercion. */
    value: any;
    row: R;
    column: Column<R>;
    rowIndex: number;
    colIndex: number;
}

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

/**
 * One row of a menu — the grid's context menu, or any menu opened with `showMenu()`.
 *
 * Ported unchanged from Persephone's `MenuItem`, so a host that already builds these for its
 * own menus can hand the same array to either. The only field that differs is `icon`, which is
 * a DOM node or a string of SVG markup rather than a React element.
 *
 * ```js
 * { label: "Delete row", icon: deleteIcon, hotKey: "(Ctrl+Delete)", onClick: () => grid.deleteSelectedRows() }
 * ```
 */
export interface MenuItem {
    label: string;
    /** Run when the item is picked. An item with `items` opens a submenu instead. */
    onClick?: () => void;
    /** A `Node`, or a string inserted as markup — the library's own icons are SVG source. */
    icon?: Node | string;
    /** Shown but not pickable. */
    disabled?: boolean;
    /** Left out of the menu entirely. A `startGroup` on it passes to the next visible item. */
    invisible?: boolean;
    /** Draw a separator above this item. */
    startGroup?: boolean;
    /** Right-aligned hint, e.g. `"(Ctrl+C)"`. Text only — the menu binds no shortcuts. */
    hotKey?: string;
    /** Marked with a check, and highlighted when the menu opens. */
    selected?: boolean;
    /** Dimmed: a secondary action sharing the menu with the primary ones. */
    minor?: boolean;
    /** Identity for keyboard navigation. Defaults to the index and the label. */
    id?: string;
    /** Submenu, opened by hovering the item or clicking it. */
    items?: MenuItem[];
}

/**
 * What the pointer was over when a context menu was asked for.
 *
 * Passed to `getContextMenuItems` and `onGridContextMenu`. `x` / `y` are viewport coordinates,
 * which is exactly what `showMenu({ anchor: { x, y } })` wants — so a host drawing its own menu
 * can position it without touching the event.
 */
export interface GridContextMenuEvent<R = any> {
    x: number;
    y: number;
    /** `"cell"` for the data area, `"header"` for a column header, `"grid"` for anywhere else. */
    target: "cell" | "header" | "grid";
    /** The column under the pointer, for a cell or a header. */
    column?: Column<R>;
    row?: R;
    rowKey?: string;
    /** Display indices, counting data rows — the header is not row 0 here. */
    rowIndex?: number;
    colIndex?: number;
    /**
     * The cell selection at the moment of the click, or `undefined` when nothing is selected.
     *
     * A getter, and computed at most once: reading it on a grid with all 100,000 rows selected
     * copies 100,000 row references, and most menus only need the counts below.
     */
    readonly selection?: GridSelection<R>;
    /** How many rows and columns the selection covers, and its top-left corner. */
    selectedCount: SelectedCount;
    /** The DOM event, for a host that would rather handle `preventDefault` itself. */
    event: MouseEvent;
}

// ---------------------------------------------------------------------------
// Cell events
// ---------------------------------------------------------------------------

export type CellClickEvent<R = any> = (
    row: R,
    col: Column<R>,
    rowIndex: number,
    colIndex: number,
) => void;

export type CellMouseEvent<R = any> = (
    e: MouseEvent,
    row: R,
    col: Column<R>,
    rowIndex: number,
    colIndex: number,
) => void;

export type CellDragEvent<R = any> = (
    e: DragEvent,
    row: R,
    col: Column<R>,
    rowIndex: number,
    colIndex: number,
) => void;
