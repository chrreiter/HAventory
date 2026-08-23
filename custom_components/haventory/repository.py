"""In-memory repository with indexes and rich operations for HAventory.

This module provides a synchronous repository class that maintains in-memory
indexes for items and locations, implements CRUD, filtering/sorting/pagination,
optimistic concurrency on items, and location subtree rename/move propagation.

The repository is framework-agnostic and designed to be exercised by offline
tests and invoked by service/WebSocket layers.
"""

from __future__ import annotations

import base64
import binascii
import copy
import json
import re
import uuid
from collections import deque
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass, replace
from datetime import date
from typing import Any, NamedTuple, TypedDict

from .calendar_projection import next_occurrence_after
from .exceptions import ConflictError, NotFoundError, ValidationError
from .logs import context_logger
from .models import (
    DEFAULT_ITEM_STATUS,
    EMPTY_LOCATION_PATH,
    LOCATION_GUARD_MAX_STEPS,
    AttachmentMeta,
    Item,
    ItemCreate,
    ItemFilter,
    ItemUpdate,
    Location,
    LocationPath,
    Sort,
    StatusDefinition,
    apply_item_update,
    build_location_path,
    coerce_item_status,
    create_item_from_create,
    date_sort_key,
    filter_items,
    is_canonical_utc_timestamp,
    iso_utc_now,
    item_inspection_is_due,
    item_inspection_is_overdue,
    item_is_due,
    item_is_low_stock,
    item_is_overdue,
    item_reminder_is_due,
    load_attachments,
    load_reminder_anchor,
    load_reminder_interval,
    location_sort_key,
    monotonic_timestamp_after,
    new_uuid4,
    normalize_search_text,
    normalize_tags,
    normalize_text_for_sort,
    parse_uuid4,
    seed_status_definitions,
    selected_categories,
    selected_location_ids,
    serialize_status_definition,
    sort_items,
    today_local_date,
    validate_location_name,
    validate_required_name,
    validate_status_definition,
    validate_status_slug,
)

LOGGER = context_logger(__name__)


class _TextTokens(NamedTuple):
    """Cached text-index tokens for one item, split by source.

    ``base_*`` tokens derive from name/description/category/tags; ``path_*``
    tokens derive from the denormalized ``location_path.display_path``. The
    split lets subtree moves update only the path-derived buckets.
    """

    base_words: frozenset[str]
    path_words: frozenset[str]
    name_prefixes: frozenset[str]
    base_trigrams: frozenset[str]
    path_trigrams: frozenset[str]


class PageResult(TypedDict):
    items: list[Item]
    next_cursor: str | None
    total: int


class InternalIndexes(TypedDict):
    """Live references to the repository's internal indexes (health/tests)."""

    items_by_id: dict[str, Item]
    locations_by_id: dict[str, Location]
    tags_to_item_ids: dict[str, set[str]]
    category_to_item_ids: dict[str, set[str]]
    status_to_item_ids: dict[str, set[str]]
    checked_out_item_ids: set[str]
    low_stock_item_ids: set[str]
    items_by_location_id: dict[str, set[str]]
    locations_by_area_id: dict[str, set[str]]
    items_by_area_id: dict[str, set[str]]


# Sentinel for optional args that distinguish "not provided" from explicit None
UNSET: object = object()

TRIGRAM_MIN_LEN = 3
PREFIX_MIN_LEN = 2

#: Longest pagination cursor this build will even attempt to decode. A cursor is
#: base64 of a small JSON object this repository minted itself, so anything
#: appreciably longer did not come from here.
CURSOR_MAX_LENGTH = 2_048

#: Rows of one kind logged individually before ``load_state`` switches to a total.
#:
#: A drop is per-row, so a wholesale corruption would otherwise emit one ERROR
#: record per row — a store with a thousand broken items buries every other line
#: in the log the user was told to go and read. Enough ids to grep for, then the
#: count, which is the part that says how bad it is.
LOAD_DROP_LOG_LIMIT = 10


def _log_dropped_overflow(op: str, dropped: int) -> None:
    """Report the drops that were counted but not logged individually."""

    if dropped <= LOAD_DROP_LOG_LIMIT:
        return
    LOGGER.error(
        "Further rows failed to load from persisted state; ids omitted",
        extra={
            "domain": "haventory",
            "op": op,
            "dropped_total": dropped,
            "dropped_logged": LOAD_DROP_LOG_LIMIT,
        },
    )


def _coerce_canonical_ts(value: object, *, fallback: str | None = None) -> str:
    """Return a canonical UTC timestamp, backfilling non-canonical input.

    Item timestamps compare lexicographically for sort/range filters, so on
    load any missing / null / corrupt value is replaced with a canonical one
    (the fallback when it is itself canonical, otherwise the current time).
    """
    if isinstance(value, str) and is_canonical_utc_timestamp(value):
        return value
    if fallback is not None and is_canonical_utc_timestamp(fallback):
        return fallback
    return iso_utc_now()


@dataclass(frozen=True)
class LoadReport:
    """What ``load_state`` had to refuse or could not make sense of.

    ``load_state`` coerces where it can — an unknown status, a non-canonical
    timestamp, a missing ``sort_key`` — so an entry reaching one of these tuples
    is structurally broken rather than merely odd. The distinction matters because
    setup refuses on a non-empty report: with the entry loaded, the repo's
    persist-immediately convention means the first mutation rewrites the store
    without the dropped rows, turning a readable corrupt file into a permanent
    loss.

    #225 replaces the refusal with a repairs issue offering "load anyway"; this is
    the payload that flow needs, which is why it carries ids and not just counts.
    """

    dropped_item_ids: tuple[str, ...] = ()
    dropped_location_ids: tuple[str, ...] = ()
    #: Locations whose own ``parent_id`` closes a loop — the entries a repair edits.
    cyclic_location_ids: tuple[str, ...] = ()
    #: Locations left unreachable *because* of those, needing no edit of their own.
    unrooted_location_ids: tuple[str, ...] = ()

    @property
    def has_corruption(self) -> bool:
        """True when the payload held anything this build could not load."""

        return bool(
            self.dropped_item_ids
            or self.dropped_location_ids
            or self.cyclic_location_ids
            or self.unrooted_location_ids
        )


