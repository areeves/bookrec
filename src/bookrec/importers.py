"""Map exported CSV files (Goodreads, Audible-style, hand-made) to Entry rows."""
from __future__ import annotations

import csv
from pathlib import Path

from .models import Entry

# Header aliases per field, checked in order, case-insensitively.
_ALIASES = {
    "title": ("title", "book title", "name"),
    "author": ("author", "authors", "author name"),
    "rating": ("my rating", "your rating", "rating", "user rating"),
    "source_id": ("isbn13", "isbn", "asin", "book id", "id"),
    "shelf": ("exclusive shelf",),  # Goodreads: read / to-read / currently-reading
}


def _clean_id(value: str) -> str:
    # Goodreads writes ISBNs as ="9780441172719"
    return value.replace("=", "").replace('"', "").strip()


def _parse_rating(value: str) -> float | None:
    try:
        rating = float(value)
    except ValueError:
        return None
    return min(rating, 5.0) if rating > 0 else None  # Goodreads uses 0 for unrated


def load_csv(path: str | Path, only_read: bool = False) -> list[Entry]:
    """Load a CSV into Entry rows.

    With only_read=True, rows from a Goodreads-style "Exclusive Shelf" column
    are kept only when the shelf is "read".
    """
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            return []
        cols = {name.strip().lower(): name for name in reader.fieldnames}
        if not any(alias in cols for alias in _ALIASES["title"]):
            raise ValueError(
                f"{path}: no title column found (looked for {_ALIASES['title']})"
            )

        def pick(row: dict, kind: str) -> str:
            for alias in _ALIASES[kind]:
                if alias in cols:
                    value = (row.get(cols[alias]) or "").strip()
                    if value:
                        return value
            return ""

        entries = []
        for row in reader:
            title = pick(row, "title")
            if not title:
                continue
            if only_read:
                shelf = pick(row, "shelf").lower()
                if shelf and shelf != "read":
                    continue
            entries.append(
                Entry(
                    title=title,
                    author=pick(row, "author"),
                    rating=_parse_rating(pick(row, "rating")),
                    source_id=_clean_id(pick(row, "source_id")),
                )
            )
        return entries
