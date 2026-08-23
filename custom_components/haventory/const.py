"""Constants for the HAventory integration.

Defines the integration domain, the public integration version, the card
title option, the option keys/defaults for WebSocket rate limiting, the entity
platforms and the sensor catalog, and the Home Assistant bus event types.
"""

from dataclasses import dataclass

from homeassistant.const import Platform

# Integration domain used across all modules and entity unique IDs
DOMAIN: str = "haventory"

# Public integration version, surfaced by `haventory/version` and stamped into
# export documents. release-please rewrites the literal below on the annotation;
# tests/test_release_version_consistency.py fails if it ever disagrees with
# manifest.json.
INTEGRATION_VERSION: str = "0.7.1"  # x-release-please-version

# -----------------------------
# Card title (config-entry option)
# -----------------------------
# Heading the Lovelace card and its full view show. Set during setup, changed
# in the options flow, and read by the card through `haventory/config`. A
# per-dashboard `title:` in the card's YAML still wins over it.

CONF_CARD_TITLE: str = "card_title"
DEFAULT_CARD_TITLE: str = "HAventory"

# -----------------------------
# Quick-filter pills (config-entry option)
# -----------------------------
# Which quick-filter pills the card and the sidebar panel offer. A dashboard's
# own `quick_filters:` still wins for that one card; the panel has no dashboard
# config at all, so this option is the only thing that reaches it.
#
# The vocabulary is the card's — `QUICK_FILTER_KEYS` in
# `cards/haventory-card/src/ui/quick-filters.ts` — and the two spellings have to
# agree, because a name only this side knows drops a pill silently instead of
# failing. tests/test_frontend_registration.py holds them to each other.

CONF_QUICK_FILTERS: str = "quick_filters"
QUICK_FILTER_KEYS: tuple[str, ...] = (
    "total",
    "low_stock",
    "overdue",
    "inspection_due",
    "reminder_due",
    "checked_out",
)

# What the options form prefills when nothing is stored — every pill, so that
# saving the form without touching this field changes nothing. It is not what
# an unset option *means*: an entry with no value for it reports `None` over
# `haventory/config`, which leaves the choice to the dashboard, and an empty
# list is the household's explicit "no pills".
DEFAULT_QUICK_FILTERS: tuple[str, ...] = QUICK_FILTER_KEYS

# -----------------------------
# Sidebar panel (config-entry option)
# -----------------------------
# HAventory as a page of its own, registered with `panel_custom` and rendered by
# the `haventory-panel` element out of the card bundle. On by default: the
# redesigned Overview has no card surface at all, so the sidebar entry is the
# only thing that makes a fresh install discoverable. An explicit opt-out is
# kept; an entry created before the option existed has no value and reads as on.

CONF_SIDEBAR_PANEL_ENABLED: str = "sidebar_panel_enabled"
DEFAULT_SIDEBAR_PANEL_ENABLED: bool = True

# The panel's URL path doubles as its key in the frontend's panel registry, so
# it is also what a removal has to name.
PANEL_URL_PATH: str = "haventory"
PANEL_ELEMENT_NAME: str = "haventory-panel"
# The HAventory mark, which the card bundle publishes as an icon set under the
# `haventory:` prefix (`cards/haventory-card/src/ui/brand-icon.ts`) — a
# non-`mdi:` prefix resolves out of the frontend's own icon registry, nowhere
# else, so the two spellings have to agree. Nothing resolves it without the
# bundle, and without the bundle there is no panel to put an icon on.
PANEL_ICON: str = "haventory:logo"

# -----------------------------
# Shopping list (config-entry option)
# -----------------------------
# Which Home Assistant to-do list the low-stock set is mirrored onto. Empty
# means off, which is the default: a household that has not chosen a list gets
# nothing written to any of them. One option rather than a list plus an enable
# toggle — a toggle could only ever disagree with the entity it guards.

CONF_TODO_ENTITY_ID: str = "todo_entity_id"
DEFAULT_TODO_ENTITY_ID: str = ""

