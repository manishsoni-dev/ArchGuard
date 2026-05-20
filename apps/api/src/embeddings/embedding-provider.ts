import type { EmbeddingInput, EmbeddingResult } from "./types.js";

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;
  embed(input: string): Promise<EmbeddingResult>;
  embedBatch(inputs: EmbeddingInput[]): Promise<EmbeddingResult[]>;
}
