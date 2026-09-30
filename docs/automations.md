# Automating HAventory

What HAventory gives the rest of Home Assistant: **eight sensors and a calendar on one
device**, **two events** on the bus, **`haventory.*` actions** to change the inventory,
**reminders**, and a **to-do list** it can keep in step with what has run low. Nothing
polls: every change reaches the sensors, the calendar and every open card at once.

## The sensors

The HAventory device under **Settings → Devices & services** carries:

| Sensor | Default entity id | What it counts |
|---|---|---|
| Item count | `sensor.haventory_item_count` | every item |
| Low stock count | `sensor.haventory_low_stock_count` | items at or below their low-stock threshold |
| Checked out count | `sensor.haventory_checked_out_count` | items checked out and not yet back |
| Checked out overdue count | `sensor.haventory_checked_out_overdue_count` | checked-out items whose due date has passed |
| Checked out due count | `sensor.haventory_checked_out_due_count` | checked-out items due today or earlier |
| Inspection overdue count | `sensor.haventory_inspection_overdue_count` | items whose inspection date has passed |
| Inspection due count | `sensor.haventory_inspection_due_count` | items due for inspection today or earlier |
| Location count | `sensor.haventory_location_count` | locations in the tree |

The ids are the ones Home Assistant normally generates. If you renamed the device or an
entity, check yours under **Settings → Entities**.

*Due* includes today and *overdue* does not, here and everywhere else in HAventory. The four
date-based counts also change at midnight, so *Checked out overdue count* can grow overnight
without anyone touching the inventory.

**One day, and it is your Home Assistant's.** Everything that asks whether a date has passed
(these counts, the filters, the calendar, reminders and the card) uses the time zone your
Home Assistant is set to, and rolls over at its midnight.

## The calendar

`calendar.haventory` shows the dates already on your items:

| Event | Where the date comes from |
|---|---|
| *Ladder due back* | the due date of a checked-out item |
| *Extinguisher inspection* | an item's next inspection date |
| *HVAC filter reminder* | an item's [reminder](#reminders), and every repeat of it |

Each is an all-day event, with the item's location as its description. The titles are
written in the language Home Assistant itself runs in (**Settings → System → General**),
not the reading user's, so an automation that uses them gets the same text for everyone.

The entity's attributes always carry the next event to come. Its state is `on` only while an
event is running, which for an all-day event means today.

Nothing is scheduled: the events are worked out whenever something reads the calendar, so
editing a date changes the calendar at once. A date appears only on its own day and is gone
from the calendar the day after. An overdue due date or inspection still shows in its
sensor. A repeating reminder keeps showing its future repeats on the calendar whether or
not you mark it done. A one-off reminder whose date has passed is simply gone, and no sensor
counts it.

Get notified the way you would for a birthday:

```yaml
automation:
  - alias: Say what the inventory wants today
    triggers:
      - trigger: calendar
        event: start
        entity_id: calendar.haventory
    actions:
      - action: notify.notify
        data:
          title: HAventory
          message: >-
            {{ trigger.calendar_event.summary }}
            ({{ trigger.calendar_event.description }})
```

Add `offset: "-48:0:0"` to the trigger to be told two days ahead instead.

## The events

- `haventory_item_changed`, with `action` one of `created`, `updated`, `moved`,
  `quantity_changed`, `checked_out`, `checked_in`, `deleted`. The data also carries
  `item_id`, `name`, `quantity`, `location_id`, `location_path` and `version`.
- `haventory_low_stock`, with `action` `entered` or `cleared`, fired only when an item
  crosses its threshold. The data also carries `item_id`, `name`, `quantity` and
  `low_stock_threshold`.

