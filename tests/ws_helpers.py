"""One way for an offline test to send a WebSocket command.

Home Assistant is stubbed offline (``tests/conftest.py``), so a test cannot open a
connection and speak the protocol. It dispatches straight to the handler the stub
registry holds under a command name — which is what these helpers do, once, for
every test file:

* :func:`ws_send` builds the frame, dispatches it and hands back the **full result
  envelope** (``{"id", "type", "success", "result"|"error"}``), so a test can assert
  on the envelope, on ``result`` or on ``error`` without unwrapping anything first.
* ``conn`` is a first-class optional argument on every one of them. Pass a
  :class:`RecordingConn` to read what the handler pushed on the connection —
  subscription events, a broadcast, a teardown notice. Leave it out and the stub
  registry supplies its own throwaway connection.
* :func:`ws_handler` and :func:`ws_call` are the split version, for the one case
  that needs it: capturing a handler *before* an entry unloads and calling it
  afterwards, the way a client sending on a still-registered command does.

The frame goes through the same schema validation an ``ActiveConnection`` applies,
so a payload no real client could send comes back as ``invalid_format`` rather than
reaching the handler.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Protocol

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from homeassistant.core import HomeAssistant


# The item-action vocabulary `docs/backend_api_contract.md` documents for both
# surfaces — the `items` topic and `haventory_item_changed` — so a test can hold
# either to the same words. `reloaded` is not one of them: it says the dataset
# moved wholesale, carries no item and fires nothing on the bus.
ITEM_ACTIONS: frozenset[str] = frozenset(
    {"created", "updated", "moved", "quantity_changed", "checked_out", "checked_in", "deleted"}
)


class WsHandler(Protocol):
    """What the stub registry stores: a dispatchable, command-tagged coroutine."""

    _ws_command: str

    def __call__(
        self, hass: HomeAssistant, conn: object, msg: dict[str, Any]
    ) -> Awaitable[dict[str, Any] | None]: ...


class RecordingConn:
    """Stands in for HA's ``ActiveConnection``: what was sent, and what is subscribed.

    ``subscriptions`` is HA's own registry — message id to zero-arg teardown —
    which core's ``unsubscribe_events`` command and the disconnect path both
    drive. :meth:`core_unsubscribe_events` is that command and :meth:`close` is
    that disconnect, so a test drives either teardown the way the framework
    does.
    """

    def __init__(self) -> None:
        self.messages: list[dict[str, Any]] = []
        self.subscriptions: dict[Any, Callable[[], None]] = {}

    def send_message(self, msg: dict[str, Any]) -> None:
        self.messages.append(msg)

    def core_unsubscribe_events(self, subscription: int) -> bool:
        """Pop-and-call one teardown, as core's ``unsubscribe_events`` does.

        ``False`` for an id the registry does not hold — the ``not_found`` core
        answers a teardown it cannot resolve.
        """

        if subscription in self.subscriptions:
            self.subscriptions.pop(subscription)()
            return True
        return False

    def close(self) -> None:
        """Disconnect: every registered teardown runs, then the registry empties."""

        for unsub in list(self.subscriptions.values()):
            unsub()
        self.subscriptions.clear()

    def subscription_ids(self, *, topic: str) -> set[Any]:
        """Which subscriptions an event on this topic reached.

        The enclosing message's id is the subscription id the client opened
        with, which is how a test with several open subscriptions on one
        connection tells which of them a filter let through.
        """

        return {
            msg.get("id")
            for msg in self.messages
            if msg.get("type") == "event" and (msg.get("event") or {}).get("topic") == topic
        }

    def events(self, *, topic: str | None = None) -> list[dict[str, Any]]:
        """The event payloads pushed on this connection, oldest first.

        Returns the inner ``event`` object, which is where ``topic``, ``action``
        and the payload live; the enclosing message carries only the envelope.
        """

        out: list[dict[str, Any]] = []
        for msg in self.messages:
            if msg.get("type") != "event":
                continue
            event = msg.get("event") or {}
            if topic is not None and event.get("topic") != topic:
                continue
            out.append(event)
        return out


def ws_handler(hass: HomeAssistant, type_: str) -> WsHandler:
    """The registered handler for one command type, as HA would dispatch to it."""

    handler = hass.data.get("__ws_commands__", {}).get(type_)
    if handler is None:
        raise AssertionError(f"No handler registered for type {type_}")
    return handler


async def ws_call(
    handler: WsHandler,
    hass: HomeAssistant,
    _id: int,
    type_: str,
    *,
    conn: object = None,
    **payload: Any,
) -> dict[str, Any]:
    """Send one frame to an already-looked-up handler and return its envelope."""

    res = await handler(hass, conn, {"id": _id, "type": type_, **payload})
    assert res is not None, f"{type_} answered nothing on the connection or as a result"
    return res


async def ws_send(
    hass: HomeAssistant,
    _id: int,
    type_: str,
    *,
    conn: object = None,
    **payload: Any,
) -> dict[str, Any]:
    """Dispatch one WebSocket command as a client would, and return its envelope."""

    return await ws_call(ws_handler(hass, type_), hass, _id, type_, conn=conn, **payload)
