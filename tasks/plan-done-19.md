# av-grid — Implementation Plan 19 (done): phase 23, the grid blinks on a scrollbar drag

**Phases 1–22 had shipped through 2.12.0 (2026-09-21).** Phase 23 held one task — **task 65**,
a defect rather than a feature: the grid was blank for the length of a scrollbar drag.
**Shipped as 2.12.1 on 2026-09-24.** It rewrote part of `docs/invariants.md`, which is the first
time an invariant has gained a clause rather than a comment.

## Ground rules (standing, carried forward)

- Everything is additive; ships as a **minor** version per [`docs/releasing.md`](../docs/releasing.md)
  — unless a phase holds only a defect fix with no new surface, which ships as a **patch**.
- The core stays dependency-free; every new option reaches the React wrapper through lane 3 (or
  lane 2 for a callback) — verify by test.
- Design the API before implementing it; measure, don't assume (benchmark row per render-path
  change); verify in a browser, not only in tests.
- No consumer names in this repo.
- **Ask before adding a feature** that is not in this plan or in [`goal.md`](goal.md#scope).

## Task tracker

| # | Task | Status |
|---|------|--------|
| 1–64 | Phases 1–22 | see `plan-done-01.md` … `plan-done-18.md` — ✅ Done |
| 65 | The grid blinks on a scrollbar drag — the grid draws its own scrollbars | ✅ Done — 2.12.1 |

## Task 65 — the grid blinks on a scrollbar drag

**A defect, no new public option.** Reported by the author: drag the scrollbar of a 100,000-row
grid from top to bottom in about half a second and **the grid is blank the whole way down**,
filling in once the drag stops. Ordinary wheel scrolling is clean.

### What it actually is

A browser scrolls a viewport on the **compositor** and delivers the scroll event to JavaScript
afterwards. For one frame the content has moved and the cells have not. At wheel speed that gap
is covered by `overscanRow` and nobody sees it; **a scrollbar drag is not at wheel speed** — one
frame can cross thousands of rows and expose a viewport sharing no row with the last, which no
runway of any size can cover.

**The plan's original diagnosis was wrong and is worth recording**, because it is the obvious one
and it cost a prototype. It read the shell's own header — *"one paint per frame, on
`requestAnimationFrame`"* — and concluded the paint was always a frame behind the scroll, so
painting synchronously from the scroll handler would fix it. Measured with a frame-accounting
probe: **149 of 149 paints already ran at the first rendering opportunity after their scroll
event, 0 late.** Painting earlier inside the same frame changed nothing an eye could see, which
the author confirmed on the board. The lag is not in our scheduling; it is that we are not the
ones moving the content.

### What was built

**The grid draws its own scrollbars.** The viewport keeps its native scrolling and only its
*bar* is hidden (`overflow: auto` with `scrollbar-width: none`); the bar the user sees is an
**empty strip** per axis, holding one spacer and no cells. A strip's scroll event writes the
viewport's offset, recomputes and paints **in that one task**, so the offset and the cells can
never be a frame apart. Because a strip holds nothing, the browser scrolling it exposes nothing.

**The wheel is deliberately left alone**, which is what keeps it smooth: the browser scrolls the
viewport on the compositor with its own animation, and the grid follows through the ordinary
scroll path. Its one-frame gap stays `overscanRow`'s job.

Files: `src/render/RenderGrid.ts` (the strips, the drag path, the deferred thumb sync),
`src/render/RenderGridModel.ts` (one option, `scrollBarSize`, because the viewport now measures
no bar while the strips take the space). Eight tests in `src/render/RenderGrid.test.ts`, six of
which fail with the mode off. Documented in `docs/api.md` (DOM contract and a *Scrolling and the
scrollbars* section), `docs/capabilities.md` and `docs/invariants.md`.

### What it measures

Per-frame probes at four heights down the viewport, 100,000 rows by 12 columns of rendered cells:

| Per-frame distance | before | after |
|---|---|---|
| Ordinary scrolling (1/16 viewport) | 1 % of probes blank | **0 %** |
| Fast scrolling (1/4 viewport) | 25 % | **0 %** |
| **A scrollbar drag** (whole range in 30 frames) | **100 %** | **0 %** |

Six alternating 100k gate runs, same 36 visible rows on both sides: paint **0.210 / 0.195 ms**
against 0.207 / 0.193 native, flat ratio **0.93×** against 0.94×, first paint **1.6 ms** against
1.7, **60 / 60 fps**, **0** pool misses. `overscanRow` stays at **4** (author): its remaining job
is the wheel, where a notch is about 100px and four rows covers it.

### What was not verified

Touch scrolling on a real touch device. It rides the native viewport path, untouched by this
task, so it is expected to behave exactly as it did before — but it was not put in front of a
finger.

## Decision log

| Decision | Why | Cost / notes |
|---|---|---|
| **65: the reported cause was wrong, and measuring it first is what saved the task** | The plan read the shell's "one paint per frame" comment and concluded the paint trails the scroll by a frame. A frame-accounting probe said otherwise: 149 of 149 paints ran at the first rendering opportunity after their scroll event. The blank sits between the *compositor moving the content* and the *event reaching us*, which no paint schedule can close | The instrument was built before any source change, and is kept: `window.blank` on `RenderGridTest` |
| **65: painting synchronously from the scroll handler was built, measured and abandoned** | It is what the task asked for, and it improved every DOM-timing metric — blank probes 100 % → 0 % on a drag — while the author, looking at the real thing, saw no change at all. `elementFromPoint` reports what the main thread has drawn, not what was composited | Kept in the branch history as `eagerScrollPaint`, off, so the next person does not rediscover it. **A hit-test is not an eye**; two separate wrong conclusions came from trusting one |
| **65: the grid draws its own scrollbars, and the drag is handled in one task** | The only way to stop the content moving ahead of the cells is to be the one moving it. An empty strip can be scrolled by the browser as fast as it likes, because there is nothing in it to be stale | This is the fix. Verified from a listener registered *after* the grid's own, in the same dispatch: offset already at 900,000, first visible cell already row 34,616, 372 cells throughout |
| **65: the wheel is not intercepted — two attempts at emulating it were both worse** | Forwarding a notch to the strip needs `preventDefault`, which throws away the browser's ~100ms easing and reads as a teleport. Replacing it with a smooth `scrollTo` restores the motion on paper — sixteen distinct positions in sixteen frames on a real ease-in curve — and still felt sluggish. The browser's wheel animation is not reproducible from script, so it is not reproduced | Both attempts are recorded in the switch's doc comment. The gap this leaves on the wheel path is `overscanRow`'s, which is what a runway is for |
| **65: `overflow: auto` with a hidden bar, not `overflow: hidden`** | An earlier revision made the viewport unscrollable so nothing but the grid could move it. That also takes the wheel off the compositor, which is the whole of the smoothness | The viewport stays a real scroller; only its bar is hidden |
| **65: the offset is written as `scrollTop`, never as a transform** | A transform looks like the cheaper way to move the content and silently takes the pinned rows and columns with it — `position: sticky` resolves against the scrollport and only responds to *that scrollport scrolling*. Measured all four combinations: a sticky header stays at the top under a written `scrollTop` (with `overflow: hidden` as well as `auto`) and sits **500px above the viewport** under a transform | It is why the nine sticky regions, `applyLayout` and `addOverlay` needed no change at all |
| **65: the thumb is put back on the next frame, never inside the paint** | Writing `scrollTop` forces a synchronous layout, and the paint has just dirtied two boxes millions of pixels tall. Inline, the paint went from **0.20 ms to 1.00 ms** at 100,000 rows — at an unmoved 60 fps, so only the benchmark board could see it | The thumb trails the rows by one frame, which the tests state as the contract |
| **65: the strips reserve what the platform reserves, and draw at least something grabbable** | A first version applied a 12px floor to the *reserved* space, which made every grid 12px narrower under a DOM that lays nothing out (eight tests) and would have displaced content on overlay-scrollbar platforms that the browser does not displace | Reserve is the measured thickness; the drawn width has the floor, so an overlay platform gets a floating strip |
| **65: two measurements were invalid before they were right, and both failure modes are cheap to repeat** | The first gate A/B had the mode *off on both sides*, because the benchmark grid sets `growToHeight` and an early revision excluded such grids — **assert the thing under test is actually on**; the run now checks for a strip in the DOM. The second was read across runs of different sizes, because the results table grows above the grid and shrinks its viewport after run 1 — the board now hides it while measuring, and every run reports the same 36 rows | Reported by the author in both cases. `growTo*` grids are supported now |
| **65: `overscanRow` keeps its default of 4** (author) | With the drag fixed structurally, the runway's only remaining job is the browser-driven wheel, and a notch is about 100px, which four rows covers. Measured on the drag path it is redundant at every setting including 0; on the wheel path it is the only lever (25 % blank at 0 *and* at 4, 1 % at 20) and costs nothing at rest, since it extends only in the direction of travel | A trackpad flick can outrun it; `overscanRow` is already per-grid if that is ever reported |

## Open questions

The open questions this plan carried move forward unchanged to [`plan.md`](plan.md). None is
committed.
