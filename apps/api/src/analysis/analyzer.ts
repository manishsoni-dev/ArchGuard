import type { ChunkType } from "../indexing/language-chunker.js";
import type { ArchitectureAnalysisResult } from "./types.js";

export type RetrievedContextRecord = {
  chunkId?: string;
  filePath: string;
  chunkType?: ChunkType;
  startLine?: number;
  endLine?: number;
  symbolName?: string;
  content: string;
  score?: number;
};

export type AnalyzePullRequestInput = {
  repositoryFullName: string;
  pullRequestNumber: number;
  diff: string;
  changedFiles: string[];
  retrievedContext: RetrievedContextRecord[];
};

export type AnalyzerProviderName = "mock" | "rag";

export type AnalyzerRunMetadata = {
  analyzerProvider: AnalyzerProviderName;
  promptVersion?: string;
  modelName?: string;
  analysisLatencyMs?: number;
  fallbackUsed?: boolean;
};

export type AnalyzerRunOutput = {
  result: ArchitectureAnalysisResult;
  metadata: AnalyzerRunMetadata;
  trace?: AnalyzerRunTrace;
};

export type AnalyzerRunTrace = {
  prompt?: {
    system: string;
    user: string;
  };
  rawLlmOutput?: string;
  parsedResult?: ArchitectureAnalysisResult;
  retrievedContext?: RetrievedContextRecord[];
};

export interface ArchitectureAnalyzer {
  readonly providerName?: AnalyzerProviderName;
  readonly promptVersion?: string;
  readonly modelName?: string;
  analyze(input: AnalyzePullRequestInput): Promise<ArchitectureAnalysisResult>;
  analyzeWithMetadata?(input: AnalyzePullRequestInput): Promise<AnalyzerRunOutput>;
}

export async function analyzeWithMetadata(
  analyzer: ArchitectureAnalyzer,
  input: AnalyzePullRequestInput
): Promise<AnalyzerRunOutput> {
  if (analyzer.analyzeWithMetadata) {
    return analyzer.analyzeWithMetadata(input);
  }

  const startedAt = Date.now();
  const result = await analyzer.analyze(input);
  return {
    result,
    metadata: {
      analyzerProvider: analyzer.providerName ?? "mock",
      promptVersion: analyzer.promptVersion,
      modelName: analyzer.modelName,
      analysisLatencyMs: Date.now() - startedAt,
      fallbackUsed: false
    }
  };
}
