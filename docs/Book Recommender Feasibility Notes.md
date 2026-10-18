# Book Recommender: Feasibility Notes

&#32;&#32;&#32;&#32;&#32;&#32;Oct 18, 2026 · @Andrew Reeves

## Verdict

Feasibility is high: a working MVP is a few days of work. The hard part is data wrangling (matching books across sources and getting decent metadata), not the recommendation math.

The idea: List A holds books the user has read, List B holds candidates. The app scores every A-B pair by similarity, aggregates by B book, and returns the top K.

## Metadata sources

Try Open Library first, fall back to Google Books for descriptions, and cache everything in SQLite so each book is fetched once. Verify current quotas and terms before committing, since these change.

| Source | Access | Strengths | Weaknesses |
| --- | --- | --- | --- |
| Open Library | Free, no key | Title/author search, ISBN lookup, bulk dumps, decent subjects | Descriptions often missing or thin |
| Google Books API | Free with key, daily quota | Usually good descriptions | Coarse categories |
| Hardcover | GraphQL API | Richest community genres and tags ("vibe" signal) | Check current terms and rate limits |
| Goodreads / Audible | No public API (Goodreads shut it down; Audible never had one) | Good as user export inputs | Scraping is fragile and against their terms |

## Unique key

Use a work-level ID, not ISBN. An ISBN identifies an edition, so the audiobook, hardcover and paperback of one book all differ. Audible uses ASINs, and some books have no ISBN at all. The Open Library work ID (`OL...W`) groups all editions together.

1. Normalize input title and author: strip subtitles, "(Unabridged)" and "(Book 2)" markers, and lowercase.
2. Resolve to a work ID via search, with a fuzzy-match confidence score.
3. If resolution fails, fall back to a normalized `title + first-author-surname` key.
4. Store every source ID (ASIN, ISBN, Goodreads ID) as an alias pointing at your internal ID.

Flag low-confidence matches for a quick manual review. This step is the long pole of the project, and it also lets you drop books from List B that the user has already read.

## Scoring and aggregation

Embedding each book's text (title, author, subjects, description) and taking cosine similarity is a solid baseline. A small local model such as `bge-small` or `all-MiniLM-L6-v2` works fine, or a hosted embeddings API costs pennies. The A x B comparison is a single matrix multiply, so with about 1,000 books per side it takes milliseconds and needs no top-N pruning.

The best aggregation is the mean of the top-m similarities (m of 3 to 5). It is effectively k-nearest-neighbors against the user's history and handles readers with varied tastes.

| Aggregation | Behavior | Verdict |
| --- | --- | --- |
| Mean of all pairs | Same as comparing against the centroid of A; blurs varied tastes into one bland average | Weak |
| Sum | Rewards having more books, not better fit | Not useful |
| Max | Great for explanations ("similar to one specific book") but noisy | Situational |
| Mean of top-m (m about 3-5) | Handles multi-taste readers well | Recommended |

Refinements:

- Weight A books by rating or recency if the exports include them.
- Pick the final K with MMR (maximal marginal relevance) so results are not K near-duplicates.
- Show the top 2-3 contributing A books per recommendation ("because you read..."), which makes results easy to sanity-check.
- Optionally add small boosts for same author, genre overlap or series.
- Note the limit: semantic similarity from publisher blurbs captures topic and genre better than writing style or quality.

To evaluate, hide a few books from List A, mix them into B with random books, and check how highly they rank.

## Stack and effort

A minimal stack is Python, SQLite, numpy and sentence-transformers. Start with a CLI, then add Streamlit or a small FastAPI app if you want a web UI.

| Piece | Rough effort |
| --- | --- |
| Importers and normalization | About 1 day |
| Work resolution and metadata fetching | 1-2 days |
| Scoring | A few hours |
| UI | About 1 day |

Next step: prototype the core (unified format, Open Library resolver, embedding and scoring) and try it on a real export.
