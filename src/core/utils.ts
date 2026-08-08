/**
 * The handful of helpers AVGrid and RenderGrid actually import from Persephone's
 * `core/utils/*` and `shared/utils.ts`. Nothing else from those files is ported — most of
 * what lives there is application code the grid never touches.
 *
 * Traced from the reference's imports:
 * - `isNullOrUndefined` — avGridUtils.ts, useFilters.tsx
 * - `range`            — ColumnsModel.ts
 * - `toClipboard`      — CopyPasteModel.ts
 * - `memorize`         — avGridUtils.ts, RenderFlexGrid.tsx
 * - `debounce`         — RenderFlexGrid.tsx
 */

export const isNullOrUndefined = (v: unknown): v is null | undefined =>
    v === null || v === undefined;

/** Inclusive integer range, in ascending order whichever way round the bounds are given. */
export const range = (from: number, to: number): number[] =>
    from <= to
        ? Array.from({ length: to - from + 1 }, (_, i) => from + i)
        : Array.from({ length: from - to + 1 }, (_, i) => to + i);

/**
 * Write plain text to the system clipboard.
 *
 * Returns the promise rather than swallowing it (the reference ignored it) — the clipboard
 * API rejects when the document is not focused or permission is denied, and a copy that
 * silently did nothing is exactly the kind of failure that wastes an agent's debugging time.
 */
export function toClipboard(text: string): Promise<void> {
    return navigator.clipboard.writeText(text);
}

export function debounce<T extends (...args: never[]) => void>(
    func: T,
    delay: number,
    canRun?: () => boolean,
): ((...args: Parameters<T>) => void) & { cancel: () => void } {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const debounced = (...args: Parameters<T>) => {
        const run = () => {
            if (!canRun || canRun()) {
                func(...args);
                return;
            }
            // Not ready yet — keep waiting rather than dropping the call.
            timeoutId = setTimeout(run, delay);
        };

        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(run, delay);
    };

    // `destroy()` must be able to release every pending timer.
    debounced.cancel = () => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = null;
    };

    return debounced;
}

/**
 * Cache a function's results, keyed by a JSON serialization of its arguments.
 *
 * `shouldMemorize` decides whether a given result is worth keeping — used to avoid caching
 * failures. If it returns a promise (because the memorized function is async), the result is
 * cached only once that promise resolves true.
 *
 * Note the key is `JSON.stringify(args)`: arguments must be serializable, and this is not
 * suitable for a hot path. The reference used it only for column-metadata lookups.
 */
export const memorize = <F extends (...args: never[]) => unknown>(
    f: F,
    shouldMemorize?: (result: ReturnType<F>) => boolean | Promise<boolean>,
): F & { clear: () => void } => {
    const resultMap = new Map<string, unknown>();

    const func = ((...args: Parameters<F>) => {
        const key = JSON.stringify(args);
        if (resultMap.has(key)) {
            return resultMap.get(key);
        }

        const result = f(...args);
        const canMemorize = !shouldMemorize || shouldMemorize(result as ReturnType<F>);
        if (canMemorize instanceof Promise) {
            canMemorize.then((can) => {
                if (can) resultMap.set(key, result);
            });
        } else if (canMemorize) {
            resultMap.set(key, result);
        }
        return result;
    }) as unknown as F & { clear: () => void };

    Object.defineProperty(func, "length", { get: () => f.length });
    func.clear = () => resultMap.clear();

    return func;
};
