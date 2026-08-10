/**
 * In-cell editing.
 *
 * Ported from `AVGrid/model/EditingModel.ts`. The behaviour is the reference's — where an edit
 * starts, what commits it, what a boolean column does instead of opening a text box — and three
 * things around it are not:
 *
 * | Reference | Here |
 * |---|---|
 * | `useModel()` — a `useEffect` closing the editor when `props.focus` moved | `onFocusMoved`, called from the one place focus changes |
 * | `beep()` from `core/utils/audio` on a rejected edit | the injectable `onInvalidEdit` callback, default no-op |
 * | `props.editRow(columnKey, rowKey, value)` — the host owns the write | the grid writes `row[column.key]`, then `onEdit` reports it |
 *
 * That last row is the one an agent notices. `editable: true` on its own produces a grid whose
 * cells actually change when you type in them; a host that wants to own the write returns
 * `false` from `onEdit`. The reference could not do this because its rows lived in React state
 * above the grid.
 *
 * ### The editor element and the cell pool
 *
 * The open editor is **one element, owned by this model** — not by the cell it sits in. Cells
 * are pooled: the element showing row 40 column 2 this frame may show row 60 column 5 on the
 * next, so an editor built into a cell would be recycled out from under the caret. So the model
 * builds the editor, `DataCell` parents it into whichever element currently occupies that
 * coordinate, and because the render path prefers `p.previous` over a pooled element, a repaint
 * of the editing cell re-parents nothing and the caret, selection and IME state all survive.
 *
 * Listeners *are* bound directly to the editor's input, which does not violate the
 * root-delegation invariant: that invariant is about pooled elements, and this element is
 * created per edit and discarded with it.
 */

import { defaultValidate, gridBoolean } from "../gridUtils";
import type { CellEdit, Column } from "../types";
import type { AVGridModel } from "./AVGridModel";

/** What an editor factory returns. `DataCell` mounts `element`; the model calls `focus`. */
export interface CellEditor {
    element: HTMLElement;
    /** Put the caret in the control. Called once, after the element is in the document. */
    focus: () => void;
    /**
     * Release anything the editor owns beyond `element`, which the model removes itself.
     *
     * Needed once an editor stopped being a single element: the dropdown mounts a popover on
     * `document.body`, outside the grid's DOM entirely, and removing the cell's element would
     * leave it — and its document listeners — behind.
     */
    destroy?: () => void;
}

/** What an editor factory is given. Everything it needs to read, write and end the edit. */
export interface EditorContext<R = any> {
    /** The current edit value — the typed character for a type-to-edit, else the cell's value. */
    value: any;
    row: R;
    column: Column<R>;
    /** True when the edit began by typing, so the caret goes to the end instead of selecting. */
    dontSelect: boolean;
    /** Record a new value. Marks the edit changed, so a commit is not a no-op. */
    setValue: (value: any) => void;
    commit: () => void;
    cancel: () => void;
    /** Commit, then hand the key back to the grid — which is what Tab does. */
    commitAndPass: (e: KeyboardEvent) => void;
}

/** Left untyped on purpose: `CellEdit<any>` widens `columnKey` to `keyof any`, which no
 *  `CellEdit<R>` accepts. The empty strings are what "no edit" means everywhere here. */
const NO_EDIT = {
    rowKey: "",
    columnKey: "",
    value: undefined,
    changed: false,
};

/** Keys that open an editor on the focused cell rather than doing something else. */
const OPEN_KEYS = new Set(["Enter", "NumpadEnter", "F2"]);

export class EditingModel<R> {
    readonly model: AVGridModel<R>;

    /**
     * The factory used when a column supplies no `editRender`. Assigned from outside so the
     * model layer does not import the view layer — the same shape the render hooks use.
     */
    createEditor?: (ctx: EditorContext<R>) => CellEditor;

