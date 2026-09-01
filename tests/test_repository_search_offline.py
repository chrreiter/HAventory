"""Offline tests for repository text search.

``q`` is a substring test: every word of the normalized query must appear
somewhere in the normalized name, description, category, tags or location
display path of an item. These tests are what that contract means in cases a
faster shortcut over words or fragments would get wrong.
"""

from custom_components.haventory.repository import Repository

# ruff: noqa: PLR2004


def test_fast_text_search_exact_words() -> None:
    """Fast text search finds exact word matches."""
    repo = Repository()

    i1 = repo.create_item({"name": "Phillips Screw 50mm", "tags": ["hardware"]})
    i2 = repo.create_item({"name": "Flathead Screw 30mm", "tags": ["hardware"]})
    repo.create_item({"name": "Hammer", "description": "Heavy duty"})

    results = repo.list_items(flt={"q": "Phillips"})["items"]
    assert len(results) == 1
    assert results[0].id == i1.id

    results = repo.list_items(flt={"q": "screw"})["items"]
    assert len(results) == 2
    assert {x.id for x in results} == {i1.id, i2.id}

    results = repo.list_items(flt={"q": "50mm"})["items"]
    assert len(results) == 1
    assert results[0].id == i1.id


def test_text_search_prefix_autocomplete() -> None:
    """Text search supports name prefix matching for autocomplete."""
    repo = Repository()
    i1 = repo.create_item({"name": "Screwdriver"})
    i2 = repo.create_item({"name": "Screw"})
    repo.create_item({"name": "Scraper"})

    results = repo.list_items(flt={"q": "Scr"})["items"]
    assert len(results) == 3

    results = repo.list_items(flt={"q": "Screw"})["items"]
    assert len(results) == 2
    assert {x.id for x in results} == {i1.id, i2.id}

    results = repo.list_items(flt={"q": "Screwd"})["items"]
    assert len(results) == 1
    assert results[0].id == i1.id


def test_text_search_matches_inside_a_word() -> None:
    """A fragment that starts no word still matches the word holding it."""
    repo = Repository()
    i1 = repo.create_item({"name": "Battery AA"})

    results = repo.list_items(flt={"q": "atter"})["items"]
    assert len(results) == 1
    assert results[0].id == i1.id


def test_text_search_accent_insensitive_end_to_end() -> None:
    """An unaccented query finds accented content through ``list_items``."""
    repo = Repository()
    i1 = repo.create_item({"name": "Probe Café"})
    repo.create_item({"name": "Plain Mug"})

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


def test_text_search_multi_word_and_logic() -> None:
    """Multi-word text search uses AND logic."""
    repo = Repository()
    i1 = repo.create_item({"name": "Red Box", "description": "Large"})
    repo.create_item({"name": "Blue Box", "description": "Small"})
    repo.create_item({"name": "Red Bag", "description": "Large"})

    results = repo.list_items(flt={"q": "Red Box"})["items"]
    assert len(results) == 1
    assert results[0].id == i1.id

    results = repo.list_items(flt={"q": "Large"})["items"]
    assert len(results) == 2

    results = repo.list_items(flt={"q": "Red Large"})["items"]
    # i1: name="Red Box", desc="Large". Matches Red AND Large.
    # i3: name="Red Bag", desc="Large". Matches Red AND Large.
    assert len(results) == 2

    results = repo.list_items(flt={"q": "Blue Large"})["items"]
    assert len(results) == 0


def test_text_search_short_fragment_matches_mid_word() -> None:
    """A one- or two-character fragment matches mid-word like any other.

    The contract is a substring test over the item's text, so query length
    carries no meaning of its own — a fragment too short to be a word is
    answered exactly like a long one.
    """
    repo = Repository()
    i1 = repo.create_item({"name": "Kiwi"})
    repo.create_item({"name": "Hammer"})

    results = repo.list_items(flt={"q": "wi"})["items"]
    assert len(results) == 1
    assert results[0].id == i1.id

    results = repo.list_items(flt={"q": "w"})["items"]
    assert len(results) == 1
    assert results[0].id == i1.id