def _parse_reminder_date(value: str, field: str) -> date:
    """Read one of an item's two reminder dates, naming it if it cannot be read.

    Every write path and the import side validate these, so only a hand-edited
    store holds one that fails here — and naming the field beats the
    `unknown_error` a raw parse failure answers a caller with.
    """

    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValidationError(
            f"stored reminder {field} {value!r} is not a date this build can read; "
            "set the reminder again to replace it"
        ) from exc


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
        # Status definitions, keyed by their immutable slug. Seeded with the
        # built-ins, which is also what a store carrying no section means.
        self._statuses_by_slug: dict[str, StatusDefinition] = seed_status_definitions()

        # Item indexes
        self._tags_to_item_ids: dict[str, set[str]] = {}
        self._category_to_item_ids: dict[str, set[str]] = {}
        # Only non-default statuses are bucketed: "ok" is the overwhelming
        # majority, so a bucket for it would mirror the whole item map.
        self._status_to_item_ids: dict[str, set[str]] = {}
        self._checked_out_item_ids: set[str] = set()
        self._low_stock_item_ids: set[str] = set()
        self._items_by_location_id: dict[str, set[str]] = {}
        # Area indexes
        self._locations_by_area_id: dict[str, set[str]] = {}
        self._items_by_area_id: dict[str, set[str]] = {}
        # Cached name sort keys
        self._name_sort_key_by_item_id: dict[str, str] = {}

        # Text Indices
        self._word_to_item_ids: dict[str, set[str]] = {}
        self._name_prefix_to_item_ids: dict[str, set[str]] = {}
        self._trigram_to_item_ids: dict[str, set[str]] = {}
        # Per-item cached tokens so clearing/delta-updating the text indexes
        # never has to re-derive tokens from the item fields.
        self._item_text_tokens: dict[str, _TextTokens] = {}

        # Location tree indexes
        self._children_ids_by_parent_id: dict[str | None, set[str]] = {}

        # Generation counter for optimistic locking and debugging
        self._generation: int = 0

        # Location Hierarchy Indexes (O(1) subtree lookup)
        self._location_descendants: dict[str, set[str]] = {}  # loc_id -> all descendant ids
        self._items_in_subtree: dict[str, set[str]] = {}  # loc_id -> all item ids in subtree

        # What the last load_state could not make sense of; empty on a fresh repo.
        self._last_load_report = LoadReport()

    @property
    def last_load_report(self) -> LoadReport:
        """What the most recent ``load_state`` dropped or found cyclic."""

        return self._last_load_report

    # -----------------------------
    # Public API — Status definitions
    # -----------------------------

    def status_slugs(self) -> frozenset[str]:
        """The live status slugs, for every caller that validates one."""

        return frozenset(self._statuses_by_slug)

    def list_statuses(self) -> list[StatusDefinition]:
        """Status definitions in display order, ties broken by slug."""

        return sorted(self._statuses_by_slug.values(), key=lambda d: (d.order, d.slug))

    def count_items_with_status(self, slug: str) -> int:
        """How many items carry a slug.

        The index buckets only non-default statuses, so the default's population
        is everything not in a bucket — the same arithmetic ``get_counts`` does.
        """

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
        self._increment_generation()
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
        self._increment_generation()
        return definition

    def reorder_statuses(self, slugs: Sequence[str]) -> list[StatusDefinition]:
        """Rewrite display order from a full permutation of the live slugs."""

        if sorted(slugs) != sorted(self._statuses_by_slug):
            raise ValidationError("reorder must name every status exactly once")
        for order, slug in enumerate(slugs):
            self._statuses_by_slug[slug] = replace(self._statuses_by_slug[slug], order=order)
        self._increment_generation()
        return self.list_statuses()

    def delete_status(
        self, slug: str, *, reassign_to: str | None = None
    ) -> tuple[StatusDefinition, list[str]]:
        """Remove a definition, optionally moving the items that carry it.

        Refuses while items still reference the slug unless given somewhere to
        put them: an item whose status names nothing would be coerced to the
        default on the next load, silently. Returns what was removed and the ids
        of the items that moved — the caller announces each of them, so a count
        would leave it re-deriving which ones they were.
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
        self._increment_generation()
        return current, moved

    def _reassign_status(self, slug: str, target: str) -> list[str]:
        """Move every item on ``slug`` to ``target``, as ordinary item edits."""

        # Materialized first: the loop reindexes, which mutates the bucket the
        # ids come from.
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

    # -----------------------------
    # Internal helpers — indexing
    # -----------------------------

    def _increment_generation(self) -> None:
        """Increment generation counter on any state modification.

        The generation counter is used for optimistic locking and debugging
        to track when the repository state has changed.
        """
        self._generation += 1

    def _add_to_bucket(self, bucket: dict[str, set[str]], key: str, item_id: str) -> None:
        bucket.setdefault(key, set()).add(item_id)

    def _remove_from_bucket(self, bucket: dict[str, set[str]], key: str, item_id: str) -> None:
        s = bucket.get(key)
        if not s:
            return
        s.discard(item_id)
        if not s:
            bucket.pop(key, None)

    def _index_item(self, item: Item) -> None:
        item_key = str(item.id)
        self._items_by_id[item_key] = item

        # tags
        for tag in item.tags:
            self._add_to_bucket(self._tags_to_item_ids, tag, item_key)

        # category (case-insensitive)
        cat = (item.category or "").strip().casefold()
        if cat:
            self._add_to_bucket(self._category_to_item_ids, cat, item_key)

        # status (non-default statuses only)
        if item.status != DEFAULT_ITEM_STATUS:
            self._add_to_bucket(self._status_to_item_ids, item.status, item_key)

        # checked_out
        if item.checked_out:
            self._checked_out_item_ids.add(item_key)

        # low stock
        if self._is_low_stock(item):
            self._low_stock_item_ids.add(item_key)

        # location direct membership
        if item.location_id:
            self._add_to_bucket(self._items_by_location_id, str(item.location_id), item_key)

            # area membership (effective area resolved via location ancestry)
            eff_area_id = self.effective_area_id(str(item.location_id))
            if eff_area_id is not None:
                self._add_to_bucket(self._items_by_area_id, eff_area_id, item_key)

        # cached sort key for name
        self._name_sort_key_by_item_id[item_key] = normalize_text_for_sort(item.name)

        # Update subtree index
        self._add_item_to_subtree_index(item)

        # Update text search index
        self._index_item_text(item)

        # Increment generation on state modification
        self._increment_generation()

    def _unindex_item(self, item: Item) -> None:
        # Remove from tag/category/checked/low-stock/location caches
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
            # Remove from any area buckets (area could have changed since indexing)
            self._remove_item_from_all_area_buckets(item_key)

        self._name_sort_key_by_item_id.pop(item_key, None)

        # Remove from subtree index
        self._remove_item_from_subtree_index(item)

        # Remove from text search index
        self._clear_item_text_index(item)

        # Finally, drop from primary store
        self._items_by_id.pop(item_key, None)

        # Increment generation on state modification
        self._increment_generation()

    def _remove_item_from_all_area_buckets(self, item_key: str) -> None:
        # Defensive: remove an item id from every area bucket
        for area_key in list(self._items_by_area_id.keys()):
            s = self._items_by_area_id.get(area_key)
            if not s:
                continue
            s.discard(item_key)
            if not s:
                self._items_by_area_id.pop(area_key, None)

    def effective_area_id(self, location_key: str) -> str | None:
        """Return the area a location sits in, walking ancestors to find it.

        The first non-null ``area_id`` from the node upwards wins; ``None`` when
        no ancestor defines one. Public because it answers a question callers
        outside the repository legitimately have — it is what an item reports as
        ``effective_area_id`` and what an area-filtered client matches on — and
        because a caller must never re-derive it from a location's own
        ``area_id``: a tree keeps its area on the root, so every other node in it
        stores ``None``.
        """

        cursor: str | None = location_key
        guard = 0
        while cursor is not None:
            guard += 1
            if guard > LOCATION_GUARD_MAX_STEPS:  # pragma: no cover - degenerate
                return None
            loc = self._locations_by_id.get(cursor)
            if loc is None:
                return None
            if loc.area_id is not None:
                return str(loc.area_id)
            cursor = str(loc.parent_id) if loc.parent_id is not None else None
        return None

    def _reindex_item_replacement(self, old: Item, new: Item) -> None:
        # Efficiently reindex by removing old and adding new
        self._unindex_item(old)
        self._index_item(new)

    def _is_low_stock(self, item: Item) -> bool:
        return item_is_low_stock(item)

    def _normalize_for_search(self, text: str) -> str:
        """Normalize text for search indexing (lowercase, strip accents).

        Delegates to :func:`models.normalize_search_text` so the index path and the
        ``filter_items`` post-filter always agree on normalization.
        """
        return normalize_search_text(text)

    def _extract_trigrams(self, text: str) -> set[str]:
        """Extract 3-character trigrams from normalized text."""
        if len(text) < TRIGRAM_MIN_LEN:
            return set()
        return {text[i : i + TRIGRAM_MIN_LEN] for i in range(len(text) - (TRIGRAM_MIN_LEN - 1))}

    def _tokenize(self, text: str) -> list[str]:
        """Normalize and split text into indexable words."""
        norm = self._normalize_for_search(text)
        if not norm:
            return []
        return [w for w in re.split(r"[^a-z0-9]", norm) if w]

    def _compute_path_tokens(self, display_path: str) -> tuple[frozenset[str], frozenset[str]]:
        """Return (words, trigrams) derived from a location display path."""
        words = self._tokenize(display_path)
        trigrams: set[str] = set()
        for w in words:
            trigrams |= self._extract_trigrams(w)
        return frozenset(words), frozenset(trigrams)

    def _compute_text_tokens(self, item: Item) -> _TextTokens:
        """Derive the full token record for an item's text indexes."""
        base_words: set[str] = set()
        base_trigrams: set[str] = set()
        for text in (item.name, item.description or "", item.category or "", *item.tags):
            for w in self._tokenize(text):
                base_words.add(w)
                base_trigrams |= self._extract_trigrams(w)

        # Prefixes are indexed per word of the name only.
        name_prefixes: set[str] = set()
        for w in self._tokenize(item.name):
            for i in range(PREFIX_MIN_LEN, len(w) + 1):
                name_prefixes.add(w[:i])

        path_words, path_trigrams = self._compute_path_tokens(item.location_path.display_path)
        return _TextTokens(
            base_words=frozenset(base_words),
            path_words=path_words,
            name_prefixes=frozenset(name_prefixes),
            base_trigrams=frozenset(base_trigrams),
            path_trigrams=path_trigrams,
        )

    def _index_item_text(self, item: Item) -> None:
        """Build text indexes for an item and cache its token record."""
        item_key = str(item.id)
        tokens = self._compute_text_tokens(item)
        self._item_text_tokens[item_key] = tokens

        for prefix in tokens.name_prefixes:
            self._add_to_bucket(self._name_prefix_to_item_ids, prefix, item_key)
        for w in tokens.base_words | tokens.path_words:
            self._add_to_bucket(self._word_to_item_ids, w, item_key)
        for t in tokens.base_trigrams | tokens.path_trigrams:
            self._add_to_bucket(self._trigram_to_item_ids, t, item_key)

    def _clear_item_text_index(self, item: Item) -> None:
        """Remove item from text bucket indexes using its cached tokens."""
        item_key = str(item.id)
        tokens = self._item_text_tokens.pop(item_key, None)
        if tokens is None:  # pragma: no cover - defensive fallback
            tokens = self._compute_text_tokens(item)

        for prefix in tokens.name_prefixes:
            self._remove_from_bucket(self._name_prefix_to_item_ids, prefix, item_key)
        for w in tokens.base_words | tokens.path_words:
            self._remove_from_bucket(self._word_to_item_ids, w, item_key)
        for t in tokens.base_trigrams | tokens.path_trigrams:
            self._remove_from_bucket(self._trigram_to_item_ids, t, item_key)

    def _apply_path_token_delta(
        self,
        item_key: str,
        tokens: _TextTokens,
        new_path_words: frozenset[str],
        new_path_trigrams: frozenset[str],
    ) -> None:
        """Update text buckets for a path-only change using set deltas.

        A bucket entry must exist iff the token is in ``base | path``: a token
        leaving the path is only removed when the base does not also carry it,
        and a token joining the path is only added when the base did not
        already index it.
        """
        for w in tokens.path_words - new_path_words:
            if w not in tokens.base_words:
                self._remove_from_bucket(self._word_to_item_ids, w, item_key)
        for w in new_path_words - tokens.path_words:
            if w not in tokens.base_words:
                self._add_to_bucket(self._word_to_item_ids, w, item_key)

        for t in tokens.path_trigrams - new_path_trigrams:
            if t not in tokens.base_trigrams:
                self._remove_from_bucket(self._trigram_to_item_ids, t, item_key)
        for t in new_path_trigrams - tokens.path_trigrams:
            if t not in tokens.base_trigrams:
                self._add_to_bucket(self._trigram_to_item_ids, t, item_key)

        self._item_text_tokens[item_key] = tokens._replace(
            path_words=new_path_words, path_trigrams=new_path_trigrams
        )

    def _get_candidates_for_word(self, word: str) -> set[str]:
        """Get candidate item IDs for a single search word using strict OR logic."""
        word_candidates = self._word_to_item_ids.get(word)
        prefix_candidates = self._name_prefix_to_item_ids.get(word)

        matches = set()
        if word_candidates:
            matches.update(word_candidates)
        if prefix_candidates:
            matches.update(prefix_candidates)

        if not matches and len(word) >= TRIGRAM_MIN_LEN:
            trigrams = self._extract_trigrams(word)
            if trigrams:
                trigram_candidates: list[set[str]] = []
                for t in trigrams:
                    ts = self._trigram_to_item_ids.get(t)
                    if ts:
                        trigram_candidates.append(ts)

                if trigram_candidates:
                    fuzzy_matches = set(trigram_candidates[0])
                    for other in trigram_candidates[1:]:
                        fuzzy_matches.intersection_update(other)
                    matches.update(fuzzy_matches)

        return matches

    def _text_index_covers_query(self, query: str) -> bool:
        """Return True when the text index can answer ``query`` without false negatives.

        ``_item_matches_q`` matches a query word anywhere inside an item's text,
        mid-word included. The index only reaches that far through trigrams, so a
        word shorter than ``TRIGRAM_MIN_LEN`` is reachable only where it happens to
        start a name word — "wi" finds "Wine" and never "Kiwi". A query with no
        indexable word at all (punctuation only) is outside the index entirely.

        For those queries the index is a lossy filter rather than a pre-filter, and
        callers must let the ``filter_items`` scan answer instead. Tokenizes exactly
        as ``_search_by_text`` does, so the two always agree on the word boundaries
        the judgement is made over.
        """

        words = self._tokenize(query)
        return bool(words) and all(len(w) >= TRIGRAM_MIN_LEN for w in words)

    def _search_by_text(self, query: str) -> set[str]:
        """Return item IDs matching the query using indexes.

        Per query word, candidates come from exact word matches, name-prefix
        matches, and (only when both miss) a trigram fallback — see
        ``_get_candidates_for_word``. Multi-word queries intersect the per-word
        candidate sets.
        """
        norm_query = self._normalize_for_search(query)
        if not norm_query:
            return set()

        # Split into words
        query_words = [w for w in re.split(r"[^a-z0-9]", norm_query) if w]
        if not query_words:
            return set()

        # Strategy: Intersection of candidates for each word
        candidate_sets: list[set[str]] = []

        for word in query_words:
            matches = self._get_candidates_for_word(word)
            if not matches:
                return set()
            candidate_sets.append(matches)

        if not candidate_sets:
            return set()

        result = set(candidate_sets[0])
        for other in candidate_sets[1:]:
            result.intersection_update(other)

        return result

    # -----------------------------
    # Internal helpers — locations
    # -----------------------------

    def _parse_new_parent(
        self, new_parent_id: str | uuid.UUID | object | None, current_parent: uuid.UUID | None
    ) -> tuple[bool, uuid.UUID | None]:
        """Parse a requested new parent and determine if it differs.

        Returns a tuple of (parent_changed, target_parent_id).
        Treats UNSET as no change, None as move to root, and invalid strings as
        an unknown UUID that will fail validation in a subsequent step.
        """

        if new_parent_id is UNSET:
            return False, current_parent
        if new_parent_id is None:
            return (current_parent is not None), None
        if isinstance(new_parent_id, str | uuid.UUID):
            candidate = parse_uuid4(new_parent_id, field_name="new_parent_id")
            return (str(candidate) != str(current_parent)), candidate
        # Unsupported type
        raise ValidationError("new_parent_id must be a UUID v4 string or null")

    def _parse_area_change(
        self, area_id: str | object | None, current_area: str | None
    ) -> tuple[str | None, bool]:
        """Parse the requested area change and return (target_area, area_changed).

        Treats UNSET as no change, None as clear area, and validates a non-empty string.
        """

        if area_id is UNSET:
            return current_area, False
        if area_id is None:
            return None, current_area is not None
        if isinstance(area_id, str):
            candidate = area_id.strip()
            if not candidate:
                raise ValidationError("area_id must be a non-empty string or null")
            return candidate, candidate != (current_area or None)
        raise ValidationError("area_id must be a string or null")

    def _find_location_root(self, location_key: str) -> str:
        """Walk up the parent chain to find the root location id."""
        cursor: str | None = location_key
        root_key = location_key
        guard = 0
        while cursor is not None:
            guard += 1
            if guard > LOCATION_GUARD_MAX_STEPS:  # pragma: no cover - degenerate
                break
            root_key = cursor
            loc = self._locations_by_id.get(cursor)
            if loc is None:
                break
            cursor = str(loc.parent_id) if loc.parent_id is not None else None
        return root_key

    def _propagate_area_to_root(self, location_key: str, area_id: str | None) -> set[str]:
        """Set area on root of tree and clear from all other locations in tree.

        When assigning an area to any location, it propagates to the root.
        All descendants inherit from the root via ``effective_area_id``.

        Returns set of modified location ids.
        """
        root_key = self._find_location_root(location_key)
        modified: set[str] = set()

        # Collect all locations in this tree
        tree_ids = {root_key}
        tree_ids.update(self._collect_descendant_ids(root_key))

        for loc_id in tree_ids:
            loc = self._locations_by_id.get(loc_id)
            if loc is None:
                continue
            old_area = loc.area_id
            new_area = area_id if loc_id == root_key else None
            if old_area != new_area:
                # Update area index
                self._update_location_area_index(
                    location_key=loc_id, old_area=old_area, new_area=new_area
                )
                # Update location
                updated_loc = replace(loc, area_id=new_area)
                self._locations_by_id[loc_id] = updated_loc
                modified.add(loc_id)

        return modified

    def _validate_parent_move(
        self,
        *,
        location_key: str,
        target_parent_id: uuid.UUID | None,
    ) -> None:
        """Validate invariants for a parent change prior to committing it."""

        if target_parent_id is not None and str(target_parent_id) not in self._locations_by_id:
            raise ValidationError("new_parent_id must reference an existing location")
        if str(target_parent_id) == location_key:
            raise ValidationError("cannot move a location under itself")
        descendant_ids = self._collect_descendant_ids(location_key)
        if str(target_parent_id) in descendant_ids:
            raise ValidationError("cannot move a location under one of its descendants")

    def _add_location(self, loc: Location) -> None:
        self._locations_by_id[str(loc.id)] = loc
        parent_key: str | None = str(loc.parent_id) if loc.parent_id is not None else None
        self._children_ids_by_parent_id.setdefault(parent_key, set()).add(str(loc.id))
        # area index (skip None)
        if loc.area_id is not None:
            self._locations_by_area_id.setdefault(str(loc.area_id), set()).add(str(loc.id))

        # Increment generation on state modification
        self._increment_generation()

    def _remove_location(self, loc: Location) -> None:
        self._locations_by_id.pop(str(loc.id), None)
        parent_key: str | None = str(loc.parent_id) if loc.parent_id is not None else None
        children = self._children_ids_by_parent_id.get(parent_key)
        if children is not None:
            children.discard(str(loc.id))
            if not children:
                self._children_ids_by_parent_id.pop(parent_key, None)
        # Remove dedicated children bucket if any
        self._children_ids_by_parent_id.pop(str(loc.id), None)
        # area index
        if loc.area_id is not None:
            s = self._locations_by_area_id.get(str(loc.area_id))
            if s is not None:
                s.discard(str(loc.id))
                if not s:
                    self._locations_by_area_id.pop(str(loc.area_id), None)

        # Increment generation on state modification
        self._increment_generation()

    def _stage_location_update(
        self,
        *,
        loc: Location,
        updated_name: str,
        target_parent_id: uuid.UUID | None,
        parent_changed: bool,
        target_area: str | None,
    ) -> tuple[dict[str, Location], dict[str | None, set[str]], Location]:
        """Create staged maps with the proposed location update applied.

        Returns (staged_locations_by_id, staged_children_by_parent, new_loc).
        """

        staged_locations_by_id: dict[str, Location] = dict(self._locations_by_id)
        staged_children_by_parent: dict[str | None, set[str]] = {
            k: set(v) for k, v in self._children_ids_by_parent_id.items()
        }

        new_loc = replace(loc, name=updated_name, parent_id=target_parent_id, area_id=target_area)
        key = str(loc.id)
        staged_locations_by_id[key] = new_loc

        if parent_changed:
            # Remove from old parent's children in staged map
            old_parent = str(loc.parent_id) if loc.parent_id is not None else None
            if old_parent in staged_children_by_parent:
                staged_children_by_parent[old_parent].discard(key)
                if not staged_children_by_parent[old_parent]:
                    staged_children_by_parent.pop(old_parent)
            # Add to new parent's children bucket in staged map
            parent_key: str | None = str(target_parent_id) if target_parent_id is not None else None
            staged_children_by_parent.setdefault(parent_key, set()).add(key)

        return staged_locations_by_id, staged_children_by_parent, new_loc

    def _update_location_area_index(
        self, *, location_key: str, old_area: str | None, new_area: str | None
    ) -> None:
        """Maintain the locations-by-area index for a single location id."""

        if old_area is not None:
            s = self._locations_by_area_id.get(old_area)
            if s is not None:
                s.discard(location_key)
                if not s:
                    self._locations_by_area_id.pop(old_area, None)
        if new_area is not None:
            self._locations_by_area_id.setdefault(new_area, set()).add(location_key)

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
        """Return list of ancestor location IDs from parent up to root.

        A hand-edited or corrupt store can carry a cyclic ``parent_id`` chain,
        which this walk would otherwise follow forever — during setup, since
        ``load_state`` reaches it once per item. The visited set is what bounds the
        walk to the size of the cycle; the step ceiling its four siblings cite is
        the backstop for a chain that is merely absurdly deep. Breaking rather than
        raising matches ``_find_location_root``, because
        ``_remove_item_from_subtree_index`` walks the same chain on the mutation
        path and must not learn to throw.
        """
        ancestors: list[str] = []
        visited: set[str] = {location_id}
        cursor: str | None = location_id
        guard = 0
        while cursor:
            guard += 1
            if guard > LOCATION_GUARD_MAX_STEPS:  # pragma: no cover - degenerate
                break
            loc = self._locations_by_id.get(cursor)
            if not loc or not loc.parent_id:
                break
            parent_key = str(loc.parent_id)
            if parent_key in visited:
                break
            visited.add(parent_key)
            ancestors.append(parent_key)
            cursor = parent_key
        return ancestors

    def _unrooted_location_ids(self) -> tuple[tuple[str, ...], tuple[str, ...]]:
        """Split the locations that never reach a root into members and descendants.

        Returns ``(cycle_members, blocked_below)``. Only a member's own
        ``parent_id`` closes the loop, so it is the only entry editing can fix;
        everything below it is unreachable purely as a consequence and needs no
        edit of its own. Reporting the two together would name ids whose repair
        changes nothing — and since ids sort arbitrarily, the members can fall
        outside any truncated sample.

        Reported rather than dropped: removing a cyclic location cascades into its
        children and their items, and setup refuses on a corrupt store anyway, so
        nothing is rewritten. One pass with a shared acyclic memo keeps a deep tree
        at O(N) instead of O(N * depth).
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
            # Where in `chain` the loop closes; None means the walk ended at a
            # root or a dangling parent, neither of which is a cycle.
            closes_at: int | None = None
            while cursor is not None:
                if cursor in acyclic:
                    break
                if cursor in depth_of:
                    closes_at = depth_of[cursor]
                    break
                if cursor in unrooted:
                    # Runs into a loop already charted: this whole chain is
                    # blocked, and the members were recorded when it was found.
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

    def _build_load_report(
        self, dropped_item_ids: list[str], dropped_location_ids: list[str]
    ) -> LoadReport:
        """Summarize what the load could not read, closing off the capped logging."""

        _log_dropped_overflow("load_state_items", len(dropped_item_ids))
        _log_dropped_overflow("load_state_locations", len(dropped_location_ids))
        cycle_members, blocked_below = self._unrooted_location_ids()
        return LoadReport(
            dropped_item_ids=tuple(dropped_item_ids),
            dropped_location_ids=tuple(dropped_location_ids),
            cyclic_location_ids=cycle_members,
            unrooted_location_ids=blocked_below,
        )

    def _rebuild_location_hierarchy_indexes(self) -> None:
        """Rebuild location-based hierarchy indexes from scratch."""
        self._location_descendants.clear()
        self._items_in_subtree.clear()

        # Build descendants map
        for loc_id in self._locations_by_id:
            descendants = self._collect_descendant_ids(loc_id)
            if descendants:
                self._location_descendants[loc_id] = descendants

        # Build items in subtree map
        # For each location, gather items from itself and all descendants
        for loc_id in self._locations_by_id:
            subtree_ids = {loc_id}
            if loc_id in self._location_descendants:
                subtree_ids.update(self._location_descendants[loc_id])

            # Aggregate items
            all_items: set[str] = set()
            for sub_id in subtree_ids:
                s = self._items_by_location_id.get(sub_id)
                if s:
                    all_items.update(s)

            if all_items:
                self._items_in_subtree[loc_id] = all_items

    def _add_item_to_subtree_index(self, item: Item) -> None:
        if not item.location_id:
            return

        item_key = str(item.id)
        loc_key = str(item.location_id)

        # Add to direct location
        self._add_to_bucket(self._items_in_subtree, loc_key, item_key)

        # Add to all ancestors
        for anc in self._get_ancestors(loc_key):
            self._add_to_bucket(self._items_in_subtree, anc, item_key)

    def _remove_item_from_subtree_index(self, item: Item) -> None:
        if not item.location_id:
            return

        item_key = str(item.id)
        loc_key = str(item.location_id)

        # Remove from direct location
        self._remove_from_bucket(self._items_in_subtree, loc_key, item_key)

        # Remove from all ancestors
        # Optimization: if we moved the item, we called unindex then index.
        # This naive removal walks up.
        for anc in self._get_ancestors(loc_key):
            self._remove_from_bucket(self._items_in_subtree, anc, item_key)

    def _rebuild_paths_for_subtree(
        self,
        root_id: str,
        *,
        locations_by_id: dict[str, Location] | None = None,
        children_ids_by_parent_id: dict[str | None, set[str]] | None = None,
    ) -> None:
        """Recompute ``Location.path`` for a subtree rooted at ``root_id``.

        If ``locations_by_id`` and/or ``children_ids_by_parent_id`` are provided,
        the computation mutates those maps instead of the repository's live maps.
        """

        loc_map = locations_by_id if locations_by_id is not None else self._locations_by_id
        child_map = (
            children_ids_by_parent_id
            if children_ids_by_parent_id is not None
            else self._children_ids_by_parent_id
        )

        to_fix = [root_id]
        # Collect descendants using the provided child map
        queue = deque([root_id])
        visited: set[str] = set()
        while queue:
            current = queue.popleft()
            for cid in child_map.get(current, set()):
                if cid not in visited:
                    visited.add(cid)
                    to_fix.append(cid)
                    queue.append(cid)

        for loc_id in to_fix:
            loc = loc_map[loc_id]
            # Build chain root->loc by following parent links in the given locations map
            chain: list[Location] = []
            cursor_id: str | None = loc_id
            guard = 0
            while cursor_id is not None:
                guard += 1
                if guard > LOCATION_GUARD_MAX_STEPS:  # defensive; should never happen
                    raise ValidationError("location graph too deep or cyclic")
                node = loc_map.get(cursor_id)
                if node is None:  # pragma: no cover - corrupted map
                    raise ValidationError("location_id must reference an existing location chain")
                chain.append(node)
                cursor_id = str(node.parent_id) if node.parent_id is not None else None
            chain.reverse()
            new_path = build_location_path(chain)
            loc_map[loc_id] = replace(loc, path=new_path)

    def _update_items_location_paths_for_locations(self, affected_location_ids: set[str]) -> None:
        """Refresh ``location_path`` for items under any of the given locations.

        Fast path for subtree renames/moves. All items in one location share
        that location's (already recomputed) ``path``, and only two things
        change per item: the denormalized ``location_path`` and the
        path-derived text tokens. Everything else is either untouched
        (location/category/tag/checkout/low-stock buckets, name sort keys) or
        rebuilt wholesale by the caller via
        ``_rebuild_location_hierarchy_indexes`` (subtree index). The effective
        area is re-resolved once per location and items are re-bucketed only
        when it actually changed.

        ``version`` and ``updated_at`` deliberately stay put. ``location_path``
        is derived from the location tree — no client can write it — so its
        rewrite is not an item mutation: bumping ``version`` here would
        invalidate every optimistic-concurrency token in the subtree, and
        re-stamping ``updated_at`` would shuffle the "recently updated" sort
        with rows nobody touched.
        """

        if not affected_location_ids:
            return

        for loc_id in affected_location_ids:
            item_ids = self._items_by_location_id.get(loc_id)
            if not item_ids:
                continue
            loc = self._locations_by_id.get(loc_id)
            if loc is None:  # pragma: no cover - defensive
                continue

            new_path = loc.path
            new_path_words, new_path_trigrams = self._compute_path_tokens(new_path.display_path)

            # All items of a location live in the same area bucket; probe once.
            item_id_list = list(item_ids)
            probe = item_id_list[0]
            old_area = next(
                (area for area, ids in self._items_by_area_id.items() if probe in ids), None
            )
            new_area = self.effective_area_id(loc_id)
            area_changed = old_area != new_area

            for item_id in item_id_list:
                old_item = self._items_by_id[item_id]
                # copy.copy + attribute writes is measurably cheaper than
                # dataclasses.replace on this hot path.
                updated = copy.copy(old_item)
                updated.location_path = new_path
                self._items_by_id[item_id] = updated

                tokens = self._item_text_tokens.get(item_id)
                if tokens is None:  # pragma: no cover - defensive fallback
                    self._clear_item_text_index(old_item)
                    self._index_item_text(updated)
                else:
                    self._apply_path_token_delta(item_id, tokens, new_path_words, new_path_trigrams)

                if area_changed:
                    if old_area is not None:
                        self._remove_from_bucket(self._items_by_area_id, old_area, item_id)
                    if new_area is not None:
                        self._add_to_bucket(self._items_by_area_id, new_area, item_id)

                self._increment_generation()

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
        # Delegate all validation and normalization to models; always provide
        # the current locations map so location_id can be validated and
        # location_path can be denormalized when present.
        item = create_item_from_create(
            payload,
            locations_by_id=self._locations_by_id,
            known_statuses=self.status_slugs(),
        )
        self._index_item(item)
        return item

    def get_item(self, item_id: str | uuid.UUID) -> Item:
        item = self._items_by_id.get(str(item_id))
        if not item:
            raise NotFoundError("item not found")
        return item

    def update_item(
        self, item_id: str | uuid.UUID, update: ItemUpdate, *, expected_version: int | None = None
    ) -> Item:
        key = str(item_id)
        current = self._items_by_id.get(key)
        if current is None:
            raise NotFoundError("item not found")
        if expected_version is not None and current.version != expected_version:
            raise ConflictError(
                f"version conflict: expected {expected_version}, actual {current.version}"
            )

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
                "item_id": key,
                "old_version": current.version,
                "new_version": updated.version,
            },
        )
        return updated

    def delete_item(self, item_id: str | uuid.UUID, *, expected_version: int | None = None) -> None:
        key = str(item_id)
        current = self._items_by_id.get(key)
        if current is None:
            raise NotFoundError("item not found")
        if expected_version is not None and current.version != expected_version:
            raise ConflictError(
                f"version conflict: expected {expected_version}, actual {current.version}"
            )
        self._unindex_item(current)
        LOGGER.debug(
            "Item deleted",
            extra={"domain": "haventory", "op": "delete_item", "item_id": key},
        )

    def adjust_quantity(
        self, item_id: str | uuid.UUID, delta: int, *, expected_version: int | None = None
    ) -> Item:
        # Reject booleans (an int subclass) so the single-command path matches
        # the bulk validator and never silently treats True/False as +/-1.
        if isinstance(delta, bool) or not isinstance(delta, int):
            raise ValidationError("delta must be an integer")
        current = self.get_item(item_id)
        new_q = int(current.quantity) + delta
        return self.update_item(
            item_id, ItemUpdate(quantity=new_q), expected_version=expected_version
        )

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
        # Validation rules for due_date checked in models
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
        which is the whole reason the anchor is stored: counted from the anchor,
        a series on the 31st returns to the 31st in every month that has one, and
        no occurrence is skipped on the way. Writing back the occurrence as the
        new anchor — which is what one stored date forces — would settle the
        series on the lowest day of month it ever met.

        Counted from the later of the stored occurrence and `today`, so a
        reminder bumped on the day it came round advances by exactly one
        interval, and one nobody bumped for a year lands on its next *future*
        occurrence rather than another date already past. `today` is the
        caller's to supply: it is the household's day, and this module does not
        know what timezone they live in.

        An ordinary item edit otherwise — a new `version`, a new `updated_at`,
        and the same optimistic-concurrency check as every other mutation.
        """

        key = str(item_id)
        current = self._items_by_id.get(key)
        if current is None:
            raise NotFoundError("item not found")
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
        # The next occurrence is always a date the item did not already carry, so
        # `update_item` re-anchored on it, which is what writing a new date means
        # everywhere else. This is the one caller for which it does not.
        self._items_by_id[key] = replace(updated, reminder_anchor=current.reminder_anchor)
        return self._items_by_id[key]

    # -----------------------------
    # Public API — Attachments
    # -----------------------------

    def _replace_attachments(
        self,
        item_id: str | uuid.UUID,
        attachments: list[AttachmentMeta],
        expected_version: int | None,
    ) -> Item:
        """Swap an item's attachment list, as an ordinary versioned item edit.

        Attaching or detaching a file *is* an edit of the item, unlike the
        derived ``location_path``: it bumps ``version`` and ``updated_at`` and
        goes through the same optimistic-concurrency check as every other
        mutation. Not routed through ``apply_item_update``, because
        ``ItemUpdate`` deliberately has no ``attachments`` key — the two
        attachment commands are the only writers.
        """

        key = str(item_id)
        current = self._items_by_id.get(key)
        if current is None:
            raise NotFoundError("item not found")
        if expected_version is not None and current.version != expected_version:
            raise ConflictError(
                f"version conflict: expected {expected_version}, actual {current.version}"
            )

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
        """Append attachment metadata to an item and return the updated item.

        ``max_per_kind`` caps how many of *this* attachment's kind an item may
        carry — enforced here regardless of what the client checked first.

        The position is assigned here rather than taken from ``meta``: order is
        per kind, and adding appends. A caller-supplied ``order`` would leave
        every upload at the default 0, tying with the item's cover and sorting
        the newest picture into the middle of the ones already there.
        """

        current = self.get_item(item_id)
        same_kind = sum(1 for a in current.attachments if a.kind == meta.kind)
        if max_per_kind is not None and same_kind >= max_per_kind:
            raise ValidationError(
                f"item already has {max_per_kind} attachment(s) of kind '{meta.kind}'"
            )
        if any(a.id == meta.id for a in current.attachments):
            raise ValidationError("attachment id is already present on this item")
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
        """Drop one attachment entry, returning the updated item and what went.

        The removed metadata comes back because the caller still has to delete
        the file it names, and nothing else records where that file is.
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
        """Renumber one kind's attachments. Position 0 is the item's cover.

        Order is per kind, so the other kind keeps whatever numbering it had —
        renumbering pictures must not move a manual.
        """

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
        """Every (item id, attachment) pair currently referenced by metadata."""

        for item_key, item in self._items_by_id.items():
            for attachment in item.attachments:
                yield item_key, attachment

    def find_attachment(self, item_id: str, attachment_id: str) -> AttachmentMeta | None:
        """Look one attachment up by both ids, or ``None`` when nothing owns it.

        The media view resolves files through here rather than from the request
        path, so an id no metadata claims never reaches the filesystem.
        """

        item = self._items_by_id.get(item_id)
        if item is None:
            return None
        return next((a for a in item.attachments if str(a.id) == attachment_id), None)

    # -----------------------------
    # Public API — Item querying
    # -----------------------------

    # -----------------------------
    # Internal helpers — query optimization
    # -----------------------------

    def _get_filtered_candidates(self, flt: ItemFilter | None) -> list[Item] | None:  # noqa: PLR0911, PLR0912, PLR0915
        """Return a reduced list of items using indexes, or None if full scan needed.

        Attempt to find the smallest set of candidate items by intersecting
        available indexes (category, tags, location, etc.).
        Returns None if no selective index applies.
        Returns empty list if indexes prove no items match.
        """
        if not flt:
            return None

        candidate_sets: list[set[str]] = []
        has_indexed_filter = False

        # 1. Area Index
        if flt.get("area_id"):
            has_indexed_filter = True
            area_key = str(flt["area_id"]).strip()
            if area_key:
                s = self._items_by_area_id.get(area_key, set())
                if not s:
                    return []
                candidate_sets.append(s)

        # 0. Text Search Index (q)
        # A pre-filter, authoritative only over the queries the index covers
        # (``_text_index_covers_query``). Where it does not, ``q`` contributes no
        # candidate set and the ``filter_items`` post-filter decides on its own —
        # an index miss there means "cannot tell", not "no match".
        q = (flt.get("q") or "").strip()
        if q and self._text_index_covers_query(q):
            has_indexed_filter = True
            text_matches = self._search_by_text(q)
            if not text_matches:
                return []
            candidate_sets.append(text_matches)

        # 2. Location Index
        # A multi-select unions its buckets, the way tags_any does below; the
        # one include_subtree flag picks which index every entry reads from.
        location_keys = [key for key in selected_location_ids(flt) if key]
        if location_keys:
            has_indexed_filter = True
            index = (
                self._items_in_subtree if flt.get("include_subtree") else self._items_by_location_id
            )
            loc_items: set[str] = set()
            for loc_key in location_keys:
                loc_items.update(index.get(loc_key, set()))
            if not loc_items:
                return []
            candidate_sets.append(loc_items)

        # 3. Category Index
        category_keys = selected_categories(flt)
        if category_keys:
            has_indexed_filter = True
            cat_items: set[str] = set()
            for cat_key in category_keys:
                cat_items.update(self._category_to_item_ids.get(cat_key, set()))
            if not cat_items:
                return []
            candidate_sets.append(cat_items)

        # 3b. Status Index (only non-default known statuses are bucketed; "ok"
        # and unrecognized values fall through to the scan path, where
        # filter_items validates and rejects the latter)
        status_filter = flt.get("status")
        if (
            isinstance(status_filter, str)
            and status_filter != DEFAULT_ITEM_STATUS
            and status_filter in self._statuses_by_slug
        ):
            has_indexed_filter = True
            s = self._status_to_item_ids.get(status_filter, set())
            if not s:
                return []
            candidate_sets.append(s)

        # 4. Tags Index (Any)
        # Note: tags_all is harder to optimize purely with single-tag indexes without
        # loading item data or doing complex N-way intersection. For now, we only
        # optimize tags_any which is a union of indexes.
        if flt.get("tags_any"):
            tags = normalize_tags(flt["tags_any"])
            if tags:
                has_indexed_filter = True
                tag_items: set[str] = set()
                for tag in tags:
                    tag_items.update(self._tags_to_item_ids.get(tag, set()))
                if not tag_items:
                    # User asked for tags matching X or Y, but neither exist in index
                    return []
                candidate_sets.append(tag_items)

        # 5. Checked Out Index (only useful for True)
        if flt.get("checked_out") is True:
            has_indexed_filter = True
            s = self._checked_out_item_ids
            if not s:
                return []
            candidate_sets.append(s)

        # 6. Low Stock Index (only useful for True)
        if flt.get("low_stock_only"):
            has_indexed_filter = True
            s = self._low_stock_item_ids
            if not s:
                return []
            candidate_sets.append(s)

        if not has_indexed_filter:
            return None

        # Defensive: with an indexed filter present the loop above either
        # returned early or appended at least one candidate set.
        if not candidate_sets:
            return None

        # Sort by size to intersect smallest sets first (optimization)
        candidate_sets.sort(key=len)

        result_ids = candidate_sets[0]
        for other in candidate_sets[1:]:
            result_ids = result_ids.intersection(other)
            if not result_ids:
                return []

        # Convert back to item objects
        # Filter out any IDs that might have been deleted (defensive against stale indexes)
        return [self._items_by_id[i] for i in result_ids if i in self._items_by_id]

    def list_items(
        self,
        *,
        flt: ItemFilter | None = None,
        sort: Sort | None = None,
        limit: int | None = None,
        cursor: str | None = None,
    ) -> PageResult:
        # Use index-first filtering if possible
        candidates = self._get_filtered_candidates(flt)

        source: Iterable[Item]
        if candidates is not None:
            source = candidates
        else:
            source = self._items_by_id.values()

        filtered = filter_items(source, flt, known_statuses=self.status_slugs())
        sorted_items = sort_items(filtered, sort)
        # Optional preference: group low-stock items first without filtering, while
        # preserving the selected primary ordering within groups (stable sort).
        # The grouping is part of the order the cursor must describe, so it is
        # handed to _paginate rather than left as a local rearrangement.
        low_stock_first = bool(flt and flt.get("low_stock_first"))
        if low_stock_first:
            sorted_items.sort(key=lambda it: not self._is_low_stock(it))

        # Normalize sort for cursor tracking
        if sort is None:
            sort = Sort(field="updated_at", order="desc")

        # The full filtered+sorted list is materialized before slicing, so the
        # total number of matches is already known regardless of pagination.
        total = len(sorted_items)

        if limit is None or limit <= 0:
            # No pagination requested
            return {"items": sorted_items, "next_cursor": None, "total": total}

        page, next_cursor = self._paginate(
            sorted_items, sort, limit, cursor, low_stock_first=low_stock_first
        )
        return {"items": page, "next_cursor": next_cursor, "total": total}

    # -----------------------------
    # Public API — Counts
    # -----------------------------

    @property
    def low_stock_item_ids(self) -> frozenset[str]:
        """The ids currently below their low-stock threshold.

        A snapshot, not a view: the low-stock bus events are a diff of this set
        against the one taken before the mutation, and a caller holding the live
        index would be diffing it against itself.
        """

        return frozenset(self._low_stock_item_ids)

    def get_counts(self) -> dict[str, Any]:
        """Aggregate counts for ``haventory/stats``, ``haventory/health`` and events.

        ``status_counts`` covers every defined slug, including the default one
        the index deliberately does not bucket. The two legacy
        ``missing_count`` / ``needs_repair_count`` keys stay beside it: one
        shape serves all three surfaces, and dropping them would move the card
        in the same release that widens the vocabulary.
        """

        items_with_location = sum(len(ids) for ids in self._items_by_location_id.values())
        flagged_total = sum(len(ids) for ids in self._status_to_item_ids.values())
        status_counts = {
            slug: (
                len(self._items_by_id) - flagged_total
                if slug == DEFAULT_ITEM_STATUS
                else len(self._status_to_item_ids.get(slug, set()))
            )
            for slug in self._statuses_by_slug
        }
        return {
            "items_total": len(self._items_by_id),
            "low_stock_count": len(self._low_stock_item_ids),
            "checked_out_count": len(self._checked_out_item_ids),
            "overdue_count": self._count_overdue(),
            "checked_out_due_count": self._count_checked_out_due(),
            "inspection_overdue_count": self._count_inspection_overdue(),
            "inspection_due_count": self._count_inspection_due(),
            "reminder_due_count": self._count_reminder_due(),
            "missing_count": len(self._status_to_item_ids.get("missing", set())),
            "needs_repair_count": len(self._status_to_item_ids.get("needs_repair", set())),
            "status_counts": status_counts,
            "locations_total": len(self._locations_by_id),
            "no_location_count": len(self._items_by_id) - items_with_location,
        }

    def _count_overdue(self) -> int:
        """Count items whose due date has passed.

        Deliberately not indexed: "overdue" moves with the calendar, so an index
        would go stale at midnight with no mutation to invalidate it. A due date
        only exists on a checked-out item, so the walk is over that set rather
        than the whole inventory.
        """

        today = today_local_date()
        return sum(
            1
            for iid in self._checked_out_item_ids
            if (it := self._items_by_id.get(iid)) is not None and item_is_overdue(it, today=today)
        )

    def _count_checked_out_due(self) -> int:
        """Count items that are due back, today included.

        Unindexed and over the checked-out set, for the same two reasons as
        ``_count_overdue``. This is a superset of it: the two differ by exactly
        the items due back today, the same relation ``_count_inspection_due``
        has to ``_count_inspection_overdue``.
        """

        today = today_local_date()
        return sum(
            1
            for iid in self._checked_out_item_ids
            if (it := self._items_by_id.get(iid)) is not None and item_is_due(it, today=today)
        )

    def _count_inspection_overdue(self) -> int:
        """Count items past the date they were next due for inspection.

        Unindexed for the same reason as ``_count_overdue`` — the answer moves
        with the calendar, and no mutation invalidates it at midnight. The walk
        covers the whole inventory rather than a subset: an inspection date is
        independent of any check-out, so any item can carry one.
        """

        today = today_local_date()
        return sum(
            1 for it in self._items_by_id.values() if item_inspection_is_overdue(it, today=today)
        )

    def _count_inspection_due(self) -> int:
        """Count items whose inspection is being asked for, today included.

        Unindexed for the same reason as the two above. This is a superset of
        ``_count_inspection_overdue``: it walks the same population and the two
        differ by exactly the items whose inspection date is today.
        """

        today = today_local_date()
        return sum(
            1 for it in self._items_by_id.values() if item_inspection_is_due(it, today=today)
        )

    def _count_reminder_due(self) -> int:
        """Count items whose reminder has come round.

        Unindexed for the same reason as the two above, and today counts: a
        reminder names the day it is asking about, so an item reminding today is
        one the household still has to act on.
        """

        today = today_local_date()
        return sum(1 for it in self._items_by_id.values() if item_reminder_is_due(it, today=today))

    def count_matching_by_location(self, flt: ItemFilter | None = None) -> dict[str | None, int]:
        """Count filter matches grouped by the item's own location.

        Keyed by location id, with ``None`` for items that have none. Counts are
        *direct*: callers that want a subtree total roll them up themselves,
        which is what building a tree does anyway. Deliberately does not sort —
        this answers "how many", not "which ones".
        """

        candidates = self._get_filtered_candidates(flt)
        source: Iterable[Item] = (
            candidates if candidates is not None else self._items_by_id.values()
        )
        counts: dict[str | None, int] = {}
        for item in filter_items(source, flt, known_statuses=self.status_slugs()):
            key = str(item.location_id) if item.location_id is not None else None
            counts[key] = counts.get(key, 0) + 1
        return counts

    def get_location_item_counts(self, location_id: str | uuid.UUID) -> dict[str, int]:
        """Return item counts for a location.

        ``direct`` counts items whose ``location_id`` is exactly this location;
        ``subtree`` counts items in this location or any descendant (so
        ``subtree >= direct``).
        """
        key = str(location_id)
        if key not in self._locations_by_id:
            raise NotFoundError("location not found")
        return {
            "direct": len(self._items_by_location_id.get(key, set())),
            "subtree": len(self._items_in_subtree.get(key, set())),
        }

    def _count_facets_matching(self, flt: ItemFilter) -> tuple[dict[str, int], dict[str, int]]:
        """Tally categories and tags over the items a filter keeps.

        One pass prices both facets — the shape ``count_matching_by_location``
        uses for its own dimension. Category keys are the casefolded form
        ``_index_item`` writes, so they line up with ``_category_to_item_ids``;
        tags are normalized at ingress and de-duplicated per item, so each item
        contributes at most one to any tag.
        """

        candidates = self._get_filtered_candidates(flt)
        source: Iterable[Item] = (
            candidates if candidates is not None else self._items_by_id.values()
        )
        by_category: dict[str, int] = {}
        by_tag: dict[str, int] = {}
        for item in filter_items(source, flt, known_statuses=self.status_slugs()):
            key = (item.category or "").strip().casefold()
            if key:
                by_category[key] = by_category.get(key, 0) + 1
            for tag in item.tags:
                by_tag[tag] = by_tag.get(tag, 0) + 1
        return by_category, by_tag

    def get_distinct_field_values(self, flt: ItemFilter | None = None) -> dict[str, object]:
        """Return distinct categories, tags, and custom-field keys.

        Categories are grouped case-insensitively (matching the case-insensitive
        category index); each entry's ``value`` is a representative display label
        — the most frequent original casing among the items using it, ties broken
        alphabetically — and ``count`` is the number of items in that group. Tags
        are already normalized (lowercase) at ingress, so each key maps directly
        to one entry. ``custom_field_keys`` is the sorted, distinct set of keys
        used across all items' ``custom_fields`` (keys are case-sensitive; sorted
        case-insensitively). The two value lists are sorted case-insensitively by
        value.

        With ``flt``, every category and tag entry also carries ``matching_count``
        — how many of that value's items the filter keeps. ``count`` stays a
        whole-inventory figure and no entry is dropped: the same payload feeds
        autocomplete and the organize dialog, which a list that shrank with the
        filter would starve. Which dimensions to leave out of ``flt`` is the
        caller's call, the way it is for :meth:`count_matching_by_location`.
        ``custom_field_keys`` is unfiltered either way — it is a key picker, not
        a tally, and hiding keys would hide ones the user is about to type.
        """

        matching_categories, matching_tags = (
            self._count_facets_matching(flt) if flt is not None else (None, None)
        )

        categories: list[dict[str, object]] = []
        for key, item_ids in self._category_to_item_ids.items():
            originals: dict[str, int] = {}
            for item_id in item_ids:
                item = self._items_by_id.get(item_id)
                if item is None:
                    continue
                raw = (item.category or "").strip()
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

    # -----------------------------
    # Public API — Location operations
    # -----------------------------

    def create_location(
        self,
        *,
        name: str,
        parent_id: str | uuid.UUID | None = None,
        area_id: str | None = None,
    ) -> Location:
        name = validate_location_name(name)
        # Parse/normalize parent id once at ingress using shared helper
        parsed_parent: uuid.UUID | None
        if parent_id is None:
            parsed_parent = None
        else:
            parsed_parent = parse_uuid4(parent_id, field_name="parent_id")
        parent_key = str(parsed_parent) if parsed_parent is not None else None
        if parent_key is not None and parent_key not in self._locations_by_id:
            raise ValidationError("parent_id must reference an existing location")

        parsed_area: str | None
        if area_id is None:
            parsed_area = None
        else:
            candidate = str(area_id).strip()
            if not candidate:
                raise ValidationError("area_id must be a non-empty string or null")
            parsed_area = candidate

        new_id = new_uuid4()
        new_key = str(new_id)
        # Build path using parent chain plus new node
        chain: list[Location] = []
        if parent_key is not None:
            # Build parent chain root->parent
            cursor: str | None = parent_key
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
                cursor = str(node.parent_id) if node.parent_id is not None else None
            lineage.reverse()
            chain.extend(lineage)

        # New locations never store area_id directly - it's always on root
        # Area will be propagated to root after creation if specified
        new_loc = Location(
            id=new_id,
            parent_id=parsed_parent,
            name=name,
            area_id=None,  # Don't set area directly on new location
            path=EMPTY_LOCATION_PATH,
        )
        chain.append(new_loc)
        new_path = build_location_path(chain)
        new_loc = replace(new_loc, path=new_path)

        self._add_location(new_loc)

        # If area_id specified, propagate to root of the tree
        if parsed_area is not None:
            self._propagate_area_to_root(new_key, parsed_area)
            # Re-bucket items for the entire tree
            root_key = self._find_location_root(new_key)
            self._rebucket_items_for_subtree_area_change(root_key)

        LOGGER.debug(
            "Location created",
            extra={"domain": "haventory", "op": "create_location", "location_id": new_id},
        )
        # Return the potentially updated location (if area was propagated)
        self._rebuild_location_hierarchy_indexes()
        return self._locations_by_id[new_key]

    def get_location(self, location_id: str | uuid.UUID) -> Location:
        loc = self._locations_by_id.get(str(location_id))
        if not loc:
            raise NotFoundError("location not found")
        return loc

    def iter_locations(self) -> Iterator[Location]:
        """Every location, in the order the index holds them.

        A view rather than a list: the caller decides whether to sort, and gets
        no copy of the index it could write back into.
        """

        return iter(self._locations_by_id.values())

    def children_of(self, parent_id: str | uuid.UUID | None) -> frozenset[str]:
        """The ids directly under ``parent_id`` — ``None`` asks for the roots.

        Frozen, because the set behind it is the live child index: a caller that
        added to it would move a location without touching a path.
        """

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
        """Update location name and/or move under a new parent.

        Args:
            location_id: Target location ID.
            name: Optional new name.
            new_parent_id: Optional new parent. Pass ``None`` to move to root.
                If omitted entirely (leave default sentinel), parent is unchanged.
            area_id: Optional new area. Propagates to root of location tree.
        """

        key = str(location_id)
        loc = self._locations_by_id.get(key)
        if loc is None:
            raise NotFoundError("location not found")

        # Validate inputs first (no mutation yet)
        updated_name = loc.name
        if name is not None:
            updated_name = validate_location_name(name)

        parent_changed, target_parent_id = self._parse_new_parent(new_parent_id, loc.parent_id)
        # Parse area but don't use target_area directly - we propagate to root
        parsed_area, area_change_requested = self._parse_area_change(area_id, loc.area_id)
        name_changed = updated_name != loc.name

        # Validate move invariants if changing parent
        if parent_changed:
            self._validate_parent_move(location_key=key, target_parent_id=target_parent_id)

        # For staging, don't change area on this location - area propagates to root
        staged_locations_by_id, staged_children_by_parent, _ = self._stage_location_update(
            loc=loc,
            updated_name=updated_name,
            target_parent_id=target_parent_id,
            parent_changed=parent_changed,
            target_area=loc.area_id,  # Keep current area in staging; propagation happens after
        )

        # Attempt to rebuild paths against staged maps; if this fails, nothing is committed
        self._rebuild_paths_for_subtree(
            key,
            locations_by_id=staged_locations_by_id,
            children_ids_by_parent_id=staged_children_by_parent,
        )

        # Commit: swap in staged structures atomically
        self._children_ids_by_parent_id = staged_children_by_parent
        self._locations_by_id = staged_locations_by_id

        # Update affected items (now that live maps are consistent)
        affected = {key}
        affected.update(self._collect_descendant_ids(key))
        # Only rebuild item location_path when the path can actually change:
        # - name change affects display paths
        # - parent change affects ancestry
        if parent_changed or name_changed:
            self._update_items_location_paths_for_locations(affected)

        # Handle area change: propagate to root of tree
        if area_change_requested:
            self._propagate_area_to_root(key, parsed_area)
            # Re-bucket items for the entire tree
            root_key = self._find_location_root(key)
            self._rebucket_items_for_subtree_area_change(root_key)

        # Increment generation on any location state modification
        self._increment_generation()

        LOGGER.debug(
            "Location updated",
            extra={
                "domain": "haventory",
                "op": "update_location",
                "location_id": key,
                "moved": bool(parent_changed),
            },
        )
        self._rebuild_location_hierarchy_indexes()
        return self._locations_by_id[key]

    def _rebucket_items_for_subtree_area_change(self, root_key: str) -> None:
        """Recompute area buckets for items under a location subtree."""

        # Collect all location ids in subtree including root
        loc_ids = {root_key}
        loc_ids.update(self._collect_descendant_ids(root_key))

        # Collect affected item ids
        impacted_item_ids: set[str] = set()
        for loc_id in loc_ids:
            impacted_item_ids.update(self._items_by_location_id.get(loc_id, set()))

        for item_id in impacted_item_ids:
            # Remove from all area buckets then re-add based on current effective area
            self._remove_item_from_all_area_buckets(item_id)
            item = self._items_by_id.get(item_id)
            if item is None or item.location_id is None:
                continue
            eff_area = self.effective_area_id(str(item.location_id))
            if eff_area is not None:
                self._add_to_bucket(self._items_by_area_id, eff_area, item_id)

    def delete_location(self, location_id: str | uuid.UUID) -> None:
        key = str(location_id)
        loc = self._locations_by_id.get(key)
        if loc is None:
            raise NotFoundError("location not found")
        # Cannot delete if there are children
        if self._children_ids_by_parent_id.get(key):
            raise ValidationError("cannot delete a location that has child locations")
        # Cannot delete if any items reference it
        if self._items_by_location_id.get(key):
            raise ValidationError("cannot delete a location that contains items")

        self._remove_location(loc)
        LOGGER.debug(
            "Location deleted",
            extra={"domain": "haventory", "op": "delete_location", "location_id": key},
        )
        self._rebuild_location_hierarchy_indexes()

    # -----------------------------
    # Cursor-based pagination helpers
    # -----------------------------

    def _encode_cursor(self, payload: dict[str, Any]) -> str:
        raw = json.dumps(payload, separators=(",", ":"))
        return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")

    def _decode_cursor(self, cursor: str) -> dict[str, Any] | None:
        # Bounded before decoding: base64 expands to bytes this method then
        # parses as JSON, so an unbounded cursor is unbounded work per frame.
        if len(cursor) > CURSOR_MAX_LENGTH:
            return None
        try:
            raw = base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8")
            obj = json.loads(raw)
            if not isinstance(obj, dict):
                return None
            return obj
        except ValueError, binascii.Error:
            return None

    def _primary_sort_value(self, item: Item, sort: Sort) -> str | int:
        field = sort.get("field")
        order = sort.get("order", "desc")
        if field == "name":
            return self._name_sort_key_by_item_id.get(str(item.id)) or normalize_text_for_sort(
                item.name
            )
        if field == "quantity":
            return int(item.quantity)
        # The three date fields differ only in which date they read, so they are
        # one branch rather than three that would have to be kept in step.
        dates = {
            "due_date": item.due_date,
            "inspection_date": item.inspection_date,
            "reminder_date": item.reminder_date,
        }
        if field in dates:
            return date_sort_key(dates[field], order)
        if field == "location":
            return location_sort_key(item.location_path, order)
        # created_at, or the updated_at default. Canonical fixed-width 'Z'
        # timestamps sort lexicographically, so the stored string is the key.
        return item.created_at if field == "created_at" else item.updated_at

    def _tuple_cmp(
        self, a: tuple[int, str | int, str], b: tuple[int, str | int, str], order: str
    ) -> int:
        asc = order == "asc"
        # group — the low_stock_first block sits in front of the rest whatever
        # the primary order is, so the group compares ascending unconditionally.
        # Without that grouping every item carries group 0 and this is a no-op.
        if a[0] != b[0]:
            return -1 if a[0] < b[0] else 1
        # primary — within one sort field both values share a type; the str()
        # fallback keeps a mixed comparison (corrupt cursor) total instead of
        # raising TypeError.
        a1, b1 = a[1], b[1]
        if a1 != b1:
            if isinstance(a1, int) and isinstance(b1, int):
                primary_less = a1 < b1
            else:
                primary_less = str(a1) < str(b1)
            return -1 if (primary_less == asc) else 1
        # tie-break on id asc
        if a[2] == b[2]:
            return 0
        return -1 if a[2] < b[2] else 1

    def _low_stock_group(self, item: Item) -> int:
        """Which low_stock_first block an item sits in: 0 low-stock, 1 the rest."""
        return 0 if self._is_low_stock(item) else 1

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
            # Every way a cursor can be wrong is an error, never a silent
            # restart: answering an unreadable cursor with page one returns the
            # whole first page dressed as "the next page", and a caller paging
            # through an inventory would loop over it forever without ever
            # being told.
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
            # low_stock_first reorders the list the same way a sort does, so a
            # cursor minted under the other setting describes positions in a
            # list this request is not looking at — refuse it the same way.
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
            # Find first item strictly after the cursor tuple. When nothing
            # compares after it (e.g. the tail was deleted between pages), the
            # page is empty — not page one again.
            needle: tuple[int, str | int, str] = (last_group, last_key, last_id)
            start_index = len(items_sorted)
            for idx, it in enumerate(items_sorted):
                group = self._low_stock_group(it) if low_stock_first else 0
                tup = (group, self._primary_sort_value(it, sort), str(it.id))
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
            "last_sort_key": self._primary_sort_value(last_item, sort),
            "last_id": str(last_item.id),
        }
        if low_stock_first:
            cursor_payload["low_stock_first"] = True
            cursor_payload["last_group"] = self._low_stock_group(last_item)
        return page, self._encode_cursor(cursor_payload)

    # -----------------------------
    # Properties
    # -----------------------------

    @property
    def generation(self) -> int:
        """How many times this process has modified the repository.

        Reported by ``haventory/health`` and the diagnostics dump, and useful for
        telling a snapshot apart from a later one *within one run*. It is not
        stored, so it starts near zero on every boot and says nothing about how
        much the household has changed — the item ``version`` field is the
        persisted counter, and the one optimistic concurrency runs on.
        """
        return self._generation

    # -----------------------------
    # Introspection helpers for tests
    # -----------------------------

    def _debug_get_internal_indexes(self) -> InternalIndexes:
        """Expose live index references for the health command and tests."""
        return {
            "items_by_id": self._items_by_id,
            "locations_by_id": self._locations_by_id,
            "tags_to_item_ids": self._tags_to_item_ids,
            "category_to_item_ids": self._category_to_item_ids,
            "status_to_item_ids": self._status_to_item_ids,
            "checked_out_item_ids": self._checked_out_item_ids,
            "low_stock_item_ids": self._low_stock_item_ids,
            "items_by_location_id": self._items_by_location_id,
            "locations_by_area_id": self._locations_by_area_id,
            "items_by_area_id": self._items_by_area_id,
        }

    # -----------------------------
    # Persistence — export/import
    # -----------------------------

    def export_state(self) -> dict[str, Any]:
        """Serialize the repository to a plain dict for storage.

        Shape:
            {"items": {id -> ItemDict}, "locations": {id -> LocationDict},
             "statuses": {slug -> StatusDict}}

        Every top-level collection the store carries has to appear here:
        ``async_persist_repo`` saves exactly this dict, so a collection this
        method omits is read correctly at boot and erased by the first save
        afterwards. ``tests/test_storage_offline.py`` pins that.
        """

        items_dict: dict[str, Any] = {
            item_id: self._items_by_id[item_id].to_dict()
            for item_id in sorted(self._items_by_id.keys())
        }

        locations_dict: dict[str, Any] = {
            loc_id: self._locations_by_id[loc_id].to_dict()
            for loc_id in sorted(self._locations_by_id.keys())
        }

        statuses_dict: dict[str, Any] = {
            slug: serialize_status_definition(self._statuses_by_slug[slug])
            for slug in sorted(self._statuses_by_slug)
        }

        return {
            "items": items_dict,
            "locations": locations_dict,
            "statuses": statuses_dict,
        }

    def load_state(self, data: dict[str, Any]) -> None:
        """Load repository content from a persisted payload.

        Replaces current maps and rebuilds all indexes deterministically.

        Entries this build cannot make sense of are recorded in
        ``last_load_report`` rather than passed over in silence; setup consults it
        and refuses instead of loading a partial dataset over a repairable file.
        """

        dropped_item_ids: list[str] = []
        dropped_location_ids: list[str] = []

        self._reset_state()

        if not isinstance(data, dict):
            return

        # The generation counter is not restored, and stores written by older
        # builds carry a `_generation` key that is ignored here. It counts this
        # process's mutations for the health command and the diagnostics dump;
        # nothing compares it across a restart, and the item `version` field —
        # which is persisted — is what optimistic concurrency runs on.

        # Statuses BEFORE the item loop, or ``coerce_item_status`` would see
        # only the built-ins and rewrite every item on a custom status to "ok"
        # — silently, on the first restart after the upgrade that added it. An
        # absent or unreadable section means the built-ins, which is what a
        # pre-v6 store carries.
        self._load_statuses(data.get("statuses"))

        # Load locations first so items can reference them
        locations = data.get("locations") or {}
        if isinstance(locations, dict):
            for loc_id, loc_data in locations.items():
                try:
                    path_obj = loc_data.get("path", {}) if isinstance(loc_data, dict) else {}
                    path = LocationPath(
                        id_path=[
                            parse_uuid4(str(x), field_name="path.id_path")
                            for x in list(path_obj.get("id_path", []) or [])
                        ],
                        name_path=list(path_obj.get("name_path", []) or []),
                        display_path=str(path_obj.get("display_path", "")),
                        # Backfill for stores written before sort_key was
                        # persisted (pre-WP4): derive it from display_path.
                        sort_key=str(path_obj.get("sort_key", ""))
                        or normalize_text_for_sort(str(path_obj.get("display_path", ""))),
                    )
                    loc = Location(
                        id=parse_uuid4(str(loc_data.get("id", loc_id)), field_name="location.id"),
                        parent_id=(
                            parse_uuid4(
                                str(loc_data.get("parent_id")), field_name="location.parent_id"
                            )
                            if loc_data.get("parent_id") is not None
                            else None
                        ),
                        # Not `str(...)`: a missing key would read as "" and a
                        # stored `null` as the literal "None", both of them rows
                        # no write path could have produced. Raising here drops
                        # the row into the load report, which is what the
                        # corrupt-store repair is built on.
                        name=validate_required_name(loc_data.get("name")),
                        area_id=(
                            str(loc_data.get("area_id"))
                            if loc_data.get("area_id") is not None
                            else None
                        ),
                        path=path,
                    )
                    self._add_location(loc)
                except (
                    AttributeError,
                    TypeError,
                    ValueError,
                    ValidationError,
                ):
                    # ERROR: the row is gone from memory, and the next save would
                    # write the store without it. Setup refuses on this, so the
                    # file still holds it when the user goes looking.
                    if len(dropped_location_ids) < LOAD_DROP_LOG_LIMIT:
                        LOGGER.error(
                            "Failed to load location from persisted state",
                            extra={
                                "domain": "haventory",
                                "op": "load_state_locations",
                                "location_id": str(loc_id),
                            },
                        )
                    dropped_location_ids.append(str(loc_id))
                    continue

        # Load items
        known_statuses = self.status_slugs()
        items = data.get("items") or {}
        if isinstance(items, dict):
            for item_id, item_data in items.items():
                try:
                    lp = (item_data or {}).get("location_path", {})
                    location_path = LocationPath(
                        id_path=[
                            parse_uuid4(str(x), field_name="location_path.id_path")
                            for x in list(lp.get("id_path", []) or [])
                        ],
                        name_path=list(lp.get("name_path", []) or []),
                        display_path=str(lp.get("display_path", "")),
                        # Backfill for stores written before sort_key was
                        # persisted (pre-WP4): derive it from display_path.
                        sort_key=str(lp.get("sort_key", ""))
                        or normalize_text_for_sort(str(lp.get("display_path", ""))),
                    )
                    item = Item(
                        id=parse_uuid4(str(item_data.get("id", item_id)), field_name="item.id"),
                        # See the location above: an unreadable name is a
                        # corrupt row, not an item called "" or "None".
                        name=validate_required_name(item_data.get("name")),
                        description=item_data.get("description"),
                        quantity=int(item_data.get("quantity", 0)),
                        # Stores written before the field existed carry no
                        # status; they read as the default rather than failing.
                        status=coerce_item_status(
                            item_data.get("status"), known_statuses=known_statuses
                        ),
                        checked_out=bool(item_data.get("checked_out", False)),
                        due_date=item_data.get("due_date"),
                        inspection_date=item_data.get("inspection_date"),
                        # Absent on every store written before v8, and read as
                        # none there — which is exactly what migrate_7_to_8
                        # writes, so the two paths agree. The anchor is the same
                        # story one version later: absent before v9, and equal to
                        # the date for any reminder nobody has bumped.
                        reminder_date=item_data.get("reminder_date"),
                        reminder_anchor=load_reminder_anchor(
                            item_data.get("reminder_anchor"),
                            reminder_date=item_data.get("reminder_date"),
                        ),
                        reminder_interval=load_reminder_interval(
                            item_data.get("reminder_interval")
                        ),
                        location_id=(
                            parse_uuid4(
                                str(item_data.get("location_id")), field_name="item.location_id"
                            )
                            if item_data.get("location_id") is not None
                            else None
                        ),
                        tags=list(item_data.get("tags", []) or []),
                        category=item_data.get("category"),
                        low_stock_threshold=item_data.get("low_stock_threshold"),
                        custom_fields=dict(item_data.get("custom_fields", {}) or {}),
                        # Timestamps compare lexicographically for sort/filter,
                        # so any non-canonical value (missing / null / corrupt /
                        # hand-edited import) is backfilled with a canonical one.
                        created_at=_coerce_canonical_ts(item_data.get("created_at")),
                        updated_at=_coerce_canonical_ts(
                            item_data.get("updated_at"),
                            fallback=_coerce_canonical_ts(item_data.get("created_at")),
                        ),
                        version=int(item_data.get("version", 1)),
                        location_path=location_path,
                        # Tolerant of absence and of a non-list value (both read
                        # as none), but not of a malformed *entry*: dropping one
                        # would lose the only reference to a file on disk, which
                        # the orphan sweep would then delete.
                        attachments=load_attachments(item_data.get("attachments")),
                    )
                    self._index_item(item)
                except (
                    AttributeError,
                    TypeError,
                    ValueError,
                    ValidationError,
                ):
                    # ERROR for the same reason as the location path above.
                    if len(dropped_item_ids) < LOAD_DROP_LOG_LIMIT:
                        LOGGER.error(
                            "Failed to load item from persisted state",
                            extra={
                                "domain": "haventory",
                                "op": "load_state_items",
                                "item_id": str(item_id),
                            },
                        )
                    dropped_item_ids.append(str(item_id))
                    continue

        self._last_load_report = self._build_load_report(dropped_item_ids, dropped_location_ids)

        # Increment generation after load to mark as modified since load
        self._increment_generation()

        # Rebuild location hierarchy indexes ensuring consistency
        self._rebuild_location_hierarchy_indexes()

    def _reset_state(self) -> None:
        """Drop every primary store and index, back to a fresh repository."""

        self._items_by_id = {}
        self._locations_by_id = {}
        self._statuses_by_slug = seed_status_definitions()
        self._tags_to_item_ids = {}
        self._category_to_item_ids = {}
        self._status_to_item_ids = {}
        self._word_to_item_ids = {}
        self._name_prefix_to_item_ids = {}
        self._trigram_to_item_ids = {}
        self._checked_out_item_ids = set()
        self._low_stock_item_ids = set()
        self._items_by_location_id = {}
        self._locations_by_area_id = {}
        self._items_by_area_id = {}
        self._name_sort_key_by_item_id = {}
        self._item_text_tokens = {}
        self._children_ids_by_parent_id = {}
        self._location_descendants = {}
        self._items_in_subtree = {}

    def _load_statuses(self, raw: object) -> None:
        """Read the ``statuses`` collection out of a persisted payload.

        Accepts the stored slug-keyed map and the list form an export document
        carries. Definitions that do not parse are skipped rather than failing
        the load: an unreadable label costs a display string, while refusing the
        whole store over one would take the inventory with it. ``ok`` is
        re-seeded whichever way, because it is the default every item falls back
        to and the value "flagged" is defined against.
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
        """Create a Repository instance from a persisted payload."""

        repo = Repository()
        repo.load_state(data)
        return repo