    private editor?: CellEditor;
    /** The coordinates the open editor belongs to, so a repaint can recognise its own cell. */
    private editRow = -1;
    private editCol = -1;
    /** Set while `closeEdit` runs, so the blur it causes does not re-enter it. */
    private closing = false;

    constructor(model: AVGridModel<R>) {
        this.model = model;
        this.model.events.content.onKeyDown.subscribe(this.onContentKeyDown);
        this.model.events.cell.onDoubleClick.subscribe(this.onCellDoubleClick);
        this.model.events.cell.onMouseDown.subscribe(this.onCellMouseDown);
    }

    // -----------------------------------------------------------------------
    // Reading
    // -----------------------------------------------------------------------

    /**
     * The coordinates are the flag: they are set together in `openEdit` and cleared together in
     * `closeEdit`, so this is one integer comparison. It is read once per cell per paint, which
     * is why it does not go and look at the state object.
     */
    get isEditing(): boolean {
        return this.editRow >= 0;
    }

    /** The open edit, or `undefined`. The value is what the editor holds, not what the row does. */
    get edit(): CellEdit<R> | undefined {
        return this.isEditing ? this.model.state.get().cellEdit : undefined;
    }

    /**
     * Is *this* cell the one being edited? Called once per cell per paint while an edit is
     * open, so it compares two integers rather than resolving keys.
     */
    isEditingCell = (dataRow: number, colIndex: number): boolean =>
        dataRow === this.editRow && colIndex === this.editCol && this.editRow >= 0;

    /** Can this column be edited at all? Status columns are chrome, not data. */
    canEdit(column: Column<R> | undefined): boolean {
        return Boolean(
            this.model.options.editable &&
                column &&
                !column.readonly &&
                !column.isStatusColumn,
        );
    }

    // -----------------------------------------------------------------------
    // Opening and closing
    // -----------------------------------------------------------------------

    /**
     * Open an editor on a cell.
     *
     * `initial` is the character that started a type-to-edit; passing it replaces the cell's
     * value and puts the caret after it, which is what typing over a selected cell does in
     * every spreadsheet.
     */
    openEdit = (dataRow: number, colIndex: number, initial?: string): void => {
        const column = this.model.data.columns[colIndex];
        const row = this.model.data.rows[dataRow];
        if (row === undefined || !this.canEdit(column)) return;
        // A boolean has two states and a checkbox already shows which — Space and Enter flip
        // it, and there is nothing a text box could add.
        if (column.dataType === "boolean") return;

        if (this.isEditing) this.closeEdit(true, false);

        const value =
            initial !== undefined ? initial : (row as any)[column.key];

        this.model.state.update((s) => {
            s.cellEdit = {
                rowKey: this.model.options.getRowKey(row),
                columnKey: column.key,
                value,
                dontSelect: initial !== undefined,
                changed: initial !== undefined,
            };
        });
        this.editRow = dataRow;
        this.editCol = colIndex;
        this.editor = undefined;

        // Editing a sorted or filtered column would otherwise move the row out from under the
        // caret on the first keystroke.
        this.model.models.rows.freezeRows();

        this.markCell(dataRow, colIndex);
    };

    /**
     * Close the editor, writing the value first when `commit` is true.
     *
     * `focusGrid` is false when the close was caused by focus going somewhere else already —
     * stealing it back would fight the click that caused it.
     */
    closeEdit = (commit: boolean, focusGrid = true): void => {
        if (!this.isEditing || this.closing) return;
        this.closing = true;

        const edit = this.model.state.get().cellEdit as CellEdit<R>;
        const dataRow = this.editRow;
        const colIndex = this.editCol;

        this.detachEditor();
        this.model.state.update((s) => {
            s.cellEdit = { ...NO_EDIT };
        });
        this.editRow = -1;
        this.editCol = -1;

        // Silent, because the `markRow` below covers it — the editor is leaving this cell and
        // the value is arriving in it, and that is one repaint, not two.
        if (commit && edit.changed) {
            this.editCellAt(dataRow, colIndex, edit.value, true);
        }

        // The row rather than the cell even when nothing was committed: one repaint either way,
        // and getting it wrong on the commit path is what left computed columns stale.
        this.markRow(dataRow);
        this.closing = false;

        if (focusGrid) this.model.focusGrid();
    };

