export type RagAnalyzerErrorCode = "LLM_FAILED" | "INVALID_OUTPUT" | "REPAIR_FAILED";

export class RagAnalyzerError extends Error {
  constructor(
    readonly code: RagAnalyzerErrorCode,
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "RagAnalyzerError";
  }
}

