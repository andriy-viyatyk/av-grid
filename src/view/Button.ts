/**
 * The two buttons the filter UI needs, and nothing else.
 *
 * UIKit's `Button` / `IconButton` carry variants, sizes, loading states, icons on either side
 * and a theme object. What the grid actually renders is "Apply", "Clear" and a funnel — so this
 * is a pair of element factories rather than a component.
 *
 * They carry **no listener**. A button here lives inside a popover, which is not pooled, so
 * binding one would be safe — but the house rule is that a click is resolved from a root by
 * `data-*`, and keeping one rule means one teardown. See the third invariant in `CLAUDE.md`.
 */

export function createButton(
    label: string,
    action: string,
    options?: { primary?: boolean; title?: string },
): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `avg-button${options?.primary ? " avg-button-primary" : ""}`;
    button.setAttribute("data-action", action);
    button.textContent = label;
    if (options?.title) button.title = options.title;
    return button;
}

export function createIconButton(
    icon: string,
    action: string,
    options?: { title?: string; className?: string },
): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `avg-icon-button${options?.className ? ` ${options.className}` : ""}`;
    button.setAttribute("data-action", action);
    button.innerHTML = icon;
    if (options?.title) button.title = options.title;
    return button;
}
