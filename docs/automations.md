# Automating HAventory

Everything HAventory hands to the rest of Home Assistant: the sensors and the calendar
entity it creates, the events it fires on the bus, the reminders you set on an item, and
the shopping list it can keep in step with what has run low. The README shows two worked
automations; this is the whole surface.

HAventory shows up in Home Assistant as **eight sensors and a calendar on one device**, and
fires **two event types** on the bus. None of it needs a WebSocket client, and none of it
polls.

## The sensors

One HAventory device under Settings → Devices & services, carrying:

| Sensor | What it counts |
|---|---|
| Item count | every item in the inventory |
| Low stock count | items at or below their `low_stock_threshold` |
| Checked out count | items somebody has taken out and not brought back |
| Checked out overdue count | checked-out items whose due date has passed |
| Checked out due count | checked-out items whose due date is today or has passed |
| Inspection overdue count | items whose inspection date has passed |
| Inspection due count | items whose inspection date is today or has passed |
| Location count | places in the location tree |

*Due* includes today and *overdue* does not, here and everywhere else in HAventory — so
each *due* count is its *overdue* twin plus whatever falls today, and never smaller than it.

They update the moment something changes — a card edit, a `haventory.*` service call, an
import — with no polling interval to tune. The four date-derived ones also roll over at
midnight, so "Checked out overdue count" grows overnight without anybody touching the
inventory.

**One day, and it is your Home Assistant's.** Everything that decides whether a date has
passed — these counts, `item/list`'s overdue filters, the calendar entity, the reminder bump
and the card's own chips and pills — measures against the day your instance is configured
for, and rolls over at its midnight. Change the time zone in Home Assistant and they all
move together. A wall tablet left on the card overnight moves with them: the backend sends
the fresh counts at that midnight, and the card re-reads its own chips there too, so the
dashboard never shows a sensor and a pill disagreeing.

Put "Low stock count: 3" on a dashboard next to the weather and nobody has to open the card to
know whether a shopping trip is due.

## The events

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

The full payload shapes are in [`data_shapes.md`](data_shapes.md); the events
carry the fields a trigger needs and no more, so an automation that wants the whole item
calls `haventory/item/get`.

Services work the other way round: every `haventory.*` service returns the entity it
touched, so a script can chain calls through `response_variable` — see the same document's
"Service responses".

A service mutation also reaches any card left open, the same way a card's own edit does: an
automation that restocks something repaints the list and the counts on every screen showing
them, with nobody touching anything.

## The calendar

`calendar.haventory` puts the dates already on your items onto a calendar dashboard, beside
school holidays and bin collections:

| Event | Where the date comes from |
|---|---|
| `Ladder due back` | the `due_date` on a checked-out item |
| `Extinguisher inspection` | the `inspection_date` on any item |
| `HVAC filter reminder` | the **reminder** on any item, and every repeat of it |

The titles above are the English ones. A summary is written in the language Home Assistant
itself runs in — Settings → System → General — not the reading user's, because the same text
is `calendar.haventory`'s `message` attribute and an automation templating it gets one
answer whoever is looking.

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

## Reminders

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

## Shopping list

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
