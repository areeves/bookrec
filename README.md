# bookrec

Recommends K books from a candidate list (List B) based on books you have read (List A).

Pipeline: CSV import -> resolve each book to an Open Library work (cached in SQLite) ->
embed title/author/subjects/description -> score every candidate by the mean of its
top-m similarities to your read books -> pick K with MMR for diversity.

## Run (Docker)

Put your CSVs in `input/` (samples included), then:

```bash
docker compose build
docker compose run --rm app recommend \
  --read /input/read.csv --candidates /input/candidates.csv -k 5
```

The SQLite cache and the downloaded embedding model live in the `bookrec-data`
volume, so only the first run is slow. `src/` is bind-mounted, so code edits need
no rebuild.

Useful flags: `-m` (top-m averaged), `--mmr` (1.0 disables diversity),
`--refresh` (ignore cache), `--offline` (cache only), `--json`.

## Input format

CSV with a `Title` column. Optional: `Author`, `My Rating`/`Rating` (1-5), and
`ISBN13`/`ISBN`/`ASIN`. Goodreads library exports work as-is; for List A only rows
on the `read` shelf are used.

## Tests

No torch needed:

```bash
pip install numpy pytest
PYTHONPATH=src pytest
```

## Known gaps

- Embeddings are recomputed each run (cheap at ~1,000 books; cache them if needed).
- Open Library matching is fuzzy; low-confidence matches are listed on stderr.
- No Audible importer yet; map its export columns in `importers.py`.
