/**
 * A reference that can also be awaited.
 *
 * Ported from `RenderGrid/AsyncRef.ts`. It exists so imperative calls can run before the DOM
 * is ready: `grid.scrollToRow(50_000)` issued immediately after `create()` awaits the
 * container rather than silently doing nothing. Once a value is set, `async` is an
 * already-resolved promise, so awaiting costs a microtask and nothing more.
 *
 * **Fixed during the port — the reference version never resolved its first promise.** There,
 * `async`'s class-field initializer installed `resolveAsync`, and then the constructor *body*
 * ran `this.resolveAsync = undefined` and wiped it (field initializers run before the
 * constructor body). The first `ref()` therefore took the `else` branch and *replaced*
 * `async` with a fresh promise — so any caller that had already captured `async` waited
 * forever. Building the promise in the constructor body, after the reset, is the whole fix.
 */
export class AsyncRef<T> {
    current: T;
    /** Resolves the initial `async` promise; cleared once used. */
    private resolveAsync: ((v: T) => void) | undefined;
    async: Promise<T>;

    constructor(initialValue: T) {
        this.current = initialValue;
        this.async = new Promise<T>((resolve) => {
            this.resolveAsync = (value: T) => {
                this.resolveAsync = undefined;
                resolve(value);
            };
        });
    }

    /** Set the value. Falsy values are ignored — the ref only ever moves to something real. */
    ref = (value: T | null) => {
        if (value && this.current !== value) {
            this.current = value;
            if (this.resolveAsync) {
                this.resolveAsync(value);
            } else {
                this.async = Promise.resolve(value);
            }
        }
    };
}
