"""Exception taxonomy for the HAventory integration.

Every exception extends ``HomeAssistantError``, so a service call surfaces it the
way the platform expects, and ``str(exception)`` is what a WebSocket error
carries. The taxonomy also owns how each error is logged, so the WebSocket and
service boundaries agree on severity.
"""

from __future__ import annotations

import logging

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


class NotLoadedError(StorageError):
    """Raised when no config entry owns the data: unloaded, disabled or removed.

    The client sees ``storage_error``. The subclass exists for the log alone: a
    dashboard that keeps retrying must not fill the log with tracebacks.
    """


# Codes an operator has to act on; the rest are the caller's to fix and resend.
OPERATOR_ACTIONABLE_CODES = frozenset({"storage_error", "unknown_error"})


def error_code(exc: BaseException) -> str:
    """Map an exception to its contract error code."""

    if isinstance(exc, ValidationError):
        return "validation_error"
    if isinstance(exc, NotFoundError):
        return "not_found"
    if isinstance(exc, ConflictError):
        return "conflict"
    if isinstance(exc, StorageError):
        return "storage_error"
    return "unknown_error"


def _is_client_recoverable(code: str, exc: BaseException | None) -> bool:
    """Whether the rejection is the caller's to act on rather than an operator's.

    ``NotLoadedError`` maps to ``storage_error`` but is a chosen state, not a
    fault, so it is graded on the exception rather than on the code.
    """

    if isinstance(exc, NotLoadedError):
        return True
    return code not in OPERATOR_ACTIONABLE_CODES


def log_severity(code: str, exc: BaseException | None = None) -> int:
    """Return the log level a boundary rejection carrying ``code`` is logged at."""

    return logging.WARNING if _is_client_recoverable(code, exc) else logging.ERROR


def log_exc_info(code: str, exc: BaseException | None = None) -> bool | None:
    """Return the ``exc_info`` argument for a boundary log carrying ``code``.

    A traceback only for the operator codes, whose cause chain is the record of
    what broke. ``None`` rather than ``False``: ``logging`` copies the argument
    onto the record, and ``False`` would leave a present-but-falsy slot.
    """

    return None if _is_client_recoverable(code, exc) else True


class SchemaDowngradeError(StorageError):
    """Raised when persisted data carries a schema version this build cannot read.

    Not transient: callers stop and leave the stored payload untouched.
    """


class CorruptSchemaVersionError(StorageError):
    """Raised when persisted data carries a ``schema_version`` that is not an integer.

    Not transient either: callers stop and leave the payload for a human to repair.
    """
