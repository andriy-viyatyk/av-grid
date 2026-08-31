# av-grid — Implementation Plan 04: Persephone consolidation — EPIC-079 (tasks 33–37)

**Active.** Phase 8. Three tasks, all driven by **one consumer**: Persephone is retiring its
**fork** of this engine (`src/renderer/uikit/VirtualGrid/`, ~2,800 lines) and moving its remaining
consumers onto av-grid's `RenderGrid`. Two capabilities exist only in the fork and have to come
across as first-class library features; one engine defect exists in both and has to be fixed here.

The epic is `C:\projects\persephone\doc\epics\EPIC-079.md` — read-only, and the best single source
for why this phase exists. [`goal.md`](goal.md) is the *what* and *why* of the project; this
document is the *in what order*, with a definition of done for each step.

**How to use this document:** work one task at a time, top to bottom. A task is finished only when
every line in its **Done when** list is true. Update the **Status** column as you go, and record
any decision that changes the plan in *Decision log* at the bottom rather than silently diverging.

**Before starting any task here, read the decision logs in
[`plan-done-01.md`](plan-done-01.md), [`plan-done-02.md`](plan-done-02.md) and
[`plan-done-03.md`](plan-done-03.md).** They record every deliberate divergence from the Persephone
reference, several reference bugs that were fixed rather than carried over, and the traps that cost
a debugging session each. Three are directly relevant to this phase:

- *"The pool is reached through a `recycle` hook threaded from the shell to `renderCell`"* (task 4)
  — the thread this phase widens.
- *"`previous` added to `RenderCellParams`"* (task 5) — 12× on full repaints, and the reason a
  keyed pool must not disturb the `previous` path.
- *"Pooling elements whose content is not uniform buys nothing"* (polish, on `Menu`) — the exact
  problem task 33 fixes, one level down.

Reference paths and the read-only rule: [`../CLAUDE.md`](../CLAUDE.md). Restated because this phase
is *about* Persephone and the temptation to "just fix it on both sides" is real:

> **Persephone is a read-only reference.** Never modify anything under `C:\projects\persephone`.
> Read from it freely; write only inside `C:\projects\av-grid`.

**The fork is not a specification.** Plans 01–03 ported from a *React* original, where every
difference was a difference of framework. This phase ports from a **drifted copy of av-grid's own
code** — 13 differing lines in `renderInfo.ts`, 15 in `rerender-check.ts` — so the question for
every difference is a new one: *is this part of the feature, or is it drift?* Answer it explicitly
for each, in the decision log. Carrying drift across is the failure mode of this phase.

---

## Task tracker

| # | Task | Phase | Status |
|---|------|-------|--------|
| 1–20 | The port | see [`plan-done-01.md`](plan-done-01.md) | ✅ Done |
| 21–26 | Customization | see [`plan-done-02.md`](plan-done-02.md) | ✅ Done |
| 27–32 | The adoption gaps | see [`plan-done-03.md`](plan-done-03.md) | ✅ Done |
| 33 | Keyed cell pool — `setReuseKey` (Persephone US-1234) | Consolidation | ✅ Done |
| 34 | Measured row heights over `RenderGridModel` (US-1235), plus `RerenderInfo.fromRow` | Consolidation | ✅ Done |
| 35 | The scroll-loss defect, and re-measuring `scrollLost` (US-1236) | Consolidation | ✅ Done |
| 36 | After-paint scrolling — the pending-scroll register (US-1240) | Consolidation | ✅ Done |
| 37 | `setOptions` applies shell layout (US-1241) | Consolidation | ✅ Done |

Status values: ⬜ Not started · 🟡 In progress · ✅ Done · ⏸️ Blocked (say why).

**Tasks 36 and 37 were added on 2026-08-30**, after reviewing EPIC-079's Gaps 4 and 5. They are
one piece of work: both are small, both are hard blockers for US-1237 (the `ListBox`, `Tree` and
`Autocomplete` migration), and both touch the same two files task 35 had just changed.

Order is 33 → 34 → 35. The pool first because it is the smallest and the other two do not depend
on it; the measured-height layer second because it is a new module rather than an edit; the defect
last because it needs its own measurement session and must not be tangled with a feature.

**Nothing here is a breaking change.** Every task adds a type, an optional field or a module; no
existing option default, signature or CSS selector moves. The version is bumped **once, at the end
of the epic** — not per task, and not by this plan.

---

## Standing rules for every task

Carried forward from plans 01–03 unchanged, plus two specific to this phase.

- **`npm run typecheck` passes.** Strict mode, no `any` in the public surface, no `@ts-ignore`.
- **`npm test` passes**, and each task adds the tests its neighbours have.
- **No runtime dependency is added.** Ever.
- **Verify in a browser, not only in tests.** happy-dom does no layout, so a green suite can sit on
  top of a grid that renders as a blank box.
- **After any task that touches the render path, re-run the benchmark and append a row to
  [`benchmark-results.md`](benchmark-results.md).** All three tasks here qualify: the pool, the
  row-height arithmetic and the scroll handler are each squarely on it.
- **Structural DOM gets stable `data-*` attributes.** State never goes in generated class names.
- **Write the usage snippet before the implementation** for any new public surface. If the snippet
  is awkward, fix the API first.
- **Everything reachable from `src/index.ts` is public API** and must appear in
  [`api.md`](../docs/api.md) and [`capabilities.md`](../docs/capabilities.md).
- **Phase-specific: additive only.** No existing option's default changes, no existing signature
  narrows, and no existing CSS *selector* changes what it does. A grid that passes none of the new
  surface must behave **identically**, down to the pool's hit/miss counts.
