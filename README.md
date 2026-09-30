# HAventory

[![CI](https://github.com/chrreiter/HAventory/actions/workflows/ci.yml/badge.svg)](https://github.com/chrreiter/HAventory/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/chrreiter/HAventory?include_prereleases)](https://github.com/chrreiter/HAventory/releases)
[![HACS: Custom](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://github.com/hacs/integration)
[![License: Apache-2.0](https://img.shields.io/github/license/chrreiter/HAventory)](LICENSE)

**A household inventory that lives inside Home Assistant.** Where is the good drill, how
much coffee is left, is the ladder back yet, when is the fire extinguisher due for its next
check? HAventory answers those on the same screen as everything else in the house.

It is a custom integration plus a Lovelace card. Everything is stored locally in Home
Assistant and pushed live to every open screen. No account, no cloud, no external service.
Minimum Home Assistant **2026.7.0**.

![The HAventory full view: a location tree beside a sortable table of items](https://raw.githubusercontent.com/chrreiter/HAventory/main/docs/assets/screenshots/full-view.png)

## What it is

- **Locations as deep as your house.** Home Assistant stops at floor and area. HAventory
  files a thing in *Garage › Shelving unit › Top box*. Link the top of a tree to a Home
  Assistant area and everything inside it belongs to that area.
- **Search and filters.** Search ignores case and accents. Filter by location, area,
  category, tags, status, low stock, check-outs and dates.
- **Check-outs** with a due date, marked overdue once the date passes.
- **Photos and PDF manuals** on the item, with a *Take photo* tile on a phone.
- **Quantities and low stock.** Give an item a threshold and HAventory can write it onto
  one of your to-do lists when it runs low.
- **Inspection dates and repeating reminders** ("change the filter every three months"),
  shown on a calendar entity.
- **Bulk edits and tidying up.** Move, retag, check out or delete a whole selection.
  Rename or merge locations, categories, tags and statuses in one place. Statuses are your
  own: *OK*, *Missing* and *Needs repair* to begin with.
- **Sensors, events and actions** for automations, and a JSON backup you can export and
  import.
- **A sidebar page and any number of dashboard cards**, in English or German, following
  your Home Assistant profile language.

![The card with an item open for editing](https://raw.githubusercontent.com/chrreiter/HAventory/main/docs/assets/screenshots/item-editor.png)

![HAventory on a phone: the list, an item's detail sheet, and the filter sheet](https://raw.githubusercontent.com/chrreiter/HAventory/main/docs/assets/screenshots/phone.png)

## Install

[![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=chrreiter&repository=HAventory&category=integration)

HAventory is not in the HACS default store yet, so it goes in as a custom repository. The
button above opens your own Home Assistant and does steps 1 and 2 for you.

1. In Home Assistant, open **HACS → ⋮ → Custom repositories**.
2. Add `https://github.com/chrreiter/HAventory` with category **Integration**.
3. Install **HAventory**, then restart Home Assistant.
4. Add it under **Settings → Devices & services → Add integration → HAventory**:

   [![Open your Home Assistant instance and start setting up a new integration.](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=haventory)

5. Reload the browser page once, so a tab that was already open picks up the card. A normal
   reload is enough.

Minimum Home Assistant version: **2026.7.0**, the oldest release that runs HAventory and has
no known unpatched high or critical security advisory. HACS installs released versions only.

More on setup, the card's options, YAML-mode dashboards, updating and removing:
[`docs/installing.md`](docs/installing.md).

## First steps

1. **Open HAventory from the sidebar.** Setup adds the entry unless you turned it off.
2. **Build a few locations.** In the location tree, choose **New location…**. To tie a tree
   to a Home Assistant area, open ⋮ → **Organize…** → Locations and pick the area.
3. **Add items** with **Add item**. Only the name is required. Add a quantity and a
   low-stock threshold for things you use up, a due date when you lend something out.
4. **Put a card on a dashboard** (optional): **Add card**, then search *HAventory*. The
   sidebar page and the card show the same inventory. On the redesigned Overview, which
   hosts no cards, use **Edit → Add shortcut → HAventory** instead.
5. **Tune it** under **Settings → Devices & services → HAventory → Configure**: the title,
   the sidebar entry, which quick-filter pills show, and the to-do list low stock goes to.

Then have a look at [`docs/automations.md`](docs/automations.md) for what Home Assistant
can do with it.

## Good to know

- **Everyone logged in can edit.** Any Home Assistant user can read and change the whole
  inventory, the same as Home Assistant's own to-do and shopping lists. The reasoning is in
  [#479](https://github.com/chrreiter/HAventory/issues/479).
- **Size.** Several thousand items is comfortable. Every change rewrites the whole store,
  so saving gets slower as the inventory grows, and no limit is enforced.
- **Backups.** A Home Assistant backup carries the inventory and its photos. HAventory's own
  JSON export carries the data but not the files:
  [backups and import](docs/installing.md#backups-export-and-import).
- **Android companion app.** The *Take photo* tile opens the file picker there, not the
  camera: [photos and manuals](docs/installing.md#photos-and-manuals).
- **Something wrong?** See [troubleshooting](docs/installing.md#troubleshooting).

## Where next

- [`docs/installing.md`](docs/installing.md): setup options, the card's configuration,
  YAML-mode dashboards, photos, backups and import, troubleshooting, removing HAventory.
- [`docs/automations.md`](docs/automations.md): the sensors, the calendar, the events, the
  `haventory.*` actions, reminders and the to-do list mirror, with examples.
- Writing a client or working on the code: [`CONTRIBUTING.md`](CONTRIBUTING.md), the
  [WebSocket API](docs/backend_api_contract.md) and its [data shapes](docs/data_shapes.md),
  and [`docs/developing.md`](docs/developing.md).

Bugs and feature requests go through the
[issue tracker](https://github.com/chrreiter/HAventory/issues/new/choose), questions through
[Discussions](https://github.com/chrreiter/HAventory/discussions), and security problems
through [private reporting](SECURITY.md) rather than a public issue. Taking part means
following the [Code of Conduct](CODE_OF_CONDUCT.md). New languages are welcome:
[adding a language](CONTRIBUTING.md#adding-a-language).
