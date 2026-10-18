"""Resolve entries to Open Library works and fetch description/subjects."""
from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from difflib import SequenceMatcher

from .models import Book, Entry, author_surname, fallback_key, normalize_title

BASE = "https://openlibrary.org"
USER_AGENT = "bookrec/0.1 (personal project)"
MIN_CONFIDENCE = 0.6  # below this the match is treated as unresolved
MAX_SUBJECTS = 15
_MIN_INTERVAL = 0.4  # seconds between requests, to stay polite
_last_call = 0.0


class OpenLibraryError(RuntimeError):
    """Network or server failure (not the same as "no match found")."""


def _get_json(path: str, params: dict | None = None, retries: int = 3):
    global _last_call
    url = BASE + path + ("?" + urllib.parse.urlencode(params) if params else "")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(retries):
        wait = _MIN_INTERVAL - (time.monotonic() - _last_call)
        if wait > 0:
            time.sleep(wait)
        _last_call = time.monotonic()
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return None
            if exc.code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                time.sleep(2**attempt)
                continue
            raise OpenLibraryError(f"HTTP {exc.code} for {url}") from exc
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            if attempt < retries - 1:
                time.sleep(2**attempt)
                continue
            raise OpenLibraryError(f"{exc} for {url}") from exc
    raise OpenLibraryError(f"gave up on {url}")


def search(title: str, author: str) -> list[dict]:
    fields = "key,title,author_name,subject"
    params = {"title": normalize_title(title), "limit": 5, "fields": fields}
    if author:
        params["author"] = author
    docs = (_get_json("/search.json", params) or {}).get("docs", [])
    if not docs:  # looser free-text fallback
        params = {"q": f"{title} {author}".strip(), "limit": 5, "fields": fields}
        docs = (_get_json("/search.json", params) or {}).get("docs", [])
    return docs


def score_doc(entry: Entry, doc: dict) -> float:
    """0..1 match confidence: 70% title similarity, 30% author surname."""
    title_sim = SequenceMatcher(
        None, normalize_title(entry.title), normalize_title(doc.get("title", ""))
    ).ratio()
    if entry.author:
        want = author_surname(entry.author)
        have = [author_surname(a) for a in doc.get("author_name", [])]
        author_sim = max(
            (SequenceMatcher(None, want, h).ratio() for h in have), default=0.0
        )
    else:
        author_sim = title_sim
    return 0.7 * title_sim + 0.3 * author_sim


def pick_best(entry: Entry, docs: list[dict]) -> tuple[dict | None, float]:
    best, best_score = None, 0.0
    for doc in docs:
        score = score_doc(entry, doc)
        if score > best_score:
            best, best_score = doc, score
    return best, best_score


def fetch_description(work_key: str) -> str:
    data = _get_json(f"/works/{work_key}.json") or {}
    description = data.get("description", "")
    if isinstance(description, dict):
        description = description.get("value", "")
    # Open Library descriptions often append "-----" followed by source links.
    return re.split(r"\n-{5,}", description)[0].strip()


def resolve(entry: Entry) -> Book:
    """Look the entry up online. Unmatched entries get the fallback key."""
    docs = search(entry.title, entry.author)
    doc, confidence = pick_best(entry, docs)
    if doc is None or confidence < MIN_CONFIDENCE:
        return Book(
            key=fallback_key(entry.title, entry.author),
            title=entry.title,
            author=entry.author,
            confidence=0.0,
        )
    work_key = doc["key"].removeprefix("/works/")
    authors = doc.get("author_name") or [entry.author]
    return Book(
        key=work_key,
        title=doc.get("title", entry.title),
        author=authors[0],
        description=fetch_description(work_key),
        subjects=list(doc.get("subject", []))[:MAX_SUBJECTS],
        confidence=confidence,
    )