# The bridge's link map gets a `Store` of its own rather than a section of the
# inventory payload: it is bookkeeping about another integration's entity, and a
# new key in the inventory payload would bump `CURRENT_SCHEMA_VERSION` and leak
# into the `{schema_version, items, locations}` document import/export writes.
TODO_LINKS_STORAGE_KEY: str = "haventory_todo_links"
TODO_LINKS_STORAGE_VERSION: int = 1

# -----------------------------
# Repairs
# -----------------------------
# What setup puts in Settings → Repairs when it refuses to run. Each id is a
# constant rather than a per-run value, so meeting the same condition on the
# next boot updates one card instead of stacking a second, and each doubles as
# the `translation_key` naming its entry under `issues` in `strings.json`.

ISSUE_SCHEMA_DOWNGRADE: str = "schema_downgrade"
ISSUE_CORRUPT_SCHEMA_VERSION: str = "corrupt_schema_version"
ISSUE_CORRUPT_STORE: str = "corrupt_store"

# Every issue this integration raises, so a setup that got through can clear the
# lot without naming them one at a time — whichever of them the previous boot
# left behind no longer describes anything.
REPAIR_ISSUE_IDS: tuple[str, ...] = (
    ISSUE_SCHEMA_DOWNGRADE,
    ISSUE_CORRUPT_SCHEMA_VERSION,
    ISSUE_CORRUPT_STORE,
)

# Set by the corrupt-store repair, read by the setup its reload triggers, and
# cleared by any setup that gets as far as a loaded repository — including one
# that finds nothing wrong, which is where a hand-restored backup lands. Opting
# in to a lossy load is a decision about one boot: left on the entry it would
# silently accept the next corruption too, and that one would arrive with no
# copy of the store taken and no card raised.
CONF_ALLOW_LOSSY_LOAD: str = "allow_lossy_load"

# Where that repair copies the raw store before the lossy load. Loading destroys
# nothing by itself — the first mutation afterwards does, by writing the
# repository back over the rows it could not read — so the copy is what makes
# "load anyway" reversible.
CORRUPT_BACKUP_STORAGE_KEY: str = "haventory_store_corrupt_backup"

# -----------------------------
# Item attachments
# -----------------------------
# Files attached to an item live under the config directory, outside the
# integration package (HACS replaces that on upgrade) and outside `<config>/www`
# (which is `/local`, served without authentication). Inside the config dir, HA
# backups carry them with no extra work.

MEDIA_SUBDIR: str = "haventory/attachments"

# Where the authenticated view serves them. `{item_id}` and `{attachment_id}`
# are matched against stored metadata before any path is built, so neither
# segment ever reaches the filesystem as written.
MEDIA_URL_TEMPLATE: str = "/api/haventory/media/{item_id}/{attachment_id}"

# Query parameter a client adds to say "this URL is versioned by the name the
# file is served under". The view reads only whether it is present, never its
# value: it is a cache key, and the name it stands for is the one the response
# carries anyway. Home Assistant signs query parameters along with the path, so
# a client cannot bolt this onto a URL it was given.
MEDIA_NAME_TOKEN_PARAM: str = "v"  # noqa: S105 - a query parameter name, not a credential

# Accepted picture types. An allow-list, checked against the file's *sniffed*
# leading bytes rather than the content type the browser declared.
# `image/svg+xml` is deliberately absent: SVG carries script and the view serves
# it from the Home Assistant origin.
ATTACHMENT_PICTURE_MIME_TYPES: tuple[str, ...] = (
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
)
# The manual kind exists on the backend so the shape does not have to be
# migrated when its card surface lands.
ATTACHMENT_MANUAL_MIME_TYPES: tuple[str, ...] = ("application/pdf",)

# Per-item caps, reported through `haventory/config` so the card can refuse
# before an upload starts, and enforced server-side regardless.
MAX_PICTURES_PER_ITEM: int = 10
MAX_MANUALS_PER_ITEM: int = 10
# 8 MB. This is what a client uploads and what the lightbox and the detail
# sheet's large picture are still served; a row tile asks for `size=thumb`
# instead, and gets the derived file below when one can be made.
MAX_ATTACHMENT_BYTES: int = 8 * 1024 * 1024

