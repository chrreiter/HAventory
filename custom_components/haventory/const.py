"""Constants for the HAventory integration."""

from dataclasses import dataclass

from homeassistant.const import Platform

DOMAIN: str = "haventory"

# release-please rewrites the literal on the annotation; it must match manifest.json.
INTEGRATION_VERSION: str = "0.9.3"  # x-release-please-version

# -----------------------------
# Config-entry options
# -----------------------------
# The card heading; a dashboard's own `title:` still wins over it.
CONF_CARD_TITLE: str = "card_title"
DEFAULT_CARD_TITLE: str = "HAventory"

# The pills the card and the panel offer; a dashboard's `quick_filters:` still
# wins for that card. Must match `QUICK_FILTER_KEYS` in
# `cards/haventory-card/src/ui/quick-filters.ts` (pinned by a test).
CONF_QUICK_FILTERS: str = "quick_filters"
QUICK_FILTER_KEYS: tuple[str, ...] = (
    "total",
    "low_stock",
    "overdue",
    "inspection_due",
    "reminder_due",
    "checked_out",
)

# The form's prefill. An unset option is reported as `None`, which leaves the
# choice to the dashboard; `[]` is an explicit "no pills".
DEFAULT_QUICK_FILTERS: tuple[str, ...] = QUICK_FILTER_KEYS

# The sidebar panel, on by default so a fresh install is discoverable.
CONF_SIDEBAR_PANEL_ENABLED: str = "sidebar_panel_enabled"
DEFAULT_SIDEBAR_PANEL_ENABLED: bool = True

PANEL_URL_PATH: str = "haventory"
PANEL_ELEMENT_NAME: str = "haventory-panel"
# An icon set the card bundle registers (`cards/haventory-card/src/ui/brand-icon.ts`);
# the two spellings have to agree.
PANEL_ICON: str = "haventory:logo"

# The to-do list the low-stock set is mirrored onto; empty means off.
CONF_TODO_ENTITY_ID: str = "todo_entity_id"
DEFAULT_TODO_ENTITY_ID: str = ""

# The bridge's link map has its own `Store`, outside the inventory's schema and exports.
TODO_LINKS_STORAGE_KEY: str = "haventory_todo_links"
TODO_LINKS_STORAGE_VERSION: int = 1

# -----------------------------
# Repairs
# -----------------------------
# Constant ids, so a repeat refusal updates one card; each is also the
# `translation_key` under `issues` in `strings.json`.
ISSUE_SCHEMA_DOWNGRADE: str = "schema_downgrade"
ISSUE_CORRUPT_SCHEMA_VERSION: str = "corrupt_schema_version"
ISSUE_CORRUPT_STORE: str = "corrupt_store"

REPAIR_ISSUE_IDS: tuple[str, ...] = (
    ISSUE_SCHEMA_DOWNGRADE,
    ISSUE_CORRUPT_SCHEMA_VERSION,
    ISSUE_CORRUPT_STORE,
)

# The corrupt-store repair's one-boot opt-in, cleared by any setup that loads.
CONF_ALLOW_LOSSY_LOAD: str = "allow_lossy_load"

# Where that repair copies the raw store before the lossy load.
CORRUPT_BACKUP_STORAGE_KEY: str = "haventory_store_corrupt_backup"

# -----------------------------
# Item attachments
# -----------------------------
# Under the config directory, so backups carry them, but outside the package
# (replaced on upgrade) and `<config>/www` (served without authentication).
MEDIA_SUBDIR: str = "haventory/attachments"

# Both ids are matched against stored metadata before any path is built.
MEDIA_URL_TEMPLATE: str = "/api/haventory/media/{item_id}/{attachment_id}"

# Present when the URL is versioned by the served name; only its presence is read.
MEDIA_NAME_TOKEN_PARAM: str = "v"  # noqa: S105 - a query parameter name, not a credential

# Checked against the sniffed bytes. No SVG: it carries script, served from HA's origin.
ATTACHMENT_PICTURE_MIME_TYPES: tuple[str, ...] = (
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
)
ATTACHMENT_MANUAL_MIME_TYPES: tuple[str, ...] = ("application/pdf",)

# Reported through `haventory/config` and enforced server-side regardless.
MAX_PICTURES_PER_ITEM: int = 10
MAX_MANUALS_PER_ITEM: int = 10
MAX_ATTACHMENT_BYTES: int = 8 * 1024 * 1024

# The row tile, derived on first request. 256px: the largest tile is 72px, and a
# 3x screen wants 216.
MEDIA_SIZE_PARAM: str = "size"
MEDIA_SIZE_THUMB: str = "thumb"
THUMBNAIL_MAX_EDGE: int = 256
THUMBNAIL_QUALITY: int = 80

# **Bump this when an existing tile must not survive an encoder change**: the
# sweep at the next setup removes the previous generation's files. Generation 1
# is `.thumb.webp`, with no number.
THUMBNAIL_GENERATION: int = 2
THUMBNAIL_SUFFIX: str = f".thumb{THUMBNAIL_GENERATION}.webp"

# -----------------------------
# Status appearance
# -----------------------------
# Tokens the card resolves against the theme; the card holds the only copy of
# what each looks like, and a test pins the two vocabularies together.
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

# A small closed set: the card inlines each glyph's SVG, so each costs bundle bytes.
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
# Entity platforms
# -----------------------------
PLATFORMS: tuple[Platform, ...] = (Platform.SENSOR, Platform.CALENDAR)

# Constant rather than entry-scoped (single entry); it pins `calendar.haventory`.
CALENDAR_UNIQUE_ID: str = "haventory_calendar"


@dataclass(frozen=True, slots=True)
class HaventorySensorDescription:
    """One inventory count exposed as a sensor.

    ``key`` is a key of ``Repository.get_counts()``; ``date_derived`` counts also
    move at local midnight.
    """

    key: str
    translation_key: str
    icon: str
    date_derived: bool = False


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
# Fired after the durable write. Payload shapes: docs/data_shapes.md.
EVENT_ITEM_CHANGED: str = "haventory_item_changed"
EVENT_LOW_STOCK: str = "haventory_low_stock"

# The internal nudge that repaints every entity this integration owns.
SIGNAL_INVENTORY_CHANGED: str = "haventory_inventory_changed"
