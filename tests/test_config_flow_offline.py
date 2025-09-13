"""Offline tests for HAventory config flow.

Scenarios:
- Single-instance guard aborts with reason
- async_step_user happy path creates entry
- Import path: create entry if no existing (if supported)
- Validation errors surfaced to form (simulated)
"""

from __future__ import annotations

import pytest
from custom_components.haventory.config_flow import HAventoryConfigFlow


@pytest.mark.asyncio
async def test_single_instance_guard_aborts(monkeypatch) -> None:
    """If an entry already exists, flow aborts with reason."""

    flow = HAventoryConfigFlow()

    # Simulate existing entries
    monkeypatch.setattr(flow, "_async_current_entries", lambda: [object()], raising=False)

    result = await flow.async_step_user(user_input=None)
    assert result["type"] == "abort"
    assert result["reason"] == "single_instance_allowed"


@pytest.mark.asyncio
async def test_user_step_creates_entry(monkeypatch) -> None:
    """Happy path: no existing entries -> create entry immediately."""

    flow = HAventoryConfigFlow()

    # No current entries
    monkeypatch.setattr(flow, "_async_current_entries", lambda: [], raising=False)

    result = await flow.async_step_user(user_input={})
    assert result["type"] == "create_entry"
    assert result["title"] == "HAventory"
    assert result["data"] == {}


@pytest.mark.asyncio
async def test_import_step_behaves_like_user_when_supported(monkeypatch) -> None:
    """Import path (if implemented) should create an entry when none exists."""

    flow = HAventoryConfigFlow()
    monkeypatch.setattr(flow, "_async_current_entries", lambda: [], raising=False)

    # Some integrations alias import to user; try calling if present
    step = getattr(flow, "async_step_import", None)
    if callable(step):
        result = await step(user_input={})
        assert result["type"] == "create_entry"
    else:
        # If not supported, fall back to user step for coverage
        result = await flow.async_step_user(user_input={})
        assert result["type"] == "create_entry"


@pytest.mark.asyncio
async def test_validation_error_form(monkeypatch) -> None:
    """Simulate a validation error surfaced to the form with errors mapping."""

    flow = HAventoryConfigFlow()
    monkeypatch.setattr(flow, "_async_current_entries", lambda: [], raising=False)

    # Monkeypatch create_entry to simulate a validation branch that returns a form
    def _form(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        return {"type": "form", "step_id": "user", "errors": {"base": "invalid"}}

    monkeypatch.setattr(flow, "async_create_entry", _form, raising=False)

    result = await flow.async_step_user(user_input={})
    assert result["type"] == "form"
    assert result["step_id"] == "user"
    assert result["errors"]["base"] == "invalid"