# The row-tile variant of a picture, derived on first request and written beside
# the original. Pillow is **not** a dependency: it is imported lazily and every
# failure to use it — absent, animated, undecodable, an unwritable directory —
# serves the original instead, so an install without it shows its pictures and
# only pays the bytes. 256px because the largest tile that asks for one is 72px
# and a 3x screen wants 216.
MEDIA_SIZE_PARAM: str = "size"
MEDIA_SIZE_THUMB: str = "thumb"
THUMBNAIL_MAX_EDGE: int = 256
THUMBNAIL_QUALITY: int = 80

# The tile's name carries the generation of the encoder that wrote it, because a
# tile is written once and served from then on: an upgrade that changes the
# encode reaches nothing already on disk. **Bump this whenever the encode
# changes in a way an existing tile must not survive** — the orphan sweep at the
# next setup finds the previous generation's files unnamed by any metadata and
# removes them, and the next request that wants a tile writes the new one. A
# tile is a cache, so that costs one encode and no data.
#
# Generation 1 is `.thumb.webp`, with no number in it: it is the name the suffix
# had before it carried a generation, so the composed form starts at 2.
THUMBNAIL_GENERATION: int = 2
THUMBNAIL_SUFFIX: str = f".thumb{THUMBNAIL_GENERATION}.webp"

# -----------------------------
# Status appearance
# -----------------------------

# What a status may be painted. Five hues, each in a light and a strong form —
# tokens rather than CSS, because the card resolves them against the Home
# Assistant theme and both themes have to stay legible. The card holds the only
# copy of what each one looks like; `tests/test_frontend_registration.py` pins
# the two vocabularies to each other across the language boundary.
#
# A strong form is a saturated fill carrying fixed ink, so it draws attention a
# tint cannot. That is the whole reason for the pairing: "Broken" and "Lent out"
# are both statuses, and only one of them should shout.
STATUS_COLORS: tuple[str, ...] = (
    "neutral",
    "neutral_strong",
    "green",
    "green_strong",
    "blue",
    "blue_strong",
    "amber",
    "amber_strong",
    "red",
    "red_strong",
)
DEFAULT_STATUS_COLOR: str = "neutral"

# The glyphs a status may carry. A closed set, and deliberately small: the card
# inlines its SVG path data rather than depending on Home Assistant's `ha-icon`
# (see the deviation note in `docs/frontend_architecture.md`), so every name
# here costs bundle bytes and has to earn them.
STATUS_ICONS: tuple[str, ...] = (
    "check",
    "alert",
    "wrench",
    "hand",
    "box",
    "truck",
    "clock",
    "cancel",
    "star",
    "help",
)
DEFAULT_STATUS_ICON: str = "check"

# -----------------------------
# WebSocket rate limiting (config-entry options)
# -----------------------------
# Off by default so no development or test workflow is disturbed; enable via
# the integration's options flow (Settings -> Devices & services -> HAventory
# -> Configure). See docs/backend_api_contract.md "Rate limiting".

CONF_RATE_LIMIT_ENABLED: str = "rate_limit_enabled"
CONF_RATE_LIMIT_COMMANDS_PER_SECOND: str = "rate_limit_commands_per_second"
CONF_RATE_LIMIT_COMMANDS_BURST: str = "rate_limit_commands_burst"
CONF_RATE_LIMIT_GLOBAL_COMMANDS_PER_SECOND: str = "rate_limit_global_commands_per_second"
CONF_RATE_LIMIT_GLOBAL_COMMANDS_BURST: str = "rate_limit_global_commands_burst"
CONF_RATE_LIMIT_EVENTS_PER_SECOND: str = "rate_limit_events_per_second"
CONF_RATE_LIMIT_EVENTS_BURST: str = "rate_limit_events_burst"
CONF_RATE_LIMIT_GLOBAL_EVENTS_PER_SECOND: str = "rate_limit_global_events_per_second"
CONF_RATE_LIMIT_GLOBAL_EVENTS_BURST: str = "rate_limit_global_events_burst"

