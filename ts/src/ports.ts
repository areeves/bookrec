/**
 * Interfaces the service layer depends on. Each can have several
 * implementations (Open Library vs. Google Books, SQLite vs. in-memory, a local
 * model vs. a hosted embeddings API) chosen where the service is wired up.
 */
import type { Book, Entry } from "./models.js";

/** Looks an entry up online. Throws ResolverError on network/server failure. */
export interface BookResolver {
  resolve(entry: Entry): Promise<Book>;
}

export class ResolverError extends Error {
  override name = "ResolverError";
}

/** Cache so each book is looked up online only once. */
export interface BookStore {
  get(inputKey: string): Book | null;
  put(inputKey: string, book: Book): void;
  close(): void;
}

/** Returns one L2-normalized vector per input text. */
export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

export type Logger = (message: string) => void;
