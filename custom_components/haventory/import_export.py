"""JSON import/export for HAventory — data safety (backup & restore).

This module builds versioned export documents from a :class:`Repository` and
applies import documents back into one. It is framework-agnostic (no Home
Assistant, no I/O): the WebSocket layer (``ws.py``) wraps it, persists on
success, and rolls back on failure.

Document shape (``haventory_export_version = 1``)::

    {
        "haventory_export_version": 1,
        "schema_version": <int>,
        "exported_at": "YYYY-MM-DDTHH:MM:SSZ",
        "integration_version": <this build's INTEGRATION_VERSION>,
        "items": [ <ItemDoc>, ... ],
        "locations": [ <LocationDoc>, ... ],
        "statuses": [ <StatusDefinitionDoc>, ... ]
    }

``ItemDoc`` / ``LocationDoc`` carry every source-of-truth field plus the
denormalized paths, so a round-trip (export → import into an empty instance)
reproduces the data exactly. The document is machine-generated and best treated
as opaque; hand-editing is supported but paths are recomputed on import.

Two sections need their absence to keep meaning something, permanently, because
every export written before they existed relies on it:

* ``statuses`` — items store only a slug, so the slug-to-label mapping travels
  here or a restore onto a fresh install loses every custom label. An absent
  section reads as the built-in three.
* ``attachments`` on an item — **metadata only**. The result is one WebSocket
  frame the card writes to a file, so it cannot carry binaries; a document
  imported where the referenced files are absent keeps the references, and
  ``import/preview`` reports how many have no file on this install. Home
  Assistant's own backups are the full-fidelity path, because the media
  directory lives inside the config directory.

Import is a three-step contract:

* :func:`plan_import` — validate + classify without mutating; the basis for the
  ``haventory/import/preview`` command and for ``execute``'s dry run.
* the caller applies the returned ``target_payload`` via ``Repository.load_state``
  and persists, rolling back to a snapshot on any failure.

A document is a restore, so validation here is exactly as tolerant as
``Repository.load_state``: the rules every release has enforced on writes —
UUIDs, the name cap, canonical timestamps, the ``due_date`` ⇔ ``checked_out``
invariant, statuses the document can name — are checked, and the free-text and
collection caps are **not**. Those caps bind what an edit may add; a store
written before they existed is legal data this integration itself wrote, and an
export of it has to import back or a backup stops being one.

Conflict policies (for ids already present in the repository):

* ``skip`` — keep the existing entity; the incoming one is ignored.
* ``replace`` — overwrite the existing entity with the incoming one.
* ``merge`` — overlay incoming onto existing: scalar fields from incoming, item
  ``tags`` unioned, item ``custom_fields`` merged (incoming wins per key).
"""

from __future__ import annotations

from collections.abc import Callable, Collection
from typing import Any, Literal

from .const import INTEGRATION_VERSION
from .exceptions import ValidationError
from .migrations import PRE_COLLAPSE_SCHEMA_VERSIONS
from .models import (
    DEFAULT_ITEM_STATUS,
    EMPTY_LOCATION_PATH,
    ITEM_STATUSES,
    Item,
    Location,
    build_location_path_from_map,
    is_canonical_utc_timestamp,
    iso_utc_now,
    normalize_tags,
    normalize_text_for_sort,
    parse_uuid4,
    seed_status_definitions,
    serialize_status_definition,
    validate_attachment_meta,
    validate_due_date_rules,
    validate_low_stock_threshold,
    validate_optional_date,
    validate_optional_text,
    validate_quantity,
    validate_reminder_interval,
    validate_reminder_rules,
    validate_status_definition,
    validate_write_name,
)
from .repository import Repository

# Version of the export *document envelope* (independent of the storage
# ``schema_version``, which describes item/location field shapes).
EXPORT_VERSION: int = 1

Policy = Literal["merge", "replace", "skip"]
POLICIES: tuple[Policy, ...] = ("merge", "replace", "skip")

# Source-of-truth item fields compared when deciding add/update/conflict/unchanged.
# Derived fields (location_path) are intentionally excluded — paths are recomputed.
_ITEM_SOURCE_FIELDS: tuple[str, ...] = (
    "name",
    "description",
    "quantity",
    "status",
    "checked_out",
    "due_date",
    "inspection_date",
    "reminder_date",
    "reminder_anchor",
    "reminder_interval",
    "location_id",
    "tags",
    "category",
    "low_stock_threshold",
    "custom_fields",
    "created_at",
    "updated_at",
    "version",
    # Metadata only — the export cannot carry the bytes (see the module
    # docstring's "attachments" note), so a reference may land on an install
    # that has no file for it.
    "attachments",
)
_LOCATION_SOURCE_FIELDS: tuple[str, ...] = ("name", "parent_id", "area_id")


