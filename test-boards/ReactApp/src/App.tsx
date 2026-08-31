import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import type {
    CellFocus,
    Column,
    EditorContext,
    Filter,
    FilterDefinition,
    SortColumn,
} from "av-grid";
import {
    AVGrid,
    AVGridFilterBar,
    reactEditor,
    reactFilterBody,
    type AVGridInstance,
} from "av-grid/react";

// ------------------------------------------------------------------------------------------
// React components inside the grid's hooks, through the shipped adapters: a component as the
// city column's editor, and one as the score column's filter popover body.
// ------------------------------------------------------------------------------------------

function CityEditor({ ctx }: { ctx: EditorContext<Row> }) {
    const ref = useRef<HTMLSelectElement>(null);
    useEffect(() => ref.current?.focus(), []);
    return (
        <select
            ref={ref}
            defaultValue={String(ctx.value ?? "")}
            style={{ width: "100%", height: "100%" }}
            onChange={(e) => {
                ctx.setValue(e.target.value);
                ctx.commit();
            }}
            onBlur={() => ctx.cancel()}
        >
            {CITIES.map((c) => (
                <option key={c}>{c}</option>
            ))}
        </select>
    );
}

function MinScoreFilter({
    initial,
    onChange,
}: {
    initial: unknown;
    onChange: (v: unknown) => void;
}) {
    const [v, setV] = useState(initial == null ? "" : String(initial));
    return (
        <label style={{ display: "flex", gap: 6, alignItems: "center", padding: 4 }}>
            score ≥
            <input
                type="number"
                autoFocus
                value={v}
                style={{ width: 70 }}
                onChange={(e) => {
                    setV(e.target.value);
                    onChange(e.target.value === "" ? undefined : Number(e.target.value));
                }}
            />
        </label>
    );
}

const minScoreFilter: FilterDefinition<Row> = {
    name: "min-score",
    create: reactFilterBody((ctx, setValue) => (
        <MinScoreFilter initial={ctx.value} onChange={setValue} />
    )),
    label: (v) => `≥ ${v}`,
    match: (v, row) => row.score >= (v as number),
};

interface Row {
    id: number;
    name: string;
    city: string;
    score: number;
    active: boolean;
    joined: string;
}

const CITIES = ["Kyiv", "Lviv", "Odesa", "Dnipro", "Kharkiv", "Vinnytsia"];
const NAMES = ["Ada", "Alan", "Grace", "Edsger", "Barbara", "Donald", "Linus", "Margaret"];

function makeRows(count: number, seed = 0): Row[] {
    const out: Row[] = new Array(count);
    for (let i = 0; i < count; i++) {
        out[i] = {
            id: i + 1,
            name: `${NAMES[(i + seed) % NAMES.length]} ${i + 1}`,
            city: CITIES[(i * 7 + seed) % CITIES.length]!,
            score: ((i * 37 + seed * 11) % 1000) / 10,
            active: (i + seed) % 3 !== 0,
            joined: new Date(Date.UTC(2020, (i + seed) % 12, ((i * 3) % 27) + 1))
                .toISOString()
                .slice(0, 10),
        };
    }
    return out;
}

const columns: Column<Row>[] = [
    { key: "id", name: "ID", width: 70, dataType: "number", readonly: true },
    { key: "name", name: "Name", width: 180 },
    { key: "city", name: "City", width: 130, editor: reactEditor((ctx) => <CityEditor ctx={ctx} />) },
    { key: "score", name: "Score", width: 90, dataType: "number", filter: minScoreFilter },
    { key: "active", name: "Active", width: 80, dataType: "boolean" },
    { key: "joined", name: "Joined", width: 120, displayFormat: "date" },
];

