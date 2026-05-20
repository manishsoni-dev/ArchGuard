import { describe, expect, it, vi } from "vitest";
import { buildRetrievalReport } from "../src/scripts/verify-retrieval.js";
import { analyzeFixtureDiff } from "../src/scripts/analyze-fixture-diff.js";
import { buildPhase3VerificationReport } from "../src/scripts/verify-phase-3.js";
import type { ArchitectureAnalysisResult } from "../src/analysis/types.js";

describe("fixture verification helpers", () => {
  it("marks retrieval expectations passed and failed", () => {
    const passed = buildRetrievalReport(
      "frontend",
      [
        {
          chunkId: "1",
          filePath: "docs/adr/0002-frontend-must-not-import-db.md",
          chunkType: "ADR",
          content: "Frontend must not import db.",
          score: 0.9
        }
      ],
      ["docs/adr/0002-frontend-must-not-import-db.md"]
    );
    const failed = buildRetrievalReport("frontend", [], ["docs/adr/0002-frontend-must-not-import-db.md"]);

    expect(passed.expectations.passed).toBe(true);
    expect(failed.expectations.passed).toBe(false);
  });

  it("matches expected analyzer verdict with mocked analyzer", async () => {
    const output = await analyzeFixtureDiff({
      diffPath: "fixtures/pr-diffs/frontend-db-violation.diff",
      expectedVerdict: "DRIFT_RISK",
      seed: {
        tenantId: "tenant-1",
        repositoryId: "repo-1",
        fullName: "local/layered-app"
      },
      retriever: {
        retrieve: vi.fn(async () => [])
      },
      analyzer: {
        analyze: vi.fn(async (): Promise<ArchitectureAnalysisResult> => ({
          verdict: "DRIFT_RISK",
          confidence: 0.9,
          summary: "Violation",
          findings: [],
          retrievedContextSummary: "mock"
        }))
      }
    });

    expect(output.matchedExpectedVerdict).toBe(true);
  });

  it("marks phase 3 report failed when checks fail", () => {
    const report = buildPhase3VerificationReport({
      database: "ok",
      pgvectorExtension: "error",
      fixtureRepo: "ok",
      indexReport: {
        indexedFileCount: 1,
        codeChunkCount: 1,
        adrChunkCount: 1,
        architectureDocumentCount: 2,
        embeddingCounts: {
          pending: 0,
          embedded: 2,
          failed: 0
        }
      },
      retrievalReports: [],
      analyzerChecks: {
        cleanChange: "FIT",
        frontendDbViolation: "DRIFT_RISK",
        emptyChange: "INSUFFICIENT_EVIDENCE"
      }
    });

    expect(report.overall).toBe("FAILED");
  });
});
