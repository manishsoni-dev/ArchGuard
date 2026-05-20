import { describe, expect, it } from "vitest";
import { FakeEmbeddingProvider } from "../src/embeddings/fake-embedding-provider.js";
import { createEmbeddingService, embeddingConfigFromEnv } from "../src/embeddings/embedding-service.js";

describe("embedding providers", () => {
  it("fake provider is deterministic", async () => {
    const provider = new FakeEmbeddingProvider(8);

    await expect(provider.embed("same text")).resolves.toEqual(await provider.embed("same text"));
  });

  it("embedding service selects fake provider by default", () => {
    const config = embeddingConfigFromEnv({
      EMBEDDING_PROVIDER: "fake",
      OPENAI_API_KEY: undefined,
      EMBEDDING_MODEL: "text-embedding-3-small",
      EMBEDDING_DIMENSIONS: 1536,
      EMBEDDING_BATCH_SIZE: 64
    });
    const service = createEmbeddingService(config);

    expect(service.provider.name).toBe("fake");
    expect(service.provider.dimensions).toBe(1536);
  });
});
