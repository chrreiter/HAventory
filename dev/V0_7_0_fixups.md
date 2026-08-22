# V0.7.0 fixups — one local session

S11 closed the V0.7.0 online pass with four findings it did not fix: #559, #560 and #562
filed against V0.8.0 because none of them is a regression, and #563 filed with no
milestone because it is a feature. On 2026-08-22 the owner decided all four ship in
**0.7.0**. This plan is that work.

It is written for **one uninterrupted local session** on the owner's Windows host, with
the dev Home Assistant and a browser at hand. That is not a preference: every one of the
four needs a check no cloud session can make — a German calendar card, a 375 px sheet, a
keyboard walk through a real tree, and a throttled link with real photographs on it.

Two things this session never touches: **release-please's #491** (it regenerates its own
changelog from the commits this session merges, and the version does not move — 0.7.0 is
already a minor bump from 0.6.0, so another `feat:` or `perf:` still releases as 0.7.0),
and **anything outside these four issues**. #540's wording pass, the rest of V0.8.0 and
whatever this session trips over on the way stay where they are; findings go in the
Follow-ups note and become issues only if they clear CLAUDE.md's real-world bar.

The plan file is deleted by the session's last PR, the way the milestone plans are.

## 1. What the tree says, against what the issues say

The issues were written from the running product. Four of their claims do not survive a
read of the source, and two of the four change the design — so they are here rather than
in a comment nobody opens.

**#563: "Pillow is already in the upload path."** It is not. `const.py:176` states the
opposite in so many words — *"Nothing is thumbnailed server-side — Pillow is not a
dependency"* — and `manifest.json` declares `"requirements": []`. The 2048 px cap the
issue quotes is the **card's** canvas re-encode (`cards/haventory-card/src/ui/downscale.ts`),
which runs in the browser and only above 2 MiB. Pillow is in `pyproject.toml` only as the
non-default `probes` group, for `scripts/probe_attachments.py`.

Pillow *is* present in the Home Assistant container: `ghcr.io/home-assistant/home-assistant:stable`
answers `PIL 12.2.0` today (checked 2026-08-22 on the dev instance), because core
integrations under `default_config` pull it in. It is not ours to rely on, and a pinned
`Pillow==x.y.z` in our manifest could fight core's pin. §2.F4 takes the third road: import
it lazily and serve the original when it is not there.

**#559: "the tree already handles arrow keys per row."** It does not.
`hv-location-tree.ts:480` answers Enter and Space and returns on everything else. The
roving tabindex *and* the arrow-key layer both have to be written.

**#559: "every area head … is its own tab stop."** Area heads carry `role="treeitem"` with
no `tabindex` (`hv-location-tree.ts:630`), so they are not stops. What is: every location
row (`tabindex=${isExcluded ? -1 : 0}`, `:473`), every twisty `<button>`, every area
twisty, and — where areas are pickable — `tree-area-select`. The count in the issue is
right; the parts it names are not.

**#560: "something in the full view's narrow branch gives it more height than the bar."**
Nothing in the read of the CSS explains it: `.bar` is `display:flex; align-items:center`
and `.save` is a plain 40 px pill (`hv-detail-sheet.ts:71-129`). What is different about
edit mode is `?noHandle=${this._mode === 'edit'}` on the `hv-bottom-sheet` around it
(`:911`), whose panel is `max-height:92dvh` with rounded top corners over a scrolling
`.content`. The issue's own instruction stands: **measure before touching**.

## 2. The four fixes

Each is one PR, on a branch `claude/v0-7-0-fix-<topic>` off `origin/main`, with
`Closes #NNN` in the body.

### F1 — #562: the calendar speaks the server's language

`calendar_projection.py:133-190` builds three summaries as literals: `f"{item.name} due
back"`, `f"{item.name} inspection"`, `f"{item.name} reminder"`. `calendar.py` passes them
through to `CalendarEvent` and to the entity's `message` attribute, which is what a
notification automation templates.

