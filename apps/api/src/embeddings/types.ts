export type EmbeddingVector = number[];

export type EmbeddingInput = {
  id?: string;
  text: string;
};

export type EmbeddingResult = {
  embedding: EmbeddingVector;
  model: string;
  dimensions: number;
};

export type EmbeddingProviderName = "fake" | "openai";

export type EmbeddingConfig = {
  provider: EmbeddingProviderName;
  model: string;
  dimensions: number;
  batchSize: number;
  openAiApiKey?: string;
};
