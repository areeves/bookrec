#!/usr/bin/env -S node --disable-warning=ExperimentalWarning --import tsx
/** Command line interface: bookrec recommend ... (parsing and printing only). */
import { parseArgs } from "node:util";
import { CachingEmbedder } from "./caching-embedder.js";
import { TransformersEmbedder } from "./embedder.js";
import { isResolved, type Book } from "./models.js";
import { OpenLibraryResolver } from "./openlibrary.js";
import type { Rec } from "./scoring.js";
import { RecommenderService, type RecommendResult } from "./service.js";
import { SqliteStore } from "./store.js";

const USAGE = `usage: bookrec recommend --read FILE --candidates FILE [options]

  --read FILE         CSV of books already read (List A)
  --candidates FILE   CSV of candidate books (List B)
  -k N                number of recommendations (default 10)
  -m N                top-m similarities averaged per candidate (default 3)
  --mmr X             MMR lambda, 1.0 = no diversity (default 0.7)
  --db PATH           SQLite cache (default $BOOKREC_DB or data/bookrec.sqlite)
  --refresh           ignore cached lookups
  --offline           use cache only, no network
  --json              machine-readable output
`;

const log = (message: string) => console.error(message);

function reportWeakMatches(label: string, books: Book[]): void {
  if (!books.length) return;
  log(`${label}: ${books.length} unresolved or low-confidence match(es), worth a look:`);
  for (const b of books) {
    const status = isResolved(b) ? b.confidence.toFixed(2) : "unresolved";
    log(`  - ${b.title} / ${b.author} (${status})`);
  }
}

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

function printJson(recs: Rec[]): void {
  console.log(
    JSON.stringify(
      recs.map((r) => ({
        title: r.book.title,
        author: r.book.author,
        key: r.book.key,
        score: round4(r.score),
        because: r.because.map(([b, s]) => ({ title: b.title, similarity: round4(s) })),
      })),
      null,
      2,
    ),
  );
}

function printText(recs: Rec[]): void {
  recs.forEach((r, i) => {
    console.log(`${String(i + 1).padStart(2)}. ${r.book.title} - ${r.book.author}  (score ${r.score.toFixed(3)})`);
    const because = r.because.map(([b, s]) => `${b.title} (${s.toFixed(2)})`).join("; ");
    console.log(`      because you read: ${because}`);
  });
  if (!recs.length) {
    console.log("No recommendations (empty lists, or every candidate was already read).");
  }
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command !== "recommend") {
    console.error(USAGE);
    return command === undefined || command === "--help" || command === "-h" ? 0 : 2;
  }

  const { values } = parseArgs({
    args: rest,
    options: {
      read: { type: "string" },
      candidates: { type: "string" },
      k: { type: "string", short: "k", default: "10" },
      m: { type: "string", short: "m", default: "3" },
      mmr: { type: "string", default: "0.7" },
      db: { type: "string", default: process.env.BOOKREC_DB ?? "data/bookrec.sqlite" },
      refresh: { type: "boolean", default: false },
      offline: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
  });
  if (!values.read || !values.candidates) {
    console.error("error: --read and --candidates are required\n\n" + USAGE);
    return 2;
  }

  const store = new SqliteStore(values.db as string);
  let result: RecommendResult;
  try {
    const model = new TransformersEmbedder();
    const service = new RecommenderService({
      resolver: new OpenLibraryResolver(),
      store,
      embedder: new CachingEmbedder(model, store, model.modelName, { log }),
      log,
    });
    result = await service.recommend({
      readPath: values.read,
      candidatesPath: values.candidates,
      k: Number(values.k),
      m: Number(values.m),
      mmrLambda: Number(values.mmr),
      refresh: values.refresh,
      offline: values.offline,
    });
  } finally {
    store.close();
  }

  reportWeakMatches("Read list", result.weakMatches.read);
  reportWeakMatches("Candidates", result.weakMatches.candidates);
  if (values.json) printJson(result.recs);
  else printText(result.recs);
  return 0;
}

process.exit(await main(process.argv.slice(2)));
