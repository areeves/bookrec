/** Decorator: serves embeddings from a persistent cache, embedding only the misses. */
import { createHash } from "node:crypto";
import type { Embedder, EmbeddingStore } from "./ports.js";

export const hashText = (text: string): string => createHash("sha256").update(text).digest("hex");

export class CachingEmbedder implements Embedder {
  /** `model` names the vector space; change it (or the text) and old vectors are not reused. */
  constructor(
    private readonly inner: Embedder,
    private readonly store: EmbeddingStore,
    private readonly model: string,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const hashes = texts.map(hashText);
    const cached = this.store.getEmbeddings(this.model, [...new Set(hashes)]);

    // One entry per distinct missing text, so repeated texts are embedded once.
    const missing = new Map<string, string>();
    texts.forEach((text, i) => {
      const hash = hashes[i] as string;
      if (!cached.has(hash)) missing.set(hash, text);
    });

    if (missing.size) {
      const hashList = [...missing.keys()];
      const vectors = await this.inner.embed([...missing.values()]);
      if (vectors.length !== hashList.length) {
        throw new Error(`embedder returned ${vectors.length} vectors for ${hashList.length} texts`);
      }
      const rows = hashList.map((hash, i): [string, number[]] => [hash, vectors[i] as number[]]);
      this.store.putEmbeddings(this.model, rows);
      for (const [hash, vector] of rows) cached.set(hash, vector);
    }
    return hashes.map((hash) => cached.get(hash) as number[]);
  }
}