    /** Commit and close. The public `grid.commitEdit()`. */
    commitEdit = (): void => this.closeEdit(true);
    /** Discard and close. The public `grid.cancelEdit()`. */
    cancelEdit = (): void => this.closeEdit(false);

    /**
     * The cell focus moved. An open editor belongs to the cell it was opened on, so it commits.
     *
     * This is the reference's `useModel()` effect, called explicitly from `FocusModel` instead
     * of running on every React render.
     */
    onFocusMoved = (): void => {
        if (!this.isEditing) return;
        const focus = this.model.models.focus.focus;
        const edit = this.model.state.get().cellEdit;
        if (!edit) return;
        if (
            focus &&
            focus.columnKey === edit.columnKey &&
            focus.rowKey === edit.rowKey
        ) {
            return;
        }
        this.closeEdit(true, false);
    };

    // -----------------------------------------------------------------------
    // Writing values
    // -----------------------------------------------------------------------

    /**
     * Validate, report and write one cell.
     *
     * Returns whether anything was written. `silent` suppresses the repaint so a bulk caller —
     * a range delete, a boolean toggle over a selection — can mark once at the end instead of
     * building a dirty set the size of the selection.
     */
    editCellAt = (
        dataRow: number,
        colIndex: number,
        rawValue: any,
        silent = false,
    ): boolean => {
        const column = this.model.data.columns[colIndex];
        const row = this.model.data.rows[dataRow];
        if (row === undefined || !this.canEdit(column)) return false;

        const previousValue = (row as any)[column.key];

        const value = column.validate
            ? column.validate(column, row, rawValue)
            : this.coerce(column, row, rawValue, previousValue);

        // `defaultValidate` returns undefined for a value that is not one of the column's
        // options — the one case the reference beeped at. Clearing a cell passes undefined in
        // deliberately, and is not a rejection.
        if (value === undefined && rawValue !== undefined && rawValue !== "") {
            this.model.options.onInvalidEdit?.({
                value: rawValue,
                row,
                column,
                rowIndex: dataRow,
                colIndex,
            });
            return false;
        }

        if (previousValue === value) return false;

        const accepted = this.model.options.onEdit?.({
            value,
            previousValue,
            row,
            column,
            columnKey: String(column.key),
            rowKey: this.model.options.getRowKey(row),
            rowIndex: dataRow,
            colIndex,
        });
        // Only an explicit `false` rejects: a callback that returns nothing is the common case.
        if (accepted === false) return false;

        this.model.models.rows.freezeRows();
        (row as any)[column.key] = value;

        // A blank row that has been typed into is no longer *the* blank row, so navigating off
        // the end of the grid may offer another. See `StructureModel.addTrailingRow`.
        if (this.model.data.newRowKey === this.model.options.getRowKey(row)) {
            this.model.data.newRowKey = undefined;
            this.model.data.change();
        }

        if (!silent) this.markRow(dataRow);
        return true;
    };

    /**
     * `defaultValidate`, plus one thing the reference did not do: a column with no declared
     * `dataType` whose cell *held* a number keeps holding one.
     *
     * An editor always hands back a string. Without this, one edit turns a numeric column into
     * a column of strings — after which it sorts lexicographically ("10" before "9"), aligns
     * left, and formats differently, all from a change the user cannot see. The reference lived
     * with that because Persephone's grids declare their types; a grid whose columns are
     * inferred cannot afford to.
     *
     * Only when the string really is a number: "n/a" typed into a number cell stays "n/a",
     * which is what a host that wanted a free-text column would expect.
     */
    private coerce(column: Column<R>, row: R, raw: any, previous: any): any {
        if (
            column.dataType === undefined &&
            typeof previous === "number" &&
            typeof raw === "string" &&
            raw.trim() !== "" &&
            Number.isFinite(Number(raw))
        ) {
            return Number(raw);
        }
        return defaultValidate(column, row, raw);
    }