def test_short_fragment_matches_beyond_the_word_starts_it_hits() -> None:
    """A fragment returns mid-word matches alongside the word-start ones.

    "wi" starts "Wine" and sits inside "Kiwi"; both are matches, and an answer
    holding only the word-start one is the shape a word-keyed shortcut produces.
    """
    repo = Repository()
    kiwi = repo.create_item({"name": "Kiwi"})
    wine = repo.create_item({"name": "Wine"})
    repo.create_item({"name": "Hammer"})

    results = repo.list_items(flt={"q": "wi"})["items"]
    assert {x.id for x in results} == {kiwi.id, wine.id}


def test_a_q_filter_still_narrows_by_its_siblings() -> None:
    """``q`` alongside an indexed filter answers over that filter's candidates."""
    repo = Repository()
    kiwi = repo.create_item({"name": "Kiwi", "category": "Fruit"})
    repo.create_item({"name": "Kiwi Box", "category": "Storage"})

    results = repo.list_items(flt={"q": "wi", "category": "Fruit"})["items"]
    assert [x.id for x in results] == [kiwi.id]


def test_punctuation_only_query_is_matched_literally() -> None:
    """Punctuation is text like any other, not a query with nothing in it."""
    repo = Repository()
    i1 = repo.create_item({"name": "Wow!!!"})
    repo.create_item({"name": "Hammer"})

    results = repo.list_items(flt={"q": "!!!"})["items"]
    assert len(results) == 1
    assert results[0].id == i1.id


def test_mid_word_match_survives_a_word_start_hit_elsewhere() -> None:
    """A fragment that is one item's whole word still matches inside others.

    The answer is a substring test per item, so what any other item is called
    cannot decide whether this one matches.
    """
    repo = Repository()
    light = repo.create_item({"name": "Light"})
    flashlight = repo.create_item({"name": "Flashlight"})
    repo.create_item({"name": "Hammer"})

    results = repo.list_items(flt={"q": "light"})["items"]
    assert {x.id for x in results} == {light.id, flashlight.id}


def test_accented_query_matches_unaccented_content() -> None:
    """Accents are stripped on both sides, so either spelling finds the other."""
    repo = Repository()
    plain = repo.create_item({"name": "Cafe Sign"})
    repo.create_item({"name": "Plain Mug"})

    for query in ("café", "CAFÉ", "Café"):
        results = repo.list_items(flt={"q": query})["items"]
        assert [x.id for x in results] == [plain.id], f"q={query!r} should match 'Cafe Sign'"


def test_multi_word_query_ands_across_fields_and_the_path() -> None:
    """Each query word may land in a different field, and all of them must land."""
    repo = Repository()
    shelf = repo.create_location(name="Basement Shelf")
    match = repo.create_item(
        {
            "name": "Torch",
            "description": "Spare emergency lamp",
            "category": "Tools",
            "tags": ["camping"],
            "location_id": str(shelf.id),
        }
    )
    repo.create_item({"name": "Torch", "description": "Spare emergency lamp"})

    # name + description + tag + category + display path, one word from each.
    results = repo.list_items(flt={"q": "torch emergency camping tools basement"})["items"]
    assert [x.id for x in results] == [match.id]

    # A word no field carries drops the item, however many of the others match.
    results = repo.list_items(flt={"q": "torch attic"})["items"]
    assert results == []


def test_a_query_that_normalizes_away_narrows_nothing() -> None:
    """A query that ASCII folding empties matches every item.

    ``normalize_search_text`` keeps only what NFKD can render as ASCII, so a
    query written in a script without word boundaries — Japanese here — reduces
    to no words at all, and a filter with no words to test excludes nobody.
    """
    repo = Repository()
    battery = repo.create_item({"name": "電池ケース"})
    hammer = repo.create_item({"name": "Hammer"})

    results = repo.list_items(flt={"q": "電池"})["items"]
    assert {x.id for x in results} == {battery.id, hammer.id}
