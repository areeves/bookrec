"""Unified data model plus title/author normalization."""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Entry:
    """One row of an input list after mapping to the unified format."""

    title: str
    author: str = ""
    rating: float | None = None  # 1-5, None when unrated
    source_id: str = ""  # ISBN/ASIN/etc. from the source, kept as an alias


@dataclass
class Book:
    """A resolved book with the metadata used for scoring."""

    key: str  # Open Library work ID (OL...W) or fallback "title|surname"
    title: str
    author: str
    description: str = ""
    subjects: list[str] = field(default_factory=list)
    confidence: float = 0.0  # 0..1 match confidence; 0 means unresolved
    rating: float | None = None

    @property
    def resolved(self) -> bool:
        return re.fullmatch(r"OL\d+W", self.key) is not None


def _ascii(text: str) -> str:
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()


_NOISE = re.compile(r"\b(unabridged|abridged|a novel|audiobook)\b")


def normalize_title(title: str) -> str:
    """Lowercase, drop "(Unabridged)"/"(Book 2)" markers and subtitles."""
    t = _ascii(title).lower()
    for step in (
        lambda s: re.sub(r"[\(\[].*?[\)\]]", " ", s),
        lambda s: re.split(r"\s*[:–—]\s*|\s+-\s+", s)[0],
        lambda s: _NOISE.sub(" ", s),
    ):
        candidate = step(t)
        if re.search(r"[a-z0-9]", candidate):  # never reduce a title to nothing
            t = candidate
    return re.sub(r"[^a-z0-9]+", " ", t).strip()


def author_surname(author: str) -> str:
    """Surname of the first listed author ("Tolkien, J. R. R." -> "tolkien")."""
    a = _ascii(author).lower()
    a = re.split(r"\s*(?:;|&|\band\b)\s*", a)[0]
    a = a.split(",")[0]
    tokens = re.sub(r"[^a-z ]+", " ", a).split()
    return tokens[-1] if tokens else ""


def fallback_key(title: str, author: str) -> str:
    """Key used when no work ID can be resolved, and as the cache lookup key."""
    return f"{normalize_title(title)}|{author_surname(author)}"