**Design.**

- A `calendar` section in `strings.json` with three patterns carrying a `{name}`
  placeholder — `due`, `inspection`, `reminder` — so German can put the noun where German
  puts it rather than after the name. `translations/en.json` mirrors it,
  `translations/de.json` translates it; `tests/test_config_flow_offline.py:459` already
  fails a language that does not mirror `strings.json`, and `:485` already fails one whose
  placeholders differ, so both files are held to it without new tests.
- `build_events` and `next_event` take the three patterns as an argument — a small frozen
  mapping, defaulting to today's English — so `calendar_projection.py` stays pure and
  every existing test keeps its meaning.
- `calendar.py` resolves them **once**, in `async_added_to_hass`, through
  `homeassistant.helpers.translation.async_get_translations(hass, hass.config.language,
  "calendar", integrations=[DOMAIN])`, and holds them on the entity. Once, because
  `CalendarEntity.event` is a synchronous property and cannot await; on the entity,
  because the server's language changes about as often as the server is restarted.
  Verified against the running core: `helpers/translation.py`'s `build_resources` takes
  **any** top-level section of the file as a category, and the loader carries English
  under the requested language, so a key German is missing falls back on its own.
- `tests/conftest.py` gains a `homeassistant.helpers.translation` stub. The offline stub
  is hand-built and diverges from real HA on exactly this kind of seam, so the phacc test
  below is what proves the real path, not the offline one.

**Tests.** Offline: the patterns are applied, the English default is what an un-passed
call still produces, a language with a missing key falls back. phacc
(`tests/integration/test_calendar.py`): with `hass.config.language = "de"` the summary and
the `message` attribute are German — that file already asserts both in English at `:98`
and `:128`.

**Docs.** `docs/automations.md:110` names `Ladder due back` in a table of what the calendar
shows; it gains the sentence that the summary is written in the server's language.

**Live check.** Dev HA set to Deutsch, the `Kalender` view S11 left on the dev dashboard:
the events read German. Set it back to the language it was in before the session ends.

**Risk.** Low. Contained to two modules, one dictionary and one stub.

### F2 — #560: the Save pill, whole

**Step 1 is a measurement, not an edit.** At 375 px on `/haventory`, open a row and go to
Bearbeiten, then read `getBoundingClientRect()` for the sheet `.panel`, `.bar.edit` and
`[data-testid="sheet-save"]`, and the computed `padding`, `margin`, `align-items` and
`overflow` of every ancestor between the pill and the panel. Those numbers go in the PR
body: the fix is only believable next to them, and the issue's guess at the cause is
explicitly a guess.

**Step 2 is the smallest change those numbers justify** — and no more. Whatever it is, it
holds in both languages and at both themes, and it does not move the read-mode bar, which
is fine today.

**Step 3, from the same issue body:** in German the sheet's footer wraps "Speichern" onto
its own line under "Gegenstand löschen · Abbrechen". That is the long-label tightness
#558 was, and the fix is the same shape — let the delete action shrink rather than let the
row wrap. In scope here because it is the same surface in the same session; out of scope
is any change to the words, which is #540's.

**Tests.** A `componentCss` regex on the rule that does the work — the shape #561 used for
the same class of bug — plus whatever structural assertion the change earns. jsdom does
not lay out, so the picture proof is a before/after screenshot pair on the assets branch,
in both languages.

**Risk.** Low, once measured. The measurement is the part that can surprise.

### F3 — #559: one tab stop for the tree

The ARIA tree pattern is one tab stop with a roving tabindex: Tab lands on the tree once,
the arrows move inside it, Tab leaves it. `hv-location-tree` has neither half.

**Design.**

- `_activeId` state: the active node is the selected one, else the first visible row. It
  carries `tabindex="0"`; every other row, and every area head that joins the walk, carries
  `-1`. Exactly one node is a stop at any moment, always.
