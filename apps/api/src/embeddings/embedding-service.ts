import type { Env } from "../env.js";
import type { EmbeddingProvider } from "./embedding-provider.js";
import { FakeEmbeddingProvider } from "./fake-embedding-provider.js";
import { OpenAIEmbeddingProvider } from "./openai-embedding-provider.js";
import type { EmbeddingConfig, EmbeddingInput, EmbeddingResult } from "./types.js";

export class EmbeddingService {
  constructor(
    readonly provider: EmbeddingProvider,
    readonly batchSize = 64
  ) {}

  async embed(input: string): Promise<EmbeddingResult> {
    return this.provider.embed(input);
  }

  async embedBatch(inputs: EmbeddingInput[]): Promise<EmbeddingResult[]> {
    const results: EmbeddingResult[] = [];

    for (let index = 0; index < inputs.length; index += this.batchSize) {
      results.push(...(await this.provider.embedBatch(inputs.slice(index, index + this.batchSize))));
    }

    return results;
  }
}

export function createEmbeddingService(config: EmbeddingConfig): EmbeddingService {
  const provider =
    config.provider === "openai"
      ? new OpenAIEmbeddingProvider(config.openAiApiKey ?? "", config.model, config.dimensions)
      : new FakeEmbeddingProvider(config.dimensions, config.model);

  return new EmbeddingService(provider, config.batchSize);
}

export function embeddingConfigFromEnv(env: Pick<
  Env,
  "EMBEDDING_PROVIDER" | "OPENAI_API_KEY" | "EMBEDDING_MODEL" | "EMBEDDING_DIMENSIONS" | "EMBEDDING_BATCH_SIZE"
>): EmbeddingConfig {
  return {
    provider: env.EMBEDDING_PROVIDER,
    openAiApiKey: env.OPENAI_API_KEY,
    model: env.EMBEDDING_MODEL,
    dimensions: env.EMBEDDING_DIMENSIONS,
    batchSize: env.EMBEDDING_BATCH_SIZE
  };
}
