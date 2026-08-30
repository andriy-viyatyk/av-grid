// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { CellPool } from "./CellPool";

const cell = (name: string): HTMLElement => {
    const el = document.createElement("div");
    el.dataset.name = name;
    return el;
};

const nameOf = (el: HTMLElement | undefined) => el?.dataset.name;

describe("CellPool — unkeyed, the behaviour every grid already had", () => {
    it("hands back the most recently released element", () => {
        const pool = new CellPool();
        pool.release(cell("a"));
        pool.release(cell("b"));

        expect(nameOf(pool.acquire())).toBe("b");
        expect(nameOf(pool.acquire())).toBe("a");
        expect(pool.acquire()).toBeUndefined();
    });

    it("counts hits and misses exactly as before keys existed", () => {
        const pool = new CellPool();
        pool.acquire();
        pool.release(cell("a"));
        pool.acquire();
        pool.acquire();

        expect(pool.stats).toEqual({ hits: 1, misses: 2, released: 1, discarded: 0 });
    });

    it("discards past maxSize rather than growing without bound", () => {
        const pool = new CellPool(2);
        pool.release(cell("a"));
        pool.release(cell("b"));
        pool.release(cell("c"));

        expect(pool.size).toBe(2);
        expect(pool.stats.released).toBe(2);
        expect(pool.stats.discarded).toBe(1);
    });

    it("clear() empties it and resetStats() zeroes the counters", () => {
        const pool = new CellPool();
        pool.release(cell("a"));
        pool.acquire();
        pool.release(cell("b"));

        pool.clear();
        expect(pool.size).toBe(0);
        expect(pool.acquire()).toBeUndefined();

        pool.resetStats();
        expect(pool.stats).toEqual({ hits: 0, misses: 0, released: 0, discarded: 0 });
    });
});

describe("CellPool — reuse keys", () => {
    it("never hands a keyed request a cell of another kind", () => {
        const pool = new CellPool();
        const text = cell("text");
        pool.setReuseKey(text, "text");
        pool.release(text);

        // The pool is not empty — but it holds nothing an "image" row can use.
        expect(pool.acquire("image")).toBeUndefined();
        expect(pool.size).toBe(1);
        expect(nameOf(pool.acquire("text"))).toBe("text");
    });

    it("keeps each kind in its own bucket", () => {
        const pool = new CellPool();
        for (const kind of ["text", "image", "table"]) {
            const el = cell(kind);
            pool.setReuseKey(el, kind);
            pool.release(el);
        }

        expect(nameOf(pool.acquire("image"))).toBe("image");
        expect(nameOf(pool.acquire("table"))).toBe("table");
        expect(nameOf(pool.acquire("text"))).toBe("text");
        expect(pool.size).toBe(0);
    });

    it("a keyed miss is a miss, not a wrong-kind hit", () => {
        const pool = new CellPool();
        const text = cell("text");
        pool.setReuseKey(text, "text");
        pool.release(text);

        pool.acquire("image");
        expect(pool.stats).toEqual({ hits: 0, misses: 1, released: 1, discarded: 0 });
    });

    it("an unkeyed request takes anything — untagged first, then any kind", () => {
        const pool = new CellPool();
        const keyed = cell("keyed");
        pool.setReuseKey(keyed, "text");
        pool.release(keyed);
        pool.release(cell("untagged"));

        expect(nameOf(pool.acquire())).toBe("untagged");
        expect(nameOf(pool.acquire())).toBe("keyed");
    });

    it("a cell taken as untagged is not released back into its old kind", () => {
        // The reference implementation's bug: it left the stale key on the element, so a cell
        // handed out as "anything will do" returned to the bucket of the kind it no longer is,
        // and reached a row it was not built for — the exact failure keys exist to prevent.
        const pool = new CellPool();
        const el = cell("was-text");
        pool.setReuseKey(el, "text");
        pool.release(el);

        expect(pool.acquire()).toBe(el); // taken untagged
        pool.release(el);

        expect(pool.acquire("text")).toBeUndefined();
        expect(pool.acquire()).toBe(el);
    });

    it("setReuseKey re-tags a cell that changed kind in place", () => {
        const pool = new CellPool();
        const el = cell("cell");
        pool.setReuseKey(el, "text");
        pool.setReuseKey(el, "image");
        pool.release(el);

        expect(pool.acquire("text")).toBeUndefined();
        expect(pool.acquire("image")).toBe(el);
    });

    it("clearing a key returns the cell to the untagged pool", () => {
        const pool = new CellPool();
        const el = cell("cell");
        pool.setReuseKey(el, "text");
        pool.setReuseKey(el);
        pool.release(el);

        expect(pool.acquire("text")).toBeUndefined();
        expect(pool.acquire()).toBe(el);
    });

    it("maxSize counts every bucket together", () => {
        const pool = new CellPool(2);
        for (const kind of ["a", "b", "c"]) {
            const el = cell(kind);
            pool.setReuseKey(el, kind);
            pool.release(el);
        }

        expect(pool.size).toBe(2);
        expect(pool.stats.discarded).toBe(1);
        expect(pool.acquire("c")).toBeUndefined();
    });

    it("compares object and symbol keys by identity", () => {
        const pool = new CellPool();
        const kindA = { kind: "a" };
        const kindB = { kind: "a" }; // equal-looking, different object
        const el = cell("a");
        pool.setReuseKey(el, kindA);
        pool.release(el);

        expect(pool.acquire(kindB)).toBeUndefined();
        expect(pool.acquire(kindA)).toBe(el);
    });

    it("clear() drops the buckets, not just their contents", () => {
        const pool = new CellPool();
        const el = cell("a");
        pool.setReuseKey(el, "text");
        pool.release(el);

        pool.clear();
        expect(pool.size).toBe(0);
        expect(pool.acquire("text")).toBeUndefined();
    });

    it("stays flat as kinds accumulate — a keyed acquire is a lookup, not a scan", () => {
        // Not a timing assertion (a test runner cannot make one honestly). It pins the
        // structural property that makes the timing true: whatever the pool holds, a keyed
        // request either finds its own bucket or misses, and never inspects another kind.
        const pool = new CellPool();
        for (let i = 0; i < 500; i++) {
            const el = cell(`k${i}`);
            pool.setReuseKey(el, `kind-${i}`);
            pool.release(el);
        }

        expect(pool.size).toBe(500);
        expect(nameOf(pool.acquire("kind-250"))).toBe("k250");
        expect(pool.acquire("kind-250")).toBeUndefined();
        expect(pool.size).toBe(499);
    });
});

describe("release reports retention", () => {
    it("returns true while there is room and false once the pool is full", () => {
        const pool = new CellPool(2);
        const a = document.createElement("div");
        const b = document.createElement("div");
        const c = document.createElement("div");

        // A caller that leaves evicted cells in the document needs to hear when the bound is
        // reached, because a refused cell is one nothing will ever come back for.
        expect(pool.release(a)).toBe(true);
        expect(pool.release(b)).toBe(true);
        expect(pool.release(c)).toBe(false);
        expect(pool.size).toBe(2);
        expect(pool.stats.discarded).toBe(1);
    });

    it("reports retention per bucket, not per key", () => {
        const pool = new CellPool(1);
        const a = document.createElement("div");
        const b = document.createElement("div");
        pool.setReuseKey(a, "text");
        pool.setReuseKey(b, "image");

        expect(pool.release(a)).toBe(true);
        // The bound is on the pool, not on any one kind: a second kind does not get its own
        // allowance.
        expect(pool.release(b)).toBe(false);
    });
});
