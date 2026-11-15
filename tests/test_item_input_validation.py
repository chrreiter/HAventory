"""Item field-type and size validation at the model and repository boundary.

A non-scalar category or description, a boolean quantity or threshold, and a value
over a cap are refused before anything is stored. An item that predates a cap
loads as it was written, may be resent or trimmed, and is refused only growth.
The WebSocket side is rows in `tests/integration/test_ws_items.py`.
"""

from __future__ import annotations

from typing import Any

import pytest
from custom_components.haventory.exceptions import ValidationError
from custom_components.haventory.item_writes import ItemCreate, ItemUpdate
from custom_components.haventory.repository import Repository
from custom_components.haventory.validation import (
    CATEGORY_MAX_LENGTH,
    CUSTOM_FIELD_KEY_MAX_LENGTH,
    CUSTOM_FIELD_VALUE_MAX_LENGTH,
    CUSTOM_FIELDS_MAX_KEYS,
    DESCRIPTION_MAX_LENGTH,
    TAG_MAX_LENGTH,
    TAGS_MAX_COUNT,
)


def _repo_with_legacy_item(**stored_fields: Any) -> tuple[Repository, str]:
    """A repository holding one item whose stored row carries values no write could now make.

    Loading does not re-validate, so this is how a store written before a cap reads.
    """

    repo = Repository()
    item = repo.create_item(ItemCreate(name="Widget"))
    state = repo.export_state()
    state["items"][str(item.id)].update(stored_fields)
    return Repository.from_state(state), str(item.id)


@pytest.mark.parametrize("field", ["category", "description"])
@pytest.mark.parametrize("bad", [["oops"], {"a": 1}, 5])
def test_create_rejects_non_text_category_and_description(field: str, bad: object) -> None:
    repo = Repository()
    with pytest.raises(ValidationError):
        repo.create_item(ItemCreate(name="Widget", quantity=1, **{field: bad}))  # type: ignore[misc]
    # No phantom left behind.
    assert repo.get_counts()["items_total"] == 0


def test_update_rejects_non_text_category_without_corrupting_item() -> None:
    repo = Repository()
    item = repo.create_item(ItemCreate(name="Widget", quantity=1, category="tools"))
    with pytest.raises(ValidationError):
        repo.update_item(item.id, ItemUpdate(category=["oops"]))  # type: ignore[typeddict-item]
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


def test_an_item_over_a_cap_can_still_be_edited_down() -> None:
    """The caps refuse growth, not every edit on an item that predates them."""

    legacy_tags = [f"t{i}" for i in range(TAGS_MAX_COUNT + 10)]
    legacy_fields = {f"k{i}": i for i in range(CUSTOM_FIELDS_MAX_KEYS + 10)}
    repo, item_id = _repo_with_legacy_item(tags=legacy_tags, custom_fields=legacy_fields)

    kept_tags = 5
    unset_keys = 20

    trimmed = repo.update_item(item_id, ItemUpdate(tags=legacy_tags[:kept_tags]))
    assert len(trimmed.tags) == kept_tags

    unset = repo.update_item(
        item_id, ItemUpdate(custom_fields_unset=[f"k{i}" for i in range(unset_keys)])
    )
    assert len(unset.custom_fields) == CUSTOM_FIELDS_MAX_KEYS + 10 - unset_keys


def test_an_item_over_the_custom_field_cap_may_not_grow_further() -> None:
    repo, item_id = _repo_with_legacy_item(
        custom_fields={f"k{i}": i for i in range(CUSTOM_FIELDS_MAX_KEYS + 1)}
    )

    with pytest.raises(ValidationError):
        repo.update_item(item_id, ItemUpdate(custom_fields_set={"one_more": 1}))


def test_a_pre_cap_description_may_be_resent_or_trimmed_but_not_grown() -> None:
    """The growth rule covers the scalar caps too.

    A client that hands an item back whole re-sends the over-cap description it
    read, and trimming some of the excess is the first edit a user digging out of
    it makes. Both are accepted; only growth is refused.
    """

    legacy = "d" * (DESCRIPTION_MAX_LENGTH + 500)
    repo, item_id = _repo_with_legacy_item(description=legacy)

    # Resending the stored value unchanged is not growth.
    same = repo.update_item(item_id, ItemUpdate(description=legacy))
    assert same.description == legacy

    # Neither is trimming that leaves it over the cap.
    shorter = legacy[:-200]
    trimmed = repo.update_item(item_id, ItemUpdate(description=shorter))
    assert trimmed.description == shorter

    with pytest.raises(ValidationError):
        repo.update_item(item_id, ItemUpdate(description=shorter + "x"))


def test_a_pre_cap_category_follows_the_same_growth_rule() -> None:
    legacy = "c" * (CATEGORY_MAX_LENGTH + 30)
    repo, item_id = _repo_with_legacy_item(category=legacy)

    kept = repo.update_item(item_id, ItemUpdate(category=legacy))
    assert kept.category == legacy
    with pytest.raises(ValidationError):
        repo.update_item(item_id, ItemUpdate(category=legacy + "x"))


def test_pre_cap_custom_field_values_and_keys_are_grandfathered() -> None:
    """A stored over-cap value or key may be resent or shrunk, never lengthened."""

    long_key = "k" * (CUSTOM_FIELD_KEY_MAX_LENGTH + 8)
    long_value = "v" * (CUSTOM_FIELD_VALUE_MAX_LENGTH + 300)
    repo, item_id = _repo_with_legacy_item(custom_fields={long_key: long_value})

    # The editor resends the whole map: stored key and value pass unchanged.
    same = repo.update_item(item_id, ItemUpdate(custom_fields_set={long_key: long_value}))
    assert same.custom_fields == {long_key: long_value}

    # Shrinking an over-cap value is allowed; growing it is refused.
    shorter = long_value[:-100]
    trimmed = repo.update_item(item_id, ItemUpdate(custom_fields_set={long_key: shorter}))
    assert trimmed.custom_fields[long_key] == shorter
    with pytest.raises(ValidationError):
        repo.update_item(item_id, ItemUpdate(custom_fields_set={long_key: shorter + "x"}))

    # A key the item never carried is still held to the key cap.
    with pytest.raises(ValidationError):
        repo.update_item(
            item_id, ItemUpdate(custom_fields_set={"n" * (CUSTOM_FIELD_KEY_MAX_LENGTH + 1): 1})
        )


def test_a_pre_cap_custom_field_map_may_be_resent_wholesale() -> None:
    """A full-form save of a legacy item with too many keys is not a request to grow it."""

    legacy_fields = {f"k{i}": i for i in range(CUSTOM_FIELDS_MAX_KEYS + 10)}
    repo, item_id = _repo_with_legacy_item(custom_fields=dict(legacy_fields))

    same = repo.update_item(item_id, ItemUpdate(custom_fields_set=dict(legacy_fields)))
    assert len(same.custom_fields) == CUSTOM_FIELDS_MAX_KEYS + 10

    with pytest.raises(ValidationError):
        repo.update_item(item_id, ItemUpdate(custom_fields_set={**legacy_fields, "one_more": 1}))
