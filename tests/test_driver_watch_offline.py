"""The dev driver's `watch` subscribes to something, and stops when told to.

``.claude/skills/run-haventory/driver.py`` is the only way to hold a
subscription open while another window mutates, so a recipe that bounds a watch
— "three events, then stop" — depends on the bound being read the way it was
written. The failure worth guarding against is silent: a watch that subscribed
to nothing, or to a topic the backend does not broadcast, looks exactly like an
inventory that nobody touched.

The topic list is checked against the backend's own so a topic added to
``ws_subscribe`` cannot leave the driver watching three of four.
"""

from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
# The harness lives outside the package tree and is loaded by path, the way the
# operator runs it. `scripts/` goes on the path first because the module imports
# `dev_env` from there at import time.
sys.path.insert(0, str(REPO_ROOT / "scripts"))
_SPEC = importlib.util.spec_from_file_location(
    "haventory_driver", REPO_ROOT / ".claude/skills/run-haventory/driver.py"
)
assert _SPEC is not None and _SPEC.loader is not None
driver = importlib.util.module_from_spec(_SPEC)
# `@dataclass` reads the defining module out of `sys.modules`, so the entry has
# to exist before the module body runs.
sys.modules[_SPEC.name] = driver
_SPEC.loader.exec_module(driver)


def test_naming_no_topic_watches_every_one() -> None:
    """Watching "anything" must not resolve to watching nothing."""
    assert driver.parse_watch([]).topics == driver.WATCH_TOPICS


def test_the_driver_knows_every_topic_the_backend_broadcasts() -> None:
    """A fifth topic on the backend has to reach this list, or a watch misses it.

    ``ws_subscribe`` names the set in the refusal it raises for anything else,
    which is the one place the four are written out; the driver is held to that
    sentence rather than to a copy of the list.
    """
    refusal = re.search(
        r"topic must be one of: ([^\"']+)",
        (REPO_ROOT / "custom_components/haventory/ws.py").read_text(encoding="utf-8"),
    )
    assert refusal is not None, "ws_subscribe no longer names its topics in the refusal"

    assert set(driver.WATCH_TOPICS) == {name.strip() for name in refusal.group(1).split(",")}


def test_named_topics_are_kept_in_order_and_deduplicated() -> None:
    """Two `--topic items` on one line is one subscription, not two."""
    watch = driver.parse_watch(["stats", "items", "items"])

    assert watch.topics == ("stats", "items")
    assert watch.count is None
    assert watch.timeout is None


def test_both_bounds_are_read() -> None:
    """`--count` counts events, `--timeout` counts seconds; a run may carry both."""
    assert driver.parse_watch(["items", "--count", "3", "--timeout", "1.5"]) == driver.Watch(
        topics=("items",), count=3, timeout=1.5
    )


@pytest.mark.parametrize(
    "args",
    [
        ["item"],  # a typo for `items`
        ["--count"],
        ["--count", "zero"],
        ["--count", "0"],
        ["--timeout", "-1"],
    ],
)
def test_an_invocation_that_cannot_be_acted_on_is_refused(args: list[str]) -> None:
    """Refused here rather than by the backend: a typo costs no round trip."""
    with pytest.raises(driver.WatchArgumentError):
        driver.parse_watch(args)


class _Socket:
    """A connection that answers every subscribe, then hands out `frames`."""

    def __init__(self, frames: list[dict], *, refuse: str | None = None) -> None:
        self.sent: list[dict] = []
        self._queued: list[dict] = []
        self._frames = list(frames)
        self._refuse = refuse

    async def send_only(self, message: dict) -> int:
        message_id = len(self.sent) + 1
        self.sent.append(message)
        refused = message["topic"] == self._refuse
        self._queued.append(
            {"id": message_id, "type": "result", "success": not refused}
            | ({"error": {"code": "unknown_command"}} if refused else {})
        )
        return message_id

    async def receive(self) -> dict:
        if self._queued:
            return self._queued.pop(0)
        if self._frames:
            return self._frames.pop(0)
        raise TimeoutError


def _stub_socket(monkeypatch: pytest.MonkeyPatch, socket: _Socket) -> None:
    class _Session:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_exc: object) -> bool:
            return False

    monkeypatch.setattr(driver.aiohttp, "ClientSession", _Session)
    monkeypatch.setattr(driver, "connect", lambda *_a, **_k: _ready(socket))


async def _ready(value: _Socket) -> _Socket:
    return value


@pytest.mark.asyncio
async def test_a_watch_subscribes_to_each_topic_and_stops_on_its_count(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """The bound is events, not frames: the subscribe answers do not count."""
    events = [{"id": 1, "type": "event", "event": {"topic": "items", "action": "created"}}] * 3
    socket = _Socket(events)
    _stub_socket(monkeypatch, socket)

    code = await driver.cmd_watch("http://ha:8123", "token", driver.parse_watch(["--count", "2"]))

    assert code == 0
    assert [message["topic"] for message in socket.sent] == list(driver.WATCH_TOPICS)
    out = capsys.readouterr()
    assert out.out.count('"type": "event"') == len(events) - 1
    assert "[WATCH] 2 event(s)" in out.err


@pytest.mark.asyncio
async def test_a_refused_subscribe_fails_the_watch(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """A watch listening to three of four topics must not look like a quiet instance."""
    socket = _Socket([], refuse="stats")
    _stub_socket(monkeypatch, socket)

    code = await driver.cmd_watch("http://ha:8123", "token", driver.parse_watch([]))

    assert code == 1
    assert "[FAIL] subscribe stats" in capsys.readouterr().err
