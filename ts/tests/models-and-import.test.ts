import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCsv } from "../src/importers.js";
import {
  authorSurname,
  book,
  entry,
  fallbackKey,
  isResolved,
  normalizeTitle,
} from "../src/models.js";
import { pickBest } from "../src/openlibrary.js";

describe("normalization", () => {
  it("normalizes titles", () => {
    expect(normalizeTitle("Project Hail Mary (Unabridged)")).toBe("project hail mary");
    expect(normalizeTitle("Dune: Book One (Dune Chronicles, #1)")).toBe("dune");
    expect(normalizeTitle("The Name of the Wind - Kingkiller 1")).toBe("the name of the wind");
    expect(normalizeTitle("Les Misérables")).toBe("les miserables");
    expect(normalizeTitle("(Untitled)")).toBe("untitled"); // never normalizes to empty
  });

  it("extracts author surnames", () => {
    expect(authorSurname("Tolkien, J. R. R.")).toBe("tolkien");
    expect(authorSurname("J. R. R. Tolkien")).toBe("tolkien");
    expect(authorSurname("Neil Gaiman & Terry Pratchett")).toBe("gaiman");
    expect(authorSurname("")).toBe("");
  });

  it("builds fallback keys that match across sources", () => {
    expect(fallbackKey("Dune (Unabridged)", "Frank Herbert")).toBe(
      fallbackKey("Dune", "Herbert, Frank"),
    );
  });

  it("flags resolved work IDs", () => {
    expect(isResolved(book("OL45804W", "Dune", "x"))).toBe(true);
    expect(isResolved(book("dune|herbert", "Dune", "x"))).toBe(false);
  });
});

describe("loadCsv", () => {
  it("reads Goodreads-style files", () => {
    const file = join(mkdtempSync(join(tmpdir(), "bookrec-")), "read.csv");
    writeFileSync(
      file,
      "Title,Author,My Rating,ISBN13,Exclusive Shelf\n" +
        'Dune,Frank Herbert,5,="9780441172719",read\n' +
        'Emma,Jane Austen,0,="",to-read\n',
    );
    expect(loadCsv(file)).toHaveLength(2);
    expect(loadCsv(file, true)).toEqual([entry("Dune", "Frank Herbert", 5, "9780441172719")]);
  });
});

describe("pickBest", () => {
  it("prefers the matching title and author", () => {
    const e = entry("Dune (Unabridged)", "Frank Herbert");
    const docs = [
      { key: "/works/OL1W", title: "Dune Messiah", author_name: ["Frank Herbert"] },
      { key: "/works/OL2W", title: "Dune", author_name: ["Frank Herbert"] },
      { key: "/works/OL3W", title: "Dune", author_name: ["Someone Else"] },
    ];
    const [doc, confidence] = pickBest(e, docs);
    expect(doc?.key).toBe("/works/OL2W");
    expect(confidence).toBeGreaterThan(0.95);
    expect(pickBest(e, [])[0]).toBeNull();
  });
});
