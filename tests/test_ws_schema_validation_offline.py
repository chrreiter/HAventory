"""Offline tests for the WS stub's command-schema validation.

The offline suite dispatches WebSocket frames through the stub in
``tests/conftest.py`` rather than through a real ``ActiveConnection``. These
tests pin the one property that makes such a dispatch worth trusting: a frame
the real connection would refuse is refused here too, before the handler body
runs. Without it a handler can appear to tolerate input no client can send, and
a refusal expressed purely as a schema constraint is invisible to this suite —
neither assertable nor able to regress visibly.

Scenarios:
- a valid frame reaches the handler, carrying the schema's transformed payload
- a missing required field, a wrong-typed field and an undeclared field are each
  refused as `invalid_format` with the handler body never entered
- a command declaring nothing but its type accepts no key beyond id and type
- the id/type envelope is checked ahead of the command schema
- a `vol.All` schema's cross-field validator refuses through the same path
- a real haventory command refuses a wrong-typed field and mutates nothing
- registering a handler that carries no schema is refused outright
"""

from __future__ import annotations

from typing import Any

import pytest
import voluptuous as vol
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import DomainStore
from custom_components.haventory.ws import setup as ws_setup
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from ws_helpers import RecordingConn, ws_send

INVALID_FORMAT = "invalid_format"
PROBE_DEFAULT_LIMIT = 25


class _Probe:
    """A registered command that records whether its body ran, and on what."""

    def __init__(self, hass: HomeAssistant, schema: Any) -> None:
        self.calls: list[dict[str, Any]] = []

        @websocket_api.websocket_command(schema)
        @websocket_api.async_response
        async def _handler(_hass: HomeAssistant, conn: Any, msg: dict[str, Any]) -> dict[str, Any]:
            self.calls.append(msg)
            return websocket_api.result_message(msg["id"], {"ok": True})

        websocket_api.async_register_command(hass, _handler)
        self.command = _handler._ws_command
        self.schema = _handler._ws_schema
        self._hass = hass

    @property
    def ran(self) -> bool:
        return bool(self.calls)

    async def send(self, frame: dict[str, Any]) -> dict[str, Any]:
        """Dispatch one frame the way a client's would arrive."""

        for handler in self._hass.data.get("__ws_commands__", []):
            if getattr(handler, "_ws_command", None) == self.command:
                return await handler(self._hass, RecordingConn(), frame)
        raise AssertionError("probe command was not registered")


def _fresh_hass() -> HomeAssistant:
    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)
    return hass


@pytest.mark.asyncio
async def test_a_valid_frame_reaches_the_handler() -> None:
    """Happy path: the handler runs, and sees what the schema produced."""

    probe = _Probe(
        HomeAssistant(),
        {
            vol.Required("type"): "test/probe",
            vol.Required("name"): str,
            vol.Optional("limit", default=PROBE_DEFAULT_LIMIT): int,
        },
    )

    res = await probe.send({"id": 1, "type": "test/probe", "name": "Hammer"})

    assert res["success"] is True
    assert probe.ran
    # The schema's default is applied on the way in, exactly as it would be for
    # a frame HA validated — a handler must not have to re-derive it.
    assert probe.calls[0]["limit"] == PROBE_DEFAULT_LIMIT


@pytest.mark.asyncio
async def test_a_missing_required_field_never_runs_the_handler() -> None:
    """The acceptance case: a schema violation is refused before dispatch."""

    probe = _Probe(
        HomeAssistant(),
        {vol.Required("type"): "test/probe", vol.Required("name"): str},
    )

    res = await probe.send({"id": 1, "type": "test/probe"})

    assert res["success"] is False
    assert res["error"]["code"] == INVALID_FORMAT
    assert not probe.ran


@pytest.mark.asyncio
async def test_a_wrong_typed_or_undeclared_field_is_refused() -> None:
    """Both halves of a voluptuous mapping schema hold: types and PREVENT_EXTRA."""

    probe = _Probe(
        HomeAssistant(),
        {vol.Required("type"): "test/probe", vol.Optional("quantity"): int},
    )

    wrong_type = await probe.send({"id": 1, "type": "test/probe", "quantity": "many"})
    assert wrong_type["error"]["code"] == INVALID_FORMAT

    undeclared = await probe.send({"id": 2, "type": "test/probe", "bogus": 1})
    assert undeclared["error"]["code"] == INVALID_FORMAT

    assert not probe.ran


