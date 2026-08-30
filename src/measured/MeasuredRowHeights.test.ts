import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    DEFAULT_MIN_ROW_HEIGHT,
    MEASURED_ROW_DEBOUNCE_MS,
    MeasuredRowHeights,
    type MeasuredRowGeometry,
    type MeasuredRowHeightOptions,
} from "./MeasuredRowHeights";
import type { RerenderInfo } from "../render/types";

/** The whole engine seam the policy needs, which is the point of it being one method. */
function makeGeometry() {
    const marks: RerenderInfo[] = [];
    const geometry: MeasuredRowGeometry = {
        update: (r) => {
            if (r) marks.push(r);
        },
    };
    return { geometry, marks };
}

function make(props: MeasuredRowHeightOptions = {}) {
    const { geometry, marks } = makeGeometry();
    const heights = new MeasuredRowHeights(props);
    heights.setGeometry(geometry);
    return { heights, marks };
}

/** Push past the per-row debounce. */
const settle = () => vi.advanceTimersByTime(MEASURED_ROW_DEBOUNCE_MS + 1);

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("rowHeight identity", () => {
    it("is the same function for the object's whole life, across every prop change", () => {
        const { heights } = make({ minRowHeight: 10 });
        const first = heights.rowHeight;

        heights.setProps({ minRowHeight: 40, maxRowHeight: 90 });
        heights.setProps({ preferMinHeightForNewRows: true });
        heights.setRowHeight(0, 55);
        settle();

        // `RenderGridModel.inputChanged()` compares this by identity. A new closure on a prop
        // change would make every update a full geometry invalidation.
        expect(heights.rowHeight).toBe(first);
    });

    it("still reflects the new props through the same function", () => {
        const { heights } = make({ minRowHeight: 10 });
        expect(heights.rowHeight(0)).toBe(24); // no hint, nothing measured, engine default
        heights.setProps({ minRowHeight: 10, preferMinHeightForNewRows: true });
        expect(heights.rowHeight(0)).toBe(10);
    });
});

describe("fallbacks for an unmeasured row", () => {
    it("prefers the hint, clamped", () => {
        const { heights } = make({
            minRowHeight: 20,
            maxRowHeight: 100,
            getInitialRowHeight: (row) => (row === 1 ? 500 : row === 2 ? 5 : undefined),
        });

        expect(heights.rowHeight(1)).toBe(100);
        expect(heights.rowHeight(2)).toBe(20);
        expect(heights.rowHeight(3)).toBe(24);
    });

    it("uses the minimum for a new row only when asked to", () => {
        const opts = { minRowHeight: 18 };
        const { heights: lastWins } = make(opts);
        const { heights: minWins } = make({ ...opts, preferMinHeightForNewRows: true });

        for (const h of [lastWins, minWins]) {
            h.setRowHeight(0, 200);
        }
        settle();

        expect(lastWins.rowHeight(9)).toBe(200); // the last measured height
        expect(minWins.rowHeight(9)).toBe(18); // the explicit opt-in minimum
    });

    it("falls back to a numeric rowHeight, then to the engine default", () => {
        expect(make({ rowHeight: 44 }).heights.rowHeight(0)).toBe(44);
        expect(make({}).heights.rowHeight(0)).toBe(24);
        // A per-row function is not read: a caller with one does not need this layer.
        expect(make({ rowHeight: () => 90 }).heights.rowHeight(0)).toBe(24);
    });
});

describe("clamping", () => {
    it("applies the ceiling first and the floor last", () => {
        const { heights } = make({ minRowHeight: 50, maxRowHeight: 30 });
        heights.setRowHeight(0, 200);
        settle();
        // The floor has the last word, so a max below the min cannot produce a row shorter
        // than the minimum.
        expect(heights.heightOf(0)).toBe(50);
    });

    it("uses 24 as the floor when no minimum is given", () => {
        const { heights } = make({});
        heights.setRowHeight(0, 3);
        settle();
        expect(heights.heightOf(0)).toBe(DEFAULT_MIN_ROW_HEIGHT);
    });

    it("ignores a zero, which is what a hidden or unlaid-out element reports", () => {
        const { heights, marks } = make({});
        heights.setRowHeight(0, 0);
        settle();
        expect(heights.heightOf(0)).toBeUndefined();
        expect(marks).toEqual([]);
    });
});

describe("committing", () => {
    it("coalesces a burst into one commit, 50 ms later", () => {
        const { heights, marks } = make({});

        heights.setRowHeight(5, 40);
        heights.setRowHeight(5, 60);
        heights.setRowHeight(5, 80);
        expect(marks).toEqual([]);
        expect(heights.heightOf(5)).toBeUndefined();

        vi.advanceTimersByTime(MEASURED_ROW_DEBOUNCE_MS - 1);
        expect(marks).toEqual([]);
        vi.advanceTimersByTime(2);

        expect(heights.heightOf(5)).toBe(80);
        expect(marks).toEqual([{ fromRow: 5 }]);
    });

    it("marks geometry from the row, never the row's content", () => {
        const { heights, marks } = make({});
        heights.setRowHeight(12, 90);
        settle();
        expect(marks).toEqual([{ fromRow: 12 }]);
        expect(marks[0].rows).toBeUndefined();
        expect(marks[0].all).toBeUndefined();
    });

    it("debounces each row separately", () => {
        const { heights, marks } = make({});
        heights.setRowHeight(1, 40);
        heights.setRowHeight(2, 50);
        settle();
        expect(marks.map((m) => m.fromRow).sort()).toEqual([1, 2]);
    });

    it("does not mark when the committed height did not move", () => {
        const { heights, marks } = make({});
        heights.setRowHeight(0, 40);
        settle();
        expect(marks.length).toBe(1);

        heights.setRowHeight(0, 40);
        settle();
        // Same value: the pending guard drops it before a timer is even armed.
        expect(marks.length).toBe(1);
    });
});

describe("disposal", () => {
    it("stops accepting measurements and cancels every pending commit", () => {
        const { heights, marks } = make({});
        heights.setRowHeight(0, 90);
        heights.dispose();
        settle();

        expect(marks).toEqual([]);
        expect(heights.disposed).toBe(true);
        expect(heights.heightOf(0)).toBeUndefined();

        heights.setRowHeight(1, 90);
        settle();
        expect(marks).toEqual([]);
    });

    it("leaves no timer rescheduling itself forever", () => {
        const { heights } = make({});
        heights.setRowHeight(0, 90);
        heights.dispose();
        vi.advanceTimersByTime(MEASURED_ROW_DEBOUNCE_MS * 20);
        // `debounce` re-arms while its `canRun` gate is false; disposal has to open the gate
        // as well as cancel, or a disposed layer keeps a timer alive for the life of the page.
        expect(vi.getTimerCount()).toBe(0);
    });

    it("ignores setProps and setGeometry after disposal", () => {
        const { heights, marks } = make({});
        heights.dispose();
        heights.setProps({ minRowHeight: 99 });
        const { geometry } = makeGeometry();
        heights.setGeometry(geometry);
        heights.setRowHeight(0, 400);
        settle();
        expect(marks).toEqual([]);
        expect(heights.rowHeight(0)).toBe(24);
    });
});
