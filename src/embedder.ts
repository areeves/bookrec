/** Local sentence-embedding model via Transformers.js (ONNX, runs on CPU). */
import type { Embedder } from "./ports.js";

const DEFAULT_MODEL = "Xenova/all-MiniLM-L6-v2";
// Each batch is padded to its longest text, so one huge batch can exhaust memory
// (the process is then killed with no message). Override with BOOKREC_BATCH_SIZE.
const DEFAULT_BATCH_SIZE = 16;

type Extractor = (
  texts: string[],
  options: { pooling: "mean"; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

export class TransformersEmbedder implements Embedder {
  private extractor: Promise<Extractor> | null = null;

  constructor(readonly modelName = process.env.BOOKREC_MODEL ?? DEFAULT_MODEL) {}

  async embed(texts: string[]): Promise<number[][]> {
    // The model (and the library) load on first use, so offline runs and tests stay fast.
    this.extractor ??= import("@huggingface/transformers").then(async ({ pipeline, env }) => {
      if (process.env.BOOKREC_MODEL_CACHE) env.cacheDir = process.env.BOOKREC_MODEL_CACHE;
      return (await pipeline("feature-extraction", this.modelName)) as unknown as Extractor;
    });
    const extract = await this.extractor;
    const size = Math.max(1, Number(process.env.BOOKREC_BATCH_SIZE) || DEFAULT_BATCH_SIZE);
    const vectors: number[][] = [];
    for (let start = 0; start < texts.length; start += size) {
      const output = await extract(texts.slice(start, start + size), { pooling: "mean", normalize: true });
      vectors.push(...output.tolist());
    }
    return vectors;
  }
}
