import { describe, expect, it } from "vitest";
import { entry, book, matchTitle, primaryAuthor, searchTitle } from "../src/models.js";
import { OpenLibraryResolver, searchPlans, type SearchDoc } from "../src/openlibrary.js";
import { dedupeBooks } from "../src/scoring.js";

describe("primaryAuthor", () => {
  it("drops translators, editors and co-authors", () => {
    expect(primaryAuthor("Andrzej Sapkowski, David French - translator")).toBe("Andrzej Sapkowski");
    expect(primaryAuthor("Terry Pratchett, Ben Aaronovitch - afterword")).toBe("Terry Pratchett");
    expect(primaryAuthor("John Doerr, Larry Page - introduction")).toBe("John Doerr");
    expect(primaryAuthor("Yei Theodora Ozaki - translator")).toBe("Yei Theodora Ozaki");
    expect(primaryAuthor("Neil Gaiman & Terry Pratchett")).toBe("Neil Gaiman");
  });

  it("keeps the name when it is written surname-first with initials", () => {
    expect(primaryAuthor("Tolkien, J. R. R.")).toBe("J. R. R. Tolkien");
    expect(primaryAuthor("James S. A. Corey")).toBe("James S. A. Corey");
    expect(primaryAuthor("")).toBe("");
  });
});

describe("matchTitle / searchTitle", () => {
  it("removes ', Book N' and series/format noise", () => {
    expect(matchTitle("Harry Potter and the Order of the Phoenix, Book 5")).toBe(
      "harry potter and the order of the phoenix",
    );
    expect(matchTitle("Guards! Guards!: Discworld, Book 8")).toBe("guards guards");
    expect(matchTitle("Abaddon's Gate by James S. A. Corey Unabridged CD Audiobook", "James S. A. Corey")).toBe(
      "abaddons gate",
    );
  });

  it("treats a double dash like a subtitle separator", () => {
    expect(matchTitle("Dark One--Forgotten")).toBe(matchTitle("Dark One: Forgotten"));
  });

  it("keeps apostrophes in the query but not in the comparison", () => {
    expect(searchTitle("Caliban's War")).toBe("caliban's war");
    expect(searchTitle("Caliban’s War")).toBe("caliban's war");
    expect(matchTitle("Caliban's War")).toBe(matchTitle("Calibans War"));
  });
});

describe("searchPlans", () => {
  it("sends only the first author, then falls back to title-only and free text", () => {
    const plans = searchPlans(entry("Season of Storms", "Andrzej Sapkowski, David French - translator"));

    expect(plans[0]).toEqual({ title: "season of storms", author: "Andrzej Sapkowski", limit: "5" });
    expect(plans[1]).toEqual({ title: "season of storms", limit: "10" });
    expect(plans.at(-1)).toEqual({ q: "season of storms sapkowski", limit: "10" });
    expect(JSON.stringify(plans)).not.toMatch(/translator|French/);
  });

  it("adds an apostrophe-free variant only when there is an apostrophe", () => {
    const titles = searchPlans(entry("Caliban's War", "James S. A. Corey")).map((p) => p.title);
    expect(titles).toContain("caliban's war");
    expect(titles).toContain("calibans war");
    expect(searchPlans(entry("Dune", "Frank Herbert"))).toHaveLength(3); // author, title-only, free text
  });
});

/** Fake Open Library: answers a title query only when it matches exactly, like a strict index. */
function fakeOpenLibrary(catalogue: SearchDoc[]) {
  const requests: URL[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    requests.push(url);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.pathname.startsWith("/works/")) return json({ description: "A description." });
    const title = url.searchParams.get("title");
    const author = url.searchParams.get("author");
    const docs = catalogue.filter(
      (d) =>
        title !== null &&
        title === (d.title ?? "").toLowerCase().replace(/[^a-z0-9']+/g, " ").trim() &&
        (author === null || (d.author_name ?? []).some((a) => a === author)),
    );
    return json({ docs });
  }) as typeof fetch;
  return { fetchFn, requests };
}

describe("OpenLibraryResolver", () => {
  const witcher: SearchDoc = { key: "/works/OL1W", title: "Season of Storms", author_name: ["Andrzej Sapkowski"], subject: ["fantasy"] };
  const potter: SearchDoc = {
    key: "/works/OL2W",
    title: "Harry Potter and the Order of the Phoenix",
    author_name: ["J. K. Rowling"],
  };

  it("resolves a book whose credits include a translator", async () => {
    const { fetchFn, requests } = fakeOpenLibrary([witcher]);
    const resolved = await new OpenLibraryResolver(fetchFn).resolve(
      entry("Season of Storms", "Andrzej Sapkowski, David French - translator"),
    );

    expect(resolved.key).toBe("OL1W");
    expect(resolved.confidence).toBeGreaterThanOrEqual(0.85);
    expect(requests.some((r) => (r.searchParams.get("author") ?? "").includes("translator"))).toBe(false);
  });

  it("resolves a title that ends in ', Book N'", async () => {
    const { fetchFn } = fakeOpenLibrary([potter]);
    const resolved = await new OpenLibraryResolver(fetchFn).resolve(
      entry("Harry Potter and the Order of the Phoenix, Book 5", "J.K. Rowling"),
    );

    expect(resolved.key).toBe("OL2W");
  });

  it("still returns an unresolved fallback when nothing matches", async () => {
    const { fetchFn } = fakeOpenLibrary([]);
    const resolved = await new OpenLibraryResolver(fetchFn).resolve(entry("Unknown Book", "Nobody"));

    expect(resolved.key).toBe("unknown book|nobody");
    expect(resolved.confidence).toBe(0);
  });
});

describe("dedupeBooks", () => {
  it("merges books with the same key, keeping the highest rating", () => {
    const a = book("OL1W", "Kyoshi", "F. C. Yee", { rating: null });
    const b = book("OL1W", "Kyoshi", "F. C. Yee", { rating: 4 });
    const c = book("OL2W", "Other", "Someone", { rating: 3 });

    const merged = dedupeBooks([a, b, c]);

    expect(merged.map((x) => x.key)).toEqual(["OL1W", "OL2W"]);
    expect(merged[0]?.rating).toBe(4);
  });
});
