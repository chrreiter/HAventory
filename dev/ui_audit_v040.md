# UI/UX audit for the v0.4.0 optimization pass

Audited on 2026-08-06 against `main` @ `1798946` (PR #299), deployed to the dev HA
container and driven in Chromium (Playwright) — light/dark × desktop/mobile.
The consolidated ranked list is directly below; the detailed findings follow, grouped
by audit tier. Screenshot files live in the session scratchpad (`shots/`) and the
skill directory (`audit/`, `audit-dark/`); filenames are cited per finding.

Not re-reported here: #300 (manuals download under their UUID), #301 (`.hv-chip.state`
contrast, 22px `editor-photo-remove` target), #190 (seeded status labels are English).

## Ranked summary (most severe first)

| # | Severity | Finding |
|---|----------|---------|
| 1 | blocker | A completed upload silently discards unsaved edits; on mobile every attachment mutation closes the editor outright (`willUpdate` resets in `hv-item-editor` + `hv-detail-sheet`) |
| 2 | blocker | Deleting a status with reassignment crashes the items-event handler (`payload=None` vs `evt.item.id`) — 40 rows and all counts stay stale |
| 3 | blocker | Sidebar Status facet claims 998 items for every custom status, including one with zero (`tallyFor` legacy math) |
| 4 | should-fix | A refused file's error + Retry vanish when a later upload in the batch succeeds (same root as #1) |
| 5 | should-fix | Status delete guard keeps desktop columns on mobile; the reassignment select clips to "O⌄" |
| 6 | should-fix | Status count link opens the full view without applying the filter |
| 7 | should-fix | Removing a photo/manual is a one-tap permanent delete with no confirmation |
| 8 | should-fix | Escape with an open dropdown discards the whole form without confirmation |
| 9 | should-fix | First run: the location picker on an empty install is a dead end |
| 10 | should-fix | Reorder chevrons 15×15px and other Statuses-tab controls far under touch minimums |
| 11 | should-fix | Colour swatches are bare tint circles — near-indistinguishable, worse in dark |
| 12 | should-fix | The default status (`ok`) cannot be renamed or recoloured from the UI |
| 13 | should-fix | Duplicate status labels are accepted silently (`sold_2`) |
| 14 | should-fix | Upload progress is a bare word — no bar/spinner for multi-MB photos |
| 15 | should-fix | The photo lightbox cannot navigate (no swipe/arrows/counter) |
| 16 | should-fix | Mobile data table scrolls horizontally but the name column scrolls away |
| 17 | should-fix | Table name column collapses to "Kärc…" while tags keep full width; status chip hard-clips |
| 18 | should-fix | Status filter chips price only the two legacy statuses |
| 19 | should-fix | App bar pins "missing"/"needs repair" in the fixed chore vocabulary |
| 20 | should-fix | The blue status tone is pixel-identical to the "Checked out" state chip |
| 21 | polish | Slug preview truncates to the point of not carrying its information |
| 22 | polish | Untitled documents render their filename twice per row |
| 23 | polish | List rows indent names only when a photo exists; document marker floats |
| 24 | polish | A new item cannot take photos/documents until saved, with no hint |
| 25 | polish | Sort controls buried below the tag cloud in the filter panel |
| 26 | polish | Applied status-filter chip renders in chore amber regardless of tone |
| 27 | polish | A strong-blue status chip is visually identical to primary action styling |

## Findings

### Tier 1 — Status management (organize dialog, Statuses tab)

Fixture at capture time: 8 statuses — the seeded three plus `gesperrt` (red),
`lent_out_to_the_neighbours` (blue, 100 items), `sold` (neutral_strong, 1),
`in_transit` (blue_strong, 0), `giveaway` "Zu verschenken" (amber_strong, 40).

### Status delete guard keeps its desktop columns on mobile and clips the reassignment select
- **Severity**: should-fix
- **Kind**: visual bug
- **Surface**: `status-guard` / `status-reassign` in `hv-organize-dialog`, mobile (390px), light — dark identical
- **Evidence**: `shots/t1-status/lm-delete-guard-40.png` — the guard for "Zu verschenken" (40 items) squeezes message, label, select, Cancel and "Reassign and delete" into one row; the select renders ~44px wide showing only "O⌄" (the value "OK" is clipped), the message wraps into a 3-line sliver, and the action button wraps to three lines. At desktop width the middle label already wraps to three lines (`ld-delete-guard-40.png`).
- **What's wrong**: the guard row never stacks; five flex children fight over ~360px.
- **Why it matters**: the one thing this guard exists to make legible — *where 40 items are about to go* — is unreadable on a phone before the destructive click.
- **Suggested change**: in `hv-organize-dialog.ts` styles, let the guard stack vertically (message, then "Move those items to" + select on one line, then actions) below the dialog's narrow breakpoint; give the select a sensible min-width at all widths.
- **Confidence**: confirmed in a screenshot

