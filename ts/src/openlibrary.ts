/** Resolve entries to Open Library works and fetch description/subjects. */
import { ratio } from "./fuzzy.js";
import { authorSurname, book, fallbackKey, normalizeTitle, type Book, type Entry } from "./models.js";
import { ResolverError, type BookResolver } from "./ports.js";

const BASE = "https://openlibrary.org";
const USER_AGENT = "bookrec/0.1 (personal project)";
export const MIN_CONFIDENCE = 0.6; // below this the match is treated as unresolved
const MAX_SUBJECTS = 15;
const MIN_INTERVAL_MS = 400; // between requests, to stay polite

export interface SearchDoc {
  key: string;
  title?: string;
  author_name?: string[];
  subject?: string[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 0..1 match confidence: 70% title similarity, 30% author surname. */
export function scoreDoc(entry: Entry, doc: SearchDoc): number {
  const titleSim = ratio(normalizeTitle(entry.title), normalizeTitle(doc.title ?? ""));
  let authorSim = titleSim;
  if (entry.author) {
    const want = authorSurname(entry.author);
    const have = (doc.author_name ?? []).map(authorSurname);
    authorSim = Math.max(0, ...have.map((h) => ratio(want, h)));
  }
  return 0.7 * titleSim + 0.3 * authorSim;
}

export function pickBest(entry: Entry, docs: SearchDoc[]): [SearchDoc | null, number] {
  let best: SearchDoc | null = null;
  let bestScore = 0;
  for (const doc of docs) {
    const score = scoreDoc(entry, doc);
    if (score > bestScore) {
      best = doc;
      bestScore = score;
    }
  }
  return [best, bestScore];
}

export class OpenLibraryResolver implements BookResolver {
  private lastCall = 0;

  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async resolve(entry: Entry): Promise<Book> {
    const docs = await this.search(entry.title, entry.author);
    const [doc, confidence] = pickBest(entry, docs);
    if (!doc || confidence < MIN_CONFIDENCE) {
      return book(fallbackKey(entry.title, entry.author), entry.title, entry.author);
    }
    const workKey = doc.key.replace(/^\/works\//, "");
    return book(workKey, doc.title ?? entry.title, doc.author_name?.[0] ?? entry.author, {
      description: await this.fetchDescription(workKey),
      subjects: (doc.subject ?? []).slice(0, MAX_SUBJECTS),
      confidence,
    });
  }

  private async search(title: string, author: string): Promise<SearchDoc[]> {
    const fields = "key,title,author_name,subject";
    const strict: Record<string, string> = {
      title: normalizeTitle(title),
      limit: "5",
      fields,
    };
    if (author) strict.author = author;
    const docs = (await this.getJson<{ docs?: SearchDoc[] }>("/search.json", strict))?.docs ?? [];
    if (docs.length) return docs;
    // looser free-text fallback
    const loose = { q: `${title} ${author}`.trim(), limit: "5", fields };
    return (await this.getJson<{ docs?: SearchDoc[] }>("/search.json", loose))?.docs ?? [];
  }

  private async fetchDescription(workKey: string): Promise<string> {
    const data =
      (await this.getJson<{ description?: string | { value?: string } }>(
        `/works/${workKey}.json`,
      )) ?? {};
    const raw = data.description;
    const description = typeof raw === "object" && raw !== null ? (raw.value ?? "") : (raw ?? "");
    // Open Library descriptions often append "-----" followed by source links.
    return (description.split(/\n-{5,}/)[0] ?? "").trim();
  }

  /** GET JSON with throttling and retries; null on 404. */
  private async getJson<T>(
    path: string,
    params?: Record<string, string>,
    retries = 3,
  ): Promise<T | null> {
    const url = BASE + path + (params ? "?" + new URLSearchParams(params).toString() : "");
    for (let attempt = 0; attempt < retries; attempt++) {
      const wait = MIN_INTERVAL_MS - (Date.now() - this.lastCall);
      if (wait > 0) await sleep(wait);
      this.lastCall = Date.now();
      const last = attempt === retries - 1;
      try {
        const response = await this.fetchFn(url, {
          headers: { "User-Agent": USER_AGENT },
          signal: AbortSignal.timeout(15_000),
        });
        if (response.status === 404) return null;
        if (response.ok) return (await response.json()) as T;
        if ([429, 500, 502, 503, 504].includes(response.status) && !last) {
          await sleep(2 ** attempt * 1000);
          continue;
        }
        throw new ResolverError(`HTTP ${response.status} for ${url}`);
      } catch (error) {
        if (error instanceof ResolverError) throw error;
        if (!last) {
          await sleep(2 ** attempt * 1000);
          continue;
        }
        throw new ResolverError(`${(error as Error).message} for ${url}`);
      }
    }
    throw new ResolverError(`gave up on ${url}`);
  }
}
