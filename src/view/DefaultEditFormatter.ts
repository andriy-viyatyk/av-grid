/**
 * Which editor a cell gets.
 *
 * A rewrite of `DefaultEditFormater.tsx` — the spelling is fixed, per the decision log — and
 * the dispatch is the same one it made: a column with `options` gets a dropdown, everything
 * else gets a text box. Booleans never reach here; they toggle instead of opening an editor.
 *
 * This function is what `AVGrid` assigns to `EditingModel.createEditor`, which is how the model
 * layer opens an editor without importing the view layer.
 */

import type { CellEditor, EditorContext } from "../model/EditingModel";
import { createCellInput } from "./CellInput";
import { createCellSelect } from "./CellSelect";

export function createDefaultEditor<R>(ctx: EditorContext<R>): CellEditor {
    return ctx.column.options ? createCellSelect(ctx) : createCellInput(ctx);
}
