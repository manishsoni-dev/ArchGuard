import type { AppLogger } from "../../logger.js";
import type { LLMService } from "../../llm/llm-service.js";
import type { ArchitectureAnalyzer, AnalyzePullRequestInput, AnalyzerRunOutput } from "../analyzer.js";
import { MockArchitectureAnalyzer } from "../mock-analyzer.js";
import type { ArchitectureAnalysisResult } from "../types.js";
import { RagAnalyzerError } from "./analyzer-errors.js";
import { compressRetrievedContext } from "./context-compressor.js";
import { buildJsonRepairMessages, extractJsonObject } from "./json-repair.js";
import { parseRagAnalysisJson } from "./output-schema.js";
import { buildRagPrompt } from "./prompt-builder.js";

export type RagAnalyzerConfig = {
  promptVersion: string;
  maxContextChars: number;
  fallbackToMock: boolean;
  debugPrompts: boolean;
  llmTimeoutMs: number;
  llmMaxOutputTokens: number;
};

export class RagArchitectureAnalyzer implements ArchitectureAnalyzer {
  readonly providerName = "rag";
  readonly promptVersion: string;
  readonly modelName: string;

  private readonly fallbackAnalyzer = new MockArchitectureAnalyzer();

  constructor(
    private readonly llm: LLMService,
    private readonly config: RagAnalyzerConfig,
    private readonly logger: AppLogger
  ) {
    this.promptVersion = config.promptVersion;
    this.modelName = llm.model;
  }

  async analyze(input: AnalyzePullRequestInput): Promise<ArchitectureAnalysisResult> {
    return (await this.analyzeWithMetadata(input)).result;
  }

  async analyzeWithMetadata(input: AnalyzePullRequestInput): Promise<AnalyzerRunOutput> {
    const startedAt = Date.now();
    const compressed = compressRetrievedContext({
      context: input.retrievedContext,
      changedFiles: input.changedFiles,
      diff: input.diff,
      maxContextChars: this.config.maxContextChars
    });
    const prompt = buildRagPrompt({
      analysisInput: input,
      context: compressed,
      promptVersion: this.config.promptVersion
    });

    if (this.config.debugPrompts) {
      this.logger.debug(
        {
          repositoryFullName: input.repositoryFullName,
          pullRequestNumber: input.pullRequestNumber,
          promptVersion: this.config.promptVersion,
          systemPrompt: prompt.system,
          userPrompt: prompt.user
        },
        "Built ArchGuard RAG prompt"
      );
    }

    try {
      const generated = await this.llm.generate({
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user }
        ],
        responseFormat: "json",
        timeoutMs: this.config.llmTimeoutMs,
        maxOutputTokens: this.config.llmMaxOutputTokens
      });
      const result = await this.parseOrRepair(generated.content);
      const latencyMs = Date.now() - startedAt;

      return {
        result: withContextSummary(result, compressed.summary),
        metadata: {
          analyzerProvider: "rag",
          promptVersion: this.config.promptVersion,
          modelName: generated.model,
          analysisLatencyMs: latencyMs,
          fallbackUsed: false
        },
        trace: {
          prompt,
          rawLlmOutput: generated.content,
          parsedResult: withContextSummary(result, compressed.summary),
          retrievedContext: compressed.records
        }
      };
    } catch (error) {
      if (error instanceof RagAnalyzerError && error.code === "REPAIR_FAILED") {
        return {
          result: insufficientEvidenceResult(compressed.summary, error.message),
          metadata: {
            analyzerProvider: "rag",
            promptVersion: this.config.promptVersion,
            modelName: this.llm.model,
            analysisLatencyMs: Date.now() - startedAt,
            fallbackUsed: false
          },
          trace: {
            prompt,
            parsedResult: insufficientEvidenceResult(compressed.summary, error.message),
            retrievedContext: compressed.records
          }
        };
      }

      if (this.config.fallbackToMock) {
        this.logger.warn(
          {
            repositoryFullName: input.repositoryFullName,
            pullRequestNumber: input.pullRequestNumber,
            promptVersion: this.config.promptVersion,
            err: publicRagError(error)
          },
          "RAG analyzer failed; falling back to mock analyzer"
        );
        const fallback = await this.fallbackAnalyzer.analyze(input);
        return {
          result: {
            ...fallback,
            retrievedContextSummary: `${fallback.retrievedContextSummary}; RAG fallback used after ${publicRagError(error)}`
          },
          metadata: {
            analyzerProvider: "rag",
            promptVersion: this.config.promptVersion,
            modelName: this.llm.model,
            analysisLatencyMs: Date.now() - startedAt,
            fallbackUsed: true
          },
          trace: {
            prompt,
            parsedResult: fallback,
            retrievedContext: compressed.records
          }
        };
      }

      return {
        result: insufficientEvidenceResult(compressed.summary, publicRagError(error)),
        metadata: {
          analyzerProvider: "rag",
          promptVersion: this.config.promptVersion,
          modelName: this.llm.model,
          analysisLatencyMs: Date.now() - startedAt,
          fallbackUsed: false
        },
        trace: {
          prompt,
          parsedResult: insufficientEvidenceResult(compressed.summary, publicRagError(error)),
          retrievedContext: compressed.records
        }
      };
    }
  }

  private async parseOrRepair(content: string): Promise<ArchitectureAnalysisResult> {
    try {
      const json = extractJsonObject(content) ?? content;
      return parseRagAnalysisJson(json);
    } catch (error) {
      const repair = await this.llm.generate({
        messages: buildJsonRepairMessages({
          invalidOutput: content.slice(0, 8_000),
          validationError: error instanceof Error ? error.message : "Invalid JSON"
        }),
        responseFormat: "json",
        timeoutMs: this.config.llmTimeoutMs,
        maxOutputTokens: this.config.llmMaxOutputTokens
      });

      try {
        const json = extractJsonObject(repair.content) ?? repair.content;
        return parseRagAnalysisJson(json);
      } catch (repairError) {
        throw new RagAnalyzerError("REPAIR_FAILED", "LLM output was invalid after JSON repair", repairError);
      }
    }
  }
}

function withContextSummary(
  result: ArchitectureAnalysisResult,
  retrievedContextSummary: string
): ArchitectureAnalysisResult {
  return {
    ...result,
    retrievedContextSummary: `${retrievedContextSummary}; ${result.retrievedContextSummary}`
  };
}

function insufficientEvidenceResult(contextSummary: string, reason: string): ArchitectureAnalysisResult {
  return {
    verdict: "INSUFFICIENT_EVIDENCE",
    confidence: 0.35,
    summary: `Insufficient evidence: RAG analysis could not produce a valid architecture verdict (${reason}).`,
    findings: [],
    retrievedContextSummary: `${contextSummary}; RAG analyzer returned insufficient evidence.`
  };
}

function publicRagError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "unknown RAG analyzer error";
}
