from bookrec.importers import load_csv
from bookrec.models import Book, Entry, author_surname, fallback_key, normalize_title
from bookrec.openlibrary import pick_best


def test_normalize_title():
    assert normalize_title("Project Hail Mary (Unabridged)") == "project hail mary"
    assert normalize_title("Dune: Book One (Dune Chronicles, #1)") == "dune"
    assert normalize_title("The Name of the Wind - Kingkiller 1") == "the name of the wind"
    assert normalize_title("Les Misérables") == "les miserables"
    assert normalize_title("(Untitled)") == "untitled"  # never normalizes to empty


def test_author_surname():
    assert author_surname("Tolkien, J. R. R.") == "tolkien"
    assert author_surname("J. R. R. Tolkien") == "tolkien"
    assert author_surname("Neil Gaiman & Terry Pratchett") == "gaiman"
    assert author_surname("") == ""


def test_fallback_key_matches_across_sources():
    assert fallback_key("Dune (Unabridged)", "Frank Herbert") == fallback_key(
        "Dune", "Herbert, Frank"
    )


def test_book_resolved_flag():
    assert Book("OL45804W", "Dune", "x").resolved
    assert not Book("dune|herbert", "Dune", "x").resolved


def test_load_goodreads_style_csv(tmp_path):
    f = tmp_path / "read.csv"
    f.write_text(
        'Title,Author,My Rating,ISBN13,Exclusive Shelf\n'
        'Dune,Frank Herbert,5,="9780441172719",read\n'
        'Emma,Jane Austen,0,="",to-read\n'
    )
    assert len(load_csv(f)) == 2
    (entry,) = load_csv(f, only_read=True)
    assert entry == Entry("Dune", "Frank Herbert", 5.0, "9780441172719")


def test_pick_best_prefers_matching_title_and_author():
    entry = Entry("Dune (Unabridged)", "Frank Herbert")
    docs = [
        {"key": "/works/OL1W", "title": "Dune Messiah", "author_name": ["Frank Herbert"]},
        {"key": "/works/OL2W", "title": "Dune", "author_name": ["Frank Herbert"]},
        {"key": "/works/OL3W", "title": "Dune", "author_name": ["Someone Else"]},
    ]
    doc, confidence = pick_best(entry, docs)
    assert doc["key"] == "/works/OL2W"
    assert confidence > 0.95
    assert pick_best(entry, [])[0] is None
