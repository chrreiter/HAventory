"""Cursor pagination over an item list the caller has already sorted.

A cursor is base64 of a small JSON object naming the sort, the low-stock grouping
and the last item's sort key and id, and the next page starts at the first item
strictly after that position. A cursor is client input: one that is too long,
does not decode, or was minted under another sort or grouping is refused, never
read as page one, because a paging client would loop.
"""

from __future__ import annotations

import base64
import json
from typing import Any, TypedDict

from .exceptions import ValidationError
from .models import Item
from .query import Sort, item_is_low_stock, sort_value


class PageResult(TypedDict):
    items: list[Item]
    next_cursor: str | None
    total: int


#: A cursor is base64 of a small JSON object minted here; nothing longer is decoded.
CURSOR_MAX_LENGTH = 2_048


def _encode_cursor(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, separators=(",", ":"))
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")


def _decode_cursor(cursor: str) -> dict[str, Any] | None:
    # Bounded before decoding: an unbounded cursor is unbounded work per frame.
    if len(cursor) > CURSOR_MAX_LENGTH:
        return None
    try:
        obj = json.loads(base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8"))
    except ValueError:
        return None
    return obj if isinstance(obj, dict) else None


def _tuple_cmp(a: tuple[int, str | int, str], b: tuple[int, str | int, str], order: str) -> int:
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


def _low_stock_group(item: Item) -> int:
    return 0 if item_is_low_stock(item) else 1


def paginate(
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
        cursor_info = _decode_cursor(cursor)
        if cursor_info is None:
            raise ValidationError("cursor is not a valid pagination cursor")
        cur_sort = cursor_info.get("sort") if isinstance(cursor_info.get("sort"), dict) else None
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
            group = _low_stock_group(it) if low_stock_first else 0
            tup = (group, sort_value(it, sort), str(it.id))
            if _tuple_cmp(tup, needle, order) > 0:
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
        cursor_payload["last_group"] = _low_stock_group(last_item)
    return page, _encode_cursor(cursor_payload)
