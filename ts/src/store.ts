/** SQLite cache so each book is looked up online only once. */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { book, type Book } from "./models.js";
import type { BookStore } from "./ports.js";

interface Row {
  work_key: string;
  title: string;
  author: string;
  description: string;
  subjects: string;
  confidence: number;
}

export class SqliteStore implements BookStore {
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
export class MemoryStore implements BookStore {
  private readonly rows = new Map<string, Book>();

  get(inputKey: string): Book | null {
    const found = this.rows.get(inputKey);
    return found ? structuredClone(found) : null;
  }

  put(inputKey: string, b: Book): void {
    this.rows.set(inputKey, structuredClone(b));
  }

  close(): void {}
}
