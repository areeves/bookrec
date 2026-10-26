/** Embedding text, similarity, aggregation and diversification. Pure functions. */
import type { Book } from "./models.js";
import type { Embedder } from "./ports.js";

export type Matrix = number[][];

export function embedText(b: Book): string {
  const parts = [`${b.title} by ${b.author}.`];
  if (b.subjects.length) parts.push(`Subjects: ${b.subjects.join(", ")}.`);
  if (b.description) parts.push(b.description);
  return parts.join(" ");
}

export const dot = (x: number[], y: number[]): number => {
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += (x[i] ?? 0) * (y[i] ?? 0);
  return sum;
};

/** Cosine similarity for L2-normalized rows; result[i][j] = cand i vs read j. */
export function similarityMatrix(read: Matrix, cands: Matrix): Matrix {
  return cands.map((c) => read.map((r) => dot(c, r)));
}

/** Unrated -> 1.0; rated books scale by rating/5, floored at 0.2. */
export function ratingWeights(ratings: Array<number | null>): number[] {
  return ratings.map((r) => (r === null ? 1 : Math.min(1, Math.max(0.2, r / 5))));
}

/** Per candidate: mean of its top-m (weighted) similarities to read books. */
export function aggregate(sim: Matrix, m = 3, weights?: number[]): number[] {
  return sim.map((row) => {
    const weighted = weights ? row.map((s, j) => s * (weights[j] ?? 1)) : row;
    const take = Math.max(1, Math.min(m, weighted.length));
    const top = [...weighted].sort((a, b) => b - a).slice(0, take);
    return top.reduce((x, y) => x + y, 0) / top.length;
  });
}

/** Maximal marginal relevance: balance score against redundancy. */
export function mmrSelect(scores: number[], emb: Matrix, k: number, lambda = 0.7): number[] {
  const remaining = scores.map((_, i) => i);
  const selected: number[] = [];
  while (remaining.length && selected.length < k) {
    let pick = remaining[0] as number;
    let pickValue = -Infinity;
    for (const i of remaining) {
      const redundancy = selected.length
        ? Math.max(...selected.map((s) => dot(emb[i] as number[], emb[s] as number[])))
        : 0;
      const value = selected.length
        ? lambda * (scores[i] as number) - (1 - lambda) * redundancy
        : (scores[i] as number);
      if (value > pickValue) {
        pick = i;
        pickValue = value;
      }
    }
    selected.push(pick);
    remaining.splice(remaining.indexOf(pick), 1);
  }
  return selected;
}

/** Candidates minus already-read and duplicate books (by work key). */
export function eligibleCandidates(read: Book[], candidates: Book[]): Book[] {
  const readKeys = new Set(read.map((b) => b.key));
  const seen = new Set<string>();
  const eligible: Book[] = [];
  for (const c of candidates) {
    if (readKeys.has(c.key) || seen.has(c.key)) continue;
    seen.add(c.key);
    eligible.push(c);
  }
  return eligible;
}

export interface Rec {
  book: Book;
  score: number;
  because: Array<[Book, number]>; // (read book, similarity)
}

export interface RecommendOptions {
  k?: number;
  m?: number;
  mmrLambda?: number;
  explain?: number;
}

export async function recommend(
  read: Book[],
  candidates: Book[],
  embedder: Embedder,
  { k = 10, m = 3, mmrLambda = 0.7, explain = 3 }: RecommendOptions = {},
): Promise<Rec[]> {
  const cands = eligibleCandidates(read, candidates);
  if (!read.length || !cands.length) return [];

  const a = await embedder.embed(read.map(embedText));
  const b = await embedder.embed(cands.map(embedText));
  const sim = similarityMatrix(a, b);
  const weights = ratingWeights(read.map((x) => x.rating));
  const scores = aggregate(sim, m, weights);

  return mmrSelect(scores, b, k, mmrLambda).map((i) => {
    const row = sim[i] as number[];
    const top = row
      .map((s, j) => ({ j, w: s * (weights[j] ?? 1) }))
      .sort((x, y) => y.w - x.w || x.j - y.j)
      .slice(0, explain);
    return {
      book: cands[i] as Book,
      score: scores[i] as number,
      because: top.map(({ j }): [Book, number] => [read[j] as Book, row[j] as number]),
    };
  });
}