DEFAULT_RATE_LIMIT_ENABLED: bool = False
# Sustained rate (tokens/second) and burst capacity per token bucket. The
# defaults are generous: a Lovelace card refresh is a handful of commands.
DEFAULT_RATE_LIMIT_COMMANDS_PER_SECOND: float = 20.0
DEFAULT_RATE_LIMIT_COMMANDS_BURST: float = 60.0
DEFAULT_RATE_LIMIT_GLOBAL_COMMANDS_PER_SECOND: float = 100.0
DEFAULT_RATE_LIMIT_GLOBAL_COMMANDS_BURST: float = 200.0
DEFAULT_RATE_LIMIT_EVENTS_PER_SECOND: float = 50.0
DEFAULT_RATE_LIMIT_EVENTS_BURST: float = 200.0
DEFAULT_RATE_LIMIT_GLOBAL_EVENTS_PER_SECOND: float = 500.0
DEFAULT_RATE_LIMIT_GLOBAL_EVENTS_BURST: float = 1000.0

# -----------------------------
# Entity platforms
# -----------------------------

PLATFORMS: tuple[Platform, ...] = (Platform.SENSOR, Platform.CALENDAR)

# -----------------------------
# Calendar
# -----------------------------

# The calendar's `unique_id`. Constant rather than entry-scoped like the
# sensors': `single_config_entry` in the manifest means there is never a second
# entry to distinguish, and `calendar.haventory` is a reserved name that this
# string is what pins.
CALENDAR_UNIQUE_ID: str = "haventory_calendar"


@dataclass(frozen=True, slots=True)
class HaventorySensorDescription:
    """One inventory count exposed as a sensor.

    ``key`` is a key of ``Repository.get_counts()`` and the suffix of the
    entity's ``unique_id``; ``translation_key`` names the entry under
    ``entity.sensor`` in `strings.json`. ``date_derived`` marks the counts that
    move with the calendar rather than with a mutation, which is what makes them
    subscribe to the local-midnight rollover as well as to mutations.
    """

    key: str
    translation_key: str
    icon: str
    date_derived: bool = False


# Eight of the thirteen keys `get_counts()` returns. The rest stay card- and
# WebSocket-only: `status_counts` is a mapping rather than a number, and the
# remaining figures are either derivable from these or too narrow to be worth an
# entity on every install. Promoting one later is additive.
SENSOR_DESCRIPTIONS: tuple[HaventorySensorDescription, ...] = (
    HaventorySensorDescription("items_total", "items_total", "mdi:package-variant-closed"),
    HaventorySensorDescription("low_stock_count", "low_stock", "mdi:package-down"),
    HaventorySensorDescription("checked_out_count", "checked_out", "mdi:account-arrow-right"),
    HaventorySensorDescription("overdue_count", "overdue", "mdi:calendar-alert", date_derived=True),
    HaventorySensorDescription(
        "checked_out_due_count", "checked_out_due", "mdi:calendar-clock", date_derived=True
    ),
    HaventorySensorDescription(
        "inspection_overdue_count", "inspection_overdue", "mdi:clipboard-alert", date_derived=True
    ),
    HaventorySensorDescription(
        "inspection_due_count", "inspection_due", "mdi:clipboard-text-clock", date_derived=True
    ),
    HaventorySensorDescription("locations_total", "locations", "mdi:map-marker-multiple"),
)

# -----------------------------
# Home Assistant bus events
# -----------------------------
# Fired after the durable write, from WebSocket mutations and `haventory.*`
# service calls alike, so an automation can trigger on the inventory without a
# WebSocket client. Payload shapes: docs/data_shapes.md.

EVENT_ITEM_CHANGED: str = "haventory_item_changed"
EVENT_LOW_STOCK: str = "haventory_low_stock"

# Dispatcher signal every entity this integration owns listens on — the counts
# and the calendar alike, since both are derived from the same items. Bus events
# are the public contract; this is the internal nudge that repaints entities.
SIGNAL_INVENTORY_CHANGED: str = "haventory_inventory_changed"