- **Phase-specific: classify every divergence from the fork** as *feature* or *drift*, in the log.
  The fork is a sibling, not an ancestor: it is allowed to be wrong, and twice already has been
  (the `scrollLost` premise, disproved by measurement in US-1232).

---

## Phase 8 — Consolidation (tasks 33–35)

### Task 33 — a keyed cell pool

**Why.** `CellPool` is one untyped bucket. That is correct for a *grid*, where every data cell is
the same shape and any element will do, and it is wrong for a **list whose rows differ**: a log
view whose entries are text, tables, images and errors, or a notebook of heterogeneous cells. There
a pooled element built for one kind is handed to a row of another, the renderer tears the inner
structure down and rebuilds it, and the reuse the pool exists for is lost precisely where it is
most expensive — a complex row costs far more to build than a `<div>` with a string in it.

So the pool needs to know that two cells are *compatible*, and only the consumer can say what that
means. The key is therefore consumer-owned and opaque to the library.

**Snippet first:**

```js
const kindOf = new WeakMap();          // cell element -> the kind it was built for

new RenderGrid(host, {
    rowCount: () => entries.length,
    columnCount: 1,
    renderCell: (p) => {
        const kind = entries[p.row].type;             // "text" | "table" | "image" | "error"

        // `previous` is still preferred — but only when it was built for this kind.
        const previous = p.previous && kindOf.get(p.previous) === kind ? p.previous : undefined;
        const cell = previous ?? p.recycle?.(kind) ?? document.createElement("div");
        p.setReuseKey?.(cell, kind);
        kindOf.set(cell, kind);

        if (cell !== previous) buildRow(cell, entries[p.row]);
        return cell;
    },
});
```

Two optional things a renderer already reaches for, one argument wider and one call longer. Both
call sites in the consumer are exactly this: `params.recycle?.(kind)` and
`params.setReuseKey?.(cell, kind)` — see `…\editors\log-view\LogBodyView.ts:72` and
`…\editors\notebook\NotebookBodyView.ts:121`.

**Design.**

- `src/render/types.ts` — three additions, no change to anything existing:

  ```ts
  export type CellReuseKey = unknown;
  export type RecycleFunc = (reuseKey?: CellReuseKey) => HTMLElement | undefined;   // was ()
  export type SetReuseKeyFunc = (element: HTMLElement, reuseKey?: CellReuseKey) => void;
  ```

  Widening `RecycleFunc`'s parameter list is source-compatible in both directions: every existing
  implementation (`() => …`) is still assignable, and every existing call (`p.recycle?.()`) still
  type-checks. `setReuseKey?: SetReuseKeyFunc` joins `recycle` on `RenderCellParams`, `RenderData`
  and `CalcRenderInfoInput`.

- `src/render/CellPool.ts` — **buckets, not a scan.** See the decision log: the reference's
  backward linear scan is *the* thing not to transliterate here.

- `src/render/renderInfo.ts` — forward `setReuseKey` beside `recycle` in `_renderCell`'s params
  object and in the `RenderData` literal. The geometry never calls it; it stays pure.

- `src/render/RenderGridModel.ts` — `setReuseKey?: SetReuseKeyFunc` on `RenderGridOptions`,
  forwarded in the `calcRenderInfo` call beside `recycle`. **Not** added to
  `RenderGridModelInput` / `inputChanged()` — see the log.

- `src/render/RenderGrid.ts` — one line: `setReuseKey: this.pool.setReuseKey` beside
  `recycle: this.pool.acquire`.

**Done when:**

- `new CellPool()` used with no key behaves exactly as today, hit/miss counts included.
- A keyed `acquire` never returns an element released under a different key.
- An unkeyed `acquire` still returns whatever is there.
- `CellPool.test.ts` covers both, plus the bucket bookkeeping (`size`, `maxSize`, `clear`).
- `RenderGrid` threads `setReuseKey` to `renderCell`; a heterogeneous renderer is exercised end to
  end in `RenderGrid.test.ts`.
- `typecheck` and `test` green; `api.md` and `capabilities.md` updated; a benchmark row appended
  and the flat-cost ratio and zero-mutation gates confirmed on the board.

### Task 34 — measured row heights ✅

**Why.** `rowHeight` takes a function, which covers every height that can be *computed*. It does
not cover one that is only knowable after layout — wrapped text of unpredictable length, a chat
bubble, a log entry with a stack trace in it. That is EPIC-079's Gap 2, and the two Persephone
editors blocked on it (`LogBodyView`, `NotebookBodyView`) are its only current consumers; the
feature itself is general, and is documented for someone who has never seen Persephone.

**Bigger than the stub, in one specific way.** The stub was right that the model seam is two
methods `RenderGridModel` already satisfies. It missed that the *shell* seam does not exist at all:
the fork's `VirtualFlexGridView` needs `onCellAttached` / `onCellReleased`, and av-grid's
`RenderGrid` has neither. And US-1238's investigation found a third gap the epic does not name —
`RerenderInfo.fromRow` — without which the layer cannot state what it means.

**Snippet first:**

```js
const grid = new MeasuredRowGrid(host, {
    rowCount: () => entries.length,
    columnCount: 1,
    columnWidth: () => "100%",
    height: "100%",
    minRowHeight: 18,
    getInitialRowHeight: (row) => cache.get(entries[row].id),
    renderCell: (p) => {
        const cell = p.previous ?? p.recycle?.() ?? document.createElement("div");
        applyCellStyle(cell, p.style);
        let body = cell.firstElementChild;
        if (!body) cell.append((body = document.createElement("div")));
        body.textContent = entries[p.row].text;
        p.measure(body);          // the one line this layer adds
        return cell;
    },
});
```

**What was built.**

