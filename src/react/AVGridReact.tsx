/**
 * `<AVGrid>` — the React lifecycle adapter over the `AVGrid` class.
 *
 * **This file is also the reference for hosting the grid in React.** Everything it does is
 * something a consumer would otherwise write by hand, so it is written to be read: JSX, one named
 * hook per concern, and a comment wherever the reason is not on the line.
 *
 * **A thin adapter, not a controlled component.** Options flow down as props; state changes come
 * back through the existing callbacks; a host that wants to *drive* the grid reaches the real
 * instance through the `ref` and calls the documented methods. There is no controlled-prop
 * machinery here — though `sort`, `filters`, `selected` and `searchString` are ordinary options,
 * so a host may hold those in React state and echo them straight back down. See `docs/react.md`.
 *
 * Three update lanes, diffed once per commit:
 *
 * | Lane | Prop | What happens |
 * |---|---|---|
 * | 1 | `rows` | a new reference calls `setRows()` — scroll position kept, no teardown |
 * | 2 | the callbacks in `CALLBACK_OPTION_KEYS` | never diffed, never re-sent: a stable proxy installed at `create()` forwards to the latest prop |
 * | 3 | everything else | `Object.is` against the previous commit; one `setOptions()` with just the changed keys |
 *
 * The grid instance is created once, in a layout effect, and destroyed on unmount. Nothing here
 * recreates it.
 */

import {
    forwardRef,
    useImperativeHandle,
    useLayoutEffect,
    useRef,
    type CSSProperties,
    type ReactElement,
    type Ref,
    type RefObject,
} from "react";
import { AVGrid, CALLBACK_OPTION_KEYS, PAINT_PATH_CALLBACK_KEYS } from "av-grid";
import type { AVGridOptions } from "av-grid";

/**
 * The instance a `ref` yields — the core's `AVGrid` class, under a name that does not collide
 * with the component.
 *
 * ```tsx
 * import { AVGrid, type AVGridInstance } from "av-grid/react";
 * const gridRef = useRef<AVGridInstance<Row>>(null);
 * ```
 *
 * A type alias, not a re-export of anything with behaviour, so there is nothing here that can
 * drift from the core.
 */
export type AVGridInstance<R = any> = AVGrid<R>;

/**
 * Props: every `AVGridOptions` field, plus `className` and `style` for the host element.
 *
 * `className` is **the host div's**, not the grid root's — it is the class on the element this
 * component renders, which is what a React author expects. The grid root inside it still carries
 * `.avg-grid`, so `.my-grid .avg-grid { … }` reaches it. `style` is where the host's **height**
 * goes: the grid fills its host and measures it, exactly as `AVGrid.create()` documents.
 */
export type AVGridReactProps<R = any> = Omit<AVGridOptions<R>, "className"> & {
    /** Class on the host element this component renders. */
    className?: string;
    /** Style on the host element. Give it a height — the grid fills its host. */
    style?: CSSProperties;
};

// ===========================================================================================
// The component
// ===========================================================================================

function AVGridReactInner<R>(
    props: AVGridReactProps<R>,
    ref: Ref<AVGrid<R>>,
): ReactElement {
    const hostRef = useRef<HTMLDivElement>(null);

    // Hooks run their effects in the order they are called, and here that order is load-bearing:
    // the latest props have to be readable before the grid is created, and the grid has to exist
    // before either the ref or the option diff can do anything.
    const propsRef = useLatest(props);
    const state = useWrapperState<R>();

    useGridLifecycle(hostRef, propsRef, state);
    useImperativeHandle(ref, () => state.grid as AVGrid<R>, [state]);
    useOptionSync(props, state);

    const { className, style } = props;
    return <div ref={hostRef} className={className} style={style} />;
}

AVGridReactInner.displayName = "AVGridReact";

/**
 * The grid, as a React component.
 *
 * ```tsx
 * const gridRef = useRef<AVGridInstance<Row>>(null);
 *
 * <AVGrid
 *     ref={gridRef}
 *     rows={rows}
 *     columns={columns}
 *     editable
 *     onEdit={(e) => save(e.rowKey, e.columnKey, e.value)}
 *     style={{ height: 400 }}
 * />
 * ```
 *
 * `ref.current` is the real `AVGrid<R>` — `null` before mount and after unmount, the instance in
 * between. Imperative changes made through it are **not** reverted by a later render: the
 * wrapper diffs its own previous props, never the grid's live state.
 *
 * `forwardRef` rather than React 19's ref-as-prop, because the package supports `react >= 18`.
 * The cast puts back the generic that `forwardRef` erases, so `<AVGrid<Row> …>` keeps its row
 * type all the way through to the ref.
 */
export const AVGridReact = forwardRef(AVGridReactInner) as <R = any>(
    props: AVGridReactProps<R> & { ref?: Ref<AVGrid<R>> },
) => ReactElement;

// ===========================================================================================
// The hooks
// ===========================================================================================

/**
 * A ref that always holds the latest value, written **after** the commit rather than during
 * render: a render can be thrown away under concurrent React, and a discarded render must not
 * leave its props behind for a live callback to read.
 */
function useLatest<T>(value: T): RefObject<T> {
    const ref = useRef(value);
    useLayoutEffect(() => {
        ref.current = value;
    });
    return ref;
}

/** Everything the effects below share. One object per mounted component, allocated once. */
interface WrapperState<R> {
    /** The live instance — `null` before mount and after unmount. */
    grid: AVGrid<R> | null;
    /** Which callback keys got a proxy. Decided at create time, fixed for the lifetime. */
    proxied: ReadonlySet<string>;
    /** The previous commit's diffable options, for lane 3 to compare against. */
    prevOptions: AnyRecord;
    /** The previous commit's `rows` reference, for lane 1. */
    prevRows: readonly R[] | null;
}

