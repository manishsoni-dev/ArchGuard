import { describe, expect, it } from "vitest";
import { estimateRagTokens, estimateTokensFromChars } from "../src/analysis/rag/token-estimator.js";

describe("RAG token estimator", () => {
  it("estimates tokens from character count", () => {
    expect(estimateTokensFromChars(0)).toBe(0);
    expect(estimateTokensFromChars(1)).toBe(1);
    expect(estimateTokensFromChars(8)).toBe(2);
  });

  it("estimates approximate cost only when pricing is provided", () => {
    expect(estimateRagTokens({ inputChars: 400, outputChars: 40 }).approximateCost).toBeUndefined();

    const estimate = estimateRagTokens({
      inputChars: 400,
      outputChars: 40,
      costConfig: {
        inputCostPer1MTokens: 1,
        outputCostPer1MTokens: 2
      }
    });

    expect(estimate).toMatchObject({
      estimatedInputTokens: 100,
      estimatedOutputTokens: 10,
      estimatedTotalTokens: 110
    });
    expect(estimate.approximateCost).toBeCloseTo(0.00012);
  });
});

