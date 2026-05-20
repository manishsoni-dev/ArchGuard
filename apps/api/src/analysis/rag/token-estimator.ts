export type TokenEstimate = {
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedTotalTokens: number;
  approximateCost?: number;
};

export type TokenCostConfig = {
  inputCostPer1MTokens?: number;
  outputCostPer1MTokens?: number;
};

export function estimateTokensFromChars(charCount: number): number {
  return Math.ceil(Math.max(0, charCount) / 4);
}

export function estimateRagTokens(input: {
  inputChars: number;
  outputChars: number;
  costConfig?: TokenCostConfig;
}): TokenEstimate {
  const estimatedInputTokens = estimateTokensFromChars(input.inputChars);
  const estimatedOutputTokens = estimateTokensFromChars(input.outputChars);
  const estimate: TokenEstimate = {
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedTotalTokens: estimatedInputTokens + estimatedOutputTokens
  };

  if (
    input.costConfig?.inputCostPer1MTokens !== undefined &&
    input.costConfig.outputCostPer1MTokens !== undefined
  ) {
    estimate.approximateCost =
      (estimatedInputTokens / 1_000_000) * input.costConfig.inputCostPer1MTokens +
      (estimatedOutputTokens / 1_000_000) * input.costConfig.outputCostPer1MTokens;
  }

  return estimate;
}

