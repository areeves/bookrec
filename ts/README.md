# bookrec (TypeScript)

Recommends K books from a candidate list (List B) based on books you have read (List A).
A TypeScript port of the Python version in the repo root, with the same pipeline:

CSV import -> resolve each book to an Open Library work (cached in SQLite) ->
embed title/author/subjects/description -> score every candidate by the mean of its
top-m similarities to your read books -> pick K with MMR for diversity.

## Layout

```
src/
  models.ts       Entry/Book types, title and author normalization
  importers.ts    CSV -> Entry (Goodreads exports work as-is)
  fuzzy.ts        SequenceMatcher-compatible similarity ratio
  scoring.ts      pure functions: similarity, aggregation, MMR, recommend()
  ports.ts        interfaces: BookResolver, BookStore, Embedder
  openlibrary.ts  BookResolver implementation (Open Library)
  store.ts        BookStore implementations (SQLite, in-memory)
  embedder.ts     Embedder implementation (Transformers.js, all-MiniLM-L6-v2)
  caching-embedder.ts  Embedder decorator: persistent vector cache, embeds only misses
  service.ts      RecommenderService: the business logic, no CLI or I/O formatting
  cli.ts          argument parsing and printing only
```

`RecommenderService` receives its resolver, store and embedder through the
constructor, so a REST endpoint (or a different resolver such as Google Books) can
reuse it by wiring up its own implementations of the interfaces in `ports.ts`.

## Run (Docker)

Put your CSVs in `../input/` (the repo's samples work), then from this directory:

```bash
docker compose build
docker compose run --rm app recommend \
  --read /input/read.csv --candidates /input/candidates.csv -k 5
```

The SQLite cache and the downloaded embedding model live in the `bookrec-data`
volume, so only the first run is slow. `src/` is bind-mounted, so code edits need
no rebuild.

## Run (local, Node >= 22.13)

```bash
npm install
npm start -- recommend --read ../input/read.csv --candidates ../input/candidates.csv -k 5
```

Flags: `-k`, `-m` (top-m averaged), `--mmr` (1.0 disables diversity), `--db`,
`--refresh` (ignore cache), `--offline` (cache only), `--json`.

## Tests

No model download needed (embeddings and network are faked):

```bash
npm test
npm run typecheck
```

## Notes

- SQLite uses Node's built-in `node:sqlite`, so there is no native addon to build.
  It prints an experimental warning, which the Docker setup silences.
- If `npm install` fails fetching `onnxruntime-node` extras (restricted network),
  `npm install --ignore-scripts` works: the CPU runtime is bundled.
- Embeddings are cached in the same SQLite file, keyed by (model, sha256 of the
  embedded text), so changed metadata or a different `BOOKREC_MODEL` re-embeds
  automatically. With a warm cache the model is never loaded.
- Known gaps carried over from the Python version: Open Library matching is fuzzy (weak matches are listed on stderr), and
  there is no Audible importer yet (map its columns in `importers.ts`).
