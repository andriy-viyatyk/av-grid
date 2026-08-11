/**
 * A menu — the third thing to open into a `Popover`, after the filter body and the cell
 * dropdown.
 *
 * ```js
 * const picked = await showMenu({
 *     anchor: { x: e.clientX, y: e.clientY },
 *     items: [
 *         { label: "Copy", icon: copyIcon, hotKey: "(Ctrl+C)", onClick: () => grid.copySelection() },
 *         { label: "Delete row", icon: deleteIcon, startGroup: true, onClick: () => grid.deleteSelectedRows() },
 *     ],
 * });
 * ```
 *
 * The promise resolves with the item that ran, or `undefined` if the menu was dismissed — so a
 * caller can await the outcome without threading a callback through every item.
 *
 * Ported from `uikit/Menu/`, whose behaviour is worth keeping exactly: hover opens a submenu
 * after a delay, a click opens it at once, arrow keys move a highlight that is *not* the
 * hover, and a menu longer than twenty items grows a search box. Two things are different.
 *
 * **It is not virtualized.** `VirtualList` exists and was not used: a menu is a list of
 * actions, tens of them at the outside, and every row differs from the next — icon, hotkey,
 * check, submenu chevron. Pooling elements whose content is not uniform buys nothing and costs
 * the ability to write each row once and leave it alone.
 *
 * **Escape closes the whole chain, not one level.** The reference had the same document
 * listener per level and the same outcome; here it is explicit, because `Popover` owns the
 * Escape handling and the outermost popover's listener was installed first, so it wins the
 * capture phase. A submenu is still closed on its own by ArrowLeft, which is the key a
 * keyboard user reaches for.
 */

import type { MenuItem, Point } from "../types";
import { chevronRightIcon, checkIcon } from "./icons";
import { Popover, type PopoverPlacement } from "./Popover";

/** Above this many items the menu grows a search box, as the reference does. */
export const MENU_SEARCH_THRESHOLD = 20;
/** How long the pointer must rest on an item before its submenu opens. */
export const MENU_SUBMENU_DELAY_MS = 400;
/**
 * The reference's `ROW_HEIGHT`, and it has to stay in step with `.avg-menu-item`'s `height` in
 * the stylesheet — this is only how many rows a PageDown moves, so a mismatch does not break
 * anything visible, it just makes the key jump by the wrong amount.
 */
const MENU_ROW_HEIGHT = 26;

export interface MenuOptions {
    /** An element, or a point in viewport coordinates — a context menu uses the point. */
    anchor: Element | Point;
    items: MenuItem[];
    /** Default `"bottom-start"`, which for a point means "down and to the right". */
    placement?: PopoverPlacement;
    offset?: [number, number];
    /** Added to the popover root, on top of `avg-popover avg-menu`. */
    className?: string;
    document?: Document;
}

interface PreparedItem {
    item: MenuItem;
    id: string;
    el: HTMLElement;
}

/**
 * Open a menu and resolve when it closes — with the item that was picked, or `undefined`.
 *
 * Prefer this to `new Menu(...)`: a menu that outlives the gesture that opened it has nothing
 * to hold on to, and the promise is the whole contract.
 */
export function showMenu(options: MenuOptions): Promise<MenuItem | undefined> {
    return new Menu(options).show();
}

export class Menu {
    private readonly options: MenuOptions;
    private readonly doc: Document;
    private readonly popover: Popover<MenuItem>;
    /** The scrolling list. Rows go here; the search box, when there is one, sits above it. */
    private readonly list: HTMLDivElement;
    private readonly search?: HTMLInputElement;

    private prepared: PreparedItem[] = [];
    private activeId?: string;
    /** The open submenu, and the item it belongs to — one at a time, as in a native menu. */
    private submenu?: { item: MenuItem; menu: Menu };
    private submenuTimer?: number;
    /** The menu this one hangs off, when it is a submenu. Set by the parent, after `new`. */
    private submenuOf?: Menu;

    constructor(options: MenuOptions) {
        this.options = options;
        this.doc =
            options.document ??
            (options.anchor instanceof Element ? options.anchor.ownerDocument : document);

        this.popover = new Popover<MenuItem>({
            anchor: options.anchor,
            placement: options.placement ?? "bottom-start",
            offset: options.offset ?? [0, 2],
            className: `avg-menu${options.className ? ` ${options.className}` : ""}`,
            // A click in a submenu lands outside the parent's root, and would otherwise close
            // the parent out from under the submenu the user is aiming at.
            ignoreOutside: ".avg-menu",
            document: this.doc,
        });

        const visible = options.items.filter((i) => !i.invisible);
        if (visible.length > MENU_SEARCH_THRESHOLD) {
            this.search = this.doc.createElement("input");
            this.search.className = "avg-list-search avg-menu-search";
            this.search.type = "text";
            this.search.placeholder = "Search...";
            this.search.addEventListener("input", this.onSearchInput);
            this.popover.content.appendChild(this.search);
        }

        this.list = this.doc.createElement("div");
        this.list.className = "avg-menu-list";
        this.popover.content.appendChild(this.list);

        this.popover.root.addEventListener("keydown", this.onKeyDown);
        this.build();
    }

