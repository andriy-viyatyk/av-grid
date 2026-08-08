/**
 * The reactive primitive the whole library is built on.
 *
 * Replaces Persephone's `TComponentModel` / `TComponentState` pair (zustand + immer +
 * React hooks) with something that has no dependencies and no framework. The models'
 * *logic* never cared where the change notification went — only that one was sent.
 *
 * Two deliberate differences from the reference:
 *
 * 1. **No selectors.** The reference used `state.use(selector)` so React could re-render
 *    narrowly. Here the render layer's dirty set (`RerenderInfo`) does that job far more
 *    precisely, so a subscriber just gets told "something changed" and consults the state.
 *
 * 2. **`update()` shallow-clones instead of running immer's `produce()`.** The top-level
 *    state object identity changes on every update; nested objects keep their identity and
 *    are mutated in place. Nothing in the grid compares nested state deeply — repaints are
 *    driven by explicit `RerenderInfo`, never by diffing — so structural sharing buys
 *    nothing here and costs a dependency.
 */

export type Unsubscribe = () => void;

export type Listener<T> = (state: Readonly<T>) => void;

/** A value or a function of the previous value. Mirrors React's `SetStateAction`. */
export type StateUpdate<T> = T | ((prev: Readonly<T>) => T);

export function resolveStateUpdate<T>(
    update: StateUpdate<T>,
    prev: Readonly<T>,
): T {
    return typeof update === "function"
        ? (update as (prev: Readonly<T>) => T)(prev)
        : update;
}

export class Observable<T extends object> {
    private _state: T;
    private readonly _defaultState: T;
    private _listeners: Array<Listener<T>> = [];

    /** Pending notification scheduled on the microtask queue. */
    private _notifyScheduled = false;
    /** Depth of open `batch()` calls; notification is held until it returns to 0. */
    private _batchDepth = 0;
    private _disposed = false;

    constructor(defaultState: T) {
        this._defaultState = defaultState;
        this._state = defaultState;
    }

    /** The current state. Treat it as immutable — go through `set` / `update` to change it. */
    get state(): Readonly<T> {
        return this._state;
    }

    get(): Readonly<T> {
        return this._state;
    }

    /** Replace the state wholesale, or map the previous state to a new one. */
    set = (update: StateUpdate<T>): void => {
        if (this._disposed) return;
        const next = resolveStateUpdate(update, this._state);
        if (next === this._state) return;
        this._state = next;
        this.notify();
    };

    /**
     * Mutate a shallow copy of the state. The mutator receives a draft whose top level is
     * safe to assign to; nested objects are shared with the previous state (see the note
     * at the top of this file).
     */
    update = (mutator: (draft: T) => void): void => {
        if (this._disposed) return;
        const draft = { ...this._state };
        mutator(draft);
        this._state = draft;
        this.notify();
    };

    /** Reset to the state the observable was constructed with. */
    clear = (): void => {
        this.set(this._defaultState);
    };

    subscribe = (listener: Listener<T>): Unsubscribe => {
        this._listeners.push(listener);
        let active = true;
        return () => {
            if (!active) return;
            active = false;
            const i = this._listeners.indexOf(listener);
            if (i >= 0) this._listeners.splice(i, 1);
        };
    };

    /**
     * Run `fn`, holding all notifications until it returns — however many `update()` calls
     * it makes, subscribers are notified once. Nests safely.
     */
    batch = <R>(fn: () => R): R => {
        this._batchDepth++;
        try {
            return fn();
        } finally {
            this._batchDepth--;
            if (this._batchDepth === 0 && this._notifyScheduled) {
                this.flush();
            }
        }
    };

    /**
     * Deliver any pending notification immediately instead of on the next microtask.
     * Used by tests and by code paths that must observe the effect of an update
     * synchronously.
     */
    flush = (): void => {
        if (!this._notifyScheduled || this._batchDepth > 0) return;
        this._notifyScheduled = false;
        if (this._disposed) return;
        // Iterate a copy: a listener may subscribe or unsubscribe while being notified.
        const listeners = this._listeners.slice();
        for (const listener of listeners) {
            listener(this._state);
        }
    };

    /** Drop all subscribers and ignore further updates. */
    dispose = (): void => {
        this._disposed = true;
        this._notifyScheduled = false;
        this._listeners = [];
    };

    get disposed(): boolean {
        return this._disposed;
    }

    /**
     * Coalesce notifications: many updates in one tick produce exactly one listener call.
     * This is the reason a range-selection drag can touch the model dozens of times per
     * frame without costing anything.
     */
    private notify(): void {
        if (this._notifyScheduled) return;
        this._notifyScheduled = true;
        if (this._batchDepth > 0) return;
        queueMicrotask(() => this.flush());
    }
}

/**
 * Base class for the grid's models. Owns an `Observable` rather than extending it, so a
 * model's own methods and its state's methods never collide.
 */
export class Model<T extends object> {
    readonly state: Observable<T>;

    constructor(defaultState: T) {
        this.state = new Observable<T>(defaultState);
    }

    dispose(): void {
        this.state.dispose();
    }
}
