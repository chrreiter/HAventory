# V0.6.0 — user-interaction concept and implementation gaps

Status: **planned**. Covers every issue in
[milestone V0.6.0](https://github.com/chrreiter/HAventory/milestones) —
[#218](https://github.com/chrreiter/HAventory/issues/218),
[#219](https://github.com/chrreiter/HAventory/issues/219),
[#225](https://github.com/chrreiter/HAventory/issues/225),
[#232](https://github.com/chrreiter/HAventory/issues/232),
[#187](https://github.com/chrreiter/HAventory/issues/187),
[#229](https://github.com/chrreiter/HAventory/issues/229) — and nothing else.
Baseline is `main` at `3efdad6` (release 0.4.3), with the 0.5.0 release PR
([#412](https://github.com/chrreiter/HAventory/pull/412)) and the last three V0.5.0
feature PRs ([#422](https://github.com/chrreiter/HAventory/pull/422),
[#423](https://github.com/chrreiter/HAventory/pull/423),
[#424](https://github.com/chrreiter/HAventory/pull/424)) open. V0.6.0 work starts once
those merge and 0.5.0 is tagged.

Five of the six issues carry implementation notes written into the issue on 2026-08-05
(#218, #219, #232, #187, #225), and #229's body was rewritten by the owner on 2026-08-11.
**Those notes are the design; this document does not restate them.** What it adds is the
user's side of the milestone — what somebody living with HAventory can do after V0.6.0
that they cannot do today — and a check, against the tree as of 2026-08-12, of what each
story still needs built. Where this document and an issue disagree, the issue wins.

Delete this file in the PR that closes the last V0.6.0 issue — a plan left behind reads
as pending work.

---

## 1. What the milestone changes for the user

Today every interaction with the inventory goes **through HAventory's own surfaces**: the
Lovelace card, the sidebar panel, the WebSocket API, and eleven `haventory.*` services
that mutate but answer nothing. The rest of Home Assistant cannot see the inventory at
all — the integration creates no entities, fires no bus events, and
`README.md` names that under Known limitations ("No automation triggers").

[#236](https://github.com/chrreiter/HAventory/issues/236) stages V0.6.0 as **the
automation milestone**: the release that makes HAventory an *integration* rather than an
app that runs in HA. After it, the user meets their inventory in five places they already
live in, without opening the card:

| Where the user is | What they get | Issue |
|---|---|---|
| A dashboard | Four sensors: items, low stock, overdue, inspection overdue | #218 |
| An automation trigger | `haventory_item_changed` / `haventory_low_stock` bus events | #218 |
| The To-do panel / shopping list | Low-stock items appear, restocked items disappear | #232 |
| A script's `response_variable` | The created/updated item, with its `version` | #219 |
| The calendar dashboard | Due dates, inspection dates, and recurring reminders | #187 |
| Settings → Repairs / Diagnostics | Store problems announced and fixable; a support dump | #225 |

The sixth piece, the schema collapse (#229), is deliberately invisible: its user story is
"the upgrade just works", and it runs **last in the milestone**, after the automation
work has stopped moving the stored shape.

## 2. The six issues

| # | Title (short) | Kind | Effort | Order |
|---|---|---|---|---|
| [#219](https://github.com/chrreiter/HAventory/issues/219) | Services return response data (`SupportsResponse`) | backend | S | 1 |
| [#218](https://github.com/chrreiter/HAventory/issues/218) | Sensor entities + event-bus events | backend | S–M | 2 |
| [#232](https://github.com/chrreiter/HAventory/issues/232) | Low-stock → to-do bridge | backend | M | 3 |
| [#187](https://github.com/chrreiter/HAventory/issues/187) | Calendar entity + stored reminders | backend + card | M | 3–4 |
| [#225](https://github.com/chrreiter/HAventory/issues/225) | `diagnostics.py` + repairs issues | backend | S–M | 5 |
| [#229](https://github.com/chrreiter/HAventory/issues/229) | Schema collapse to v1 | backend | S–M | 6 (last) |

The order comes from the dependencies the issues themselves record; §5 spells it out.

---

## 3. User stories, and what each still needs

Each story below gives the interaction as the user experiences it, then the gap between
that and the tree today. Every "today" claim was verified against `main` at `3efdad6` on
2026-08-12.

### S1 — Inventory health at a glance (#218, sensors)

*The household keeps batteries, filters and consumables in HAventory. On the wall-mounted
dashboard, next to the weather, sits "Low stock: 3". Nobody opens the card to know
whether a shopping trip is due; the number is simply there, it has history like any other
sensor, and it moves the moment someone takes the last pack of AAs out.*

What the user sees: one **HAventory device** under Settings → Devices & services with
four sensors — `items_total`, `low_stock_count`, `overdue_count`,
`inspection_overdue_count` — updating push-style on every mutation, and rolling over at
UTC midnight for the two date-derived counts.

Gap today:

- **No entity platform exists.** The package has no `sensor.py`, `__init__.py` forwards
  no platforms, and nothing in the integration creates a device.
- The four values are already computed: `get_counts()` (`repository.py`, currently around
  line 1640) returns them all. Since the notes were written it has also grown a
  `status_counts` map (custom statuses shipped in 0.4.x) — the four promoted keys are
  unaffected, but "the other five stay WS-only" in the notes is now six.
- The low-stock id set is reachable only through `_debug_get_internal_indexes()`; the
  public `Repository.low_stock_item_ids` frozenset accessor the notes call for does not
  exist yet.
- The offline `HomeAssistant` stub already carries `Platform.SENSOR` / `Platform.CALENDAR`
  (`tests/conftest.py`), but has **no `bus`, no service registry and no
  `config_entries`** — the entity/dispatch halves of S1–S3 are phacc-suite work, exactly
  as the notes assign them.

### S2 — The house reacts on its own (#218, bus events)

*An automation: "when `haventory_low_stock` fires with `action: entered`, notify the
phone of whoever is home." Another: "when `haventory_item_changed` reports the projector
was checked out, turn the media-room lights on." No WebSocket client, no polling, no
template sensors scraping the card.*

What the user sees: two documented event types on the HA bus —
`haventory_item_changed` (the WS action vocabulary: `created`, `updated`, `moved`,
`quantity_changed`, `checked_out`, `checked_in`, `deleted`) and `haventory_low_stock`
(`entered` / `cleared`) — fired **after the durable write**, from WS mutations and
service calls alike. The README's "No automation triggers" limitation is retired and
replaced by a worked automation example.

Gap today:

- **The integration never touches the event bus**: no `hass.bus.async_fire` anywhere
  under `custom_components/haventory/`. Broadcasts are WebSocket-only
  (`_broadcast_counts`, `ws.py:783`, called from the WS handlers only —
  `services.py` emits nothing).
- The planned `events.py` (mutation notification + low-stock set diff + snapshot
  seed/clear) does not exist.
- The README limitation sits at `README.md:161` today (the notes say 154 — anchor drift
  only).

### S3 — A shopping list that fills itself (#232)

*The user picks their shopping list once, in the integration's options. From then on,
when the peanut butter drops below its threshold, "Peanut butter ×2" appears on the list
they already share with the household; when the groceries are put away and quantities
restored, the line disappears. A restart, a bulk import, or a missed event changes
nothing — the list always converges on "what is low right now".*

What the user sees: a new options-flow section with a single `todo.*` entity selector
(empty = off, the default); list lines of the form `Name ×N` (how many to buy to reach
the threshold, floored at 1); lines removed — not completed — on restock. Inventory
mutations never fail because the to-do list did.

Gap today:

- No `todo_bridge.py`, no `CONF_TODO_ENTITY_ID`, no `haventory_todo_links` store. The
  options flow has exactly one section (`SECTION_RATE_LIMIT`) plus the top-level
  quick-filter default — the todo section is new.
- Depends on #218's bus event as its reconcile trigger and on #218's offline `bus` stub.
- The bridge's link map lives in **its own `Store`**, so this story adds no
  `CURRENT_SCHEMA_VERSION` bump — which matters for #229's "known dev range" (§6).

### S4 — Scripts get answers back (#219)

*A power user's script creates an item from a barcode scan, then immediately moves it:
`haventory.item_create` with `response_variable: created`, then `haventory.item_move`
with `item_id: "{{ created.item.id }}"` and `expected_version: "{{ created.item.version }}"`.
Today that second step is impossible — the create hands back nothing, not even the id.*

What the user sees: all eleven `haventory.*` services declare
`SupportsResponse.OPTIONAL` and return the canonical Item/Location shape from
`docs/data_shapes.md` (`{"item": …}` / `{"location": …}`); deletes return the body they
removed; callers that ignore the response keep working unchanged; Developer Tools →
Actions shows the response.

Gap today:

- `SupportsResponse` appears nowhere in the tree; the `SERVICES` table
  (`services.py:354-366`, unchanged from the notes, still eleven entries) registers every
  handler without it, and every handler discards the entity the repository returns.
- The serializers are still private to `ws.py` (`_serialize_item` /
  `_serialize_location`); the planned `serialization.py` extraction has not happened.
  `tests/test_ws_error_mapping_offline.py` still monkeypatches `ws_module._serialize_item`
  and must move to the new symbol with it.

### S5 — Dates on the household calendar (#187, slice A)

*The ladder is checked out to a neighbour with a return date; the fire extinguishers have
an inspection date. Both show up as all-day events on `calendar.haventory`, right in the
calendar dashboard next to school holidays. A standard calendar automation — the same
kind the user already writes for birthdays — sends "ladder due back today" through
`notify.notify`. HAventory schedules nothing itself.*

What the user sees: one `calendar.haventory` entity on the HAventory device, projecting
every stored `due_date` (checked-out items only, by the model's own invariant) and
`inspection_date` as all-day events — summary "name + due/inspection", description the
item's location path, stable per-item uids. Events derive on read; nothing is written on
a timer.

Gap today:

- No `calendar.py`; `calendar.haventory` is still the reserved name `CLAUDE.md` says must
  not exist before this milestone. The CLAUDE.md naming bullet and the pillar's
  "staged for the automation milestone" line are edited in the PR that ships the entity.
- The dates themselves need nothing: `due_date` / `inspection_date` are on `Item`,
  validated, serialized, and already drive `overdue_count` / `inspection_overdue_count`.
- Slice A changes no WS command and no stored shape — no schema bump.
- One sentence in the 2026-08-05 notes ("slice A lands once #236 has shipped") predates
  the 2026-08-11 re-staging that made V0.6.0 the automation milestone; the milestone
  assignment wins, per the tracker.

### S6 — Recurring reminders (#187, slice B)

*"Change the HVAC filter every 3 months." The user sets a next date and an interval on
the item; the calendar shows the next occurrence (and the ones after it, inside whatever
window a calendar view asks for); when the filter is changed, bumping the reminder moves
the whole series. Notifications stay ordinary calendar automations.*

What the user sees: reminder fields (next date + interval in days/weeks/months) on items,
occurrences expanded on read inside the requested window — still no bespoke scheduler,
RRULE explicitly later.

Gap today:

- New stored state: `Item` gains `reminder_date` / `reminder_interval`,
  `CURRENT_SCHEMA_VERSION` goes 6 → 7 with an idempotent `migrate_6_to_7` defaulting both
  to null. (The notes say 5 → 6; the tree is at 6 today — 0.4.x moved it. Same migration,
  one number later.)
- New WS commands under the reserved `haventory/reminder/*` namespace, which exists
  nowhere in `ws.py` or `docs/backend_api_contract.md` yet; both docs files and
  `docs/data_shapes.md` change with it.
- **The card surface for setting a reminder is undecided.** The issue reserves the WS
  commands and specifies the storage, but no note assigns the editor UI. The item editor
  is the obvious home, and the issue is labelled `area:card` — but if the milestone gets
  tight, reminders being settable over WS only (card editor in a follow-up issue) is a
  coherent cut line. Record the decision in the PR body either way.
- Slice B is what the collapse waits for: it is the last planned change to the stored
  shape (#232 stores its links outside the inventory payload). If slice B slips out of
  V0.6.0, #229 moves to V0.7.0 with it, per #236.

### S7 — Problems announce themselves (#225)

*A restore from backup leaves the store stamped with a newer schema than the installed
version reads. Today: the entry sits in an error state with a one-line message. After
V0.6.0: Settings → Repairs carries a card saying exactly which versions disagree, and —
for the corrupt-entity case — offers a guarded "load anyway" that backs the raw store up
first. When the user files a bug, the entry's ⋮ menu has "Download diagnostics": counts,
schema versions, health issues, bundle state — and not one item name.*

What the user sees: repairs issues for the schema-downgrade refusal (not fixable —
informational) and for corrupt entities dropped on load (fixable: back up → opt in →
reload); a diagnostics download that answers shape questions without leaking content.

Gap today:

- No `diagnostics.py`, no `repairs.py`, no `health.py`; the health checks still live as
  private helpers in `ws.py`, and `strings.json` has no `issues` section (its sections
  today: `config`, `options`, `selector`, `services`).
- Two of the issue's four bullets are already done, exactly as its notes say:
  `single_config_entry: true` is in the manifest, and `entry.runtime_data` is split out
  as #280 (V0.7.0).
- The corrupt-load prerequisite is in place: #228 shipped in V0.3.3 and
  `Repository.LoadReport` exists (`repository.py:157`).

### S8 — The upgrade that just works (#229, last)

*The user updates to the release, restarts, and notices nothing. Under the hood the store
is restamped v1 and the dev-era migration tree is gone. The release notes recommend a
JSON export first — the one way back storage's downgrade refusal leaves open.*

This story has no visible surface by design; its content is the delivery protocol in the
issue body (offline TDD across the dev range, D7/D8/E3/E4 re-run, release notes,
**owner's explicit go before merge**, post-release store verification). Two things the
tree adds to the issue's picture:

- The "known dev range" the sunset adopter accepts is **v1–v6 plus whatever slice B
  adds** (v7 on the current plan) — not the v6 ceiling the 2026-08-05 staging assumed.
- `dev/schema_collapse_plan.md` still describes the retired export → wipe → import
  crossing. The issue supersedes it; that file is deleted or replaced in the #229 PR.

---

## 4. Gap summary

Verified against `main` at `3efdad6`, 2026-08-12. Grep for the symbol, never the line —
several anchors in the 2026-08-05 notes have already moved.

| Capability | Today | Gap | Issue |
|---|---|---|---|
| Entities | None; no platform forwarded, no device | `sensor.py`, `events.py`, device + 4 sensors | #218 |
| Bus events | None (`async_fire` unused; broadcasts WS-only) | `haventory_item_changed`, `haventory_low_stock`, from WS **and** service paths | #218 |
| Low-stock accessor | Internal set only | `Repository.low_stock_item_ids` frozenset | #218 |
| Service responses | None registered; results discarded | `SupportsResponse.OPTIONAL` on all 11; `serialization.py` extraction | #219 |
| To-do bridge | Nothing; options flow has one section | `todo_bridge.py`, `CONF_TODO_ENTITY_ID`, own `Store`, reconcile pass | #232 |
| Calendar | Reserved name only | `calendar.py` slice A (projection), slice B (reminders, v6→v7, `haventory/reminder/*`) | #187 |
| Diagnostics/repairs | Nothing; health checks private in `ws.py` | `diagnostics.py`, `health.py`, `repairs.py`, `issues` strings | #225 |
| Schema | v6, migrations v1→v6 present | Collapse to v1 + sunset adopter, after slice B | #229 |
| README | "No automation triggers" limitation (`README.md:161`) | Retired + worked automation / `response_variable` / calendar examples | #218/#219/#187 |
| Offline test stubs | `Platform` stubbed; no `bus`/services/`config_entries` on the stub | `bus` recorder (#218), `SupportsResponse` (#219), `selector` (#232) | each |

## 5. Order of work

The dependency chain the issues record, condensed:

1. **#219 first.** Smallest, and it rewrites every `services.py` handler to bind the
   repository result — the binding #218's `notify_mutation` then sits beside. Out of
   order, the two conflict in every handler.
2. **#218 second.** Creates the device, the `unique_id` convention, the bus events, the
   offline `bus` stub — three later work packages consume one or more of those.
3. **#232 and #187 slice A third**, in either order or in parallel sessions: both ride
   #218's bus event, and their file sets are disjoint except for light touches on
   `__init__.py`, `const.py` and `strings.json` (merge-order conflicts only, no design
   coupling).
4. **#187 slice B fourth** — the milestone's only schema bump (v7); after it the stored
   shape is final.
5. **#225 fifth** (any time after #218/#219 to avoid `ws.py`/`strings.json` churn;
   before the collapse so the repairs strings exist when the adopter could first fire).
6. **#229 last**, once the shape has stopped moving. Owner's explicit go before merge —
   green gates alone do not merge it. If slice B slips, this slips to V0.7.0 with it;
   the release does not move (#236).

Rules of the road are the same as the previous milestone
(`dev/V0_5_0_implementation.md` §4, while it exists): the issue notes are the design;
where their file references have gone stale, decide against the code and record the
decision in the PR body — do not stop to rewrite the issue.

## 6. What V0.6.0 deliberately does not do

- **No bespoke scheduler.** Reminders and notifications ride the calendar entity plus
  ordinary automations and `notify.notify` — the pillar's standing rule.
- **No `haventory/calendar/list_events` command.** It stays reserved and unimplemented;
  the card already receives both dates on every item.
- **No card badge for the to-do bridge**, and no card mirror of the shopping list —
  worth its own issue if demand shows.
- **A `haventory.*` service mutation still reaches no WebSocket subscriber** — an open
  card does not repaint on a service-driven change. #218 fixes the entity/bus half only;
  the WS half is a follow-up issue to file when #218 lands.
- **No new sensors beyond the four.** Promoting `status_counts` members or the other
  aggregate keys later is additive.

## 7. Milestone exit

- All six issues closed; the store at v1; `calendar.haventory` real and the CLAUDE.md
  reservation language updated; README's automation limitation replaced by working
  examples (the full user-first rewrite stays #217, V0.7.0).
- Release-test scenarios D7/D8/E3/E4 re-run against v1 (#229's protocol), and the
  owner's post-release store verification window observed.
- release-please cuts 0.6.0; per #236, V0.7.0 (launch prep) opens with the brands PR
  (#196) filed at its start.
