"""The denormalized location path, derived from the location tree.

Items and locations both carry a ``LocationPath`` built here from the chain of
parents. ``walk_location_chain`` ends quietly on a missing parent or a loop,
because a corrupt store can contain one and the item index walks chains on every
write. ``location_chain_to_root`` is the one that refuses, so no path is stored
with its leading names missing.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator, Mapping

from .exceptions import ValidationError
from .models import Location, LocationPath
from .text import normalize_text_for_sort


def walk_location_chain(
    start_id: str | uuid.UUID, *, locations_by_id: Mapping[str, Location]
) -> Iterator[Location]:
    """Yield the locations from ``start_id`` upwards, the node itself first.

    Ends without raising on a parent id no location carries and on an id it has
    already yielded, because a corrupt store can close a chain into a loop and
    the item index walks it on every mutation. :func:`location_chain_to_root`
    is the version that refuses a short chain.
    """

    cursor: str | None = str(start_id)
    seen: set[str] = set()
    while cursor is not None and cursor not in seen:
        location = locations_by_id.get(cursor)
        if location is None:
            return
        seen.add(cursor)
        yield location
        cursor = str(location.parent_id) if location.parent_id is not None else None


def location_chain_to_root(
    leaf_id: str | uuid.UUID, *, locations_by_id: Mapping[str, Location]
) -> list[Location]:
    """The chain root→leaf, refused when it does not reach a root.

    A partial chain would store a display path missing its leading names.
    """

    chain = list(walk_location_chain(leaf_id, locations_by_id=locations_by_id))
    if not chain:
        raise ValidationError("location_id must reference an existing location")
    last_parent = chain[-1].parent_id
    if last_parent is not None:
        if str(last_parent) in {str(node.id) for node in chain}:
            raise ValidationError("location graph too deep or cyclic")
        raise ValidationError("location_id must reference an existing location chain")
    chain.reverse()
    return chain


def build_location_path(location_chain: list[Location]) -> LocationPath:
    """Build a denormalized LocationPath from a chain ordered root->leaf."""

    name_path = tuple(loc.name for loc in location_chain)
    display = " / ".join(name_path)
    return LocationPath(
        id_path=tuple(loc.id for loc in location_chain),
        name_path=name_path,
        display_path=display,
        sort_key=normalize_text_for_sort(display),
    )


def build_location_path_from_map(
    leaf_location_id: str | uuid.UUID, *, locations_by_id: Mapping[str, Location]
) -> LocationPath:
    """The path of one location, refused when its chain does not reach a root."""

    return build_location_path(
        location_chain_to_root(leaf_location_id, locations_by_id=locations_by_id)
    )