### The default status cannot be renamed or recoloured from the UI
- **Severity**: should-fix
- **Kind**: flow friction / inconsistency
- **Surface**: `status-row` for `ok` / `status-default`, all themes and widths
- **Evidence**: `shots/t1-status/light-mobile-statuses-rest-view.png` — every row carries pencil + trash except `ok`, which shows only a "Default" pill; there is no edit affordance at any width (`hv-organize-dialog.ts:1575` renders the pill *instead of* the buttons).
- **What's wrong**: `haventory/status/update` accepts label/colour/icon changes for any slug, and `src/ui/status.ts` explicitly documents that built-ins may be renamed/recoloured — but the UI blocks it for the default.
- **Why it matters**: `ok` now seeds green; a household that wants a quieter default (or a non-English label, pending #190) has no UI path at all — delete is rightly withheld for the default, but edit went with it.
- **Suggested change**: render the edit button alongside the "Default" pill; keep only delete withheld.
- **Confidence**: confirmed in a screenshot (and source)

### Creating a status with an existing label silently mints "label_2" instead of warning
- **Severity**: should-fix
- **Kind**: flow friction
- **Surface**: `status-editor` / `status-slug-preview` (new-status path), all combos
- **Evidence**: `shots/t1-status/ld-editor-new-dup-label.png` — label "Sold" while `sold` exists; the DOM slug preview reads `sold_2` (verified by text extraction; "OK" similarly yields `ok_2`). Nothing states the label collides.
- **What's wrong**: the collision is resolved on the identifier, which is invisible everywhere labels render; the UI accepts two statuses labelled identically.
- **Why it matters**: two "Sold" chips are indistinguishable in every list row, filter chip, editor select and stats row — a user cannot tell which one an item carries or which filter they applied.
- **Suggested change**: when the trimmed label case-insensitively equals an existing status label, show an inline hint in `status-editor` ("A status called 'Sold' already exists") before Create; keep the slug dedupe as backstop.
- **Confidence**: confirmed in a screenshot + DOM text

### Colour swatches are bare tint circles — the five light tones are near-indistinguishable, and in dark mode they read as black/brown blobs
- **Severity**: should-fix
- **Kind**: visual bug / a11y
- **Surface**: `status-colors` / `status-color` in `hv-organize-dialog`, worst in dark
- **Evidence**: `shots/t1-status/ld-editor-open.png` — light theme: `neutral`, `green`, `amber`, `red` tints are four barely-differing pastel circles on white. `shots/t1-status/dd-editor-open.png` — dark theme: the same four render as near-black circles (the amber tint reads as brown, the neutral tint is practically invisible against the panel).
- **What's wrong**: a status tone is a *pair* (tint background + deep ink) but the swatch shows only the background, which is exactly the half that carries the least identity — and the dark-mode halves of the light tones are translucent washes never meant to stand alone.
- **Why it matters**: the picker is the only place a household chooses the colour vocabulary; in dark mode choosing between "amber" and "red" light tones is guesswork.
- **Suggested change**: paint each swatch as a miniature chip — tint background *with* its ink (e.g. the currently selected glyph or an "Aa") — so both halves of the tone show; this also separates light from strong at a glance.
- **Confidence**: confirmed in screenshots
- Note on `tone-contrast.test.ts`: it asserts fg/bg contrast *within a chip*, which is not the failing pair here (swatch fill vs. panel background); a swatch-vs-surface distinctiveness check is outside what that test could catch, so no test gap — the gap is that the swatch omits the fg half entirely.

### Reorder chevrons and other Statuses-tab controls are far below minimum touch-target size
- **Severity**: should-fix
- **Kind**: a11y
- **Surface**: `status-up`/`status-down`, `status-edit`/`status-remove`, `status-color`, `status-count` — mobile
- **Evidence**: `shots/t1-status/lm-editor-open.png`; DOM-measured on iPhone-15 emulation: `status-up`/`status-down` **15×15px**, `status-edit`/`status-remove` 26×26px, `status-color` swatches 26×22px, `status-count` link 53×**14**px. WCAG 2.2 AA minimum is 24×24; platform guidance is 44–48px.
- **What's wrong**: the move chevrons are quarter-size touch targets stacked 0px apart, so a "move down" tap lands on "move up"; the ten colour swatches compress into one row instead of wrapping (the icon row *does* wrap — see the 9+1 wrap in the same shot).
- **Why it matters**: reordering — the tab's core interaction after naming — is effectively unusable with a finger; mis-taps reorder the wrong way with no undo.
- **Suggested change**: give the move buttons `--hv-tap-min` sizing on coarse pointers, and let `.swatches` (colour row) wrap like the icon row so swatches keep ≥40px.
- **Confidence**: confirmed in a screenshot + DOM measurement

### The slug preview truncates to the point of not carrying its own information
- **Severity**: polish
- **Kind**: visual bug
- **Surface**: `status-slug-preview` (and row `status-slug` on mobile), all combos
- **Evidence**: `shots/t1-status/ld-editor-new-dup-label.png` — preview renders "sold…" for the six-character slug `sold_2` while the row has free width; `ld-editor-open.png` — `lent_out_the_neighbours` truncates at ~19 chars on a 1240px dialog; on mobile the row slug collapses to "le…" (`light-mobile-statuses-rest-view.png`).
- **What's wrong**: the element exists (per its own source comment) for people writing automations, and it hides exactly that identifier.
- **Why it matters**: an automation author has to leave the dialog (export or dev-tools) to learn the slug they were just shown.
- **Suggested change**: let the preview take the free row width / wrap under the input on narrow widths; add `title` with the full slug.
- **Confidence**: confirmed in screenshots

### Tier 1 — Status appearance across the card

### Sidebar Status facet claims 998 items for every custom status — including one that has zero
- **Severity**: blocker
- **Kind**: visual bug (wrong data)
- **Surface**: `sidebar-status-row` in `hv-full-view` (desktop full view / panel), both themes
- **Evidence**: `shots/t1-chips/sidebar-status-facet3.png`; DOM extraction of the facet reads "OK 998 ;; Missing 3 ;; Needs repair 3 ;; Gesperrt 998 ;; Lent out to the neighbours 998 ;; Sold 998 ;; In transit 998 ;; Zu verschenken 998". True counts at capture time: ok 856, gesperrt 1, lent… 100, sold 1, in_transit **0**, giveaway 40.
- **What's wrong**: `tallyFor` ([hv-full-view.ts:1168](cards/haventory-card/src/components/hv-full-view.ts#L1168)) prices only the two legacy slugs from `missing_count`/`needs_repair_count` and returns `items_total − missing − needs_repair` for *everything else* — written when "everything else" meant OK, now applied to every user-defined status the facet iterates. The comment above the section head ("this one always holds three") documents the same stale assumption.
- **Why it matters**: the facet is the full view's primary status navigation; it tells a user 998 items are "In transit" when none are. Clicking it then shows 0 rows — the UI contradicts itself in one screen.
- **Suggested change**: read `statsCounts.status_counts[slug]` (the payload the organize tab already uses) with the legacy-fields fallback only for pre-v6 backends; update the stale comment.
- **Confidence**: confirmed in a screenshot + DOM + source

### Status filter chips show counts only for the two legacy statuses
- **Severity**: should-fix
- **Kind**: inconsistency
- **Surface**: `filter-status` chips in the card filter panel (both layouts), both themes
- **Evidence**: `shots/t1-chips/card-filter-status-row.png` — STATUS row renders "OK · Missing 3 · Needs repair 3 · Gesperrt · Lent out to the neighbours · Sold · In transit · Zu verschenken"; only the legacy two carry counts while the SHOW ONLY row above prices every chip (133/175/73/73/44).
- **What's wrong**: same legacy derivation as the sidebar facet, in its milder form — unknown slugs get *no* count rather than a wrong one.
- **Why it matters**: a user choosing which status to filter by can't see which are non-empty; next to fully-priced SHOW ONLY chips it reads as if custom statuses were second-class.
- **Suggested change**: price all status chips from `status_counts`.
- **Confidence**: confirmed in a screenshot + DOM

### Full-view app bar pins "missing"/"needs repair" in the fixed chore vocabulary while statuses are user-definable
- **Severity**: should-fix
- **Kind**: inconsistency
- **Surface**: app-bar chips in `hv-full-view`, both themes
- **Evidence**: `shots/t1-chips/ld-full-view-table.png`; DOM classes read `hv-chip pill warning` for "3 missing" and "3 needs repair" — the same species as "133 low" and "73 to inspect".
- **What's wrong**: two *status* tallies render as fixed amber chore chips, indistinguishable from genuine chores, with hard-coded labels and hue. Rename or recolour those statuses (the UI allows both) and the app bar keeps saying "3 missing" in amber — disconnected from the chips everywhere else.
- **Why it matters**: the app bar is the one row where the fixed vocabulary and the user-chosen vocabulary now collide; it teaches "amber pill = chore" and then uses amber pills for statuses.
- **Suggested change**: either drop the two status tallies from the app bar (the facet/filters own status) or render them via `renderStatusChip` with live definitions so label and colour track the household's.
- **Confidence**: confirmed in a screenshot + DOM class extraction

### Table name column collapses to four characters while tags keep full width
- **Severity**: should-fix
- **Kind**: visual bug
- **Surface**: `full-table` name column, desktop full view with default columns
- **Evidence**: `shots/t1-chips/ld-full-view-table.png` — the Kärcher row's name cell reads "Kärc…" while TAGS renders two full chips plus overflow and STATUS truncates its chip mid-word ("Lent out to the ne").
- **What's wrong**: with every default column on at 1266px of table, the name — the row's identity — is the column that loses; inline "Low"/"Checked out" chips inside the name cell squeeze it further.
- **Why it matters**: a table of "Kärc… / R1_Noteboo… / R1_Wall Ada…" cannot be scanned; the widest disposable column (TAGS) wins over the one indispensable one.
- **Suggested change**: give the name column a higher flex-grow / min-width priority than tags, and let the status chip ellipsize with `…` instead of hard clipping.
- **Confidence**: confirmed in a screenshot

### List rows indent names only when a photo exists, and the document marker floats mid-row
- **Severity**: polish
- **Kind**: inconsistency
- **Surface**: `list-row` in the card list, both layouts/themes
- **Evidence**: `shots/t1-chips/ld-list-top.png` — Kärcher/Bosch (thumbnail) names start ~70px right of Vileda/Miele (no thumbnail); the `row-has-document` icon sits directly after Kärcher's truncated name but at the far right edge on Vileda/Miele rows.
- **What's wrong**: no reserved leading slot for the thumbnail, and the document marker is anchored to the free space rather than to the name.
- **Why it matters**: a mixed list has a ragged left edge and the paperclip/document mark reads as belonging to the quantity stepper on photo-less rows.
- **Suggested change**: reserve the thumbnail slot (empty placeholder box, as the editor's photo grid already does) or anchor the doc marker to the name in both cases.
- **Confidence**: confirmed in a screenshot

### Tier 1 — Photo UX and Documents (editor + detail sheet)

### A completed upload silently discards the user's unsaved edits in the open editor
- **Severity**: blocker
- **Kind**: flow friction (data loss)
- **Surface**: `hv-item-editor` (all layouts, both themes)
- **Evidence**: scripted repro — open the Vileda editor, type "IMPORTANT NOTE typed but not yet saved" into `editor-description`, pick one photo; 3.5s later the description input reads `""` (DOM-extracted; `shots/t1-photos/edit-loss-after-upload.png`).
- **What's wrong**: `willUpdate` ([hv-item-editor.ts:934–946](cards/haventory-card/src/components/hv-item-editor.ts#L934)) rebuilds `_model` from the incoming `item` whenever the prop changes. Every successful upload broadcasts `items/updated`, the store hands the editor the fresh item, and everything typed since the last save is thrown away — while the user is still looking at the form. Any external edit to the same item mid-edit does the same.
- **Why it matters**: "fill in the form, add a photo, keep typing" is the normal editing order; the photo finishing is invisible, so the user discovers the loss only after Save writes back the stale rebuild — or never.
- **Suggested change**: in `willUpdate`, reset the form only when the item *identity* changes; when the same item's version moves, adopt the new attachments (as `_uploaded` already does) and keep `_model` and `_uploads` intact — surfacing external conflicts through the existing version-conflict path instead.
- **Mobile manifestation (same root cause, worse)**: `hv-detail-sheet.willUpdate` ([hv-detail-sheet.ts:410–418](cards/haventory-card/src/components/hv-detail-sheet.ts#L410)) forces `_mode = 'read'` whenever `item` changes, so on a phone the whole edit form *closes* the moment any attachment mutation lands — scripted repro: photo upload closes it (`shots/t1-photos/FAIL-state.png` vs `m-editor-top.png`), and tapping "make cover" closes it the same way (second repro: after `editor-photo-make-cover`, `item-editor` is gone within a second). Every step of "add three photos → set the second as cover → reorder → remove one" therefore needs its own trip back into the editor. The condition means "any version bump", not the "fresh item" its comment intends.
- **Confidence**: confirmed by scripted repro + source

### A refused file's error and Retry vanish when any later upload in the batch succeeds
- **Severity**: should-fix (same root cause as the blocker above)
- **Kind**: flow friction
- **Surface**: `editor-upload` / `editor-upload-retry` in `hv-item-editor`
- **Evidence**: batch of `photo-6-big.jpg` (valid, 8.3 MB), `broken.jpg` (bytes the backend refuses), `photo-3-landscape.jpg` (valid): `shots/t1-photos/ld-upload-q2-uploading.png` shows the queue; by `ld-upload-q4-error.png` the queue is empty, three photos are attached and **no error row exists** — server-side check confirms broken.jpg was never attached. Uploaded alone, the same file correctly shows "file content is not one of the accepted types…" with Retry (`broken-single.png`).
- **What's wrong**: the same `willUpdate` reset clears `_uploads` — including error entries — when the sibling success updates the item.
- **Why it matters**: on a phone a user picks a burst of camera photos; if one fails mid-batch they are told nothing and the item silently has fewer photos than they added.
- **Suggested change**: covered by the `willUpdate` fix above; additionally keep error entries out of any queue-clearing that isn't the user dismissing them.
- **Confidence**: confirmed by scripted repro + source + WS state

### Upload progress is a bare word — no bar, spinner or byte count, even for multi-MB photos
- **Severity**: should-fix
- **Kind**: flow friction
- **Surface**: `editor-upload-list` in `hv-item-editor`, all combos
- **Evidence**: `shots/t1-photos/ld-upload-q2-uploading.png` — a throttled 8 MB photo renders as the static text "photo-6-big.jpg uploading…" with "queued…" lines below; nothing moves for ~18s.
- **What's wrong**: the queue states (`queued/preparing/uploading`) render as words only; there is no indeterminate spinner, no per-file progress, and the list sits under the DOCUMENTS picker even for photos, two sections below the grid the user is watching.
- **Why it matters**: on the mobile connection the downscale exists for, a multi-photo upload looks frozen; users retry or navigate away mid-upload.
- **Suggested change**: minimal — an animated indeterminate bar/spinner per active row and a photo-thumbnail glyph; better — surface upload state as a ghost tile inside the PHOTOS grid itself, where the user is looking.
- **Confidence**: confirmed in a screenshot

### Removing a photo or manual is a one-tap permanent delete with no confirmation
- **Severity**: should-fix
- **Kind**: flow friction
- **Surface**: `editor-photo-remove` / `editor-document-remove`, all combos (worst on touch)
- **Evidence**: scripted repro — tapping the X on Miele's third photo deleted it instantly (item v11→v12, `shots/t1-photos/m-photos-remove-immediate.png` shows the read sheet immediately after; the attachment and its file are gone). No dialog, no undo.
- **What's wrong**: attachment deletion destroys the only copy of the file, yet it is the only destructive action on the card without a guard — status delete confirms even for an *empty* status, item delete confirms, and #301 already documents that this same X is a 22px target.
- **Why it matters**: a mis-tap on a phone (small target, beside the reorder controls) permanently destroys a photo of the user's possession; there is no way back.
- **Suggested change**: a confirm step matching the empty-status dialog ("Remove this photo? The file is deleted."), or an undo window before the WS call.
- **Confidence**: confirmed by scripted repro

### The photo lightbox cannot navigate — no swipe, no arrows, no counter
- **Severity**: should-fix
- **Kind**: flow friction
- **Surface**: `sheet-lightbox` in the detail sheet, mobile (desktop identical structure)
- **Evidence**: `shots/t1-photos/m-lightbox.png` and `m-lightbox-swiped.png` — identical before/after a left swipe on a 6-photo item; the only control is the close X.
- **What's wrong**: the lightbox shows exactly the photo that was tapped; with several photos each one needs close → find thumbnail → tap.
- **Why it matters**: comparing two photos of one item (the point of having six) is the exact case the lightbox exists for, and it takes four taps per photo.
- **Suggested change**: prev/next on tap-edges or swipe (the gallery strip already orders the photos), plus an "n of m" indicator.
- **Confidence**: confirmed in screenshots

### Untitled documents render their filename twice per row
- **Severity**: polish
- **Kind**: visual bug
- **Surface**: `sheet-document` / `editor-document`, all combos
- **Evidence**: `shots/t1-sheet/lm-miele-docs-3.png` — every row reads e.g. "manual-washer-install.pdf" as title with "manual-washer-install.pdf · 737 B · added 18 m ago" directly beneath; same in the missing state (`lm-vileda-doc-missing.png`).
- **What's wrong**: the display title falls back to the filename, and the meta line unconditionally repeats the filename.
- **Why it matters**: the default (no custom title) is the common case; every manual list reads as a copy/paste error and wastes a line on phones.
- **Suggested change**: omit the filename from the meta line when it equals the rendered title.
- **Confidence**: confirmed in screenshots
- Positive note, for the record: the "File missing" state itself is well done — struck-through title, amber chip, no dead Open button.

### Tier 2 — visual pass over the remaining surfaces (42 light + 42 dark)

All 84 `visual_pass` captures were taken (`audit/`, `audit-dark/` in the skill dir) and
reviewed. Overflow menus, diagnostics, import dialog, organize Locations/Categories/Tags
tabs, staged mobile filters and both panel widths are in good shape in both themes; dark
mode introduced no issue beyond the swatch problem already filed. New findings:

### Mobile data table scrolls horizontally but the name column scrolls away with it
- **Severity**: should-fix
- **Kind**: flow friction
- **Surface**: `full-table` in `hv-full-view`, card full view + panel at phone width, both themes
- **Evidence**: `shots/t2/pm-table-after-swipe.png` — after one left swipe the visible columns are QTY/STATUS/CATEGORY/LOCATION and the rows are anonymous ("Ma…", "ess…"); DOM: `hv-data-table` scrollWidth 1244 vs clientWidth 393. All eight columns stay enabled at 375px (`audit/pm-08-columns.png`), so scrolling is the only way to see most of them.
- **What's wrong**: no sticky first column, and no edge fade/affordance saying the table scrolls — the clipped status chip at the right edge (`audit/pm-01-page.png`) is the only hint.
- **Why it matters**: on a phone, any look at location/due/tags loses which item the row is; users scroll back and forth to re-anchor.
- **Suggested change**: `position: sticky; left: 0` on the name cell (with background), plus an overflow fade; also let the status-cell chip ellipsize instead of hard-clipping mid-word.
- **Confidence**: confirmed in screenshots + DOM

### The blue status tone is pixel-identical to the fixed "checked out" state chip
- **Severity**: should-fix
- **Kind**: inconsistency
- **Surface**: any `tone-blue` status chip next to `.hv-chip.state`, all combos
- **Evidence**: `shots/t1-chips/ld-list-top.png` / `audit/d-10-selection.png` — the Kärcher row carries "Checked out" (state chip) and "Lent out to the neighbours" (tone-blue status) in one row: same background, same ink; only the tiny glyph differs. Root: `--hv-tone-blue-bg: var(--hv-primary-tint)` and `--hv-tone-blue-fg` ≈ the state chip's ink ([tokens.ts:84–88](cards/haventory-card/src/ui/tokens.ts#L84)).
- **What's wrong**: `chip.ts` argues the status chip must opt out of the fixed vocabulary because "a user-chosen hue inside this vocabulary would dissolve it" — but the blue tone *is* the vocabulary's blue, so the dissolution it warns about ships as the default for any blue status.
- **Why it matters**: "Checked out" (a transient possession state) and a household status like "Lent out" are exactly the pair users will want to distinguish, and they render identically.
- **Suggested change**: shift the blue tone a visible step from the state blue (e.g. indigo-leaning tint/ink pair) in `tokens.ts`; `tone-contrast.test.ts` covers fg/bg pairs, not cross-chip distinctness, so adjust there too if a guard is wanted.
- **Confidence**: confirmed in screenshots + source

### A new item cannot take photos or documents until after it is saved, and nothing says so
- **Severity**: polish
- **Kind**: flow friction
- **Surface**: item create form (`item-editor` in create mode), all combos
- **Evidence**: `audit/d-04-add-editor.png`, `audit/m-04-add-sheet.png` — the create form simply has no PHOTOS/DOCUMENTS sections (uploads need an item id); they appear only when the saved item is re-opened.
- **What's wrong**: the difference between create and edit is unexplained; "add the item with a photo" is the natural first wish and the UI silently lacks the affordance.
- **Why it matters**: a first-run user looks for the camera button at the moment they're holding the object; not finding it reads as a missing feature rather than an ordering constraint.
- **Suggested change**: a one-line hint in the create form ("Save the item first to add photos and manuals"), or queue picks locally and upload after save.
- **Confidence**: confirmed in screenshots (absence) + source (upload requires `item.id`)

### Tier 3 — flows

Flow 2 (create → colour → assign → filter) works end to end with no dead ends:
`shots/t3/flow2-editor-filled.png` → `flow2-created.png` → `flow2-item-on-status.png` →
`flow2-filtered.png` ("Search 1 matching item…"). Flow 3's guard is legible on desktop
(count, reassign target, red verb). Two defects fell out of these flows:

### Deleting a status with reassignment crashes the card's items-event handler and leaves stale rows
- **Severity**: blocker
- **Kind**: visual bug (stale data + console error)
- **Surface**: every connected card/panel after `status/delete` with `reassign_to`
- **Evidence**: completing flow 3 (delete "Zu verschenken", 40 items → OK) logs `TypeError: Cannot read properties of undefined (reading 'id')` and the organize tab keeps showing "OK 855 items" (`shots/t3/flow3-after-delete.png`) while the backend already reports ok=895 (WS-verified).
- **What's wrong**: the backend deliberately broadcasts `items/updated` with `payload=None` for the bulk move ([ws.py:2210](custom_components/haventory/ws.py#L2210)); the store's handler unconditionally reads `evt.item.id` ([store.ts:646–648](cards/haventory-card/src/store/store.ts#L646)) and throws, so neither the 40 rows nor the counts update until a manual refresh. The offline stub cannot see this — it is exactly the live-payload divergence class the repo's own notes warn about.
- **Why it matters**: right after the most consequential status operation, every open view shows 40 items on a status that no longer exists.
- **Suggested change**: in `onItemsEvent`, treat an `updated` event without an `item` as "refetch" (the `reloaded` path already exists three lines up); optionally also assert the shape in the WS-schema test.
- **Confidence**: confirmed by scripted repro (console error + WS state) + source both sides

### The status count link in the organize dialog opens the full view without applying the filter
- **Severity**: should-fix
- **Kind**: flow friction
- **Surface**: `status-count` in the Statuses tab, all combos
- **Evidence**: `shots/t3/flow3-count-link.png` — clicking "40 items" beside "Zu verschenken" lands on "All items · 1004 items", no active filter, no trace of the promised subset.
- **What's wrong**: `_showStatus` ([hv-organize-dialog.ts:1615](cards/haventory-card/src/components/hv-organize-dialog.ts#L1615)) only dispatches `browse` with `{status}` in the detail — but the host handler discards the detail ([host-surfaces.ts:271](cards/haventory-card/src/host-surfaces.ts#L271)), and unlike its tag/category siblings, `_showStatus` never calls `store.setFilters` itself.
- **Why it matters**: the link is the tab's answer to "which 40 items?" — it opens a 1004-row view instead, and its own docstring promises "the way a value count does".
- **Suggested change**: call `this.store?.setFilters({ status: slug })` before dispatching, matching `_showValue`.
- **Confidence**: confirmed in a screenshot + source

### Applied status-filter chip renders in chore amber regardless of the status's own colour
- **Severity**: polish
- **Kind**: inconsistency
- **Surface**: active-filter chip row above the list, all combos
- **Evidence**: `shots/t3/flow2-filtered.png` — "Status: Reserviert ×" renders as an amber pill although Reserviert is strong green; a search term chip renders blue in the same row.
- **What's wrong**: the applied-filter row gives the status facet the warning hue, colliding with the amber that means "chore" elsewhere.
- **Why it matters**: minor, but this is the exact row where an amber "Status: X" sits beside amber "Low stock" applied chips and reads as the same species.
- **Suggested change**: render the applied status chip via `renderStatusChip` (label + tone), or use the neutral applied styling.
- **Confidence**: confirmed in a screenshot

### First run: the location picker on an empty install is a dead end
- **Severity**: should-fix
- **Kind**: flow friction
- **Surface**: `editor-location` dropdown, empty inventory, all combos
- **Evidence**: `shots/t3-empty/firstrun-location-dropdown.png` — with 0 locations, the open picker offers "× No location" and the line "No locations yet"; there is no create affordance and no pointer to where locations are made (⋮ → Organize… → Locations → New location, three undiscoverable steps away).
- **What's wrong**: the empty state ("Add your first item") funnels the user straight into a form whose most important field cannot be satisfied yet.
- **Why it matters**: recording *where things are* is the product's differentiator, and the first minute teaches the user it can't be done.
- **Suggested change**: an inline "New location…" affordance in the picker's empty state (the organize dialog already owns the create flow), or at least a hint naming the path.
- **Confidence**: confirmed in a screenshot

### Escape with an open dropdown discards the whole form without confirmation
- **Severity**: should-fix
- **Kind**: flow friction (data loss)
- **Surface**: `item-editor` keyboard handling, desktop
- **Evidence**: scripted repro — type a name into the create form, open the location dropdown, press Escape: the editor closes and the typed name is gone (`shots/t3-empty/FAIL-state.png` shows the empty state again immediately after).
- **What's wrong**: the footer's "Esc discards" fires even when a popover is open (Esc should close the popover first), and discarding a dirty form asks nothing.
- **Why it matters**: Esc-to-close-a-dropdown is muscle memory; here it costs the entire form.
- **Suggested change**: have open popovers (location tree, category list) consume the first Escape; ask before discarding a dirty form on the second.
- **Confidence**: confirmed by scripted repro

### Sort controls are buried at the bottom of the filter panel, below the tag cloud
- **Severity**: polish
- **Kind**: flow friction
- **Surface**: compact card filter panel (both layouts)
- **Evidence**: `shots/t1-chips/card-filter-status-row.png` — SORT is the seventh section, after a TAGS cloud that renders every tag in the household (60+ chips in this fixture); on mobile that is several screens of scrolling inside the filter sheet before the sort row appears.
- **What's wrong**: changing sort — a frequent, lightweight action — costs opening the filter panel and scrolling past the heaviest section in it. The full view has column-header sorting; the compact list has no sort affordance outside this panel.
- **Why it matters**: "newest first / low stock first" is a daily toggle and it is priced like a rare configuration change.
- **Suggested change**: move SORT above TAGS (or to the top of the panel); tag clouds grow with the household, sort does not.
- **Confidence**: confirmed in screenshots

### Flow notes (no new defect)
- **Find one item (flow 6)**: search is excellent — focus, type "sponges", one result, live count in the placeholder ("Search 1004 matching items…" → updates). Filtering by any status is 2 clicks on desktop (open panel, click chip; live) and 3 taps on mobile (open sheet, toggle, "Show N items" — the staged footer is correct for a phone). Columns are full-view-only, which is reasonable.
- **Attach → title → open a manual (flow 5)**: works; the title input commits silently on blur (`shots/t3/flow5-titled.png`) — fine, though the commit is also an item mutation and so participates in the `willUpdate` reset above. Opening uses `target="_blank"` on the authenticated media URL (filename caveat is #300).

### A strong-blue status chip is visually identical to the card's primary action styling
- **Severity**: polish
- **Kind**: inconsistency
- **Surface**: `status-chip` with `tone-blue-strong` ("In transit"), all combos
- **Evidence**: `shots/t1-status/light-desktop-statuses-rest-dialog.png` — the "In transit" chip and the "+ New status" button are the same saturated-blue-fill/white-text pill shape at nearly the same size.
- **What's wrong**: `--hv-tone-blue-strong-bg` (#0277bd) sits in the same blue family as `--hv-primary`; a chip in that tone reads as a pressable button wherever it appears near real actions.
- **Why it matters**: users learn "blue filled pill = action" from HA and from this card's own Save/Add buttons; a status in that clothing invites dead taps (chips here are not interactive).
- **Suggested change**: none mechanical — consider shifting `blue_strong` a step darker/greener than `--hv-primary-darker`, or accept and note it; flagging for the pass to decide.
- **Confidence**: confirmed in a screenshot (the confusion itself is a judgment)



## What I could not check

- **iOS/WebKit behaviour.** All captures are Chromium emulation: safe-area insets,
  `100vh`/`dvh` handling of the bottom sheets, momentum scrolling (the CDP swipe has no
  fling), iOS Safari's file/camera picker, and the HA Companion webview all need a real
  device on the LAN.
- **Real camera uploads.** The downscale path was exercised with a synthetic 8.3 MB JPEG;
  EXIF orientation from a real phone camera (`imageOrientation: 'from-image'`) was not.
- **A true fresh install.** The empty-inventory pass had 0 items and 0 locations but kept
  the audit's 8 status definitions; the statuses tab as a brand-new user sees it (exactly
  the seeded three) was not photographed.
- **The bulk rewrite progress panel** (`rewrite-status`, used by tag/category renames in
  the organize dialog) was read in source but not driven.
- **Hover-only affordance discoverability on desktop** (row edit, status edit/delete) was
  used but not evaluated against first-time discoverability — it needs users, not
  screenshots.
- **Rate limiting UI** — deliberately untouched; rate limiting stayed OFF throughout, as
  required.

## Fixture state left on the dev instance

Found on arrival: 1000 `R1_*` items / 39 locations, statuses `ok`/`missing`/
`needs_repair`/`gesperrt` (993/3/3/1). Left behind:

- **1004 items / 44 locations.** The four named fixture items: "Kärcher K5 Premium…"
  (long name, 12 tags, deep path, low-stock + checked-out-overdue + inspection-due,
  6 photos + 1 manual titled "Betriebsanleitung K5 Premium"), "Bosch GSR 12V-15 Cordless
  Drill" (3 photos, status `reserviert`), "Miele WCE 320 Washing Machine" (2 photos +
  3 manuals), "Vileda Steam Mop" (1 photo + 1 manual whose blob is **deliberately deleted**
  — it renders the "File missing" state; re-upload to clear it).
- **Locations**: a 5-level chain West Wing → Second Floor → Storage Room B (…) →
  Cabinet 4 → Drawer 2 (no area).
- **Statuses**: `lent_out_to_the_neighbours` (blue, 100 items), `sold` (neutral_strong, 1),
  `in_transit` (blue_strong, 0), `reserviert` (green_strong, 1 — created through the UI in
  flow 2). `giveaway` "Zu verschenken" was created with 40 items and then **deleted through
  the UI in flow 3**, reassigning its 40 items to `ok` (ok is now 895, was 993 on arrival).
  ~99 `R1_*` items were moved to `lent_out_to_the_neighbours` and 1 to `sold`.
- **The whole store was emptied and restored** during the flow-1 pass (WS export →
  bulk delete → import replace, ids preserved; attachment blobs copied out and back —
  verified serving 200 afterwards). Item `version` counters moved throughout.
- Rate limiting: OFF (never enabled). The store file was also deleted once ahead of an
  aborted restart; the running instance re-persisted it — no effect.

## Console errors observed

- `TypeError: Cannot read properties of undefined (reading 'addEventListener')` on every
  page load — from HA's own `frontend_latest/app.*.js` (stack captured), a consequence of
  the harness blocking service workers. Not the card.
- `TypeError: Cannot read properties of undefined (reading 'id')` — **the card**, exactly
  once, during the flow-3 reassign-delete. This is ranked finding #2.
- Three 404s for `/unknown/node_modules/@babel/runtime/helpers/esm/*.js` on every load of
  HA's narrow (mobile) layout — HA core bundle, not the card.
- One 404 for the Vileda manual's media URL — the deliberate File-missing fixture doing
  its job.
