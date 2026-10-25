/** SQLite cache so each book is looked up online only once. */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { book, type Book } from "./models.js";
import type { BookStore, EmbeddingStore } from "./ports.js";

interface Row {
  work_key: string;
  title: string;
  author: string;
  description: string;
  subjects: string;
  confidence: number;
}

export class SqliteStore implements BookStore, EmbeddingStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS resolved (
         input_key   TEXT PRIMARY KEY,  -- normalized "title|surname" of the input
         work_key    TEXT NOT NULL,
         title       TEXT NOT NULL,
         author      TEXT NOT NULL,
         description TEXT NOT NULL,
         subjects    TEXT NOT NULL,     -- JSON list
         confidence  REAL NOT NULL
       )`,
    );
    // Keyed by a hash of the embedded text, so changed metadata or a changed
    // embedText() format misses the cache instead of returning a stale vector.
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS embeddings (
         model     TEXT NOT NULL,
         text_hash TEXT NOT NULL,   -- sha256 of the embedded text
         dim       INTEGER NOT NULL,
         vector    BLOB NOT NULL,   -- little-endian float32 values
         PRIMARY KEY (model, text_hash)
       )`,
    );
  }

  getEmbeddings(model: string, textHashes: string[]): Map<string, number[]> {
    const stmt = this.db.prepare(
      "SELECT dim, vector FROM embeddings WHERE model = ? AND text_hash = ?",
    );
    const found = new Map<string, number[]>();
    for (const hash of textHashes) {
      const row = stmt.get(model, hash) as unknown as { dim: number; vector: Uint8Array } | undefined;
      if (!row) continue;
      // Copy first: the BLOB's byteOffset may not be 4-byte aligned for a Float32Array view.
      const floats = new Float32Array(new Uint8Array(row.vector).buffer);
      if (floats.length === row.dim) found.set(hash, Array.from(floats));
    }
    return found;
  }

  putEmbeddings(model: string, rows: Array<[string, number[]]>): void {
    const stmt = this.db.prepare("INSERT OR REPLACE INTO embeddings VALUES (?, ?, ?, ?)");
    this.db.exec("BEGIN");
    try {
      for (const [hash, vector] of rows) {
        stmt.run(model, hash, vector.length, new Uint8Array(new Float32Array(vector).buffer));
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  get(inputKey: string): Book | null {
    const row = this.db
      .prepare(
        "SELECT work_key, title, author, description, subjects, confidence " +
          "FROM resolved WHERE input_key = ?",
      )
      .get(inputKey) as unknown as Row | undefined;
    if (!row) return null;
    return book(row.work_key, row.title, row.author, {
      description: row.description,
      subjects: JSON.parse(row.subjects) as string[],
      confidence: row.confidence,
    });
  }

  put(inputKey: string, b: Book): void {
    this.db
      .prepare("INSERT OR REPLACE INTO resolved VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(inputKey, b.key, b.title, b.author, b.description, JSON.stringify(b.subjects), b.confidence);
  }

  close(): void {
    this.db.close();
  }
}

/** Non-persistent store, handy for tests and one-off runs. */
export class MemoryStore implements BookStore, EmbeddingStore {
  private readonly rows = new Map<string, Book>();
  private readonly vectors = new Map<string, number[]>();

  getEmbeddings(model: string, textHashes: string[]): Map<string, number[]> {
    const found = new Map<string, number[]>();
    for (const hash of textHashes) {
      const vector = this.vectors.get(`${model}|${hash}`);
      if (vector) found.set(hash, [...vector]);
    }
    return found;
  }

  putEmbeddings(model: string, rows: Array<[string, number[]]>): void {
    for (const [hash, vector] of rows) this.vectors.set(`${model}|${hash}`, [...vector]);
  }

  get(inputKey: string): Book | null {
    const found = this.rows.get(inputKey);
    return found ? structuredClone(found) : null;
  }

  put(inputKey: string, b: Book): void {
    this.rows.set(inputKey, structuredClone(b));
  }

  close(): void {}
}
