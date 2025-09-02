"""In-memory repository with indexes and rich operations for HAventory.

This module provides a synchronous repository class that maintains in-memory
indexes for items and locations, implements CRUD, filtering/sorting/pagination,
optimistic concurrency on items, and location subtree rename/move propagation.

The repository is framework-agnostic and designed to be exercised by offline
tests and invoked by service/WebSocket layers.
"""

from __future__ import annotations

import base64
import json
import logging
from collections.abc import Iterable
from dataclasses import replace
from typing import TypedDict

from .exceptions import ConflictError, NotFoundError, ValidationError
from .models import (
    EMPTY_LOCATION_PATH,
    Item,
    ItemCreate,
    ItemFilter,
    ItemUpdate,
    Location,
    Sort,
    apply_item_update,
    build_location_path,
    create_item_from_create,
    filter_items,
    new_uuid4_str,
    normalize_text_for_sort,
    sort_items,
)

LOGGER = logging.getLogger(__name__)


class PageResult(TypedDict):
    items: list[Item]
    next_cursor: str | None


# Sentinel for optional args that distinguish "not provided" from explicit None
UNSET: object = object()

# Lint-friendly constants
LOCATION_GUARD_MAX_STEPS: int = 10_000
NAME_MAX_LENGTH_CONST: int = 120


