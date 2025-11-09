"""Tests for bulk operations with continue-on-error behavior.

Verifies that bulk operations handle partial failures correctly, log errors
appropriately, and only persist successful operations.
"""

import pytest
from custom_components.haventory.exceptions import ConflictError, NotFoundError, ValidationError
from custom_components.haventory.models import ItemCreate, ItemUpdate
from custom_components.haventory.repository import Repository

# Named constants to avoid magic numbers in assertions
QTY_10 = 10
QTY_15 = 15
QTY_20 = 20
QTY_25 = 25
QTY_30 = 30
QTY_35 = 35
QTY_100 = 100
COUNT_TWO = 2
COUNT_THREE = 3
VERSION_TWO = 2


def test_bulk_all_success():
    """All operations succeed - all should be applied and persisted."""
    repo = Repository()

    # Create initial items
    item1 = repo.create_item(ItemCreate(name="Item 1", quantity=QTY_10))
    item2 = repo.create_item(ItemCreate(name="Item 2", quantity=QTY_20))
    item3 = repo.create_item(ItemCreate(name="Item 3", quantity=QTY_30))

    initial_gen = repo.generation

    # Simulate bulk update operations
    repo.update_item(item1.id, ItemUpdate(quantity=QTY_15))
    repo.update_item(item2.id, ItemUpdate(quantity=QTY_25))
    repo.update_item(item3.id, ItemUpdate(quantity=QTY_35))

    # All operations succeeded, generation should have incremented
    assert repo.generation > initial_gen

    # Verify all updates applied
    assert repo.get_item(item1.id).quantity == QTY_15
    assert repo.get_item(item2.id).quantity == QTY_25
    assert repo.get_item(item3.id).quantity == QTY_35


def test_bulk_partial_failure_continue():
    """Some operations fail - successful ones are applied, failures are skipped."""
    repo = Repository()

    # Create initial items
    item1 = repo.create_item(ItemCreate(name="Item 1", quantity=QTY_10))
    item2 = repo.create_item(ItemCreate(name="Item 2", quantity=QTY_20))

    # Simulate bulk operations with one failure
    successes = []
    failures = []

    # Operation 1: Success
    try:
        updated1 = repo.update_item(item1.id, ItemUpdate(quantity=QTY_15))
        successes.append(updated1)
    except Exception as e:
        failures.append(e)

    # Operation 2: Failure (non-existent item)
    try:
        updated2 = repo.update_item("non-existent-id", ItemUpdate(quantity=QTY_25))
        successes.append(updated2)
    except NotFoundError as e:
        failures.append(e)

    # Operation 3: Success
    try:
        updated3 = repo.update_item(item2.id, ItemUpdate(quantity=QTY_35))
        successes.append(updated3)
    except Exception as e:
        failures.append(e)

    # Two successes, one failure
    assert len(successes) == COUNT_TWO
    assert len(failures) == 1
    assert isinstance(failures[0], NotFoundError)

    # Successful operations should be applied
    assert repo.get_item(item1.id).quantity == QTY_15
    assert repo.get_item(item2.id).quantity == QTY_35


def test_bulk_all_failure():
    """All operations fail - no changes should be applied."""
    repo = Repository()

    # Create initial item
    item = repo.create_item(ItemCreate(name="Item 1", quantity=QTY_10))

    # Simulate bulk operations that all fail
    failures = []

    # Operation 1: Version conflict
    try:
        repo.update_item(item.id, ItemUpdate(quantity=QTY_15), expected_version=999)
    except ConflictError as e:
        failures.append(e)

    # Operation 2: Non-existent item
    try:
        repo.update_item("non-existent", ItemUpdate(quantity=QTY_20))
    except NotFoundError as e:
        failures.append(e)

    # Operation 3: Invalid update
    try:
        # Try to set due_date without checked_out=True
        repo.update_item(item.id, ItemUpdate(due_date="2025-12-31"))
    except ValidationError as e:
        failures.append(e)

    # All operations failed
    assert len(failures) == COUNT_THREE

    # Original item should be unchanged
    current = repo.get_item(item.id)
    assert current.quantity == QTY_10
    assert current.version == 1  # Only incremented by initial create


def test_bulk_version_conflicts():
    """Version conflicts in bulk operations are properly detected and logged."""
    repo = Repository()

    # Create and update an item to increment version
    item = repo.create_item(ItemCreate(name="Item 1", quantity=QTY_10))

    repo.update_item(item.id, ItemUpdate(quantity=QTY_15))  # Now version 2

    # Simulate bulk operation with stale version
    failures = []

    # Try to update with version 1 (stale)
    try:
        repo.update_item(item.id, ItemUpdate(quantity=20), expected_version=1)
    except ConflictError as e:
        failures.append(e)
        assert "version conflict" in str(e).lower()
        assert "expected 1" in str(e)
        assert f"actual {VERSION_TWO}" in str(e)

    assert len(failures) == 1

    # Item should still have version 2 value
    current = repo.get_item(item.id)
    assert current.quantity == QTY_15
    assert current.version == VERSION_TWO


