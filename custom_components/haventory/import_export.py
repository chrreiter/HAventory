"""JSON import/export for HAventory: backup and restore.

Framework-agnostic (no Home Assistant, no I/O): ``ws.py`` applies the planned
payload through ``Repository.load_state``, persists, and rolls back on failure.

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

Items and locations carry every source-of-truth field; paths are recomputed on
import. An absent ``statuses`` section reads as the built-ins. ``attachments``
are metadata only, so ``import/preview`` reports references with no file here.

A document is a restore: the rules every release has enforced on writes are
checked (UUIDs, the name cap, canonical timestamps, ``due_date`` only while
checked out, known statuses), and the free-text and collection caps are not,
since an older store can legally exceed them.

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

# The document envelope's version, independent of the storage ``schema_version``.
EXPORT_VERSION: int = 1

Policy = Literal["merge", "replace", "skip"]
POLICIES: tuple[Policy, ...] = ("merge", "replace", "skip")

# Compared to classify an entity; the derived ``location_path`` is recomputed.
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

    Without ``item_filter``, a full backup. With one, the matching items and the
    locations on their ancestry, so every exported item's location is present.
    """

    locations_by_id = {str(loc.id): loc for loc in repo.iter_locations()}
    page = repo.list_items(flt=item_filter, limit=None)  # type: ignore[arg-type]
    items = sorted(page["items"], key=lambda it: str(it.id))
    if item_filter is None:
        location_ids = set(locations_by_id)
    else:
        location_ids = {str(lid) for it in items for lid in it.location_path.id_path}
        location_ids.update(str(it.location_id) for it in items if it.location_id is not None)

    return {
        "haventory_export_version": EXPORT_VERSION,
        "schema_version": int(schema_version),
        "exported_at": iso_utc_now(),
        "integration_version": INTEGRATION_VERSION,
        "items": [it.to_dict() for it in items],
        "locations": [
            locations_by_id[lid].to_dict() for lid in sorted(location_ids) if lid in locations_by_id
        ],
        # Items store only a slug, so the labels travel with them.
        "statuses": [serialize_status_definition(d) for d in repo.list_statuses()],
    }


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
    """Run a write-path validator, recording its refusal at ``path``.

    A document is answered field by field, so a refusal is collected rather
    than raised. Returns the validated value, or ``None`` when refused.
    """

    try:
        return validator(*args, **kwargs)
    except ValidationError as exc:
        errors.append(_err(path, str(exc)))
        return None


def _warn(code: str, path: str, message: str, **fields: Any) -> dict[str, Any]:
    """One non-blocking finding about a valid document; ``code`` names its kind."""

    return {"code": code, "path": path, "message": message, **fields}


def _entity_array(value: Any) -> list[dict[str, Any]] | None:
    """An entity section as an array of objects, or ``None`` when it is not one."""

    if isinstance(value, list) and all(isinstance(v, dict) for v in value):
        return list(value)
    return None


def _parse_status_section(
    doc: dict[str, Any], errors: list[dict[str, str]]
) -> dict[str, dict[str, Any]]:
    """Read the document's ``statuses`` section; an absent one means the built-ins."""

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
    # A pre-collapse stamp is read only by a 0.8.x build, not by an upgrade.
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
    """Reject a present status the document does not define; an absent one is the default."""

    if "status" in doc and doc.get("status") not in known:
        errors.append(_err(f"{base}.status", f"status must be one of: {', '.join(sorted(known))}"))


def _validate_attachments_doc(base: str, doc: dict[str, Any], errors: list[dict[str, str]]) -> None:
    """Validate every attachment entry, naming the one that fails."""

    raw = doc.get("attachments", [])
    if not isinstance(raw, list):
        errors.append(_err(f"{base}.attachments", "attachments must be an array of objects"))
        return
    for idx, entry in enumerate(raw):
        _collect(errors, f"{base}.attachments[{idx}]", validate_attachment_meta, entry)


def _validate_tags_doc(base: str, doc: dict[str, Any], errors: list[dict[str, str]]) -> None:
    """Report a tag list that is not an array of strings; the caps do not apply."""

    tags = doc.get("tags", [])
    if not isinstance(tags, list) or any(not isinstance(t, str) for t in tags):
        errors.append(_err(f"{base}.tags", "tags must be an array of strings"))


def _validate_custom_fields_doc(
    base: str, doc: dict[str, Any], errors: list[dict[str, str]]
) -> None:
    """Report every custom-field key or value of the wrong shape; the caps do not apply."""

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
    # Every release has enforced the name cap; the free-text fields go uncapped.
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
    # Sorting and range filters compare timestamps as text, so a present one must
    # be canonical; an absent one is backfilled on load.
    for ts_field in ("created_at", "updated_at"):
        if ts_field in doc and not is_canonical_utc_timestamp(doc.get(ts_field)):
            errors.append(
                _err(
                    f"{base}.{ts_field}",
                    f"{ts_field} must be an ISO-8601 UTC timestamp (YYYY-MM-DDTHH:MM:SSZ)",
                )
            )
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

    Strict where the loader is tolerant: a misspelled unit would otherwise load
    as no recurrence at all, silently.
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
        # An absent anchor reads as the date; one beyond it leads nowhere.
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

    # The interval is the half that is wrong when the pair rule fires.
    _collect(
        errors,
        f"{base}.reminder_interval",
        validate_reminder_rules,
        reminder_date=reminder_date,
        reminder_interval=interval,
    )


