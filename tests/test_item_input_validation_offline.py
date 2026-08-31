"""Offline tests for item field-type validation at the model/repository boundary.

Regression coverage for the PR #91 review:
- non-scalar category/description are rejected before indexing, so a bad value
  can never leave a durable partially-indexed phantom item;
- boolean quantity/delta/low_stock_threshold are rejected consistently on the
  single-command paths (matching the bulk validator), never stored as a bool;
- a value the payload is wrong about is refused before the item is looked up, so
  a single-item command and the `items/bulk` row of the same kind answer one
  payload with one code.
"""

from __future__ import annotations

from typing import Any

import pytest
from custom_components.haventory.exceptions import ValidationError
from custom_components.haventory.models import (
    CATEGORY_MAX_LENGTH,
    CUSTOM_FIELD_KEY_MAX_LENGTH,
    CUSTOM_FIELD_VALUE_MAX_LENGTH,
    CUSTOM_FIELDS_MAX_KEYS,
    DESCRIPTION_MAX_LENGTH,
    TAG_MAX_LENGTH,
    TAGS_MAX_COUNT,
    ItemCreate,
    ItemUpdate,
)
from custom_components.haventory.repository import Repository

from runtime_helpers import ws_hass
from ws_helpers import ws_send

# -----------------------------
# Repository / model boundary
# -----------------------------


@pytest.mark.parametrize("bad", [["oops"], {"a": 1}, 5, 1.5])
def test_create_rejects_non_text_category(bad: object) -> None:
    repo = Repository()
    with pytest.raises(ValidationError):
        repo.create_item(ItemCreate(name="Widget", quantity=1, category=bad))
    # No phantom left behind.
    assert repo.get_counts()["items_total"] == 0
    assert repo._items_by_id == {}


@pytest.mark.parametrize("bad", [["oops"], {"a": 1}, 5])
def test_create_rejects_non_text_description(bad: object) -> None:
    repo = Repository()
    with pytest.raises(ValidationError):
        repo.create_item(ItemCreate(name="Widget", quantity=1, description=bad))
    assert repo.get_counts()["items_total"] == 0
    assert repo._items_by_id == {}


def test_update_rejects_non_text_category_without_corrupting_item() -> None:
    repo = Repository()
    item = repo.create_item(ItemCreate(name="Widget", quantity=1, category="tools"))
    with pytest.raises(ValidationError):
        repo.update_item(item.id, ItemUpdate(category=["oops"]))
    # The original item is untouched and still consistent.
    reloaded = repo.get_item(item.id)
    assert reloaded.category == "tools"
    assert reloaded.version == item.version
    res = repo.list_items(flt={"category": "tools"})
    assert [i.id for i in res["items"]] == [item.id]


@pytest.mark.parametrize("bad", [True, False])
def test_quantity_rejects_bool_on_create_and_update(bad: bool) -> None:
    repo = Repository()
    with pytest.raises(ValidationError):
        repo.create_item(ItemCreate(name="Widget", quantity=bad))
    assert repo.get_counts()["items_total"] == 0

    item = repo.create_item(ItemCreate(name="Widget", quantity=1))
    with pytest.raises(ValidationError):
        repo.set_quantity(item.id, bad)
    with pytest.raises(ValidationError):
        repo.adjust_quantity(item.id, bad)
    # quantity is unchanged and a real int.
    got = repo.get_item(item.id).quantity
    assert got == 1
    assert type(got) is int


def test_low_stock_threshold_rejects_bool() -> None:
    repo = Repository()
    with pytest.raises(ValidationError):
        repo.create_item(ItemCreate(name="Widget", quantity=1, low_stock_threshold=True))
    item = repo.create_item(ItemCreate(name="Widget", quantity=1))
    with pytest.raises(ValidationError):
        repo.update_item(item.id, ItemUpdate(low_stock_threshold=True))


# -----------------------------
# WS surface (phantom-free, validation_error)
# -----------------------------


@pytest.mark.asyncio
async def test_ws_create_non_text_category_is_validation_error_no_phantom() -> None:
    hass = ws_hass()
    res = await ws_send(hass, 1, "haventory/item/create", name="Widget", category=["oops"])
    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"
    # Nothing was indexed or counted.
    stats = await ws_send(hass, 2, "haventory/stats")
    assert stats["result"]["items_total"] == 0
    listed = await ws_send(hass, 3, "haventory/item/list")
    assert listed["result"]["items"] == []