- Keys on the tree: ↓/↑ to the next/previous **visible** row (area heads included, so ↑
  from a first root reaches its area), → expands a closed node or steps into an open one,
  ← collapses an open node or steps to the parent, Home/End to the ends. Enter and Space
  keep doing what they do. Focus follows the active node.
- `tree-twisty`, `tree-area-twisty`, `tree-area-select`, `tree-more` and `tree-merge`
  become `tabindex="-1"`. They stay clickable, and the keys above reach what they do; the
  row is the stop.
- An empty tree leaves `tree-create` as the stop, so the tree is never a hole in the tab
  order.

**Six hosts mount this component** — `hv-full-view`, `hv-filter-panel`,
`hv-organize-dialog`, `hv-item-editor`, `hv-bulk-bar` and the panel through the full view
— and a roving tabindex changes what a dialog's initial focus lands on. `ui/dialog-focus.ts`
is the thing most likely to shift; each host gets a keyboard check in the browser, not
just a unit test.

**Tests.** Exactly one `tabindex="0"` in any rendered tree; ↓ moves it and moves focus; the
twisty is not a stop; Enter still selects; ← on an open node collapses it and keeps focus;
an empty tree leaves the create button focusable.

**Acceptance, measured.** From the search box on the seeded household, Tab reaches the
first table row in **at most 12 presses** (S11 counted more than forty and gave up). The
number is taken by a harness run, not by eye.

**Risk.** Medium — one component, six hosts, and focus is the kind of thing unit tests
agree with while the product disagrees.

### F4 — #563: a thumbnail that is a thumbnail

A row tile is 34–40 px and downloads the whole picture: up to 2 MiB per row, because the
card only re-encodes above that and the server stores what it is sent. S11 measured what
that costs on a throttled link — a search took 20 s to settle at 500 ms / 50 KB/s with 30
photographed items on the page.

**Design — lazy, server-side, optional Pillow. No store change, no schema bump, no
manifest change.**

- **Route.** `GET /api/haventory/media/{item_id}/{attachment_id}?size=thumb`. One accepted
  value; any other is a 400 rather than an invitation to generate arbitrary sizes. Home
  Assistant signs the path **and** its non-safe query params
  (`homeassistant/components/http/auth.py:78-94`), and the card already signs paths
  carrying `v=`, so the variant simply joins the string handed to `signPath`.
- **Bytes.** Longest edge 256 px, WebP, quality about 80, oriented through
  `ImageOps.exif_transpose`, written once beside the original as
  `<attachment_id>.thumb.webp` and served from there afterwards. Encoding happens in the
  executor, under one lock per attachment so two tabs asking at the same moment encode
  once.
- **Fail open, every time.** No Pillow, an animated GIF, a manual, an undecodable file, a
  directory that will not take a write — serve the original. This is what makes the
  feature safe with no manifest requirement: the container ships Pillow today, a minimal
  install may not, and an install without it must still show its pictures.
- **The two places that must learn about the new file.** `referenced_paths`
  (`media.py:236`) — the sweep deletes every file it does not name, so an unlisted thumb
  is deleted on the next sweep and re-encoded on the next page. And
  `async_delete_attachments` (`:277`) — a removed attachment takes its thumb with it.
- **Cache-Control** follows the existing rule unchanged (`media.py:340`): with the `v`
  name token, immutable; without it, `no-store`.
- **Card.** A `thumb` variant on `mediaPath` and on `MediaUrls.get`, whose cache key gains
  the variant (`${itemId}/${attachmentId}` today, `media.ts:222-275`) while `failed` and
  `presence` stay keyed on the attachment — presence is a question about the file, not
  about the size. The variant is used by `hv-data-table.ts:441` and `hv-list-row.ts:422`,
  and by the editor's picture tiles (`hv-item-editor.ts:2336`); the lightbox
  (`hv-lightbox.ts:175`) and the detail sheet's large picture (`hv-detail-sheet.ts:554`)
  keep the original.
