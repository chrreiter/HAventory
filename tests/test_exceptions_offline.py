"""Offline tests for the exception taxonomy.

The only thing here a client can notice is which WebSocket error code an
exception rides out on, so that is the whole file: both schema refusals stay
``storage_error`` instead of widening the taxonomy a card has to handle.
"""

from __future__ import annotations

from custom_components.haventory.exceptions import (
    CorruptSchemaVersionError,
    SchemaDowngradeError,
    StorageError,
    error_code,
)


def test_schema_refusals_stay_storage_errors():
    for cls in (SchemaDowngradeError, CorruptSchemaVersionError):
        message = f"{cls.__name__} message"
        exc = cls(message)
        assert isinstance(exc, StorageError)
        assert str(exc) == message
        assert error_code(exc) == "storage_error"
