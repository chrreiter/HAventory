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
        "integration_version": "0.0.1",
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

Conflict policies (for ids already present in the repository):

* ``skip`` — keep the existing entity; the incoming one is ignored.
* ``replace`` — overwrite the existing entity with the incoming one.
* ``merge`` — overlay incoming onto existing: scalar fields from incoming, item
  ``tags`` unioned, item ``custom_fields`` merged (incoming wins per key).
"""

from __future__ import annotations

from collections.abc import Collection
from typing import Any, Literal

from .const import INTEGRATION_VERSION
from .exceptions import ValidationError
from .models import (
    CATEGORY_MAX_LENGTH,
    CUSTOM_FIELD_KEY_MAX_LENGTH,
    CUSTOM_FIELD_VALUE_MAX_LENGTH,
    CUSTOM_FIELDS_MAX_KEYS,
    DEFAULT_ITEM_STATUS,
    DESCRIPTION_MAX_LENGTH,
    EMPTY_LOCATION_PATH,
    ITEM_STATUSES,
    NAME_MAX_LENGTH,
    TAG_MAX_LENGTH,
    TAGS_MAX_COUNT,
    Item,
    Location,
    build_location_path_from_map,
    is_canonical_utc_timestamp,
    iso_utc_now,
    normalize_tags,
    normalize_text_for_sort,
    parse_uuid4,
    seed_status_definitions,
    serialize_attachment_meta,
    serialize_status_definition,
    validate_attachment_meta,
    validate_due_date_rules,
    validate_status_definition,
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


# -----------------------------
# Export
# -----------------------------


def _serialize_item_doc(item: Item) -> dict[str, Any]:
    """Serialize an item to a document entry (all source + path fields)."""

    return {
        "id": str(item.id),
        "name": item.name,
        "description": item.description,
        "quantity": int(item.quantity),
        "status": item.status,
        "checked_out": bool(item.checked_out),
        "due_date": item.due_date,
        "inspection_date": item.inspection_date,
        "location_id": str(item.location_id) if item.location_id is not None else None,
        "tags": list(item.tags),
        "category": item.category,
        "low_stock_threshold": item.low_stock_threshold,
        "custom_fields": dict(item.custom_fields),
        "created_at": item.created_at,
        "updated_at": item.updated_at,
        "version": int(item.version),
        "location_path": {
            "id_path": [str(x) for x in item.location_path.id_path],
            "name_path": list(item.location_path.name_path),
            "display_path": item.location_path.display_path,
            "sort_key": item.location_path.sort_key,
        },
        "attachments": [serialize_attachment_meta(a) for a in item.attachments],
    }


def _serialize_location_doc(loc: Location) -> dict[str, Any]:
    """Serialize a location to a document entry (all source + path fields)."""

    return {
        "id": str(loc.id),
        "name": loc.name,
        "parent_id": str(loc.parent_id) if loc.parent_id is not None else None,
        "area_id": str(loc.area_id) if loc.area_id is not None else None,
        "path": {
            "id_path": [str(x) for x in loc.path.id_path],
            "name_path": list(loc.path.name_path),
            "display_path": loc.path.display_path,
            "sort_key": loc.path.sort_key,
        },
    }


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

    if item_filter is None:
        items = list(repo._items_by_id.values())
        location_ids = set(repo._locations_by_id.keys())
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

    items_docs = [_serialize_item_doc(items[i]) for i in _sorted_index_by_id(items)]
    locations = [
        repo._locations_by_id[lid] for lid in sorted(location_ids) if lid in repo._locations_by_id
    ]
    locations_docs = [_serialize_location_doc(loc) for loc in locations]

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


# -----------------------------
# Import — validation & planning
# -----------------------------


def _err(path: str, message: str) -> dict[str, str]:
    return {"path": path, "message": message}


def _warn(code: str, path: str, message: str, **fields: Any) -> dict[str, Any]:
    """One non-blocking finding about an otherwise valid document.

    Unlike an error, a warning carries a ``code``: every error means "this
    document is unusable" and needs no discriminator, while warnings accumulate
    kinds, and the code is what keeps a second kind from needing a second list.
    """

    return {"code": code, "path": path, "message": message, **fields}


def _coerce_entity_list(value: Any) -> list[dict[str, Any]] | None:
    """Accept the document list form (preferred) or a legacy id->dict mapping."""

    if isinstance(value, list):
        if all(isinstance(v, dict) for v in value):
            return list(value)
        return None
    if isinstance(value, dict):
        # Tolerate {id: entity} maps produced by repository.export_state.
        return [v for v in value.values() if isinstance(v, dict)]
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

    entries = _coerce_entity_list(raw)
    if entries is None:
        errors.append(_err("statuses", "statuses must be an array of objects"))
        return {}

    parsed: dict[str, dict[str, Any]] = {}
    for idx, entry in enumerate(entries):
        try:
            definition = validate_status_definition(entry)
        except ValidationError as exc:
            errors.append(_err(f"statuses[{idx}]", str(exc)))
            continue
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
    elif current_schema_version is not None and sv > current_schema_version:
        errors.append(
            _err(
                "schema_version",
                f"document schema version {sv} is newer than supported "
                f"({current_schema_version}); upgrade HAventory before importing",
            )
        )

    items = _coerce_entity_list(doc.get("items", []))
    if items is None:
        errors.append(_err("items", "items must be an array of objects"))
    locations = _coerce_entity_list(doc.get("locations", []))
    if locations is None:
        errors.append(_err("locations", "locations must be an array of objects"))

    return items, locations, errors


def _validate_uuid4(value: Any, path: str, errors: list[dict[str, str]]) -> str | None:
    if not isinstance(value, str) or not value:
        errors.append(_err(path, "must be a non-empty UUID v4 string"))
        return None
    try:
        parse_uuid4(value, field_name=path)
    except ValidationError as exc:
        errors.append(_err(path, str(exc)))
        return None
    return value


def _validate_capped_text(
    value: Any, path: str, max_length: int, errors: list[dict[str, str]]
) -> None:
    """Report an optional free-text field that is not a string, or is too long.

    Absence and an explicit null are both fine; every item field this guards is
    nullable.
    """

    if value is None:
        return
    if not isinstance(value, str):
        errors.append(_err(path, f"{path.rsplit('.', 1)[-1]} must be a string or null"))
        return
    if len(value) > max_length:
        errors.append(
            _err(path, f"{path.rsplit('.', 1)[-1]} must be at most {max_length} characters")
        )


def _validate_location_doc(
    idx: int, doc: dict[str, Any], errors: list[dict[str, str]]
) -> str | None:
    base = f"locations[{idx}]"
    lid = _validate_uuid4(doc.get("id"), f"{base}.id", errors)
    name = doc.get("name")
    if not isinstance(name, str) or not name.strip():
        errors.append(_err(f"{base}.name", "name is required and must be a non-empty string"))
    elif len(name.strip()) > NAME_MAX_LENGTH:
        errors.append(_err(f"{base}.name", f"name must be at most {NAME_MAX_LENGTH} characters"))
    parent_id = doc.get("parent_id")
    if parent_id is not None:
        _validate_uuid4(parent_id, f"{base}.parent_id", errors)
    area_id = doc.get("area_id")
    if area_id is not None and not isinstance(area_id, str):
        errors.append(_err(f"{base}.area_id", "area_id must be a string or null"))
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
        try:
            validate_attachment_meta(entry)
        except ValidationError as exc:
            errors.append(_err(f"{base}.attachments[{idx}]", str(exc)))


def _validate_tags_doc(base: str, doc: dict[str, Any], errors: list[dict[str, str]]) -> None:
    """Hold an imported tag list to the caps a written one is held to.

    The count is measured on the normalized list, the way the write path
    measures it: a document repeating a tag under two casings carries one tag.
    """

    tags = doc.get("tags", [])
    if not isinstance(tags, list) or any(not isinstance(t, str) for t in tags):
        errors.append(_err(f"{base}.tags", "tags must be an array of strings"))
        return
    if len(normalize_tags(tags)) > TAGS_MAX_COUNT:
        errors.append(_err(f"{base}.tags", f"tags must have at most {TAGS_MAX_COUNT} entries"))
    if any(len(t) > TAG_MAX_LENGTH for t in tags):
        errors.append(_err(f"{base}.tags", f"each tag must be at most {TAG_MAX_LENGTH} characters"))


def _validate_custom_fields_doc(
    base: str, doc: dict[str, Any], errors: list[dict[str, str]]
) -> None:
    """Hold an imported custom-field map to the caps a written one is held to."""

    cf = doc.get("custom_fields", {})
    if not isinstance(cf, dict):
        errors.append(_err(f"{base}.custom_fields", "custom_fields must be an object"))
        return
    if len(cf) > CUSTOM_FIELDS_MAX_KEYS:
        errors.append(
            _err(
                f"{base}.custom_fields",
                f"custom_fields must have at most {CUSTOM_FIELDS_MAX_KEYS} keys",
            )
        )
    for k, v in cf.items():
        if not isinstance(k, str) or not k:
            errors.append(
                _err(f"{base}.custom_fields", "custom_fields keys must be non-empty strings")
            )
        elif len(k) > CUSTOM_FIELD_KEY_MAX_LENGTH:
            errors.append(
                _err(
                    f"{base}.custom_fields",
                    f"custom_fields keys must be at most {CUSTOM_FIELD_KEY_MAX_LENGTH} characters",
                )
            )
        elif not isinstance(v, str | int | float | bool):
            errors.append(_err(f"{base}.custom_fields.{k}", "custom_fields values must be scalar"))
        elif isinstance(v, str) and len(v) > CUSTOM_FIELD_VALUE_MAX_LENGTH:
            errors.append(
                _err(
                    f"{base}.custom_fields.{k}",
                    "custom_fields values must be at most "
                    f"{CUSTOM_FIELD_VALUE_MAX_LENGTH} characters",
                )
            )


def _validate_item_doc(
    idx: int, doc: dict[str, Any], errors: list[dict[str, str]], known_statuses: Collection[str]
) -> str | None:
    base = f"items[{idx}]"
    iid = _validate_uuid4(doc.get("id"), f"{base}.id", errors)
    name = doc.get("name")
    if not isinstance(name, str) or not name.strip():
        errors.append(_err(f"{base}.name", "name is required and must be a non-empty string"))
    elif len(name.strip()) > NAME_MAX_LENGTH:
        errors.append(_err(f"{base}.name", f"name must be at most {NAME_MAX_LENGTH} characters"))
    _validate_capped_text(
        doc.get("description"), f"{base}.description", DESCRIPTION_MAX_LENGTH, errors
    )
    _validate_capped_text(doc.get("category"), f"{base}.category", CATEGORY_MAX_LENGTH, errors)
    qty = doc.get("quantity", 1)
    if not isinstance(qty, int) or isinstance(qty, bool) or qty < 0:
        errors.append(_err(f"{base}.quantity", "quantity must be an integer >= 0"))
    thr = doc.get("low_stock_threshold")
    if thr is not None and (not isinstance(thr, int) or isinstance(thr, bool) or thr < 0):
        errors.append(
            _err(
                f"{base}.low_stock_threshold",
                "low_stock_threshold must be an integer >= 0 or null",
            )
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
    _validate_due_date_doc(base, doc, errors)
    return iid


def _validate_due_date_doc(base: str, doc: dict[str, Any], errors: list[dict[str, str]]) -> None:
    """Hold an imported item to the same due-date invariant a write is held to.

    A due date only exists while an item is checked out, and every WS and
    service path enforces that. A document is the one way an item could arrive
    carrying a date nothing will ever clear.
    """

    due_date = doc.get("due_date")
    if due_date is None:
        return
    try:
        validate_due_date_rules(checked_out=bool(doc.get("checked_out", False)), due_date=due_date)
    except ValidationError as exc:
        errors.append(_err(f"{base}.due_date", str(exc)))


def _canonical_item(doc: dict[str, Any]) -> dict[str, Any]:
    """Normalize an item document to its comparable source-of-truth subset."""

    out: dict[str, Any] = {}
    for f in _ITEM_SOURCE_FIELDS:
        if f == "tags":
            out[f] = normalize_tags(doc.get("tags") or [])
        elif f == "custom_fields":
            out[f] = dict(doc.get("custom_fields") or {})
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

    loc_objs: dict[str, Location] = {}
    for lid, d in locations.items():
        loc_objs[lid] = Location(
            id=parse_uuid4(str(d["id"]), field_name="location.id"),
            parent_id=(
                parse_uuid4(str(d["parent_id"]), field_name="location.parent_id")
                if d.get("parent_id") is not None
                else None
            ),
            name=str(d["name"]),
            area_id=str(d["area_id"]) if d.get("area_id") is not None else None,
            path=EMPTY_LOCATION_PATH,
        )

    # Recompute location paths (also validates parent references resolve).
    out_locations: dict[str, Any] = {}
    for lid, obj in loc_objs.items():
        try:
            path = build_location_path_from_map(obj.id, locations_by_id=loc_objs)
        except ValidationError as exc:
            errors.append(_err(f"locations[{lid}].parent_id", str(exc)))
            return None
        out_locations[lid] = {
            "id": str(obj.id),
            "name": obj.name,
            "parent_id": str(obj.parent_id) if obj.parent_id is not None else None,
            "area_id": obj.area_id,
            "path": {
                "id_path": [str(x) for x in path.id_path],
                "name_path": list(path.name_path),
                "display_path": path.display_path,
                "sort_key": path.sort_key,
            },
        }

    out_items: dict[str, Any] = {}
    for iid, d in items.items():
        loc_id = d.get("location_id")
        if loc_id is not None and str(loc_id) not in loc_objs:
            errors.append(
                _err(f"items[{iid}].location_id", "location_id must reference an existing location")
            )
            return None
        if loc_id is not None:
            lp = build_location_path_from_map(
                parse_uuid4(str(loc_id), field_name="item.location_id"), locations_by_id=loc_objs
            )
            location_path = {
                "id_path": [str(x) for x in lp.id_path],
                "name_path": list(lp.name_path),
                "display_path": lp.display_path,
                "sort_key": lp.sort_key,
            }
        else:
            location_path = {"id_path": [], "name_path": [], "display_path": "", "sort_key": ""}
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
    describe_stored,
    describe_incoming,
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
    canonical,
    merge,
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
