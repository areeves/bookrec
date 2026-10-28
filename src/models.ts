/** Unified data model plus title/author normalization. */

/** One row of an input list after mapping to the unified format. */
export interface Entry {
  title: string;
  author: string;
  rating: number | null; // 1-5, null when unrated
  sourceId: string; // ISBN/ASIN/etc. from the source, kept as an alias
}

/** A resolved book with the metadata used for scoring. */
export interface Book {
  key: string; // Open Library work ID (OL...W) or fallback "title|surname"
  title: string;
  author: string;
  description: string;
  subjects: string[];
  confidence: number; // 0..1 match confidence; 0 means unresolved
  rating: number | null;
}

export function entry(
  title: string,
  author = "",
  rating: number | null = null,
  sourceId = "",
): Entry {
  return { title, author, rating, sourceId };
}

export function book(
  key: string,
  title: string,
  author: string,
  extra: Partial<Omit<Book, "key" | "title" | "author">> = {},
): Book {
  return {
    key,
    title,
    author,
    description: "",
    subjects: [],
    confidence: 0,
    rating: null,
    ...extra,
  };
}

export function isResolved(b: Book): boolean {
  return /^OL\d+W$/.test(b.key);
}

function toAscii(text: string): string {
  return text.normalize("NFKD").replace(/[^\x00-\x7f]/g, "");
}

const NOISE = /\b(unabridged|abridged|a novel|audiobook)\b/g;

/** Lowercase, drop "(Unabridged)"/"(Book 2)" markers and subtitles. */
export function normalizeTitle(title: string): string {
  let t = toAscii(title).toLowerCase();
  const steps: Array<(s: string) => string> = [
    (s) => s.replace(/[(\[].*?[)\]]/g, " "),
    (s) => s.split(/\s*[:–—]\s*|\s+-\s+/)[0] ?? s,
    (s) => s.replace(NOISE, " "),
  ];
  for (const step of steps) {
    const candidate = step(t);
    if (/[a-z0-9]/.test(candidate)) t = candidate; // never reduce a title to nothing
  }
  return t.replace(/[^a-z0-9]+/g, " ").trim();
}

/** Surname of the first listed author ("Tolkien, J. R. R." -> "tolkien"). */
export function authorSurname(author: string): string {
  let a = toAscii(author).toLowerCase();
  a = a.split(/\s*(?:;|&|\band\b)\s*/)[0] ?? "";
  a = a.split(",")[0] ?? "";
  const tokens = a.replace(/[^a-z ]+/g, " ").split(/\s+/).filter(Boolean);
  return tokens[tokens.length - 1] ?? "";
}

/** Key used when no work ID can be resolved, and as the cache lookup key. */
export function fallbackKey(title: string, author: string): string {
  return `${normalizeTitle(title)}|${authorSurname(author)}`;
}

// ---------------------------------------------------------------------------
// Matching helpers. These are used for searching and scoring only: cache keys
// (fallbackKey) keep using normalizeTitle/authorSurname above so existing
// caches stay valid.

/** "Name - translator" / "Name - afterword": drop the credit after the dash. */
const stripRole = (name: string): string => name.replace(/\s+-\s+.*$/, "").trim();

/**
 * First credited author as a plain name, without roles or co-contributors:
 * "Andrzej Sapkowski, David French - translator" -> "Andrzej Sapkowski".
 */
export function primaryAuthor(author: string): string {
  const first = author.split(/\s*;\s*|\s+&\s+|\s+and\s+/i)[0] ?? "";
  const [head, second, ...rest] = first.split(",").map(stripRole).filter(Boolean);
  if (!head) return "";
  // "Tolkien, J. R. R." (surname first): the second part is only initials.
  if (second && !rest.length && /^(?:[a-z]\.?\s*){1,3}$/i.test(second)) return `${second} ${head}`;
  return head;
}

/** Title with subtitle, series/format noise and "by <author>" tails removed; punctuation kept. */
function coreTitle(title: string, author: string): string {
  let t = toAscii(title.replace(/[\u2018\u2019]/g, "'")).toLowerCase();
  const by = toAscii(primaryAuthor(author)).toLowerCase();
  const cut = by ? t.indexOf(` by ${by}`) : -1;
  if (cut > 0) t = t.slice(0, cut);
  t = t.replace(/--+/g, ": "); // "Dark One--Forgotten" is "Dark One: Forgotten"
  const steps: Array<(s: string) => string> = [
    (s) => s.replace(/[(\[].*?[)\]]/g, " "),
    (s) => s.split(/\s*[:\u2013\u2014]\s*|\s+-\s+/)[0] ?? s,
    (s) => s.replace(/\b(?:unabridged|abridged|a novel|audiobook|mp3|cd)\b/g, " "),
    (s) => s.replace(/,?\s*\b(?:book|volume|vol)\.?\s+\d+(?:\.\d+)?\s*$/, " "),
  ];
  for (const step of steps) {
    const candidate = step(t);
    if (/[a-z0-9]/.test(candidate)) t = candidate; // never reduce a title to nothing
  }
  return t;
}

/** Title for comparing two titles: apostrophes dropped, everything else spaced. */
export function matchTitle(title: string, author = ""): string {
  return coreTitle(title, author).replace(/'/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Title for a search query: like matchTitle but apostrophes kept (the index tokenizes them). */
export function searchTitle(title: string, author = ""): string {
  return coreTitle(title, author).replace(/[^a-z0-9']+/g, " ").trim();
}
