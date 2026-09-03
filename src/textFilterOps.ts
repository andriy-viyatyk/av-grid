/**
 * The built-in `"text"` filter's operators — the one table the popover's chips, the `filters`
 * validator, the row test and the filter-bar chip all read.
 *
 * Before task 54 the list was spelled three times (the body, the validator, the bar's label map)
 * and every operator carried text. Now two of them do not — `blank` / `notBlank` describe a
 * *state* of the cell rather than compare it — and everything that used to assume a needle
 * branches on `needsText` here, never on the op name. A third text-free operator is one row.
 */

import type { TextFilterOp } from "./types";

export interface TextFilterOpInfo {
    readonly op: TextFilterOp;
    /** How the popover chip and the filter-bar chip spell it: `starts with`, `is empty`. */
    readonly label: string;
    /** Whether the operator compares against typed text. `false`: the value is `{ op }` alone. */
    readonly needsText: boolean;
}

export const TEXT_FILTER_OP_TABLE: readonly TextFilterOpInfo[] = [
    { op: "contains", label: "contains", needsText: true },
    { op: "equals", label: "equals", needsText: true },
    { op: "startsWith", label: "starts with", needsText: true },
    { op: "blank", label: "is empty", needsText: false },
    { op: "notBlank", label: "is not empty", needsText: false },
];

/** Every operator, in table order — what the validator enumerates in its message. */
export const TEXT_FILTER_OPS: readonly TextFilterOp[] = TEXT_FILTER_OP_TABLE.map((o) => o.op);

/**
 * What a column offers when it does not say: the three comparing operators, exactly what the
 * filter offered before `textFilterOps` existed, so no existing consumer sees a new chip.
 */
export const DEFAULT_TEXT_FILTER_OPS: readonly TextFilterOp[] = ["contains", "equals", "startsWith"];

export function isTextFilterOp(op: unknown): op is TextFilterOp {
    return typeof op === "string" && TEXT_FILTER_OPS.includes(op as TextFilterOp);
}

export function textFilterOpLabel(op: TextFilterOp): string {
    return TEXT_FILTER_OP_TABLE.find((o) => o.op === op)?.label ?? op;
}

export function textFilterOpNeedsText(op: TextFilterOp): boolean {
    return TEXT_FILTER_OP_TABLE.find((o) => o.op === op)?.needsText ?? true;
}
