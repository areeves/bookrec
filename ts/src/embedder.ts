/** Local sentence-embedding model via Transformers.js (ONNX, runs on CPU). */
import type { Embedder } from "./ports.js";

const DEFAULT_MODEL = "Xenova/all-MiniLM-L6-v2";

type Extractor = (
  texts: string[],
  options: { pooling: "mean"; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

export class TransformersEmbedder implements Embedder {
  private extractor: Promise<Extractor> | null = null;

  constructor(private readonly modelName = process.env.BOOKREC_MODEL ?? DEFAULT_MODEL) {}

  async embed(texts: string[]): Promise<number[][]> {
    // The model (and the library) load on first use, so offline runs and tests stay fast.
    this.extractor ??= import("@huggingface/transformers").then(async ({ pipeline, env }) => {
      if (process.env.BOOKREC_MODEL_CACHE) env.cacheDir = process.env.BOOKREC_MODEL_CACHE;
      return (await pipeline("feature-extraction", this.modelName)) as unknown as Extractor;
    });
    const extract = await this.extractor;
    const output = await extract(texts, { pooling: "mean", normalize: true });
    return output.tolist();
  }
}
