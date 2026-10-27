import { describe, expect, it } from "vitest";
import { CachingEmbedder } from "../src/caching-embedder.js";
import type { Embedder } from "../src/ports.js";
import { MemoryStore, SqliteStore } from "../src/store.js";

/** Deterministic fake that records every batch it is asked to embed. */
const recording = () => {
  const calls: string[][] = [];
  const embedder: Embedder = {
    embed: async (texts) => {
      calls.push(texts);
      return texts.map((t) => [t.length, 1, 0.5]);
    },
  };
  return { embedder, calls };
};

describe("CachingEmbedder", () => {
  it("embeds only the misses and keeps input order", async () => {
    const { embedder, calls } = recording();
    const cache = new CachingEmbedder(embedder, new MemoryStore(), "m");

    await cache.embed(["aa", "bbbb"]);
    const out = await cache.embed(["bbbb", "c", "aa"]);

    expect(calls).toEqual([["aa", "bbbb"], ["c"]]);
    expect(out).toEqual([[4, 1, 0.5], [1, 1, 0.5], [2, 1, 0.5]]);
  });

  it("embeds a repeated text once and never calls the model on a full hit", async () => {
    const { embedder, calls } = recording();
    const cache = new CachingEmbedder(embedder, new MemoryStore(), "m");

    await cache.embed(["x", "x", "y"]);
    await cache.embed(["y", "x"]);

    expect(calls).toEqual([["x", "y"]]);
  });

  it("does not share vectors across models", async () => {
    const { embedder, calls } = recording();
    const store = new MemoryStore();

    await new CachingEmbedder(embedder, store, "model-a").embed(["x"]);
    await new CachingEmbedder(embedder, store, "model-b").embed(["x"]);

    expect(calls).toEqual([["x"], ["x"]]);
  });

  it("persists vectors in SQLite across store instances", async () => {
    const dir = (await import("node:fs")).mkdtempSync("/tmp/bookrec-test-");
    const path = `${dir}/cache.sqlite`;
    const vector = [0.1, -0.25, 3.5];
    const first = new SqliteStore(path);
    await new CachingEmbedder({ embed: async (t) => t.map(() => vector) }, first, "m").embed(["x"]);
    first.close();

    const { embedder, calls } = recording();
    const second = new SqliteStore(path);
    const [out] = await new CachingEmbedder(embedder, second, "m").embed(["x"]);
    second.close();

    expect(calls).toEqual([]);
    expect(out).toEqual(vector.map((v) => Math.fround(v)));
  });

  it("embeds in chunks and keeps what finished when a later chunk fails", async () => {
    const store = new MemoryStore();
    const calls: string[][] = [];
    const flaky: Embedder = {
      embed: async (texts) => {
        calls.push(texts);
        if (calls.length === 2) throw new Error("out of memory");
        return texts.map(() => [1, 0]);
      },
    };

    await expect(
      new CachingEmbedder(flaky, store, "m", { chunkSize: 2 }).embed(["a", "b", "c", "d"]),
    ).rejects.toThrow("out of memory");
    expect(calls).toEqual([["a", "b"], ["c", "d"]]);

    const { embedder, calls: retry } = recording();
    await new CachingEmbedder(embedder, store, "m", { chunkSize: 2 }).embed(["a", "b", "c", "d"]);
    expect(retry).toEqual([["c", "d"]]);
  });
});
