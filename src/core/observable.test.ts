import { describe, expect, it, vi } from "vitest";
import { Model, Observable } from "./observable";

interface TestState {
    count: number;
    nested: { label: string };
}

const makeState = (): TestState => ({ count: 0, nested: { label: "a" } });

describe("Observable", () => {
    it("exposes the state it was constructed with", () => {
        const o = new Observable(makeState());
        expect(o.get().count).toBe(0);
        expect(o.state.nested.label).toBe("a");
    });

    it("replaces state with set, accepting a value or a mapper", () => {
        const o = new Observable(makeState());

        o.set({ count: 5, nested: { label: "b" } });
        expect(o.get().count).toBe(5);

        o.set((prev) => ({ ...prev, count: prev.count + 1 }));
        expect(o.get().count).toBe(6);
    });

    it("gives update a draft and swaps the top-level identity", () => {
        const o = new Observable(makeState());
        const before = o.get();

        o.update((s) => {
            s.count = 3;
        });

        expect(o.get().count).toBe(3);
        expect(o.get()).not.toBe(before);
        // The reference used immer; we shallow-clone. Nested identity is shared by design.
        expect(o.get().nested).toBe(before.nested);
    });

    describe("batching", () => {
        it("coalesces many updates in one tick into a single notification", async () => {
            const o = new Observable(makeState());
            const listener = vi.fn();
            o.subscribe(listener);

            o.update((s) => {
                s.count = 1;
            });
            o.update((s) => {
                s.count = 2;
            });
            o.set((prev) => ({ ...prev, count: 3 }));

            // Nothing has fired yet — notification is deferred to the microtask queue.
            expect(listener).not.toHaveBeenCalled();

            await Promise.resolve();

            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener).toHaveBeenCalledWith(o.get());
            expect(o.get().count).toBe(3);
        });

        it("notifies again on the next tick", async () => {
            const o = new Observable(makeState());
            const listener = vi.fn();
            o.subscribe(listener);

            o.update((s) => {
                s.count = 1;
            });
            await Promise.resolve();
            o.update((s) => {
                s.count = 2;
            });
            await Promise.resolve();

            expect(listener).toHaveBeenCalledTimes(2);
        });

        it("holds notification until an explicit batch() returns, then sends one", () => {
            const o = new Observable(makeState());
            const listener = vi.fn();
            o.subscribe(listener);

            o.batch(() => {
                o.update((s) => {
                    s.count = 1;
                });
                o.update((s) => {
                    s.count = 2;
                });
                expect(listener).not.toHaveBeenCalled();
            });

            expect(listener).toHaveBeenCalledTimes(1);
            expect(o.get().count).toBe(2);
        });

        it("nests batch() safely, notifying only when the outermost returns", () => {
            const o = new Observable(makeState());
            const listener = vi.fn();
            o.subscribe(listener);

            o.batch(() => {
                o.update((s) => {
                    s.count = 1;
                });
                o.batch(() => {
                    o.update((s) => {
                        s.count = 2;
                    });
                });
                expect(listener).not.toHaveBeenCalled();
            });

            expect(listener).toHaveBeenCalledTimes(1);
        });

        it("returns the batch callback's value", () => {
            const o = new Observable(makeState());
            expect(o.batch(() => "done")).toBe("done");
        });

        it("does not notify when set() is given the identical state object", async () => {
            const o = new Observable(makeState());
            const listener = vi.fn();
            o.subscribe(listener);

            o.set(o.get() as TestState);
            await Promise.resolve();

            expect(listener).not.toHaveBeenCalled();
        });

        it("flush() delivers the pending notification synchronously", () => {
            const o = new Observable(makeState());
            const listener = vi.fn();
            o.subscribe(listener);

            o.update((s) => {
                s.count = 1;
            });
            o.flush();

            expect(listener).toHaveBeenCalledTimes(1);
        });

        it("flush() is a no-op when nothing is pending", () => {
            const o = new Observable(makeState());
            const listener = vi.fn();
            o.subscribe(listener);

            o.flush();
            o.flush();

            expect(listener).not.toHaveBeenCalled();
        });
    });

    describe("subscribe", () => {
        it("notifies every subscriber", () => {
            const o = new Observable(makeState());
            const a = vi.fn();
            const b = vi.fn();
            o.subscribe(a);
            o.subscribe(b);

            o.update((s) => {
                s.count = 1;
            });
            o.flush();

            expect(a).toHaveBeenCalledTimes(1);
            expect(b).toHaveBeenCalledTimes(1);
        });

        it("stops notifying after unsubscribe", () => {
            const o = new Observable(makeState());
            const listener = vi.fn();
            const unsubscribe = o.subscribe(listener);

            unsubscribe();
            o.update((s) => {
                s.count = 1;
            });
            o.flush();

            expect(listener).not.toHaveBeenCalled();
        });

        it("is safe to call unsubscribe twice", () => {
            const o = new Observable(makeState());
            const a = vi.fn();
            const b = vi.fn();
            const unsubscribeA = o.subscribe(a);
            o.subscribe(b);

            unsubscribeA();
            unsubscribeA();

            o.update((s) => {
                s.count = 1;
            });
            o.flush();

            // The second call must not have removed an unrelated listener.
            expect(a).not.toHaveBeenCalled();
            expect(b).toHaveBeenCalledTimes(1);
        });

        it("tolerates a listener unsubscribing during notification", () => {
            const o = new Observable(makeState());
            const b = vi.fn();
            const unsubscribeA: { current?: () => void } = {};
            const a = vi.fn(() => unsubscribeA.current?.());
            unsubscribeA.current = o.subscribe(a);
            o.subscribe(b);

            o.update((s) => {
                s.count = 1;
            });
            o.flush();

            expect(a).toHaveBeenCalledTimes(1);
            expect(b).toHaveBeenCalledTimes(1);
        });
    });

    describe("clear and dispose", () => {
        it("clear() restores the constructed state", () => {
            const o = new Observable(makeState());
            o.update((s) => {
                s.count = 9;
            });
            o.clear();
            expect(o.get().count).toBe(0);
        });

        it("dispose() drops subscribers and ignores further updates", () => {
            const o = new Observable(makeState());
            const listener = vi.fn();
            o.subscribe(listener);

            o.dispose();
            o.update((s) => {
                s.count = 1;
            });
            o.flush();

            expect(listener).not.toHaveBeenCalled();
            expect(o.get().count).toBe(0);
            expect(o.disposed).toBe(true);
        });

        it("does not deliver a notification queued before dispose()", async () => {
            const o = new Observable(makeState());
            const listener = vi.fn();
            o.subscribe(listener);

            o.update((s) => {
                s.count = 1;
            });
            o.dispose();
            await Promise.resolve();

            expect(listener).not.toHaveBeenCalled();
        });
    });
});

describe("Model", () => {
    it("owns an observable and disposes it", () => {
        const model = new Model(makeState());
        const listener = vi.fn();
        model.state.subscribe(listener);

        model.state.update((s) => {
            s.count = 1;
        });
        model.state.flush();
        expect(listener).toHaveBeenCalledTimes(1);

        model.dispose();
        expect(model.state.disposed).toBe(true);
    });
});
