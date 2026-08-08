/**
 * A typed one-to-many event channel.
 *
 * Ported from Persephone's `core/state/events.ts`, which was already framework-free. The
 * `EventTarget`/`CustomEvent` plumbing underneath is dropped: it forced every payload
 * through a `detail` box and made the callback signature `(detail?: D) => void` — optional
 * even when the sender always sends a value. A plain listener array is smaller, faster, and
 * types the payload as non-optional.
 *
 * Used by `AVGridEvents` and `AVGridData` for their change notifications.
 */

export type SubscriptionCallback<D> = (data: D) => void;

export interface SubscriptionHandle {
    unsubscribe: () => void;
}

export class Subscription<D = void> {
    private listeners: Array<SubscriptionCallback<D>> = [];

    send = (data: D): void => {
        // Iterate a copy: a listener may unsubscribe while being notified.
        const listeners = this.listeners.slice();
        for (const listener of listeners) {
            listener(data);
        }
    };

    subscribe = (callback: SubscriptionCallback<D>): SubscriptionHandle => {
        this.listeners.push(callback);
        let active = true;
        return {
            unsubscribe: () => {
                if (!active) return;
                active = false;
                const i = this.listeners.indexOf(callback);
                if (i >= 0) this.listeners.splice(i, 1);
            },
        };
    };

    /** Drop every listener. Called from `grid.destroy()`. */
    clear = (): void => {
        this.listeners = [];
    };

    get listenerCount(): number {
        return this.listeners.length;
    }
}
