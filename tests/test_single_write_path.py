"""Guard: every mutating surface writes through `ops.commit` or `ops.commit_batch`.

Static: each WebSocket command and service handler is parsed, and the names it
reaches (following module-level helpers in its own module) must not include a
persist call, an event announcement, an op function or a repository write. Every
command is also declared through `ws._command`, the one place `ws_guard` is applied.
"""

from __future__ import annotations

import ast
import inspect
import textwrap
from collections.abc import Callable
from pathlib import Path
from types import ModuleType
from typing import Any

from custom_components.haventory import events, ops, services, ws
from custom_components.haventory.repository import Repository

COMMITS = {"commit", "commit_batch"}
PERSIST = {"async_persist_repo", "async_persist_immediate"}

# Repository members that only read. A new public method is a write until listed.
REPO_READS = {
    "last_load_report", "status_slugs", "list_statuses",
    "count_items_with_status", "get_item", "item_ids", "iter_attachments",
    "find_attachment", "list_items", "low_stock_item_ids", "get_counts",
    "count_matching_by_location", "get_location_item_counts",
    "get_distinct_field_values", "get_location", "iter_locations", "children_of",
    "effective_area_id", "export_state", "from_state",
}  # fmt: skip

WS_MUTATORS = {
    "ws_item_create", "ws_item_update", "ws_item_delete", "ws_item_adjust_quantity",
    "ws_item_set_quantity", "ws_item_check_out", "ws_item_check_in", "ws_item_add_tags",
    "ws_item_remove_tags", "ws_item_update_custom_fields", "ws_item_set_low_stock_threshold",
    "ws_item_move", "ws_reminder_set", "ws_reminder_clear", "ws_reminder_bump",
    "ws_item_attachment_add", "ws_item_attachment_remove", "ws_item_attachment_update",
    "ws_item_attachment_reorder", "ws_items_bulk", "ws_location_create",
    "ws_location_update", "ws_location_delete", "ws_location_move_subtree",
    "ws_status_create", "ws_status_update", "ws_status_reorder", "ws_status_delete",
    "ws_import_execute",
}  # fmt: skip


def _repo_writes() -> set[str]:
    public = {n for n, m in vars(Repository).items() if not n.startswith("_")}
    return {n for n in public if n not in REPO_READS}


def _reached(func: Callable[..., Any], module: ModuleType, source: str | None = None) -> set[str]:
    """Names and attributes in `func`, plus those of same-module functions it names."""

    seen: set[str] = set()
    out: set[str] = set()
    todo = [source or textwrap.dedent(inspect.getsource(func))]
    while todo:
        for node in ast.walk(ast.parse(todo.pop())):
            name = node.id if isinstance(node, ast.Name) else getattr(node, "attr", None)
            if not isinstance(name, str):
                continue
            out.add(name)
            helper = getattr(module, name, None)
            if (
                name not in seen
                and inspect.isfunction(helper)
                and helper.__module__ == module.__name__
            ):
                seen.add(name)
                todo.append(textwrap.dedent(inspect.getsource(helper)))
    return out


def _forbidden(reached: set[str]) -> set[str]:
    bad = reached & (PERSIST | _repo_writes())
    # `services._op_payload` only reshapes a payload; ops.py's `_op_*` run writes.
    own = {n for n in reached if n.startswith("_op_") and hasattr(services, n)}
    bad |= {n for n in reached - own if n.startswith(("notify_", "_op_")) or n == "OPS"}
    return bad


def _ws() -> dict[str, set[str]]:
    return {(fn := inspect.unwrap(h)).__name__: _reached(fn, ws) for h in ws.HANDLERS}


def _services() -> dict[str, set[str]]:
    return {name: _reached(h, services) for name, h, _schema in services.SERVICES}


def test_repo_read_allowlist_names_real_attributes() -> None:
    assert [n for n in REPO_READS if not hasattr(Repository, n)] == []
    assert _repo_writes() >= {"create_item", "update_location", "load_state", "delete_status"}


def test_ws_handlers_unwrap_to_the_original_functions() -> None:
    names = list(_ws())
    assert len(names) == len(ws.HANDLERS)
    assert all(n.startswith("ws_") for n in names), names


def test_no_surface_bypasses_commit() -> None:
    found = {k: _forbidden(v) for k, v in {**_ws(), **_services()}.items()}
    assert {k: sorted(v) for k, v in found.items() if v} == {}


def test_mutating_commands_are_exactly_the_ones_that_commit() -> None:
    committing = {k for k, v in _ws().items() if v & COMMITS}
    assert committing == WS_MUTATORS
    assert "commit_batch" in _ws()["ws_items_bulk"]


def test_every_command_is_declared_through_the_guard() -> None:
    """A handler decorated with `websocket_command` directly answers, but skips the guard.

    Without it an unloaded entry is served and an unexpected error reaches the
    client with its text instead of `unknown_error`.
    """

    assert "ws_guard(op, context)(func)" in inspect.getsource(ws._command)
    tree = ast.parse(inspect.getsource(ws))
    decorators = {
        node.name: node.decorator_list
        for node in ast.walk(tree)
        if isinstance(node, ast.AsyncFunctionDef)
    }
    unguarded = [
        name
        for name in _ws()
        if not (
            len(decorators[name]) == 1
            and isinstance(call := decorators[name][0], ast.Call)
            and isinstance(call.func, ast.Name)
            and call.func.id == "_command"
        )
    ]
    assert unguarded == []


def test_every_service_commits() -> None:
    assert services.SERVICES
    assert {k for k, v in _services().items() if not v & COMMITS} == set()


def test_every_op_is_reached_by_a_surface() -> None:
    literals: set[str] = set()
    for module in (ws, services):
        tree = ast.parse(inspect.getsource(module))
        literals |= {
            n.value
            for n in ast.walk(tree)
            if isinstance(n, ast.Constant) and isinstance(n.value, str)
        }
    if "commit_batch" in _ws()["ws_items_bulk"]:
        literals |= set(ops.BULK_KINDS)
    assert sorted(set(ops.OPS) - literals) == []


def test_nothing_but_events_py_reaches_the_broadcaster() -> None:
    """One door: a write path announces through here, or subscribers hear nothing.

    A module calling `subscriptions.broadcast_event` itself would reach a card
    without firing the bus event, diffing the low-stock set or repainting the
    entities beside it, so the same edit would look different depending on which
    surface was watching. Read from the source rather than by importing.
    """

    package = Path(events.__file__).parent
    offenders = []
    for path in sorted(package.glob("*.py")):
        if path.name in {"events.py", "subscriptions.py"}:
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if "broadcast_event(" in line or "broadcast_counts(" in line:
                offenders.append(f"{path.name}:{number}: {line.strip()}")

    assert offenders == [], "announce through events.py: it covers the bus and the entities too"