function useWrapperState<R>(): WrapperState<R> {
    const ref = useRef<WrapperState<R> | null>(null);
    // Lazy, rather than `useRef({…})`, which allocates a throwaway object on every render.
    ref.current ??= {
        grid: null,
        proxied: EMPTY_SET,
        prevOptions: {},
        prevRows: null,
    };
    return ref.current;
}

/**
 * Create the grid on mount, destroy it on unmount, and install the lane-2 callback proxies.
 *
 * `useLayoutEffect`, not `useEffect`: the grid measures its host, so it has to exist before the
 * browser paints — otherwise the first frame is a grid that believes it has no viewport.
 *
 * StrictMode's development mount → cleanup → mount is safe by construction rather than by a
 * guard: `destroy()` is tested leak-free over 100 cycles, and the second mount builds a fresh
 * instance. One live grid, no warnings.
 */
function useGridLifecycle<R>(
    hostRef: RefObject<HTMLDivElement | null>,
    propsRef: RefObject<AVGridReactProps<R>>,
    state: WrapperState<R>,
): void {
    useLayoutEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        const current = propsRef.current;

        // A proxy for every pure callback — except the two paint-path hooks when the host does
        // not supply them. Their mere presence makes the cell renderer build a context object
        // per cell that it otherwise skips, so an unconditional proxy would tax every grid.
        const proxied = new Set<string>();
        for (const key of CALLBACK_OPTION_KEYS) {
            if (PAINT_PATH_KEYS.has(key) && typeof current[key] !== "function") continue;
            proxied.add(key);
        }

        // The create-time options are the props, minus what the wrapper consumes itself, with a
        // proxy standing in for every callback. The rest pattern keeps the object typed — the
        // dynamic proxy writes are the one place a cast is honest.
        const { className: _hostClass, style: _hostStyle, ...initial } = current;
        delete (initial as { children?: unknown }).children;
        for (const key of proxied) {
            (initial as AnyRecord)[key] = makeProxy(propsRef, key);
        }

        const grid = AVGrid.create(host, initial as AVGridOptions<R>);
        state.grid = grid;
        state.proxied = proxied;
        state.prevOptions = optionSnapshot(current as AnyRecord, proxied);
        state.prevRows = propsRef.current.rows;

        return () => {
            grid.destroy();
            state.grid = null;
            state.prevOptions = {};
            state.prevRows = null;
        };
    }, [hostRef, propsRef, state]);
}

/**
 * Lanes 1 and 3, on every commit — including the mount one, where it finds nothing changed
 * because `useGridLifecycle` has just recorded this same snapshot.
 */
function useOptionSync<R>(props: AVGridReactProps<R>, state: WrapperState<R>): void {
    useLayoutEffect(() => {
        const grid = state.grid;
        if (!grid) return;

        const next = optionSnapshot(props as AnyRecord, state.proxied);
        const changed: AnyRecord = {};
        let changedCount = 0;

        for (const key of Object.keys(next)) {
            if (!Object.is(state.prevOptions[key], next[key])) {
                changed[key] = next[key];
                changedCount++;
            }
        }
        // A prop that disappeared resets that option to its default. Removing a prop is how a
        // React author says "stop asking for this", and it must not silently keep the old value.
        for (const key of Object.keys(state.prevOptions)) {
            if (!(key in next)) {
                changed[key] = undefined;
                changedCount++;
            }
        }
        state.prevOptions = next;

        const rowsChanged = !Object.is(state.prevRows, props.rows);
        state.prevRows = props.rows;

        // Rows travel inside the `setOptions` call whenever anything else changed too: the core
        // applies columns before rows on purpose, because row filtering matches against them.
        // Alone, they take the cheaper direct path.
        if (rowsChanged && changedCount > 0) {
            changed.rows = props.rows;
            changedCount++;
        } else if (rowsChanged) {
            grid.setRows(props.rows);
        }

        if (changedCount > 0) {
            grid.setOptions(changed as Partial<AVGridOptions<R>>);
        }
    });
}

// ===========================================================================================
// Plumbing
// ===========================================================================================

type AnyRecord = Record<string, unknown>;

/** Props the wrapper consumes itself and never forwards to the grid. */
const HOST_ONLY_KEYS = new Set<string>(["className", "style", "children", "key", "ref"]);

const PAINT_PATH_KEYS = new Set<string>(PAINT_PATH_CALLBACK_KEYS);

const EMPTY_SET: ReadonlySet<string> = new Set<string>();

/**
 * The keys lane 3 diffs: everything the host passed that is neither ours, nor `rows` (lane 1),
 * nor a proxied callback (lane 2).
 */
function optionSnapshot(props: AnyRecord, proxied: ReadonlySet<string>): AnyRecord {
    const out: AnyRecord = {};
    for (const key of Object.keys(props)) {
        if (HOST_ONLY_KEYS.has(key) || key === "rows" || proxied.has(key)) continue;
        out[key] = props[key];
    }
    return out;
}

/**
 * One stable function per callback key, forwarding to whatever the host passes *now* and
 * preserving the return value — several callbacks cancel by returning `false`.
 */
function makeProxy(
    propsRef: { current: unknown },
    key: string,
): (...args: never[]) => unknown {
    return (...args: never[]) => {
        const fn = (propsRef.current as AnyRecord)[key];
        return typeof fn === "function"
            ? (fn as (...a: never[]) => unknown)(...args)
            : undefined;
    };
}
