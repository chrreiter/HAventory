# Installing HAventory

The short version is in the [README](../README.md#install); this is the long form —
where HAventory appears once it is installed, how the card reaches your dashboards,
what YAML-mode Lovelace needs, and how to remove it again.

## Finding HAventory after install

Setup asks two things — what the card is called, and whether HAventory gets a **sidebar**
entry (yes by default, so there is somewhere to click before you have built a dashboard).
Both are editable afterwards under **Configure**. The entry opens the full view as a page
of its own — the same workspace the card's ⋮ → full view opens, with the same menu,
dialogs and editors — and carries the HAventory mark and whatever name you gave the card.

- **Reload the browser page once after installing.** Home Assistant hands an integration's
  JavaScript to a page when that page loads, so a tab that was already open when HAventory
  was installed or updated has neither the card nor the artwork behind its sidebar icon
  yet — the entry shows up without its mark until the next load. One ordinary reload is
  all it takes; no cache clearing, and nothing to repeat later. Clicking the bare sidebar
  entry works too: panel and card ship in one bundle, and a dashboard replaces its "custom
  element doesn't exist" tile with the real card the moment that bundle loads. Either way,
  a page that has shown the card once keeps it for as long as it stays open — the backend
  restarting or updating underneath changes nothing until the page next loads.

- **Turning it off:** Settings → Devices & services → HAventory → **Configure** →
  *Show HAventory in the sidebar*. The entry appears and disappears as you save the form;
  no restart, no reload. Renaming the card renames the sidebar entry the same way.
- **Hiding it for one user only:** the option above is instance-wide. Home Assistant's own
  **Edit sidebar** mode hides any entry for the logged-in user alone, and that setting
  follows the user across their devices.
- **If you are on the page when it is turned off**, Home Assistant shows "panel not found"
  the next time you navigate; nothing breaks and turning it back on restores the page.

**Pinning HAventory onto the Overview.** Home Assistant's redesigned Overview — the
landing page on a fresh install — is not a Lovelace dashboard and hosts **no cards at
all**, core or custom, so the HAventory card cannot be placed there. What it does take is
a shortcut to a panel: open the Overview, **Edit** it, choose **Add shortcut**, and pick
**HAventory** from the list. That tile is per-user (Home Assistant stores it with your
profile), which is why HAventory cannot add it for you.

On a dashboard you created yourself the card works as it always has: **Add card** →
search *HAventory*.

## How the card gets loaded

The card bundle ships inside the integration, and the integration serves it at
`/haventory_static/haventory-card.js`. Nothing is copied into your `<config>/www/`
directory, and nothing is left behind there when you uninstall.

Two mechanisms then point the frontend at that one URL, so every way of viewing a
dashboard is covered: a Lovelace resource entry (registered automatically in the default
storage mode — this is what HA Cast reads) and the frontend's extra-module
list (which needs no stored state and works in YAML resource mode). Both receive the same
URL, so the card is only ever defined once. The sidebar page loads that same URL as its
module — same string again, so the browser reuses the bundle it already has.

**YAML-mode dashboards** therefore need no manual step either. You are in YAML mode if
`configuration.yaml` has a `lovelace:` block with `mode: yaml`; in the UI, with
**Advanced Mode** enabled on your profile, **Settings → Dashboards → ⋮** offers no
**Resources** entry and the dashboard has no edit (pencil) button. Home Assistant reads
that resource list from `configuration.yaml` and no integration can add to it, so
HAventory skips resource registration there and logs it at debug level — the extra-module
loader carries the card instead.

If you did add a `resources:` entry by hand under an earlier version, point it at the new
URL or delete it; a second entry for the same module makes the browser define the card
twice and the second definition fails:

```yaml
lovelace:
  mode: yaml
  resources:
    - url: /haventory_static/haventory-card.js
      type: module
```

## Card configuration

The card takes two optional keys, and a card that carries neither follows the
integration-wide settings — which is what the sidebar page always does.

```yaml
type: custom:haventory-card
title: Pantry   # optional; overrides the integration-wide card title
quick_filters:  # optional; which quick-filter pills this card offers
  - low_stock
  - checked_out
```

| Key | Type | Default | What it does |
|---|---|---|---|
| `title` | string | the integration-wide card title | Names this card, for this dashboard only. |
| `quick_filters` | list | the integration-wide choice, or every pill | Which quick-filter pills the card and its full view offer: `total`, `low_stock`, `overdue`, `inspection_due`, `reminder_due`, `checked_out`. |

Those two are the only options the card reads. Any other key is ignored rather than
rejected, so a stale dashboard config never breaks the card — and the same holds inside
`quick_filters`: an unknown pill name is dropped, and a value that is not a list reads as
the key being absent.

Adding the card from the card picker opens a **visual editor**, which covers `title` only;
switching to the YAML view shows the same config. `quick_filters` is set in YAML: the pill
choice meant to reach every surface (the sidebar panel included) belongs in the
integration's options, and the per-dashboard key exists for the one dashboard that should
differ. Editing a card through the visual editor leaves an existing `quick_filters` key
exactly as it was.

Without `title`, the card uses the name set under Settings → Devices & services →
HAventory → **Configure** (asked for at setup too, and defaulting to "HAventory"), so one
setting renames every card. Per-dashboard `title:` wins over it — use that when two
dashboards should name the same inventory differently. An open dashboard picks up a
changed name on its next refresh or reload; the change is not pushed live.

`quick_filters` says which pills are *allowed*; a pill still only shows when it has
something to count, so `low_stock` draws nothing while nothing is low. An explicit empty
list is a choice and offers none. `total` is narrower than the other five: only the card
draws it as a pill, and only at full width — the full view and the sidebar page print the
total in their header instead, whichever way it is set.

Omitting the key hands the decision to **Quick-filter pills** under Settings → Devices &
services → HAventory → **Configure**, which is the one place that reaches every surface:
the sidebar panel has no dashboard config of its own, so that setting is all it reads.
Leave both unset — a fresh install, or any dashboard written before either option existed
— and all six pills are offered.

## Removing HAventory

Deleting the integration under **Settings → Devices & services** takes back both loaders —
the Lovelace resource entry and the extra-module URL — plus the sidebar entry, so nothing
is left pointing at a card that is about to disappear. (If your Lovelace runs in YAML mode
any entry is yours, in `configuration.yaml` — delete the `resources:` line by hand. An
Overview shortcut is yours too, and is removed the same way it was added.)

**The API stops answering at once.** Home Assistant keeps a WebSocket command registered
until it restarts, so a dashboard still open in another tab can go on talking to HAventory
after you remove it. It is refused rather than served: every command comes back as an
error, and nothing more is written to your inventory. Reload that tab and the card is gone.

The same holds while the integration is **disabled**, and briefly while it **reloads** — an
entry that owns nothing serves nothing. A card left open is told its live updates stopped
and re-opens them by itself once setup finishes, so a reload costs it a few seconds of a
"Live updates paused" banner and no refresh. Disable it for longer and the card stops
waiting and offers Refresh instead.

**Your inventory is deliberately kept.** Items and locations live in the Home Assistant
store file `<config>/.storage/haventory_store`, which removal does not touch: adding the
integration again restores everything, which is what you want when you remove it to
reinstall, move to another HACS channel, or clear a bad config entry.

To delete the data as well — after exporting a backup, if you might want it later:

1. Remove the integration and stop Home Assistant.
2. Delete `<config>/.storage/haventory_store`, and `<config>/.storage/haventory_todo_links`
   if you ever pointed HAventory at a shopping list — it records which lines on that list
   are HAventory's, by item name.
3. Delete `<config>/haventory/attachments/` if you attached photos or manuals.
4. Start Home Assistant.

Upgrading from a version that copied the card into `<config>/www/haventory/`? That copy is
no longer used and can be deleted; the integration ignores it either way.

---