    get isOpen(): boolean {
        return this.popover.isOpen;
    }

    /** Mount the menu, and resolve when it closes. */
    show(): Promise<MenuItem | undefined> {
        const closed = this.popover.show().then((picked) => {
            this.teardown();
            return picked;
        });
        // Focus what the keys should go to. `Popover` focused its root, which handles them too,
        // but a search box the user cannot type into is worse than no search box.
        this.search?.focus({ preventScroll: true });
        return closed;
    }

    /** Close the menu, resolving `show()` with `item` — `undefined` for a dismissal. */
    close = (item?: MenuItem): void => {
        this.popover.close(item);
    };

    // =========================================================================================
    // Rows
    // =========================================================================================

    /**
     * Build every row that survives the search, in one pass.
     *
     * Rebuilt rather than reconciled when the search text changes: a menu is small, and the
     * alternative is a diff against the previous item list for no measurable gain.
     */
    private build(): void {
        this.closeSubmenu();
        this.list.textContent = "";
        this.prepared = [];

        const query = this.search?.value.trim().toLocaleLowerCase() ?? "";
        const hasIcon = this.options.items.some((i) => !i.invisible && Boolean(i.icon));
        // An invisible or filtered-out item carrying `startGroup` passes the separator to the
        // next item that is shown — otherwise hiding an item silently merges two groups.
        let pendingGroup = false;

        this.options.items.forEach((item, index) => {
            const shown =
                !item.invisible &&
                (!query || item.label.toLocaleLowerCase().includes(query));
            if (!shown) {
                if (item.startGroup) pendingGroup = true;
                return;
            }

            const id = item.id ?? `${index}:${item.label}`;
            const el = this.row(item, hasIcon);
            el.setAttribute("data-id", id);
            // Never on the first row: a separator above nothing is a line under the search box.
            if ((item.startGroup || pendingGroup) && this.prepared.length > 0) {
                el.setAttribute("data-start-group", "");
            }
            pendingGroup = false;

            this.list.appendChild(el);
            this.prepared.push({ item, id, el });
        });

        if (!this.prepared.length) {
            const empty = this.doc.createElement("div");
            empty.className = "avg-list-empty";
            empty.textContent = "No matches";
            this.list.appendChild(empty);
        }

        // Opening on the current value is how a menu of choices — a sort direction, a filter
        // type — shows the user where they are.
        const selected = this.prepared.find((p) => p.item.selected);
        this.setActive(selected?.id ?? undefined);
    }

    private row(item: MenuItem, hasIcon: boolean): HTMLElement {
        const el = this.doc.createElement("div");
        el.className = "avg-menu-item";
        el.setAttribute("data-type", "menu-item");
        if (item.disabled) el.setAttribute("data-disabled", "");
        if (item.minor) el.setAttribute("data-minor", "");

        if (hasIcon) {
            const icon = this.doc.createElement("span");
            icon.className = "avg-menu-icon";
            if (typeof item.icon === "string") icon.innerHTML = item.icon;
            else if (item.icon) icon.appendChild(item.icon);
            el.appendChild(icon);
        }

        const label = this.doc.createElement("span");
        label.className = "avg-menu-label";
        label.textContent = item.label;
        el.appendChild(label);

        if (item.hotKey) {
            const hot = this.doc.createElement("span");
            hot.className = "avg-menu-hotkey";
            hot.textContent = item.hotKey;
            el.appendChild(hot);
        }

        if (item.items?.length) {
            const chevron = this.doc.createElement("span");
            chevron.className = "avg-menu-chevron";
            chevron.innerHTML = chevronRightIcon;
            el.appendChild(chevron);
        } else if (item.selected) {
            const check = this.doc.createElement("span");
            check.className = "avg-menu-check";
            check.innerHTML = checkIcon;
            el.appendChild(check);
        }

        el.addEventListener("mouseenter", () => this.onRowEnter(item, el));
        el.addEventListener("mouseleave", this.clearSubmenuTimer);
        // `click`, not `pointerdown`: a menu row is a plain element that nothing repaints
        // underneath, so the invariant that forces the grid's in-cell affordances onto the
        // press does not apply — and a press-activated menu fires on the same press that
        // opened it when a menu is opened from a pointerdown.
        el.addEventListener("click", () => this.activate(item, el));
        return el;
    }

    // =========================================================================================
    // Activation and submenus
    // =========================================================================================

    private activate(item: MenuItem, anchor: HTMLElement): void {
        if (item.disabled) return;
        if (item.items?.length) {
            this.openSubmenu(item, anchor);
            return;
        }
        // Run first, close second: an item that reads the grid's selection must see it before
        // the popover restores focus to whatever was focused when the menu opened.
        item.onClick?.();
        this.close(item);
    }

