# HAventory

[![CI](https://github.com/chrreiter/HAventory/actions/workflows/ci.yml/badge.svg)](https://github.com/chrreiter/HAventory/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/chrreiter/HAventory)](https://github.com/chrreiter/HAventory/releases)
[![HACS: Custom](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://github.com/hacs/integration)
[![License: Apache-2.0](https://img.shields.io/github/license/chrreiter/HAventory)](LICENSE)

**A household asset inventory that lives inside Home Assistant.** Where is the good drill,
how much coffee is left, who took the ladder, when was the fire extinguisher last checked —
HAventory answers those on the same screen as everything else in the house.

It is a custom integration (domain `haventory`) plus a Lovelace card. Everything is stored
locally in Home Assistant's own store and pushed live to every open screen; no account, no
cloud, no external service. Minimum Home Assistant **2026.6.0**.

![The HAventory full view: a location tree beside a sortable table of items](https://raw.githubusercontent.com/chrreiter/HAventory/main/docs/assets/screenshots/full-view.png)

## What it is

- **A location tree as deep as your house is.** Home Assistant stops at floor → area;
  HAventory files a thing in *Garage › Shelving unit › Top box* and counts every level.
  An item's **area** is inherited from the top of its tree, so HAventory's places and Home
  Assistant's areas stay one thing.
- **Search that finds it anyway.** Case-insensitive and accent-insensitive, next to filters
  for location, area, category, tags, status, low stock, check-outs, overdue dates and
  date windows — each showing how many items it would keep before you apply it.
- **Check out what leaves the house**, with a due date, so "who has the ladder" has an
  answer and an overdue one is marked.
- **Photos and PDF manuals** on the item itself, stored inside your config directory and
  served through Home Assistant's authenticated view — never from `/local`. On a phone the
  picker opens the companion app's camera.
- **Quantities, low-stock thresholds and a shopping list.** Pick one of your to-do lists and
  everything at or below its threshold writes itself onto the list the household already
  shares.
- **Inspection dates and repeating reminders** — change the filter every three months,
  service the extinguisher every year — projected onto a real calendar entity, with nothing
  scheduled and nothing to drift.
- **Bulk operations and an organize dialog**: move, retag, recategorise, check out or delete
  a whole selection, and rename or merge locations, categories, tags and statuses in one
  place. The **statuses** are your own vocabulary — *OK*, *Missing* and *Needs repair* to
  begin with, and you add, rename, recolour or retire them from that same dialog.
- **One page and any number of cards.** A sidebar entry opens the full workspace; the same
  bundle draws a card on any dashboard you like.

![The card with an item open for editing](https://raw.githubusercontent.com/chrreiter/HAventory/main/docs/assets/screenshots/item-editor.png)

![HAventory on a phone: the list, an item's detail sheet, and the filter sheet](https://raw.githubusercontent.com/chrreiter/HAventory/main/docs/assets/screenshots/phone.png)

**Languages:** English and German. Both the card and the integration's own screens follow
your Home Assistant profile language; anything else falls back to English. Adding a
language is two files — see [CONTRIBUTING.md](CONTRIBUTING.md#adding-a-language).

## Install

[![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=chrreiter&repository=HAventory&category=integration)

HAventory isn't in the HACS default store yet, so it goes in as a custom repository. That
button hands it to your own Home Assistant in one click; steps 1 and 2 are the same thing
by hand.

1. In Home Assistant, open **HACS → ⋮ → Custom repositories**.
2. Add `https://github.com/chrreiter/HAventory` with category **Integration**.
3. Install **HAventory**, then restart Home Assistant.
4. Add it under **Settings → Devices & services → Add integration → HAventory**:

   [![Open your Home Assistant instance and start setting up a new integration.](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=haventory)

5. Reload the browser page once (Ctrl/Cmd+Shift+R), so the card reaches the tab you already
   had open.

**Upgrading an install from before 0.8.0?** The stored schema is renumbered to 1 in this
release, and an existing store is taken over in place on the first start — there is nothing
to export, import or convert. Take a JSON export first anyway (⋮ → **Export backup**):
HAventory refuses to read a store written by a schema it does not know, so an export is the
way back if the crossing surprises you.

HACS installs **released versions only**: it downloads the `haventory.zip` attached to a
GitHub release, which already contains the built card. Installing from the default branch is
deliberately not offered — the card bundle is a build artifact and is not in git, so a
branch install would come up without a card and report success.

Minimum Home Assistant version: **2026.6.0** — one declared floor, and this is it: the
oldest release that both runs the integration and carries no known unpatched high or
critical security advisory. The integration is verified against older releases as well, but
a declared minimum is also a recommendation about what to run, and this project will not
point it at a release with a known hole.

Where HAventory then appears, how the card reaches YAML-mode dashboards, and how to remove
it again — including what removal keeps: [`docs/installing.md`](docs/installing.md).

## Configure

Setup asks two things: what the card is called, and whether HAventory gets a **sidebar**
entry (yes by default, so there is somewhere to click before you have built a dashboard).

Everything else lives under **Settings → Devices & services → HAventory → Configure**, and
takes effect without a restart:

- **Card title** and the **sidebar entry** — the same two, editable afterwards.
- **Shopping list** — which `todo.*` list low stock is mirrored onto. Empty means off, which
  is the default.
- **Quick-filter pills** — which of the six pills (`total`, `low_stock`, `overdue`,
  `inspection_due`, `reminder_due`, `checked_out`) every surface offers.

## Add the card

On a dashboard you created yourself: **Add card** → search *HAventory*. The visual editor
covers the title; the YAML is:

```yaml
type: custom:haventory-card
title: Pantry # optional; overrides the integration-wide card title
quick_filters: # optional; which quick-filter pills this card offers
  - low_stock
  - checked_out
```

Those two keys are the only ones the card reads, and both are optional — without them the
card follows the integration's own settings, which is what the sidebar page always does. Any
other key is ignored rather than rejected, so a stale dashboard config never breaks the card.
What each key accepts, and which setting wins where:
[`docs/installing.md`](docs/installing.md#card-configuration).

Home Assistant's redesigned Overview hosts no cards at all, core or custom. What it does
take is a shortcut to a panel: **Edit** the Overview, choose **Add shortcut**, and pick
**HAventory**.

## Automate it

HAventory shows up as **sensors and a calendar entity on one device**, fires
`haventory_item_changed` and `haventory_low_stock` on the bus, and puts its own
**`haventory.*` actions** in Developer Tools → Actions. None of it polls, and all of it is
ordinary Home Assistant.

Tell whoever is home when something runs low:

```yaml
automation:
  - alias: Notify when stock runs low
    triggers:
      - trigger: event
        event_type: haventory_low_stock
        event_data:
          action: entered
    actions:
      - action: notify.notify
        data:
          title: Running low
          message: >-
            {{ trigger.event.data.name }} is down to
            {{ trigger.event.data.quantity }}
            (threshold {{ trigger.event.data.low_stock_threshold }})
```

And write back to the inventory — a button by the coffee machine that books one bag out:

```yaml
automation:
  - alias: One bag of coffee used
    triggers:
      - trigger: state
        entity_id: input_button.coffee_used
    actions:
      - action: haventory.item_adjust_quantity
        data:
          item_id: "0f2c…"
          delta: -1
```

A script that files a delivery, with every field the card's editor offers:

```yaml
script:
  file_the_coffee_delivery:
    sequence:
      - action: haventory.item_create
        data:
          name: Coffee beans
          quantity: 2
          category: Food
          tags: [pantry]
          low_stock_threshold: 2
          location_id: "8a11…"
```

To read an id: open an item from the card and its **ID** is on it, with **Copy** beside it —
the last fact on the detail sheet a narrow surface opens, the last row of the edit form
everywhere else. A location's is in its editor, under ⋮ → **Organize** → Locations → ✎. A JSON
export (⋮ → **Export backup**) carries both as well.

Every action returns the entity it touched, so a script can chain calls through
`response_variable`. The sensors and what each one counts, the event payloads, the calendar,
reminders and the shopping-list bridge, each with a worked example:
[`docs/automations.md`](docs/automations.md).

## Known limitations

What HAventory does *not* do today, stated up front so none of it is a surprise:

- **Scale: writes get slower as the inventory grows.** Every mutation re-serializes the
  entire inventory and rewrites the store blob, so an edit costs more the more you have.
  Measured against a real Home Assistant, one editor at a time — which is what a household
  is — create p50 runs 2.5 ms on an empty store, 9.5 ms at 1 000 items, 17 ms at 2 000 and
  43 ms at 5 000: linear at roughly 8 µs per item, with the persist about three quarters of
  it. At and above ~3 000 items the p95 spikes to 230–280 ms against a 21–37 ms median, so
  the occasional slow save arrives before the median becomes a problem. Bulk operations and
  import write **once per batch** rather than once per row, so the paths that change many
  items at a time do not multiply the cost. Reads don't share the problem (query paths are
  benchmarked at 10 000 items), correctness is unaffected at any size, and no limit is
  enforced. Several thousand items is comfortable; past that, an edit starts to be
  something you notice. The ceiling above a few thousand items is measured on real hardware
  and published in [#277](https://github.com/chrreiter/HAventory/issues/277).
- **No admin gating.** Neither a WebSocket command nor a `haventory.*` service asks whether
  the caller is an administrator, so any logged-in Home Assistant user — not only
  administrators — can read and mutate the whole inventory. It is a household-wide tool,
  not a per-user one, which is the same choice Home Assistant's own to-do and shopping
  lists make. The reasoning, and what gating it would cost, is in
  [#479](https://github.com/chrreiter/HAventory/issues/479).
- **Nothing bounds how fast a client may use the API.** There is no rate limit on commands
  or on subscription events, so a script in a loop or a wall panel stuck reconnecting is
  answered as fast as Home Assistant can serve it. What protects a household instead is
  that the API is reachable only by someone already logged in to Home Assistant.
- **Import identity is the id, never the name.** The `merge` / `replace` / `skip` policies
  all classify an incoming item or location by its id. Restoring a backup onto entities
  you rebuilt by hand — which carry fresh uuids — therefore duplicates them instead of
  merging, and the backup's items follow their stored `location_id` onto the duplicate.
  Restore into an empty inventory, or onto one whose ids are still intact. **The import
  preview flags this before you write anything**: every incoming entry about to be added
  under a name something here already answers to — under a different id — is listed as a
  name clash in the preview sheet. It warns rather than gates, because resolving it would
  mean matching by name, which is exactly what identity-by-id exists to avoid.
- **A JSON export carries attachment *metadata*, not the files.** The export is one
  WebSocket result the card writes to a file, so it cannot carry binaries; photos and
  manuals live on disk under `<config>/haventory/attachments/`. Importing a document onto
  an install that does not hold those files keeps the references and shows a "file
  missing" state — the preview reports how many before you write anything, and the card
  marks each affected entry rather than offering a link to a 404 or a broken image: the
  Documents list on the row, the photo where its tile would be, wherever the card draws one.
  **Home Assistant's own backups are the full-fidelity path**: the media directory sits
  inside the config directory, so a backup and restore carries the files and the store
  together and consistently.
- **Nothing is resized or thumbnailed on the server.** Server-side resizing would mean a
  Pillow dependency in a local-push integration — install size, wheel availability on every
  HA architecture, and CPU on a Pi. The *card* re-encodes a photo over 2 MB before it
  uploads, capped at 2048px on the longest edge, which is what keeps a phone frame under
  the 8 MB per-file cap; the file that arrives is the one that is stored, and a re-encode
  that fails or comes out larger simply uploads the original. Lists still load the stored
  file at full size, leaning on `loading="lazy"` and `decoding="async"`.

Every one of these is a decision rather than an oversight, and the reasoning is with the
bullet. Two of them are also open work and say so above, linking the issue that carries the
measurements and the proposed fix; the rest are settled, and the
[issue tracker](https://github.com/chrreiter/HAventory/issues) is where that would change.

## Troubleshooting

**Where to look first.** Settings → System → **Logs** carries everything HAventory writes;
the full file is `/config/home-assistant.log`, reachable through the File editor or Terminal
add-on. Settings → **Repairs** is where a store HAventory refused to load says so in one
line. The inventory itself is one file, `/config/.storage/haventory_store`.

**Settings → Devices & services → HAventory → ⋮ → Download diagnostics** writes a JSON with
counts, schema versions, which runtime pieces are loaded and whether
the card bundle is deployed. It carries no item or location content — no names, notes or
custom-field values — so it is safe to attach to a public issue. If you need the content,
use the export instead.

Three messages are worth recognising, all three of which also appear in **Repairs**:

- **"stored data uses schema version N, which is newer than this build supports"** — the
  store was written by a newer HAventory, typically after rolling the integration back or
  restoring a backup taken on a newer version. The entry stops with that error and the
  store is left untouched; re-install the newer version to read it, or replace
  `haventory_store` with a backup taken on the running version.
- **"stored data has a corrupt schema_version (…); expected an integer"** — the store holds
  something other than a whole number there: a hand edit, a truncated write, or a quoted
  number such as `"5"`, which is not the same as `5` and is not assumed to mean it. Fix the
  value, or restore the file from a backup.
- **"HAventory could not read N item(s) / location(s)"** — some entries are structurally
  broken: a hand edit, a truncated write, a row with no usable name, or a location whose
  parent chain loops back on itself. The entry stops rather than loading the readable
  remainder, because HAventory saves on every change and a partial load would make the loss
  permanent on the first edit. The message names the first few affected ids. This one
  offers a **Fix** button in Repairs: it copies the store to `haventory_store_corrupt_backup`
  and starts with everything it could read, leaving the unreadable entries out — take that
  only if you would rather have the remainder than repair the file, and note that the offer
  applies to one start.

## Where next

- [`docs/installing.md`](docs/installing.md) — where HAventory appears, how the card is
  loaded, the card's configuration keys, YAML-mode dashboards, removing it again.
- [`docs/automations.md`](docs/automations.md) — the sensors, the events, the calendar,
  reminders and the shopping-list bridge.
- [`docs/backend_api_contract.md`](docs/backend_api_contract.md) and
  [`docs/data_shapes.md`](docs/data_shapes.md) — the WebSocket API, for anyone writing a
  client.
- [`docs/developing.md`](docs/developing.md) and
  [`docs/frontend_architecture.md`](docs/frontend_architecture.md) — the toolchain, the
  gate, the test modes, the card's architecture.

Bugs and feature requests go through the
[issue tracker](https://github.com/chrreiter/HAventory/issues/new/choose), questions through
[Discussions](https://github.com/chrreiter/HAventory/discussions), and security problems
through [private reporting](SECURITY.md) rather than a public issue. Contributions are
welcome — [CONTRIBUTING.md](CONTRIBUTING.md) says how, and taking part means following the
[Code of Conduct](CODE_OF_CONDUCT.md).
