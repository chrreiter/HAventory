"""Offline tests for item field-type validation at the model/repository boundary.

Regression coverage for the PR #91 review:
- non-scalar category/description are rejected before indexing, so a bad value
  can never leave a durable partially-indexed phantom item;
- boolean quantity/delta/low_stock_threshold are rejected consistently on the
  single-command paths (matching the bulk validator), never stored as a bool.
"""

from __future__ import annotations

from typing import Any

import pytest
from custom_components.haventory.const import DOMAIN
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
from custom_components.haventory.storage import DomainStore
from custom_components.haventory.ws import setup as ws_setup
from homeassistant.core import HomeAssistant

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


def _make_hass() -> HomeAssistant:
    hass = HomeAssistant()
    bucket = hass.data.setdefault(DOMAIN, {})
    bucket["repository"] = Repository()
    bucket["store"] = DomainStore(hass)
    ws_setup(hass)
    return hass


@pytest.mark.asyncio
async def test_ws_create_non_text_category_is_validation_error_no_phantom() -> None:
    hass = _make_hass()
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
    hass = _make_hass()
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
    hass = _make_hass()
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

    An editor saves the whole form, so an untouched over-cap description comes
    back in the update payload — and the edit that trims some of the excess is
    exactly the one a user digging out of it makes first.
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
