"""Pure tests of the schema migration driver: plain dicts in, plain dicts out."""

from __future__ import annotations

from copy import deepcopy

import pytest
from custom_components.haventory.exceptions import SchemaDowngradeError, StorageError
from custom_components.haventory.migrations import migrate
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION


def test_noop_when_already_current_and_idempotent() -> None:
    """A current-version payload is preserved, and a second pass changes nothing."""

    payload = {"schema_version": CURRENT_SCHEMA_VERSION, "items": {}, "locations": {}}

    migrated1 = migrate(
        payload,
        from_version=CURRENT_SCHEMA_VERSION,
        to_version=CURRENT_SCHEMA_VERSION,
    )
    migrated2 = migrate(
        migrated1,
        from_version=CURRENT_SCHEMA_VERSION,
        to_version=CURRENT_SCHEMA_VERSION,
    )

    assert migrated1 == payload
    assert migrated2 == payload


def test_downgrade_is_refused_rather_than_relabelled() -> None:
    """A backwards migration raises instead of passing the payload through.

    Passing it through is the dangerous half: the caller stamps ``to_version``
    onto whatever comes back, so data written by a schema this build cannot read
    would be relabelled as one it can.
    """

    newer = CURRENT_SCHEMA_VERSION + 1
    payload = {"schema_version": newer, "items": {}, "locations": {}}
    before = deepcopy(payload)

    with pytest.raises(SchemaDowngradeError) as excinfo:
        migrate(payload, from_version=newer, to_version=CURRENT_SCHEMA_VERSION)

    # Both versions named, so a caller's log says which direction was asked for.
    message = str(excinfo.value)
    assert str(newer) in message
    assert str(CURRENT_SCHEMA_VERSION) in message

    # A refusal touches nothing.
    assert payload == before
    assert isinstance(excinfo.value, StorageError)
