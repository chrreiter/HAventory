"""The in-memory source of truth: items, locations, statuses and their indexes.

Every index is maintained by hand on each write. ``_reset_state`` lists the
fields and ``_index_item`` / ``_unindex_item`` fill and empty them, so a new
index has to be added to all three.

Synchronous and framework-agnostic: the caller persists and announces.
"""

from __future__ import annotations

import base64
import binascii
import copy
import json
import uuid
from collections import deque
from collections.abc import Callable, Iterable, Iterator, Sequence
from dataclasses import dataclass, replace
from datetime import date
from typing import Any, TypedDict, TypeVar

from .calendar_projection import next_occurrence_after
from .exceptions import ConflictError, NotFoundError, ValidationError
from .logs import context_logger
from .models import (
    DEFAULT_ITEM_STATUS,
    DEFAULT_SORT,
    AttachmentMeta,
    Item,
    ItemCreate,
    ItemFilter,
    ItemUpdate,
    Location,
    Sort,
    StatusDefinition,
    apply_item_update,
    build_location_path,
    build_location_path_from_map,
    create_item_from_create,
    filter_items,
    item_inspection_is_due,
    item_inspection_is_overdue,
    item_is_due,
    item_is_low_stock,
    item_is_overdue,
    item_reminder_is_due,
    location_chain_to_root,
    monotonic_timestamp_after,
    new_uuid4,
    parse_uuid4,
    require_string_list,
    seed_status_definitions,
    selected_categories,
    selected_location_ids,
    selected_tags,
    serialize_status_definition,
    sort_items,
    sort_value,
    today_local_date,
    validate_status_definition,
    validate_status_slug,
    validate_write_name,
    walk_location_chain,
)

LOGGER = context_logger(__name__)


#: Item indexes are keyed by string; the children index adds ``None`` for roots.
_BucketKey = TypeVar("_BucketKey", str, str | None)


class PageResult(TypedDict):
    items: list[Item]
    next_cursor: str | None
    total: int


# Tells "not provided" from an explicit None.
UNSET: object = object()

#: A cursor is base64 of a small JSON object minted here; nothing longer is decoded.
CURSOR_MAX_LENGTH = 2_048

#: Rows of one kind logged individually before ``load_state`` logs only a total,
#: so a wholesale corruption does not bury the log in one line per row.
LOAD_DROP_LOG_LIMIT = 10


@dataclass(frozen=True)
class LoadReport:
    """What ``load_state`` had to drop or found cyclic.

    ``load_state`` coerces what it can, so an entry here is structurally broken.
    Setup refuses on a non-empty report, because the first save afterwards
    would write the store without the dropped rows. The ids are carried so the
    repair can quote them.
    """

    dropped_item_ids: tuple[str, ...] = ()
    dropped_location_ids: tuple[str, ...] = ()
    #: Locations whose own ``parent_id`` closes a loop — the entries a repair edits.
    cyclic_location_ids: tuple[str, ...] = ()
    #: Locations left unreachable *because* of those, needing no edit of their own.
    unrooted_location_ids: tuple[str, ...] = ()

    @property
    def has_corruption(self) -> bool:
        return bool(
            self.dropped_item_ids
            or self.dropped_location_ids
            or self.cyclic_location_ids
            or self.unrooted_location_ids
        )


def _parse_reminder_date(value: str, field: str) -> date:
    """Read a stored reminder date, naming it if a hand-edited store broke it."""

    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValidationError(
            f"stored reminder {field} {value!r} is not a date this build can read; "
            "set the reminder again to replace it"
        ) from exc