Both fire only after the change is saved. The complete payloads are in
[`data_shapes.md`](data_shapes.md#home-assistant-bus-events).

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

React to one item being checked out:

```yaml
automation:
  - alias: Media room lights when the projector goes out
    triggers:
      - trigger: event
        event_type: haventory_item_changed
        event_data:
          action: checked_out
    conditions: "{{ trigger.event.data.name == 'Projector' }}"
    actions:
      - action: light.turn_on
        target:
          entity_id: light.media_room
```

## Actions

HAventory's actions are listed under **Developer tools → Actions**, with every field
described. Changes made through them reach every open card, the sensors and the calendar
the same way an edit in the card does.

| Action | Required fields | What it does |
|---|---|---|
| `haventory.item_create` | `name` | Creates an item. Every other field is optional; photos and manuals are added in the card. |
| `haventory.item_update` | `item_id` | Changes only the fields you pass. `null` empties an optional field. |
| `haventory.item_delete` | `item_id` | Deletes an item and its photos and manuals. |
| `haventory.item_move` | `item_id` | Moves an item to `new_location_id`, or out of every location if that is left out. |
| `haventory.item_adjust_quantity` | `item_id`, `delta` | Adds `delta` to the quantity (negative to take away). |
| `haventory.item_set_quantity` | `item_id`, `quantity` | Sets the quantity. |
| `haventory.item_check_out` | `item_id`, `due_date` | Checks an item out until `due_date`. |
| `haventory.item_check_in` | `item_id` | Marks it back. |
| `haventory.reminder_bump` | `item_id` | Marks the item's reminder done. See [Reminders](#reminders). |
| `haventory.location_create` | `name` | Creates a location, inside `parent_id` if given. |
| `haventory.location_update` | `location_id` | Renames it (`name`) or moves it inside another location (`new_parent_id`). |
| `haventory.location_delete` | `location_id` | Deletes a location that holds no items and no other locations. |

Dates are written `YYYY-MM-DD`. `area_id` on the two location actions sets the Home
Assistant area of the whole tree the location belongs to, because an area always sits on the
top location of a tree. Every action on an existing item also takes an optional
`expected_version`: if the item has changed since that version, the call fails instead of
overwriting the other change.

**Finding an id.** Open the item in the card: the **ID** row with a **Copy** button sits at
the bottom of the detail sheet (on narrow screens) or of the edit form. A location's id is
in the full view under ⋮ → **Organize…** → Locations, in the location's editor. A JSON
export carries both.

A button by the coffee machine that books one bag out:

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

A script that files a delivery:

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

Every action answers with the item or location as it stands after the change, so a script
can pick it up with `response_variable` and use it in the next step, as the
[reminder example](#reminders) below does. The response shapes are in
[`data_shapes.md`](data_shapes.md#service-responses).

## Reminders

A reminder is a date you set on an item, such as **change the HVAC filter every 3 months**.
Open the item in the card, pick a date under **Reminder**, and optionally say how often it
repeats, in days, weeks or months. Leave the repeat empty for a single date.

The calendar shows the next occurrence and the ones after it. A monthly repeat keeps its day
of the month: one set on the 31st lands on 28 February and then on 31 March again.

Where a reminder shows in the card:

- The item's detail sheet has a **Reminder** row with the next date and the repeat
  (*Aug 31 · every 3 months*), and for a repeating reminder a **Mark done** button.
- The full view has a **Reminder** column. It starts hidden; switch it on under ⋮ →
  **Columns…**.
- The **to do** pill narrows the list to reminders that are due, today included.

**Mark done** moves a repeating reminder on to its next date. If the reminder is overdue it
counts from today, so one you forgot for a year lands on its next future date rather than
on another one already past. A one-off reminder has no next date: clear it instead. From an automation, it is `haventory.reminder_bump`, here on a
button by the furnace:

```yaml
automation:
  - alias: The filter has been changed
    triggers:
      - trigger: state
        entity_id: input_button.hvac_filter_changed
    actions:
      - action: haventory.reminder_bump
        data:
          item_id: "0f2c…"
        response_variable: bumped
      - action: notify.notify
        data:
          message: "Next filter change: {{ bumped.item.reminder_date }}"
```

To set or clear a reminder from an automation, write the fields with
`haventory.item_create` or `haventory.item_update`. `reminder_date: null` clears the
reminder, and `reminder_interval: null` makes it a one-off.

```yaml
      - action: haventory.item_update
        data:
          item_id: "0f2c…"
          reminder_date: "2026-09-01"
          reminder_interval: { unit: months, count: 3 }
```

## Shopping list

Pick a to-do list under **Settings → Devices & services → HAventory → Configure → Shopping
list**, and low stock writes itself onto it. An item at or below its low-stock threshold
appears as `Peanut butter ×2`: the name, and how many it takes to reach the threshold, at
least one. Restock it and the line goes away.

The field is empty by default, which means off. Any to-do list that can have lines deleted
works: Home Assistant's own **Local to-do** lists, or a shared Google Tasks or CalDAV list.
A list that can only be added to is not offered, because restocking could never take its
lines off again.

- **It only touches its own lines.** A list you already use for other things is safe.
- **Delete one of its lines by hand and it stays deleted** while the item is still low. It
  comes back the next time the item runs low again.
- **Clearing the field stops the mirroring and leaves the list as it is.** Picking a
  different list moves the lines across.
- **It catches up.** After a restart, a bulk edit or an import, the list ends up matching
  what is low, with nothing listed twice.

A list that is unavailable or refuses a change never blocks the change to the inventory.
HAventory logs a warning and tries again on the next change.
