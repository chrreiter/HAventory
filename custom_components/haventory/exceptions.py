"""Exception taxonomy for the HAventory integration.

Every exception extends ``HomeAssistantError``, and the ones a caller can fix
extend ``ServiceValidationError`` as well: Home Assistant logs a traceback for
any other error a service raises, which an automation author cannot act on.

``str(exception)`` is English and is what the log and the WebSocket ``message``
carry. A refusal a person can meet also names a translation key and its
placeholders: Home Assistant's frontend renders a service error from
``strings.json`` → ``exceptions`` by them, and the card from its own catalog,
which ``tests/test_exception_translations_offline.py`` holds to the same keys.

The taxonomy also owns how each error is logged, so the WebSocket and service
boundaries agree on severity.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping

from homeassistant.exceptions import HomeAssistantError, ServiceValidationError

from .const import DOMAIN


class HaventoryError(HomeAssistantError):
    """Base exception for HAventory-related errors.

    ``key`` names an entry under ``exceptions`` in ``strings.json``. Home
    Assistant wants every placeholder value as a string, so each is converted
    here rather than at forty raise sites.
    """

    def __init__(
        self,
        message: str,
        *,
        key: str | None = None,
        placeholders: Mapping[str, object] | None = None,
    ) -> None:
        super().__init__(
            message,
            translation_domain=DOMAIN if key else None,
            translation_key=key,
            translation_placeholders=(
                {name: str(value) for name, value in placeholders.items()}
                if key and placeholders
                else None
            ),
        )


class ValidationError(HaventoryError, ServiceValidationError):
    """Raised when input payloads fail validation or violate invariants."""


class NotFoundError(HaventoryError, ServiceValidationError):
    """Raised when a requested resource does not exist."""


class ConflictError(HaventoryError, ServiceValidationError):
    """Raised when an operation conflicts with current state (e.g., version)."""


class StorageError(HaventoryError):
    """Raised when storage operations fail or data is corrupted."""


class NotLoadedError(StorageError, ServiceValidationError):
    """Raised when no config entry owns the data: unloaded, disabled or removed.

    The client sees ``storage_error``. The subclass exists for the log: a
    dashboard that keeps retrying must not fill the log with tracebacks, and a
    service call made in this state is the caller's to retry once the entry is
    loaded, not a fault.
    """


def translation_fields(exc: BaseException) -> dict[str, object]:
    """A refusal's translation fields, under the names Home Assistant's own error envelope uses.

    Empty for a refusal that names no key; a client shows its ``message`` then.
    """

    key = getattr(exc, "translation_key", None)
    if not key:
        return {}
    fields: dict[str, object] = {
        "translation_domain": getattr(exc, "translation_domain", None),
        "translation_key": key,
    }
    placeholders = getattr(exc, "translation_placeholders", None)
    if placeholders:
        fields["translation_placeholders"] = dict(placeholders)
    return fields


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
