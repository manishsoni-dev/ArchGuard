import { createHash } from "node:crypto";
import type { EmbeddingProvider } from "./embedding-provider.js";
import type { EmbeddingInput, EmbeddingResult } from "./types.js";

export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly name = "fake";

  constructor(
    readonly dimensions = 1536,
    readonly model = "fake-deterministic-v1"
  ) {}

  async embed(input: string): Promise<EmbeddingResult> {
    return {
      embedding: deterministicEmbedding(input, this.dimensions),
      model: this.model,
      dimensions: this.dimensions
    };
  }

  async embedBatch(inputs: EmbeddingInput[]): Promise<EmbeddingResult[]> {
    return Promise.all(inputs.map((input) => this.embed(input.text)));
  }
}

function deterministicEmbedding(input: string, dimensions: number): number[] {
  const values: number[] = [];
  let seed = input;

  while (values.length < dimensions) {
    const digest = createHash("sha256").update(seed).digest();
    for (const byte of digest) {
      values.push(Number(((byte / 255) * 2 - 1).toFixed(6)));
      if (values.length === dimensions) {
        break;
      }
    }
    seed = digest.toString("hex");
  }

  return values;
}
