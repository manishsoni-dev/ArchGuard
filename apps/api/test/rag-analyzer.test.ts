import { describe, expect, it, vi } from "vitest";
import { RagArchitectureAnalyzer } from "../src/analysis/rag/rag-analyzer.js";
import { LLMService } from "../src/llm/llm-service.js";
import type { LLMProvider } from "../src/llm/llm-provider.js";
import type { LLMGenerateResult } from "../src/llm/types.js";
import { logger } from "../src/logger.js";

describe("RAG analyzer", () => {
  it("parses valid JSON", async () => {
    const analyzer = analyzerWithResponses([
      JSON.stringify({
        verdict: "FIT",
        confidence: 0.8,
        summary: "Fits architecture.",
        findings: [],
        retrievedContextSummary: "LLM used context."
      })
    ]);

    await expect(analyzer.analyze(baseInput())).resolves.toMatchObject({
      verdict: "FIT",
      retrievedContextSummary: expect.stringContaining("LLM used context")
    });
  });

  it("repairs invalid JSON once", async () => {
    const analyzer = analyzerWithResponses([
      "not-json",
      JSON.stringify({
        verdict: "FIT",
        confidence: 0.7,
        summary: "Repaired output fits architecture.",
        findings: [],
        retrievedContextSummary: "Repaired."
      })
    ]);

    await expect(analyzer.analyze(baseInput())).resolves.toMatchObject({ verdict: "FIT" });
  });

  it("returns INSUFFICIENT_EVIDENCE if repair fails", async () => {
    const analyzer = analyzerWithResponses(["not-json", "still-not-json"]);

    await expect(analyzer.analyze(baseInput())).resolves.toMatchObject({
      verdict: "INSUFFICIENT_EVIDENCE",
      summary: expect.stringContaining("Insufficient evidence")
    });
  });

  it("falls back to mock when configured", async () => {
    const provider = {
      name: "mock",
      model: "broken",
      generate: vi.fn(async () => {
        throw new Error("network down");
      })
    } satisfies LLMProvider;
    const analyzer = new RagArchitectureAnalyzer(new LLMService(provider), config(true), logger);

    const output = await analyzer.analyzeWithMetadata({
      ...baseInput(),
      diff: [
        "diff --git a/src/frontend/components/UserCard.tsx b/src/frontend/components/UserCard.tsx",
        "+++ b/src/frontend/components/UserCard.tsx",
        "@@ -1,1 +1,2 @@",
        "+import { db } from \"../../backend/db/client\";"
      ].join("\n")
    });

    expect(output.result.verdict).toBe("DRIFT_RISK");
    expect(output.metadata.fallbackUsed).toBe(true);
    expect(output.result.retrievedContextSummary).toContain("RAG fallback used");
  });
});

function analyzerWithResponses(responses: string[]) {
  let index = 0;
  const provider = {
    name: "mock",
    model: "fake-llm",
    generate: vi.fn(async (): Promise<LLMGenerateResult> => ({
      content: responses[index++] ?? responses[responses.length - 1] ?? "",
      model: "fake-llm",
      latencyMs: 1
    }))
  } satisfies LLMProvider;

  return new RagArchitectureAnalyzer(new LLMService(provider), config(false), logger);
}

function config(fallbackToMock: boolean) {
  return {
    promptVersion: "archguard-rag-v1",
    maxContextChars: 20_000,
    fallbackToMock,
    debugPrompts: false,
    llmTimeoutMs: 30_000,
    llmMaxOutputTokens: 1_200
  };
}

function baseInput() {
  return {
    repositoryFullName: "local/layered-app",
    pullRequestNumber: 1,
    diff: "+export const ok = true;",
    changedFiles: ["src/backend/services/user-service.ts"],
    retrievedContext: [
      {
        filePath: "docs/adr/0001-layered-architecture.md",
        chunkType: "ADR" as const,
        content: "Backend services may use backend repositories.",
        score: 1
      }
    ]
  };
}
