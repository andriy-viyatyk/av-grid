// @vitest-environment happy-dom
/**
 * Contract tests for the React wrapper.
 *
 * happy-dom does no layout, so nothing here says whether the grid *renders* — that is what
 * `examples/13-react.html` and the boards are for. These pin the wrapper's lifecycle and its
 * three update lanes: which core call each prop change makes, and which it must not make.
 */

import { StrictMode, useState } from "react";
import { act, cleanup, render } from "@testing-library/react";
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import { AVGrid } from "../AVGrid";
import type { AVGridOptions, CallbackOptionKey } from "../options";
import { CALLBACK_OPTION_KEYS, PAINT_PATH_CALLBACK_KEYS } from "../options";
import type { CellFocus, Column, Filter, SortColumn } from "../types";
import { AVGridFilterBar } from "./AVGridFilterBar";
import { AVGrid as AVGridAlias, AVGridReact } from "./index";

/**
 * Every element measures 0×0 under happy-dom, so the grid would decide it has no viewport.
 * `AVGrid.test.ts` patches `createElement` around construction; here the host element is made
 * by React during a commit, so the patch has to stand for the whole file.
 */
let originalCreateElement: typeof document.createElement;

beforeAll(() => {
    originalCreateElement = document.createElement.bind(document);
    document.createElement = ((tag: string) => {
        const el = originalCreateElement(tag) as HTMLElement;
        Object.defineProperties(el, {
            offsetWidth: { value: 600, configurable: true },
            offsetHeight: { value: 300, configurable: true },
            clientWidth: { value: 600, configurable: true },
            clientHeight: { value: 300, configurable: true },
        });
        return el;
    }) as typeof document.createElement;
});

