/** Map exported CSV files (Goodreads, Audible-style, hand-made) to Entry rows. */
import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import { type Entry } from "./models.js";

type Kind = "title" | "author" | "rating" | "sourceId" | "shelf";

// Header aliases per field, checked in order, case-insensitively.
const ALIASES: Record<Kind, readonly string[]> = {
  title: ["title", "book title", "name"],
  author: ["author", "authors", "author name"],
  rating: ["my rating", "your rating", "rating", "user rating"],
  sourceId: ["isbn13", "isbn", "asin", "book id", "id"],
  shelf: ["exclusive shelf"], // Goodreads: read / to-read / currently-reading
};

// Goodreads writes ISBNs as ="9780441172719"
function cleanId(value: string): string {
  return value.replaceAll("=", "").replaceAll('"', "").trim();
}

function parseRating(value: string): number | null {
  const rating = Number(value);
  if (value.trim() === "" || Number.isNaN(rating)) return null;
  return rating > 0 ? Math.min(rating, 5) : null; // Goodreads uses 0 for unrated
}

/**
 * Load a CSV into Entry rows.
 *
 * With onlyRead, rows from a Goodreads-style "Exclusive Shelf" column are kept
 * only when the shelf is "read".
 */
export function loadCsv(path: string, onlyRead = false): Entry[] {
  const text = readFileSync(path, "utf-8").replace(/^﻿/, "");
  const rows: Record<string, string>[] = parse(text, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true, // Goodreads writes ISBNs as ="978...", which strict CSV rejects
    bom: true,
  });
  const first = rows[0];
  if (!first) return [];

  const cols = new Map<string, string>();
  for (const name of Object.keys(first)) cols.set(name.trim().toLowerCase(), name);
  if (!ALIASES.title.some((alias) => cols.has(alias))) {
    throw new Error(`${path}: no title column found (looked for ${ALIASES.title.join(", ")})`);
  }

  const pick = (row: Record<string, string>, kind: Kind): string => {
    for (const alias of ALIASES[kind]) {
      const column = cols.get(alias);
      if (column !== undefined) {
        const value = (row[column] ?? "").trim();
        if (value) return value;
      }
    }
    return "";
  };

  const entries: Entry[] = [];
  for (const row of rows) {
    const title = pick(row, "title");
    if (!title) continue;
    if (onlyRead) {
      const shelf = pick(row, "shelf").toLowerCase();
      if (shelf && shelf !== "read") continue;
    }
    entries.push({
      title,
      author: pick(row, "author"),
      rating: parseRating(pick(row, "rating")),
      sourceId: cleanId(pick(row, "sourceId")),
    });
  }
  return entries;
}