def _canonical_item(doc: dict[str, Any]) -> dict[str, Any]:
    """An item document's source-of-truth fields, absent ones read as a load would."""

    out: dict[str, Any] = {}
    for f in _ITEM_SOURCE_FIELDS:
        if f == "tags":
            out[f] = normalize_tags(doc.get("tags") or [])
        elif f == "custom_fields":
            out[f] = dict(doc.get("custom_fields") or {})
        elif f == "reminder_anchor":
            out[f] = doc.get("reminder_anchor") or doc.get("reminder_date")
        elif f == "status":
            out[f] = doc.get("status", DEFAULT_ITEM_STATUS)
        elif f == "attachments":
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
            # Unioned by id: dropping one would orphan its file on the next sweep.
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
    """Recompute every denormalized path into a storage-shaped payload.

    Returns ``None``, with ``errors`` populated, when a parent or location
    reference does not resolve. A document's own paths are never read.
    """

    loc_objs: dict[str, Location] = {
        lid: Location.from_dict({**d, "path": None}) for lid, d in locations.items()
    }

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
        location_path = EMPTY_LOCATION_PATH
        if loc_id is not None:
            if str(loc_id) not in loc_objs:
                errors.append(
                    _err(
                        f"items[{iid}].location_id",
                        "location_id must reference an existing location",
                    )
                )
                return None
            location_path = build_location_path_from_map(str(loc_id), locations_by_id=loc_objs)
        out_items[iid] = {
            **d,
            "tags": normalize_tags(d.get("tags") or []),
            "custom_fields": dict(d.get("custom_fields") or {}),
            "location_path": location_path.to_dict(),
        }

    return {"items": out_items, "locations": out_locations}


#: Stored entries a collision warning quotes by name before it counts the rest.
COLLISION_LABELS_SHOWN = 3


def _quoted_path(entry: dict[str, Any], key: str) -> str:
    path = entry.get(key)
    display = path.get("display_path") if isinstance(path, dict) else None
    return display if isinstance(display, str) and display else ""


def _join_phrases(phrases: list[str]) -> str:
    if len(phrases) == 1:
        return phrases[0]
    return f"{', '.join(phrases[:-1])} and {phrases[-1]}"


def _describe_incoming_item(doc: dict[str, Any], name: str) -> str:
    """Name the incoming item and where the document puts it."""

    where = _quoted_path(doc, "location_path")
    return f'"{name}" in "{where}"' if where else f'"{name}"'


def _describe_incoming_location(doc: dict[str, Any], name: str) -> str:
    return f'"{_quoted_path(doc, "path") or name}"'


def _describe_stored_item(_stored: dict[str, Any]) -> str:
    """An item has no path of its own; the count and the ids are the handle."""

    return ""


def _describe_stored_location(stored: dict[str, Any]) -> str:
    return f'"{path}"' if (path := _quoted_path(stored, "path")) else ""


def _collision_message(*, subject: str, kind: str, stored_labels: list[str]) -> str:
    """One sentence naming both sides of a name collision.

    ``stored_labels`` has one entry per colliding stored entity, empty for one
    with no path to quote. Every entity is counted; the first few are named.
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
    """Flag each incoming entity about to be *added* under a stored entity's name.

    Identity is the id, so a document imported onto entities deleted and rebuilt
    by hand duplicates them rather than merging. Only the ``add`` bucket is
    checked: an update shares its id, so a shared name there is an ordinary
    namesake. Names compare under ``normalize_text_for_sort``, and every stored
    namesake is reported, since rebuilt trees repeat leaf names.
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
        idx = index_by_id[eid]
        doc = incoming[idx]
        name = doc.get("name")
        if not isinstance(name, str) or not name.strip():
            continue
        matches = stored_by_name.get(normalize_text_for_sort(name))
        if not matches:
            continue
        # Ordered by what the message shows, independent of repository order.
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
    counts = {key: len(ids) for key, ids in bucket.items()}
    return {"total": sum(counts.values()), **counts}


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
        "warnings": warnings,
        "policy": policy,
        "document": _document_meta(doc if isinstance(doc, dict) else {}),
        "items": _empty_bucket(),
        "locations": _empty_bucket(),
        "counts": {},
    }
    if items_in is None or locations_in is None or errors:
        return report, None

    loc_ids = [_validate_location_doc(i, d, errors) or "" for i, d in enumerate(locations_in)]
    # A slug the document does not define and no built-in names has no label.
    known_statuses = set(statuses_in) | set(ITEM_STATUSES)
    item_ids = [
        _validate_item_doc(i, d, errors, known_statuses) or "" for i, d in enumerate(items_in)
    ]
    _check_duplicate_ids(item_ids, "items", errors)
    _check_duplicate_ids(loc_ids, "locations", errors)

    if errors:
        return report, None

    existing = repo.export_state()
    existing_items = existing["items"]
    existing_locations = existing["locations"]

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

    # After planning, which decides what lands in `add`, and before the paths
    # are recomputed, so a warning quotes the paths this inventory has now.
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
        existing=existing["statuses"],
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
    """The document's definitions over the stored ones, plus one per unnamed slug.

    No policy deletes a definition: an item here may still carry the slug.
    """

    resolved = {slug: dict(definition) for slug, definition in existing.items()}
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
    """Every (item id, attachment metadata) pair a planned payload references."""

    return [
        (str(item_id), entry)
        for item_id, item in payload["items"].items()
        for entry in item.get("attachments") or []
    ]


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
