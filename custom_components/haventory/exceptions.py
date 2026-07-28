"""Exception taxonomy for the HAventory integration.

Defines a small hierarchy of exceptions used across services and the
WebSocket API. These extend Home Assistant's HomeAssistantError to ensure
consistent behavior when surfaced through the platform.

All exceptions accept a human-readable message. ``str(exception)`` returns the
message unchanged.
"""

from __future__ import annotations

from homeassistant.exceptions import HomeAssistantError


class HaventoryError(HomeAssistantError):
    """Base exception for HAventory-related errors."""


class ValidationError(HaventoryError):
    """Raised when input payloads fail validation or violate invariants."""


class NotFoundError(HaventoryError):
    """Raised when a requested resource does not exist."""


class ConflictError(HaventoryError):
    """Raised when an operation conflicts with current state (e.g., version)."""


class StorageError(HaventoryError):
    """Raised when storage operations fail or data is corrupted."""


class SchemaDowngradeError(StorageError):
    """Raised when persisted data carries a schema version this build cannot read.

    Separate from its parent because it is not transient: migrations are
    forward-only, so retrying or rewriting can only lose data. Callers are
    expected to stop and leave the stored payload untouched.
    """
