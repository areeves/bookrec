/**
 * Business logic, independent of the CLI. A REST endpoint can call
 * RecommenderService.recommend() with the same arguments.
 */
import { loadCsv } from "./importers.js";
import { book, fallbackKey, isResolved, type Book, type Entry } from "./models.js";
import {
  ResolverError,
  type BookResolver,
  type BookStore,
  type Embedder,
  type Logger,
} from "./ports.js";
import { eligibleCandidates, recommend, type Rec } from "./scoring.js";

export const LOW_CONFIDENCE = 0.8;

export interface LoadOptions {
  refresh?: boolean;
  offline?: boolean;
}

export interface RecommendRequest extends LoadOptions {
  readPath: string;
  candidatesPath: string;
  k?: number;
  m?: number;
  mmrLambda?: number;
}

export interface RecommendResult {
  recs: Rec[];
  weakMatches: { read: Book[]; candidates: Book[] };
}

export class RecommenderService {
  constructor(
    private readonly deps: {
      resolver: BookResolver;
      store: BookStore;
      embedder: Embedder;
      log?: Logger;
    },
  ) {}

  private log(message: string): void {
    this.deps.log?.(message);
  }

  async loadBooks(entries: Entry[], { refresh = false, offline = false }: LoadOptions = {}) {
    const { resolver, store } = this.deps;
    const books: Book[] = [];
    for (const [index, entry] of entries.entries()) {
      const inputKey = fallbackKey(entry.title, entry.author);
      let found = refresh ? null : store.get(inputKey);
      if (!found) {
        if (offline) {
          found = book(inputKey, entry.title, entry.author);
        } else {
          this.log(`  [${index + 1}/${entries.length}] looking up: ${entry.title}`);
          try {
            found = await resolver.resolve(entry);
            store.put(inputKey, found); // cache only completed lookups, never network failures
          } catch (error) {
            if (!(error instanceof ResolverError)) throw error;
            this.log(`    lookup failed, using title/author only: ${error.message}`);
            found = book(inputKey, entry.title, entry.author);
          }
        }
      }
      found.rating = entry.rating;
      books.push(found);
    }
    return books;
  }

  /** Say what was loaded, and why there may be nothing to recommend. */
  private logSummary(read: Book[], candidates: Book[]): void {
    const matched = (books: Book[]) => books.filter(isResolved).length;
    this.log(`Read list: ${read.length} book(s), ${matched(read)} matched on Open Library`);
    this.log(`Candidates: ${candidates.length} book(s), ${matched(candidates)} matched on Open Library`);
    const eligible = eligibleCandidates(read, candidates).length;
    this.log(`Eligible candidates (not already read, no duplicates): ${eligible}`);
    if (!read.length) {
      this.log("warning: the read list has no books, so nothing can be recommended. " +
        "Check that the file has a Title column and that its rows are not filtered out.");
    } else if (!candidates.length) {
      this.log("warning: the candidate list has no books.");
    } else if (!eligible) {
      this.log("warning: every candidate is already on the read list (or a duplicate).");
    }
  }

  async recommend(req: RecommendRequest): Promise<RecommendResult> {
    const options = { refresh: req.refresh, offline: req.offline };
    this.log("Loading read list...");
    const read = await this.loadBooks(loadCsv(req.readPath, true), options);
    this.log("Loading candidate list...");
    const candidates = await this.loadBooks(loadCsv(req.candidatesPath), options);

    this.logSummary(read, candidates);

    this.log("Scoring...");
    const recs = await recommend(read, candidates, this.deps.embedder, {
      k: req.k,
      m: req.m,
      mmrLambda: req.mmrLambda,
    });
    return {
      recs,
      weakMatches: { read: weakMatches(read), candidates: weakMatches(candidates) },
    };
  }
}

export const weakMatches = (books: Book[]): Book[] =>
  books.filter((b) => b.confidence < LOW_CONFIDENCE);