afterAll(() => {
    document.createElement = originalCreateElement;
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

interface Row {
    id: number;
    name: string;
    score: number;
}

/**
 * Rebuilt per test: the grid writes committed edits straight into the row objects, so a shared
 * fixture would carry one test's edit into the next.
 */
let rows: Row[];

beforeEach(() => {
    rows = [
        { id: 1, name: "Ada", score: 3 },
        { id: 2, name: "Alan", score: 5 },
        { id: 3, name: "Grace", score: 8 },
    ];
});

const columns: Column<Row>[] = [
    { key: "name", name: "Name" },
    { key: "score", name: "Score", dataType: "number" },
];

/** The row pipeline is asynchronous — two frames is what `AVGrid.test.ts` waits, too. */
async function settle(): Promise<void> {
    await Promise.resolve();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await Promise.resolve();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
}

/** The instances `AVGrid.create` handed out during a test, in order. */
function spyOnCreate(): AVGrid<Row>[] {
    const made: AVGrid<Row>[] = [];
    const real = AVGrid.create.bind(AVGrid);
    vi.spyOn(AVGrid, "create").mockImplementation(((host: any, options: any) => {
        const grid = real(host, options) as AVGrid<Row>;
        made.push(grid);
        return grid;
    }) as typeof AVGrid.create);
    return made;
}

// ===========================================================================================
// Lifecycle
// ===========================================================================================

describe("lifecycle", () => {
    it("mounts one live grid, and destroys the extra instance StrictMode creates", () => {
        const made = spyOnCreate();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const error = vi.spyOn(console, "error").mockImplementation(() => {});

        render(
            <StrictMode>
                <AVGridReact<Row> rows={rows} columns={columns} />
            </StrictMode>,
        );

        // React 19 dev double-invokes mount → cleanup → mount, so two instances exist and
        // exactly one of them is still alive.
        const live = made.filter((g) => !g.getState().destroyed);
        expect(live).toHaveLength(1);
        expect(made.length).toBeGreaterThanOrEqual(1);
        expect(warn).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
    });

    it("destroys the grid on unmount", () => {
        const made = spyOnCreate();
        const view = render(<AVGridReact<Row> rows={rows} columns={columns} />);
        const grid = made.at(-1)!;
        expect(grid.getState().destroyed).toBe(false);

        view.unmount();
        expect(grid.getState().destroyed).toBe(true);
    });

    it("puts className and style on the host element, not on the grid root", () => {
        const view = render(
            <AVGridReact<Row>
                rows={rows}
                columns={columns}
                className="my-grid"
                style={{ height: 300 }}
            />,
        );
        const host = view.container.firstElementChild as HTMLElement;
        expect(host.className).toBe("my-grid");
        expect(host.style.height).toBe("300px");
        expect(host.querySelector(".avg-grid")).not.toBeNull();
        expect(host.querySelector(".avg-grid")!.classList.contains("my-grid")).toBe(false);
    });
});

// ===========================================================================================
// Lane 1 — rows
// ===========================================================================================

describe("the rows lane", () => {
    it("sends a new rows reference through setRows, with no setOptions and no re-create", () => {
        const made = spyOnCreate();
        const view = render(<AVGridReact<Row> rows={rows} columns={columns} />);
        const grid = made.at(-1)!;

        const setRows = vi.spyOn(grid, "setRows");
        const setOptions = vi.spyOn(grid, "setOptions");
        const next = [...rows, { id: 4, name: "Edsger", score: 1 }];

        view.rerender(<AVGridReact<Row> rows={next} columns={columns} />);

        expect(setRows).toHaveBeenCalledTimes(1);
        expect(setRows).toHaveBeenCalledWith(next);
        expect(setOptions).not.toHaveBeenCalled();
        expect(made).toHaveLength(1);
        expect(grid.getRows()).toEqual(next);
    });

    it("does nothing when the rows reference is unchanged", () => {
        const made = spyOnCreate();
        const view = render(<AVGridReact<Row> rows={rows} columns={columns} />);
        const grid = made.at(-1)!;
        const setRows = vi.spyOn(grid, "setRows");
        const setOptions = vi.spyOn(grid, "setOptions");

        view.rerender(<AVGridReact<Row> rows={rows} columns={columns} />);

        expect(setRows).not.toHaveBeenCalled();
        expect(setOptions).not.toHaveBeenCalled();
    });

    it("routes rows through setOptions when columns change in the same commit", () => {
        // Order matters in the core: columns are applied before rows, because row filtering
        // matches against them. Splitting the two calls would apply them the wrong way round.
        const made = spyOnCreate();
        const view = render(<AVGridReact<Row> rows={rows} columns={columns} />);
        const grid = made.at(-1)!;
        const setOptions = vi.spyOn(grid, "setOptions");

        const nextRows = rows.slice(0, 2);
        const nextColumns: Column<Row>[] = [{ key: "name", name: "Who" }];
        view.rerender(<AVGridReact<Row> rows={nextRows} columns={nextColumns} />);

        expect(setOptions).toHaveBeenCalledTimes(1);
        const payload = setOptions.mock.calls[0]![0];
        expect(payload.rows).toBe(nextRows);
        expect(payload.columns).toBe(nextColumns);
    });
});

// ===========================================================================================
// Lane 3 — the option diff
// ===========================================================================================

describe("the option diff lane", () => {
    it("sends exactly the changed key, once", () => {
        const made = spyOnCreate();
        const view = render(
            <AVGridReact<Row> rows={rows} columns={columns} editable rowHeight={24} />,
        );
        const grid = made.at(-1)!;
        const setOptions = vi.spyOn(grid, "setOptions");

        view.rerender(
            <AVGridReact<Row> rows={rows} columns={columns} editable rowHeight={32} />,
        );

        expect(setOptions).toHaveBeenCalledTimes(1);
        expect(setOptions).toHaveBeenCalledWith({ rowHeight: 32 });
        expect(grid.getState().rowHeight).toBe(32);
        expect(made).toHaveLength(1);
    });

    it("carries the phase-10 options — footerRows and pinned columns — with no wrapper change", () => {
        // The claim task 50 makes: every new core option reaches the wrapper through lane 3
        // by construction. Verified by test, not by reading.
        const made = spyOnCreate();
        const pinnedColumns = [
            { key: "id", name: "ID", width: 60, pinned: "left" as const },
            { key: "name", name: "Name", width: 120 },
            { key: "score", name: "Score", width: 80, pinned: "right" as const },
        ];
        const footer = [{ id: 0, name: "Total", score: 60 }];
        const view = render(
            <AVGridReact<Row> rows={rows} columns={pinnedColumns} footerRows={footer} />,
        );
        const grid = made.at(-1)!;
        expect((grid.render.model as any).options.stickyRight).toBe(1);
        expect((grid.render.model as any).options.stickyBottom).toBe(1);

        // A changed footer array goes through one diffed setOptions, like any option.
        const setOptions = vi.spyOn(grid, "setOptions");
        const footer2 = [{ id: 0, name: "Total", score: 61 }];
        view.rerender(
            <AVGridReact<Row> rows={rows} columns={pinnedColumns} footerRows={footer2} />,
        );
        expect(setOptions).toHaveBeenCalledTimes(1);
        expect(setOptions).toHaveBeenCalledWith({ footerRows: footer2 });
        expect(made).toHaveLength(1);
    });

    it("carries the phase-12 options — externalFilter and externalSort — with no wrapper change", () => {
        // Same claim as phase 10's: every new core option reaches the wrapper through lane 3
        // by construction. Verified by test, not by reading.
        const made = spyOnCreate();
        const unsorted = [...rows].reverse();
        // One object across renders: an inline literal would be re-sent by Object.is, which is
        // the wrapper's documented contract for object props.
        const sort = { key: "name", direction: "asc" as const };
        const view = render(
            <AVGridReact<Row>
                rows={unsorted}
                columns={columns}
                externalSort
                sort={sort}
            />,
        );
        const grid = made.at(-1)!;
        // The sort is state, but the host owns the order.
        expect(grid.getVisibleRows()).toEqual(unsorted);

        const setOptions = vi.spyOn(grid, "setOptions");
        view.rerender(
            <AVGridReact<Row>
                rows={unsorted}
                columns={columns}
                externalSort
                externalFilter
                sort={sort}
            />,
        );
        expect(setOptions).toHaveBeenCalledTimes(1);
        expect(setOptions).toHaveBeenCalledWith({ externalFilter: true });
        expect(made).toHaveLength(1);
    });

    it("sends undefined for a prop that disappeared, and the option goes back to its default", () => {
        const made = spyOnCreate();
        const view = render(
            <AVGridReact<Row> rows={rows} columns={columns} rowHeight={40} />,
        );
        const grid = made.at(-1)!;
        const setOptions = vi.spyOn(grid, "setOptions");

        view.rerender(<AVGridReact<Row> rows={rows} columns={columns} />);

        expect(setOptions).toHaveBeenCalledTimes(1);
        const payload = setOptions.mock.calls[0]![0] as Record<string, unknown>;
        expect("rowHeight" in payload).toBe(true);
        expect(payload.rowHeight).toBeUndefined();
        expect(grid.getState().rowHeight).toBe(24);
    });

    it("does not call setOptions when nothing changed", () => {
        const made = spyOnCreate();
        const view = render(
            <AVGridReact<Row> rows={rows} columns={columns} editable rowNoun="person" />,
        );
        const grid = made.at(-1)!;
        const setOptions = vi.spyOn(grid, "setOptions");

        view.rerender(
            <AVGridReact<Row> rows={rows} columns={columns} editable rowNoun="person" />,
        );

        expect(setOptions).not.toHaveBeenCalled();
    });
});

// ===========================================================================================
// Lane 2 — the callbacks
// ===========================================================================================

describe("the callback lane", () => {
    it("never re-sends an inline callback, and fires the latest closure", () => {
        const made = spyOnCreate();
        const first = vi.fn();
        const second = vi.fn();

        const view = render(
            <AVGridReact<Row>
                rows={rows}
                columns={columns}
                editable
                onEdit={(e) => first(e.value)}
            />,
        );
        const grid = made.at(-1)!;
        const setOptions = vi.spyOn(grid, "setOptions");

        view.rerender(
            <AVGridReact<Row>
                rows={rows}
                columns={columns}
                editable
                onEdit={(e) => second(e.value)}
            />,
        );

        expect(setOptions).not.toHaveBeenCalled();

        grid.setCellValue(0, 0, "Ada Lovelace");
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledWith("Ada Lovelace");
    });

    it("carries a cancelling `false` back through the proxy", () => {
        const made = spyOnCreate();
        const view = render(
            <AVGridReact<Row> rows={rows} columns={columns} editable onEdit={() => true} />,
        );
        const grid = made.at(-1)!;

        view.rerender(
            <AVGridReact<Row> rows={rows} columns={columns} editable onEdit={() => false} />,
        );

        const before = grid.getRows()[0]!.name;
        grid.setCellValue(0, 0, "rejected");
        expect(grid.getRows()[0]!.name).toBe(before);
    });

    it("installs a proxy for every non-paint-path callback, supplied or not", () => {
        const made = spyOnCreate();
        render(<AVGridReact<Row> rows={rows} columns={columns} />);
        const options = (made.at(-1) as unknown as { model: { options: unknown } }).model
            .options as Record<string, unknown>;

        for (const key of CALLBACK_OPTION_KEYS) {
            const paintPath = (PAINT_PATH_CALLBACK_KEYS as readonly string[]).includes(key);
            expect([key, typeof options[key]]).toEqual([
                key,
                paintPath ? "undefined" : "function",
            ]);
        }
    });

    it("proxies a paint-path hook only when the host supplies one", () => {
        const made = spyOnCreate();
        const view = render(
            <AVGridReact<Row> rows={rows} columns={columns} rowClass={() => "a"} />,
        );
        const grid = made.at(-1)!;
        const setOptions = vi.spyOn(grid, "setOptions");

        view.rerender(
            <AVGridReact<Row> rows={rows} columns={columns} rowClass={() => "b"} />,
        );
        expect(setOptions).not.toHaveBeenCalled();

        const options = (grid as unknown as { model: { options: AVGridOptions<Row> } }).model
            .options;
        expect(options.rowClass?.({ row: rows[0]!, rowIndex: 0, rowKey: "1" })).toBe("b");
    });
});

// ===========================================================================================
// The ref
// ===========================================================================================

describe("the instance ref", () => {
    it("is the instance after mount and null after unmount", () => {
        let seen: AVGrid<Row> | null = null;
        const ref = { current: null as AVGrid<Row> | null };

        const view = render(<AVGridReact<Row> ref={ref} rows={rows} columns={columns} />);
        seen = ref.current;
        expect(seen).toBeInstanceOf(AVGrid);
        expect(seen!.getRows()).toEqual(rows);

        view.unmount();
        expect(ref.current).toBeNull();
    });

    it("does not revert an imperative change on the next render", async () => {
        // The wrapper diffs its own previous props, not the grid's live state. That is the
        // "thin adapter, not controlled component" rule, made mechanical.
        const ref = { current: null as AVGrid<Row> | null };
        const view = render(<AVGridReact<Row> ref={ref} rows={rows} columns={columns} />);

        ref.current!.setFilters([{ columnKey: "name", value: ["Ada"] }]);
        await settle();
        expect(ref.current!.getFilters()).toHaveLength(1);
        expect(ref.current!.getVisibleRows()).toHaveLength(1);

        view.rerender(
            <AVGridReact<Row> ref={ref} rows={rows} columns={columns} rowNoun="person" />,
        );
        await settle();

        expect(ref.current!.getFilters()).toHaveLength(1);
        expect(ref.current!.getVisibleRows()).toHaveLength(1);
    });
});

// ===========================================================================================
// The filter bar
// ===========================================================================================

describe("AVGridFilterBar", () => {
    function Host({ show = true }: { show?: boolean }) {
        const [grid, setGrid] = useState<AVGrid<Row> | null>(null);
        return (
            <>
                <AVGridFilterBar grid={grid} className="bar-host" />
                {show ? (
                    <AVGridReact<Row> ref={setGrid} rows={rows} columns={columns} />
                ) : null}
            </>
        );
    }

    it("mounts the bar once, on the render after the grid instance arrives", () => {
        const view = render(<Host />);
        const barHost = view.container.querySelector(".bar-host")!;
        expect(barHost.querySelectorAll(".avg-filter-bar")).toHaveLength(1);
    });

    it("removes the bar when it unmounts, leaving the grid alone", () => {
        const made = spyOnCreate();
        const view = render(<Host />);
        const grid = made.at(-1)!;
        expect(view.container.querySelector(".avg-filter-bar")).not.toBeNull();

        view.rerender(<div />);
        expect(view.container.querySelector(".avg-filter-bar")).toBeNull();
        expect(grid.getState().destroyed).toBe(true);
    });

    it("survives the grid being destroyed before the bar", () => {
        const view = render(<Host />);
        // `show={false}` unmounts the grid; the bar is still mounted with a stale instance.
        expect(() => act(() => view.rerender(<Host show={false} />))).not.toThrow();
        expect(() => view.unmount()).not.toThrow();
    });
});

// ===========================================================================================
// The state-carrying props, driven as controlled values
// ===========================================================================================

/**
 * `sort`, `filters`, `selected` and `searchString` are ordinary options, so they are ordinary
 * props — and a host may hold them in state and echo the matching callback straight back down.
 * That works only because each setter compares by **value** and returns early on no change; if
 * one of them ever stopped, the echo would become an infinite render loop. These pin it.
 */
describe("state props, echoed back from React state", () => {
    it("sort settles in a single pass", () => {
        const made = spyOnCreate();
        const changes: (SortColumn | undefined)[] = [];
        let renders = 0;

        function Controlled() {
            const [sort, setSort] = useState<SortColumn | undefined>(undefined);
            renders++;
            return (
                <AVGridReact<Row>
                    rows={rows}
                    columns={columns}
                    sort={sort}
                    onSortChange={(s) => {
                        // Without multiSort the reported arity is always a single object.
                        changes.push(s as SortColumn | undefined);
                        setSort(s as SortColumn | undefined);
                    }}
                />
            );
        }

        render(<Controlled />);
        const grid = made.at(-1)!;
        const before = renders;

        act(() => grid.setSort({ key: "name", direction: "asc" }));

        expect(changes).toHaveLength(1);
        expect(grid.getSort()).toMatchObject({ key: "name", direction: "asc" });
        expect(renders).toBe(before + 1);
    });

    it("a multiSort array settles in a single pass", () => {
        // The host rebuilds the array every render, so identity always differs — only the
        // element-by-element value guard in setSort makes this terminate.
        const made = spyOnCreate();
        const changes: (readonly SortColumn[])[] = [];
        let renders = 0;

        function Controlled() {
            const [sort, setSort] = useState<readonly SortColumn[]>([]);
            renders++;
            return (
                <AVGridReact<Row>
                    rows={rows}
                    columns={columns}
                    multiSort
                    sort={sort.map((s) => ({ ...s }))}
                    onSortChange={(s) => {
                        changes.push(s as readonly SortColumn[]);
                        setSort(s as readonly SortColumn[]);
                    }}
                />
            );
        }

        render(<Controlled />);
        const grid = made.at(-1)!;
        const before = renders;

        act(() =>
            grid.setSort([
                { key: "name", direction: "asc" },
                { key: "score", direction: "desc" },
            ]),
        );

        expect(changes).toHaveLength(1);
        expect(grid.getSort()).toEqual([
            { key: "name", direction: "asc" },
            { key: "score", direction: "desc" },
        ]);
        expect(renders).toBe(before + 1);
    });

    it("filters settle in a single pass", async () => {
        const made = spyOnCreate();
        const changes: Filter[][] = [];
        let renders = 0;

        function Controlled() {
            const [filters, setFilters] = useState<Filter[] | undefined>(undefined);
            renders++;
            return (
                <AVGridReact<Row>
                    rows={rows}
                    columns={columns}
                    filters={filters}
                    onFiltersChange={(f) => {
                        changes.push(f);
                        setFilters(f);
                    }}
                />
            );
        }

        render(<Controlled />);
        const grid = made.at(-1)!;
        const before = renders;

        act(() => grid.applyFilter({ columnKey: "name", value: ["Ada"] }));
        await settle();

        expect(changes).toHaveLength(1);
        expect(grid.getFilters()).toHaveLength(1);
        expect(grid.getVisibleRows()).toHaveLength(1);
        expect(renders).toBe(before + 1);
    });

    it("selected settles in a single pass", () => {
        const made = spyOnCreate();
        const changes: string[][] = [];
        let renders = 0;

        function Controlled() {
            const [selected, setSelected] = useState<string[] | undefined>(undefined);
            renders++;
            return (
                <AVGridReact<Row>
                    rows={rows}
                    columns={columns}
                    selectColumn
                    selected={selected}
                    onSelectionChange={(keys) => {
                        changes.push(keys);
                        setSelected(keys);
                    }}
                />
            );
        }

        render(<Controlled />);
        const grid = made.at(-1)!;
        const before = renders;

        act(() => grid.toggleSelected("2"));

        expect(changes).toEqual([["2"]]);
        expect(grid.getSelected()).toEqual(["2"]);
        expect(renders).toBe(before + 1);
    });

    it("focus settles in a single pass", () => {
        const made = spyOnCreate();
        const changes: (CellFocus<Row> | undefined)[] = [];
        let renders = 0;

        function Controlled() {
            const [focus, setFocus] = useState<CellFocus<Row> | undefined>(undefined);
            renders++;
            return (
                <AVGridReact<Row>
                    rows={rows}
                    columns={columns}
                    focus={focus}
                    onFocusChange={(f) => {
                        // A fresh object every time, exactly as a host storing it would produce
                        // after a serialize/restore — the case identity comparison cannot catch.
                        changes.push(f);
                        setFocus(f ? structuredClone(f) : undefined);
                    }}
                />
            );
        }

        render(<Controlled />);
        const grid = made.at(-1)!;
        const before = renders;

        act(() => grid.focusCell(1, 0));

        expect(changes).toHaveLength(1);
        expect(grid.getFocus()?.rowKey).toBe("2");
        expect(renders).toBe(before + 1);
    });

    it("restores a focus passed on the first render, without reporting it", () => {
        const made = spyOnCreate();
        const onFocusChange = vi.fn();

        render(
            <AVGridReact<Row>
                rows={rows}
                columns={columns}
                focus={{ rowKey: "3", columnKey: "name", isDragging: false }}
                onFocusChange={onFocusChange}
            />,
        );

        expect(made.at(-1)!.getFocus()?.rowKey).toBe("3");
        expect(onFocusChange).not.toHaveBeenCalled();
    });
});

// ===========================================================================================
// The short name
// ===========================================================================================

describe("the AVGrid alias", () => {
    it("is the same component as AVGridReact", () => {
        expect(AVGridAlias).toBe(AVGridReact);
    });

    it("renders a grid under the short name", () => {
        const view = render(<AVGridAlias<Row> rows={rows} columns={columns} />);
        expect(view.container.querySelector(".avg-grid")).not.toBeNull();
    });
});

// ===========================================================================================
// Compile-time
// ===========================================================================================

describe("the callback classification", () => {
    it("covers every key the wrapper proxies", () => {
        // `_EveryFunctionOptionIsClassified` in options.ts is the real gate — adding an
        // unclassified function option fails `npm run typecheck`. This only pins that the list
        // is non-empty and that its members really are options.
        const keys: readonly CallbackOptionKey[] = CALLBACK_OPTION_KEYS;
        expect(keys.length).toBeGreaterThan(15);
        expect(new Set(keys).size).toBe(keys.length);
    });
});