def build_export_document(
    repo: Repository,
    *,
    item_filter: dict[str, Any] | None = None,
    schema_version: int,
) -> dict[str, Any]:
    """Build a versioned export document from ``repo``.

    With no ``item_filter`` this is a full backup: every item and location.
    With a filter, only the matching items are exported, together with the
    locations on each item's ancestry (its ``location_path``) so the document
    stays referentially self-consistent.
    """

    locations_by_id = {str(loc.id): loc for loc in repo.iter_locations()}
    if item_filter is None:
        items = list(repo.list_items(limit=None)["items"])
        location_ids = set(locations_by_id)
    else:
        page = repo.list_items(flt=item_filter, limit=None)  # type: ignore[arg-type]
        items = list(page["items"])
        # Keep every location referenced by an exported item's ancestry so the
        # document remains self-consistent (items always reference a location
        # that is present in the same document).
        location_ids = set()
        for it in items:
            for lid in it.location_path.id_path:
                location_ids.add(str(lid))
            if it.location_id is not None:
                location_ids.add(str(it.location_id))

    items_docs = [items[i].to_dict() for i in _sorted_index_by_id(items)]
    locations_docs = [
        locations_by_id[lid].to_dict() for lid in sorted(location_ids) if lid in locations_by_id
    ]

    return {
        "haventory_export_version": EXPORT_VERSION,
        "schema_version": int(schema_version),
        "exported_at": iso_utc_now(),
        "integration_version": INTEGRATION_VERSION,
        "items": items_docs,
        "locations": locations_docs,
        # Items store only a slug, so the slug-to-label mapping has to travel in
        # the same document or a restore onto a fresh install would lose every
        # custom label. An absent section reads as the built-ins, permanently,
        # which is what keeps every pre-v6 export importable.
        "statuses": [serialize_status_definition(d) for d in repo.list_statuses()],
    }


def _sorted_index_by_id(items: list[Item]) -> list[int]:
    """Return indices of ``items`` ordered by their stringified id (stable export)."""

    return sorted(range(len(items)), key=lambda i: str(items[i].id))


def _err(path: str, message: str) -> dict[str, str]:
    return {"path": path, "message": message}


def _collect[T](
    errors: list[dict[str, str]],
    path: str,
    validator: Callable[..., T],
    /,
    *args: Any,
    **kwargs: Any,
) -> T | None:
    """Run one write-path validator for its refusal, reported at ``path``.

    A document is answered field by field rather than at the first refusal, so
    a validator is called here for what it says rather than for control flow:
    the message it raises is the message the import sheet prints, and ``None``
    back means this field was refused and the caller has nothing to read from
    it. The value is returned so a caller that needs the validated form — a
    status definition, a parsed id — gets it from the same call.
    """

    try:
        return validator(*args, **kwargs)
    except ValidationError as exc:
        errors.append(_err(path, str(exc)))
        return None


def _warn(code: str, path: str, message: str, **fields: Any) -> dict[str, Any]:
    """One non-blocking finding about an otherwise valid document.

    Unlike an error, a warning carries a ``code``: every error means "this
    document is unusable" and needs no discriminator, while warnings accumulate
    kinds, and the code is what keeps a second kind from needing a second list.
    """

    return {"code": code, "path": path, "message": message, **fields}


def _entity_array(value: Any) -> list[dict[str, Any]] | None:
    """One of the document's entity sections, or ``None`` when it is not one.

    An array of objects is the only shape a section has ever been written in:
    the stored payload keys entities by id, but nothing hands that form to an
    import — ``build_export_document`` is what writes every document a user
    holds, and it writes arrays.
    """

    if isinstance(value, list) and all(isinstance(v, dict) for v in value):
        return list(value)
    return None


def _parse_status_section(
    doc: dict[str, Any], errors: list[dict[str, str]]
) -> dict[str, dict[str, Any]]:
    """Read the document's ``statuses`` section, or the built-ins when absent.

    Absence is not an error and never will be: every export written before the
    section existed relies on it meaning exactly the built-in three.
    """

    raw = doc.get("statuses")
    if raw is None:
        return {
            slug: serialize_status_definition(definition)
            for slug, definition in seed_status_definitions().items()
        }

    entries = _entity_array(raw)
    if entries is None:
        errors.append(_err("statuses", "statuses must be an array of objects"))
        return {}

    parsed: dict[str, dict[str, Any]] = {}
    for idx, entry in enumerate(entries):
        definition = _collect(errors, f"statuses[{idx}]", validate_status_definition, entry)
        if definition is not None:
            parsed[definition.slug] = serialize_status_definition(definition)
    return parsed


