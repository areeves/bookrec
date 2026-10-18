"""Embedding, similarity, aggregation and diversification."""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Callable

import numpy as np

from .models import Book

Embed = Callable[[list[str]], np.ndarray]  # returns L2-normalized rows


class Embedder:
    """Lazy sentence-transformers wrapper (the model loads on first use)."""

    def __init__(self, model_name: str | None = None):
        self.model_name = model_name or os.environ.get(
            "BOOKREC_MODEL", "sentence-transformers/all-MiniLM-L6-v2"
        )
        self._model = None

    def __call__(self, texts: list[str]) -> np.ndarray:
        if self._model is None:
            from sentence_transformers import SentenceTransformer

            self._model = SentenceTransformer(self.model_name)
        return np.asarray(
            self._model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
        )


def embed_text(book: Book) -> str:
    parts = [f"{book.title} by {book.author}."]
    if book.subjects:
        parts.append("Subjects: " + ", ".join(book.subjects) + ".")
    if book.description:
        parts.append(book.description)
    return " ".join(parts)


def similarity_matrix(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Cosine similarity for L2-normalized rows; shape (len(b), len(a))."""
    return b @ a.T


def rating_weights(ratings: list[float | None]) -> np.ndarray:
    """Unrated -> 1.0; rated books scale by rating/5, floored at 0.2."""
    return np.array(
        [1.0 if r is None else float(np.clip(r / 5.0, 0.2, 1.0)) for r in ratings]
    )


def aggregate(sim: np.ndarray, m: int = 3, weights: np.ndarray | None = None) -> np.ndarray:
    """Per candidate: mean of its top-m (weighted) similarities to read books."""
    if weights is not None:
        sim = sim * weights[None, :]
    m = max(1, min(m, sim.shape[1]))
    top = -np.sort(-sim, axis=1)[:, :m]
    return top.mean(axis=1)


def mmr_select(
    scores: np.ndarray, emb: np.ndarray, k: int, lam: float = 0.7
) -> list[int]:
    """Maximal marginal relevance: balance score against redundancy."""
    remaining = list(range(len(scores)))
    selected: list[int] = []
    while remaining and len(selected) < k:
        if not selected:
            pick = max(remaining, key=lambda i: scores[i])
        else:
            redundancy = (emb[remaining] @ emb[selected].T).max(axis=1)
            mmr = lam * scores[remaining] - (1 - lam) * redundancy
            pick = remaining[int(np.argmax(mmr))]
        selected.append(pick)
        remaining.remove(pick)
    return selected


@dataclass
class Rec:
    book: Book
    score: float
    because: list[tuple[Book, float]]  # (read book, similarity)


def recommend(
    read: list[Book],
    candidates: list[Book],
    embed: Embed,
    k: int = 10,
    m: int = 3,
    mmr_lambda: float = 0.7,
    explain: int = 3,
) -> list[Rec]:
    read_keys = {b.key for b in read}
    seen: set[str] = set()
    cands: list[Book] = []
    for c in candidates:  # drop already-read and duplicate candidates
        if c.key in read_keys or c.key in seen:
            continue
        seen.add(c.key)
        cands.append(c)
    if not read or not cands:
        return []

    a = embed([embed_text(b) for b in read])
    b = embed([embed_text(c) for c in cands])
    sim = similarity_matrix(a, b)
    weights = rating_weights([x.rating for x in read])
    scores = aggregate(sim, m, weights)

    recs = []
    for i in mmr_select(scores, b, k, mmr_lambda):
        top = np.argsort(-(sim[i] * weights))[:explain]
        recs.append(
            Rec(cands[i], float(scores[i]), [(read[j], float(sim[i, j])) for j in top])
        )
    return recs
