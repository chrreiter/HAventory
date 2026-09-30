# Installing and running HAventory

The install steps are in the [README](../README.md#install). This page covers what comes
after: the options, where HAventory shows up, the card's configuration, photos, backups,
troubleshooting and removing it again.

## Options

Setup asks two things: what the card is called, and whether HAventory gets a **sidebar**
entry (yes by default, so there is somewhere to click before you have built a dashboard).
Everything can be changed later under **Settings → Devices & services → HAventory →
Configure**, without a restart:

| Option | Default | What it does |
|---|---|---|
| Card title | HAventory | The heading of every card that has no `title:` of its own, and the name of the sidebar entry. An open dashboard shows a new title after a reload. |
| Show HAventory in the sidebar | on | Adds or removes the sidebar entry as soon as you save. |
| Quick-filter pills | all six | Which one-tap filters the card and the sidebar page offer: *Item total*, *Low stock*, *Overdue*, *Due for inspection*, *Reminder due*, *Checked out*. |
| Shopping list → To-do list | empty (off) | The to-do list that low-stock items are written onto. See [Shopping list](automations.md#shopping-list). |

## Where HAventory appears

**The sidebar entry** opens the full view as a page of its own: the location tree, the item
table, and the ⋮ menu with **Select items…**, **Organize…**, **Columns…**, export and
import.

- **Reload the browser page once after installing or updating.** Home Assistant hands an
  integration's JavaScript to a page when the page loads, so a tab that was already open
  has neither the card nor the sidebar icon yet. Opening the sidebar entry works too.
- **Hiding it for one user only:** the sidebar option is for everyone. Home Assistant's own
  **Edit sidebar** mode hides any entry for the logged-in user alone.
- **If you are on the page when the entry is turned off**, Home Assistant shows "panel not
  found" the next time you navigate. Turning it back on restores the page.

**On a dashboard you created yourself**, choose **Add card** and search *HAventory*. The
card is a compact list with search, filters and the quick-filter pills. Its **Open full
view** button opens the same full view the sidebar page shows.

**On the Overview.** Home Assistant's redesigned Overview hosts no cards at all, core or
custom. It does take a shortcut to a panel: **Edit** the Overview, choose **Add shortcut**,
and pick **HAventory**. The shortcut is per user, which is why HAventory cannot add it for
you.

## Card configuration

The card takes two optional keys:

```yaml
type: custom:haventory-card
title: Pantry   # optional; overrides the integration-wide card title
quick_filters:  # optional; which quick-filter pills this card offers
  - low_stock
  - checked_out
```

| Key | Type | Default | What it does |
|---|---|---|---|
| `title` | string | the **Card title** option | Names this card, on this dashboard only. |
| `quick_filters` | list | the **Quick-filter pills** option | Which pills this card and its full view offer: `total`, `low_stock`, `overdue`, `inspection_due`, `reminder_due`, `checked_out`. |

- **The visual editor covers `title` only.** A card added from the card picker starts with
  `title: HAventory` filled in, which keeps it on that name when you rename HAventory under
  **Configure**. Empty the field to let the card follow the option. Saving the visual
  editor leaves an existing `quick_filters` key as it was.
- **Set `quick_filters` in YAML**, and only for the one dashboard that should differ. The
  option under **Configure** is the one place that also reaches the sidebar page.
- **A pill only shows when it has something to count**, so `low_stock` draws nothing while
  nothing is low. An empty list offers no pills. `total` shows as a pill only on the card at
  full width; the full view and the sidebar page print the total in their header instead.
- **Unknown keys are ignored**, not rejected, so an old dashboard config never breaks the
  card. An unknown pill name is dropped, and a `quick_filters` value that is not a list
  counts as not set.

## How the card is loaded

The card ships inside the integration, which serves it at
`/haventory_static/haventory-card.js`. Nothing is copied into `<config>/www/`. HAventory
registers that URL as a dashboard resource and also as a frontend module, so the card loads
whichever way your dashboards are set up, and it is only ever defined once.

**YAML-mode dashboards** (`lovelace:` with `mode: yaml` in `configuration.yaml`) need no
manual step either. Home Assistant reads the resource list from `configuration.yaml` in that
mode, so HAventory skips the resource and the frontend module carries the card.

## Updating

HACS offers new releases like any other integration. Install the update, restart Home
Assistant, and reload open browser tabs once. HAventory upgrades its stored data by itself
on the first start.

Take a backup before updating if you might want to roll back. When a release changes the
storage format, an older release refuses the data the newer one wrote (see
[Troubleshooting](#troubleshooting)).

**Leftovers from early versions.** A `<config>/www/haventory/` folder is no longer used and
can be deleted. A `resources:` entry you added by hand in YAML mode must point at
`/haventory_static/haventory-card.js` with `type: module`, or be deleted. An entry with an
old URL loads a second copy of the card, and the second copy fails.

## Photos and manuals

An item holds up to 10 photos (JPEG, PNG, WebP or GIF) and 10 PDF manuals, each up to 8 MB.
The card shrinks a photo over 2 MB to at most 2048 pixels on its longest edge before it
uploads, which keeps a phone photo under the limit.

The files live under `<config>/haventory/attachments/` and are served only to logged-in
users, never through `/local`. List rows use a small 256-pixel version when the Pillow
library is available to Home Assistant. Without it they load the full photo: slower, but
nothing breaks.

**Android companion app:** the *Take photo* tile opens the file picker instead of the
camera, because the app's file picker ignores the camera request
([home-assistant/android#6055](https://github.com/home-assistant/android/issues/6055)). Take
the photo with the camera app and pick it from the library. The tile opens the camera in
Safari, in the iOS companion app, and in Chrome on Android.

## Backups, export and import

**Home Assistant's own backups are the complete copy.** They carry the inventory
(`<config>/.storage/haventory_store`) and the photos and manuals together.

**HAventory's JSON export** is for moving data or keeping a copy you can read. In the full
view's ⋮ menu:

- **Export backup** downloads every item, location and status as
  `haventory-export-<time>.json`.
- **Export current view** downloads only the items the current filter shows, with the
  locations they sit in.

An export carries each attachment's details but not the file. Imported onto an install that
does not have those files, the photos and manuals show as missing.

**Import backup…** takes a file or pasted JSON and asks what to do with an item that
already exists:

- **Merge**: update it field by field and combine the tags.
- **Replace**: overwrite it with the file's version. Photos and manuals the file does not
  list are deleted from that item.
- **Skip**: leave it as it is and only add what is new.

A preview shows what would be added, updated or left alone before anything is written. The
import itself is all or nothing, and every open card reloads afterwards.

**Items and locations are matched by id, never by name.** Importing a backup onto an
inventory you rebuilt by hand, whose entries carry new ids, duplicates them instead of
updating them. Restore into an empty inventory, or onto one whose ids are still intact. The
preview warns about every name that would be duplicated.

## Troubleshooting

**Where to look first.** **Settings → System → Logs** carries everything HAventory writes.
**Settings → Repairs** is where HAventory says it refused to load its data.

**Settings → Devices & services → HAventory → ⋮ → Download diagnostics** writes a JSON file
with counts, versions and whether the card is installed. It contains nothing about your
items or locations beyond the counts, so it is safe to attach to a public issue.

Three messages are worth recognising. Each also appears in **Repairs**, and in each case the
stored file is left untouched:

- **"stored data uses schema version N, which is newer than this build supports"**: the data
  was written by a newer HAventory, usually after a rollback or after restoring a backup
  from a newer version. Install the newer version again, or restore
  `.storage/haventory_store` from a backup taken on the version you are running.
- **"stored data has a corrupt schema_version (…); expected an integer"**: the version field
  in the stored file is not a whole number, for example after a hand edit or a cut-off
  write. Fix the value, or restore the file from a backup.
- **"HAventory could not read N item(s) / location(s)"**: some entries are damaged.
  HAventory stops rather than loading the rest, because it saves on every change and the
  first edit would make the loss permanent. The message names the first few affected ids.
  In **Repairs**, **Fix** copies the file to `.storage/haventory_store_corrupt_backup` and
  starts with everything it could read. Take that only if you would rather have the
  readable remainder than repair the file.

## Removing HAventory

Delete the integration under **Settings → Devices & services**. That removes the sidebar
entry and the card loaders. A `resources:` entry you added by hand in YAML mode and an
Overview shortcut are yours to remove.

A dashboard left open in another tab stops working at once: every request it makes is
refused, and nothing more is written. Reload the tab and the card is gone. The same
happens while the integration is **disabled**. During a **reload** an open card shows
"Live updates paused" for a few seconds and then carries on.

**Your inventory is kept.** Removing the integration does not touch
`<config>/.storage/haventory_store`, so adding it again brings everything back.

To delete the data as well, after exporting a backup if you might want it later:

1. Remove the integration and stop Home Assistant.
2. Delete `<config>/.storage/haventory_store`, and `<config>/.storage/haventory_todo_links`
   if you ever set a shopping list.
3. Delete `<config>/haventory/attachments/` if you attached photos or manuals.
4. Start Home Assistant.