    /**
     * Clear every editable cell in the selection — the Delete key.
     *
     * One `{ all: true }` at the end rather than a dirty set per cell: `all` repaints what is on
     * screen, which for a selection of any size is the cheaper of the two.
     */
    deleteRange = (): void => {
        const selection = this.model.models.focus.getGridSelection();
        if (!selection) return;

        let changed = false;
        const [rowStart, rowEnd] = selection.rowRange;
        const [colStart, colEnd] = selection.colRange;
        for (let col = colStart; col <= colEnd; col++) {
            if (!this.canEdit(this.model.data.columns[col])) continue;
            for (let row = rowStart; row <= rowEnd; row++) {
                if (this.editCellAt(row, col, undefined, true)) changed = true;
            }
        }
        if (changed) this.model.update({ all: true });
    };

    /**
     * Flip one boolean cell — the checkbox a hovered, editable boolean cell shows.
     *
     * Deliberately *not* `toggleBooleans`: the pointer is on one cell and means that one, even
     * when a range happens to be selected around it. The keyboard is where "flip all of these"
     * lives, because that is where a selection is the thing being acted on.
     */
    toggleBooleanCell = (dataRow: number, colIndex: number): void => {
        const column = this.model.data.columns[colIndex];
        const row = this.model.data.rows[dataRow];
        if (row === undefined || !this.canEdit(column)) return;
        if (column.dataType !== "boolean") return;

        this.editCellAt(dataRow, colIndex, !gridBoolean((row as any)[column.key]));
        // The click landed on a span inside the cell, and the grid's keys arrive on the root.
        this.model.focusGrid();
    };

    /**
     * Flip the booleans in the selection.
     *
     * Enter sets them all to the opposite of the *focused* cell, so a mixed selection becomes
     * uniform; Space flips each cell on its own. Both are the reference's, and the difference
     * is worth keeping: one is "make them all like this one", the other is "invert".
     */
    toggleBooleans = (fromFocusValue: boolean): void => {
        const selection = this.model.models.focus.getGridSelection();
        if (!selection) return;
        if (!selection.columns.every((c) => c.dataType === "boolean")) return;

        const [rowStart, rowEnd] = selection.rowRange;
        const [colStart, colEnd] = selection.colRange;
        const focusColumn = this.model.data.columns[selection.focusCol];
        const focusRow = this.model.data.rows[selection.focusRow];
        if (!focusColumn || focusRow === undefined) return;

        const target = !gridBoolean((focusRow as any)[focusColumn.key]);

        let changed = false;
        for (let col = colStart; col <= colEnd; col++) {
            const column = this.model.data.columns[col];
            if (!this.canEdit(column)) continue;
            for (let row = rowStart; row <= rowEnd; row++) {
                const rowObject = this.model.data.rows[row];
                if (rowObject === undefined) continue;
                const next = fromFocusValue
                    ? target
                    : !gridBoolean((rowObject as any)[column.key]);
                if (this.editCellAt(row, col, next, true)) changed = true;
            }
        }
        if (changed) this.model.update({ all: true });
    };

    // -----------------------------------------------------------------------
    // The editor element
    // -----------------------------------------------------------------------

