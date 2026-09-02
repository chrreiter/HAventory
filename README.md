# HAventory

[![CI](https://github.com/chrreiter/HAventory/actions/workflows/ci.yml/badge.svg)](https://github.com/chrreiter/HAventory/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/chrreiter/HAventory?include_prereleases)](https://github.com/chrreiter/HAventory/releases)
[![HACS: Custom](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://github.com/hacs/integration)
[![License: Apache-2.0](https://img.shields.io/github/license/chrreiter/HAventory)](LICENSE)

**A household inventory that lives inside Home Assistant.** Where is the good drill, how
much coffee is left, is the ladder back yet, when is the fire extinguisher due for its next
check? HAventory answers those on the same screen as everything else in the house.

It is a custom integration (domain `haventory`) plus a Lovelace card. Everything is stored
locally in Home Assistant's own store and pushed live to every open screen. No account, no
cloud, no external service. Minimum Home Assistant **2026.6.0**.

![The HAventory full view: a location tree beside a sortable table of items](https://raw.githubusercontent.com/chrreiter/HAventory/main/docs/assets/screenshots/full-view.png)

## What it is

- **A location tree as deep as your house.** Home Assistant stops at floor and area.
  HAventory files a thing in *Garage › Shelving unit › Top box* and counts every level. An
  item's **area** is inherited from the top of its tree, so HAventory's places and Home
  Assistant's areas never drift apart.
- **Search that finds it anyway.** Case-insensitive and accent-insensitive, with filters for
  location, area, category, tags, status, low stock, check-outs, overdue dates and date
  windows. Each filter shows how many items it would keep before you apply it.
- **Check out what leaves the house**, with a due date. The card shows what is out and marks
  it overdue once the date passes.
- **Photos and PDF manuals** on the item itself, stored inside your config directory and
  served through Home Assistant's authenticated view, never from `/local`. On a phone the
  editor offers a *Take photo* tile beside the picker.
- **Quantities, low-stock thresholds and a shopping list.** Pick one of your to-do lists and
  everything at or below its threshold writes itself onto it.
- **Inspection dates and repeating reminders.** Change the filter every three months, service
  the extinguisher every year. They appear on a real calendar entity, with nothing scheduled
  and nothing to drift.
- **Bulk operations and an organize dialog.** Move, retag, recategorise, check out or delete
  a whole selection. Rename or merge locations, categories, tags and statuses in one place.
  Statuses are your own vocabulary: *OK*, *Missing* and *Needs repair* to begin with, and you
  can add, rename, recolour or retire them.
- **One page and any number of cards.** A sidebar entry opens the full workspace. The same
  bundle draws a card on any dashboard you like.

![The card with an item open for editing](https://raw.githubusercontent.com/chrreiter/HAventory/main/docs/assets/screenshots/item-editor.png)

![HAventory on a phone: the list, an item's detail sheet, and the filter sheet](https://raw.githubusercontent.com/chrreiter/HAventory/main/docs/assets/screenshots/phone.png)

**Languages:** English and German. Both the card and the integration's own screens follow
your Home Assistant profile language and fall back to English. Adding a language is two
files: see [CONTRIBUTING.md](CONTRIBUTING.md#adding-a-language).

## Install

[![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=chrreiter&repository=HAventory&category=integration)

HAventory is not in the HACS default store yet, so it goes in as a custom repository. The
button above opens your own Home Assistant and does steps 1 and 2 for you.

1. In Home Assistant, open **HACS → ⋮ → Custom repositories**.
2. Add `https://github.com/chrreiter/HAventory` with category **Integration**.
3. Install **HAventory**, then restart Home Assistant.
4. Add it under **Settings → Devices & services → Add integration → HAventory**:

   [![Open your Home Assistant instance and start setting up a new integration.](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=haventory)

5. Reload the browser page once so the card reaches a tab you already had open. A normal
   reload is enough; there is no cache to clear.

HACS installs **released versions only**. It downloads the `haventory.zip` attached to a
GitHub release, which already contains the built card. Installing from the default branch is
deliberately not offered: the card bundle is a build artifact and is not in git, so a branch
install would come up without a card.

Minimum Home Assistant version: **2026.6.0**. It is the oldest release that runs the
integration and carries no known unpatched high or critical security advisory. The
integration may work on older releases, but the declared minimum is also a recommendation
about what to run, and this project will not point it at a release with a known security
hole.

Where HAventory appears after install, how the card reaches YAML-mode dashboards, and how to
remove it again: [`docs/installing.md`](docs/installing.md).

## Configure

Setup asks two things: what the card is called, and whether HAventory gets a **sidebar**
entry (yes by default, so there is somewhere to click before you have built a dashboard).

Everything else lives under **Settings → Devices & services → HAventory → Configure** and
takes effect without a restart:

- **Card title** and the **sidebar entry**, the same two, editable afterwards.
- **Shopping list**: which `todo.*` list low stock is mirrored onto. Empty means off, which is
  the default.
- **Quick-filter pills**: which of the six pills (`total`, `low_stock`, `overdue`,
  `inspection_due`, `reminder_due`, `checked_out`) every surface offers.

## Add the card

On a dashboard you created yourself: **Add card**, then search *HAventory*. The visual
editor covers the title; the YAML is:

```yaml
type: custom:haventory-card
title: Pantry # optional; overrides the integration-wide card title
quick_filters: # optional; which quick-filter pills this card offers
  - low_stock
  - checked_out
```

Those two keys are the only ones the card reads, and both are optional. Without them the
card follows the integration's own settings, as the sidebar page always does. Any other key
is ignored rather than rejected, so a stale dashboard config never breaks the card. What each
key accepts, and which setting wins where: [`docs/installing.md`](docs/installing.md#card-configuration).

Home Assistant's redesigned Overview hosts no cards at all, core or custom. It does take a
shortcut to a panel: **Edit** the Overview, choose **Add shortcut**, and pick **HAventory**.

## Automate it

HAventory shows up as **sensors and a calendar entity on one device**, fires
`haventory_item_changed` and `haventory_low_stock` on the bus, and puts its own
**`haventory.*` actions** in Developer Tools → Actions. None of it polls.

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

Write back to the inventory, here from a button by the coffee machine that books one bag out:

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

To find an item's id, open the item in the card: the **ID** row with a **Copy** button sits
at the bottom of the detail sheet (on narrow screens) or of the edit form. A location's id is
in its editor, under ⋮ → **Organize** → Locations → ✎. A JSON export (⋮ → **Export
backup**) carries both as well.

Every action returns the entity it touched, so a script can chain calls through
`response_variable`. The sensors, the event payloads, the calendar, reminders and the
shopping-list bridge, each with an example: [`docs/automations.md`](docs/automations.md).

## Known limitations

What HAventory does *not* do today:

- **Writes get slower as the inventory grows.** Every mutation rewrites the whole store
  blob. Measured against a real Home Assistant with one editor at a time, a create takes
  about 2.5 ms on an empty store, 9.5 ms at 1 000 items, 17 ms at 2 000 and 43 ms at 5 000.
  Above about 3 000 items the occasional save spikes to 230–280 ms. Bulk operations and
  import write once per batch, reads are unaffected, and no limit is enforced. Several
  thousand items is comfortable. Measuring the exact ceiling on real hardware is open work in
  [#277](https://github.com/chrreiter/HAventory/issues/277).
- **No admin gating.** Any logged-in Home Assistant user can read and change the whole
  inventory. It is a household-wide tool, the same choice Home Assistant's own to-do and
  shopping lists make. The reasoning is in
  [#479](https://github.com/chrreiter/HAventory/issues/479).
- **No rate limit.** Commands and subscription events are answered as fast as Home Assistant
  can serve them. What protects a household is that the API is reachable only by someone
  already logged in.
- **Import identity is the id, never the name.** The `merge`, `replace` and `skip` policies
  classify an incoming item or location by its id. Restoring a backup onto entities you
  rebuilt by hand, which carry fresh ids, duplicates them instead of merging. Restore into an
  empty inventory, or onto one whose ids are still intact. The import preview lists every
  name clash before you write anything. It warns rather than blocks, because resolving it
  would mean matching by name, which is what identity-by-id exists to avoid.
- **A JSON export carries attachment metadata, not the files.** Photos and manuals live on
  disk under `<config>/haventory/attachments/`. Importing onto an install that does not hold
  those files keeps the references and shows a "file missing" state; the preview reports how
  many. Home Assistant's own backups carry the files and the store together, and are the
  full-fidelity path.
- **Photos are stored as uploaded; small versions are best-effort.** The card re-encodes a
  photo over 2 MB before upload, capped at 2048px on the longest edge, which keeps a phone
  photo under the 8 MB per-file cap. For list rows the backend writes a 256px tile beside the
  original, but only where the Pillow library happens to be installed. HAventory does not
  require it, so without it the rows load the full-size file and the page is slower rather
  than broken.
- **The Android companion app cannot open the camera from the card.** Its file picker
  ignores the capture request, so the *Take photo* tile opens the file picker instead. Take
  the photo with the camera app and add it from the library. The tile does open the camera in
  Safari, in the iOS companion app and in Chrome on Android. The upstream bug is
  [home-assistant/android#6055](https://github.com/home-assistant/android/issues/6055).

All of these but the last are decisions rather than oversights. The scale ceiling is open
work, the Android camera waits on the companion app, and the rest are settled. The
[issue tracker](https://github.com/chrreiter/HAventory/issues) is where that would change.

## Troubleshooting

**Where to look first.** Settings → System → **Logs** carries everything HAventory writes;
the full file is `/config/home-assistant.log`. Settings → **Repairs** is where a store
HAventory refused to load says so. The inventory itself is one file,
`/config/.storage/haventory_store`.

**Settings → Devices & services → HAventory → ⋮ → Download diagnostics** writes a JSON
with counts, schema versions, which runtime pieces are loaded and whether the card bundle is
deployed. It carries no item or location content, so it is safe to attach to a public issue.

Three messages are worth recognising. All three also appear in **Repairs**:

- **"stored data uses schema version N, which is newer than this build supports"**: the
  store was written by a newer HAventory, typically after a rollback or after restoring a
  backup taken on a newer version. The entry stops and the store is left untouched.
  Re-install the newer version, or replace `haventory_store` with a backup taken on the
  running version.
- **"stored data has a corrupt schema_version (…); expected an integer"**: the store holds
  something other than a whole number there, such as a hand edit, a truncated write, or a
  quoted number like `"5"`. Fix the value, or restore the file from a backup.
- **"HAventory could not read N item(s) / location(s)"**: some entries are structurally
  broken. The entry stops rather than loading the readable remainder, because HAventory
  saves on every change and a partial load would make the loss permanent on the first edit.
  The message names the first few affected ids. This one offers a **Fix** button in Repairs:
  it copies the store to `haventory_store_corrupt_backup` and starts with everything it could
  read. Take that only if you would rather have the readable remainder than repair the file.

## Where next

- [`docs/installing.md`](docs/installing.md): where HAventory appears, how the card is
  loaded, the card's configuration keys, YAML-mode dashboards, removing it again.
- [`docs/automations.md`](docs/automations.md): the sensors, the events, the calendar,
  reminders and the shopping-list bridge.
- [`docs/backend_api_contract.md`](docs/backend_api_contract.md) and
  [`docs/data_shapes.md`](docs/data_shapes.md): the WebSocket API, for anyone writing a
  client.
- [`docs/developing.md`](docs/developing.md) and
  [`docs/frontend_architecture.md`](docs/frontend_architecture.md): the toolchain, the gate,
  the test modes, the card's architecture.

Bugs and feature requests go through the
[issue tracker](https://github.com/chrreiter/HAventory/issues/new/choose), questions through
[Discussions](https://github.com/chrreiter/HAventory/discussions), and security problems
through [private reporting](SECURITY.md) rather than a public issue. Contributions are
welcome: [CONTRIBUTING.md](CONTRIBUTING.md) says how, and taking part means following the
[Code of Conduct](CODE_OF_CONDUCT.md).