- **Three comments stop being true** and are rewritten in the same PR: `const.py:176`,
  `hv-data-table.ts:434`, `hv-list-row.ts:415`. So does `docs/data_shapes.md:219`
  ("Nothing is thumbnailed server-side"), and the media route's paragraph in
  `docs/backend_api_contract.md` gains the parameter.

**Tests.** Offline (`tests/test_media_offline.py`): a thumb is generated and then reused;
Pillow missing serves the original; a GIF and a manual serve the original; an unknown
`size` is a 400; the sweep keeps a live thumb and removes an orphaned one; deleting an
attachment deletes its thumb. Card: the two row renderers and the editor tile ask for the
variant, the lightbox does not. phacc: one end-to-end request through the real view.

**Acceptance, measured.** The S11 throttle scenario re-run at 500 ms / 50 KB/s on the
seeded household: the search settles in a small fraction of the 20 s it took, and the
number goes in the PR body next to the old one. The first-request cost on a store with no
thumbs yet (42 attachments) is measured and stated too — that is the one-off this design
trades for.

**Commit type** `perf(media):`. The version does not move either way; the changelog line
should read as what it is.

**Risk.** The highest of the four: two languages of code, a file on disk that a sweep can
eat, and an optional dependency. It is last in the order for that reason.

## 3. Order, and what gives if the session runs long

**F1 → F2 → F3 → F4.** Three certain closes first, the one that can overrun last, where an
overrun costs least. F1 is backend-only and needs no browser; F2 and F3 are the card with
the browser warm at 375 px; F4 is both halves plus a measurement.

If F4 cannot land clean, it does not land: open the PR, mark it in its body as not ready,
put #563 back on V0.8.0, and say so in the handover. Three of four in 0.7.0 with an honest
note beats four with one of them hurried — the thing being traded away is a photograph
downloading slowly, and the thing at risk is the media store.

The same rule, smaller, inside F4: the editor's picture tiles are the half to drop if the
row renderers are working and time is short.

## 4. Rules

Everything the V0.7.0 plan asked of a session still holds. In full, because that file is
gone:

- **Branches and PRs.** One branch per fix, `claude/v0-7-0-fix-<topic>`, off
  `origin/main`. Work in a **git worktree** — this clone has a concurrent V0.8.0 planning
  session in it. Conventional-Commit PR titles (CI fails the title, and it cannot be
  caught locally). Fill in `.github/pull_request_template.md`; the PR body is the review
  record and carries the handover as its last section. `Closes #NNN`.
- **TDD.** Every fix ships tests — the happy path and at least one edge or error case.
- **The gate, before every commit.** Both halves green:

  ```bash
  PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q
  uv run ruff check . && uv run ruff format --check . && uv run mypy
  cd cards/haventory-card && npx eslint . && npm run typecheck && npx vitest run && npm run build
  ```

- **phacc** is required for F1 and F4 (anything under `custom_components/`). On this host
  it runs in the container recipe from CLAUDE.md, not natively. Build the card first or
  `tests/integration/test_frontend.py` skips half its cases.
- **Merging.** The session squash-merges its own PR once both gates, phacc where required,
  CI and that fix's live check are green. Nothing else is merged, ever: **release-please's
  #491 is not merged, edited or closed.**
- **Never** `git add -A`, never `--no-verify`, never a secret in a file — `HA_TOKEN` is
  per session and lives in the worktree's `.env`, which is gitignored.
- **Comments encode constraints, not history**, and everything written here — commits,
  PR bodies, issue comments — uses plain words.
- Screenshots go on an orphan `claude-assets-v0-7-0-fixups` branch (commit with the
  GitHub noreply address or the push is refused) and are linked from the PR bodies.

## 5. Verification

