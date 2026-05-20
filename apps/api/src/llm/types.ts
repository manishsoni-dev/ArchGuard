export type LLMProviderName = "mock" | "openai";

export type LLMMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LLMGenerateInput = {
  messages: LLMMessage[];
  responseFormat?: "json";
  timeoutMs?: number;
  maxOutputTokens?: number;
};

export type LLMGenerateResult = {
  content: string;
  model: string;
  latencyMs: number;
};

export type LLMConfig = {
  provider: LLMProviderName;
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
  openAiApiKey?: string;
};

