"""Offline tests for exception taxonomy.

Each test constructs an exception and asserts type relationships and message
round-tripping, ensuring ``str(exc)`` equals the provided message.
"""

from __future__ import annotations

import pytest
from custom_components.haventory.exceptions import (
    ConflictError,
    HaventoryError,
    NotFoundError,
    StorageError,
    ValidationError,
)


@pytest.mark.asyncio
async def test_validation_error_message_and_type():
    # ValidationError should subclass HaventoryError and preserve message
    message = "invalid payload: name is required"
    exc = ValidationError(message)
    assert isinstance(exc, HaventoryError)
    assert str(exc) == message


@pytest.mark.asyncio
async def test_not_found_error_message_and_type():
    # NotFoundError should subclass HaventoryError and preserve message
    message = "item not found"
    exc = NotFoundError(message)
    assert isinstance(exc, HaventoryError)
    assert str(exc) == message


@pytest.mark.asyncio
async def test_conflict_error_message_and_type():
    # ConflictError should subclass HaventoryError and preserve message
    message = "version conflict"
    exc = ConflictError(message)
    assert isinstance(exc, HaventoryError)
    assert str(exc) == message


@pytest.mark.asyncio
async def test_storage_error_message_and_type():
    # StorageError should subclass HaventoryError and preserve message
    message = "storage failure"
    exc = StorageError(message)
    assert isinstance(exc, HaventoryError)
    assert str(exc) == message