**Per PR:** both gates, phacc where §4 requires it, CI, and the fix's own live check from
§2.

**The closing pass** — not a second S11, which already ran; just the surfaces these four
changes touch. After the last merge, deploy `main` into the dev HA and:

1. `driver.py status` — the integration loaded, health clean.
2. `visual_pass.mjs` light and dark — 42/42, no console errors.
3. The photo flow and the calendar flow, in German.
4. The keyboard walk of F3's acceptance, and the throttle measurement of F4's.
5. `log_sweep.py --since 60m` — verdict PASS.
6. `stress.py baseline`.

**Restore what the session changed** on the dev HA: the profile and server language, the
inventory if a test moved it, and anything the harnesses switched. S11's household (558
items, 92 locations, 42 attachments, the bridge on `todo.shopping_list`) is what the
instance held at the start.

## 6. Tracker bookkeeping

- **The four issues move to milestone V0.7.0** — done when this plan was filed, so the
  milestone reads correctly while the work is in flight.
- **PR #570, the V0.8.0 session plan, still lists three of them** among its sessions and
  keeps #563 out in its pre-flight. It is open and owned elsewhere, so this session does
  not edit its branch. If #570 has merged by the time the fixes are in, the last PR takes
  the four out of `dev/V0_8_0_implementation.md` in one edit; if it is still open, a
  comment on it is the notice and the owner folds it in.
- **#491** is untouched and regenerates its own changelog from the merged commits.
- **#236's V0.7.0 line** gains a short comment when the four are closed: what shipped and
  what it was measured at.
- Each issue is closed by its PR, not by hand.

## 7. Done

The milestone is done when: the four issues are closed by merged PRs; both gates, phacc
and CI are green on `main`; the closing pass of §5 has run; #236 carries the comment; the
dev HA is back to the state it was found in; and this file is deleted by the last PR
(`chore(dev): retire the V0.7.0 fixup plan`).

The session's final message ends with `## Handover`, repeated as the last section of every
PR body it opens. Five parts, each present even when short:

1. **Merged / left open** — PR links, and for anything left open, why.
2. **Test this by hand** — what the session could not: a real phone, the production
   upgrade, German a native reader catches. Tagged `[phone]`, `[HA settings]`,
   `[desktop]`, `[log]`.
3. **Decisions taken against drifted notes** — one line each. §1's four corrections are
   the ones already known.
4. **Follow-ups** — filed (links) or named and not filed, with the reason.
5. **State left behind** — branches, the assets branch, the dev HA, anything the next
   session must know.

## 8. The prompt

One paste, as the first message of a new local session.

```
Model: Opus 5, effort xhigh. Local session — the dev Home Assistant and a browser are
required.

You are the V0.7.0 fixup session, dev/V0_7_0_fixups.md in this repository — read it in
full first, then CLAUDE.md and CONTRIBUTING.md, and skim dev/release_testing_plan.md.
Use the run-haventory and test-haventory skills. Start condition: #559, #560, #562 and
#563 are open on milestone V0.7.0, and the only open PRs are release-please's #491 and
possibly #570. If that does not hold, stop and say what you found.

Fix the four, in §3's order, one PR each under §4's rules: the calendar's summaries in
the server's language (#562), the clipped Save pill and the German footer on the phone
sheet (#560), one tab stop for the locations tree (#559), and server-side thumbnails
(#563). §2 carries each design, its tests, its docs and its live check; §1 lists four
claims in the issues that the source does not support — trust §1, and grep for the
symbol rather than the line.

F2 begins with a measurement, not an edit. F4 is last and is the one allowed to not
land: if it cannot be clean, leave the PR open, put #563 back on V0.8.0 and say so.

Then §5's closing pass, §6's bookkeeping, and a last PR deleting dev/V0_7_0_fixups.md.
Never merge, edit or close #491.

End with the five-part handover of §7 in your final message.
```