    private onRowEnter(item: MenuItem, el: HTMLElement): void {
        if (item.disabled) return;
        this.setActive(el.getAttribute("data-id") ?? undefined);
        this.clearSubmenuTimer();
        if (this.submenu && this.submenu.item !== item) this.closeSubmenu();
        if (!item.items?.length || this.submenu?.item === item) return;
        this.submenuTimer = this.doc.defaultView?.setTimeout(() => {
            this.submenuTimer = undefined;
            this.openSubmenu(item, el);
        }, MENU_SUBMENU_DELAY_MS);
    }

    private openSubmenu(item: MenuItem, anchor: HTMLElement): void {
        this.clearSubmenuTimer();
        if (this.submenu?.item === item) return;
        this.closeSubmenu();

        const menu = new Menu({
            anchor,
            items: item.items ?? [],
            placement: "right-start",
            offset: [-4, 0],
            document: this.doc,
        });
        menu.submenuOf = this;
        this.submenu = { item, menu };
        anchor.setAttribute("data-submenu-open", "");

        menu.show().then((picked) => {
            anchor.removeAttribute("data-submenu-open");
            if (this.submenu?.menu === menu) this.submenu = undefined;
            // A pick in a submenu closes the whole chain: the action has run, and leaving the
            // parent standing would invite a second one.
            if (picked) this.close(picked);
        });
    }

    private closeSubmenu(): void {
        this.clearSubmenuTimer();
        const open = this.submenu;
        this.submenu = undefined;
        open?.menu.close();
    }

    private clearSubmenuTimer = (): void => {
        if (this.submenuTimer === undefined) return;
        this.doc.defaultView?.clearTimeout(this.submenuTimer);
        this.submenuTimer = undefined;
    };

    // =========================================================================================
    // Keyboard
    // =========================================================================================

    /**
     * The highlight the arrow keys move, which is deliberately the same visual state as hover:
     * a user who moves the pointer and then the keys should see one highlight, not two.
     */
    private setActive(id: string | undefined): void {
        if (this.activeId === id) return;
        for (const p of this.prepared) {
            if (p.id === this.activeId) p.el.removeAttribute("data-active");
            if (p.id === id) p.el.setAttribute("data-active", "");
        }
        this.activeId = id;
        if (id === undefined) return;
        const active = this.prepared.find((p) => p.id === id);
        active?.el.scrollIntoView?.({ block: "nearest" });
    }

    private move(step: number): void {
        if (!this.prepared.length) return;
        const from = this.prepared.findIndex((p) => p.id === this.activeId);
        const next = Math.max(
            0,
            Math.min(this.prepared.length - 1, (from < 0 ? -1 : from) + step),
        );
        this.setActive(this.prepared[next].id);
    }

    private onKeyDown = (e: KeyboardEvent): void => {
        // A submenu is open and has the focus; its own handler owns the keys.
        if (this.submenu) return;

        const page = Math.max(
            1,
            Math.floor((this.list.clientHeight || MENU_ROW_HEIGHT * 8) / MENU_ROW_HEIGHT),
        );
        const active = this.prepared.find((p) => p.id === this.activeId);

        switch (e.key) {
            case "ArrowDown":
                e.preventDefault();
                this.move(1);
                return;
            case "ArrowUp":
                e.preventDefault();
                this.move(-1);
                return;
            case "PageDown":
                e.preventDefault();
                this.move(page);
                return;
            case "PageUp":
                e.preventDefault();
                this.move(-page);
                return;
            case "Home":
                if (this.search) return;
                e.preventDefault();
                this.setActive(this.prepared[0]?.id);
                return;
            case "End":
                if (this.search) return;
                e.preventDefault();
                this.setActive(this.prepared[this.prepared.length - 1]?.id);
                return;
            case "ArrowRight": {
                if (!active?.item.items?.length) return;
                e.preventDefault();
                this.openSubmenu(active.item, active.el);
                return;
            }
            // One level, unlike Escape, which `Popover` handles and which takes the chain with
            // it — a keyboard user who opened a submenu by mistake wants the parent back.
            case "ArrowLeft":
                if (!this.submenuOf) return;
                e.preventDefault();
                this.close();
                return;
            case "Enter": {
                // A search narrowed to one row activates it without an arrow key first, which
                // is what makes the search box worth having.
                const target =
                    active ?? (this.prepared.length === 1 ? this.prepared[0] : undefined);
                if (!target) return;
                e.preventDefault();
                this.activate(target.item, target.el);
                return;
            }
            default:
                return;
        }
    };

    private onSearchInput = (): void => {
        this.build();
        // The row count changed, so the height the popover was placed against did too.
        this.popover.reposition();
    };

    // =========================================================================================
    // Teardown
    // =========================================================================================

    private teardown(): void {
        this.closeSubmenu();
        this.popover.root.removeEventListener("keydown", this.onKeyDown);
        this.search?.removeEventListener("input", this.onSearchInput);
        this.list.textContent = "";
        this.prepared = [];
    }
}