@pytest.mark.asyncio
async def test_ws_set_quantity_bool_is_validation_error() -> None:
    hass = ws_hass()
    created = await ws_send(hass, 1, "haventory/item/create", name="Widget", quantity=1)
    item_id = created["result"]["id"]

    res = await ws_send(hass, 2, "haventory/item/set_quantity", item_id=item_id, quantity=True)
    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"

    res = await ws_send(hass, 3, "haventory/item/adjust_quantity", item_id=item_id, delta=True)
    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"

    # Quantity is still the int we created with.
    got = await ws_send(hass, 4, "haventory/item/get", item_id=item_id)
    assert got["result"]["quantity"] == 1
    assert got["result"]["quantity"] is not True


@pytest.mark.asyncio
async def test_a_refused_quantity_answers_alike_from_the_command_and_from_bulk() -> None:
    """The value is checked before the item is looked up, on both surfaces.

    A payload that is wrong about the quantity *and* names an item that is not
    there has two possible answers, and a caller that batches its edits must not
    get a different one from the one it gets when it sends them singly.
    """

    hass = ws_hass()
    missing = "00000000-0000-4000-8000-000000000000"

    single = await ws_send(hass, 1, "haventory/item/set_quantity", item_id=missing, quantity=-1)
    batch = await ws_send(
        hass,
        2,
        "haventory/items/bulk",
        operations=[
            {
                "op_id": "a",
                "kind": "item_set_quantity",
                "payload": {"item_id": missing, "quantity": -1},
            }
        ],
    )

    assert single["success"] is False
    assert single["error"]["code"] == "validation_error"
    row = batch["result"]["results"]["a"]
    assert row["success"] is False
    assert row["error"]["code"] == single["error"]["code"]
    assert row["error"]["message"] == single["error"]["message"]


@pytest.mark.asyncio
async def test_an_item_id_of_the_wrong_type_names_the_field_on_both_surfaces() -> None:
    """`item_id` is typed `object` in the schema, so the handler is what names it.

    A number where an id belongs is a client bug, and `not_found` sends its
    author looking for a missing item instead.
    """

    hass = ws_hass()

    single = await ws_send(hass, 1, "haventory/item/update", item_id=7, name="X")
    batch = await ws_send(
        hass,
        2,
        "haventory/items/bulk",
        operations=[{"op_id": "a", "kind": "item_update", "payload": {"item_id": 7, "name": "X"}}],
    )

    assert single["success"] is False
    assert single["error"]["code"] == "validation_error"
    row = batch["result"]["results"]["a"]
    assert row["success"] is False
    assert row["error"]["code"] == single["error"]["code"]
    assert row["error"]["message"] == single["error"]["message"]


#: Every field a caller writes as a whole collection, under the command that
#: takes it. Each is typed `object` in its schema, so the refusal is the model's
#: and names the field the caller sent.
COLLECTION_FIELDS = [
    ("haventory/item/create", "tags"),
    ("haventory/item/create", "custom_fields"),
    ("haventory/item/update", "tags"),
    ("haventory/item/update", "custom_fields_set"),
    ("haventory/item/update", "custom_fields_unset"),
    ("haventory/item/add_tags", "tags"),
    ("haventory/item/remove_tags", "tags"),
    ("haventory/item/update_custom_fields", "set"),
    ("haventory/item/update_custom_fields", "unset"),
    ("haventory/item/attachment/reorder", "attachment_ids"),
    ("haventory/status/reorder", "slugs"),
]


@pytest.mark.asyncio
@pytest.mark.parametrize(("command", "field"), COLLECTION_FIELDS)
async def test_a_collection_field_given_a_bare_string_is_a_validation_error(
    command: str, field: str
) -> None:
    """A bare string is the case that matters, on every command that takes one.

    Iterating a string yields its characters, so `tags: "kitchen"` would store
    seven one-letter tags and `slugs: "ok"` would reorder by two. The answer is
    the same code and the caller's own field name whichever command carried it.
    """

    hass = ws_hass()
    created = await ws_send(hass, 1, "haventory/item/create", name="Widget", tags=["alpha"])
    item_id = created["result"]["id"]

    payload: dict[str, Any] = {field: "oops"}
    if command == "haventory/item/create":
        payload["name"] = "Chisel"
    elif command.startswith("haventory/item/"):
        payload["item_id"] = item_id
    if command.endswith("/attachment/reorder"):
        payload["kind"] = "picture"

    res = await ws_send(hass, 2, command, **payload)

    assert res["success"] is False, res
    assert res["error"]["code"] == "validation_error", res
    assert res["error"]["message"].startswith(f"{field} must be "), res

    # Nothing was written: not the item this ran against, and no second one.
    unchanged = await ws_send(hass, 3, "haventory/item/get", item_id=item_id)
    assert unchanged["result"]["tags"] == ["alpha"]
    assert unchanged["result"]["custom_fields"] == {}
    assert unchanged["result"]["version"] == 1
    stats = await ws_send(hass, 4, "haventory/stats")
    assert stats["result"]["items_total"] == 1


