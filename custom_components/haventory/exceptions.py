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

    def __init__(self, message: str) -> None:
        super().__init__(message)


class ValidationError(HaventoryError):
    """Raised when input payloads fail validation or violate invariants."""


class NotFoundError(HaventoryError):
    """Raised when a requested resource does not exist."""


class ConflictError(HaventoryError):
    """Raised when an operation conflicts with current state (e.g., version)."""


class StorageError(HaventoryError):
    """Raised when storage operations fail or data is corrupted."""