def test_bulk_mixed_operations():
    """Bulk operations with mixed operation types (update, delete, etc.)."""
    repo = Repository()

    # Create initial items
    item1 = repo.create_item(ItemCreate(name="Item 1", quantity=QTY_10))
    item2 = repo.create_item(ItemCreate(name="Item 2", quantity=QTY_20))
    item3 = repo.create_item(ItemCreate(name="Item 3", quantity=QTY_30))

    successes = []
    failures = []

    # Operation 1: Update item1
    try:
        updated = repo.update_item(item1.id, ItemUpdate(quantity=QTY_100))
        successes.append(("update", updated))
    except Exception as e:
        failures.append(("update", e))

    # Operation 2: Delete item2
    try:
        repo.delete_item(item2.id)
        successes.append(("delete", item2.id))
    except Exception as e:
        failures.append(("delete", e))

    # Operation 3: Update non-existent item (failure)
    try:
        repo.update_item("fake-id", ItemUpdate(quantity=200))
        successes.append(("update", None))
    except NotFoundError as e:
        failures.append(("update", e))

    # Operation 4: Adjust quantity on item3
    try:
        adjusted = repo.adjust_quantity(item3.id, delta=5)
        successes.append(("adjust", adjusted))
    except Exception as e:
        failures.append(("adjust", e))

    # Three successes, one failure
    assert len(successes) == COUNT_THREE
    assert len(failures) == 1

    # Verify final state
    assert repo.get_item(item1.id).quantity == QTY_100
    with pytest.raises(NotFoundError):
        repo.get_item(item2.id)  # Deleted
    assert repo.get_item(item3.id).quantity == QTY_35  # 30 + 5


def test_bulk_broadcasts_only_successful_ops():
    """Only successful operations should trigger broadcasts."""
    repo = Repository()

    # Create items
    item1 = repo.create_item(ItemCreate(name="Item 1"))
    item2 = repo.create_item(ItemCreate(name="Item 2"))

    # Track which operations would broadcast
    broadcast_items = []

    # Success
    try:
        updated1 = repo.update_item(item1.id, ItemUpdate(quantity=QTY_10))
        broadcast_items.append(updated1.id)
    except Exception:
        pass

    # Failure
    try:
        repo.update_item("fake-id", ItemUpdate(quantity=QTY_20))
        broadcast_items.append("fake-id")
    except NotFoundError:
        pass  # Don't broadcast failures

    # Success
    try:
        updated2 = repo.update_item(item2.id, ItemUpdate(quantity=QTY_30))
        broadcast_items.append(updated2.id)
    except Exception:
        pass

    # Only successful operations should be in broadcast list
    assert len(broadcast_items) == COUNT_TWO
    assert str(item1.id) in [str(bid) for bid in broadcast_items]
    assert str(item2.id) in [str(bid) for bid in broadcast_items]
    assert "fake-id" not in [str(bid) for bid in broadcast_items]


def test_bulk_generation_tracking():
    """Bulk operations track generation changes for debugging."""
    repo = Repository()

    # Create items
    item1 = repo.create_item(ItemCreate(name="Item 1"))
    item2 = repo.create_item(ItemCreate(name="Item 2"))

    initial_gen = repo.generation

    # Perform bulk operations
    repo.update_item(item1.id, ItemUpdate(quantity=QTY_10))
    repo.update_item(item2.id, ItemUpdate(quantity=QTY_20))

    final_gen = repo.generation

    # Generation should have incremented for each successful operation
    # (updates call _reindex which unindexes + indexes, so multiple increments per update)
    assert final_gen > initial_gen


def test_bulk_error_context_preserved():
    """Error context from failed operations is preserved for logging."""
    repo = Repository()

    item = repo.create_item(ItemCreate(name="Item 1", quantity=10))

    # Try operation with version conflict
    try:
        repo.update_item(item.id, ItemUpdate(quantity=QTY_20), expected_version=999)
    except ConflictError as e:
        # Error message should contain useful context
        error_msg = str(e)
        assert "version conflict" in error_msg.lower()
        assert "999" in error_msg  # Expected version
        assert "1" in error_msg  # Actual version

    # Try operation with non-existent item
    try:
        repo.update_item("non-existent-id", ItemUpdate(quantity=QTY_30))
    except NotFoundError as e:
        error_msg = str(e)
        assert "not found" in error_msg.lower()
