import { beforeEach, describe, expect, it, vi } from "vitest";
import { book, entry, fallbackKey, type Book } from "../src/models.js";
import { ResolverError, type BookResolver, type Embedder } from "../src/ports.js";
import { RecommenderService } from "../src/service.js";
import { MemoryStore } from "../src/store.js";

const noEmbedder: Embedder = { embed: async () => [] };

let store: MemoryStore;
let logs: string[];

beforeEach(() => {
  store = new MemoryStore();
  logs = [];
});

const makeService = (resolver: BookResolver) =>
  new RecommenderService({ resolver, store, embedder: noEmbedder, log: (m) => logs.push(m) });

const neverResolve: BookResolver = {
  resolve: async () => {
    throw new Error("should not be called");
  },
};

describe("RecommenderService.loadBooks", () => {
  it("uses the cache and applies the input rating", async () => {
    const e = entry("Dune (Unabridged)", "Frank Herbert", 4);
    const cached = book("OL123W", "Dune", "Frank Herbert", {
      description: "A desert planet.",
      subjects: ["science fiction"],
      confidence: 0.99,
    });
    store.put(fallbackKey(e.title, e.author), cached);

    const [loaded] = await makeService(neverResolve).loadBooks([e]);

    expect(loaded).toEqual({ ...cached, rating: 4 });
  });

  it("returns an uncached fallback on an offline cache miss", async () => {
    const e = entry("Dune", "Frank Herbert", 3);

    const [loaded] = await makeService(neverResolve).loadBooks([e], { offline: true });

    expect(loaded).toEqual(book(fallbackKey(e.title, e.author), "Dune", "Frank Herbert", { rating: 3 }));
    expect(store.get(fallbackKey(e.title, e.author))).toBeNull();
  });

  it("returns an uncached fallback when the lookup fails", async () => {
    const e = entry("Dune", "Frank Herbert");
    const failing: BookResolver = {
      resolve: async () => {
        throw new ResolverError("network unavailable");
      },
    };

    const [loaded] = await makeService(failing).loadBooks([e]);

    expect(loaded).toEqual(book(fallbackKey(e.title, e.author), "Dune", "Frank Herbert"));
    expect(store.get(fallbackKey(e.title, e.author))).toBeNull();
    expect(logs).toContain("    lookup failed, using title/author only: network unavailable");
  });

  it("caches a completed fallback lookup", async () => {
    const e = entry("Dune", "Frank Herbert", 5);
    const fallback = book(fallbackKey(e.title, e.author), "Dune", "Frank Herbert");
    const resolver: BookResolver = { resolve: async () => structuredClone(fallback) };

    const [loaded] = await makeService(resolver).loadBooks([e]);

    expect(loaded?.rating).toBe(5);
    expect(store.get(fallbackKey(e.title, e.author))).toEqual(fallback);
  });

  it("bypasses the cache on refresh and replaces the entry", async () => {
    const e = entry("Dune", "Frank Herbert");
    const inputKey = fallbackKey(e.title, e.author);
    store.put(inputKey, book("OL1W", "Old title", "Frank Herbert", { confidence: 0.9 }));
    const refreshed = book("OL2W", "Dune", "Frank Herbert", { confidence: 1 });
    const resolve = vi.fn(async (): Promise<Book> => structuredClone(refreshed));

    const [loaded] = await makeService({ resolve }).loadBooks([e], { refresh: true });

    expect(loaded?.key).toBe("OL2W");
    expect(store.get(inputKey)).toEqual(refreshed);
  });
});