    /**
     * The editor element for the open edit, built on first ask.
     *
     * Built lazily rather than in `openEdit` because it is the *paint* that knows the editor is
     * about to be in the document, and an input that is focused before it is attached is not
     * focused at all.
     */
    editorElement(): HTMLElement | undefined {
        if (!this.isEditing) return undefined;
        if (this.editor) return this.editor.element;

        const column = this.model.data.columns[this.editCol];
        const row = this.model.data.rows[this.editRow];
        const edit = this.model.state.get().cellEdit;
        if (!column || row === undefined || !edit) return undefined;

        const context: EditorContext<R> = {
            value: edit.value,
            row,
            column,
            dontSelect: Boolean(edit.dontSelect),
            setValue: this.setEditValue,
            commit: this.commitEdit,
            cancel: this.cancelEdit,
            commitAndPass: this.commitAndPass,
        };

        // A column's own `editRender` wins, exactly as `render` does for the display value. It
        // is handed the same context, so a custom editor commits through the same path.
        const custom = column.editRender?.({
            value: edit.value,
            row,
            column,
            rowIndex: this.editRow,
            colIndex: this.editCol,
            rowKey: edit.rowKey,
        });
        if (custom instanceof HTMLElement) {
            this.editor = { element: custom, focus: () => custom.focus() };
        } else if (this.createEditor) {
            this.editor = this.createEditor(context);
        } else {
            return undefined;
        }

        return this.editor.element;
    }

    /**
     * The editor is now in the document. Focus it.
     *
     * A microtask rather than a direct call: a cell that just scrolled in is rendered before it
     * is appended to its region, so focusing here would be focusing a detached element.
     */
    editorMounted(): void {
        const editor = this.editor;
        if (!editor) return;
        queueMicrotask(() => {
            if (this.editor === editor && editor.element.isConnected) {
                editor.focus();
            }
        });
    }

    /** Does this cell element currently hold the open editor? One reference comparison. */
    ownsCell(el: HTMLElement): boolean {
        return this.editor !== undefined && this.editor.element.parentElement === el;
    }

    /**
     * A cell that held the editor is being repainted as something else — it was recycled to a
     * different coordinate while the edit was open, which is what happens when the editing row
     * is scrolled far out of view. Commit rather than leave an edit open on a cell nobody can
     * see. Deferred, because this runs inside a paint.
     */
    releaseCell(): void {
        queueMicrotask(() => this.closeEdit(true, false));
    }

    private setEditValue = (value: any): void => {
        this.model.state.update((s) => {
            if (!s.cellEdit) return;
            // A new object, not a mutation: `update` shares nested objects with the previous
            // state, and an edit value that changed retroactively would be a trap later.
            s.cellEdit = { ...s.cellEdit, value, changed: true };
        });
    };

    private commitAndPass = (e: KeyboardEvent): void => {
        this.closeEdit(true);
        // Straight onto the bus: the event's target is the editor's input, and
        // `GridInteractions` deliberately ignores keys from inputs.
        this.model.events.content.onKeyDown.send(e);
    };

    private detachEditor(): void {
        const editor = this.editor;
        // Cleared first: `destroy()` can close a popover whose dismissal handler calls back in
        // here, and the guard that stops the re-entry is this model no longer having an editor.
        this.editor = undefined;
        editor?.destroy?.();
        editor?.element.remove();
    }

    /** One cell — never a row, never the viewport. For an editor opening, which changes one. */
    private markCell(dataRow: number, colIndex: number): void {
        if (dataRow < 0 || colIndex < 0) return;
        this.model.update({
            cells: [{ row: this.model.dataRowToGridRow(dataRow), col: colIndex }],
        });
    }

    /**
     * One row — what a *written* value marks, rather than the one cell that was written.
     *
     * A computed column reads the whole row, so editing "lastName" changes what a "fullName"
     * cell should say. Marking only the edited cell left the computed one showing the old value
     * until something else happened to repaint it — hovering the row, most visibly, which is a
     * bug that looks like the grid needing to be poked. There is no way to know which other
     * cells a host's `render` or `formatValue` depends on, and a row is the widest thing an edit
     * to one of its values can affect, so a row is what gets marked.
     *
     * The cost is a row instead of a cell: ~10 cells against 1, still nothing beside the
     * viewport, and it stays flat as the grid grows because a row is a row at 100,000 as at 20.
     */
    private markRow(dataRow: number): void {
        if (dataRow < 0) return;
        this.model.update({ rows: [this.model.dataRowToGridRow(dataRow)] });
    }