def _parse_envelope(
    doc: Any,
    *,
    current_schema_version: int | None,
) -> tuple[list[dict[str, Any]] | None, list[dict[str, Any]] | None, list[dict[str, str]]]:
    """Validate the document envelope. Returns (items, locations, errors).

    ``items``/``locations`` are ``None`` when the envelope is unusable.
    """

    errors: list[dict[str, str]] = []
    if not isinstance(doc, dict):
        return None, None, [_err("document", "document must be a JSON object")]

    version = doc.get("haventory_export_version")
    if version is None:
        errors.append(_err("haventory_export_version", "missing export version"))
    elif not isinstance(version, int) or isinstance(version, bool):
        errors.append(_err("haventory_export_version", "export version must be an integer"))
    elif version > EXPORT_VERSION:
        errors.append(
            _err(
                "haventory_export_version",
                f"unsupported export version {version} (this build supports {EXPORT_VERSION})",
            )
        )

    sv = doc.get("schema_version")
    if sv is None:
        errors.append(_err("schema_version", "missing schema_version"))
    elif not isinstance(sv, int) or isinstance(sv, bool):
        errors.append(_err("schema_version", "schema_version must be an integer"))
    # Two refusals above the current version, because they have two different
    # ways out. A document stamped inside `PRE_COLLAPSE_SCHEMA_VERSIONS` was
    # written by this project before the schema was collapsed to 1, and only a
    # 0.8.x build still reads it — so the way to this build is through one,
    # never through an upgrade.
    elif current_schema_version == 1 and sv in PRE_COLLAPSE_SCHEMA_VERSIONS:
        errors.append(
            _err(
                "schema_version",
                f"document schema version {sv} predates the collapse to "
                f"{current_schema_version} and no newer build reads it; open it on "
                "HAventory 0.8.x and export again",
            )
        )
    elif current_schema_version is not None and sv > current_schema_version:
        errors.append(
            _err(
                "schema_version",
                f"document schema version {sv} is newer than supported "
                f"({current_schema_version}); upgrade HAventory before importing",
            )
        )

    items = _entity_array(doc.get("items", []))
    if items is None:
        errors.append(_err("items", "items must be an array of objects"))
    locations = _entity_array(doc.get("locations", []))
    if locations is None:
        errors.append(_err("locations", "locations must be an array of objects"))

    return items, locations, errors


def _validate_uuid4(value: Any, path: str, errors: list[dict[str, str]]) -> str | None:
    if not isinstance(value, str) or not value:
        errors.append(_err(path, "must be a non-empty UUID v4 string"))
        return None
    if _collect(errors, path, parse_uuid4, value, field_name=path) is None:
        return None
    return value


def _validate_location_doc(
    idx: int, doc: dict[str, Any], errors: list[dict[str, str]]
) -> str | None:
    base = f"locations[{idx}]"
    lid = _validate_uuid4(doc.get("id"), f"{base}.id", errors)
    _collect(errors, f"{base}.name", validate_write_name, doc.get("name"))
    parent_id = doc.get("parent_id")
    if parent_id is not None:
        _validate_uuid4(parent_id, f"{base}.parent_id", errors)
    _collect(errors, f"{base}.area_id", validate_optional_text, doc.get("area_id"), "area_id")
    return lid


def _validate_item_status_doc(
    base: str, doc: dict[str, Any], errors: list[dict[str, str]], known: Collection[str]
) -> None:
    """Reject a present-but-unknown item status.

    A status that is PRESENT must be one the document itself defines or a
    built-in (an explicit null or unknown string is rejected); an omitted field
    is allowed and reads as the default on load — that is what a pre-status
    export carries.
    """

    if "status" in doc and doc.get("status") not in known:
        errors.append(_err(f"{base}.status", f"status must be one of: {', '.join(sorted(known))}"))


def _validate_attachments_doc(base: str, doc: dict[str, Any], errors: list[dict[str, str]]) -> None:
    """Validate every attachment entry, naming the one that fails.

    Entries are metadata only; the file they name may be absent on this install
    (``import/preview`` counts those), which is a caveat rather than an error.
    """

    raw = doc.get("attachments", [])
    if not isinstance(raw, list):
        errors.append(_err(f"{base}.attachments", "attachments must be an array of objects"))
        return
    for idx, entry in enumerate(raw):
        _collect(errors, f"{base}.attachments[{idx}]", validate_attachment_meta, entry)


def _validate_tags_doc(base: str, doc: dict[str, Any], errors: list[dict[str, str]]) -> None:
    """Report a tag list that is not a list of strings.

    The tag caps are deliberately not applied — a document is a restore, and a
    store written before the caps existed can legally carry more tags, or
    longer ones, than an edit may add today.

    Written here rather than run through the write path's ``validate_tags``
    because the sentence differs: a document is JSON, so it is refused for not
    being an *array*, where a client's payload is refused for not being a list.
    """

    tags = doc.get("tags", [])
    if not isinstance(tags, list) or any(not isinstance(t, str) for t in tags):
        errors.append(_err(f"{base}.tags", "tags must be an array of strings"))


