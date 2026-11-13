"""Text folding for search and sort.

``normalize_text_for_sort`` is the one normalization both sides of a search go
through, and the key a name sorts under, so "case-insensitive, accent-insensitive"
means the same thing in a query, a stored path and an import's name match.

``LocationPath.from_dict`` re-derives its ``sort_key`` from the display path on
load, so a change to the fold reaches stored paths without a migration.
"""

from __future__ import annotations

import unicodedata
from typing import Final

#: Latin letters Unicode gives no decomposition, folded to the letters a
#: keyboard without them types instead. ``casefold`` already turns "ß" into "ss".
_LATIN_FOLDS: Final = str.maketrans(
    {
        "ø": "o",
        "ł": "l",
        "đ": "d",
        "ð": "d",
        "ħ": "h",
        "\u0131": "i",  # dotless i
        "þ": "th",
        "æ": "ae",
        "œ": "oe",
    }
)


def normalize_text_for_sort(text: str) -> str:
    """Case- and accent-folded, whitespace-collapsed text for sorting and search.

    The one normalization both sides of a search go through, so
    "case-insensitive, accent-insensitive" means the same thing on each.
    Only combining marks are dropped: a letter of any script stays, so a
    Cyrillic or CJK query still has words to match with.
    """

    if not text:
        return ""
    if not text.isascii():
        # Folded before the split because the fold can itself emit a mark
        # ("İ" becomes "i" plus a combining dot), and once more on return
        # because a compatibility form can decompose into capitals.
        decomposed = unicodedata.normalize("NFKD", text.casefold().translate(_LATIN_FOLDS))
        stripped = "".join(char for char in decomposed if not unicodedata.combining(char))
        # Recomposed so Hangul is matched and sorted by syllable, not by jamo.
        text = unicodedata.normalize("NFC", stripped)
    return " ".join(text.split()).casefold()
