# v0.4.0 follow-up remediation plan

Execution plan for the six issues left in the v0.4.0 milestone after the 2026-08-08 triage:
[#309](https://github.com/chrreiter/HAventory/issues/309),
[#310](https://github.com/chrreiter/HAventory/issues/310),
[#315](https://github.com/chrreiter/HAventory/issues/315),
[#316](https://github.com/chrreiter/HAventory/issues/316),
[#318](https://github.com/chrreiter/HAventory/issues/318),
[#322](https://github.com/chrreiter/HAventory/issues/322).
Three work packages — **F1** (backend), **F2** (card shell), **F3** (organize dialog) —
with **no file overlap between them: all three run in parallel**, each as one PR
implemented by a fresh **Opus 5 (xhigh) cloud session**. The package sections below are written to be that
session's working brief; each session also reads the GitHub issues its package closes.

All `file:line` anchors are taken at `main` @ `8ac7adf`. **Anchors drift: locate by
symbol/testid first, treat the line number as a hint, and re-read every touched region
before editing.**

Per the `dev/` lifecycle rule in `CLAUDE.md`, this file does not outlive the work:
whichever of the three PRs merges last deletes it. Since the PRs are parallel and merges
are user-timed, the deletion rides the local verification pass — the local session for
the final still-open PR appends the deletion commit before reporting done. If all three
merge without it, a one-line docs PR sweeps it.

## Precondition

PR **#324** (UI-audit package P6, lightbox navigation) is finished and needs no local
handover — the user can merge it directly. Merge it **before** launching these sessions
and branch all three packages from the `main` that contains it. Only F2 has any plausible
file overlap with it (`hv-item-editor.ts`, if #324 took its optional shared-fragment
step); starting everything from a post-#324 `main` removes the question. #324's PR also
deletes `dev/ui_audit_v040_fix_plan.md` and `dev/ui_audit_v040.md` — do not resurrect
them in a rebase.

After F1–F3 merge, the v0.4.0 milestone is empty and release PR #295 (release-please)
is ready for the user to merge. release-please owns every version number — no session
hand-edits one.

## Session model

Implementation sessions run **in the cloud** — no Docker dev HA, no screenshot tooling. A
cloud session must not attempt live verification itself. The flow per package:

1. **Cloud session**: implement → run both offline gates → commit → push → **open the PR**.
2. Every package here has a handover checklist (§Verification): the cloud session's final
   message is a **handover prompt** for a local session (template below), and the PR body
   states plainly which checks are delegated to that local pass.
3. **Local session** (has the Docker dev container + the `run-haventory` skill): executes
   the checklist, and on any defect fixes it, re-runs the gates, and pushes to the same PR
   branch.
4. The **user** merges. Nobody else merges; auto-merge is never enabled.

### Kickoff prompt (per package, for a fresh cloud session)

> Read `dev/v040_followup_fix_plan.md` in full, then the GitHub issues work package
> **Fn** closes. Implement Fn exactly as scoped, on a new branch from the latest `main`.
> Follow the campaign rules and the closing protocol in the plan. Your final message is
> the handover prompt for a local verification session.

### Handover prompt template

The handover prompt must work for a cold local session with zero context:

> Check out branch `<branch>` (PR #NNN) of chrreiter/HAventory. Use the `run-haventory`
> skill to deploy the integration + card to the dev HA container. Then: `<the package's
> checklist from §Verification, expanded into concrete steps with expected outcomes>`.
> If a check fails, fix it on this branch, re-run the offline gates (backend:
> `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`, `uv run ruff check .`,
> `uv run ruff format --check .`, `uv run mypy`; frontend, in `cards/haventory-card`:
> `npx eslint .`, `npm run typecheck`, `npx vitest run`, `npm run build`), and push.
> Report each check's outcome; do not merge the PR.

## Campaign rules (every package)

- **Gates before every commit** — backend: `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`,
  `uv run ruff check .`, `uv run ruff format --check .`, `uv run mypy`. Frontend (in
  `cards/haventory-card`): `npx eslint .`, `npm run typecheck`, `npx vitest run`,
  `npm run build`. Both must be green even when the package touches only one side.
- **TDD**: every fix ships with tests — happy path plus at least one edge/error case.
  Where a package deliberately breaks an existing pin, rewrite the pin to assert the new
  behavior; never delete an assertion without a replacement.
- **Conventional Commits**; the PR title is the squash commit and is lint-enforced.
- **Comments explain constraints, not history.** No references to what code "used to" do,
  no issue numbers in code comments, no `TODO`/`FIXME`. Several existing comments become
  false under these packages (named per package) — rewrite them to state the constraint
  that then holds.
- **Docs sync**: anything visible in the WS contract updates
  `docs/backend_api_contract.md` and `docs/data_shapes.md` in the same PR.
- **Out-of-scope findings** go to GitHub issues (🔧 Task template), not into the diff.
- No file inside `custom_components/haventory/` is deleted or renamed in this campaign,
  so no `RETIRED_PATHS` entry is needed anywhere.
- Issue wiring: F1's PR body carries `Closes #310` and `Closes #309`; F2's carries
  `Closes #322`; F3's carries `Closes #318`, `Closes #316` and `Closes #315`.

## Sequencing

```
All parallel (disjoint files), after #324 merges:
  F1 — custom_components/haventory/ws.py · docs/ · tests
  F2 — hv-card-shell.ts · hv-list.ts · hv-item-editor.ts · their tests
  F3 — hv-organize-dialog.ts · ui/status.ts (comment only) · their tests
```

## Traceability

| Issue | Substance | Package |
|---|---|---|
| #310 | upload teardown blocks the event loop | F1 |
| #309 | filter docs enumerate a closed status set | F1 |
| #322 | inline editor misses shell state through `hv-list` | F2 |
| #318 | disclosures open below the fold, no scroll-into-view | F3 |
| #316 | touch sizing stops at the Statuses tab; `.glyph` collision | F3 |
| #315 | `STATUS_COLORS` comment describes a grid that never renders | F3 |

Decisions already made with the repository owner — do not relitigate in a session:
- #316 item 1 resolves as **parity**: the other three tabs adopt the Statuses tab's
  sizing and the taller mobile rows are accepted. The issue's "Statuses is the outlier
  and that is fine" alternative is explicitly not taken.
- #315 resolves as **option 1** (fix the comment); `.swatches` stays a wrapping flex row
  — the touch-target sizing from the P4 pass depends on wrapping.
- #318 keeps the location guard rendering **after the tree**; scroll-into-view makes it
  visible. Moving it beside the row is out of scope.
- #322 lands the **smallest fix that passes the regression test** (an opaque
  epoch/snapshot property on `hv-list` is the expected shape); binding the editor's full
  prop list onto `hv-list` is the outcome to avoid.

---

## F1 — Backend: upload consume/teardown off the loop, filter docs told the truth  `size S`

**Issues: #310, #309.**

### Objective

A photo or manual upload no longer runs `file_upload`'s temp-dir teardown (or its enter)
on the event loop — no `Detected blocking call` in any user's log — with the error
semantics byte-identical; and no doc enumerates the item filter's `status` values as a
closed three-slug set.

### Scope

1. **#310 — `ws_item_attachment_add`** (`custom_components/haventory/ws.py:1524-1540`).
   The `with ExitStack() as stack:` block enters and exits core's
   `process_uploaded_file(hass, file_id)` on the loop; its `@contextmanager` teardown is a
   synchronous `shutil.rmtree`. Replace the stack with an explicit enter/`try`/`finally`
   where **both halves run in the executor**:
   - `cm = process_uploaded_file(hass, msg["file_id"])`, then
     `source = await hass.async_add_executor_job(cm.__enter__)` — the
     `ValueError → NotFoundError("uploaded file not found; upload it again")` mapping
     stays scoped to exactly this call (the existing comment says why; keep its meaning).
     Do not change the message string.
   - `finally:` dispatch `cm.__exit__(None, None, None)` through the executor on every
     path — success, refused bytes, size-cap failure. Decide how teardown survives
     coroutine cancellation (a dropped WS connection mid-upload): `asyncio.shield` around
     the exit job is the small answer; whatever is chosen, a comment states the invariant
     (the temp dir must not outlive the command), not the mechanism's history.
   - The "read the item before the upload is consumed" ordering and its comment
     (`:1515-1522`) are load-bearing — leave both.
2. **`media.py` is already clean** — `async_consume_upload` offloads its reads and writes
   (`media.py:269-272`), so no change there; state that conclusion in the PR body instead
   of churning the file.
3. **#309 — docs.** `docs/data_shapes.md:215` still reads
   `` `status?: "ok"|"missing"|"needs_repair"` `` — reword to the live-set idiom its
   neighbours use (`:72` is the model): exact match against the live status set; unknown
   values are `validation_error`. Grep both docs for the three slugs enumerated as a
   closed set and fix `docs/backend_api_contract.md`'s `item/list` section if it carries
   the same leftover.

### Tests

- **Offline** (the real regression pin): the offline suite already fakes
  `process_uploaded_file` by monkeypatching `ws_mod`
  (`tests/test_ws_items_offline.py:356-392`). Extend that harness so the fake context
  manager records where its enter and exit ran (the stub `HomeAssistant`'s
  `async_add_executor_job` is observable), and assert both are dispatched through the
  executor — on success **and** on a consume failure. Keep the expired-handle test
  (`ValueError` → `not_found`) green as written.
- **Integration** (`tests/integration/test_attachments.py`): an upload round trip
  produces no `Detected blocking call` log record (caplog), and the temp directory is
  gone afterwards on success and on a refused-bytes failure.
- mypy holds `ws.py` to per-module strict — the refactor must type cleanly against the
  stubs in `stubs/`.

### Verification & closing

Both gates. Attempt `scripts/test_integration.sh` in the cloud session — if the network
policy blocks provisioning, say so in the PR and move the integration run into the
handover. PR (suggested `fix(ws): run upload consume and teardown off the event loop`).
**Handover required** — checklist in §Verification: F1.

---

## F2 — Card shell: inline editor reactivity through `hv-list`  `size S/M`

**Issue: #322.**

### Objective

Shell state the inline editor renders reaches it while it is open: a store change that
touches nothing `hv-list` binds still re-renders the editor, so the location caches,
suggestion lists, `mediaConfig`, and the save busy/error state can never go stale in the
card's inline expander.

### Scope

1. **Enumerate first, fix second** (the issue's own instruction).
   `_renderEditor` (`cards/haventory-card/src/components/hv-card-shell.ts:592-618`)
   closes over, beyond what `hv-list` binds (`.items`, `.statuses`, `.loading`,
   `.mobile`, `.editingItemId`, `.addingNew`, `.editorTemplate`, `.emptyKind` —
   `hv-card-shell.ts:1044-1056`):
   `st.areasCache`, `st.mediaConfig`, `st.locationsFlatCache`, `st.locationTreeCache`,
   `st.distinctValuesCache` (category/tag suggestions, custom field keys), `this.media`,
   `this._editorBusy`, `this._editorError`. For each, decide whether it can change while
   the inline editor is open. The location caches are the proven case (the #319
   handover's repro); `_editorBusy`/`_editorError` are the prime suspects — a save's
   busy state and failure banner reach the editor only as props through this callback.
   The earlier attempt to force a missing error banner failed to reproduce; find out
   *why* it currently works (most likely a coincident change to a bound property
   re-rendering the list) rather than trusting the coincidence.
2. **Fix** — smallest blast radius: give `hv-list` one opaque reactive property (an
   epoch counter or a state snapshot) that the shell binds from the enumerated inputs,
   so any change to them re-renders the list and re-runs the callback. The docstring at
   `hv-list.ts:129-132` — the callback exists so the list "needn't know anything about
   the edit form" — is a constraint the fix must keep true; an opaque property keeps it,
   a bound prop list would falsify it.
3. **Re-examine the `_createdLocations` hold**
   (`cards/haventory-card/src/components/hv-item-editor.ts:1042`, catch-up drop at
   `:1218-1240`). It was added to paper over exactly this staleness. With the binding
   fixed, decide: keep it as the same defence the upload path keeps (`_uploaded`'s
   catch-up at `:1099-1104` is the precedent) or remove it. Either way the surviving
   comment states the invariant, not the history.
4. The mobile "new" path (`hv-card-shell.ts:1182`) and the full view / detail sheet
   render the editor directly and are unaffected — confirm, don't change.

### Tests

- **The regression test the issue names**: mount the shell, open the inline editor,
  mutate store state that `hv-list` does not bind (deliver a locations event through the
  `hass.__emit` harness in `src/test.utils.ts`, or reject a save so `_editorError`
  flips), and assert the rendered `hv-item-editor`'s props caught up. This must fail on
  `main` before the fix.
- A save-error delivery case: a rejected save shows its banner in the open inline editor.
- Existing `hv-list` `willUpdate` pins (`editing` flag semantics) stay green as written.
- Do not disturb the P2 same-id semantics in `hv-item-editor.willUpdate` — F2 touches
  that file only for `_createdLocations`.

### Verification & closing

Both gates. PR (suggested `fix(card): deliver shell state to the inline editor through
hv-list`). **Handover (short smoke)** — checklist in §Verification: F2.

---

## F3 — Organize dialog: disclosures into view, touch parity, honest comments  `size M`

**Issues: #318, #316, #315.**

### Objective

Opening any disclosure in the organize dialog leaves it visible — a delete guard can no
longer appear below the fold looking like a dead button; every tab's row controls meet
the same touch sizing the Statuses tab already has; `.glyph` means exactly one thing; and
the `STATUS_COLORS` comment describes the layout that actually renders.

All in `cards/haventory-card/src/components/hv-organize-dialog.ts` unless noted. The file
has no `@media` queries — narrow-width rules ride `:host([mobile])`. Stay inside that
idiom.

### Scope

1. **#318 — scroll-into-view.** Five disclosure states render below their trigger, inside
   the scrolling `.body`, with no scroll anywhere in `src/`: `_editingLocation` (`:648`),
   `_guard` (`:654`), `_editingValue` (`:662`), `_editingStatus` (`:668`), `_statusGuard`
   (`:674`). Extend the existing `updated()` (`:705-715`) — it already syncs
   `DialogFocus` and writes the area select's value; compose with it, don't replace it.
   Track the previous disclosure state and, on a null→set transition (or identity
   change), call `scrollIntoView({ block: 'nearest' })` on the newly rendered element —
   `nearest`, so an already-visible disclosure does not move under the user, and no
   `behavior: 'smooth'`, so there is no motion to gate on reduced-motion. A scroll must
   fire once per open, never on unrelated re-renders (typing in an editor must not jump
   the pane). Guards keep `role="alert"` and never steal focus; the three **editors** are
   forms — their first field takes focus on open (`ui/dialog-focus.ts` is the precedent),
   so keyboard users aren't left behind on the row's button. Give the editors stable
   testids if any lack one; `location-guard` and `status-guard` exist.
2. **#316 item 1 — touch parity across tabs.** Promote the Statuses-tab sizing to the
   shared selectors instead of duplicating it per tab: the `.status-row .count-link`
   block (`:394-401`) becomes plain `.count-link`, and
   `:host([mobile]) .status-row .row-actions button` (`:431-434`) becomes
   `:host([mobile]) .row-actions button` — every tab's count links get the 24px floor
   (44px tap-min on mobile) and every tab's row-action buttons get tap-min on mobile.
   The taller mobile rows on Locations / Categories / Tags are the accepted cost. The
   comment at `:392-394` ("Confined to the status rows…") becomes false — rewrite it to
   state the constraint that then holds (12px text needs a told-to-be-bigger box).
3. **#316 item 2 — unpick `.glyph`.** The location guard's alert mark
   (`:1368` — `<span class="glyph">${icon('alert', 17)}</span>`) borrows the icon-picker
   button's class and with it a border box and pointer cursor. Give it its own class
   (warn colour, `flex: none`, nothing else), delete `.guard .glyph` (`:533-536`), and
   let `.glyph` mean only the picker button. The scoping comment at `:366-367` (".glyph
   also marks the location guard's alert") and the defensive
   `:host([mobile]) .swatches .glyph` scoping exist only because of the collision —
   simplify both once it is gone.
4. **#315 — `STATUS_COLORS` comment**
   (`cards/haventory-card/src/ui/status.ts:34-40`). The "five-by-two picker grid, hue
   across, intensity down" claim describes a layout `.swatches` (flex-wrap, `:325-330`)
   never produces, and is self-inconsistent besides. Rewrite: hue-major ordering keeps a
   hue's light and strong forms adjacent, so in a wrapping row each pair reads as one hue
   at two intensities. Keep the sentence about the backend pin
   (`tests/test_frontend_registration.py`) — it stays true. No layout change.

### Tests

- scrollIntoView per disclosure: jsdom doesn't implement it — stub it on the element (or
  prototype), assert one call per open, none on an unrelated re-render while open, and
  none when the same disclosure re-renders. One case per disclosure kind plus the
  no-move case.
- Editor focus: opening a status/location/value editor puts focus in its first field
  (the existing `DialogFocus` tests are the model).
- cssText pins: base `.count-link` min-height; the mobile tap-min rules no longer scoped
  to `.status-row`; the guard's mark class carries `--hv-warn` and `flex: none` and no
  border/cursor. Grep `hv-organize-dialog.test.ts` for pins on the old `.status-row`-
  scoped selectors and rewrite them deliberately.
- Existing swatch pins (`hv-organize-dialog.test.ts:1136`, `:1168`, `:1196`) stay green —
  swatches are untouched.

### Traps

- `--hv-tap-min` is deliberately **not** declared in `tokens`
  (`hv-card-shell.test.ts` pins its absence) — consume it, never declare it.
- Whether the disclosure actually ends up visible cannot be proven in jsdom — the offline
  tests assert the call; the live handover is the acceptance. Same category as the
  sticky-column work.

### Verification & closing

Both gates. PR (suggested `fix(card): scroll organize-dialog disclosures into view;
touch parity across all tabs`). **Handover required** — checklist in §Verification: F3.

---

## Verification — per-package handover checklists

Every PR runs both offline gates regardless. The checklists below are what the **local**
session (Docker dev HA + `run-haventory` skill) executes after the cloud session opens
the PR. The user merges only after this pass.

| Pkg | Handover | Checklist |
|---|---|---|
| F1 | **Required** | Run `scripts/test_integration.sh` if the cloud session could not. Deploy to the dev HA; upload a photo and a PDF manual through the real card flow (`scripts/probe_attachments.py` drives it); sweep the HA log — zero `Detected blocking call` entries. Verify the temp dir is gone after success and after a refused-bytes upload, and that a consumed/expired `file_id` still returns "uploaded file not found; upload it again". |
| F2 | Short smoke | Desktop card (the shell list, not the full view), empty install: open the inline editor, create a location from the picker's empty state — the Location field updates in place, the form stays open. Force a save error (bump the item's version from a second surface, then save) — the error banner appears inside the open inline editor and the busy state clears. |
| F3 | **Required** | 390px + desktop, with long fixtures (a location tree, tag list and status list each taller than the panel): open every disclosure type from the **bottom** row of each tab — each lands visible with no manual scrolling, and an already-visible one doesn't move. DOM-measure count links and row-action buttons on all four tabs: ≥24px desktop, ≥44px mobile. Location delete guard's alert mark: warn colour, no border box, no pointer cursor. Screenshots (light + dark, 390px) of a Locations and a Tags row so the accepted row-height increase is visible at merge time. |