def _validate_custom_fields_doc(
    base: str, doc: dict[str, Any], errors: list[dict[str, str]]
) -> None:
    """Report a custom-field map that is structurally unusable.

    Only the shape is checked — a mapping of non-empty string keys to scalars,
    which is what the search-index build and the serializers require. The size
    caps are deliberately not applied, for the reason the tag caps are not.

    Written here rather than run through the write path's
    ``validate_custom_fields`` for the reason the tag check is, plus one of its
    own: this reports every key the map gets wrong and names the offending key
    in the path, where a validator raising on the first would send the author
    back to the whole map once per bad entry.
    """

    cf = doc.get("custom_fields", {})
    if not isinstance(cf, dict):
        errors.append(_err(f"{base}.custom_fields", "custom_fields must be an object"))
        return
    for k, v in cf.items():
        if not isinstance(k, str) or not k:
            errors.append(
                _err(f"{base}.custom_fields", "custom_fields keys must be non-empty strings")
            )
        elif not isinstance(v, str | int | float | bool):
            errors.append(_err(f"{base}.custom_fields.{k}", "custom_fields values must be scalar"))


def _validate_item_doc(
    idx: int, doc: dict[str, Any], errors: list[dict[str, str]], known_statuses: Collection[str]
) -> str | None:
    base = f"items[{idx}]"
    iid = _validate_uuid4(doc.get("id"), f"{base}.id", errors)
    # The name is held to the write path's rule whole, the length cap included:
    # every release has enforced it, so no store can hold a longer one. The
    # free-text fields go through the same validator with no cap, which is what
    # the module note above means by a restore being tolerant of them.
    _collect(errors, f"{base}.name", validate_write_name, doc.get("name"))
    _collect(
        errors, f"{base}.description", validate_optional_text, doc.get("description"), "description"
    )
    _collect(errors, f"{base}.category", validate_optional_text, doc.get("category"), "category")
    # An absent quantity loads as one, so the default is what gets checked.
    _collect(errors, f"{base}.quantity", validate_quantity, doc.get("quantity", 1))
    _collect(
        errors,
        f"{base}.low_stock_threshold",
        validate_low_stock_threshold,
        doc.get("low_stock_threshold"),
    )
    _validate_item_status_doc(base, doc, errors, known_statuses)
    _validate_attachments_doc(base, doc, errors)
    loc_id = doc.get("location_id")
    if loc_id is not None:
        _validate_uuid4(loc_id, f"{base}.location_id", errors)
    _validate_tags_doc(base, doc, errors)
    _validate_custom_fields_doc(base, doc, errors)
    # Canonical fixed-width timestamps are an invariant sorting and range
    # filters depend on: they compare lexicographically. A field that is PRESENT
    # must be canonical (an explicit null / non-canonical string is rejected so
    # it cannot be stored as "None"/garbage); an omitted field is allowed and
    # backfilled with a canonical value on load.
    for ts_field in ("created_at", "updated_at"):
        if ts_field in doc and not is_canonical_utc_timestamp(doc.get(ts_field)):
            errors.append(
                _err(
                    f"{base}.{ts_field}",
                    f"{ts_field} must be an ISO-8601 UTC timestamp (YYYY-MM-DDTHH:MM:SSZ)",
                )
            )
    # A due date only exists while an item is checked out, and every WS and
    # service path enforces that. A document is the one way an item could arrive
    # carrying a date nothing will ever clear.
    _collect(
        errors,
        f"{base}.due_date",
        validate_due_date_rules,
        checked_out=bool(doc.get("checked_out", False)),
        due_date=doc.get("due_date"),
    )
    _collect(
        errors,
        f"{base}.inspection_date",
        validate_optional_date,
        doc.get("inspection_date"),
        field_name="inspection_date",
    )
    _validate_reminder_doc(base, doc, errors)
    return iid


def _validate_reminder_doc(base: str, doc: dict[str, Any], errors: list[dict[str, str]]) -> None:
    """Hold an imported reminder to the rules every write path enforces.

    All three halves matter, and they fail differently. A date nothing can parse
    reaches the calendar, which derives its occurrences from stored dates on
    every read. A misspelled unit — ``"month"`` for ``"months"`` — is read by the
    deliberately tolerant loader as no recurrence at all, so the document would
    import clean and the recurrence would be gone with nothing saying so. An
    anchor later than the date it belongs to describes a series this build
    cannot walk.
    """

    reminder_date = doc.get("reminder_date")
    interval = doc.get("reminder_interval")
    anchor = doc.get("reminder_anchor")
    reported = len(errors)

    _collect(
        errors,
        f"{base}.reminder_date",
        validate_optional_date,
        reminder_date,
        field_name="reminder_date",
    )
    if anchor is not None and (
        _collect(
            errors,
            f"{base}.reminder_anchor",
            validate_optional_date,
            anchor,
            field_name="reminder_anchor",
        )
        is not None
    ):
        # The anchor is where the series starts and the date is how far it has
        # been marked done, so an anchor beyond its own date describes a series
        # with no occurrence to lead to. Absent is fine — it reads as the date,
        # which is what every export written before the field carries.
        if reminder_date is None:
            errors.append(
                _err(
                    f"{base}.reminder_anchor", "reminder_anchor requires a reminder_date to lead to"
                )
            )
        elif isinstance(reminder_date, str) and anchor > reminder_date:
            errors.append(
                _err(
                    f"{base}.reminder_anchor",
                    "reminder_anchor must not be later than reminder_date",
                )
            )
    _collect(errors, f"{base}.reminder_interval", validate_reminder_interval, interval)
    if len(errors) > reported:
        return

    # The rule binding the two lives in one place rather than being restated
    # here; the interval is the half that is wrong when it fires.
    _collect(
        errors,
        f"{base}.reminder_interval",
        validate_reminder_rules,
        reminder_date=reminder_date,
        reminder_interval=interval,
    )