export function App() {
    const [rows, setRows] = useState(() => makeRows(100_000));
    const [editable, setEditable] = useState(true);
    const [cellBorders, setCellBorders] = useState(true);
    const [rowHeight, setRowHeight] = useState<number | undefined>(24);
    const [search, setSearch] = useState("");
    const [edits, setEdits] = useState(0);
    const [focusText, setFocusText] = useState("—");
    const [filterCount, setFilterCount] = useState(0);
    // Held in React state and echoed straight back down — the round trip settles in one pass.
    const [sort, setSort] = useState<SortColumn | undefined>(undefined);
    const [filters, setFilters] = useState<Filter[] | undefined>(undefined);
    // Round-tripped through a clone, which is the case reference equality cannot catch.
    const [focus, setFocus] = useState<CellFocus<Row> | undefined>(undefined);
    const [renderCount, setRenderCount] = useState(0);

    // The instance, held two ways on purpose: a ref for imperative calls, and state so the
    // detached filter bar can mount once the grid exists.
    const gridRef = useRef<AVGridInstance<Row>>(null);
    const [gridForBar, setGridForBar] = useState<AVGridInstance<Row> | null>(null);

    const setBoth = useCallback((g: AVGridInstance<Row> | null) => {
        gridRef.current = g;
        setGridForBar(g);
        // Test-app only: gives the driving agent a handle to spy on.
        (window as unknown as { __grid: AVGridInstance<Row> | null }).__grid = g;
    }, []);

    const stats = useMemo(
        () => `${rows.length.toLocaleString()} rows · ${edits} edits · focus ${focusText}`,
        [rows.length, edits, focusText],
    );

    return (
        <div
            style={{
                font: "13px system-ui, sans-serif",
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 8,
                height: "100vh",
                boxSizing: "border-box",
            }}
        >
            <h2 style={{ margin: 0, fontSize: 16 }}>av-grid/react — test app</h2>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <button id="btn-rows-10k" onClick={() => setRows(makeRows(10_000, 1))}>
                    10k rows
                </button>
                <button id="btn-rows-100k" onClick={() => setRows(makeRows(100_000, 2))}>
                    100k rows
                </button>
                <button id="btn-rows-mutate" onClick={() => setRows((r) => r.slice(0, 500))}>
                    first 500
                </button>
                <label>
                    <input
                        id="chk-editable"
                        type="checkbox"
                        checked={editable}
                        onChange={(e) => setEditable(e.target.checked)}
                    />{" "}
                    editable
                </label>
                <label>
                    <input
                        id="chk-borders"
                        type="checkbox"
                        checked={cellBorders}
                        onChange={(e) => setCellBorders(e.target.checked)}
                    />{" "}
                    cellBorders
                </label>
                <label>
                    rowHeight{" "}
                    <input
                        id="inp-rowheight"
                        type="number"
                        style={{ width: 60 }}
                        value={rowHeight ?? ""}
                        onChange={(e) =>
                            setRowHeight(e.target.value ? Number(e.target.value) : undefined)
                        }
                    />
                </label>
                <input
                    id="inp-search"
                    placeholder="search…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
                <button
                    id="btn-scroll"
                    onClick={() => gridRef.current?.scrollToRow(50_000, "center")}
                >
                    scroll to 50 000
                </button>
                <button
                    id="btn-copy"
                    onClick={() => void gridRef.current?.copySelection("copyWithHeaders")}
                >
                    copy with headers
                </button>
                <button
                    id="btn-clear-filters"
                    onClick={() => gridRef.current?.clearFilters()}
                >
                    clear filters
                </button>
                <button id="btn-rerender" onClick={() => setRenderCount((n) => n + 1)}>
                    force re-render ({renderCount})
                </button>
            </div>

            <div id="stats" style={{ color: "#555" }}>
                {stats} · {filterCount} filters
            </div>

            {/* The built-in detached bar, chips-only — the app's own clear button follows. */}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <AVGridFilterBar grid={gridForBar} clearButton={false} />
                {filters && filters.length > 0 && (
                    <button id="btn-clear-all" onClick={() => gridRef.current?.clearFilters()}>
                        clear all
                    </button>
                )}
            </div>

            {/* Fully custom chips: the app renders its own from `filters` + describeFilter(),
                reopens the popover anchored to its own element, removes with removeFilter(). */}
            {gridForBar && filters && filters.length > 0 && (
                <div
                    id="custom-chips"
                    style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}
                >
                    <span style={{ color: "#888" }}>my chips:</span>
                    {filters.map((f) => {
                        const text = gridForBar.describeFilter(f);
                        return (
                            <span
                                key={f.columnKey}
                                title={text.title}
                                style={{
                                    border: "1px solid #8886",
                                    borderRadius: 12,
                                    padding: "1px 8px",
                                    display: "inline-flex",
                                    gap: 4,
                                }}
                            >
                                <button
                                    style={{ all: "unset", cursor: "pointer" }}
                                    onClick={(e) =>
                                        gridForBar.showFilterPopover(f.columnKey, {
                                            anchor: e.currentTarget,
                                        })
                                    }
                                >
                                    {text.name}: <b>{text.values}</b>
                                </button>
                                <button
                                    style={{ all: "unset", cursor: "pointer", color: "#888" }}
                                    onClick={() => gridForBar.removeFilter(f.columnKey)}
                                >
                                    ✕
                                </button>
                            </span>
                        );
                    })}
                </div>
            )}

            <AVGrid<Row>
                ref={setBoth}
                rows={rows}
                columns={columns}
                selectColumn
                editable={editable}
                cellBorders={cellBorders}
                rowHeight={rowHeight}
                searchString={search}
                sort={sort}
                onSortChange={setSort}
                filters={filters}
                canAddRows
                canDeleteRows
                rowNoun="person"
                // Inline arrow props, re-created on every render on purpose: lane 2 must send
                // no `setOptions` for these, and must still fire the newest closure.
                onEdit={() => {
                    setEdits((n) => n + 1);
                }}
                focus={focus}
                onFocusChange={(f) => {
                    setFocusText(f ? `${f.rowKey}:${String(f.columnKey)}` : "—");
                    setFocus(f ? structuredClone(f) : undefined);
                }}
                onFiltersChange={(f) => {
                    setFilterCount(f.length);
                    setFilters(f);
                }}
                rowClass={(r) => (r.row.score > 90 ? "hot" : undefined)}
                style={{ flex: "1 1 auto", minHeight: 0, border: "1px solid #ccc" }}
            />

            <style>{`.avg-data-cell.hot { color: #b8860b; font-weight: 600; }`}</style>
        </div>
    );
}
