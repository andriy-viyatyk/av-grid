/**
 * `<AVGridFilterBar>` — the detached filter bar, as a React component.
 *
 * The bar can live anywhere: a toolbar, a side panel, a header above unrelated content. The
 * grid's own `filterBar` option puts one directly above the grid and needs none of this.
 *
 * Like `AVGridReact.tsx`, this file is meant to be read as well as used — it is the smallest
 * complete example of mounting one of the library's DOM objects from React.
 */

import {
    useLayoutEffect,
    useRef,
    type CSSProperties,
    type ReactElement,
} from "react";
import { AVGrid } from "av-grid";
import type { FilterBar } from "av-grid";
import type { AVGridInstance } from "./AVGridReact";

export interface AVGridFilterBarProps<R = any> {
    /**
     * The grid this bar filters — or `null` while it does not exist yet.
     *
     * A sibling `<AVGrid>` has not mounted on the first render, so `null` is the normal first
     * value, not an error case. The bar mounts as soon as the instance arrives.
     */
    grid: AVGridInstance<R> | null | undefined;
    /** Extra class on the bar element itself (the core's `className` option for the bar). */
    barClassName?: string;
    /** Debug label, emitted as `data-name` on the bar. */
    name?: string;
    /** `false` drops the remove-all ✕ — for a toolbar with its own clear control. */
    clearButton?: boolean;
    /** Class on the host element this component renders. */
    className?: string;
    /** Style on the host element. */
    style?: CSSProperties;
}

/**
 * A filter bar mounted away from its grid.
 *
 * ```tsx
 * const [grid, setGrid] = useState<AVGridInstance<Row> | null>(null);
 *
 * <AVGridFilterBar grid={grid} />
 * <AVGrid ref={setGrid} rows={rows} columns={columns} style={{ height: 400 }} />
 * ```
 *
 * The ref callback puts the instance in state, the re-render hands it to the bar, and the bar
 * mounts. That one line is the whole pattern — there is no ordering to arrange.
 */
export function AVGridFilterBar<R = any>({
    grid,
    barClassName,
    name,
    clearButton,
    className,
    style,
}: AVGridFilterBarProps<R>): ReactElement {
    const hostRef = useRef<HTMLDivElement>(null);

    // Keyed on the instance: a new grid replaces the bar, and there is nothing to do until one
    // exists. `barClassName` and `name` are read once at creation — by the core, not by us — so
    // changing either remakes the bar. Neither is a value that changes in practice.
    useLayoutEffect(() => {
        const host = hostRef.current;
        if (!host || !grid) return;

        const bar: FilterBar<R> = AVGrid.createFilterBar<R>(host, {
            grid,
            className: barClassName,
            name,
            clearButton,
        });
        return () => bar.destroy();
    }, [grid, barClassName, name, clearButton]);

    return <div ref={hostRef} className={className} style={style} />;
}