@pytest.mark.asyncio
async def test_a_type_only_command_takes_no_other_key() -> None:
    """A schema of just `type` compiles to False, HA's "id and type only" marker."""

    probe = _Probe(HomeAssistant(), {"type": "test/probe"})
    assert probe.schema is False

    assert (await probe.send({"id": 1, "type": "test/probe"}))["success"] is True
    assert probe.ran

    res = await probe.send({"id": 2, "type": "test/probe", "extra": True})
    assert res["error"]["code"] == INVALID_FORMAT
    assert len(probe.calls) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "frame",
    [
        {"type": "test/probe"},
        {"id": 0, "type": "test/probe"},
        {"id": -1, "type": "test/probe"},
        {"id": "1", "type": "test/probe"},
        {"id": True, "type": "test/probe"},
        {"id": 1, "type": ""},
        {"id": 1},
    ],
    ids=["no-id", "zero-id", "negative-id", "string-id", "bool-id", "empty-type", "no-type"],
)
async def test_the_envelope_is_checked_ahead_of_the_command_schema(frame: dict) -> None:
    """HA validates id and type before it even looks the command up."""

    probe = _Probe(HomeAssistant(), {"type": "test/probe"})

    res = await probe.send(frame)

    assert res["success"] is False
    assert res["error"]["code"] == INVALID_FORMAT
    assert res["error"]["message"] == "Message incorrectly formatted."
    assert not probe.ran


@pytest.mark.asyncio
async def test_a_cross_field_validator_refuses_through_the_same_path() -> None:
    """`vol.All` schemas validate too — a cap or a mutual exclusion is a refusal.

    This is the shape a constraint spanning two fields has to take, so the
    offline suite has to carry it through to the same `invalid_format` answer.
    """

    def _at_most_one_bound(msg: dict[str, Any]) -> dict[str, Any]:
        if "minimum" in msg and "maximum" in msg:
            raise vol.Invalid("minimum and maximum are mutually exclusive")
        return msg

    probe = _Probe(
        HomeAssistant(),
        vol.All(
            vol.Schema(
                {
                    vol.Required("type"): "test/probe",
                    vol.Optional("minimum"): int,
                    vol.Optional("maximum"): int,
                }
            ),
            _at_most_one_bound,
        ),
    )

    assert (await probe.send({"id": 1, "type": "test/probe", "minimum": 1}))["success"] is True

    res = await probe.send({"id": 2, "type": "test/probe", "minimum": 1, "maximum": 9})
    assert res["error"]["code"] == INVALID_FORMAT
    assert len(probe.calls) == 1


@pytest.mark.asyncio
async def test_a_refusal_is_answered_on_the_connection() -> None:
    """HA replies to a refused frame on the wire, not only to its caller."""

    hass = HomeAssistant()
    probe = _Probe(hass, {vol.Required("type"): "test/probe", vol.Required("name"): str})
    conn = RecordingConn()

    for handler in hass.data["__ws_commands__"]:
        if getattr(handler, "_ws_command", None) == probe.command:
            res = await handler(hass, conn, {"id": 1, "type": "test/probe"})
            break

    assert conn.messages == [res]
    assert res["error"]["code"] == INVALID_FORMAT


@pytest.mark.asyncio
async def test_a_real_command_refuses_a_wrong_typed_field_and_mutates_nothing() -> None:
    """The same guard over a shipped command, end to end.

    ``tags`` is one of the fields ``item/create`` still types concretely. The
    fields whose wrong type is a plausible client bug — ``name``, ``quantity``
    — are typed ``object`` on purpose so they answer ``validation_error``
    through the guard instead; the test below covers those.
    """

    hass = _fresh_hass()
    repo = hass.data[DOMAIN]["repository"]

    res = await ws_send(hass, 1, "haventory/item/create", name="Hammer", tags="chisel")

    assert res["success"] is False
    assert res["error"]["code"] == INVALID_FORMAT
    assert repo.get_counts()["items_total"] == 0


@pytest.mark.asyncio
async def test_the_widened_fields_answer_validation_error_and_mutate_nothing() -> None:
    """A field typed ``object`` is refused by the handler, through the guard.

    Home Assistant refuses a schema mismatch before ``ws_guard`` runs and logs
    the client's payload at ERROR while doing it. The fields a client most
    plausibly gets wrong are typed ``object`` so the answer comes from the model
    layer instead, naming the field at WARNING.
    """

    hass = _fresh_hass()
    repo = hass.data[DOMAIN]["repository"]

    for payload in (
        {"name": "Hammer", "quantity": "many"},
        {"name": 42},
        {"name": "Hammer", "quantity": 1.5},
    ):
        res = await ws_send(hass, 1, "haventory/item/create", **payload)
        assert res["success"] is False, payload
        assert res["error"]["code"] == "validation_error", payload

    assert repo.get_counts()["items_total"] == 0


def test_registering_a_handler_without_a_schema_is_refused() -> None:
    """An undecorated handler must not become the one command that skips validation."""

    async def _bare(_hass: HomeAssistant, _conn: Any, _msg: dict[str, Any]) -> None:
        raise AssertionError("must never be registered, let alone dispatched to")

    with pytest.raises(ValueError, match="websocket_command"):
        websocket_api.async_register_command(HomeAssistant(), _bare)
