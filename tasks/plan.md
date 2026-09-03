# av-grid — Implementation Plan 11: phase 15

**Phase 15.** Phases 1–14 are done and shipped through **2.9.0**. One task is committed here,
from a consumer's first day on 2.9.0 (2026-09-03). **Before starting it, read the decision logs in
`plan-done-01.md` … `plan-done-10.md`** — every one of them still applies, and
[`plan-done-10.md`](plan-done-10.md) decision 5 in particular: it is the decision this task
refines.

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

## Open questions carried forward

1. **`--avg-control-h` and `--avg-radius` as tokens?** Raised by a consumer on 2026-09-03 and not
   committed — recorded so it is not lost. The filter popovers' input, search box, chips and
   buttons all carry class hooks (`.avg-text-filter-input`, `.avg-list-search`,
   `.avg-text-filter-op`, `.avg-button`), so a host can already restyle them; what it cannot do
   is restyle them *through tokens*, because the control padding and the 4px radius are literals
   in the stylesheet. A host whose own controls are 32px tall with an 8px radius therefore
   overrides rules rather than values — an override that breaks quietly the next time the library
   restyles its own controls. Two tokens would turn that block into two assignments. Against it:
   the stylesheet's structural values are deliberately not all tokenized, and every token is
   public surface forever.
2. **Should `textFilterOps` have a grid-level default?** Deliberately not in task 54 — a host that
   wants the chips everywhere sets the field while building columns. Worth revisiting only if a
   consumer asks with a case where that is not possible.
3. **`textFilterLabels` — the host's words on the popover's operator chips.** `filterLabel`
   (task 55) covers the bar chip only. A localized popover would need a map of op → label; not
   asked for yet.
