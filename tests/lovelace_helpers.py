"""Stand-ins for Lovelace's two resource collections.

Registering and taking back the card resource is written against a collection
whose loading state the caller has to get right, and against a second one that
cannot be written to at all. Both are modelled here, where the tests for the
registration and for the removal can share them.

* :class:`MockResourceCollection` is storage mode. ``stored`` is the backing
  store; ``async_items`` reports nothing until something loads it, while every
  mutation loads first — so code that reads before writing has to load for
  itself or it sees an empty collection that is not empty.
* :class:`MockYamlResourceCollection` is YAML mode: readable, with no mutation
  API at all, which is why the card also goes out through the frontend's
  extra-module URL.
"""

from __future__ import annotations

from typing import Any


class MockResourceCollection:
    """Lovelace resources in storage mode: create, update and delete."""

    def __init__(self, items: list[dict[str, Any]] | None = None, *, loaded: bool = True) -> None:
        self.loaded = loaded
        self.stored: list[dict[str, Any]] = list(items or [])
        self.created: list[dict[str, Any]] = []
        self.updated: list[tuple[str, dict[str, Any]]] = []
        self.deleted: list[str] = []

    def async_items(self) -> list[dict[str, Any]]:
        return self.stored if self.loaded else []

    async def async_load(self) -> None:
        self.loaded = True

    async def async_create_item(self, data: dict[str, Any]) -> dict[str, Any]:
        self.loaded = True
        self.created.append(data)
        item = {"id": f"created_{len(self.created)}", **data}
        self.stored.append(item)
        return item

    async def async_update_item(self, item_id: str, updates: dict[str, Any]) -> dict[str, Any]:
        self.loaded = True
        for item in self.stored:
            if item.get("id") == item_id:
                item.update(updates)
                self.updated.append((item_id, updates))
                return item
        raise KeyError(item_id)

    async def async_delete_item(self, item_id: str) -> None:
        self.loaded = True
        self.deleted.append(item_id)
        self.stored = [item for item in self.stored if item.get("id") != item_id]


class MockYamlResourceCollection:
    """Lovelace resources in YAML mode: readable, with no mutation API."""

    def __init__(self, items: list[dict[str, Any]] | None = None) -> None:
        self.loaded = True
        self.stored: list[dict[str, Any]] = list(items or [])

    def async_items(self) -> list[dict[str, Any]]:
        return self.stored

    async def async_load(self) -> None:
        pass