def _canonical_item(doc: dict[str, Any]) -> dict[str, Any]:
    """Normalize an item document to its comparable source-of-truth subset."""

    out: dict[str, Any] = {}
    for f in _ITEM_SOURCE_FIELDS:
        if f == "tags":
            out[f] = normalize_tags(doc.get("tags") or [])
        elif f == "custom_fields":
            out[f] = dict(doc.get("custom_fields") or {})
        elif f == "reminder_anchor":
            # Absent reads as the reminder's own date on load, so a document
            # written before the field existed compares as unchanged against a
            # stored item whose series has never been bumped.
            out[f] = doc.get("reminder_anchor") or doc.get("reminder_date")
        elif f == "status":
            # An absent status reads as the default on load, so a pre-status
            # export compares as unchanged against a stored "ok" item.
            out[f] = doc.get("status", DEFAULT_ITEM_STATUS)
        elif f == "attachments":
            # Same reasoning: absent reads as none, so a pre-v6 export compares
            # as unchanged against a stored item that has no attachments.
            out[f] = [dict(a) for a in (doc.get("attachments") or []) if isinstance(a, dict)]
        else:
            out[f] = doc.get(f)
    return out


def _canonical_location(doc: dict[str, Any]) -> dict[str, Any]:
    return {f: doc.get(f) for f in _LOCATION_SOURCE_FIELDS}


