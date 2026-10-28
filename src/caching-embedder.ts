/** Decorator: serves embeddings from a persistent cache, embedding only the misses. */
import { createHash } from "node:crypto";
import type { Embedder, EmbeddingStore, Logger } from "./ports.js";

export const hashText = (text: string): string => createHash("sha256").update(text).digest("hex");

export class CachingEmbedder implements Embedder {
  /** `model` names the vector space; change it (or the text) and old vectors are not reused. */
  constructor(
    private readonly inner: Embedder,
    private readonly store: EmbeddingStore,
    private readonly model: string,
    private readonly options: { chunkSize?: number; log?: Logger } = {},
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

    const log = this.options.log;
    log?.(`Embeddings: ${cached.size} cached, ${missing.size} to compute`);
    // Saved chunk by chunk, so a crash or Ctrl-C keeps the progress made so far.
    const chunk = Math.max(1, this.options.chunkSize ?? 64);
    const pending = [...missing.entries()];
    for (let start = 0; start < pending.length; start += chunk) {
      const part = pending.slice(start, start + chunk);
      const vectors = await this.inner.embed(part.map(([, text]) => text));
      if (vectors.length !== part.length) {
        throw new Error(`embedder returned ${vectors.length} vectors for ${part.length} texts`);
      }
      const rows = part.map(([hash], i): [string, number[]] => [hash, vectors[i] as number[]]);
      this.store.putEmbeddings(this.model, rows);
      for (const [hash, vector] of rows) cached.set(hash, vector);
      log?.(`  embedded ${Math.min(start + chunk, pending.length)}/${pending.length}`);
    }
    return hashes.map((hash) => cached.get(hash) as number[]);
  }
}
