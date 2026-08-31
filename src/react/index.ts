/**
 * `av-grid/react` — the official React wrapper.
 *
 * ```tsx
 * import { AVGrid } from "av-grid/react";
 * import "av-grid/av-grid.css";
 *
 * <AVGrid rows={rows} columns={columns} style={{ height: 400 }} />
 * ```
 *
 * Two components, two adapters for hosting React components inside the grid's own hooks
 * (`reactEditor`, `reactFilterBody`), and their prop types — nothing else: the grid's own API is
 * the core's, and this entry deliberately does not re-export it — import the option and column
 * types from `av-grid`. A second copy of those exports would be a second place for them to
 * drift.
 *
 * **`AVGrid` here is the component; `AVGrid` in `av-grid` is the class.** The short name is the
 * one a React file wants, so this entry claims it, and `AVGridReact` remains as the unambiguous
 * spelling for a file that imports from both. The instance type a `ref` yields is exported as
 * `AVGridInstance` — a type alias over the class, so `useRef<AVGridInstance<Row>>(null)` needs
 * no second import.
 *
 * `react` and `react-dom` are **optional peer dependencies**. A vanilla consumer installs the
 * package and never resolves this file.
 */

export { AVGridReact, AVGridReact as AVGrid } from "./AVGridReact";
export type {
    AVGridReactProps,
    AVGridReactProps as AVGridProps,
    AVGridInstance,
} from "./AVGridReact";
export { AVGridFilterBar } from "./AVGridFilterBar";
export type { AVGridFilterBarProps } from "./AVGridFilterBar";
export { reactEditor, reactFilterBody } from "./adapters";
