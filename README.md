# HAventory

[![CI](https://github.com/chrreiter/HAventory/actions/workflows/ci.yml/badge.svg)](https://github.com/chrreiter/HAventory/actions/workflows/ci.yml)
[![CodeQL](https://github.com/chrreiter/HAventory/actions/workflows/codeql.yml/badge.svg)](https://github.com/chrreiter/HAventory/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/chrreiter/HAventory/badge)](https://securityscorecards.dev/viewer/?uri=github.com/chrreiter/HAventory)
[![HACS: Custom](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://github.com/hacs/integration)
[![License: Apache-2.0](https://img.shields.io/github/license/chrreiter/HAventory)](LICENSE)

Home Assistant custom integration (domain `haventory`) for household inventory tracking,
plus a Lit + TypeScript Lovelace card. Local-push, single-instance, HA `Store`-backed
persistence — no external services.

Items live in a nested location tree, carry tags, categories and typed custom fields, and
can be checked out, flagged with a status, and carry **photos and PDF manuals**: both are
stored on disk inside the config directory and served through an authenticated Home
Assistant view, never from `/local`. On a phone, the photo picker opens the companion
app's camera directly; a manual gets a title of your choosing, because `scan_0142.pdf`
does not say which appliance it belongs to.

**Targets:** Linux dev (Windows via WSL2) + `ubuntu-latest` CI. Minimum Home Assistant **2026.6.0** ⇒ Python
**3.14** everywhere (uv provisions the interpreter automatically; the source uses 3.14-only
PEP 758 syntax). Node **22.13+ / 24 LTS** for the card.

---

## Installation

HAventory isn't in the HACS default store yet. To install from this repository:

1. In Home Assistant, open **HACS → ⋮ → Custom repositories**.
2. Add `https://github.com/chrreiter/HAventory` with category **Integration**.
3. Install **HAventory**, then restart Home Assistant.
4. Add it via **Settings → Devices & Services → Add Integration → HAventory**.
5. Refresh your browser (Ctrl/Cmd+Shift+R) so the Lovelace card appears in the picker.

HACS installs **released versions only**: it downloads the `haventory.zip` attached to a
GitHub release, which already contains the built card. Installing from the default branch
is deliberately not offered — the card bundle is a build artifact and is not in git, so a
branch install would come up without a card and report success.

Minimum Home Assistant version: **2026.6.0** — the oldest release that both runs the
integration and carries no known security advisory. Developers: see the Developer
Checklist below and [CONTRIBUTING.md](CONTRIBUTING.md).

### Finding HAventory after install

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

### How the card gets loaded

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

### Removing HAventory

Deleting the integration under **Settings → Devices & Services** takes back both loaders —
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

## Automations

HAventory shows up in Home Assistant as **seven sensors and a calendar on one device**, and
fires **two event types** on the bus. None of it needs a WebSocket client, and none of it
polls.

### The sensors

One HAventory device under Settings → Devices & services, carrying:

| Sensor | What it counts |
|---|---|
| Item count | every item in the inventory |
| Low stock count | items at or below their `low_stock_threshold` |
| Checked out count | items somebody has taken out and not brought back |
| Checked out overdue count | checked-out items whose due date has passed |
| Inspection overdue count | items whose inspection date has passed |
| Inspection due count | items whose inspection date is today or has passed |
| Location count | places in the location tree |

*Due* includes today and *overdue* does not, here and everywhere else in HAventory — so
"Inspection due count" is "Inspection overdue count" plus whatever is due today, and never
smaller than it.

They update the moment something changes — a card edit, a `haventory.*` service call, an
import — with no polling interval to tune. The three date-derived ones also roll over at UTC
midnight, so "Checked out overdue count" grows overnight without anybody touching the
inventory.

**UTC midnight, deliberately, and it is not the calendar's midnight.** These counts
compare stored dates against the UTC day, which is also the day `item/list`'s overdue
filters use; the calendar and the reminder bump run on your Home Assistant timezone's day,
because those are dates you read and act on rather than numbers. The two boundaries coincide
in London and diverge everywhere else: at UTC-8 "Checked out overdue count" ticks up at 4 pm
local, eight hours before the calendar stops showing that item as due today.

Put "Low stock count: 3" on a dashboard next to the weather and nobody has to open the card to
know whether a shopping trip is due.

### The events

- `haventory_item_changed` — `action` is one of `created`, `updated`, `moved`,
  `quantity_changed`, `checked_out`, `checked_in`, `deleted`.
- `haventory_low_stock` — `action` is `entered` or `cleared`, fired on the crossing only.

Both are fired **after** the change is written to disk, so an automation that reacts to one
is reacting to something that is already saved.

A worked example — tell whoever is home when something runs low:

```yaml
automation:
  - alias: Notify when stock runs low
    trigger:
      platform: event
      event_type: haventory_low_stock
      event_data:
        action: entered
    action:
      - service: notify.notify
        data:
          title: Running low
          message: >-
            {{ trigger.event.data.name }} is down to
            {{ trigger.event.data.quantity }}
            (threshold {{ trigger.event.data.low_stock_threshold }})
```

And the other direction — react to a specific item being checked out:

```yaml
automation:
  - alias: Media room lights when the projector goes out
    trigger:
      platform: event
      event_type: haventory_item_changed
      event_data:
        action: checked_out
    condition: "{{ trigger.event.data.name == 'Projector' }}"
    action:
      - service: light.turn_on
        target:
          entity_id: light.media_room
```

The full payload shapes are in [`docs/data_shapes.md`](docs/data_shapes.md); the events
carry the fields a trigger needs and no more, so an automation that wants the whole item
calls `haventory/item/get`.

Services work the other way round: every `haventory.*` service returns the entity it
touched, so a script can chain calls through `response_variable` — see the same document's
"Service responses".

A service mutation also reaches any card left open, the same way a card's own edit does: an
automation that restocks something repaints the list and the counts on every screen showing
them, with nobody touching anything.

### The calendar

`calendar.haventory` puts the dates already on your items onto a calendar dashboard, beside
school holidays and bin collections:

| Event | Where the date comes from |
|---|---|
| `Ladder due back` | the `due_date` on a checked-out item |
| `Extinguisher inspection` | the `inspection_date` on any item |
| `HVAC filter reminder` | the **reminder** on any item, and every repeat of it |

Each is an all-day event on its date, described by the item's location path. The entity's
attributes always carry the nearest event still to come, however far out it is; its state
follows Home Assistant's own convention and reads `on` only while an event is actually
running — which for an all-day event means today.

Nothing is scheduled. The events are worked out whenever something reads the calendar, so
editing a date changes the calendar immediately and no timer can drift out of step with the
inventory. A date only exists as an event on its own day: yesterday's is gone from the
calendar. For a **due date** or an **inspection date** the matching sensor keeps counting it
after that. A **reminder** works differently: a recurring one rolls forward on its own and is
never overdue, and a one-off whose date has passed simply leaves the calendar — no sensor
counts it, so bump it or clear it while it is still in front of you.

Notifications are an ordinary calendar automation — the same one you would write for a
birthday:

```yaml
automation:
  - alias: Say what the inventory wants today
    trigger:
      platform: calendar
      event: start
      entity_id: calendar.haventory
    action:
      - service: notify.notify
        data:
          title: HAventory
          message: >-
            {{ trigger.calendar_event.summary }}
            ({{ trigger.calendar_event.description }})
```

Add `offset: "-48:0:0"` to the trigger to be told two days ahead instead — useful for a
return date somebody has to act on before it arrives.

### Reminders

The third kind of event is one you set: **change the HVAC filter every 3 months**. Open an
item in the card, pick a date under **Reminder**, and optionally say how often it repeats —
leave the repeat empty and it is a single date.

The calendar then shows the next occurrence and the ones after it, as far ahead as whatever
view you are looking at. Nothing is scheduled and no series is written down: the item stores
one date, one anchor and one interval however long it runs, and the occurrences are worked
out when something reads them. A repeat measured in months keeps the day of the month it
started on — a reminder anchored on the 31st shows 28 February and then 31 March, rather than
sliding down to the 28th forever — and it keeps it **however often you bump it**: bumping a
31st reminder in a 30-day month moves it to the 30th, and the one after that is the 31st
again.

An item that carries a reminder says so wherever you read it: the detail sheet gains a
**Reminder** row with the next occurrence and the repeat beside it — *Aug 31 · every 3
months* — and a **Mark done** button that moves the series on without leaving the card.
The full view offers a **Reminder** column (switch it on under ⋮ → **Columns**; it starts
off, because most households have nothing to put in it), sorting by the next occurrence,
and a **to do** pill that narrows the list to reminders that have come round. That last
one counts today: a reminder names the day it is asking about, unlike a due date, which
has to pass before anything is late.

When you have actually changed the filter, **bump** the reminder and the whole series moves
on one step. That is what **Mark done** does; from an automation or a script it is one
service call — say, when the smart plug on the boiler reports the service engineer's visit
is done:

```yaml
automation:
  - alias: The filter has been changed
    trigger:
      platform: state
      entity_id: input_button.hvac_filter_changed
    action:
      - service: haventory.reminder_bump
        data:
          item_id: "0f2c…"
        response_variable: bumped
      - service: notify.notify
        data:
          message: "Next filter change: {{ bumped.item.reminder_date }}"
```

Setting and clearing a reminder are ordinary field writes, so they ride the item services:
`haventory.item_create` and `haventory.item_update` both take `reminder_date` and
`reminder_interval`, and `null` for either clears it.

```yaml
      - service: haventory.item_update
        data:
          item_id: "0f2c…"
          reminder_date: "2026-09-01"
          reminder_interval: { unit: months, count: 3 }
```

The same three verbs are on the WebSocket API for a client that has one open —
`haventory/reminder/set`, `/clear` and `/bump`.

Bumping counts from today when the reminder is overdue, so one you forgot for a year lands on
its next future date rather than on another one already past. "Today" is your Home Assistant
timezone's day, the same one the calendar rolls over on — so bumping something in the evening
advances it to the occurrence the calendar is showing you next, wherever you live. A reminder
you no longer want is cleared from the same editor, or by writing `null` over its date.

### Shopping list

Pick a to-do list once, under Settings → Devices & services → HAventory → **Configure →
Shopping list**, and low stock writes itself onto the list the household already shares.
An item at or below its `low_stock_threshold` appears as `Peanut butter ×2` — the name, and
how many it takes to reach the threshold, never less than one. Restock it and the line goes
away.

The field is empty by default, and empty means off; nothing is written to any list until
one is chosen. Any `todo.*` entity that can both add and delete lines works — Home
Assistant's own **Local to-do** lists, or a shared Google Tasks or CalDAV list. A list that
can only be added to is not offered in the picker: restocking could never take its lines
back off, so it would collect one per low-stock crossing with nothing able to clear them.

The bridge does not track edges, it converges: every change runs one pass that compares
what is low *right now* against the lines it has already written, and issues only the
difference. A restart, a bulk edit, a wholesale import and a missed event therefore all end
at the same list, with nothing listed twice.

Three things follow from that, worth knowing before you pick a list:

- **It only ever touches its own lines.** A list you already use for other things is safe;
  everything the bridge did not write, it leaves alone.
- **Delete one of its lines by hand and it stays deleted** while the item is still low —
  the bridge takes that as "handled" rather than re-adding it. It comes back the next time
  the item leaves the low-stock set and drops into it again.
- **Clearing the field stops the mirroring and leaves the list as it stands.** Switching to
  a different list moves the lines across instead — from whichever list is answering at the
  time, so switching away from one that is unavailable leaves its lines where they are.

An inventory change never fails because the list did: a list that is unavailable, gone, or
refuses the write is logged as a warning, and the next change tries again.

---

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
- **Rate limiting is opt-in and off by default.** Out of the box nothing bounds how fast a
  client may issue commands or how many subscription events it is sent. Enabling it under
  Settings → Devices & services → HAventory → **Configure** turns on per-connection and
  global token buckets: excess commands are rejected with a `rate_limited` error and
  excess subscription broadcasts are dropped. Dropped broadcasts are silent on the wire —
  events carry no sequence number, so a missing one cannot be detected by its absence. A
  limiter tight enough to refuse the card's *subscribe* is not silent, though: the card
  re-opens the refused round up to four times, waiting out a retry-after hint when the
  refusal carries one and backing off exponentially when it does not, and once that budget
  is spent it says **Live updates paused** and offers a Refresh — so a list that has
  stopped updating never passes for one with nothing to report. What the settings mean, and
  when turning them on is worth it: [`docs/rate_limiting.md`](docs/rate_limiting.md).
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
  missing" state — the preview reports how many before you write anything, and the item's
  Documents list marks each affected row rather than offering a link to a 404.
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

---

## Developer Checklist

Use this checklist when working on HAventory. Keep it up to date if conventions change.

### Setup (Linux/bash)

Prereqs: [uv](https://docs.astral.sh/uv/), Node 22.13+ (or 24 LTS), git.

```bash
# One-shot bootstrap: uv env + card deps + pre-commit hooks
scripts/setup.sh

# ...or manually:
uv sync                                   # creates .venv from pyproject.toml + uv.lock
(cd cards/haventory-card && npm ci)       # reproducible install from the committed lockfile
```

Run any Python tool through uv (`uv run <tool>`), so it uses the locked dev environment.

### Tooling

- **uv** — Python env, dependency resolution, and lockfile (`uv.lock`). Dev deps live in
  `pyproject.toml` under `[dependency-groups]`; `requirements-dev.txt` is a generated,
  pip-installable export kept for environments without uv.
- **Ruff** `0.15.x` — lint + format, configured in `pyproject.toml`.
- **mypy** `2.x` — type checking (non-strict baseline; scoped to `custom_components/haventory`).
- **ESLint** `10` (flat config `cards/haventory-card/eslint.config.js`) + `@typescript-eslint 8`.
- **TypeScript** `6`, **Vite** `8`, **Vitest** `4` (+ `@vitest/coverage-v8`) for the card.
- **pre-commit** — ruff, codespell, basic hooks.

### The gate (run before every commit — both halves must be green)

```bash
# Backend
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q
uv run ruff check .
uv run mypy

# Frontend (in cards/haventory-card)
npm audit --audit-level=high
npx eslint .
npm run typecheck
npx vitest run
npm run build
```

The audit is the only place a development-scope npm vulnerability becomes visible: the
repository's Dependabot auto-triage rule dismisses dev-scope alerts, so the alert
dashboard is not ground truth for the card's lockfile — CI is.

Or all at once: `scripts/ci_local.sh` (backend lint + types + tests w/ coverage, then
frontend install + audit + lint + types + test + build). Lint only: `scripts/lint.sh`. Backend tests
only: `scripts/test.sh`. Frontend tests: `scripts/test_frontend.sh [--coverage|--watch]`.

### Testing

There are two backend test modes, kept deliberately separate:

- **Offline (fast, default).** HA is stubbed in `tests/conftest.py`, so the suite runs
  in milliseconds with no HA install. Invoke with plugin autoload disabled; async tests
  use `@pytest.mark.asyncio`:

  ```bash
  PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q
  ```

- **In-process HA integration (opt-in).** Runs the integration inside a *real* Home
  Assistant core via [`pytest-homeassistant-custom-component`][phacc] (phacc), catching
  drift against real HA APIs the stubs can't see. See below.

Every feature/fix ships with tests — happy path plus at least one edge/error case.

Performance benchmarks live in `tests/test_repository_benchmarks_offline.py`,
including the WP4 percentile scenarios (item list: 50-item page p50 ≤ 30 ms /
p95 ≤ 75 ms; `move_subtree` p50 ≤ 80 ms / p95 ≤ 150 ms on the 2k-items /
60-locations typical dataset) and the persistence curve at 250 / 500 / 1 000
items, which is what a save costs the event loop before Home Assistant's own
write. They print results always and fail on budget misses only with
`ASSERT_BUDGETS=1`:

```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 ASSERT_BUDGETS=1 uv run pytest -q tests/test_repository_benchmarks_offline.py -s
```

[phacc]: https://github.com/MatthewFlamm/pytest-homeassistant-custom-component

#### In-process HA integration tests (opt-in)

These load a genuine HA core, so they need **Python 3.14** and a full HA install
(phacc, from `requirements-integration.txt` — kept out of `pyproject`/`uv.lock` and the
offline `.venv` so the fast suite stays lean). They live under `tests/integration/` and
run with plugin autoload **on** (phacc must load) in pytest-asyncio's auto mode.

```bash
# One-shot: provisions Python 3.14 + a dedicated .venv-integration, then runs them
scripts/test_integration.sh

# ...or manually:
uv venv --python 3.14 .venv-integration
uv pip install --python .venv-integration/bin/python -r requirements-integration.txt
.venv-integration/bin/python -m pytest -o asyncio_mode=auto tests/integration
```

Do **not** set `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1` for this mode. `tests/conftest.py`
detects the real `homeassistant` package these tests pull in and installs none of the
offline stubs, so the two modes never collide; the offline run never collects
`tests/integration/`. Covered: config-entry setup/unload, WebSocket item CRUD end-to-end,
Store persistence round-trip, and `haventory/areas/list` against the real area registry.

> Restricted-egress environments (e.g. sandboxes that can't fetch Python 3.14 or the HA
> core) can't run this mode — CI provisions Python 3.14 and runs it in its own job.

#### Online smoke tests (opt-in)

These hit a real Home Assistant instance over WebSocket. Require env vars:

```bash
export RUN_ONLINE=1
export HA_BASE_URL=http://localhost:8123
export HA_TOKEN=<your-long-lived-token>
scripts/smoke_online.sh
# or: uv run pytest -q -m online -k "ws_smoke or ws_smoke_advanced"
```

Full online E2E gate against a **disposable** HA (e.g. the Docker dev container),
including the destructive and area-registry scenarios:

```bash
export RUN_ONLINE=1
export HA_BASE_URL=http://localhost:8123
export HA_TOKEN=<your-long-lived-token>
export HA_CONTAINER=home-assistant     # docker-logs assertions; also lets reload_addon.sh deploy
export HAV_ONLINE_DESTRUCTIVE=1        # unlocks the purging tests — disposable instances only!
export HA_ALLOW_AREA_MUTATIONS=1       # unlocks the area-registry e2e test

# Deploy the current working tree into the container and (re)create the config
# entry, so the instance matches the local CURRENT_SCHEMA_VERSION:
scripts/reload_addon.sh --container "$HA_CONTAINER"

scripts/test_online.sh                 # pytest -q -m online (all three online files)
```

Run the suite sequentially (no `-n`/xdist): destructive tests purge and then
assert exact totals, so they assume exclusive access to the instance.

> ⚠️ **Destructive scenario tests are double-gated.** A subset of the online
> suite **purges ALL HAventory items and locations** on the target instance
> before running (they assert exact totals against a clean dataset). Those
> tests are skipped unless you *also* set `HAV_ONLINE_DESTRUCTIVE=1` — do that
> only against a disposable HA. Everything that runs without the flag is
> self-contained: it creates uniquely-named entities and deletes them again.

Area-registry e2e (optional; temporarily mutates your HA instance):

```bash
export HA_ALLOW_AREA_MUTATIONS=1
uv run pytest -q -m online -k ws_areas_online
```

Included: `tests/test_ws_smoke_online.py`, `tests/test_ws_smoke_advanced_online.py`,
`tests/test_ws_areas_online.py`.

#### Live-update browser smoke (opt-in)

`cards/haventory-card/e2e/live-updates.smoke.mjs` drives the **real card** in a headless
browser against a running HA and asserts that out-of-band inventory changes (made over a
separate WebSocket connection) reach the card purely through its subscription — create →
rename → delete, live, with no manual re-list. It guards the "green unit tests, dead
feature" class of regression that unit mocks cannot (see PR #93): the mock is only ever as
truthful as the contract its author imagined.

```bash
export RUN_ONLINE=1
export HA_BASE_URL=http://localhost:8123
export HA_TOKEN=<your-long-lived-token>
cd cards/haventory-card
npm i && npx playwright install chromium   # one-time
npm run test:e2e                            # skips cleanly if RUN_ONLINE is unset
```

The card must be on a dashboard (deploy e.g. via `scripts/reload_addon.sh`), but no path is
assumed: the run walks the instance's dashboards for a view holding a `custom:haventory-card`
in a normal column — the narrow layout the assertions target — and prints the one it chose.
`--path <ha-url-path>` forces a different view. The test is idempotent — it creates a
uniquely-named item and deletes it (best-effort cleanup even on failure).

#### Coverage

- Backend: `scripts/ci_local.sh` produces `coverage.xml` + browsable `htmlcov/index.html`.
- Frontend: `scripts/test_frontend.sh --coverage` (report at `cards/haventory-card/coverage/`).

### Backend (custom component)

- `custom_components/haventory/` with `manifest.json`, `__init__.py`, `config_flow.py`, `services.yaml`.
- Store: `entry.runtime_data.store` with versioned schema and safe writes. Migrations are
  forward-only: a store written by a **newer** HAventory version is refused (setup fails with
  an "upgrade HAventory" message) and never rewritten, so a rollback cannot relabel data the
  running build cannot read.
- Persistence architecture:
  - **WebSocket / service handlers**: immediate saves via `async_persist_repo` — storage
    errors propagate to clients as `storage_error`.
  - **Shutdown/unload**: immediate save via `async_persist_immediate`.
  - **Debounced saves**: `async_request_persist` for batch/internal operations only.
  - **Concurrency**: all persist paths use `asyncio.Lock` to serialize writes.
- Repository generation counter increments on every state modification (optimistic locking/debugging).
- WebSocket-first CRUD via `homeassistant.components.websocket_api` decorators.
- Services via `hass.services.async_register` with `voluptuous` schemas; handlers re-raise
  validation/repository/storage errors so HA surfaces them.
- Areas via `homeassistant.helpers.area_registry.async_get(hass)`; never auto-create areas.
- Every free-text and collection field is capped on the way in — 4000 characters of
  description, 50 tags, 50 custom fields, and so on beside the 120-character name limit —
  because the store is one JSON document rewritten in full on every mutation. The caps refuse
  growth, never data that already exists: an item written before a cap existed still loads,
  saves, exports and — because a backup must restore — imports, on the backend and in the
  card's editor alike. The full table and the exact rule are in
  [`docs/data_shapes.md`](docs/data_shapes.md) → "Input caps".
- Case-insensitive search; denormalized `location_path` on items; item `version` for optimistic
  concurrency. `version` counts *item* mutations only — renaming or moving a location rewrites
  the derived `location_path` across its whole subtree without bumping `version` or restamping
  `updated_at`, so an expected version taken before the rename is still accepted after it.
- Calendar-derived counts on `haventory/stats`, two of them with a matching `item/list`
  filter: `overdue_count` / `overdue_only` for a passed `due_date` (checked-out items only,
  since that is where a due date can exist), and `inspection_overdue_count` /
  `inspection_overdue_only` for a passed `inspection_date` — the date the item is next due
  for inspection, over the whole inventory, since an inspection is independent of any
  check-out. `inspection_due_count` asks the inspection question inclusive of today and has
  no filter of its own, since the filters are strict. All of them move with the calendar and
  emit no event when the date rolls over.
- A stored per-item **status** — `ok` / `missing` / `needs_repair`, always exactly one,
  `ok` being the default and the way a flagged state clears. Filterable via the
  `item/list` `status` filter, counted on `haventory/stats` as `missing_count` /
  `needs_repair_count` (stored state, so unlike the calendar counts every change emits
  an event), and settable everywhere an item is written — WS create/update, the
  `haventory.item_create` / `haventory.item_update` services, and import. A store written
  before the field existed is migrated on load (schema v5 backfills `ok`); an export
  without it reads as `ok` too.
- **WebSocket rate limiting (opt-in, off by default)**: per-connection **and** global
  token buckets for commands (excess requests get a `rate_limited` error) and for
  subscription broadcasts (excess events are dropped, never breaking the command).
  Enable and tune it under Settings → Devices & services → HAventory → **Configure**;
  `haventory/health` reports drop counters. Leave it disabled for stress testing
  (`scripts/stress_test.py`). What each setting means and when to enable it:
  [`docs/rate_limiting.md`](docs/rate_limiting.md); wire-level semantics and defaults:
  [`docs/backend_api_contract.md`](docs/backend_api_contract.md) → "Rate limiting".
- **JSON import/export (data safety)** via `haventory/export`, `haventory/import/preview`,
  and `haventory/import/execute`: back up to a versioned document before a breaking update
  and restore afterwards. Preview reports would-be adds/updates/conflicts without touching
  state; execute applies a `merge` / `replace` / `skip` conflict policy and rolls back on
  failure so a bad import never leaves partial state. This **complements** Home Assistant's
  own snapshots/backups — the HAventory store file is already captured by an HA backup;
  import/export adds a portable, human-readable document you can inspect, diff, and restore
  independently of a full-instance snapshot. See
  [`docs/backend_api_contract.md`](docs/backend_api_contract.md) and
  [`docs/data_shapes.md`](docs/data_shapes.md).
  - **Import matches entities by id, and only by id — never by name.** Every incoming item
    and location is looked up by its id: an id already in the inventory is the same entity
    (left `unchanged`, `update`d, or reported as a `conflict` under `skip`), an id that is
    absent is added. Names are not consulted under any policy, which is deliberate —
    matching by name would silently fuse two genuinely different "Shelf A"s.
  - **So restoring a backup onto hand-rebuilt locations or items duplicates them; it does
    not merge onto them.** Anything you delete and recreate by hand comes back with a fresh
    id, so the backup's copies count as new entities and you end up with two of each.
    The duplicates are not inert: each imported item carries the backup's `location_id`, so
    the items repoint onto the *newly added* duplicate location, and the location you
    rebuilt keeps its name while its contents move to its twin. Measured against a running
    instance: a 40-location backup previewed against a 53-location inventory gives
    `locations add=0 unchanged=40` when the ids are intact, but `add=17 unchanged=23` — 70
    locations with 17 duplicate name pairs, and 402 items moving from `unchanged` to
    `update` — when 17 of those locations had been rebuilt by hand first.
  - **Safe restore paths:** restore into an **empty inventory**, or restore a backup whose
    ids are still intact (the entities were never deleted and recreated). Either way run
    `import/preview` first and read the `add` counts: entities you expect the import to
    match onto must appear under `unchanged`/`update`, and a location you already have
    showing up under `add` means you are about to duplicate it.

### Frontend (Lovelace card)

Redesigned in WP4.1. Lit + TypeScript + Vite; tests with Vitest; build outputs to
`custom_components/haventory/www/`. Real-time over WebSocket with optimistic writes
throughout.

- **Sidebar page** — HAventory gets an entry in Home Assistant's sidebar, opening the full
  view as a page of its own with the same ⋮ menu, dialogs and editors the card's full view
  has. It loads the one card bundle and is named after the card title. Turn it off under
  Settings → Devices & services → HAventory → **Configure**; see
  [Finding HAventory after install](#finding-haventory-after-install).
- **Standard card** — one Add button and a single ⋮ menu (Select items, Organize, Refresh,
  Diagnostics, Export backup / Export current view, Import); Columns is offered in the full
  view, which is the only surface it changes. Live stat badges — items, low stock, overdue,
  due for inspection, checked out — are click-to-filter, and which of them a household
  offers is set under Settings → Devices & services → HAventory → **Configure**, or per
  dashboard with the card's `quick_filters:`. Rows carry a quantity stepper, a
  LOW badge, an overdue check-out chip, an "Inspection due" chip, an amber status chip
  when an item is flagged Missing / Needs repair, and hover actions.
- **Filters** — a collapsible panel exposing the whole backend filter object: location
  (from a real tree), area, include-subtree, category chips with counts, tag chips with an
  any/all toggle, low-stock-only, checked-out, overdue, inspection-due, reminder-due and no-location —
  each with the count of what it would keep — a single-select status row (OK / Missing /
  Needs repair, the flagged two priced from the stats counts), plus updated / created
  windows (each row's ≥ flips to ≤ for "before") and sort across every sortable field.
  "Low stock" (a filter) and "Low stock first" (an ordering) are separate, independently
  clearable controls. Active filters appear as removable chips.
- **Editing** — the row expands in place; there is no dialog chain. Full field parity:
  name, description, quantity, low-stock threshold, category, status, tags, location
  (picked from a tree inside the form), checked-out with due date, next inspection (with the same
  +7 / +31 / +90 / +X quick offsets the check-out popover offers), and typed
  custom fields (text / number / yes-no / date). Saves send the item's expected version so
  a concurrent edit surfaces as a conflict; a save that does not land says so in the form
  you are looking at and leaves your edits in it. Escape takes back one thing at a time: an open
  picker first, then the form. **Nothing throws typed edits away without asking** — Cancel,
  the ✕, Escape, tapping the scrim or swiping a phone sheet down, switching to another row,
  and closing the expanded view all raise the same question, and answering "keep" leaves the
  form exactly as it was.
  With no locations yet, the location picker creates the first one and files the item in
  it, rather than pointing at a menu three steps away.
- **Photos and manuals** attach from the same form, once the item exists — an upload is
  filed against an item id, and the create form says so instead of leaving the sections
  unexplained. On a desktop you can also **drop files straight onto the Photos or Documents
  section**; the file's own type decides which it becomes, so a PDF dropped on the photo
  strip attaches as a manual. Each queue reports itself under the section that started it,
  with a moving indicator while a file is in flight; a refused file keeps its error and
  Retry until you dismiss them. Removing an attachment asks first, because the file goes
  with it. A thumbnail is 72px of a photo, so **clicking one opens it full-size** — arrows
  and a counter to walk the strip, Escape to come back — on every surface the form appears
  on, and from the detail sheet's gallery just the same.
- **Full view** — a fullscreen workspace with a coloured app bar, a **browse sidebar**, and
  a sortable table. Only columns the backend can sort by get a clickable header — Location
  among them, ordering on the path each row shows, with items filed nowhere at the end
  whichever way it runs. A browser
  that has made no choice yet shows every optional column but one — quantity, status,
  category, location, tags, due, next inspection, updated — and the ⋮ → **Columns** picker
  is where you thin that down, switch on the one that starts off (**Reminder**), and put
  the ones you keep in the order you want them, with the up/down buttons beside each shown
  column and a **Reset order** back to the canonical one. Reminder is off by default
  because the panel's table has no width to spare: one more column on by default would put
  Location and Tags on their floors, and most households set no reminders at all. The
  order and the selection are one per-browser preference; the table scrolls sideways rather
  than dropping a column you kept.
  The Status column names every row, OK included, and the name's amber status chip stands
  down while it is shown so no row says the same word twice. The
  sidebar leads with the location tree carrying the backend's own per-location counts and
  an orphans row, then **Status**, **Categories** and **Tags** as sections of their own;
  each heading collapses from a chevron and states how many there are — locations counted
  at every depth, Status excepted because there that number would count the household's
  vocabulary rather than anything in the inventory — and
  Locations stays at the top. Every status row is priced from the backend's own per-status
  counts, so a status nothing carries reads 0 rather than inheriting the rest of the
  inventory. Locations, categories and tags all accumulate — pick a second and
  the list widens to hold both, pick a selected one again and it drops out — while
  status stays one value, matching how the backend treats each of them. Several
  categories or locations can only ever mean *or*, since an item has one of each,
  so neither carries the any/all control tags do. With a filter on, each location,
  category and tag row reads "4 / 37" — matches over total — so you can see where the
  matches are rather than a total that never moves. All three switch to the pair together,
  as soon as anything is filtering. Each list drops its own dimension from what it measures
  against, since that list is how you pick one: the location counts ignore the location
  filter, and the category and tag counts ignore the chosen category and tags — so with a
  category as the only filter its own list reads "43 / 43" while the locations beside it
  narrow, rather than one column carrying two kinds of number.
  No row disappears for matching nothing — the same list is what the item editor offers as
  autocomplete. Each heading also offers a create action: Locations opens an inline
  name field, while Categories, Tags and Status open the organize dialog on their own tab —
  a category exists through the items using it, so that is where making one is explained.
  The app bar carries an Organize button of its own, beside the ⋮ that also lists it.
  From the second selected tag on, the Tags heading carries the same any/all control the
  filter panel has, since that is the mode governing what the sidebar just selected. The
  app bar's stat pills are the card's: low in amber, overdue in red, to-inspect in amber,
  checked out, each click-to-filter. All four are derived from the item and mean the same
  thing in every household, which is what lets them share the bar's fixed hues; a status is
  the household's own word in the household's own colour, so the sidebar's Status section
  and the filter chips are where statuses are priced and picked.
  An empty table names the reason and offers a way out — the same
  wording and the same offers as the card's list. Every row carries the same ⋮ the card's
  rows do — Check out with a due date, Check in, Change due date, Delete — so the surface
  built for working through the whole inventory is not the one with the fewest actions per
  row.

  At phone width the sidebar folds away and the surface hands its own breakpoint down to
  the edit form and the filter panel, so both take their phone layouts: one field per row,
  and filters staged behind a "Show N items" commit row exactly as in the card's sheet.
  Tapping a row there opens the same **detail sheet** the card opens — photos, documents,
  facts and check-out, with Edit one tap deeper — rather than dropping you straight into a
  form. On a screen wide enough for the table, the table is the read view and a row click
  opens the form as before.
- **Multi-select and bulk actions** — move, add/remove tags, set category, adjust
  quantity, check out/in and delete over a selection. Work is chunked so progress is
  determinate and cancellable, and the result is reported *per operation*: "39 of 42
  succeeded", every failure named with its reason and a retry scoped to just those.
  Select-all covers loaded rows only and says so, with an explicit "load the rest" path.
- **Organize dialog** — Locations / Categories / Tags / Statuses in one place, reached from
  the full view's app bar as well as its ⋮ menu, each tab stating its
  total above the list and each row offering the same moves: an "N items" link that opens
  the filtered list in the full view, plus rename, merge and delete. Locations keep their collapsible tree and edit inline, with a guarded
  delete that explains what is in the way. Category and tag rename, merge and removal are
  batch rewrites over every affected item; a location merge re-files that location's items,
  re-parents its children and deletes the husk — all with the same progress and
  partial-failure reporting. A location's Area field says what picking one will do before
  you save it: an area belongs to a whole tree, so the line under the select names the tree
  root it will be stored on and how many locations that reaches — and on a location that
  merely inherits, it names the area it inherits. With no Home Assistant areas defined the
  field is not shown at all. The **Parent location** picker offers the areas alongside the
  locations, including areas nothing is filed under yet: picking one moves the whole
  subtree out to the top level *and* into that area, which is how a tree changes rooms.
  The merge target picker offers locations only — an area heads the tree without being part
  of it and holds no items itself, so a merge, which has to hand this location's items to
  something, always names a location. The Statuses tab also sets each status's colour and
  glyph: ten tones that follow your Home Assistant theme, plus an eleventh swatch that
  opens the browser's colour picker for a colour of your own. A colour picked that way is
  used exactly as entered — it is the one mark on the card that does not follow the theme —
  and the chip's text is black or white, whichever reads better on it.
- **Check-out** invites an optional due date (+7 / +31 / +90 / +X day suggestions) rather
  than silently checking out with none — the date is what makes overdue highlighting mean
  anything. "No due date" stays a first-class choice. Checking out a whole selection asks
  the same question once and gives every item the answer.
- **Mobile** — the card switches layout from its own width. Tapping a row opens one bottom
  sheet holding everything about the item; filters open as a staged sheet whose apply
  button shows the live matching count. Every surface honours the same 44px touch minimum
  and 16px field text (iOS zooms a page whose fields are smaller and never zooms back).
- **Import** keeps the mandatory server-side dry run: paste or pick a file, choose
  merge / replace / skip, preview add/update/conflict counts per items and locations, then
  import. An invalid document is shown as a list of JSON paths, not one flat message.
- **Diagnostics and degraded states** — the ⋮ menu carries a Diagnostics panel (health,
  rate-limit drop counters, subscription state, copyable report) badged only when
  something is wrong, plus banners for connection loss, rate limiting and the
  payload-free reload an import broadcasts. Because subscription events carry no sequence
  number, a dropped one is undetectable — so the card says the list may be stale and
  offers an explicit Refresh. The banners are on **every** surface: the card, the expanded
  view and the sidebar page, with the same wording and the same recovery actions. A view
  left open when Home Assistant goes away says so on its own, without waiting for you to
  try something first.
- Deletes use an in-app confirmation, not `window.confirm`.
- Card auto-registered as a Lovelace resource on integration setup.
- **Note:** after first install, a browser refresh (F5 / Ctrl+Shift+R) is required for the
  card to appear in the picker (standard for all custom cards).

#### Card configuration

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

Adding the card from the card picker opens a **visual editor** for `title`; the YAML above
stays equivalent, and switching to it shows the same config. The editor covers `title`
only — the pill choice that reaches every surface (the sidebar panel included) belongs to
the integration's options rather than one dashboard's card, and `quick_filters` above is
the per-dashboard exception to it, set in YAML. Editing a card that carries
`quick_filters` through the visual editor leaves that key exactly as it was.

Without `title`, the card uses the name set under Settings → Devices & services →
HAventory → **Configure** (asked for at setup too, and defaulting to "HAventory"), so one
setting renames every card. Per-dashboard `title:` wins over it — use that when two
dashboards should name the same inventory differently. An open dashboard picks up a
changed name on its next refresh or reload; the change is not pushed live.

`quick_filters` says which pills are *allowed*; a pill still only shows when it has
something to count, so `low_stock` draws nothing while nothing is low. An explicit empty
list is a choice and offers none. `total` is narrower than the other four: only the card
draws it as a pill, and only at full width — the full view and the sidebar page print the
total in their header instead, whichever way it is set.

Omitting the key hands the decision to **Quick-filter pills** under Settings → Devices &
services → HAventory → **Configure**, which is the one place that reaches every surface:
the sidebar panel has no dashboard config of its own, so that setting is all it reads.
Leave both unset — a fresh install, or any dashboard written before either option existed
— and all five pills are offered.

### CI/CD & Ops

- GitHub Actions (`ubuntu-latest`): backend (uv, ruff + mypy + pytest w/ coverage, Python
  3.14), a dedicated **integration** job (in-process HA via phacc, Python 3.14),
  frontend (npm audit + eslint + tsc + vitest + build, Node 22/24 matrix), actionlint,
  hassfest + HACS validation, CodeQL, OpenSSF Scorecard, and dependency review.
  Third-party actions are SHA-pinned; first-party `actions/*` use `@v7`.
- PR hygiene: Conventional-Commit PR-title check, path-based auto-labeling
  (`.github/labeler.yml`), labels-as-code (`.github/labels.yml`), CODEOWNERS review
  requests, and issue/PR templates.
- Dependabot: grouped updates for `github-actions`, `npm` (card), and `uv` (Python).
- `main` is protected by a checked-in ruleset (`.github/rulesets/main.json`): pull request
  required, the CI/CodeQL/dependency-review/PR-title checks required, no force-push or
  deletion. Edit it under *Settings → Rules → Rulesets*, or `PUT` the file to
  `repos/{owner}/{repo}/rulesets/{id}`; the required checks must keep matching the job
  names in `.github/workflows/`, or a pull request can never satisfy them.
- The repository's social preview is `docs/assets/social-preview.png`, rendered from the
  `.html` beside it. GitHub has no API for it — upload it under *Settings → General*.
- The icons and logos Home Assistant shows for the integration live in
  `custom_components/haventory/brand/` and are served from there, at
  `/api/brands/integration/haventory/<file>` — a custom integration's own images win
  over the brands CDN, so nothing has to be published anywhere for them to appear.
  They are rendered from the card's mark constants and the outlined wordmark by
  `uv run python scripts/render_brand_assets.py`; regenerate rather than edit, and
  `tests/test_brand_assets.py` fails when artwork and mark drift apart.
- Release automation via **release-please**: merging its release PR tags the version,
  drafts the GitHub Release, builds and attaches `haventory.zip` — the bundle HACS
  installs — and publishes the draft last. See [CONTRIBUTING.md](CONTRIBUTING.md) →
  Releases.
- Contributor guide: [CONTRIBUTING.md](CONTRIBUTING.md).
- Conventional Commits; update this README when behavior changes.

---

## Reproducible dev environment (.devcontainer)

Open the repo in VS Code / GitHub Codespaces and "Reopen in Container" for a ready-to-go
environment (uv + Node 24). `post-create` runs `uv sync`, installs card deps, and verifies
the offline suite. To bring up a real Home Assistant with HACS against the working tree
(WP4 E2E), run `bash .devcontainer/develop.sh` (needs network; provisions Python 3.14).

---

## Implementation Status

### ✅ Phase 1: Backend & WebSocket API (Complete)
- Full CRUD for Items and Locations via WebSocket; optimistic concurrency with versioning;
  Areas integration; real-time subscriptions (items, locations, stats); documented persistence.
- `haventory/distinct_values` returns distinct categories and tags with usage counts
  (categories grouped case-insensitively) plus distinct custom-field keys — powers
  category/tag autocomplete, the browser views, and custom-field key suggestions. With an
  optional filter each category and tag also reports how many of its items that filter
  keeps, without dropping any value from the list.

### ✅ Phase 2: Frontend Lovelace Card (Complete — superseded by Phase 2.5)
> Historical: this describes the proof-of-concept card. Phase 2.5 replaced its components;
> the capabilities below carried over, the surfaces they are reached through did not.

- Lit 3 + TypeScript components; real-time sync; optimistic updates with conflict
  resolution; Vite build → `custom_components/haventory/www/haventory-card.js`.
- Item dialog offers debounced, keyboard-navigable category/tag autocomplete sourced from
  `haventory/distinct_values`.
- Dedicated **category browser** (header → "Categories"): lists used categories with item
  counts and drills down to the items filed under each.
- Dedicated **tag browser** (header → "Tags"): lists used tags with item counts and drills
  down to the items carrying each.
- **Column selection and order** (header → "Columns"): choose which optional columns
  (quantity, category, location, tags, due date) show in the expanded view, and in which
  order; the choice is persisted in `localStorage` (`haventory:columns:v1`, per browser).
- **Custom fields UI** in the item dialog: define/edit/remove typed fields
  (string/number/boolean/date) with type-appropriate inputs; existing field keys across the
  dataset are offered as suggestions.

### ✅ Phase 2.5: UI revamp (WP4.1)
- The proof-of-concept card was replaced with the redesigned UI: decluttered header with a
  single ⋮ menu, complete filter panel, inline row editing, a full view with a real
  location tree sidebar and a sortable table, multi-select with per-operation bulk results,
  a tabbed organize dialog, an optional check-out due date, a two-step import flow, and
  diagnostics plus degraded-state banners. Mobile gets its own layout, detail sheet and
  staged filter sheet.
- Closes the standing gaps for the location tree view, bulk operations, unified
  category/tag browsing, and the card's silent failure when a subscription is
  rate-limited.
- Verified against a running Home Assistant frontend, after which the proof-of-concept
  components and the `ui: legacy` option that reached them were removed — there is one
  card now, not two.

### 🚧 Phase 3: Polish & HACS (In progress)
- Release automation is in place: release-please cuts the version and the release workflow
  publishes the HACS zip asset.
- Remaining: HACS publication (public repository, custom-repository install, default-store
  submission) and the polish staged alongside it, tracked under
  [#236](https://github.com/chrreiter/HAventory/issues/236).

---

## Dev helper scripts

All scripts are Linux/bash under `scripts/`, and the Python helpers assume a UTF-8
terminal. There is no Windows host support — use WSL2.

### Reload into a running HA dev container

```bash
scripts/reload_addon.sh --container <your_container> --tail-logs
# deploy examples/configuration.yaml instead of the dev config: add --examples-config
```

### WebSocket helper scripts (cross-platform Python)

Quick probes/subscriptions without writing test code. Run via `uv run python scripts/<name>.py`.

`scripts/ws_probe.py` — send a single WS command and print the first reply:

```bash
export HA_TOKEN=<token>            # HA_BASE_URL defaults to http://localhost:8123
export HAV_MSG='{"id":1,"type":"haventory/ping","echo":"hi"}'
uv run python scripts/ws_probe.py
```

`scripts/ws_subscribe.py` — subscribe to a topic (`items` | `locations` | `stats`) and
print events. Optional: `HAV_LOCATION_ID`, `HAV_INCLUDE_SUBTREE`, `HAV_MAX_EVENTS`,
`HAV_MUTATIONS` (JSON array of WS messages to send after subscribing):

```bash
export HA_TOKEN=<token>
export HAV_TOPIC=items HAV_MAX_EVENTS=3
uv run python scripts/ws_subscribe.py
```

### Backend stress testing

`scripts/stress_test.py` validates persistence/concurrency against a Docker-based HA
instance. Requires `HA_CONTAINER`, `HA_BASE_URL`, `HA_TOKEN`:

```bash
export HA_CONTAINER=home-assistant HA_BASE_URL=http://localhost:8123 HA_TOKEN=<token>
uv run python scripts/stress_test.py                          # full run (deploy + test)
uv run python scripts/stress_test.py --skip-deploy --skip-confirm  # quick re-run
```

Scenarios: rapid sequential mutations, concurrent burst, bulk-under-load, mixed workload,
persistence-across-restart. Exit codes: `0` pass, `1` failures, `2` setup error.

### Attachment probes

`scripts/probe_attachments.py` checks the attachment path against a live instance — and
against the **bytes on Home Assistant's disk**, not what the card reported. Pillow comes
from the non-default `probes` dependency group, so a plain `uv sync` stays lean:

```bash
uv sync --group probes
export RUN_ONLINE=1 HA_TOKEN=<token>   # HA_BASE_URL defaults to http://localhost:8123
export HA_CONTAINER=home-assistant     # or HA_CONFIG_DIR for a bind-mounted config
uv run --group probes python scripts/probe_attachments.py
```

It covers the 2 MiB re-encode threshold and the 2048-pixel cap, EXIF orientation applied
before the re-encode, PNG transparency surviving as WebP, an animated GIF kept whole, a
sub-threshold JPEG round-tripping byte-identical, the `206`/`404`/no-answer presence
semantics, and the `Content-Disposition` name. Exit codes: `0` pass, `1` a probe failed,
`2` setup error, `3` timeout.

`scripts/probe_fixtures.py --out DIR` writes those fixtures on their own (~30 MB of
generated images — they are never committed).

---

## Contributing

Contributions are welcome! See **[CONTRIBUTING.md](CONTRIBUTING.md)**. File bugs and feature
requests through the [issue tracker](https://github.com/chrreiter/HAventory/issues/new/choose),
and ask questions in [Discussions](https://github.com/chrreiter/HAventory/discussions).
Taking part means following the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems go
through [private reporting](SECURITY.md), never a public issue.

## Conventions

- Domain/package: `haventory` under `custom_components/haventory`; services `haventory.*`;
  built assets `custom_components/haventory/www/`, served at `/haventory_static/`;
  calendar entity `calendar.haventory`, whose `unique_id` is the constant
  `haventory_calendar`.
- Logging: avoid reserved `LogRecord` keys in logger extras — use `item_name` /
  `location_name`, not `name`.

## Developer docs

- WebSocket API contract: `docs/backend_api_contract.md`
- WebSocket rate limiting (what the options mean, when to enable): `docs/rate_limiting.md`
- Data shapes (Item/Location/filter/sort/events): `docs/data_shapes.md`
- Frontend architecture: `docs/frontend_architecture.md`
- Release testing plan (the manual pre-release validation run): `dev/release_testing_plan.md`

`docs/` holds what a user or contributor of the shipped integration needs; `dev/` holds the
development process — the testing plan, the release review, and the per-task design
documents. Work is tracked in the
[issue tracker](https://github.com/chrreiter/HAventory/issues);
[#236](https://github.com/chrreiter/HAventory/issues/236) carries what is mandatory before
the first public release.

## Troubleshooting

- Container logs: `docker logs -f <container>` (or `-n 200` for recent)
- HA log file (if enabled): `/config/home-assistant.log` inside the container
- HAventory storage file: `/config/.storage/haventory_store`
- **"stored data uses schema version N, which is newer than this build supports"**: the store
  was written by a newer HAventory version — typically after rolling the integration back, or
  after restoring a backup taken on a newer version. The entry stops with that error and the
  store is left untouched; re-install the newer version to read it, or replace
  `haventory_store` with a backup taken on the running version.
- **"stored data has a corrupt schema_version (…); expected an integer"**: `haventory_store`
  holds something other than a whole number under `schema_version` — a hand edit, a truncated
  write, or a quoted number such as `"5"`, which is not the same as `5` and is not assumed to
  mean it. The entry stops with that error and the store is left untouched; fix the value in
  the file, or replace `haventory_store` with a backup.
- **"HAventory could not read N item(s) / location(s) from .storage/haventory_store"**: some
  entries in the store are structurally broken — a hand edit, a truncated write, a row with
  no usable name, or a location whose parent chain loops back on itself. (A name has to be
  a non-empty string, which is what every way of creating one already requires; there is no
  length limit on reading, so a name from before the 120-character cap still loads.) The
  entry stops rather than loading the
  readable remainder, because HAventory saves on every change: a partial load would rewrite
  the file without those entries on the first edit and make the loss permanent. The store is
  left untouched, and the message names the first few affected ids. Fix those entries, or
  restore `haventory_store` from a backup, then reload the integration.
- **All three of the above also appear in Settings → Repairs**, which is where they are
  easiest to find: the entry's error state is one line on one screen. The first two are
  informational — nothing HAventory can do repairs a store it must not touch. The third
  offers a **Fix** button: it copies `haventory_store` to `haventory_store_corrupt_backup`
  and then starts HAventory with everything it could read, leaving the unreadable entries
  out. Take that only if you would rather have the readable remainder than repair the file;
  the copy is how you get the rest back. The offer applies to one start — a store still
  broken at the next restart is refused again.
- **Reporting a bug**: Settings → Devices & services → HAventory → ⋮ → **Download
  diagnostics** writes a JSON with counts, schema versions, index-health checks, which
  runtime pieces are loaded and whether the card bundle is deployed. It carries no item or
  location content — no names, notes or custom-field values — so it is safe to attach to a
  public issue. If you need the content, use the export instead.
