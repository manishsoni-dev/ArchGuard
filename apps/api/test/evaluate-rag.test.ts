import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildRagEvalReport,
  compareVerdict,
  loadRagEvalCases,
  type RagEvalCaseReport,
  shouldWriteRagTraces,
  validateGolden,
  writeEvalReport,
  writeTraceFiles
} from "../src/scripts/evaluate-rag.js";

describe("RAG evaluation helpers", () => {
  it("loads and validates eval fixture cases", async () => {
    const cases = await loadRagEvalCases();

    expect(cases.length).toBeGreaterThanOrEqual(6);
    expect(cases[0]).toMatchObject({
      name: expect.any(String),
      description: expect.any(String),
      expectedVerdict: expect.any(String),
      diff: expect.any(String)
    });
  });

  it("compares expected and actual verdicts", () => {
    expect(compareVerdict("FIT", "FIT")).toBe(true);
    expect(compareVerdict("FIT", "DRIFT_RISK")).toBe(false);
  });

  it("marks failed eval reports correctly", () => {
    const report = buildRagEvalReport({
      analyzerProvider: "rag",
      llmProvider: "mock",
      cases: [
        {
          name: "case",
          description: "case",
          expectedVerdict: "FIT",
          actualVerdict: "DRIFT_RISK",
          passed: false,
          confidence: 0.8,
          latencyMs: 10,
          fallbackUsed: false,
          topEvidenceFiles: [],
          tokenEstimate: {
            estimatedInputTokens: 1,
            estimatedOutputTokens: 1,
            estimatedTotalTokens: 2
          }
        }
      ]
    });

    expect(report.passed).toBe(false);
    expect(report.failedCases).toBe(1);
    expect(report.confidenceBuckets["0.8-1.0"].total).toBe(1);
  });

  it("writes JSON reports with counts and token estimates", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "archguard-rag-report-"));
    const report = buildRagEvalReport({
      analyzerProvider: "rag",
      llmProvider: "mock",
      cases: [
        caseReport({
          passed: true,
          confidence: 0.9,
          tokenEstimate: {
            estimatedInputTokens: 10,
            estimatedOutputTokens: 5,
            estimatedTotalTokens: 15
          }
        })
      ]
    });

    const reportPath = await writeEvalReport(report, tempDir);
    const saved = JSON.parse(await readFile(reportPath, "utf8")) as typeof report;

    expect(saved.totalCases).toBe(1);
    expect(saved.passedCases).toBe(1);
    expect(saved.averageLatencyMs).toBe(10);
    expect(saved.confidenceBuckets["0.8-1.0"]).toEqual({ total: 1, passed: 1 });
    expect(saved.cases[0]?.tokenEstimate.estimatedTotalTokens).toBe(15);
  });

  it("controls trace writing and redacts secrets", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "archguard-rag-trace-"));

    expect(shouldWriteRagTraces({ DEBUG_RAG_PROMPTS: false })).toBe(false);
    expect(shouldWriteRagTraces({ DEBUG_RAG_PROMPTS: true })).toBe(true);

    await writeTraceFiles({
      reportRoot: tempDir,
      runId: "run-1",
      caseName: "Secret Case",
      analysis: {
        result: {
          verdict: "FIT",
          confidence: 0.8,
          summary: "ok",
          findings: [],
          retrievedContextSummary: "context"
        },
        metadata: {
          analyzerProvider: "rag",
          fallbackUsed: false
        },
        trace: {
          prompt: {
            system: "system",
            user: "OPENAI_API_KEY=sk-test-secret"
          },
          rawLlmOutput: "{\"verdict\":\"FIT\"}",
          retrievedContext: [],
          parsedResult: {
            verdict: "FIT",
            confidence: 0.8,
            summary: "ok",
            findings: [],
            retrievedContextSummary: "context"
          }
        }
      },
      retrievedContext: []
    });

    const traceDir = path.join(tempDir, "rag-traces", "run-1", "secret-case");
    await expect(readdir(traceDir)).resolves.toEqual(
      expect.arrayContaining(["prompt.txt", "raw-llm-output.json", "parsed-result.json", "retrieved-context.json"])
    );
    await expect(readFile(path.join(traceDir, "prompt.txt"), "utf8")).resolves.not.toContain("sk-test-secret");
  });

  it("validates golden verdict, evidence files, and severity", () => {
    expect(
      validateGolden({
        golden: {
          expectedVerdict: "DRIFT_RISK",
          mustMentionFiles: ["docs/adr/0002-frontend-must-not-import-db.md"],
          mustHaveFindingSeverity: "HIGH"
        },
        actualVerdict: "DRIFT_RISK",
        evidenceFiles: ["docs/adr/0002-frontend-must-not-import-db.md"],
        severities: ["HIGH"]
      }).passed
    ).toBe(true);

    const failed = validateGolden({
      golden: {
        expectedVerdict: "DRIFT_RISK",
        mustMentionFiles: ["docs/adr/0002-frontend-must-not-import-db.md"],
        mustHaveFindingSeverity: "HIGH"
      },
      actualVerdict: "FIT",
      evidenceFiles: [],
      severities: []
    });

    expect(failed.passed).toBe(false);
    expect(failed.failures.join("\n")).toContain("expected verdict DRIFT_RISK");
    expect(failed.failures.join("\n")).toContain("expected evidence to mention");
    expect(failed.failures.join("\n")).toContain("expected finding severity HIGH");
  });
});

function caseReport(overrides: Partial<RagEvalCaseReport> = {}): RagEvalCaseReport {
  return {
    name: "case",
    description: "case",
    expectedVerdict: "FIT" as const,
    actualVerdict: "FIT" as const,
    passed: true,
    confidence: 0.8,
    latencyMs: 10,
    fallbackUsed: false,
    topEvidenceFiles: [],
    tokenEstimate: {
      estimatedInputTokens: 1,
      estimatedOutputTokens: 1,
      estimatedTotalTokens: 2
    },
    ...overrides
  };
}
