import type { EmbeddingProvider } from "./embedding-provider.js";
import type { EmbeddingInput, EmbeddingResult } from "./types.js";

type OpenAIEmbeddingResponse = {
  data: Array<{
    embedding: number[];
    index: number;
  }>;
  model: string;
};

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = "openai";

  constructor(
    private readonly apiKey: string,
    readonly model = "text-embedding-3-small",
    readonly dimensions = 1536
  ) {
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required when EMBEDDING_PROVIDER=openai");
    }
  }

  async embed(input: string): Promise<EmbeddingResult> {
    const [result] = await this.embedBatch([{ text: input }]);

    if (!result) {
      throw new Error("OpenAI embedding response did not include a result");
    }

    return result;
  }

  async embedBatch(inputs: EmbeddingInput[]): Promise<EmbeddingResult[]> {
    if (inputs.length === 0) {
      return [];
    }

    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        input: inputs.map((input) => input.text),
        dimensions: this.dimensions
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI embeddings request failed with ${response.status}`);
    }

    const body = (await response.json()) as OpenAIEmbeddingResponse;
    return body.data
      .sort((a, b) => a.index - b.index)
      .map((item) => ({
        embedding: item.embedding,
        model: body.model,
        dimensions: item.embedding.length
      }));
  }
}
