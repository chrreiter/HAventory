"""Exception taxonomy for the HAventory integration.

Defines a small hierarchy of exceptions used across services and the
WebSocket API. These extend Home Assistant's HomeAssistantError to ensure
consistent behavior when surfaced through the platform.

All exceptions accept a human-readable message. ``str(exception)`` returns the
message unchanged.

The taxonomy also owns how each error is logged, so the WebSocket and service
boundaries cannot drift apart on severity.
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

    A ``StorageError`` so the wire contract does not move: the client sees the
    taxonomy's ``storage_error``, which is what "HAventory is unavailable" has
    always meant. The subclass exists for the log alone — nothing has broken and
    there is no server-side fault to investigate, so a dashboard that keeps
    retrying must not fill the Home Assistant log with tracebacks.
    """


# Codes an operator has to act on. Everything else in the contract's taxonomy —
# validation_error, not_found, conflict — is a rejection the caller can recover
# from by fixing and resending the request, so it must not read as a fault in
# the Home Assistant log.
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

    ``NotLoadedError`` carries the contract's ``storage_error`` code but is not
    a fault: the entry is unloaded, disabled or removed, which is a state
    somebody chose. Only the client (stop asking) or the operator (re-enable the
    entry) can move it, and neither learns anything from a traceback — so it is
    graded on the exception rather than on the code it maps to.
    """

    if isinstance(exc, NotLoadedError):
        return True
    return code not in OPERATOR_ACTIONABLE_CODES


def log_severity(code: str, exc: BaseException | None = None) -> int:
    """Return the log level a boundary rejection carrying ``code`` is logged at."""

    return logging.WARNING if _is_client_recoverable(code, exc) else logging.ERROR


def log_exc_info(code: str, exc: BaseException | None = None) -> bool | None:
    """Return the ``exc_info`` argument for a boundary log carrying ``code``.

    A traceback earns its place only when it says something the message does
    not. The client-recoverable codes carry their whole story in the message;
    a ``storage_error`` wraps a lower-level failure whose cause chain is the
    only record of what actually broke, and an ``unknown_error`` has no vetted
    message at all.

    ``None`` rather than ``False`` for the recoverable codes: ``logging``
    passes the argument through onto the record untouched, so ``False`` would
    leave a falsy-but-present ``exc_info`` slot behind instead of no slot.
    """

    return None if _is_client_recoverable(code, exc) else True


class SchemaDowngradeError(StorageError):
    """Raised when persisted data carries a schema version this build cannot read.

    Separate from its parent because it is not transient: migrations are
    forward-only, so retrying or rewriting can only lose data. Callers are
    expected to stop and leave the stored payload untouched.
    """


class CorruptSchemaVersionError(StorageError):
    """Raised when persisted data carries a ``schema_version`` that is not an integer.

    Separate from its parent for the same reason as its sibling above: nothing
    about a retry turns a ``null`` or a string into a version, so callers stop
    rather than back off, and the stored payload is left for a human to repair.
    """