class Repository:
    """In-memory repository maintaining indexes and providing operations.

    Only an item edit moves an item's ``version``; a location rename or move
    rewrites ``location_path`` under it and leaves ``version`` alone.
    """

    def __init__(self) -> None:
        self._reset_state()

    @property
    def last_load_report(self) -> LoadReport:
        return self._last_load_report

    def status_slugs(self) -> frozenset[str]:
        return frozenset(self._statuses_by_slug)

    def list_statuses(self) -> list[StatusDefinition]:
        """Status definitions in display order, ties broken by slug."""

        return sorted(self._statuses_by_slug.values(), key=lambda d: (d.order, d.slug))

    def count_items_with_status(self, slug: str) -> int:
        """How many items carry a slug; the default is everything not bucketed."""

        if slug == DEFAULT_ITEM_STATUS:
            flagged = sum(len(ids) for ids in self._status_to_item_ids.values())
            return len(self._items_by_id) - flagged
        return len(self._status_to_item_ids.get(slug, set()))

    def create_status(self, doc: dict[str, Any]) -> StatusDefinition:
        """Define a new status. Absent ``order`` places it last."""

        slug = validate_status_slug(doc.get("slug"))
        if slug in self._statuses_by_slug:
            raise ValidationError(f"status '{slug}' already exists")
        if "order" not in doc:
            doc = {**doc, "order": len(self._statuses_by_slug)}
        definition = validate_status_definition(doc)
        self._statuses_by_slug[definition.slug] = definition
        return definition

    def update_status(self, slug: str, changes: dict[str, Any]) -> StatusDefinition:
        """Edit a definition's presentation. The slug itself is immutable."""

        current = self._statuses_by_slug.get(slug)
        if current is None:
            raise NotFoundError(f"status '{slug}' not found")
        if "slug" in changes and changes["slug"] != slug:
            raise ValidationError("a status slug cannot be changed; items store it")
        merged = {**serialize_status_definition(current), **changes, "slug": slug}
        definition = validate_status_definition(merged)
        self._statuses_by_slug[slug] = definition
        return definition

    def reorder_statuses(self, slugs: Sequence[str]) -> list[StatusDefinition]:
        """Rewrite display order from a full permutation of the live slugs."""

        slugs = require_string_list(slugs, field_name="slugs")
        if sorted(slugs) != sorted(self._statuses_by_slug):
            raise ValidationError("reorder must name every status exactly once")
        for order, slug in enumerate(slugs):
            self._statuses_by_slug[slug] = replace(self._statuses_by_slug[slug], order=order)
        return self.list_statuses()

    def delete_status(
        self, slug: str, *, reassign_to: str | None = None
    ) -> tuple[StatusDefinition, list[str]]:
        """Remove a definition, moving its items to ``reassign_to``.

        Refuses while items carry the slug and ``reassign_to`` is absent, since
        the next load would silently coerce them to the default. Returns the
        definition and the ids of the items that moved, for the caller to announce.
        """

        if slug == DEFAULT_ITEM_STATUS:
            raise ValidationError(f"'{slug}' is the default status and cannot be deleted")
        current = self._statuses_by_slug.get(slug)
        if current is None:
            raise NotFoundError(f"status '{slug}' not found")

        in_use = self.count_items_with_status(slug)
        if in_use and reassign_to is None:
            raise ValidationError(
                f"status '{slug}' is on {in_use} item(s); "
                "choose a status to move them to before deleting it"
            )
        if reassign_to is not None:
            if reassign_to == slug:
                raise ValidationError("cannot reassign a status to itself")
            if reassign_to not in self._statuses_by_slug:
                raise ValidationError(f"status '{reassign_to}' not found")

        moved = self._reassign_status(slug, reassign_to) if reassign_to is not None else []
        del self._statuses_by_slug[slug]
        self._status_to_item_ids.pop(slug, None)
        return current, moved

    def _reassign_status(self, slug: str, target: str) -> list[str]:
        """Move every item on ``slug`` to ``target``, as ordinary item edits."""

        # Materialized first: the loop reindexes the bucket the ids come from.
        affected = [item_id for item_id, item in self._items_by_id.items() if item.status == slug]
        for item_id in affected:
            current = self._items_by_id[item_id]
            updated = replace(
                current,
                status=target,
                updated_at=monotonic_timestamp_after(current.updated_at),
                version=current.version + 1,
            )
            self._reindex_item_replacement(current, updated)
        return affected

    def _add_to_bucket(
        self, bucket: dict[_BucketKey, set[str]], key: _BucketKey, member: str
    ) -> None:
        bucket.setdefault(key, set()).add(member)

    def _remove_from_bucket(
        self, bucket: dict[_BucketKey, set[str]], key: _BucketKey, member: str
    ) -> None:
        """Drop a member, and the bucket with it when that empties it."""

        members = bucket.get(key)
        if not members:
            return
        members.discard(member)
        if not members:
            bucket.pop(key, None)

    def _index_item(self, item: Item) -> None:
        item_key = str(item.id)
        self._items_by_id[item_key] = item

        for tag in item.tags:
            self._add_to_bucket(self._tags_to_item_ids, tag, item_key)

        cat = (item.category or "").strip().casefold()
        if cat:
            self._add_to_bucket(self._category_to_item_ids, cat, item_key)

        if item.status != DEFAULT_ITEM_STATUS:
            self._add_to_bucket(self._status_to_item_ids, item.status, item_key)

        if item.checked_out:
            self._checked_out_item_ids.add(item_key)

        if item_is_low_stock(item):
            self._low_stock_item_ids.add(item_key)

        if item.location_id:
            self._add_to_bucket(self._items_by_location_id, str(item.location_id), item_key)

            eff_area_id = self.effective_area_id(str(item.location_id))
            if eff_area_id is not None:
                self._add_to_bucket(self._items_by_area_id, eff_area_id, item_key)

        for key in self._subtree_keys(item):
            self._add_to_bucket(self._items_in_subtree, key, item_key)

    def _unindex_item(self, item: Item) -> None:
        item_key = str(item.id)
        for tag in item.tags:
            self._remove_from_bucket(self._tags_to_item_ids, tag, item_key)

        cat = (item.category or "").strip().casefold()
        if cat:
            self._remove_from_bucket(self._category_to_item_ids, cat, item_key)

        if item.status != DEFAULT_ITEM_STATUS:
            self._remove_from_bucket(self._status_to_item_ids, item.status, item_key)

        self._checked_out_item_ids.discard(item_key)
        self._low_stock_item_ids.discard(item_key)

        if item.location_id:
            self._remove_from_bucket(self._items_by_location_id, str(item.location_id), item_key)
            self._remove_item_from_all_area_buckets(item_key)

        for key in self._subtree_keys(item):
            self._remove_from_bucket(self._items_in_subtree, key, item_key)
        self._items_by_id.pop(item_key, None)

    def _remove_item_from_all_area_buckets(self, item_key: str) -> None:
        """Drop an item from every area bucket; its area may have moved since."""

        for area_key in list(self._items_by_area_id):
            self._remove_from_bucket(self._items_by_area_id, area_key, item_key)

    def effective_area_id(self, location_key: str) -> str | None:
        """The first ``area_id`` from the location upwards, or ``None``.

        A tree keeps its area on the root, so a caller must never read it off a
        location's own ``area_id``.
        """

        for loc in walk_location_chain(location_key, locations_by_id=self._locations_by_id):
            if loc.area_id is not None:
                return str(loc.area_id)
        return None

    def _reindex_item_replacement(self, old: Item, new: Item) -> None:
        # Unindex first: it ends by dropping the id from the primary store.
        self._unindex_item(old)
        self._index_item(new)

    def _parse_new_parent(
        self, new_parent_id: str | uuid.UUID | object | None, current_parent: uuid.UUID | None
    ) -> tuple[bool, uuid.UUID | None]:
        """Return ``(parent_changed, target_parent_id)``; UNSET is no change."""

        if new_parent_id is UNSET:
            return False, current_parent
        if new_parent_id is None:
            return (current_parent is not None), None
        if isinstance(new_parent_id, str | uuid.UUID):
            candidate = parse_uuid4(new_parent_id, field_name="new_parent_id")
            return (str(candidate) != str(current_parent)), candidate
        raise ValidationError("new_parent_id must be a UUID v4 string or null")

    def _parse_area_change(
        self, area_id: str | object | None, current_area: str | None
    ) -> tuple[str | None, bool]:
        """Return ``(target_area, area_changed)``; UNSET is no change, None clears."""

        if area_id is UNSET:
            return current_area, False
        if area_id is None:
            return None, current_area is not None
        if isinstance(area_id, str):
            candidate = area_id.strip()
            if not candidate:
                raise ValidationError("area_id must be a non-empty string or null")
            return candidate, candidate != current_area
        raise ValidationError("area_id must be a string or null")

    def _find_location_root(self, location_key: str) -> str:
        """The id at the top of the tree ``location_key`` sits in.

        A chain ending on an unknown parent id answers with that id; every
        caller tolerates a miss.
        """

        root_key = location_key
        for loc in walk_location_chain(location_key, locations_by_id=self._locations_by_id):
            root_key = str(loc.parent_id) if loc.parent_id is not None else str(loc.id)
        return root_key

    def _propagate_area_to_root(self, location_key: str, area_id: str | None) -> None:
        """Put the area on the tree's root, clear it elsewhere, and re-bucket the items."""

        root_key = self._find_location_root(location_key)
        for loc_id in (root_key, *self._collect_descendant_ids(root_key)):
            loc = self._locations_by_id.get(loc_id)
            if loc is None:
                continue
            new_area = area_id if loc_id == root_key else None
            if loc.area_id != new_area:
                self._update_location_area_index(
                    location_key=loc_id, old_area=loc.area_id, new_area=new_area
                )
                self._locations_by_id[loc_id] = replace(loc, area_id=new_area)
        self._rebucket_items_for_subtree_area_change(root_key)

    def _validate_parent_move(
        self,
        *,
        location_key: str,
        target_parent_id: uuid.UUID | None,
    ) -> None:
        if target_parent_id is not None and str(target_parent_id) not in self._locations_by_id:
            raise ValidationError("new_parent_id must reference an existing location")
        if str(target_parent_id) == location_key:
            raise ValidationError("cannot move a location under itself")
        if str(target_parent_id) in self._collect_descendant_ids(location_key):
            raise ValidationError("cannot move a location under one of its descendants")

    def _add_location(self, loc: Location) -> None:
        self._locations_by_id[str(loc.id)] = loc
        parent_key = str(loc.parent_id) if loc.parent_id is not None else None
        self._add_to_bucket(self._children_ids_by_parent_id, parent_key, str(loc.id))
        if loc.area_id is not None:
            self._add_to_bucket(self._locations_by_area_id, loc.area_id, str(loc.id))

    def _remove_location(self, loc: Location) -> None:
        key = str(loc.id)
        self._locations_by_id.pop(key, None)
        parent_key = str(loc.parent_id) if loc.parent_id is not None else None
        self._remove_from_bucket(self._children_ids_by_parent_id, parent_key, key)
        if loc.area_id is not None:
            self._remove_from_bucket(self._locations_by_area_id, loc.area_id, key)

    def _update_location_area_index(
        self, *, location_key: str, old_area: str | None, new_area: str | None
    ) -> None:
        if old_area is not None:
            self._remove_from_bucket(self._locations_by_area_id, old_area, location_key)
        if new_area is not None:
            self._add_to_bucket(self._locations_by_area_id, new_area, location_key)

    def _collect_descendant_ids(self, root_id: str) -> set[str]:
        """Collect all descendant location IDs (excluding the root itself)."""

        result: set[str] = set()
        queue = deque([root_id])
        while queue:
            current = queue.popleft()
            for child_id in self._children_ids_by_parent_id.get(current, set()):
                if child_id not in result:
                    result.add(child_id)
                    queue.append(child_id)
        return result

    def _get_ancestors(self, location_id: str) -> list[str]:
        """The ancestor ids from the parent up; bounded, never raising, on a cycle."""

        return [
            str(loc.parent_id)
            for loc in walk_location_chain(location_id, locations_by_id=self._locations_by_id)
            if loc.parent_id is not None
        ]

    def _unrooted_location_ids(self) -> tuple[tuple[str, ...], tuple[str, ...]]:
        """Split the locations that never reach a root into members and descendants.

        Returns ``(cycle_members, blocked_below)``: only a member's own
        ``parent_id`` closes the loop, so only a member needs editing. Reported
        rather than dropped, since dropping would cascade into children and items.
        The shared acyclic memo keeps a deep tree at O(N).
        """

        acyclic: set[str] = set()
        members: set[str] = set()
        unrooted: set[str] = set()
        for start in self._locations_by_id:
            if start in acyclic or start in unrooted:
                continue
            chain: list[str] = []
            depth_of: dict[str, int] = {}
            cursor: str | None = start
            # Where in `chain` the loop closes; None means no cycle.
            closes_at: int | None = None
            while cursor is not None:
                if cursor in acyclic:
                    break
                if cursor in depth_of:
                    closes_at = depth_of[cursor]
                    break
                if cursor in unrooted:
                    # Runs into a loop already charted: the whole chain is blocked.
                    closes_at = len(chain)
                    break
                depth_of[cursor] = len(chain)
                chain.append(cursor)
                loc = self._locations_by_id.get(cursor)
                if loc is None:
                    break
                cursor = str(loc.parent_id) if loc.parent_id is not None else None
            if closes_at is None:
                acyclic.update(chain)
                continue
            unrooted.update(chain)
            members.update(chain[closes_at:])
        return tuple(sorted(members)), tuple(sorted(unrooted - members))

    def _rebuild_location_hierarchy_indexes(self) -> None:
        """Rebuild the subtree index from scratch; empty subtrees get no entry."""

        self._items_in_subtree.clear()
        for loc_id in self._locations_by_id:
            in_subtree: set[str] = set()
            for sub_id in (loc_id, *self._collect_descendant_ids(loc_id)):
                in_subtree.update(self._items_by_location_id.get(sub_id, ()))
            if in_subtree:
                self._items_in_subtree[loc_id] = in_subtree

    def _subtree_keys(self, item: Item) -> tuple[str, ...]:
        """The item's location and every ancestor: the subtree buckets it sits in.

        Walked again on removal rather than remembered: a tree that moves in
        between rebuilds the subtree index wholesale.
        """

        if not item.location_id:
            return ()
        loc_key = str(item.location_id)
        return (loc_key, *self._get_ancestors(loc_key))

    def _rebuild_paths_for_subtree(self, root_id: str) -> None:
        """Recompute ``Location.path`` under ``root_id`` from the live parent links."""

        for loc_id in (root_id, *self._collect_descendant_ids(root_id)):
            new_path = build_location_path_from_map(loc_id, locations_by_id=self._locations_by_id)
            self._locations_by_id[loc_id] = replace(self._locations_by_id[loc_id], path=new_path)

    def _update_items_location_paths_for_locations(self, affected_location_ids: set[str]) -> None:
        """Copy each location's recomputed path onto the items directly in it.

        ``version`` and ``updated_at`` stay put: the path is derived, and bumping
        ``version`` would invalidate every optimistic-concurrency token in the
        subtree. The caller rebuilds the subtree index; the area buckets move
        here, once per location, only when the effective area changed.
        """

        for loc_id in affected_location_ids:
            item_ids = self._items_by_location_id.get(loc_id)
            if not item_ids:
                continue
            new_path = self._locations_by_id[loc_id].path
            # All items of a location share one area bucket; probe once.
            probe = next(iter(item_ids))
            old_area = next(
                (area for area, ids in self._items_by_area_id.items() if probe in ids), None
            )
            new_area = self.effective_area_id(loc_id)
            area_changed = old_area != new_area

            for item_id in item_ids:
                # copy.copy is measurably cheaper than dataclasses.replace here.
                updated = copy.copy(self._items_by_id[item_id])
                updated.location_path = new_path
                self._items_by_id[item_id] = updated

                if area_changed:
                    if old_area is not None:
                        self._remove_from_bucket(self._items_by_area_id, old_area, item_id)
                    if new_area is not None:
                        self._add_to_bucket(self._items_by_area_id, new_area, item_id)

    def create_item(self, payload: ItemCreate) -> Item:
        item = create_item_from_create(
            payload, locations_by_id=self._locations_by_id, known_statuses=self.status_slugs()
        )
        self._index_item(item)
        LOGGER.debug(
            "Item created",
            extra={"domain": "haventory", "op": "create_item", "item_id": item.id},
        )
        return item

    def get_item(self, item_id: str | uuid.UUID) -> Item:
        item = self._items_by_id.get(str(item_id))
        if item is None:
            raise NotFoundError("item not found")
        return item

    def _item_at_version(self, item_id: str | uuid.UUID, expected_version: int | None) -> Item:
        """The stored item, refused when ``expected_version`` names another."""

        current = self.get_item(item_id)
        if expected_version is not None and current.version != expected_version:
            raise ConflictError(
                f"version conflict: expected {expected_version}, actual {current.version}"
            )
        return current

    def update_item(
        self, item_id: str | uuid.UUID, update: ItemUpdate, *, expected_version: int | None = None
    ) -> Item:
        current = self._item_at_version(item_id, expected_version)
        updated = apply_item_update(
            current,
            update,
            locations_by_id=self._locations_by_id,
            known_statuses=self.status_slugs(),
        )
        self._reindex_item_replacement(current, updated)
        LOGGER.debug(
            "Item updated",
            extra={
                "domain": "haventory",
                "op": "update_item",
                "item_id": str(item_id),
                "old_version": current.version,
                "new_version": updated.version,
            },
        )
        return updated

    def delete_item(self, item_id: str | uuid.UUID, *, expected_version: int | None = None) -> None:
        self._unindex_item(self._item_at_version(item_id, expected_version))
        LOGGER.debug(
            "Item deleted",
            extra={"domain": "haventory", "op": "delete_item", "item_id": str(item_id)},
        )

    def adjust_quantity(
        self, item_id: str | uuid.UUID, delta: object, *, expected_version: int | None = None
    ) -> Item:
        # Typed `object` so the refusal names the field; a bool is not +/-1.
        if isinstance(delta, bool) or not isinstance(delta, int):
            raise ValidationError("delta must be an integer")
        new_q = self.get_item(item_id).quantity + delta
        return self.set_quantity(item_id, new_q, expected_version=expected_version)

    def set_quantity(
        self, item_id: str | uuid.UUID, quantity: int, *, expected_version: int | None = None
    ) -> Item:
        return self.update_item(
            item_id, ItemUpdate(quantity=quantity), expected_version=expected_version
        )

    def check_out(
        self,
        item_id: str | uuid.UUID,
        *,
        due_date: str | None,
        expected_version: int | None = None,
    ) -> Item:
        return self.update_item(
            item_id,
            ItemUpdate(checked_out=True, due_date=due_date),
            expected_version=expected_version,
        )

    def check_in(self, item_id: str | uuid.UUID, *, expected_version: int | None = None) -> Item:
        return self.update_item(
            item_id,
            ItemUpdate(checked_out=False, due_date=None),
            expected_version=expected_version,
        )

    def bump_reminder(
        self, item_id: str | uuid.UUID, *, today: date, expected_version: int | None = None
    ) -> Item:
        """Mark a recurring reminder done and move it on to its next occurrence.

        The one write that moves `reminder_date` without re-anchoring the series,
        so a series on the 31st returns to the 31st in every month that has one.
        Counted from the later of the stored occurrence and `today` (the
        household's day, which the caller supplies), so a long-missed reminder
        lands on its next future occurrence. Otherwise an ordinary versioned edit.
        """

        key = str(item_id)
        current = self.get_item(key)
        if current.reminder_date is None:
            raise ValidationError("item has no reminder to bump")
        if current.reminder_interval is None:
            raise ValidationError(
                "a reminder with no interval has no next occurrence; clear it instead"
            )

        anchor = _parse_reminder_date(current.reminder_anchor or current.reminder_date, "anchor")
        occurrence = _parse_reminder_date(current.reminder_date, "date")
        following = next_occurrence_after(anchor, current.reminder_interval, max(occurrence, today))
        if following is None:  # pragma: no cover - an interval is present above
            raise ValidationError("this reminder has no next occurrence")

        updated = self.update_item(
            key,
            ItemUpdate(reminder_date=following.isoformat()),
            expected_version=expected_version,
        )
        # `update_item` re-anchored on the new date; a bump keeps the anchor.
        self._items_by_id[key] = replace(updated, reminder_anchor=current.reminder_anchor)
        return self._items_by_id[key]

    def _replace_attachments(
        self,
        item_id: str | uuid.UUID,
        attachments: list[AttachmentMeta],
        expected_version: int | None,
    ) -> Item:
        """Swap an item's attachment list, as an ordinary versioned item edit.

        Not routed through ``apply_item_update``: ``ItemUpdate`` has no
        ``attachments`` key, so only the attachment commands write it.
        """

        current = self._item_at_version(item_id, expected_version)
        updated = replace(
            current,
            attachments=attachments,
            updated_at=monotonic_timestamp_after(current.updated_at),
            version=current.version + 1,
        )
        self._reindex_item_replacement(current, updated)
        return updated

    def add_attachment(
        self,
        item_id: str | uuid.UUID,
        meta: AttachmentMeta,
        *,
        max_per_kind: int | None = None,
        expected_version: int | None = None,
    ) -> Item:
        """Append attachment metadata, last among its kind, and return the item.

        ``max_per_kind`` caps how many of this kind an item may carry. The
        position is assigned here, since ``meta.order`` would tie with the cover.
        """

        current = self.get_item(item_id)
        same_kind = sum(1 for a in current.attachments if a.kind == meta.kind)
        if max_per_kind is not None and same_kind >= max_per_kind:
            raise ValidationError(
                f"item already has {max_per_kind} attachment(s) of kind '{meta.kind}'"
            )
        return self._replace_attachments(
            item_id,
            [*current.attachments, replace(meta, order=same_kind)],
            expected_version=expected_version,
        )

    def remove_attachment(
        self,
        item_id: str | uuid.UUID,
        attachment_id: str | uuid.UUID,
        *,
        expected_version: int | None = None,
    ) -> tuple[Item, AttachmentMeta]:
        """Drop one attachment entry, returning the item and the removed metadata.

        The caller deletes the file the metadata names; nothing else records it.
        """

        current = self.get_item(item_id)
        wanted = str(attachment_id)
        removed = next((a for a in current.attachments if str(a.id) == wanted), None)
        if removed is None:
            raise NotFoundError("attachment not found")
        remaining = [a for a in current.attachments if str(a.id) != wanted]
        updated = self._replace_attachments(item_id, remaining, expected_version=expected_version)
        return updated, removed

    def update_attachment(
        self,
        item_id: str | uuid.UUID,
        attachment_id: str | uuid.UUID,
        *,
        title: str,
        expected_version: int | None = None,
    ) -> Item:
        """Retitle one attachment. The file on disk is untouched."""

        current = self.get_item(item_id)
        wanted = str(attachment_id)
        if not any(str(a.id) == wanted for a in current.attachments):
            raise NotFoundError("attachment not found")
        rewritten = [
            replace(a, title=title.strip()) if str(a.id) == wanted else a
            for a in current.attachments
        ]
        return self._replace_attachments(item_id, rewritten, expected_version=expected_version)

    def reorder_attachments(
        self,
        item_id: str | uuid.UUID,
        kind: str,
        attachment_ids: Sequence[str],
        *,
        expected_version: int | None = None,
    ) -> Item:
        """Renumber one kind's attachments; the other kind keeps its numbering."""

        attachment_ids = require_string_list(attachment_ids, field_name="attachment_ids")
        current = self.get_item(item_id)
        of_kind = {str(a.id) for a in current.attachments if a.kind == kind}
        if sorted(attachment_ids) != sorted(of_kind):
            raise ValidationError(
                f"reorder must name every attachment of kind '{kind}' exactly once"
            )
        positions = {att_id: order for order, att_id in enumerate(attachment_ids)}
        rewritten = [
            replace(a, order=positions[str(a.id)]) if a.kind == kind else a
            for a in current.attachments
        ]
        return self._replace_attachments(item_id, rewritten, expected_version=expected_version)

    def iter_attachments(self) -> Iterable[tuple[str, AttachmentMeta]]:
        for item_key, item in self._items_by_id.items():
            for attachment in item.attachments:
                yield item_key, attachment

    def find_attachment(self, item_id: str, attachment_id: str) -> AttachmentMeta | None:
        """Look one attachment up by both ids, or ``None`` when nothing owns it.

        The media view resolves files through here, so an id no metadata claims
        never reaches the filesystem.
        """

        item = self._items_by_id.get(item_id)
        if item is None:
            return None
        return next((a for a in item.attachments if str(a.id) == attachment_id), None)

    def _matching_items(self, flt: ItemFilter | None) -> list[Item]:
        """The items ``flt`` keeps, narrowed through the indexes before the scan.

        ``q`` is never indexed: it matches mid-word, which no bucket can narrow.
        """

        if not flt:
            return list(self._items_by_id.values())

        buckets: list[set[str]] = []
        # Only `None` means no area filter. The area is applied here and nowhere
        # else, so a value naming no bucket must answer with no items.
        area_id = flt.get("area_id")
        if area_id is not None:
            buckets.append(self._items_by_area_id.get(str(area_id).strip(), set()))
        location_keys = [key for key in selected_location_ids(flt) if key]
        if location_keys:
            index = (
                self._items_in_subtree if flt.get("include_subtree") else self._items_by_location_id
            )
            buckets.append(set().union(*(index.get(key, ()) for key in location_keys)))
        category_keys = selected_categories(flt)
        if category_keys:
            buckets.append(
                set().union(*(self._category_to_item_ids.get(k, ()) for k in category_keys))
            )
        # Only non-default known statuses are bucketed; the scan refuses an unknown one.
        status = flt.get("status")
        if (
            isinstance(status, str)
            and status != DEFAULT_ITEM_STATUS
            and status in self._statuses_by_slug
        ):
            buckets.append(self._status_to_item_ids.get(status, set()))
        # `tags_all` is not indexed: an N-way intersection costs more than the scan.
        tags = selected_tags(flt, "tags_any") if flt.get("tags_any") else []
        if tags:
            buckets.append(set().union(*(self._tags_to_item_ids.get(t, ()) for t in tags)))
        if flt.get("checked_out") is True:
            buckets.append(self._checked_out_item_ids)
        if flt.get("low_stock_only"):
            buckets.append(self._low_stock_item_ids)

        source: Iterable[Item] = self._items_by_id.values()
        if buckets:
            buckets.sort(key=len)
            ids = buckets[0].intersection(*buckets[1:])
            source = [self._items_by_id[i] for i in ids]
        return filter_items(source, flt, known_statuses=self.status_slugs())

    def list_items(
        self,
        *,
        flt: ItemFilter | None = None,
        sort: Sort | None = None,
        limit: int | None = None,
        cursor: str | None = None,
    ) -> PageResult:
        sorted_items = sort_items(self._matching_items(flt), sort)
        # Groups low-stock items first, keeping the sort within each group. The
        # cursor has to describe this order, so _paginate is told about it.
        low_stock_first = bool(flt and flt.get("low_stock_first"))
        if low_stock_first:
            sorted_items.sort(key=lambda it: not item_is_low_stock(it))
        if sort is None:
            sort = DEFAULT_SORT
        total = len(sorted_items)

        if limit is None or limit <= 0:
            return {"items": sorted_items, "next_cursor": None, "total": total}

        page, next_cursor = self._paginate(
            sorted_items, sort, limit, cursor, low_stock_first=low_stock_first
        )
        return {"items": page, "next_cursor": next_cursor, "total": total}

    @property
    def low_stock_item_ids(self) -> frozenset[str]:
        """A snapshot of the low-stock ids, which the bus events diff across a write."""

        return frozenset(self._low_stock_item_ids)

    def get_counts(self) -> dict[str, Any]:
        """Aggregate counts for ``haventory/stats``, ``haventory/health`` and events.

        One ``today`` serves every date count, so a call spanning midnight
        answers about one day. None of them is indexed: each moves with the
        calendar, with no mutation to invalidate a bucket.
        """

        today = today_local_date()
        items = self._items_by_id.values()
        # A due date exists only on a checked-out item, so its counts walk those.
        checked_out = [self._items_by_id[iid] for iid in self._checked_out_item_ids]
        items_with_location = sum(len(ids) for ids in self._items_by_location_id.values())
        return {
            "items_total": len(self._items_by_id),
            "low_stock_count": len(self._low_stock_item_ids),
            "checked_out_count": len(self._checked_out_item_ids),
            "overdue_count": sum(item_is_overdue(it, today=today) for it in checked_out),
            "checked_out_due_count": sum(item_is_due(it, today=today) for it in checked_out),
            "inspection_overdue_count": sum(
                item_inspection_is_overdue(it, today=today) for it in items
            ),
            "inspection_due_count": sum(item_inspection_is_due(it, today=today) for it in items),
            "reminder_due_count": sum(item_reminder_is_due(it, today=today) for it in items),
            "missing_count": len(self._status_to_item_ids.get("missing", set())),
            "needs_repair_count": len(self._status_to_item_ids.get("needs_repair", set())),
            "status_counts": {
                slug: self.count_items_with_status(slug) for slug in self._statuses_by_slug
            },
            "locations_total": len(self._locations_by_id),
            "no_location_count": len(self._items_by_id) - items_with_location,
        }

    def count_matching_by_location(self, flt: ItemFilter | None = None) -> dict[str | None, int]:
        """Count filter matches by the item's own location (``None`` for none).

        Direct counts: a caller wanting subtree totals rolls them up.
        """

        counts: dict[str | None, int] = {}
        for item in self._matching_items(flt):
            key = str(item.location_id) if item.location_id is not None else None
            counts[key] = counts.get(key, 0) + 1
        return counts

    def get_location_item_counts(self, location_id: str | uuid.UUID) -> dict[str, int]:
        """Items directly in a location, and in it or any descendant."""
        key = str(location_id)
        if key not in self._locations_by_id:
            raise NotFoundError("location not found")
        return {
            "direct": len(self._items_by_location_id.get(key, set())),
            "subtree": len(self._items_in_subtree.get(key, set())),
        }

    def _count_facets_matching(self, flt: ItemFilter) -> tuple[dict[str, int], dict[str, int]]:
        """Tally categories (casefolded, as indexed) and tags over the matches."""

        by_category: dict[str, int] = {}
        by_tag: dict[str, int] = {}
        for item in self._matching_items(flt):
            key = (item.category or "").strip().casefold()
            if key:
                by_category[key] = by_category.get(key, 0) + 1
            for tag in item.tags:
                by_tag[tag] = by_tag.get(tag, 0) + 1
        return by_category, by_tag

    def get_distinct_field_values(self, flt: ItemFilter | None = None) -> dict[str, object]:
        """Return distinct categories, tags, and custom-field keys.

        Categories group case-insensitively, displayed in their most frequent
        casing (ties alphabetical). With ``flt``, each category and tag entry
        also carries ``matching_count``; ``count`` stays whole-inventory and no
        entry is dropped, because the same payload feeds autocomplete.
        ``custom_field_keys`` is never filtered.
        """

        matching_categories, matching_tags = (
            self._count_facets_matching(flt) if flt is not None else (None, None)
        )

        categories: list[dict[str, object]] = []
        for key, item_ids in self._category_to_item_ids.items():
            originals: dict[str, int] = {}
            for item_id in item_ids:
                raw = (self._items_by_id[item_id].category or "").strip()
                if raw:
                    originals[raw] = originals.get(raw, 0) + 1
            display = max(sorted(originals), key=lambda o: originals[o]) if originals else key
            entry: dict[str, object] = {"value": display, "count": len(item_ids)}
            if matching_categories is not None:
                entry["matching_count"] = matching_categories.get(key, 0)
            categories.append(entry)
        categories.sort(key=lambda c: str(c["value"]).casefold())

        tags: list[dict[str, object]] = []
        for tag, item_ids in self._tags_to_item_ids.items():
            tag_entry: dict[str, object] = {"value": tag, "count": len(item_ids)}
            if matching_tags is not None:
                tag_entry["matching_count"] = matching_tags.get(tag, 0)
            tags.append(tag_entry)
        tags.sort(key=lambda t: str(t["value"]).casefold())

        custom_keys: set[str] = set()
        for item in self._items_by_id.values():
            for cf_key in item.custom_fields:
                if isinstance(cf_key, str) and cf_key.strip():
                    custom_keys.add(cf_key)
        custom_field_keys = sorted(custom_keys, key=lambda k: k.casefold())

        return {
            "categories": categories,
            "tags": tags,
            "custom_field_keys": custom_field_keys,
        }

    def create_location(
        self,
        *,
        name: str,
        parent_id: str | uuid.UUID | None = None,
        area_id: str | None = None,
    ) -> Location:
        name = validate_write_name(name)
        parent = parse_uuid4(parent_id, field_name="parent_id") if parent_id is not None else None
        if parent is not None and str(parent) not in self._locations_by_id:
            raise ValidationError("parent_id must reference an existing location")
        parsed_area = str(area_id).strip() if area_id is not None else None
        if parsed_area == "":
            raise ValidationError("area_id must be a non-empty string or null")
        lineage = (
            location_chain_to_root(parent, locations_by_id=self._locations_by_id)
            if parent is not None
            else []
        )

        # A tree's area lives on its root, so a new node carries none of its own;
        # a requested area is propagated once the node exists.
        new_loc = Location(id=new_uuid4(), parent_id=parent, name=name)
        new_loc.path = build_location_path([*lineage, new_loc])
        new_key = str(new_loc.id)
        self._add_location(new_loc)
        if parsed_area is not None:
            self._propagate_area_to_root(new_key, parsed_area)

        LOGGER.debug(
            "Location created",
            extra={"domain": "haventory", "op": "create_location", "location_id": new_key},
        )
        self._rebuild_location_hierarchy_indexes()
        return self._locations_by_id[new_key]

    def get_location(self, location_id: str | uuid.UUID) -> Location:
        loc = self._locations_by_id.get(str(location_id))
        if loc is None:
            raise NotFoundError("location not found")
        return loc

    def iter_locations(self) -> Iterator[Location]:
        return iter(self._locations_by_id.values())

    def children_of(self, parent_id: str | uuid.UUID | None) -> frozenset[str]:
        """The ids directly under ``parent_id`` (``None`` for the roots), as a copy."""

        key = str(parent_id) if parent_id is not None else None
        return frozenset(self._children_ids_by_parent_id.get(key, frozenset()))

    def update_location(
        self,
        location_id: str | uuid.UUID,
        *,
        name: str | None = None,
        new_parent_id: str | uuid.UUID | object | None = UNSET,
        area_id: str | uuid.UUID | object | None = UNSET,
    ) -> Location:
        """Rename a location, move it, set its area, or all three.

        ``UNSET`` leaves ``new_parent_id`` / ``area_id`` alone; ``None`` moves the
        location to the root / clears the area. An area goes to the tree's root.
        """

        key = str(location_id)
        loc = self.get_location(key)
        updated_name = validate_write_name(name) if name is not None else loc.name
        parent_changed, target_parent_id = self._parse_new_parent(new_parent_id, loc.parent_id)
        parsed_area, area_change_requested = self._parse_area_change(area_id, loc.area_id)

        # Everything that can refuse has refused by here; the parent link is
        # written first, then the paths derived from it.
        if parent_changed:
            self._validate_parent_move(location_key=key, target_parent_id=target_parent_id)
            self._remove_from_bucket(
                self._children_ids_by_parent_id,
                str(loc.parent_id) if loc.parent_id is not None else None,
                key,
            )
            self._add_to_bucket(
                self._children_ids_by_parent_id,
                str(target_parent_id) if target_parent_id is not None else None,
                key,
            )

        self._locations_by_id[key] = replace(loc, name=updated_name, parent_id=target_parent_id)

        # Only a rename or a move changes a path, so only they pay for the
        # subtree walk; an area reassignment must not.
        if parent_changed or updated_name != loc.name:
            self._rebuild_paths_for_subtree(key)
            self._update_items_location_paths_for_locations(
                {key, *self._collect_descendant_ids(key)}
            )
            self._rebuild_location_hierarchy_indexes()

        if area_change_requested:
            self._propagate_area_to_root(key, parsed_area)

        LOGGER.debug(
            "Location updated",
            extra={
                "domain": "haventory",
                "op": "update_location",
                "location_id": key,
                "moved": bool(parent_changed),
            },
        )
        return self._locations_by_id[key]

    def _rebucket_items_for_subtree_area_change(self, root_key: str) -> None:
        for loc_id in (root_key, *self._collect_descendant_ids(root_key)):
            eff_area = self.effective_area_id(loc_id)
            for item_id in self._items_by_location_id.get(loc_id, ()):
                self._remove_item_from_all_area_buckets(item_id)
                if eff_area is not None:
                    self._add_to_bucket(self._items_by_area_id, eff_area, item_id)

    def delete_location(self, location_id: str | uuid.UUID) -> None:
        key = str(location_id)
        loc = self.get_location(key)
        if self._children_ids_by_parent_id.get(key):
            raise ValidationError("cannot delete a location that has child locations")
        if self._items_by_location_id.get(key):
            raise ValidationError("cannot delete a location that contains items")

        self._remove_location(loc)
        LOGGER.debug(
            "Location deleted",
            extra={"domain": "haventory", "op": "delete_location", "location_id": key},
        )
        self._rebuild_location_hierarchy_indexes()

    def _encode_cursor(self, payload: dict[str, Any]) -> str:
        raw = json.dumps(payload, separators=(",", ":"))
        return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")

    def _decode_cursor(self, cursor: str) -> dict[str, Any] | None:
        # Bounded before decoding: an unbounded cursor is unbounded work per frame.
        if len(cursor) > CURSOR_MAX_LENGTH:
            return None
        try:
            obj = json.loads(base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8"))
        except ValueError, binascii.Error:
            return None
        return obj if isinstance(obj, dict) else None

    def _tuple_cmp(
        self, a: tuple[int, str | int, str], b: tuple[int, str | int, str], order: str
    ) -> int:
        asc = order == "asc"
        # The low_stock_first group compares ascending whatever the order.
        if a[0] != b[0]:
            return -1 if a[0] < b[0] else 1
        # A forged cursor can mix types; str() keeps the comparison total.
        a1, b1 = a[1], b[1]
        if a1 != b1:
            if isinstance(a1, int) and isinstance(b1, int):
                primary_less = a1 < b1
            else:
                primary_less = str(a1) < str(b1)
            return -1 if (primary_less == asc) else 1
        if a[2] == b[2]:
            return 0
        return -1 if a[2] < b[2] else 1

    def _low_stock_group(self, item: Item) -> int:
        return 0 if item_is_low_stock(item) else 1

    def _paginate(
        self,
        items_sorted: list[Item],
        sort: Sort,
        limit: int,
        cursor: str | None,
        *,
        low_stock_first: bool = False,
    ) -> tuple[list[Item], str | None]:
        start_index = 0
        order = sort.get("order", "desc")

        if cursor:
            # A bad cursor is an error, never a silent restart: page one dressed
            # as "the next page" would loop a paging caller forever.
            cursor_info = self._decode_cursor(cursor)
            if cursor_info is None:
                raise ValidationError("cursor is not a valid pagination cursor")
            cur_sort = (
                cursor_info.get("sort") if isinstance(cursor_info.get("sort"), dict) else None
            )
            if (
                not cur_sort
                or cur_sort.get("field") != sort.get("field")
                or cur_sort.get("order") != sort.get("order")
            ):
                raise ValidationError(
                    "cursor was issued for a different sort; restart pagination without it"
                )
            # low_stock_first reorders the list, so it binds a cursor like the sort.
            if bool(cursor_info.get("low_stock_first", False)) != low_stock_first:
                raise ValidationError(
                    "cursor was issued under a different low_stock_first setting; "
                    "restart pagination without it"
                )
            last_key = cursor_info.get("last_sort_key")
            last_id = cursor_info.get("last_id")
            if (
                not isinstance(last_id, str)
                or isinstance(last_key, bool)
                or not isinstance(last_key, str | int)
            ):
                raise ValidationError("cursor is not a valid pagination cursor")
            last_group = cursor_info.get("last_group", 0) if low_stock_first else 0
            if isinstance(last_group, bool) or last_group not in (0, 1):
                raise ValidationError("cursor is not a valid pagination cursor")
            # The first item strictly after the cursor; none left is an empty page.
            needle: tuple[int, str | int, str] = (last_group, last_key, last_id)
            start_index = len(items_sorted)
            for idx, it in enumerate(items_sorted):
                group = self._low_stock_group(it) if low_stock_first else 0
                tup = (group, sort_value(it, sort), str(it.id))
                if self._tuple_cmp(tup, needle, order) > 0:
                    start_index = idx
                    break

        end_index = min(len(items_sorted), start_index + max(0, limit))
        page = items_sorted[start_index:end_index]

        if not page or end_index >= len(items_sorted):
            return page, None

        last_item = page[-1]
        cursor_payload: dict[str, Any] = {
            "sort": {"field": sort.get("field"), "order": sort.get("order")},
            "last_sort_key": sort_value(last_item, sort),
            "last_id": str(last_item.id),
        }
        if low_stock_first:
            cursor_payload["low_stock_first"] = True
            cursor_payload["last_group"] = self._low_stock_group(last_item)
        return page, self._encode_cursor(cursor_payload)

    def export_state(self) -> dict[str, Any]:
        """The storage payload: ``items``, ``locations`` and ``statuses``, id-keyed.

        ``async_persist_repo`` saves exactly this, so a collection omitted here
        is erased by the next save; ``tests/test_storage_offline.py`` pins that.
        """

        return {
            "items": {key: self._items_by_id[key].to_dict() for key in sorted(self._items_by_id)},
            "locations": {
                key: self._locations_by_id[key].to_dict() for key in sorted(self._locations_by_id)
            },
            "statuses": {
                slug: serialize_status_definition(self._statuses_by_slug[slug])
                for slug in sorted(self._statuses_by_slug)
            },
        }

    def load_state(self, data: dict[str, Any]) -> None:
        """Replace the repository's content with a persisted payload.

        What cannot be read goes into ``last_load_report``, on which setup
        refuses rather than loading a partial dataset over a repairable file.
        """

        self._reset_state()
        # Statuses first, or the tolerant status read would rewrite every item
        # on a custom status to the default.
        self._load_statuses(data.get("statuses"))
        # Locations before items, so items can reference them.
        dropped_location_ids = self._load_rows(
            data.get("locations") or {},
            lambda key, row: self._add_location(Location.from_dict(row, fallback_id=key)),
            op="load_state_locations",
            id_field="location_id",
            what="location",
        )
        known_statuses = self.status_slugs()
        dropped_item_ids = self._load_rows(
            data.get("items") or {},
            lambda key, row: self._index_item(
                Item.from_dict(row, known_statuses=known_statuses, fallback_id=key)
            ),
            op="load_state_items",
            id_field="item_id",
            what="item",
        )
        cycle_members, blocked_below = self._unrooted_location_ids()
        self._last_load_report = LoadReport(
            dropped_item_ids=tuple(dropped_item_ids),
            dropped_location_ids=tuple(dropped_location_ids),
            cyclic_location_ids=cycle_members,
            unrooted_location_ids=blocked_below,
        )
        self._rebuild_location_hierarchy_indexes()

    @staticmethod
    def _load_rows(
        rows: dict[str, Any],
        load: Callable[[str, Any], None],
        *,
        op: str,
        id_field: str,
        what: str,
    ) -> list[str]:
        """Load each row, returning the keys of the rows that could not be read.

        Logged at ERROR: a dropped row is gone from memory and the next save
        would write the store without it.
        """

        dropped: list[str] = []
        for key, row in rows.items():
            try:
                load(str(key), row)
            except AttributeError, TypeError, ValueError, ValidationError:
                if len(dropped) < LOAD_DROP_LOG_LIMIT:
                    LOGGER.error(
                        "Failed to load %s from persisted state",
                        what,
                        extra={"domain": "haventory", "op": op, id_field: str(key)},
                    )
                dropped.append(str(key))
        if len(dropped) > LOAD_DROP_LOG_LIMIT:
            LOGGER.error(
                "Further rows failed to load from persisted state; ids omitted",
                extra={
                    "domain": "haventory",
                    "op": op,
                    "dropped_total": len(dropped),
                    "dropped_logged": LOAD_DROP_LOG_LIMIT,
                },
            )
        return dropped

    def _reset_state(self) -> None:
        """Drop every store and index; the one place the fields are listed."""

        self._items_by_id: dict[str, Item] = {}
        self._locations_by_id: dict[str, Location] = {}
        self._statuses_by_slug: dict[str, StatusDefinition] = seed_status_definitions()

        # Item indexes
        self._tags_to_item_ids: dict[str, set[str]] = {}
        self._category_to_item_ids: dict[str, set[str]] = {}
        # Only non-default statuses are bucketed: "ok" would mirror the item map.
        self._status_to_item_ids: dict[str, set[str]] = {}
        self._checked_out_item_ids: set[str] = set()
        self._low_stock_item_ids: set[str] = set()
        self._items_by_location_id: dict[str, set[str]] = {}
        # Area indexes
        self._locations_by_area_id: dict[str, set[str]] = {}
        self._items_by_area_id: dict[str, set[str]] = {}
        # Location tree indexes
        self._children_ids_by_parent_id: dict[str | None, set[str]] = {}
        # loc_id -> every item id in that subtree
        self._items_in_subtree: dict[str, set[str]] = {}

        self._last_load_report = LoadReport()

    def _load_statuses(self, raw: object) -> None:
        """Read the ``statuses`` collection: the stored map or an export's list.

        An unreadable definition is skipped rather than failing the load, and
        ``ok`` is always re-seeded, since every item falls back to it.
        """

        entries: list[object]
        if isinstance(raw, dict):
            entries = list(raw.values())
        elif isinstance(raw, list):
            entries = list(raw)
        else:
            return

        loaded: dict[str, StatusDefinition] = {}
        for entry in entries:
            try:
                definition = validate_status_definition(entry)
            except ValidationError:
                LOGGER.warning(
                    "Skipping an unreadable status definition",
                    extra={"domain": "haventory", "op": "load_state_statuses"},
                )
                continue
            loaded[definition.slug] = definition

        if loaded:
            self._statuses_by_slug = loaded
        self._statuses_by_slug.setdefault(
            DEFAULT_ITEM_STATUS, seed_status_definitions()[DEFAULT_ITEM_STATUS]
        )

    @staticmethod
    def from_state(data: dict[str, Any]) -> Repository:
        repo = Repository()
        repo.load_state(data)
        return repo