class Repository:
    """In-memory repository maintaining indexes and providing operations.

    Notes:
        - Only items carry a ``version`` for optimistic concurrency in Phase 1.
        - Location changes that affect denormalized item ``location_path``
          will update impacted items via ``apply_item_update`` to increment
          their version and ``updated_at`` timestamps.
    """

    # -----------------------------
    # Lifecycle
    # -----------------------------

    def __init__(self) -> None:
        # Primary stores
        self._items_by_id: dict[str, Item] = {}
        self._locations_by_id: dict[str, Location] = {}

        # Item indexes
        self._tags_to_item_ids: dict[str, set[str]] = {}
        self._category_to_item_ids: dict[str, set[str]] = {}
        self._checked_out_item_ids: set[str] = set()
        self._low_stock_item_ids: set[str] = set()
        self._items_by_location_id: dict[str, set[str]] = {}
        # Optional timestamp buckets (not used for ordering, but kept as indexes)
        self._created_at_bucket: dict[str, set[str]] = {}
        self._updated_at_bucket: dict[str, set[str]] = {}
        # Cached name sort keys
        self._name_sort_key_by_item_id: dict[str, str] = {}

        # Location tree indexes
        self._children_ids_by_parent_id: dict[str | None, set[str]] = {}
        # No instance-level sentinel needed; use module-level UNSET

    # -----------------------------
    # Internal helpers — indexing
    # -----------------------------

    def _add_to_bucket(self, bucket: dict[str, set[str]], key: str, item_id: str) -> None:
        if key not in bucket:
            bucket[key] = set()
        bucket[key].add(item_id)

    def _remove_from_bucket(self, bucket: dict[str, set[str]], key: str, item_id: str) -> None:
        s = bucket.get(key)
        if not s:
            return
        s.discard(item_id)
        if not s:
            bucket.pop(key, None)

    def _index_item(self, item: Item) -> None:
        self._items_by_id[item.id] = item

        # tags
        for tag in item.tags:
            self._add_to_bucket(self._tags_to_item_ids, tag, item.id)

        # category (case-insensitive)
        cat = (item.category or "").strip().casefold()
        if cat:
            self._add_to_bucket(self._category_to_item_ids, cat, item.id)

        # checked_out
        if item.checked_out:
            self._checked_out_item_ids.add(item.id)

        # low stock
        if self._is_low_stock(item):
            self._low_stock_item_ids.add(item.id)

        # location direct membership
        if item.location_id:
            self._add_to_bucket(self._items_by_location_id, item.location_id, item.id)

        # timestamp buckets
        self._add_to_bucket(self._created_at_bucket, item.created_at, item.id)
        self._add_to_bucket(self._updated_at_bucket, item.updated_at, item.id)

        # cached sort key for name
        self._name_sort_key_by_item_id[item.id] = normalize_text_for_sort(item.name)

    def _unindex_item(self, item: Item) -> None:
        # Remove from tag/category/checked/low-stock/location/timestamp caches
        for tag in item.tags:
            self._remove_from_bucket(self._tags_to_item_ids, tag, item.id)

        cat = (item.category or "").strip().casefold()
        if cat:
            self._remove_from_bucket(self._category_to_item_ids, cat, item.id)

        self._checked_out_item_ids.discard(item.id)
        self._low_stock_item_ids.discard(item.id)

        if item.location_id:
            self._remove_from_bucket(self._items_by_location_id, item.location_id, item.id)

        self._remove_from_bucket(self._created_at_bucket, item.created_at, item.id)
        self._remove_from_bucket(self._updated_at_bucket, item.updated_at, item.id)

        self._name_sort_key_by_item_id.pop(item.id, None)

        # Finally, drop from primary store
        self._items_by_id.pop(item.id, None)

    def _reindex_item_replacement(self, old: Item, new: Item) -> None:
        # Efficiently reindex by removing old and adding new
        self._unindex_item(old)
        self._index_item(new)

    def _is_low_stock(self, item: Item) -> bool:
        thr = item.low_stock_threshold
        if thr is None:
            return False
        return item.quantity <= int(thr)

    # -----------------------------
    # Internal helpers — locations
    # -----------------------------

    def _add_location(self, loc: Location) -> None:
        self._locations_by_id[loc.id] = loc
        parent_key: str | None = loc.parent_id
        if parent_key not in self._children_ids_by_parent_id:
            self._children_ids_by_parent_id[parent_key] = set()
        self._children_ids_by_parent_id[parent_key].add(loc.id)

    def _remove_location(self, loc: Location) -> None:
        self._locations_by_id.pop(loc.id, None)
        parent_key: str | None = loc.parent_id
        children = self._children_ids_by_parent_id.get(parent_key)
        if children is not None:
            children.discard(loc.id)
            if not children:
                self._children_ids_by_parent_id.pop(parent_key, None)
        # Remove dedicated children bucket if any
        self._children_ids_by_parent_id.pop(loc.id, None)

    def _collect_descendant_ids(self, root_id: str) -> set[str]:
        """Collect all descendant location IDs (excluding the root itself)."""

        result: set[str] = set()
        queue: list[str] = [root_id]
        while queue:
            current = queue.pop(0)
            for child_id in self._children_ids_by_parent_id.get(current, set()):
                if child_id not in result:
                    result.add(child_id)
                    queue.append(child_id)
        return result

    def _rebuild_paths_for_subtree(self, root_id: str) -> None:
        """Recompute ``Location.path`` for a subtree rooted at ``root_id``."""

        to_fix = [root_id, *self._collect_descendant_ids(root_id)]
        for loc_id in to_fix:
            loc = self._locations_by_id[loc_id]
            # Build chain root->loc by following parent links
            chain: list[Location] = []
            cursor_id: str | None = loc_id
            guard = 0
            while cursor_id is not None:
                guard += 1
                if guard > LOCATION_GUARD_MAX_STEPS:  # defensive; should never happen
                    raise ValidationError("location graph too deep or cyclic")
                node = self._locations_by_id.get(cursor_id)
                if node is None:  # pragma: no cover - corrupted map
                    raise ValidationError("location_id must reference an existing location chain")
                chain.append(node)
                cursor_id = node.parent_id
            chain.reverse()
            new_path = build_location_path(chain)
            self._locations_by_id[loc_id] = replace(loc, path=new_path)

    def _update_items_location_paths_for_locations(self, affected_location_ids: set[str]) -> None:
        """Refresh ``location_path`` for items under any of the given locations.

        Uses ``apply_item_update`` with a no-op ``location_id`` to increment
        item versions and updated_at while recomputing the denormalized path.
        """

        if not affected_location_ids:
            return

        impacted_item_ids: set[str] = set()
        for loc_id in affected_location_ids:
            impacted_item_ids.update(self._items_by_location_id.get(loc_id, set()))

        for item_id in impacted_item_ids:
            old_item = self._items_by_id[item_id]
            # Force recomputation of location_path by "updating" location_id to itself
            updated = apply_item_update(
                old_item,
                ItemUpdate(location_id=old_item.location_id),
                locations_by_id=self._locations_by_id,
            )
            self._reindex_item_replacement(old_item, updated)

    # -----------------------------
    # Public API — Item operations
    # -----------------------------

    def create_item(self, payload: ItemCreate) -> Item:
        item = self._create_item_internal(payload)
        LOGGER.debug(
            "Item created",
            extra={"domain": "haventory", "op": "create_item", "item_id": item.id},
        )
        return item

    def _create_item_internal(self, payload: ItemCreate) -> Item:
        item = self._safe_create_item(payload)
        self._index_item(item)
        return item

    def _safe_create_item(self, payload: ItemCreate) -> Item:
        # Provide location map so validation and denormalization can occur
        item = None
        if payload.get("location_id"):
            item = self._create_item_with_locations(payload)
        else:
            item = self._create_item_without_locations(payload)
        assert item is not None
        return item

    def _create_item_without_locations(self, payload: ItemCreate) -> Item:
        # Fast path: no location validation required
        return create_item_from_create(payload)

    def _create_item_with_locations(self, payload: ItemCreate) -> Item:
        return create_item_from_create(payload, locations_by_id=self._locations_by_id)

    def get_item(self, item_id: str) -> Item:
        item = self._items_by_id.get(item_id)
        if not item:
            raise NotFoundError("item not found")
        return item

    def update_item(
        self, item_id: str, update: ItemUpdate, *, expected_version: int | None = None
    ) -> Item:
        current = self._items_by_id.get(item_id)
        if current is None:
            raise NotFoundError("item not found")
        if expected_version is not None and current.version != expected_version:
            raise ConflictError(
                f"version conflict: expected {expected_version}, actual {current.version}"
            )

        updated = apply_item_update(current, update, locations_by_id=self._locations_by_id)
        self._reindex_item_replacement(current, updated)
        LOGGER.debug(
            "Item updated",
            extra={
                "domain": "haventory",
                "op": "update_item",
                "item_id": item_id,
                "old_version": current.version,
                "new_version": updated.version,
            },
        )
        return updated

    def delete_item(self, item_id: str, *, expected_version: int | None = None) -> None:
        current = self._items_by_id.get(item_id)
        if current is None:
            raise NotFoundError("item not found")
        if expected_version is not None and current.version != expected_version:
            raise ConflictError(
                f"version conflict: expected {expected_version}, actual {current.version}"
            )
        self._unindex_item(current)
        LOGGER.debug(
            "Item deleted",
            extra={"domain": "haventory", "op": "delete_item", "item_id": item_id},
        )

    def adjust_quantity(
        self, item_id: str, delta: int, *, expected_version: int | None = None
    ) -> Item:
        current = self.get_item(item_id)
        new_q = int(current.quantity) + int(delta)
        if new_q < 0:
            raise ValidationError("quantity cannot be negative")
        return self.update_item(
            item_id, ItemUpdate(quantity=new_q), expected_version=expected_version
        )

    def set_quantity(
        self, item_id: str, quantity: int, *, expected_version: int | None = None
    ) -> Item:
        if not isinstance(quantity, int) or quantity < 0:
            raise ValidationError("quantity must be an integer >= 0")
        return self.update_item(
            item_id, ItemUpdate(quantity=quantity), expected_version=expected_version
        )

    def check_out(
        self, item_id: str, *, due_date: str, expected_version: int | None = None
    ) -> Item:
        # Validation rules for due_date checked in models
        return self.update_item(
            item_id,
            ItemUpdate(checked_out=True, due_date=due_date),
            expected_version=expected_version,
        )

    def check_in(self, item_id: str, *, expected_version: int | None = None) -> Item:
        return self.update_item(
            item_id,
            ItemUpdate(checked_out=False, due_date=None),
            expected_version=expected_version,
        )

    # -----------------------------
    # Public API — Item querying
    # -----------------------------

    def list_items(
        self,
        *,
        flt: ItemFilter | None = None,
        sort: Sort | None = None,
        limit: int | None = None,
        cursor: str | None = None,
    ) -> PageResult:
        source: Iterable[Item] = self._items_by_id.values()
        filtered = filter_items(source, flt)
        sorted_items = sort_items(filtered, sort)

        # Normalize sort for cursor tracking
        if sort is None:
            sort = Sort(field="updated_at", order="desc")  # type: ignore[assignment]

        if limit is None or limit <= 0:
            # No pagination requested
            return {"items": sorted_items, "next_cursor": None}

        page, next_cursor = self._paginate(sorted_items, sort, limit, cursor)
        return {"items": page, "next_cursor": next_cursor}

    # -----------------------------
    # Public API — Counts
    # -----------------------------

    def get_counts(self) -> dict[str, int]:
        return {
            "items_total": len(self._items_by_id),
            "low_stock_count": len(self._low_stock_item_ids),
            "checked_out_count": len(self._checked_out_item_ids),
            "locations_total": len(self._locations_by_id),
        }

    # -----------------------------
    # Public API — Location operations
    # -----------------------------

    def create_location(self, *, name: str, parent_id: str | None = None) -> Location:
        self._validate_location_name(name)
        if parent_id is not None and parent_id not in self._locations_by_id:
            raise ValidationError("parent_id must reference an existing location")

        new_id = new_uuid4_str()
        # Build path using parent chain plus new node
        chain: list[Location] = []
        if parent_id is not None:
            # Build parent chain root->parent
            cursor: str | None = parent_id
            guard = 0
            lineage: list[Location] = []
            while cursor is not None:
                guard += 1
                if guard > LOCATION_GUARD_MAX_STEPS:  # pragma: no cover - degenerate
                    raise ValidationError("location graph too deep or cyclic")
                node = self._locations_by_id.get(cursor)
                if node is None:
                    raise ValidationError("parent_id must reference an existing location")
                lineage.append(node)
                cursor = node.parent_id
            lineage.reverse()
            chain.extend(lineage)
        new_loc = Location(id=new_id, parent_id=parent_id, name=name, path=EMPTY_LOCATION_PATH)
        chain.append(new_loc)
        new_path = build_location_path(chain)
        new_loc = replace(new_loc, path=new_path)

        self._add_location(new_loc)
        LOGGER.debug(
            "Location created",
            extra={"domain": "haventory", "op": "create_location", "location_id": new_id},
        )
        return new_loc

    def get_location(self, location_id: str) -> Location:
        loc = self._locations_by_id.get(location_id)
        if not loc:
            raise NotFoundError("location not found")
        return loc

    def update_location(
        self,
        location_id: str,
        *,
        name: str | None = None,
        new_parent_id: str | None | object = UNSET,
    ) -> Location:
        """Update location name and/or move under a new parent.

        Args:
            location_id: Target location ID.
            name: Optional new name.
            new_parent_id: Optional new parent. Pass ``None`` to move to root.
                If omitted entirely (leave default sentinel), parent is unchanged.
        """

        loc = self._locations_by_id.get(location_id)
        if loc is None:
            raise NotFoundError("location not found")

        # Validate inputs first (no mutation yet)
        updated_name = loc.name
        if name is not None:
            self._validate_location_name(name)
            updated_name = name

        parent_changed = False
        target_parent_id = loc.parent_id
        # Treat None as a valid explicit value (move to root) and use sentinel for "not provided"
        if new_parent_id is not None and new_parent_id is not UNSET:
            parent_changed = new_parent_id != loc.parent_id
            target_parent_id = new_parent_id  # type: ignore[assignment]
        elif new_parent_id is None and new_parent_id is not UNSET:
            # Explicit move to root
            parent_changed = loc.parent_id is not None
            target_parent_id = None

        # Validate move invariants if changing parent
        if parent_changed:
            if target_parent_id is not None and target_parent_id not in self._locations_by_id:
                raise ValidationError("new_parent_id must reference an existing location")
            if target_parent_id == location_id:
                raise ValidationError("cannot move a location under itself")
            # Cannot move under a descendant
            descendant_ids = self._collect_descendant_ids(location_id)
            if target_parent_id in descendant_ids:
                raise ValidationError("cannot move a location under one of its descendants")

        # All validations passed — perform updates
        new_loc = replace(loc, name=updated_name, parent_id=target_parent_id)

        # Update parent->children mapping if needed
        if parent_changed:
            # Remove from old parent's children
            old_parent = loc.parent_id
            if old_parent in self._children_ids_by_parent_id:
                self._children_ids_by_parent_id[old_parent].discard(loc.id)
                if not self._children_ids_by_parent_id[old_parent]:
                    self._children_ids_by_parent_id.pop(old_parent)
            # Add to new parent's children bucket
            parent_key: str | None = target_parent_id
            if parent_key not in self._children_ids_by_parent_id:
                self._children_ids_by_parent_id[parent_key] = set()
            self._children_ids_by_parent_id[parent_key].add(loc.id)

        # Save the updated location (path will be rebuilt next)
        self._locations_by_id[location_id] = new_loc

        # Rebuild paths for this subtree and update affected items
        self._rebuild_paths_for_subtree(location_id)
        affected = {location_id}
        affected.update(self._collect_descendant_ids(location_id))
        self._update_items_location_paths_for_locations(affected)

        LOGGER.debug(
            "Location updated",
            extra={
                "domain": "haventory",
                "op": "update_location",
                "location_id": location_id,
                "moved": bool(parent_changed),
            },
        )
        return self._locations_by_id[location_id]

    def delete_location(self, location_id: str) -> None:
        loc = self._locations_by_id.get(location_id)
        if loc is None:
            raise NotFoundError("location not found")
        # Cannot delete if there are children
        if self._children_ids_by_parent_id.get(location_id):
            raise ValidationError("cannot delete a location that has child locations")
        # Cannot delete if any items reference it
        if self._items_by_location_id.get(location_id):
            raise ValidationError("cannot delete a location that contains items")

        self._remove_location(loc)
        LOGGER.debug(
            "Location deleted",
            extra={"domain": "haventory", "op": "delete_location", "location_id": location_id},
        )

    # -----------------------------
    # Cursor-based pagination helpers
    # -----------------------------

    def _encode_cursor(self, payload: dict) -> str:
        raw = json.dumps(payload, separators=(",", ":"))
        return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")

    def _decode_cursor(self, cursor: str) -> dict | None:
        try:
            raw = base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8")
            obj = json.loads(raw)
            if not isinstance(obj, dict):
                return None
            return obj
        except Exception:  # pragma: no cover - defensive
            return None

    def _primary_sort_value(self, item: Item, sort: Sort) -> str | int:
        field = sort.get("field")
        if field == "name":
            return self._name_sort_key_by_item_id.get(item.id) or normalize_text_for_sort(item.name)
        if field == "quantity":
            return int(item.quantity)
        if field == "created_at":
            return item.created_at
        # default / updated_at
        return item.updated_at

    def _tuple_cmp(self, a: tuple[str | int, str], b: tuple[str | int, str], order: str) -> int:
        asc = order == "asc"
        # primary
        if a[0] != b[0]:
            return -1 if ((a[0] < b[0]) == asc) else 1
        # tie-break on id asc
        if a[1] == b[1]:
            return 0
        return -1 if a[1] < b[1] else 1

    def _paginate(
        self, items_sorted: list[Item], sort: Sort, limit: int, cursor: str | None
    ) -> tuple[list[Item], str | None]:
        start_index = 0
        order = sort.get("order", "desc")
        cursor_info = self._decode_cursor(cursor) if cursor else None

        if cursor_info is not None:
            cur_sort = (
                cursor_info.get("sort") if isinstance(cursor_info.get("sort"), dict) else None
            )
            # If sort differs, ignore the cursor to avoid inconsistency
            if (
                cur_sort
                and cur_sort.get("field") == sort.get("field")
                and cur_sort.get("order") == sort.get("order")
            ):
                last_key = cursor_info.get("last_sort_key")
                last_id = cursor_info.get("last_id")
                if last_id is not None:
                    # Find first item strictly after the cursor tuple
                    needle = (last_key, last_id)
                    for idx, it in enumerate(items_sorted):
                        tup = (self._primary_sort_value(it, sort), it.id)
                        if self._tuple_cmp(tup, needle, order) > 0:
                            start_index = idx
                            break

        end_index = min(len(items_sorted), start_index + max(0, limit))
        page = items_sorted[start_index:end_index]

        if not page or end_index >= len(items_sorted):
            return page, None

        last_item = page[-1]
        cursor_payload = {
            "sort": {"field": sort.get("field"), "order": sort.get("order")},
            "last_sort_key": self._primary_sort_value(last_item, sort),
            "last_id": last_item.id,
        }
        return page, self._encode_cursor(cursor_payload)

    # -----------------------------
    # Validation helpers
    # -----------------------------

    def _validate_location_name(self, name: str) -> None:
        if not isinstance(name, str) or len(name.strip()) == 0:
            raise ValidationError("name is required and must be a non-empty string")
        # Align with models.NAME_MAX_LENGTH without importing constant to avoid cycles
        if len(name) > NAME_MAX_LENGTH_CONST:
            raise ValidationError("name must be at most 120 characters")

    # -----------------------------
    # Introspection helpers for tests
    # -----------------------------

    def _debug_get_internal_indexes(
        self,
    ) -> dict[str, object]:  # pragma: no cover - test helper only
        return {
            "items_by_id": self._items_by_id,
            "locations_by_id": self._locations_by_id,
            "tags_to_item_ids": self._tags_to_item_ids,
            "category_to_item_ids": self._category_to_item_ids,
            "checked_out_item_ids": self._checked_out_item_ids,
            "low_stock_item_ids": self._low_stock_item_ids,
            "items_by_location_id": self._items_by_location_id,
            "created_at_bucket": self._created_at_bucket,
            "updated_at_bucket": self._updated_at_bucket,
        }
