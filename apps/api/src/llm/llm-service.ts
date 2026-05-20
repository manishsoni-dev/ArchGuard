import type { Env } from "../env.js";
import { MockLLMProvider } from "./mock-llm-provider.js";
import { OpenAILLMProvider } from "./openai-llm-provider.js";
import type { LLMProvider } from "./llm-provider.js";
import type { LLMConfig, LLMGenerateInput, LLMGenerateResult } from "./types.js";

export class LLMService {
  constructor(readonly provider: LLMProvider) {}

  get name() {
    return this.provider.name;
  }

  get model() {
    return this.provider.model;
  }

  generate(input: LLMGenerateInput): Promise<LLMGenerateResult> {
    return this.provider.generate(input);
  }
}

export function createLLMService(config: LLMConfig): LLMService {
  const provider =
    config.provider === "openai"
      ? new OpenAILLMProvider(config.openAiApiKey ?? "", config.model, config.timeoutMs, config.maxOutputTokens)
      : new MockLLMProvider(config.model);

  return new LLMService(provider);
}

export function llmConfigFromEnv(env: Pick<
  Env,
  "LLM_PROVIDER" | "LLM_MODEL" | "LLM_TIMEOUT_MS" | "LLM_MAX_OUTPUT_TOKENS" | "OPENAI_API_KEY"
>): LLMConfig {
  return {
    provider: env.LLM_PROVIDER,
    model: env.LLM_MODEL,
    timeoutMs: env.LLM_TIMEOUT_MS,
    maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
    openAiApiKey: env.OPENAI_API_KEY
  };
}

