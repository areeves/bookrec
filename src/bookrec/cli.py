"""Command line interface: python -m bookrec recommend ..."""
from __future__ import annotations

import argparse
import json
import os
import sys

from . import openlibrary
from .importers import load_csv
from .models import Book, Entry, fallback_key
from .scoring import Embedder, recommend
from .store import Store

LOW_CONFIDENCE = 0.8


def log(message: str) -> None:
    print(message, file=sys.stderr)


def load_books(
    entries: list[Entry], store: Store, refresh: bool = False, offline: bool = False
) -> list[Book]:
    books = []
    for i, entry in enumerate(entries, 1):
        input_key = fallback_key(entry.title, entry.author)
        book = None if refresh else store.get(input_key)
        if book is None:
            if offline:
                book = Book(key=input_key, title=entry.title, author=entry.author)
            else:
                log(f"  [{i}/{len(entries)}] looking up: {entry.title}")
                try:
                    book = openlibrary.resolve(entry)
                except openlibrary.OpenLibraryError as exc:
                    log(f"    lookup failed, using title/author only: {exc}")
                    book = Book(key=input_key, title=entry.title, author=entry.author)
                else:  # cache only completed lookups, never network failures
                    store.put(input_key, book)
        book.rating = entry.rating
        books.append(book)
    return books


def report_weak_matches(label: str, books: list[Book]) -> None:
    weak = [b for b in books if b.confidence < LOW_CONFIDENCE]
    if weak:
        log(f"{label}: {len(weak)} unresolved or low-confidence match(es), worth a look:")
        for b in weak:
            status = f"{b.confidence:.2f}" if b.resolved else "unresolved"
            log(f"  - {b.title} / {b.author} ({status})")


def cmd_recommend(args: argparse.Namespace) -> int:
    store = Store(args.db)
    try:
        log("Loading read list...")
        read = load_books(
            load_csv(args.read, only_read=True), store, args.refresh, args.offline
        )
        log("Loading candidate list...")
        cands = load_books(load_csv(args.candidates), store, args.refresh, args.offline)
    finally:
        store.close()

    report_weak_matches("Read list", read)
    report_weak_matches("Candidates", cands)

    log("Scoring...")
    recs = recommend(read, cands, Embedder(), k=args.k, m=args.m, mmr_lambda=args.mmr)

    if args.json:
        print(
            json.dumps(
                [
                    {
                        "title": r.book.title,
                        "author": r.book.author,
                        "key": r.book.key,
                        "score": round(r.score, 4),
                        "because": [
                            {"title": b.title, "similarity": round(s, 4)}
                            for b, s in r.because
                        ],
                    }
                    for r in recs
                ],
                indent=2,
            )
        )
        return 0

    for n, r in enumerate(recs, 1):
        print(f"{n:>2}. {r.book.title} - {r.book.author}  (score {r.score:.3f})")
        because = "; ".join(f"{b.title} ({s:.2f})" for b, s in r.because)
        print(f"      because you read: {because}")
    if not recs:
        print("No recommendations (empty lists, or every candidate was already read).")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="bookrec")
    sub = parser.add_subparsers(dest="command", required=True)

    rec = sub.add_parser("recommend", help="recommend K candidates based on a read list")
    rec.add_argument("--read", required=True, help="CSV of books already read (List A)")
    rec.add_argument("--candidates", required=True, help="CSV of candidate books (List B)")
    rec.add_argument("-k", type=int, default=10, help="number of recommendations")
    rec.add_argument("-m", type=int, default=3, help="top-m similarities averaged per candidate")
    rec.add_argument("--mmr", type=float, default=0.7, help="MMR lambda (1.0 = no diversity)")
    rec.add_argument("--db", default=os.environ.get("BOOKREC_DB", "data/bookrec.sqlite"))
    rec.add_argument("--refresh", action="store_true", help="ignore cached lookups")
    rec.add_argument("--offline", action="store_true", help="use cache only, no network")
    rec.add_argument("--json", action="store_true", help="machine-readable output")
    rec.set_defaults(func=cmd_recommend)
    return parser


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    sys.exit(args.func(args))
