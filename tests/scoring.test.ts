import { describe, expect, it } from "vitest";
import { book } from "../src/models.js";
import type { Embedder } from "../src/ports.js";
import { aggregate, mmrSelect, ratingWeights, recommend } from "../src/scoring.js";

const unit = (...v: number[]): number[] => {
  const norm = Math.hypot(...v);
  return v.map((x) => x / norm);
};

describe("scoring", () => {
  it("aggregates the top-m mean", () => {
    const sim = [[0.9, 0.1, 0.5]];
    expect(aggregate(sim, 1)[0]).toBe(0.9);
    expect(aggregate(sim, 2)[0]).toBeCloseTo(0.7);
    expect(aggregate(sim, 99)[0]).toBeCloseTo(0.5); // m is capped at |A|
  });

  it("scales and floors rating weights", () => {
    expect(ratingWeights([null, 5, 3, 1])).toEqual([1, 1, 0.6, 0.2]);
  });

  it("counts low-rated books less", () => {
    expect(aggregate([[0.9, 0.9]], 1, [0.2, 1])[0]).toBe(0.9); // the well-rated read book dominates
  });

  it("prefers a diverse second pick under MMR", () => {
    const emb = [unit(0.95, 0.05, 0), unit(0.9, 0.1, 0), unit(0, 0.85, 0.15)];
    const scores = [0.9986, 0.9939, 0.985];
    expect(mmrSelect(scores, emb, 2, 1.0)).toEqual([0, 1]); // relevance only
    expect(mmrSelect(scores, emb, 2, 0.7)).toEqual([0, 2]); // diversity kicks in
  });

  it("excludes read and duplicate candidates", async () => {
    const vectors: Record<string, number[]> = {
      A1: unit(1, 0),
      A2: unit(0, 1),
      C1: unit(1, 0.1),
      C2: unit(0, 1),
      C3: unit(1, 0),
    };
    const embedder: Embedder = {
      embed: async (texts) => texts.map((t) => vectors[t.split(" by ")[0] as string] as number[]),
    };

    const read = [book("k1", "A1", "x"), book("k2", "A2", "x")];
    const cands = [
      book("k1", "C3", "x"), // same key as a read book -> dropped
      book("c1", "C1", "x"),
      book("c1", "C1", "x"), // duplicate -> dropped
      book("c2", "C2", "x"),
    ];
    const recs = await recommend(read, cands, embedder, { k: 5, m: 1 });
    expect(recs.map((r) => r.book.key)).toEqual(["c2", "c1"]);
    expect(recs[0]?.because[0]?.[0].title).toBe("A2");
  });
});