- `src/render/types.ts` — `RerenderInfo.fromRow?: number`, documented as geometry invalidation.
- `src/render/rerender-check.ts` — `fromRow` expanded across the rendered window, and across the
  sticky bottom band, both bounded.
- `src/render/RenderGridModel.ts` — `mergeRerenders` carries `fromRow`, taking the **lower**.
- `src/render/RenderGrid.ts` — `onCellAttached` / `onCellReleased` shell options, fired from
  `admitCell` / `evictCell` in terms of the **active render set**.
- `src/measured/MeasuredRowHeights.ts` — the height policy. No DOM.
- `src/measured/MeasuredRowGrid.ts` — the companion: one `ResizeObserver`, the lifecycle, and the
  `RenderGrid` it owns.
- `test-boards/RenderGridTest/measured.js` (`window.measured`) — the browser harness.

**Done when — all met:**

- First paint from hints, settling to measured truth: extent **300,020** matching the hint sum to
  the pixel, then rows measured across 40–104 px. ✅
- Total scroll extent equals the measured sum: **26,640 + 20 slack = 26,660**, `scrollHeight`
  identical, 0 rows unmeasured. ✅
- Geometry correct for rows *after* a changed one: a row grown 88 → 296 moved the **seven** rows
  below it by exactly 208 px each, left the row above it alone, and re-rendered none of their
  content. ✅
- A retained, hidden cell re-admitted and **remeasured**: the same element, 0 while hidden
  (ignored, not committed), **280** on return, matching its layout. ✅
- Tasks 35/36/37's assertions re-run and unchanged in every figure. ✅
- The fixed-height 100k gate unmoved, and the measured path's own cost measured and reported. ✅
- `typecheck` and `test` green (918); `api.md`, `capabilities.md` and `architecture.md` updated;
  a benchmark row appended. ✅

### Task 35 — the scroll-loss defect ✅

**Bigger than the stub, and in a different place than the epic thought.** The epic describes one
defect; there are two, and they share a cause — something detaches a subtree, and Chromium discards
the scroll state inside it without firing an event.

**Face 1, the host detaches the grid.** Reproduced exactly as the epic measured it: a 100,000-row
grid at `scrollTop: 20000`, host subtree detached and re-appended, came back at **0** with the model
still at 20000, **no scroll event**, and **456 of 468 px of viewport unpainted** — blank until
scrolled. Then a second case the epic did not have: a host that detaches and re-inserts **within one
task** (a framework moving a node during a commit) resets the scroller just the same, but **no
`ResizeObserver` ever observes a 0x0**, because observers sample at a frame boundary and the subtree
is back by then. One detector cannot cover both.

**Face 2, the engine detaches its own cells.** Both fork claims confirmed against the current
source and then in the browser. Eviction's `removeChild` destroys what a cell owns — a nested
scroller went **300 → 0** and an `<iframe>`'s document was **torn down and reloaded** (`load` fired
twice, `contentWindow` `null` while evicted). And `append` on a node that is already a child is a
move: measured directly, moving an element resets a scroller nested in it **250 → 0**. That second
one is *latent* in av-grid today — `attached` tracks exactly what was appended, so an admitted cell
is never already a child — and becomes live the moment eviction retains, which is why the guard
ships with the retention rather than before it.

**What was built.**

- `RenderGridModel.restoreScroll` — the actual repair, see the log.
- `RenderGridModel.revalidateScroll` — the two-frame, scroll-event-vetoed reconciliation.
- `RenderGrid.paint` — the restore made reachable from the early-return branch.
- `RenderGrid.evictCell` / `admitCell` — `keepCellsAttached`, and the move guard.
- `RenderGrid.watchHost` (option, default `true`) and `revalidate()` (also on `AVGrid`).
- `CellPool.release(): boolean`.

**Done when — all met:**

- Both faces reproduced with numbers before the fix and re-measured after. ✅
- A genuine user scroll to the top still works, including under per-frame host churn. ✅
- `typecheck` and `test` green (862); `api.md` and `capabilities.md` updated; benchmark row
  appended with an A/B against HEAD. ✅

### Task 36 — after-paint scrolling ✅

**Why.** `scrollTop` is clamped to the scrollable extent, and the extent is the sizer's height,
which the paint writes. A caller that changes the row set and scrolls in the same turn scrolls
against the **old** extent: the request clamps, the list then paints correctly at the wrong place,
and nothing re-issues it. av-grid had no pending-scroll register at all.

**Measured before the fix**, on a grid grown 20 → 3,000 rows in one turn and asked for row 2,000
(`scrollTop: 48000`): `scrollToRow` landed at **100**, the whole of the old extent. `setTimeout(0)`
landed at **100**. One `requestAnimationFrame` landed at **100**. The fork's claim about
`setTimeout(0)` was therefore confirmed rather than trusted — and the `rAF` result, which the fork
does not mention, is the same for a related reason.

**Snippet first:**

```js
model.scrollToRow(row, "center");             // the rows have not changed
model.scrollToRowAfterPaint(row, "center");   // the rows have just changed
```

**What was built.**

- `RenderGridModel.pendingScrollRow` — the one-slot, last-wins register.
- `RenderGridModel.scrollToRowAfterPaint` / `flushPendingScroll` / `measured`.
- `RenderGridModel.scrollToRow` — queues in the same slot when unmeasured.
- `RenderGrid.paint` — flushes at the end of both branches, after the restore.
- `AVGrid.scrollToRowAfterPaint`, for parity with `scrollToRow`.

**Done when — all met:**

- The defect reproduced with numbers before the fix, and re-measured after: **100 → 48000**, row
  2,000 painted at the top. ✅
