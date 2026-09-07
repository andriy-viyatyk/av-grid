# av-grid — Implementation Plan 11 (done): phase 15, the text filter's input under a text-free operator

**Phase 15 — done, shipped as 2.9.1 on 2026-09-03.** Phases 1–14 shipped through **2.9.0**. One task,
from a consumer's first day on 2.9.0 (2026-09-03). **Before starting anything later, read the
decision logs in `plan-done-01.md` … `plan-done-10.md`** — every one of them still applies, and
[`plan-done-10.md`](plan-done-10.md) decision 5 in particular: it is the decision this task refined.

## Ground rules (standing, carried forward)

- Everything is additive; ships as a **minor** version per [`docs/releasing.md`](../docs/releasing.md).
- The core stays dependency-free; every new option reaches the React wrapper through lane 3 (or
  lane 2 for a callback) — verify by test.
- Design the API before implementing it; measure, don't assume (benchmark row per render-path
  change); verify in a browser, not only in tests.
- No consumer names in this repo.
- **Ask before adding a feature** that is not in this plan or in [`goal.md`](goal.md#scope).

## Task 56 — the text filter's input is `readOnly` under a text-free operator

**The report.** A consumer put 2.9.0's *is empty* / *is not empty* chips on a text column the day
it shipped and came back with one thing: *"the placeholder changes to `no text needed`, which is
good, but it is still editable and it is confusing."*

**This refines a recorded decision rather than fixing an oversight.** Task 54, decision 5: *"the
input while a text-free chip is pressed **stays enabled** — Enter still applies from it — but its
placeholder changes to say the text is not used, and whatever is typed is ignored."* Everything
that decision protects is right. What it conflated is **enabled** with **editable**: the input has
to stay focusable and keep firing `keydown`, and none of that requires it to accept characters. A
control whose placeholder says the text is not needed, and which then lets you type text, is
telling the user two things at once — and the one it demonstrates is the wrong one.

**`readOnly`, and not `disabled`.** The distinction is load-bearing in this class, not a
preference:

- `focus()` does `input.focus(); input.select()` — the popover's own focus target when Alt+↓ opens
  it. A disabled input takes no focus, so the popover would open with focus nowhere and the chip
  group's roving tabindex as the only landing place.
- **Enter applies from the input**, bound to its `keydown`. A disabled input fires none, so Enter
  would stop applying — exactly the behaviour decision 5 set out to keep.

A read-only input keeps both (it is focusable, `select()` works on it, and it fires key events)
and announces itself as read-only.

**The text is cleared, not kept** (author's call, 2026-09-03, over the plan's first draft): a
read-only input still showing `smith` under an *is empty* chip tells the user two things at once,
which is the problem this task fixes. Stashing the text and restoring it on the way back to
*contains* was proposed and declined as too much machinery for the case — the text is simply
gone with the operator that needed it.

### The work

1. **`TextFilterContent.syncChips()`** — one line beside the placeholder swap that is already
   there: `this.input.readOnly = !needsText`. `syncChips()` runs in the constructor and on every
   `selectOp`, so both the reopened-on-a-state-op case and the click-through case are covered by
   the same call. Nothing else in the class changes: `apply()` already ignores the text for these
   ops, so there is no value to clear or guard.
2. **The stylesheet.** `avg-text-filter-text-unused` — the class `syncChips` already toggles on the
   popover — is currently set in JS and styled **nowhere**, which is how the consumer came to use it
   for the muted look this task should be providing. Give the read-only input the library's own
   inert treatment (`--avg-text-muted`, and a background off `--avg-hover-bg` or equivalent), so a
   host does not have to. `input:read-only` is the natural selector now that the property is set;
   keep the class too — it is on the popover, so it can also dress the body around the input.
3. **Docs.** Two gaps, both surfaced by the same report:
   - `docs/api.md`'s text-filter rules list says *"the input says `no text needed`, whatever it
     holds is ignored"* — it should say the input is read-only, since that is now the visible
     behaviour a host may style or test against.
   - **`avg-text-filter-text-unused` is not in the DOM contract**, though it is exactly the kind
     of state hook that section exists for (the filter-popover paragraph after the sticky-band
     table names `avg-filter-content`, `avg-filter-buttons`, `avg-custom-filter-*` and stops
     there). A host that wants to dress this state has to read the bundle to learn the class
     exists. Add it, with what it means.

### Verification

- Unit: selecting a state op sets `readOnly` and selecting a comparing op clears it; a popover
  **opened** on a stored `{ op: "blank" }` filter is read-only from the first paint; the text
  survives a round trip through *is empty* and back; Enter still applies while read-only; `focus()`
  still lands in the input and selects it.
- Keyboard, in a browser: Alt+↓ onto a state-op filter, arrow through the chips to *contains* and
  type — the input must accept the first keystroke, with no click needed.
- The chip bar and the applied value are unchanged by this task; a test that asserts either is the
  regression net.

### Deliverables

- `docs/api.md` — the two edits above.
- No `docs/react-api.md` change: nothing new crosses the wrapper.
- Release **2.9.1** per [`docs/releasing.md`](../docs/releasing.md) — a behaviour fix inside a
  shipped feature, no API surface added.

## Task tracker

| # | Task | Status |
|---|------|--------|
| 1–55 | Phases 1–14 | see `plan-done-01.md` … `plan-done-10.md` — ✅ Done |
| 56 | The text filter's input is `readOnly` and cleared under a text-free operator (+ the state class styled and in the DOM contract) | ✅ Done — 2.9.1 |

## Decision log

| Decision | Why | Cost / notes |
|---|---|---|
| **`readOnly`, not `disabled`** — refines plan-done-10 decision 5 ("stays enabled") rather than reversing it | Decision 5 conflated *enabled* with *editable*. Everything it protects survives a read-only input: `focus()` still lands and selects (the popover's Alt+↓ focus target), and `keydown` still fires so Enter still applies. A disabled input would lose both | One line in `syncChips()`, which already runs in the constructor and on every `selectOp`, so the reopened-on-a-state-op case and the click-through case share the fix |
| **The text is cleared, not stashed and restored** (author's call, 2026-09-03, over the plan's first draft) | A read-only input still showing `smith` under *is empty* tells the user two things at once — the very problem the task fixes. Stash-and-restore was declined as too much machinery for the case | The text is gone with the operator that needed it; arrowing back to *contains* starts from an empty input |
| `avg-text-filter-text-unused` gets the library's own inert look (`--avg-text-muted`, hover background) and **joins the DOM contract** | The class had been toggled since 2.9.0 but styled and documented nowhere — a consumer found it by reading the bundle. A state hook a host may style or test against belongs in the contract | `input:read-only` is the natural selector now that the property is set; the class stays too, since it sits on the popover and can dress the body around the input |
| Shipped as a **patch** (2.9.1), not a minor | A behaviour fix inside a shipped feature; no API surface added, nothing crosses the React wrapper | Docs: `docs/api.md`'s text-filter rules now say read-only; no `docs/react-api.md` change |
| Verified in the browser, not only in tests | happy-dom cannot show a muted, focused, read-only input | Board `checkAll` 35/35; live check: read-only, empty, muted, focused. No render-path file changed, so no benchmark row |
