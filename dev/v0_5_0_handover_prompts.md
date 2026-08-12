# V0.5.0 — handovers to a local session

Cloud sessions have no Home Assistant. Each section below is one thing a cloud session
finished but could not watch run, written so a session in front of the dev Docker instance
(the `run-haventory` and `test-haventory` skills) can pick it up without reading the PR
first.

Appended in session order, per §5 of `dev/V0_5_0_implementation.md`. Delete this file with
that plan when the milestone closes.

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

**Branch / PR**: `claude/v0-5-0-w1c-status-hex-colours` / #NNN
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
