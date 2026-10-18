import numpy as np

from bookrec.models import Book
from bookrec.scoring import aggregate, mmr_select, rating_weights, recommend


def unit(*v):
    v = np.array(v, dtype=float)
    return v / np.linalg.norm(v)


def test_aggregate_top_m_mean():
    sim = np.array([[0.9, 0.1, 0.5]])
    assert aggregate(sim, m=1)[0] == 0.9
    assert np.isclose(aggregate(sim, m=2)[0], 0.7)
    assert np.isclose(aggregate(sim, m=99)[0], 0.5)  # m is capped at |A|


def test_rating_weights_scale_and_floor():
    w = rating_weights([None, 5, 3, 1])
    assert list(w) == [1.0, 1.0, 0.6, 0.2]


def test_low_rated_books_count_less():
    sim = np.array([[0.9, 0.9]])
    scores = aggregate(sim, m=1, weights=np.array([0.2, 1.0]))
    assert scores[0] == 0.9  # the well-rated read book dominates


def test_mmr_prefers_diverse_second_pick():
    emb = np.array([unit(0.95, 0.05, 0), unit(0.9, 0.1, 0), unit(0, 0.85, 0.15)])
    scores = np.array([0.9986, 0.9939, 0.985])
    assert mmr_select(scores, emb, k=2, lam=1.0) == [0, 1]  # relevance only
    assert mmr_select(scores, emb, k=2, lam=0.7) == [0, 2]  # diversity kicks in


def test_recommend_excludes_read_and_duplicates():
    vectors = {
        "A1": unit(1, 0), "A2": unit(0, 1),
        "C1": unit(1, 0.1), "C2": unit(0, 1), "C3": unit(1, 0),
    }

    def embed(texts):
        return np.array([vectors[t.split(" by ")[0]] for t in texts])

    read = [Book("k1", "A1", "x"), Book("k2", "A2", "x")]
    cands = [
        Book("k1", "C3", "x"),  # same key as a read book -> dropped
        Book("c1", "C1", "x"),
        Book("c1", "C1", "x"),  # duplicate -> dropped
        Book("c2", "C2", "x"),
    ]
    recs = recommend(read, cands, embed, k=5, m=1)
    assert [r.book.key for r in recs] == ["c2", "c1"]
    assert recs[0].because[0][0].title == "A2"
