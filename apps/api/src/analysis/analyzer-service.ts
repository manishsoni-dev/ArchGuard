import type { Env } from "../env.js";
import type { AppLogger } from "../logger.js";
import { createLLMService, llmConfigFromEnv } from "../llm/llm-service.js";
import type { ArchitectureAnalyzer } from "./analyzer.js";
import { MockArchitectureAnalyzer } from "./mock-analyzer.js";
import { RagArchitectureAnalyzer } from "./rag/rag-analyzer.js";

export function createArchitectureAnalyzer(
  env: Pick<
    Env,
    | "ANALYZER_PROVIDER"
    | "RAG_FALLBACK_TO_MOCK"
    | "RAG_PROMPT_VERSION"
    | "RAG_MAX_CONTEXT_CHARS"
    | "DEBUG_RAG_PROMPTS"
    | "LLM_PROVIDER"
    | "LLM_MODEL"
    | "LLM_TIMEOUT_MS"
    | "LLM_MAX_OUTPUT_TOKENS"
    | "OPENAI_API_KEY"
  >,
  logger: AppLogger
): ArchitectureAnalyzer {
  if (env.ANALYZER_PROVIDER === "mock") {
    return new MockArchitectureAnalyzer();
  }

  return new RagArchitectureAnalyzer(createLLMService(llmConfigFromEnv(env)), {
    promptVersion: env.RAG_PROMPT_VERSION,
    maxContextChars: env.RAG_MAX_CONTEXT_CHARS,
    fallbackToMock: env.RAG_FALLBACK_TO_MOCK,
    debugPrompts: env.DEBUG_RAG_PROMPTS,
    llmTimeoutMs: env.LLM_TIMEOUT_MS,
    llmMaxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS
  }, logger);
}