    // -----------------------------------------------------------------------
    // Input
    // -----------------------------------------------------------------------

    /**
     * A press on the cell that already had the focus opens the editor — the reference's
     * behaviour, and the one a spreadsheet trains people to expect: the first click focuses a
     * cell, the second one edits it. A double-click therefore still works on a cold cell,
     * because its second press lands on a cell the first press focused.
     *
     * On mousedown rather than click so the caret is in the input before the button comes back
     * up, and so this decision is made before `GridInteractions` arms a range drag.
     */
    private onCellMouseDown = (data: {
        e: MouseEvent;
        rowIndex: number;
        colIndex: number;
        col: Column<R>;
        wasFocused: boolean;
    }): void => {
        if (!data.wasFocused || data.e.button !== 0) return;
        // Any modifier means the press is doing something else: shift extends the range, ctrl
        // and meta are the host's or the platform's.
        if (data.e.shiftKey || data.e.ctrlKey || data.e.altKey || data.e.metaKey) return;
        if (!this.canEdit(data.col) || data.col.dataType === "boolean") return;
        // Already open on this cell — a press inside the editor, or the second half of a
        // double-click. Re-opening would commit and rebuild it, losing the caret.
        if (this.isEditingCell(data.rowIndex, data.colIndex)) return;
        this.openEdit(data.rowIndex, data.colIndex);
    };

    private onCellDoubleClick = (data: {
        rowIndex: number;
        colIndex: number;
        col: Column<R>;
    }): void => {
        if (!this.canEdit(data.col)) return;
        if (data.col.dataType === "boolean") {
            this.toggleBooleans(false);
            return;
        }
        // The press that began this double-click already opened it, on the cell its predecessor
        // focused. Only a boolean, above, still has work to do here.
        if (this.isEditingCell(data.rowIndex, data.colIndex)) return;
        this.openEdit(data.rowIndex, data.colIndex);
    };

    /**
     * Keys arriving on the grid root — so never from inside the editor, which handles its own.
     *
     * The reference's list, minus the Insert / ctrl+Delete branches: those add and delete rows,
     * which is task 14, and putting them here now would mean two places to change.
     */
    private onContentKeyDown = (e: KeyboardEvent): void => {
        if (!this.model.options.editable) return;

        const focus = this.model.models.focus.getGridFocus();
        if (!focus) return;
        const { column, rowIndex, colIndex } = focus;

        if (OPEN_KEYS.has(e.code)) {
            e.preventDefault();
            if (column.dataType === "boolean") {
                // Enter makes the selection match the focused cell's opposite; F2 has nothing
                // to open on a boolean, so it does the same thing.
                this.toggleBooleans(true);
            } else if (this.model.models.focus.singleCellSelected) {
                this.openEdit(rowIndex, colIndex);
            }
            return;
        }

        if (e.code === "Space" && column.dataType === "boolean") {
            e.preventDefault();
            this.toggleBooleans(false);
            return;
        }

        // ctrl+Delete deletes rows and ctrl+shift+Delete deletes columns — `StructureModel`
        // owns both. Clearing the cells as well would be a second, invisible edit of rows that
        // are on their way out.
        if (e.code === "Delete" && !e.ctrlKey) {
            e.preventDefault();
            this.deleteRange();
            return;
        }

        if (e.code === "Escape") {
            this.closeEdit(false);
            return;
        }

        // Type-to-edit. `e.key.length === 1` is the reference's test for a printable key and
        // holds for every layout, where a `code` allowlist would not.
        if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
            if (
                column.dataType !== "boolean" &&
                this.model.models.focus.singleCellSelected
            ) {
                e.preventDefault();
                this.openEdit(rowIndex, colIndex, e.key);
            }
        }
    };
}