- `setTimeout(0)` and `rAF` confirmed insufficient, and left unchanged by the fix. ✅
- The unmeasured case: row 1,500 requested behind `display: none` landed at **0**, now **36000**. ✅
- The conflict with task 35's reconciliation resolved explicitly and measured. ✅
- Task 35's own assertions re-run and unchanged. ✅
- `typecheck` and `test` green (879); `api.md` and `capabilities.md` updated; benchmark row
  appended. ✅

### Task 37 — `setOptions` applies shell layout ✅

**Why.** `RenderGrid.setOptions` assigned the options, delegated to the model and updated
`className`, and never reapplied `height`, `growToHeight`, `growToWidth` or the overflow that
follows `fitToWidth`. Persephone's `ListBox` and `Autocomplete` call `setLayout` whenever their
layout changes, so those fields have to be live — and reaching into av-grid's private DOM to do it
is not an acceptable substitute.

**Measured before the fix:** a `setOptions({ growToHeight: "150px" })` on a grid in a 400px host
left the root at **400px** with `max-height: unset`; every subsequent change was ignored too.

**Snippet first:**

```js
grid.setOptions({ height: undefined, growToHeight: `${Math.min(rows.length * 24, 300)}px` });
```

**What was built.** One branch in `setOptions` that re-runs `applyStaticStyles()` — the
constructor's own pass — when one of the four fields actually changed, and drops `lastInfo` to
force `applyLayout` through once.

**Done when — all met:**

- Root height follows `growToHeight` **150 → 260 → back to 400**, `growToWidth` reaches
  `max-width: 320px` and `fitToWidth` reaches `overflow-x: hidden`. ✅
