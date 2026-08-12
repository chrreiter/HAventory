# V0.5.0 — handovers to a local session

Cloud sessions have no Home Assistant. Each section below is one thing a cloud session
finished but could not watch run, written so a session in front of the dev Docker instance
(the `run-haventory` and `test-haventory` skills) can pick it up without reading the PR
first.

Appended in session order, per §5 of `dev/V0_5_0_implementation.md`. Delete this file with
that plan when the milestone closes.

---

## H1 — #197 the widened frames stop HA core logging the client payload at ERROR

**Branch / PR**: `claude/v0-5-0-w1a-input-hardening` / #415
**Why this needs a real HA**: the log line comes from Home Assistant core, not from this
integration. `homeassistant.components.websocket_api.http.connection` logs a schema
rejection at ERROR *with the client's payload in the message* — the whole point of typing
`name` / `quantity` / `delta` / `operations` / `filter` / `sort` / `limit` / `cursor` as
`object` is that they no longer take that path. The in-process suite proves the frames now
answer `validation_error`; only a running instance shows what its log does about it.

### Setup

    set -a; . ./.env; set +a
    bash scripts/reload_addon.sh --container home-assistant --sleep 30 --tail-logs

Seed one item so the batch case has something to address:

    uv run python scripts/create_test_items.py --count 1

### Steps

1. Start following the log: `docker logs -f home-assistant 2>&1 | grep -i websocket_api`.
2. Send each of these over the WebSocket (`uv run python scripts/ws_probe.py` drives it):
   - `{"type": "haventory/item/create", "name": "Hammer", "quantity": 1.5}`
   - `{"type": "haventory/item/create", "name": 42}`
   - `{"type": "haventory/item/adjust_quantity", "item_id": "<id>", "delta": "two"}`
   - `{"type": "haventory/items/bulk", "operations": "oops"}`
   - `{"type": "haventory/item/list", "filter": {"query": "hammer"}}`
   - `{"type": "haventory/item/list", "limit": 2, "cursor": ""}`
3. For contrast, send one frame that is *still* schema-typed and must still be refused by
   core: `{"type": "haventory/item/create", "name": "Hammer", "tags": "chisel"}`.

### What "pass" looks like

- Every frame in step 2 answers `{"success": false, "error": {"code": "validation_error"}}`,
  and the message names the field.
- **No `ERROR` line from `homeassistant.components.websocket_api.http.connection`** for any
  of them. Each appears once at WARNING from `custom_components.haventory.ws`, with no
  traceback and with the payload absent from the message.
- The frame in step 3 still answers `invalid_format` and still logs at ERROR from core —
  that contrast is what shows the widening is what changed the behaviour, rather than a
  logging config difference.
- The inventory is unchanged afterwards: `haventory/stats` reports the same `items_total`
  it did before step 2.

### What to send back

- The grepped log excerpt covering steps 2 and 3, and the six error envelopes.
- Paste the result as a comment on #197 and reply on the PR thread.

---

## H2 — #195 the name-clash block on a hand-rebuilt inventory

**Branch / PR**: `claude/v0-5-0-w1a-import-name-collisions` / #417
**Why this needs a real HA**: the offline and phacc suites both prove the warning is
produced and survives the wire, but neither renders it. What is unverified is the block in
the import sheet on a realistic document — whether the clash list is legible at the width
the sheet actually has, whether five entries plus "…and N more" is the right cut, and
whether the block reads as a caution rather than as a refusal while the Import button
beside it stays enabled.

### Setup

    set -a; . ./.env; set +a
    bash scripts/reload_addon.sh --container home-assistant --sleep 30 --tail-logs

Then build the situation the warning exists for — an inventory whose locations were
rebuilt by hand, so they carry fresh ids under the old names:

