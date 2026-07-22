"""Offline tests for repository text search (Phase 2.4)."""

import pytest
from custom_components.haventory.repository import Repository

# ruff: noqa: PLR2004


@pytest.mark.asyncio
async def test_fast_text_search_exact_words() -> None:
    """Fast text search finds exact word matches."""
    repo = Repository()

    # Setup items
    i1 = repo.create_item({"name": "Phillips Screw 50mm", "tags": ["hardware"]})
    i2 = repo.create_item({"name": "Flathead Screw 30mm", "tags": ["hardware"]})
    repo.create_item({"name": "Hammer", "description": "Heavy duty"})

    # Search for "Phillips"
    results = repo.list_items(flt={"q": "Phillips"})["items"]
    assert len(results) == 1
    assert results[0].id == i1.id

    # Search for "screw" (case insensitive)
    results = repo.list_items(flt={"q": "screw"})["items"]
    assert len(results) == 2
    assert {x.id for x in results} == {i1.id, i2.id}

    # Search for "50mm"
    results = repo.list_items(flt={"q": "50mm"})["items"]
    assert len(results) == 1
    assert results[0].id == i1.id


@pytest.mark.asyncio
async def test_text_search_prefix_autocomplete() -> None:
    """Text search supports name prefix matching for autocomplete."""
    repo = Repository()
    i1 = repo.create_item({"name": "Screwdriver"})
    i2 = repo.create_item({"name": "Screw"})
    repo.create_item({"name": "Scraper"})

    # Search for "Scr" should match all
    results = repo.list_items(flt={"q": "Scr"})["items"]
    assert len(results) == 3

    # Search for "Screw" should match Screwdriver and Screw
    results = repo.list_items(flt={"q": "Screw"})["items"]
    assert len(results) == 2
    assert {x.id for x in results} == {i1.id, i2.id}

    # Search for "Screwd"
    results = repo.list_items(flt={"q": "Screwd"})["items"]
    assert len(results) == 1
    assert results[0].id == i1.id


@pytest.mark.asyncio
async def test_text_search_fuzzy_matching() -> None:
    """Text search provides basic typo tolerance via trigrams."""
    repo = Repository()
    i1 = repo.create_item({"name": "Battery AA"})

    # Substring search via trigrams (not a prefix)
    # "atter" exists within "Battery"

    # "atter" -> att, tte, ter. All are in "Battery".
    results = repo.list_items(flt={"q": "atter"})["items"]
    assert len(results) == 1
    assert results[0].id == i1.id


@pytest.mark.asyncio
async def test_text_search_accent_insensitive_end_to_end() -> None:
    """Accent-insensitive search works through list_items (index + post-filter).

    Regression: the index normalized accents (NFKD) but the filter_items
    post-filter only casefolded, so "cafe" found the candidate in the index
    and then discarded it — list_items returned nothing for unaccented queries
    against accented content.
    """
    repo = Repository()
    i1 = repo.create_item({"name": "Probe Café"})
    repo.create_item({"name": "Plain Mug"})

    # Unaccented query vs accented content (the previously broken direction)
    for query in ("cafe", "CAFE", "Cafe"):
        results = repo.list_items(flt={"q": query})["items"]
        assert len(results) == 1, f"q={query!r} should match 'Probe Café'"
        assert results[0].id == i1.id

    # Accented query still works
    results = repo.list_items(flt={"q": "café"})["items"]
    assert len(results) == 1
    assert results[0].id == i1.id

    # Prefix search stays accent-insensitive too
    results = repo.list_items(flt={"q": "caf"})["items"]  # codespell:ignore caf
    assert len(results) == 1
    assert results[0].id == i1.id


@pytest.mark.asyncio
async def test_text_search_multi_word_and_logic() -> None:
    """Multi-word text search uses AND logic."""
    repo = Repository()
    i1 = repo.create_item({"name": "Red Box", "description": "Large"})
    repo.create_item({"name": "Blue Box", "description": "Small"})
    repo.create_item({"name": "Red Bag", "description": "Large"})

    # "Red Box" -> matches i1 only
    results = repo.list_items(flt={"q": "Red Box"})["items"]
    assert len(results) == 1
    assert results[0].id == i1.id

    # "Large" -> matches i1, i3
    results = repo.list_items(flt={"q": "Large"})["items"]
    assert len(results) == 2

    # "Red Large" -> matches i1, i3 (Wait... Red is in name, Large in desc. Should match both)
    results = repo.list_items(flt={"q": "Red Large"})["items"]
    # i1: name="Red Box", desc="Large". Matches Red AND Large.
    # i3: name="Red Bag", desc="Large". Matches Red AND Large.
    assert len(results) == 2

    # "Blue Large" -> i2 has Blue but Small. i1/i3 have Large but Red. Should be 0.
    results = repo.list_items(flt={"q": "Blue Large"})["items"]
    assert len(results) == 0