- The geometry follows too, not only the styles: 100px/5 rows → 360px/**16** rows. ✅
- A `setOptions` touching none of the four forces no paint and changes nothing. ✅
- `typecheck` and `test` green; docs updated; benchmark row appended. ✅

---

## Decision log

Append here whenever the plan changes during implementation — what changed, and why. The logs for
tasks 1–20 ([`plan-done-01.md`](plan-done-01.md)), 21–26 ([`plan-done-02.md`](plan-done-02.md)) and
27–32 ([`plan-done-03.md`](plan-done-03.md)) are still required reading.

| Date | Task | Decision |
|------|------|----------|
| 2026-08-30 | 33–35 | **Phase 8 opened for EPIC-079.** Three tasks, one consumer, and one rule that is new to this project: the reference is a *fork of this code*, not a React original, so every difference is either the feature or drift and has to be classified out loud. The version is bumped once at the end of the epic, by the epic — no task here touches `package.json`. |
| 2026-08-30 | 33 | **Buckets, not the reference's linear scan — decided by measurement, not by taste.** The fork's `acquire(reuseKey)` walks the pool array backwards looking for a matching key and `splice`s it out; both halves are O(pool). Measured (node, 200k acquire/release cycles, 5 kinds): at pool 50 the scan costs 65 ns against the bucket's 39 ns; at pool 2000 with half the requests asking for a key the pool does not hold — the ordinary case for a list that has just scrolled a new kind into view — it costs **2,177 ns against 24.8 ns, 88×**, and grows linearly from there. Invariant 1 is about not letting per-frame work scale with the dataset; a pool lookup that scales with pool size is the same mistake wearing a different hat, even though it is not literally in `inputChanged()`. So `elements: HTMLElement[]` becomes `buckets: Map<CellReuseKey, HTMLElement[]>` with a `WeakMap<HTMLElement, CellReuseKey>` recording what each released element was built for, an explicit `count` for `size`/`maxSize`, and empty buckets deleted on drain so an object key is not retained by the Map. Keyed acquire is a `Map.get` and a `pop`; unkeyed acquire is a `pop` from the untagged bucket. This is exactly the "port behavior, improve structure" the rule asks for: the *behaviour* — a keyed request never gets an incompatible element — is the fork's, the structure is not. |
| 2026-08-30 | 33 | **`release(): boolean` and `has()` are drift, and stay behind.** They look like part of the keyed pool and are not: they exist because the fork's `releaseCell` **keeps released cells attached to the DOM but hidden** (`display: none`), so it needs to know whether the bounded pool retained an element — if not, *that* is the only path that detaches it — and needs `has()` to avoid double-releasing one and to skip hidden cells during orphan cleanup. That is a separate capability (frame-bearing cells whose detachment would reload an iframe), with its own cost: the pool must then track a `retained: Set` alongside the array, and every released cell stays in the document. av-grid's `syncRegion` removes the element and *then* releases it, and nothing reads a return value. Bringing the boolean across would have added a live `Set`, a second source of truth about what is pooled, and a documented-but-unused return — for a feature nobody asked for. If the frame-bearing-cell capability is ever wanted it is its own task, and `release` can gain a return value additively then. |
| 2026-08-30 | 33 | **Two behaviours of the reference deliberately *not* reproduced, both cheap-looking bugs.** (a) The fork's `acquire(undefined)` pops the last entry **regardless of key** but then does not clear that element's recorded key (`if (reuseKey !== undefined) this.reuseKeys.set(…)`), so an element taken as untagged is released back into its *old* kind's bucket and handed to a row of a kind it is no longer built for — the exact failure the feature exists to prevent. Here `acquire` always records the key it was asked for, including `undefined`. (b) The unkeyed fallback is kept, because "no key" means "anything will do" and a mixed consumer may key only some rows: `acquire()` drains the untagged bucket first and only then borrows from a keyed one, which is O(kinds) — bounded by how many kinds exist, never by pool size. |
| 2026-08-30 | 33 | **`setReuseKey` is forwarded like `recycle`, and like `recycle` it is *not* in `inputChanged()`.** The fork compares it there, beside `renderCell`. That is drift: both functions are bound fields owned by the DOM shell and handed to the model once at construction, so their identity never changes and the comparison can only ever fire on a full re-`setOptions` — where `renderCell` already fires. av-grid has excluded `recycle` from that comparison since task 4 for the same reason; including one and not the other would be the inconsistency. |
| 2026-08-30 | 33 | **Verified by an A/B on the same board in the same session, because the ratio alone could not have shown a regression.** A paint costs 0.15 ms here, so the flat-cost ratio swings 0.86–1.10 run to run on *either* build — quoting a post-change number against a row written in April would have proved nothing. Stash, rebuild, refresh, measure, restore, measure: ratio median 0.97 after against 0.86/1.02 before, and a full repaint of 240 cells reading **0 childList mutations / 480 attributes / 0.1 ms digit for digit on both**. The feature was then driven on a second `RenderGrid` over 50,000 rows of three interleaved kinds — **177 hits, 14 misses, 0 wrong-kind reuses**, and after warm-up every admission already the right shape — because happy-dom does no layout and the unit tests cannot see a list that renders as a blank box. |
| 2026-08-30 | 33 | **`CellReuseKey` is `unknown`, and Map key semantics are the documented contract.** The fork types it `unknown` too, and that is right — the library must not care what a kind *is*. The one thing that changes with buckets is the comparison: the scan used `Object.is`, a `Map` uses SameValueZero, which differ only on `-0` vs `+0` (a `-0` key finds a `+0` bucket now). Documented rather than worked around; a cell kind is a string, a symbol or an object identity in every plausible use, and adding an `Object.is` shim to the hot path to preserve a distinction between two zeroes would be the wrong trade twice over. |
| 2026-08-30 | 35 | **The epic's diagnosis of `scrollLost` was wrong, and the real mechanism is smaller and fixable.** EPIC-079 says the flag "never sets" because "a re-append changes no size at all". Instrumented, the opposite happens: the **detach** changes the size to 0x0, the `ResizeObserver` fires, the flag arms correctly — and then the size change forces a recompute and a paint, and that paint calls `restoreScroll`, which writes the offset to a **still-detached** container where it does nothing and clears the flag. By the time the subtree came back, nothing was left to say the position had been lost. The flag was never failing to arm; it was being **spent one frame too early**. So the repair is one guard: `restoreScroll` returns without clearing when the container measures 0 and therefore cannot accept the write. That alone fixes the case the epic measured. |
| 2026-08-30 | 35 | **`scrollLost` stays, its justification is replaced, and it widens.** The premise in its comment — `display: none` zeroes `scrollTop` — was **re-measured false here**, as US-1232 found: hidden, the container *reports* 0, and Chromium hands 20000 straight back on show, immediately, across both a synchronous hide and a 900 ms one. So hiding never needed the flag. **Detachment does**, and it presents identically from inside the model (0x0 with a non-zero offset), so the arming condition is kept as it stands and simply means something else now: not "we were hidden" but "we stopped being rendered". The hide case is then a harmless rewrite of the value the browser already restored. The flag neither narrows nor disappears — it keeps its trigger, loses its false rationale, gains a correct one, and gains a second arming site for the case the first cannot see. |
| 2026-08-30 | 35 | **Two detectors, because the same-task reparent is invisible to every sampling observer.** A `ResizeObserver` and an `IntersectionObserver` both compute state at a frame boundary, so a subtree removed and re-inserted inside one task shows no change to either — measured, `resizeObserverSaw0x0: false` while `scrollTop` went 20000 → 0. A `MutationObserver` records *mutations* rather than sampling state, so it sees both halves. It observes `childList` on each ancestor of the root, **without `subtree`**: those are nodes the grid never touches (it mutates inside `container`), so a page that leaves the grid alone records nothing and pays nothing, while `subtree` would have delivered a record for every cell appended on every scroll frame — the render path paying for a defect that happens once. Default on (`watchHost`), because an API meant to be used without reading docs cannot ask a host to opt into not being broken; the hard requirement is still met, since a host that never moves the grid observes nothing and behaves identically. |
| 2026-08-30 | 35 | **The discrimination is causal, not heuristic, and that is the whole difficulty.** `restoreScroll` already documents why "the DOM disagrees with the model, write the model back" is wrong: a scroll event lags its scroll by a frame, so during any user scroll the container is legitimately ahead of the model, and writing back undoes the scroll — and, because the write fires an event of its own, the two take turns and the list scrolls half the time. The disagreement is therefore worthless as a signal. What is not worthless is **what follows it**: every scroll the browser performs is followed by an event, and a position it discards is followed by none. So `revalidateScroll` carries a disagreement across **two** frames — two, because the documented lag is "a frame, sometimes after that frame's rAF callbacks" — and any scroll event arriving in that window vetoes the restore. Verified against the exact regression it risks: a scroll to the top with an ancestor mutating in the same frame lands at 0 and stays, and 30 frames of continuous scrolling under per-frame ancestor churn land exactly where asked. |
| 2026-08-30 | 35 | **`release(): boolean` comes across after all; `has()` still does not.** Task 33's log parked both as drift serving "the fork's keep-cells-attached strategy, not keying", and said the boolean could be added additively if that capability was ever wanted. It is, and it was. A caller that leaves evicted cells in the document **must** know when the pool refused one: a refused cell is a cell nothing will ever come back for, and leaving it hidden forever is exactly how a bounded pool becomes an unbounded pile of nodes — so pool overflow is the one eviction path that still detaches. `has()` is still not needed, and the reason task 33 gave still holds: av-grid's `attached` set already records exactly which cells are live, a released cell is removed from it, and nothing can double-release. Adding `has()` would be a second source of truth about what is pooled. The fork needs it only because it also runs an orphan sweep av-grid does not have. |
| 2026-08-30 | 35 | **Retention is opt-in, and the engine — not the renderer — restores visibility.** The fork hides released cells unconditionally and relies on its own `applyCellStyle` to restore `display`. av-grid cannot: here the **renderer** owns the cell's styles, and no existing renderer sets `display`, so hiding on release would silently hand every consumer invisible recycled cells. That is a breaking change dressed as a bug fix. So `keepCellsAttached` defaults to `false`, and when it is on the shell stashes the element's previous inline `display` in a `WeakMap` and puts back exactly what was there — not `""`, which would discard a renderer's own inline value. The `WeakMap` read is guarded on the option too, so the default path does not pay a lookup per admitted cell per frame for a case that cannot arise. |
| 2026-08-30 | 35 | **A retained cell must stop answering to a coordinate — found by a test, not by reasoning.** The first version left `data-row` / `data-col` on hidden cells, and a happy-dom test caught two elements claiming cell 0,0. Those attributes are how *everything* addresses a cell here — `GridInteractions` by `closest()`, a host or a test by `querySelector` — and a hidden duplicate shadowing the live one is a trap that would have cost a debugging session. So eviction strips both and sets `data-avg-pooled`, which the fork also does and which is now a documented part of the DOM contract; the renderer writes both back on re-admission, the only way a pooled cell ever returns. Removing attributes the engine did not set is safe precisely because every renderer sets them — and a renderer that does not set them loses nothing by having them removed. |
| 2026-08-30 | 35 | **Retention is faster, not slower, on the cells it exists for — worth recording because the reverse was assumed.** Retention was expected to trade performance for state. On a 400-row grid whose every cell holds a nested scroller and an `<iframe>`, driven 40 rows down and back, it is **0.586 ms a paint against 1.648 ms** with **40 childList mutations against 160**, paying 240 attribute writes and holding 150 nodes against 30. The reason is that the thing being avoided — destroying and rebuilding a frame's document — costs far more than a `display` write. The trade is real but it is memory for time, not time for state. |
| 2026-08-30 | 35 | **`revalidate()` is on `AVGrid` too; `keepCellsAttached` is not.** A host that moves its grid moves an `AVGrid` as often as a bare `RenderGrid`, so the escape hatch belongs on both (and `watchHost` reaches `AVGrid` for free, since it defaults on in the shell). `keepCellsAttached` deliberately stops at `RenderGrid`: `AVGrid`'s cells are data cells rendered by `DataCell`, which own nothing that a detach destroys, and the consumers this feature exists for — a log view, a notebook — drive the engine directly. Exposing it on the grid would be surface with no behaviour behind it. |
| 2026-08-30 | 36–37 | **Tasks 36 and 37 opened, and deliberately taken as one task.** They are two of EPIC-079's six gaps (4 and 5), both hard blockers for US-1237, and both land in `RenderGridModel.ts` and `RenderGrid.ts` — the two files task 35 had just rewritten. Splitting them would have meant integrating with task 35's uncommitted scroll reconciliation twice, from two directions, which is exactly how a subtle scroll race gets built. Neither is a breaking change: `scrollToRow`, `setOptions` and every option default keep their behaviour, and the two additions are a new method and a branch that only fires on fields that changed. |
| 2026-08-30 | 36 | **The conflict with task 35's reconciliation is resolved by rank, not by timing luck — and the rank is *the newer explicit request wins*.** Both `flushPendingScroll` and `revalidateScroll`'s settle write `scrollTop`, and a wrong answer here produces a list that scrolls correctly only intermittently, which is the exact failure `restoreScroll` already warns about. They are not symmetric: the reconciliation is repairing a position the browser silently *discarded*, while the register holds one the **host explicitly asked for**, and asked for later. So the queued scroll wins on both axes. **Within a paint** it wins by ordering — `restoreScroll` runs first, `flushPendingScroll` last, so the restore is a harmless write that is then superseded. **Across frames** it wins by the settle standing down: `if (this.pendingScrollRow) return`. The alternative — restore, then flush a frame later — was rejected because the restore fires a scroll event of its own, which is precisely the signal the reconciliation uses as a veto, so it would poison the next reconciliation while also showing a visible jump to the old offset and back. And a landed flush *is* a restore, so `flushPendingScroll` clears `scrollLost` rather than leaving the next paint to overwrite the scroll it just performed. Measured end to end: a host reparenting the grid in the same turn as an after-paint scroll lands on row 1,200 (28,800), not on the old 20,000 and not half way. |
| 2026-08-30 | 36 | **`setTimeout(0)` really does fail, and so does a bare `requestAnimationFrame` — both measured rather than trusted.** The fork's comment asserts the first; the brief asked for it to be confirmed. On a grid grown 20 → 3,000 rows and asked for row 2,000, all three of the direct call, `setTimeout(0)` and one `rAF` landed at **100** — the entire old extent — against the 48,000 asked for. The `rAF` result is the one worth recording, because it is the deferral a reader would reach for next and it fails for a *different* reason: the paint is itself scheduled on `requestAnimationFrame`, and a callback registered in the same turn as the row-set change is queued **ahead** of the paint's own frame, so it still runs against the old sizer height. `setTimeout(0)` fails for the reason the fork gives — after the microtask that recomputes `renderInfo`, before the frame that applies it. Only the end of a paint is late enough, which is why the register is drained there and nowhere else. |
| 2026-08-30 | 36 | **`scrollToRow` checks `measured` *after* its awaits, not before as the fork does — and that is what keeps the change non-breaking.** The fork queues immediately on `!measured`, which here would have broken an existing documented behaviour and its test: `scrollToRow` called before `attach()` awaits the container and lands once the grid exists. Checking after the awaits keeps that path exactly as it was — the caller was already relying on the await to hold the request — and routes only the case the register exists for: a grid that **is** attached and still has no layout box, which is the popover that lays out later. Verified both ways: the pre-attach test passes untouched, and a request for row 1,500 issued behind `display: none` now lands at 36,000 instead of 0. |
| 2026-08-30 | 36 | **`scrollToRowAfterPaint` requests its own repaint; the fork requires the caller to have scheduled one.** The fork's doc comment says "the caller must have scheduled a paint; `update()` always does", which is true of its call sites and is a precondition an API meant to be used without reading docs should not have. `requestRepaint()` is idempotent per frame and always notifies (`Observable.update` replaces the state object, so a same-millisecond call still fires), and a repaint that finds nothing changed takes `paint()`'s early return — which now flushes too. So the guarantee costs one scheduled frame in the case where the caller had already scheduled one, and makes the call correct standing alone. |
| 2026-08-30 | 36 | **The flush is on the hot path, so it tests the cheap thing first.** `flushPendingScroll` runs at the end of *every* paint, and its guard is `_disposed || !pendingScrollRow || !measured` in that order. The ordering is load-bearing rather than stylistic: `measured` reads `container.offsetHeight`, which can force layout, and a paint with nothing queued — every paint, in every consumer that never calls this — must not pay for that. Short-circuiting on the empty slot reduces the common case to one boolean. Confirmed on the board: flat-cost ratio 1.00–1.04× warm, 60.0/60.0 fps, 0 pool misses, full repaint 0 childList / 400 attributes over 200 cells / 0.2 ms — the same numbers task 35's row records. |
| 2026-08-30 | 37 | **The fix re-runs `applyStaticStyles()` rather than restating what the four fields mean.** The fork's `setLayout` recomputes each style inline, field by field, with its own `heightChanged` / `growToHeightChanged` booleans — six branches that duplicate what its constructor already does. Copying that shape would have given av-grid two places that know `height ?? (growToHeight ? "unset" : "100px")`, and they would eventually disagree. Here the constructor's own pass is simply run again after the merge: it is already written against `this.options`, every write already goes through `setStyle`, which skips an unchanged value, so re-running it is idempotent and cheap. The `layoutChanged` test exists only to decide whether to run it at all — not to decide what to write. |
| 2026-08-30 | 37 | **`lastInfo` is dropped to force one paint through its body, and that is not a repaint.** `applyLayout` reads `growTo*` for the container's own width and height, and it only runs on a paint whose geometry changed — so a `growToHeight` change that produced no new render info would have written the root's `max-height` and left the container sized to the old rule. Dropping `lastInfo` forces the paint body. It costs nothing in cells: `syncRegion` is set arithmetic over the same elements, so it appends and removes nothing, asserted in a test (`cellsAppended: 0, cellsRemoved: 0`) rather than argued. |
| 2026-08-30 | 37 | **No `setLayout` method was added, on purpose.** The fork has one because its view owns a `VirtualGridLayout` object separate from the model's options. av-grid has no such split — `height`, `growToHeight`, `growToWidth` and `fitToWidth` are already `RenderGridShellOptions` fields — so a second entry point would be a synonym for `setOptions` with its own drift risk and a second thing to document. Making the existing call live is the smaller public surface and the one an agent would guess. Nothing new is exported from `src/index.ts` as a result: both additions are methods on `RenderGrid`, `RenderGridModel` and `AVGrid`, which are already exported, and `RowAlign` already reaches the surface through `export * from "./render/types"`. |
| 2026-08-30 | 34 | **A companion class, not options on `RenderGrid` — and composition rather than a subclass.** The layer must not reach the scroll path of a grid that never asks for it: a `ResizeObserver`, two `WeakMap`s and a debounce on every admission would be paid by the 100,000-row fixed-height gate for a feature most grids will never use. That settles "companion". The second choice was less obvious. A subclass would have inherited `model`, `root`, `setOptions`, `destroy` and the rest for free, and it is *nearly* safe — a layer object built before `super()` can carry the bound `rowHeight` and `renderCell`, because `RenderGrid`'s constructor paints synchronously and would otherwise call fields that do not exist yet. It was rejected anyway: it would have split the view half of the layer across two objects (the pre-`super` layer and `this`) purely to satisfy an initialization order, which is exactly the kind of structure that reads as accidental a year later. Composition costs eight forwarded members — `model`, `root`, `scrollElement`, `stats`, `addOverlay`, `revalidate`, `setOptions`, `destroy` — and keeps the reference's own two-object split honest: policy with no DOM, view with all of it. |
| 2026-08-30 | 34 | **`fromRow` is genuinely needed, and `markDirtyHeight` is not a substitute — but the reason is narrower than US-1238 states.** The document says `{ rows: [row] }` "repaints one row and leaves the geometry for all rows after it based on stale row starts". Read against this codebase that is not quite it: `prepareRerender` already diffs the old and new `rowLength` arrays (`markDirtyHeight`) and marks from the first differing index, so in the common case the rows below *are* repainted at their new offsets. Two things still fail without `fromRow`. `markDirtyHeight` guards on `dirtyIndex < old.rendered.bottom`, so a change at exactly the last rendered row marks nothing and that row keeps its old height and top. And it only runs when `rowLength` is an array, which is an implementation detail of how the height was expressed rather than a contract a caller can rely on. `fromRow` states the intent directly and does not depend on either — so the field earns its place, and the honest justification is the edge case plus the contract, not "the rows below are never repainted". |
| 2026-08-30 | 34 | **`fromRow` reaches the sticky bottom band; the fork's does not.** The fork expands `fromRow` over `range(max(fromRow, rendered.top), rendered.bottom)` and stops. The sticky bottom band is addressed from the *end* of the list and sits below the rendered window, so a `fromRow` landing inside it marks none of it. Those rows are positioned relative to their band, so a change *above* the band genuinely does not move them — but a change *inside* it does, and the fork would miss it. A second loop, bounded by `stickyBottom` (which is 0 for every measured list this exists for, and a handful of rows otherwise), covers it. Classified as a fork **defect**, not drift and not a feature: it is unreachable in the fork's own consumers, which is presumably why it survived. |
| 2026-08-30 | 34 | **The lifecycle seam is defined on the active render set, and that had to be decided *against* the obvious reading.** "Released" is tempting to define as "detached", because that is what av-grid's eviction did until task 35. It cannot be: `keepCellsAttached` makes ordinary eviction *retain* the element, hidden, and pool overflow then detaches it — so a detachment-based contract would (a) stop the measurement bookkeeping for every retained cell and (b) make the contract depend on `CellPool.maxSize`, a number the consumer never sees. So `onCellReleased` fires at the **top** of `evictCell`, before either branch and before the pool is consulted, and `onCellAttached` fires at the **end** of `admitCell`, after any hiding is undone — the first moment a measurement is meaningful. The re-admission half is the one that would have been silently wrong: a hidden element measures **0**, so a cell whose `parentElement` never changed still needs a fresh look. Measured on the board: hidden 0 (ignored), re-admitted **280**, same element, matching its layout. |
| 2026-08-30 | 34 | **A plain `Map` of debouncers replaces the reference's `memorize`.** The fork memoizes its per-row debouncer with `memorize`, which av-grid ported in task 1 and which keys its cache on `JSON.stringify(args)` — its own comment says it is not for a hot path, and this is one: it is reached from every `ResizeObserver` entry and every render of a measured cell. A `Map<number, RowUpdater>` is the same memoization with a number key instead of a serialized one. Behaviour identical; that is "port behaviour, improve structure". Disposal also **cancels** every updater rather than relying only on the reference's "allow one final no-op callback": av-grid's `debounce` re-arms itself while its `canRun` gate is false, so the gate is opened on disposal *and* the timers are cancelled — either alone leaves a disposed layer holding a timer for the life of the page, which a test now asserts (`vi.getTimerCount() === 0`). |
| 2026-08-30 | 34 | **`height` is *not* defaulted to `"100%"`, which is a deliberate divergence with a visible cost.** The fork's `VirtualFlexGridView` passes `height: props.height ?? (props.growToHeight ? undefined : "100%")` to its inner grid, because its flex wrapper element has to hand a definite height down. `MeasuredRowGrid` adds no wrapper — it constructs the `RenderGrid` straight into the host — so `RenderGrid`'s own default applies and `height` keeps exactly the meaning it has everywhere else in the library. The cost is real and was paid immediately: the first board run rendered **3 rows in a 600 px host**, because the default is a deliberately visible 100 px, and the demo had to pass `height: "100%"` like every other harness. Keeping one meaning for one option name beat saving that line, and the docs' snippet carries it with the reason attached. |
| 2026-08-30 | 34 | **Stable identity is enforced by construction, not by discipline.** The requirement — one `rowHeight` function for the layer's lifetime, because `RenderGridModel.inputChanged()` compares it by identity — is the easiest thing here to break, and "remember to mutate rather than replace" is not a mechanism. So `MeasuredRowHeights.rowHeight` is a `readonly` bound field over mutable `props`, `setProps` assigns `props` and nothing else, and `MeasuredRowGrid.setOptions` regenerates the engine options through `gridOptions()`, which always substitutes the layer's own two bound fields — a caller that passes a *new* `renderCell` has it stored and reached through the same stable wrapper, so even replacing the renderer moves no geometry input. Asserted both ways in `MeasuredRowGrid.test.ts`. |
| 2026-08-30 | 34 | **The measured path costs 5.8x a paint, and that number is reported rather than optimized away.** 5,000 rows of random wrapped text through a 400 px viewport, driven top to bottom, against the same rows and the same renderer at a fixed 48 px: **0.685 ms a paint against 0.119 ms**, 60 fps on both, and **1,242 pool misses against 11** — every committed height moves the geometry, which moves the window, which admits cells the pool has not been given yet. The temptation was to chase the misses; it was resisted because the shape is inherent (a per-row debounce commits in its own task, and `RenderGridModel.update` can only coalesce within one) and because the cost is transient, not continuous. That last part was checked rather than assumed: a **settled** measured grid takes **0 paints and 0 pool activity over a second**, and a full repaint of every visible cell does **0 DOM insertions or removals** — the `previous` path holds here exactly as it does for the fixed grid. So the honest claim is "expensive while heights are being discovered, free afterwards", and the docs say that. |
| 2026-08-30 | 36–37 | **Verified in a browser, because neither defect is visible to happy-dom.** Both are timing and layout bugs: one is about which frame a `scrollTop` write lands in, the other about geometry the tests never compute. A new board harness, `test-boards/RenderGridTest/after-paint.js` (`window.afterPaint`), measures both before and after, alongside task 35's `scroll-loss.js` and reusing its host and renderer patterns. Task 35's full `scrollLoss.all()` was re-run after the change and is unchanged in every figure — face 1 restored to 20000 with 0 px unpainted, the same-task reparent likewise, `manualRevalidate` 0 → 20000, retention preserving a nested `scrollLeft` of 300 and a single iframe `load`, and a genuine user scroll to the top still landing at 0. That re-run was the point of doing these two tasks together: the change is in the same code path and a regression there was the likeliest outcome. |