def _merge_item(existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    """Overlay ``incoming`` onto ``existing`` for the ``merge`` policy."""

    merged = dict(existing)
    for f in _ITEM_SOURCE_FIELDS:
        if f == "tags":
            union: list[str] = list(existing.get("tags") or [])
            for t in normalize_tags(incoming.get("tags") or []):
                if t not in union:
                    union.append(t)
            merged["tags"] = union
        elif f == "custom_fields":
            merged["custom_fields"] = {
                **(existing.get("custom_fields") or {}),
                **(incoming.get("custom_fields") or {}),
            }
        elif f == "attachments":
            # Unioned by id, the way tags are unioned: an attachment the other
            # side does not mention is a file that still exists, and a merge
            # that dropped it would orphan the bytes on the next sweep.
            attachments: list[dict[str, Any]] = [
                dict(a) for a in (existing.get("attachments") or []) if isinstance(a, dict)
            ]
            seen = {str(a.get("id")) for a in attachments}
            for entry in incoming.get("attachments") or []:
                if isinstance(entry, dict) and str(entry.get("id")) not in seen:
                    attachments.append(dict(entry))
                    seen.add(str(entry.get("id")))
            merged["attachments"] = attachments
        elif f in incoming:
            merged[f] = incoming[f]
    merged["id"] = existing["id"]
    return merged


def _recompute_paths(
    items: dict[str, dict[str, Any]],
    locations: dict[str, dict[str, Any]],
    errors: list[dict[str, str]],
) -> dict[str, Any] | None:
    """Materialize objects, recompute all denormalized paths, and re-serialize.

    Validates referential integrity as a side effect (item.location_id and
    location.parent_id must resolve). Returns the storage-shaped payload, or
    ``None`` when a reference is broken (with ``errors`` populated).
    """

    # The path a document carries is dropped rather than read: it is recomputed
    # below from the names and parent links this import is about to store, and a
    # hand-edited one would otherwise decide whether the document loads at all.
    loc_objs: dict[str, Location] = {
        lid: Location.from_dict({**d, "path": None}) for lid, d in locations.items()
    }

    # Recompute location paths (also validates parent references resolve).
    out_locations: dict[str, Any] = {}
    for lid, obj in loc_objs.items():
        try:
            path = build_location_path_from_map(obj.id, locations_by_id=loc_objs)
        except ValidationError as exc:
            errors.append(_err(f"locations[{lid}].parent_id", str(exc)))
            return None
        out_locations[lid] = {**obj.to_dict(), "path": path.to_dict()}

    out_items: dict[str, Any] = {}
    for iid, d in items.items():
        loc_id = d.get("location_id")
        if loc_id is not None and str(loc_id) not in loc_objs:
            errors.append(
                _err(f"items[{iid}].location_id", "location_id must reference an existing location")
            )
            return None
        if loc_id is not None:
            location_path = build_location_path_from_map(
                parse_uuid4(str(loc_id), field_name="item.location_id"), locations_by_id=loc_objs
            ).to_dict()
        else:
            location_path = EMPTY_LOCATION_PATH.to_dict()
        entry = dict(d)
        entry["tags"] = normalize_tags(d.get("tags") or [])
        entry["custom_fields"] = dict(d.get("custom_fields") or {})
        entry["location_path"] = location_path
        out_items[iid] = entry

    return {"items": out_items, "locations": out_locations}


#: How many colliding stored entries a warning quotes by name before it counts
#: the rest. The message renders as one line in the import sheet, and a repeated
#: leaf name ("Drawer 1") can collide with a dozen stored entries at once.
COLLISION_LABELS_SHOWN = 3


def _quoted_path(entry: dict[str, Any], key: str) -> str:
    """The display path an entity carries under ``key``, or "" when it has none."""

    path = entry.get(key)
    display = path.get("display_path") if isinstance(path, dict) else None
    return display if isinstance(display, str) and display else ""


def _join_phrases(phrases: list[str]) -> str:
    if len(phrases) == 1:
        return phrases[0]
    return f"{', '.join(phrases[:-1])} and {phrases[-1]}"


def _describe_incoming_item(doc: dict[str, Any], name: str) -> str:
    """Name the incoming item, and where the document puts it.

    Two incoming items of one name would otherwise render as two identical
    lines, and the location is what separates them — the same job the stored
    side's path does.
    """

    where = _quoted_path(doc, "location_path")
    return f'"{name}" in "{where}"' if where else f'"{name}"'


def _describe_incoming_location(doc: dict[str, Any], name: str) -> str:
    return f'"{_quoted_path(doc, "path") or name}"'


def _describe_stored_item(_stored: dict[str, Any]) -> str:
    """An item has no path of its own — the count and the ids are the handle."""

    return ""


def _describe_stored_location(stored: dict[str, Any]) -> str:
    """Name the stored location by its path.

    Two legitimate "Shelf A"s under different parents are common, and the path
    is what lets an operator tell one from the rebuilt duplicate at a glance.
    The check itself deliberately does not scope by parent: an incoming
    location's parent may itself be incoming, so resolving it would mean
    planning the tree twice to answer what the path already answers.
    """

    return f'"{_quoted_path(stored, "path")}"' if _quoted_path(stored, "path") else ""


def _collision_message(*, subject: str, kind: str, stored_labels: list[str]) -> str:
    """One self-contained sentence naming both sides of a name collision.

    Held to a single sentence on purpose: the import sheet renders one of these
    per clash under a lead that already explains what a clash is, so a line that
    repeats the explanation puts the same claim on screen six times.

    ``stored_labels`` is one entry per colliding stored entity, empty-stringed
    for a kind that has no path to quote. Every entity is counted; only the
    quotable ones are named, and only the first few of those.
    """

    total = len(stored_labels)
    plural = total > 1
    ids_phrase = "under different ids" if plural else "under a different id"

    quotable = [label for label in stored_labels if label]
    if quotable:
        shown = quotable[:COLLISION_LABELS_SHOWN]
        rest = total - len(shown)
        more = f", and {rest} more" if rest > 0 else ""
        verb = "are" if plural else "is"
        already = f"{_join_phrases(shown)}{more} {verb} already here"
    else:
        article = "an" if kind[0] in "aeiou" else "a"
        counted_kind = f"{total} {kind}s" if plural else f"{article} {kind}"
        verb = "go" if plural else "goes"
        already = f"{counted_kind} here already {verb} by that name"

    return f"{subject} would be added while {already}, {ids_phrase}."


def _name_collision_warnings(  # noqa: PLR0913 - one document side, one stored side
    *,
    label: str,
    kind: str,
    added_ids: list[str],
    incoming: list[dict[str, Any]],
    ids: list[str],
    existing: dict[str, Any],
    describe_stored: Callable[[dict[str, Any]], str],
    describe_incoming: Callable[[dict[str, Any], str], str],
) -> list[dict[str, Any]]:
    """Flag each incoming entity about to be created under a taken name.

    The hazard this catches is the one the contract already names: a document
    imported onto entities that were deleted and rebuilt by hand duplicates
    them rather than merging, because identity is the id and the rebuilt entity
    has a new one. That is precisely an incoming entity about to be *created*
    while a stored entity of a different id already answers to its name.

    Restricted to the ``add`` bucket for the same reason. ``update`` and
    ``unchanged`` are the same entity by id, so a name they share with some
    third entity is an ordinary namesake — warning on it would fire on healthy
    documents, and a check that fires on the normal case is worse than none.

    Incoming-vs-incoming matches are out of scope: duplicate ids inside one
    document are already an error, and two same-named entities in one document
    are the exporting inventory's business, not a collision with this one.

    Names are compared under ``normalize_text_for_sort`` — case-insensitive,
    accent-folded, whitespace-collapsed — which is how the repository itself
    compares names.

    **Every** stored entity of a colliding name is reported, not the first one
    found. Repeated leaf names are how location trees are shaped, so a
    hand-rebuilt tree collides several deep on "Shelf A" or "Drawer 1" at once;
    naming one arbitrary stored entity there would point the path quote at the
    wrong counterpart, which is the one job that quote exists to do.
    """

    if not added_ids:
        return []

    stored_by_name: dict[str, list[tuple[str, dict[str, Any]]]] = {}
    for stored_id, stored in existing.items():
        name = stored.get("name")
        if isinstance(name, str) and name.strip():
            stored_by_name.setdefault(normalize_text_for_sort(name), []).append(
                (str(stored_id), stored)
            )

    index_by_id = {eid: idx for idx, eid in enumerate(ids) if eid}
    warnings: list[dict[str, Any]] = []
    for eid in added_ids:
        idx = index_by_id.get(eid)
        if idx is None:  # pragma: no cover - every added id came from `ids`
            continue
        doc = incoming[idx]
        name = doc.get("name")
        if not isinstance(name, str) or not name.strip():
            continue
        matches = stored_by_name.get(normalize_text_for_sort(name))
        if not matches:
            continue
        # Ordered by what the message shows, so the same document reports the
        # same thing whatever order the repository happens to hold its entities.
        ordered = sorted(matches, key=lambda match: (describe_stored(match[1]), match[0]))
        warnings.append(
            _warn(
                "name_collision",
                f"{label}[{idx}]",
                _collision_message(
                    subject=describe_incoming(doc, name.strip()),
                    kind=kind,
                    stored_labels=[describe_stored(stored) for _, stored in ordered],
                ),
                name=name.strip(),
                existing_ids=[stored_id for stored_id, _ in ordered],
            )
        )
    return warnings


def _empty_bucket() -> dict[str, list[str]]:
    return {"add": [], "update": [], "conflict": [], "unchanged": []}


def _bucket_counts(bucket: dict[str, list[str]]) -> dict[str, int]:
    total = sum(len(v) for v in bucket.values())
    return {
        "total": total,
        "add": len(bucket["add"]),
        "update": len(bucket["update"]),
        "conflict": len(bucket["conflict"]),
        "unchanged": len(bucket["unchanged"]),
    }


def plan_import(
    repo: Repository,
    doc: Any,
    *,
    policy: Policy = "merge",
    current_schema_version: int | None = None,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    """Validate and classify an import document without mutating ``repo``.

    Returns ``(report, target_payload)``. ``report["valid"]`` is ``False`` when
    the document is unusable or contains invalid entities, in which case
    ``target_payload`` is ``None`` and ``report["errors"]`` explains why.

    Classification (per entity, mutually exclusive):

    * ``add`` — id absent from the repository (created under every policy).
    * ``unchanged`` — id present and content identical to the stored entity.
    * ``update`` — id present, content differs, and the policy modifies it
      (``replace``/``merge``).
    * ``conflict`` — id present, content differs, and the policy leaves it
      untouched (``skip``).
    """

    if policy not in POLICIES:
        raise ValidationError(f"policy must be one of: {', '.join(POLICIES)}")

    warnings: list[dict[str, Any]] = []
    items_in, locations_in, errors = _parse_envelope(
        doc, current_schema_version=current_schema_version
    )
    statuses_in = _parse_status_section(doc if isinstance(doc, dict) else {}, errors)
    report: dict[str, Any] = {
        "valid": False,
        "errors": errors,
        # Present from construction, so an invalid document returns the same
        # shape as a valid one and the card has one thing to render.
        "warnings": warnings,
        "policy": policy,
        "document": _document_meta(doc if isinstance(doc, dict) else {}),
        "items": _empty_bucket(),
        "locations": _empty_bucket(),
        "counts": {},
    }
    if items_in is None or locations_in is None or errors:
        return report, None

    # Per-entity structural validation.
    loc_ids: list[str] = []
    for i, d in enumerate(locations_in):
        loc_ids.append(_validate_location_doc(i, d, errors) or "")
    # A slug is known when the document defines it or it is a built-in. Anything
    # else has no label anywhere and would import as an item flagged with a
    # state nothing can name.
    known_statuses = set(statuses_in) | set(ITEM_STATUSES)
    item_ids: list[str] = []
    for i, d in enumerate(items_in):
        item_ids.append(_validate_item_doc(i, d, errors, known_statuses) or "")

    # Duplicate ids within the document are ambiguous — reject.
    _check_duplicate_ids(item_ids, "items", errors)
    _check_duplicate_ids(loc_ids, "locations", errors)

    if errors:
        return report, None

    existing = repo.export_state()
    existing_items = existing.get("items", {})
    existing_locations = existing.get("locations", {})

    target_items = {iid: dict(d) for iid, d in existing_items.items()}
    target_locations = {lid: dict(d) for lid, d in existing_locations.items()}

    _plan_entities(
        incoming=locations_in,
        ids=loc_ids,
        existing=existing_locations,
        target=target_locations,
        bucket=report["locations"],
        policy=policy,
        canonical=_canonical_location,
        merge=lambda ex, inc: {**ex, **inc},  # locations: merge == replace (structural)
    )
    _plan_entities(
        incoming=items_in,
        ids=item_ids,
        existing=existing_items,
        target=target_items,
        bucket=report["items"],
        policy=policy,
        canonical=_canonical_item,
        merge=_merge_item,
    )

    # After planning, because only planning says which entities land in `add` —
    # and before path recomputation, because the stored paths a location warning
    # quotes are the ones this inventory has now, not the ones the import would
    # produce.
    warnings.extend(
        _name_collision_warnings(
            label="locations",
            kind="location",
            added_ids=report["locations"]["add"],
            incoming=locations_in,
            ids=loc_ids,
            existing=existing_locations,
            describe_stored=_describe_stored_location,
            describe_incoming=_describe_incoming_location,
        )
    )
    warnings.extend(
        _name_collision_warnings(
            label="items",
            kind="item",
            added_ids=report["items"]["add"],
            incoming=items_in,
            ids=item_ids,
            existing=existing_items,
            describe_stored=_describe_stored_item,
            describe_incoming=_describe_incoming_item,
        )
    )

    payload = _recompute_paths(target_items, target_locations, errors)
    if payload is None or errors:
        return report, None

    payload["statuses"] = _resolve_target_statuses(
        existing=existing.get("statuses", {}),
        incoming=statuses_in,
        items=target_items,
    )

    report["valid"] = True
    report["counts"] = {
        "items": _bucket_counts(report["items"]),
        "locations": _bucket_counts(report["locations"]),
    }
    return report, payload


def _resolve_target_statuses(
    *,
    existing: dict[str, Any],
    incoming: dict[str, dict[str, Any]],
    items: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """The status definitions the imported dataset ends up with.

    A definition is a vocabulary entry, not an entity the conflict policies act
    on: no policy deletes one, because an item on this install may still carry
    the slug. So the document's definitions overlay whatever is stored, and any
    slug the resulting items reference without a definition gets one — an item
    flagged with a state nothing can name is the one outcome to rule out.
    """

    resolved: dict[str, dict[str, Any]] = {
        slug: dict(definition)
        for slug, definition in existing.items()
        if isinstance(definition, dict)
    }
    resolved.update({slug: dict(definition) for slug, definition in incoming.items()})

    next_order = max((int(d.get("order", 0)) for d in resolved.values()), default=-1) + 1
    for item in items.values():
        slug = item.get("status", DEFAULT_ITEM_STATUS)
        if not isinstance(slug, str) or slug in resolved:
            continue
        resolved[slug] = {
            "slug": slug,
            "label": slug.replace("_", " ").capitalize(),
            "order": next_order,
        }
        next_order += 1
    return resolved


def referenced_attachments(payload: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    """Every (item id, attachment metadata) pair a planned payload references.

    Kept here rather than counting missing files inline: this module does no
    I/O, so whether a referenced file exists is the caller's question to ask.
    """

    pairs: list[tuple[str, dict[str, Any]]] = []
    for item_id, item in (payload.get("items") or {}).items():
        for entry in item.get("attachments") or []:
            if isinstance(entry, dict):
                pairs.append((str(item_id), entry))
    return pairs


def _plan_entities(  # noqa: PLR0913 - cohesive planning parameters
    *,
    incoming: list[dict[str, Any]],
    ids: list[str],
    existing: dict[str, Any],
    target: dict[str, dict[str, Any]],
    bucket: dict[str, list[str]],
    policy: Policy,
    canonical: Callable[[dict[str, Any]], dict[str, Any]],
    merge: Callable[[dict[str, Any], dict[str, Any]], dict[str, Any]],
) -> None:
    """Classify each incoming entity and write the resolved form into ``target``."""

    for eid, inc in zip(ids, incoming, strict=True):
        if eid not in existing:
            bucket["add"].append(eid)
            target[eid] = dict(inc)
            continue
        if canonical(inc) == canonical(existing[eid]):
            bucket["unchanged"].append(eid)
            continue
        if policy == "skip":
            bucket["conflict"].append(eid)
            # keep existing (already in target)
            continue
        bucket["update"].append(eid)
        if policy == "replace":
            target[eid] = dict(inc)
        else:  # merge
            target[eid] = merge(dict(existing[eid]), dict(inc))


def _check_duplicate_ids(ids: list[str], label: str, errors: list[dict[str, str]]) -> None:
    seen: set[str] = set()
    for eid in ids:
        if not eid:
            continue
        if eid in seen:
            errors.append(_err(label, f"duplicate id in document: {eid}"))
        seen.add(eid)


def _document_meta(doc: dict[str, Any]) -> dict[str, Any]:
    sv = doc.get("schema_version")
    return {
        "haventory_export_version": doc.get("haventory_export_version"),
        "schema_version": int(sv) if isinstance(sv, int) and not isinstance(sv, bool) else None,
        "exported_at": doc.get("exported_at"),
        "integration_version": doc.get("integration_version"),
    }
