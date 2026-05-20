import type { LLMGenerateInput, LLMGenerateResult, LLMProviderName } from "./types.js";

export interface LLMProvider {
  readonly name: LLMProviderName;
  readonly model: string;
  generate(input: LLMGenerateInput): Promise<LLMGenerateResult>;
}

