"""SQLite cache so each book is looked up online only once."""
from __future__ import annotations

import json
import os
import sqlite3

from .models import Book


class Store:
    def __init__(self, path: str):
        directory = os.path.dirname(path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.execute(
            """CREATE TABLE IF NOT EXISTS resolved (
                   input_key   TEXT PRIMARY KEY,  -- normalized "title|surname" of the input
                   work_key    TEXT NOT NULL,
                   title       TEXT NOT NULL,
                   author      TEXT NOT NULL,
                   description TEXT NOT NULL,
                   subjects    TEXT NOT NULL,     -- JSON list
                   confidence  REAL NOT NULL
               )"""
        )
        self.db.commit()

    def get(self, input_key: str) -> Book | None:
        row = self.db.execute(
            "SELECT work_key, title, author, description, subjects, confidence "
            "FROM resolved WHERE input_key = ?",
            (input_key,),
        ).fetchone()
        if row is None:
            return None
        return Book(
            key=row[0],
            title=row[1],
            author=row[2],
            description=row[3],
            subjects=json.loads(row[4]),
            confidence=row[5],
        )

    def put(self, input_key: str, book: Book) -> None:
        self.db.execute(
            "INSERT OR REPLACE INTO resolved VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                input_key,
                book.key,
                book.title,
                book.author,
                book.description,
                json.dumps(book.subjects),
                book.confidence,
            ),
        )
        self.db.commit()

    def close(self) -> None:
        self.db.close()