@pytest.mark.asyncio
async def test_a_reorder_still_refuses_a_list_naming_one_member_twice() -> None:
    """The type check must not de-duplicate on the way past.

    Both reorder commands take a permutation of a set they can read for
    themselves, so a list naming one member twice is a client bug — and
    normalizing it into a valid permutation would hide it.
    """

    hass = ws_hass()

    res = await ws_send(hass, 1, "haventory/status/reorder", slugs=["ok", "ok", "missing"])

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"
    assert res["error"]["message"] == "reorder must name every status exactly once"


# -----------------------------
# Size caps (one case at each boundary, one over)
# -----------------------------


@pytest.mark.parametrize(
    ("field", "at_cap", "over_cap"),
    [
        (
            "description",
            {"description": "d" * DESCRIPTION_MAX_LENGTH},
            {"description": "d" * (DESCRIPTION_MAX_LENGTH + 1)},
        ),
        (
            "category",
            {"category": "c" * CATEGORY_MAX_LENGTH},
            {"category": "c" * (CATEGORY_MAX_LENGTH + 1)},
        ),
        (
            "tag length",
            {"tags": ["t" * TAG_MAX_LENGTH]},
            {"tags": ["t" * (TAG_MAX_LENGTH + 1)]},
        ),
        (
            "tag count",
            {"tags": [f"t{i}" for i in range(TAGS_MAX_COUNT)]},
            {"tags": [f"t{i}" for i in range(TAGS_MAX_COUNT + 1)]},
        ),
        (
            "custom field count",
            {"custom_fields": {f"k{i}": i for i in range(CUSTOM_FIELDS_MAX_KEYS)}},
            {"custom_fields": {f"k{i}": i for i in range(CUSTOM_FIELDS_MAX_KEYS + 1)}},
        ),
        (
            "custom field key length",
            {"custom_fields": {"k" * CUSTOM_FIELD_KEY_MAX_LENGTH: 1}},
            {"custom_fields": {"k" * (CUSTOM_FIELD_KEY_MAX_LENGTH + 1): 1}},
        ),
        (
            "custom field value length",
            {"custom_fields": {"k": "v" * CUSTOM_FIELD_VALUE_MAX_LENGTH}},
            {"custom_fields": {"k": "v" * (CUSTOM_FIELD_VALUE_MAX_LENGTH + 1)}},
        ),
    ],
)
def test_create_accepts_at_the_cap_and_refuses_over_it(
    field: str, at_cap: dict[str, Any], over_cap: dict[str, Any]
) -> None:
    repo = Repository()
    repo.create_item(ItemCreate(name="Widget", **at_cap))  # type: ignore[typeddict-item]
    assert repo.get_counts()["items_total"] == 1, field

    with pytest.raises(ValidationError):
        repo.create_item(ItemCreate(name="Widget", **over_cap))  # type: ignore[typeddict-item]
    # No phantom left behind: the item at the cap is still the only one.
    assert repo.get_counts()["items_total"] == 1, field


@pytest.mark.asyncio
async def test_ws_create_over_a_cap_is_validation_error_no_phantom() -> None:
    hass = ws_hass()
    res = await ws_send(
        hass,
        1,
        "haventory/item/create",
        name="Widget",
        description="d" * (DESCRIPTION_MAX_LENGTH + 1),
    )
    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"
    listed = await ws_send(hass, 2, "haventory/item/list")
    assert listed["result"]["items"] == []


def test_an_item_over_a_cap_can_still_be_edited_down() -> None:
    """The caps refuse growth, not every edit on an item that predates them.

    An item written before the caps existed reaches the repository through
    ``load_state``, which does not re-validate. The edit that removes the excess
    must not be refused along with the edit that would add to it.
    """

    repo = Repository()
    item = repo.create_item(ItemCreate(name="Widget"))
    # Reach past the write path the way a pre-cap store would have.
    stored = repo._items_by_id[str(item.id)]
    stored.tags = [f"t{i}" for i in range(TAGS_MAX_COUNT + 10)]
    stored.custom_fields = {f"k{i}": i for i in range(CUSTOM_FIELDS_MAX_KEYS + 10)}

    kept_tags = 5
    unset_keys = 20

    trimmed = repo.update_item(item.id, ItemUpdate(tags=stored.tags[:kept_tags]))
    assert len(trimmed.tags) == kept_tags

    unset = repo.update_item(
        item.id, ItemUpdate(custom_fields_unset=[f"k{i}" for i in range(unset_keys)])
    )
    assert len(unset.custom_fields) == CUSTOM_FIELDS_MAX_KEYS + 10 - unset_keys


