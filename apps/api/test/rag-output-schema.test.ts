import { describe, expect, it } from "vitest";
import { parseRagAnalysisJson } from "../src/analysis/rag/output-schema.js";

describe("RAG output schema", () => {
  it("accepts valid FIT", () => {
    expect(
      parseRagAnalysisJson(
        JSON.stringify({
          verdict: "FIT",
          confidence: 0.8,
          summary: "The change follows existing boundaries.",
          findings: [],
          retrievedContextSummary: "Retrieved 2 chunks."
        })
      ).verdict
    ).toBe("FIT");
  });

  it("accepts valid DRIFT_RISK with findings", () => {
    const result = parseRagAnalysisJson(
      JSON.stringify({
        verdict: "DRIFT_RISK",
        confidence: 0.9,
        summary: "The change conflicts with an ADR.",
        findings: [
          {
            title: "Frontend imports database layer",
            severity: "HIGH",
            filePath: "src/frontend/App.tsx",
            evidence: ["Added import from db/client."],
            recommendation: "Use the API boundary instead."
          }
        ],
        retrievedContextSummary: "Retrieved 3 chunks."
      })
    );

    expect(result.findings).toHaveLength(1);
  });

  it("rejects DRIFT_RISK with no findings", () => {
    expect(() =>
      parseRagAnalysisJson(
        JSON.stringify({
          verdict: "DRIFT_RISK",
          confidence: 0.9,
          summary: "There is drift.",
          findings: [],
          retrievedContextSummary: "Retrieved 3 chunks."
        })
      )
    ).toThrow();
  });

  it("rejects confidence outside 0..1", () => {
    expect(() =>
      parseRagAnalysisJson(
        JSON.stringify({
          verdict: "FIT",
          confidence: 2,
          summary: "Looks fine.",
          findings: [],
          retrievedContextSummary: "Retrieved 1 chunk."
        })
      )
    ).toThrow();
  });

  it("rejects malformed JSON", () => {
    expect(() => parseRagAnalysisJson("{")).toThrow();
  });
});