1. Seed a small tree and some items:
   `uv run python scripts/ws_init_haventory.py` (or the card's own UI).
2. **Export a backup** from the card: ⋮ → Export backup. Keep the file.
3. **Delete every location** and recreate them by hand with the same names — same
   spelling, same nesting. This is what gives them new ids.
4. Recreate two or three items by hand under the old names as well, so the item side of
   the block has something to show.

### Steps

1. Card ⋮ → Import backup, paste or pick the file from step 2, choose **Merge**, Preview.
2. Read the preview sheet. Repeat with **Replace** and with **Skip**.
3. Then the negative case, which is the one that matters most: export a *fresh* backup of
   the inventory as it now stands and immediately preview that file back onto it, under all
   three policies.

### What "pass" looks like

- Step 2: a `data-testid="import-warnings"` block appears above the fine print, listing the
  clashes. Each location line quotes the stored location's path (`the location at "Garage /
  Shelf A"`), which is what tells one legitimate "Shelf A" from the rebuilt duplicate. With
  more than five, exactly five are listed and the rest are counted.
- The **Import button stays enabled** in every case, and the preview still reports
  `valid: true` — this warns, it does not gate.
- Step 3 produces **no warning block at all**, under all three policies. A check that fires
  on the ordinary round trip is worse than no check, so this is the failing case to watch
  for.
- Legible in both themes: the block uses the same `alert warn` treatment as the existing
  conflict banner, so it should sit beside it without a second visual language.

### What to send back

- Screenshots of the preview sheet from step 2 (one with a handful of clashes, one with
  more than five if you can make it) and from step 3, in light and dark.
- Paste the result as a comment on #195 and reply on the PR thread.

---

## H3 — #194 an area-filtered subscription only hears about its own area

**Branch / PR**: `claude/v0-5-0-w1b-subscribe-area` / #414
**Why this needs a real HA**: offline tests drive the matcher directly and the in-process
suite drives one connection. What neither shows is two live dashboards on one Home
Assistant, each holding its own `haventory/subscribe` round, and a mutation reaching only
one of them — the fan-out across connections, over a real socket, with real areas from the
area registry.


### Setup

    set -a; . ./.env; set +a
    bash scripts/reload_addon.sh --container home-assistant --sleep 30 --tail-logs

Seed two areas in HA (Settings → Areas, or reuse two that exist), then build a tree with a
root anchored in each and one item per root:

    uv run python scripts/ws_init_haventory.py     # if the instance is empty
    uv run python scripts/ws_probe.py              # for ad-hoc location/create + item/create calls

The shape that matters: `Kitchen` (area = the first area) → `Drawer`, `Garage` (area = the
second area), one item in `Drawer`, one item in `Garage`, and one item with **no** location.

### Steps

1. Open two browser tabs on the HAventory panel.
2. In tab A, filter to the kitchen area (area chip in the filter panel). Leave tab B unfiltered.
3. In tab B, edit the item that lives in `Garage` — rename it.
4. Watch tab A: the row count and the list must not flicker, and no toast or row change may
   appear for the garage item.
5. In tab B, edit the item in `Drawer`. Tab A must show the new name without a manual refresh.
6. In tab B, edit the item with no location. Tab A must not react.
7. With tab A still filtered to the kitchen, move `Drawer` under `Garage` (drag in the
   location tree, or `location/move_subtree`). Tab A is expected to re-list — it does that
   on the `locations` `moved` event — and the item must then be gone from its list. This is
   the documented behaviour, not a bug: no per-item departure event is emitted.
8. Optional, the same case the other way: reassign `Kitchen`'s own area in the location
   editor. Today that emits no `locations` event at all, so tab A keeps showing the items
   until something else makes it re-list. Note what you see.

### What "pass" looks like

- Steps 3, 4 and 6: nothing moves in tab A. In the browser devtools WS frames, tab A's
  connection receives **no** `event` frame carrying the garage item or the location-less one.
- Step 5: tab A updates live, no refresh.
- Step 7: tab A re-lists once and the item disappears from it.
- `home-assistant.log` carries no `websocket_api` ERROR and no `haventory` warning across
  the whole run.

### What to send back

- The two tabs side by side after step 4 (screenshot), and the devtools WS frame list for
  tab A across steps 3–6.
- Whatever step 8 does, in one line — it decides whether reassigning a location's own area
  needs an event of its own, which would be a follow-up rather than part of #194.
- Paste the result as a comment on #194 and reply on the PR thread.

---

## H6 — #365 quick-filter pills in the options flow

**Branch / PR**: `claude/v0-5-0-w1c-quick-filter-pills` / #416
**Why this needs a real HA**: the offline suite validates the schema, never the form. What
it cannot show is how Home Assistant *draws* a `SelectSelector(multiple=True,
mode=LIST)` inside an options flow — whether the five pills come up as a checkbox list
with their translated labels or as a dropdown of raw wire names — and whether the sidebar
panel, which has no Lovelace config at all, picks the stored choice up.

### Setup

    set -a; . ./.env; set +a
    bash scripts/reload_addon.sh --container home-assistant --sleep 30 --tail-logs
    # Seed enough inventory that every pill has something to count, or the card
    # draws none of them and the test says nothing:
    uv run python scripts/create_test_items.py     # then, in the UI, mark one item
    # low-stock, one overdue, one due for inspection, and check one out.

### Steps

1. Settings → Devices & services → HAventory → **Configure**. Read the new
   **Quick-filter pills** field: how it renders, and what the five entries are called.
2. Untick everything except **Low stock** and **Overdue**, save.
3. Open the HAventory sidebar page. Then open a dashboard carrying a plain
   `type: custom:haventory-card` with no `quick_filters:` key.
4. Add a second card to the same dashboard with `quick_filters: [checked_out]`.
5. Back in **Configure**, tick every pill again, save, reload the page.
6. Untick all five, save, reload.

### What "pass" looks like

- Step 1: five labelled checkboxes — *Item total, Low stock, Overdue, Due for inspection,
  Checked out* — not a dropdown of `low_stock`-style wire names, and not a free-text field.
- Steps 2–3: after a page reload, both the sidebar page and the plain card show only the
  low-stock and overdue pills. The panel is the half that could not be reached before, so
  it is the one worth screenshotting.
- Step 4: the second card shows only its checked-out pill — a dashboard's own key still
  wins over the integration-wide choice.
- Step 5: all five are back (subject to each having a non-zero count).
- Step 6: no pills anywhere, on the panel and on the plain card alike — an empty choice is
  a choice, not a reset to "all".
- Nothing in the HA log at WARNING or above from `haventory` or `config_entries` across
  any of it.

### What to send back

- A screenshot of the options form (step 1) and one of the sidebar page at step 3.
- The pill row from step 4's second card, showing the two cards disagreeing on purpose.
- Paste the result as a comment on #365 and reply on the PR thread.

---

## H7 — #298 a hex colour beside the ten status tokens

**Branch / PR**: `claude/v0-5-0-w1c-status-hex-colours` / #418
**Why this needs a real HA**: legibility is the whole cost of this feature, and the offline
suite can only prove the maths. What it cannot show is a chip at a household's own colour
sitting on a *real* surface, in light and dark, under a non-default HA theme — the case the
literal colour deliberately ignores. Nor can it show the browser's native colour picker,
which is the control a household actually uses.

### Setup

    set -a; . ./.env; set +a
    bash scripts/reload_addon.sh --container home-assistant --sleep 30 --tail-logs
    # Any inventory with a handful of items will do; the statuses are created below.
    # Install a non-default theme first — anything from HACS, or a themes/ YAML with a
    # strong --card-background-color and --primary-text-color — and select it under
    # Profile → Themes, so the theme half of this is actually exercised.

### Steps

1. Full view → Organize → **Statuses** → new status "Lent out". The colour row now ends in
   an eleventh swatch: click it and pick something mid-toned, e.g. `#2f6f4f`. Save.
2. Set that status on two or three items. Look at them in the table, in a row, and in the
   detail sheet; then filter by the status so the filter panel's chip and the applied-filter
   chip both show it.
3. Repeat step 1 for a pale colour (`#ffe082`) and a near-black one (`#101820`) on two more
   statuses, so both ink outcomes are on screen at once.
4. Switch the frontend between light and dark (Profile → Themes → light/dark), and between
   your non-default theme and the default.
5. Reload the page. Then export a backup (⋮ → Export backup) and re-import it.

### What "pass" looks like

- Every hex chip is readable at a glance in both themes: pale fills carry black text, deep
  fills carry white, and no chip has text you have to lean in for.
- The hex chips look *identical* across the theme switch — that is the deliberate trade, not
  a bug. The ten tone chips beside them do move with the theme.
- The editor shows the "used exactly as entered / same in every theme" line while a custom
  colour is chosen, and drops it the moment one of the ten is picked instead.
- The eleventh swatch itself is painted in the chosen colour and reads as selected, while
  none of the ten does.
- Step 5: the colour survives a reload and an export/import round trip unchanged, lowercase.
- Nothing in the HA log at WARNING or above from `haventory` throughout.

### What to send back

- Screenshots of the same table in light and dark, and once under the non-default theme,
  with all three hex statuses visible.
- A screenshot of the status editor with the custom swatch selected and the hint showing.
- Paste the result as a comment on #298 and reply on the PR thread.

---

## H4 — #193 Categories and Tags move with the filter the way Locations does

**Branch / PR**: `claude/v0-5-0-w2-facet-counts` / #TBD
**Why this needs a real HA**: the offline suite proves the tallies are computed and the
component test proves the pair renders. What neither shows is the thing the issue was
filed about — one sidebar column where the three lists finally agree, read at the width
the sidebar actually has, in both themes. `8 / 37` beside `43` was the complaint; whether
`8 / 37` beside `2 / 43` reads as one column or as three numbers fighting for the same
40 px is a judgement only the running card supports.

### Setup

    set -a; . ./.env; set +a
    bash scripts/reload_addon.sh --container home-assistant --sleep 30 --tail-logs

Seed enough inventory that the tallies are worth reading — a few dozen items across
several categories and tags, with a handful genuinely low on stock:

    uv run python scripts/create_test_items.py

Then, in the UI, give two or three items a low-stock threshold they are under, so the
low-stock pill has something to select.

### Steps

1. Open the HAventory sidebar page and expand the full view's sidebar. Note what the
   Locations, Categories and Tags rows read with no filter on.
2. Turn on the **Low stock** quick-filter pill.
3. Read all three sections again.
4. Click a category row to select it, and watch the *tag* tallies.
5. Click a tag row as well, and watch the *category* tallies.
6. Clear the filter. Then type something in the search box that matches nothing at all.
7. Open the item editor and start typing a category name, with the low-stock filter still on.
8. Switch between light and dark.

### What "pass" looks like

- Step 1: every row is a bare number — no `/` anywhere in the sidebar.
- Step 3: every location, category and tag row reads `matches / total`, and the two
  numbers are the same *kind* of number in all three sections. A category nothing
  low-stock carries reads `0 / 7` rather than vanishing.
- Steps 4 and 5: picking a category leaves the tag tallies where they are (and vice
  versa) — each list drops its own dimension, so selecting in one does not zero the
  other. The location tallies do move, since the category is not their dimension.
- Step 6: with a query matching nothing, every row reads `0 / n` and **no list is empty**.
  An empty Categories list here is the failure this whole change exists to avoid.
- Step 7: autocomplete still offers every category, including ones with `0 /` in the
  sidebar. It is a vocabulary, not a result set.
- Step 8: the pair is legible in both themes and does not wrap to a second line at the
  sidebar's own width. A long category name still clips with an ellipsis rather than
  pushing the number out of view.
- Nothing in the HA log at WARNING or above from `haventory` across any of it.

### What to send back

- A screenshot of the expanded sidebar with the low-stock filter on, showing Locations,
  Categories and Tags together — light and dark.
- One with a long category name, to show the clip still happens on the label and not the
  tally.
- Paste the result as a comment on #193 and reply on the PR thread.