def test_an_item_over_the_custom_field_cap_may_not_grow_further() -> None:
    repo = Repository()
    item = repo.create_item(ItemCreate(name="Widget"))
    repo._items_by_id[str(item.id)].custom_fields = {
        f"k{i}": i for i in range(CUSTOM_FIELDS_MAX_KEYS + 1)
    }

    with pytest.raises(ValidationError):
        repo.update_item(item.id, ItemUpdate(custom_fields_set={"one_more": 1}))


def test_a_pre_cap_description_may_be_resent_or_trimmed_but_not_grown() -> None:
    """Issue #437: the growth rule covers the scalar caps, not just the collections.

    A client that hands an item back whole re-sends the over-cap description it
    read, and the edit that trims some of the excess is exactly the one a user
    digging out of it makes first. Both have to be accepted; only growth is
    refused.
    """

    legacy = "d" * (DESCRIPTION_MAX_LENGTH + 500)
    repo = Repository()
    item = repo.create_item(ItemCreate(name="Widget"))
    repo._items_by_id[str(item.id)].description = legacy

    # Resending the stored value unchanged is not growth.
    same = repo.update_item(item.id, ItemUpdate(description=legacy))
    assert same.description == legacy

    # Neither is trimming that leaves it over the cap.
    shorter = legacy[:-200]
    trimmed = repo.update_item(item.id, ItemUpdate(description=shorter))
    assert trimmed.description == shorter

    # Growing it past what is stored is what the cap refuses.
    with pytest.raises(ValidationError):
        repo.update_item(item.id, ItemUpdate(description=shorter + "x"))


def test_a_pre_cap_category_follows_the_same_growth_rule() -> None:
    legacy = "c" * (CATEGORY_MAX_LENGTH + 30)
    repo = Repository()
    item = repo.create_item(ItemCreate(name="Widget"))
    repo._items_by_id[str(item.id)].category = legacy

    kept = repo.update_item(item.id, ItemUpdate(category=legacy))
    assert kept.category == legacy
    with pytest.raises(ValidationError):
        repo.update_item(item.id, ItemUpdate(category=legacy + "x"))


def test_pre_cap_custom_field_values_and_keys_are_grandfathered() -> None:
    """A stored over-cap value or key may be resent or shrunk, never lengthened."""

    long_key = "k" * (CUSTOM_FIELD_KEY_MAX_LENGTH + 8)
    long_value = "v" * (CUSTOM_FIELD_VALUE_MAX_LENGTH + 300)
    repo = Repository()
    item = repo.create_item(ItemCreate(name="Widget"))
    repo._items_by_id[str(item.id)].custom_fields = {long_key: long_value}

    # The editor resends the whole map: stored key and value pass unchanged.
    same = repo.update_item(item.id, ItemUpdate(custom_fields_set={long_key: long_value}))
    assert same.custom_fields == {long_key: long_value}

    # Shrinking an over-cap value is allowed; growing it is refused.
    shorter = long_value[:-100]
    trimmed = repo.update_item(item.id, ItemUpdate(custom_fields_set={long_key: shorter}))
    assert trimmed.custom_fields[long_key] == shorter
    with pytest.raises(ValidationError):
        repo.update_item(item.id, ItemUpdate(custom_fields_set={long_key: shorter + "x"}))

    # A key the item never carried is still held to the key cap.
    with pytest.raises(ValidationError):
        repo.update_item(
            item.id, ItemUpdate(custom_fields_set={"n" * (CUSTOM_FIELD_KEY_MAX_LENGTH + 1): 1})
        )


def test_a_pre_cap_custom_field_map_may_be_resent_wholesale() -> None:
    """A full-form save of a 60-key legacy item is not a request to grow it."""

    legacy_fields = {f"k{i}": i for i in range(CUSTOM_FIELDS_MAX_KEYS + 10)}
    repo = Repository()
    item = repo.create_item(ItemCreate(name="Widget"))
    repo._items_by_id[str(item.id)].custom_fields = dict(legacy_fields)

    same = repo.update_item(item.id, ItemUpdate(custom_fields_set=dict(legacy_fields)))
    assert len(same.custom_fields) == CUSTOM_FIELDS_MAX_KEYS + 10

    with pytest.raises(ValidationError):
        repo.update_item(item.id, ItemUpdate(custom_fields_set={**legacy_fields, "one_more": 1}))
