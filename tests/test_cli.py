import pytest

from bookrec.cli import load_books
from bookrec.models import Book, Entry, fallback_key
from bookrec.openlibrary import OpenLibraryError
from bookrec.store import Store


@pytest.fixture
def store(tmp_path):
    cache = Store(str(tmp_path / "books.sqlite"))
    yield cache
    cache.close()


def test_load_books_uses_cache_and_applies_input_rating(store, monkeypatch):
    entry = Entry("Dune (Unabridged)", "Frank Herbert", rating=4)
    cached = Book("OL123W", "Dune", "Frank Herbert", "A desert planet.", ["science fiction"], 0.99)
    store.put(fallback_key(entry.title, entry.author), cached)
    monkeypatch.setattr(
        "bookrec.cli.openlibrary.resolve",
        lambda entry: pytest.fail("cached books should not be resolved"),
    )

    (book,) = load_books([entry], store)

    assert book == Book(
        "OL123W", "Dune", "Frank Herbert", "A desert planet.", ["science fiction"], 0.99, 4
    )


def test_load_books_offline_cache_miss_returns_uncached_fallback(store, monkeypatch):
    entry = Entry("Dune", "Frank Herbert", rating=3)
    monkeypatch.setattr(
        "bookrec.cli.openlibrary.resolve",
        lambda entry: pytest.fail("offline cache misses should not use the network"),
    )

    (book,) = load_books([entry], store, offline=True)

    assert book == Book(fallback_key(entry.title, entry.author), "Dune", "Frank Herbert", rating=3)
    assert store.get(fallback_key(entry.title, entry.author)) is None


def test_load_books_lookup_failure_returns_uncached_fallback(store, monkeypatch, capsys):
    entry = Entry("Dune", "Frank Herbert")

    def fail_lookup(entry):
        raise OpenLibraryError("network unavailable")

    monkeypatch.setattr("bookrec.cli.openlibrary.resolve", fail_lookup)

    (book,) = load_books([entry], store)

    assert book == Book(fallback_key(entry.title, entry.author), "Dune", "Frank Herbert")
    assert store.get(fallback_key(entry.title, entry.author)) is None
    assert "lookup failed, using title/author only: network unavailable" in capsys.readouterr().err


def test_load_books_caches_completed_fallback_lookup(store, monkeypatch):
    entry = Entry("Dune", "Frank Herbert", rating=5)
    fallback = Book(fallback_key(entry.title, entry.author), "Dune", "Frank Herbert")
    monkeypatch.setattr("bookrec.cli.openlibrary.resolve", lambda entry: fallback)

    (book,) = load_books([entry], store)

    assert book.rating == 5
    assert store.get(fallback_key(entry.title, entry.author)) == Book(
        fallback.key, fallback.title, fallback.author
    )


def test_load_books_refresh_bypasses_cache_and_replaces_entry(store, monkeypatch):
    entry = Entry("Dune", "Frank Herbert")
    input_key = fallback_key(entry.title, entry.author)
    store.put(input_key, Book("OL1W", "Old title", "Frank Herbert", confidence=0.9))
    refreshed = Book("OL2W", "Dune", "Frank Herbert", confidence=1.0)
    monkeypatch.setattr("bookrec.cli.openlibrary.resolve", lambda entry: refreshed)

    (book,) = load_books([entry], store, refresh=True)

    assert book.key == "OL2W"
    assert store.get(input_key) == refreshed