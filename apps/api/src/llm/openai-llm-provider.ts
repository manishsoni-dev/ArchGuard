import { LLMError } from "./llm-errors.js";
import type { LLMProvider } from "./llm-provider.js";
import type { LLMGenerateInput, LLMGenerateResult } from "./types.js";

type OpenAIChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  model?: string;
};

export class OpenAILLMProvider implements LLMProvider {
  readonly name = "openai";

  constructor(
    private readonly apiKey: string,
    readonly model = "gpt-4o-mini",
    private readonly defaultTimeoutMs = 30_000,
    private readonly defaultMaxOutputTokens = 1_200
  ) {
    if (!apiKey) {
      throw new LLMError("CONFIGURATION", "OPENAI_API_KEY is required when LLM_PROVIDER=openai");
    }
  }

  async generate(input: LLMGenerateInput): Promise<LLMGenerateResult> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? this.defaultTimeoutMs);

    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: this.model,
          messages: input.messages,
          max_tokens: input.maxOutputTokens ?? this.defaultMaxOutputTokens,
          temperature: 0,
          response_format: input.responseFormat === "json" ? { type: "json_object" } : undefined
        })
      });

      if (!response.ok) {
        throw new LLMError("PROVIDER", `OpenAI chat completion failed with HTTP ${response.status}`);
      }

      const body = (await response.json()) as OpenAIChatResponse;
      const content = body.choices?.[0]?.message?.content;

      if (!content) {
        throw new LLMError("INVALID_RESPONSE", "OpenAI chat completion did not return content");
      }

      return {
        content,
        model: body.model ?? this.model,
        latencyMs: Date.now() - startedAt
      };
    } catch (error) {
      if (error instanceof LLMError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new LLMError("TIMEOUT", "OpenAI chat completion timed out", error);
      }

      throw new LLMError("PROVIDER", "OpenAI chat completion failed", error);
    } finally {
      clearTimeout(timeout);
    }
  }
}

