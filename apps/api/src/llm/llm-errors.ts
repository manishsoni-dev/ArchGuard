export type LLMErrorCode = "CONFIGURATION" | "TIMEOUT" | "PROVIDER" | "INVALID_RESPONSE";

export class LLMError extends Error {
  constructor(
    readonly code: LLMErrorCode,
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "LLMError";
  }
}

export function isLLMError(error: unknown): error is LLMError {
  return error instanceof LLMError;
}

