import { describe, expect, it } from "vitest";
import { renderCheckRunSummary } from "../src/github/checks.js";

describe("Check Run markdown", () => {
  it("includes verdict, analyzer metadata, fallback status, and evidence files without prompts", () => {
    const markdown = renderCheckRunSummary(
      {
        verdict: "DRIFT_RISK",
        confidence: 0.88,
        summary: "Frontend imports database layer.",
        findings: [
          {
            title: "Frontend imports db",
            severity: "HIGH",
            filePath: "src/frontend/components/UserCard.tsx",
            evidence: ["Added import from backend/db/client."],
            recommendation: "Use the API boundary."
          }
        ],
        retrievedContextSummary:
          "Retrieved 3 chunks; top files: docs/adr/0002-frontend-must-not-import-db.md, src/frontend/components/UserCard.tsx"
      },
      {
        analyzerProvider: "rag",
        modelName: "mock",
        fallbackUsed: false,
        promptVersion: "archguard-rag-v1"
      }
    );

    expect(markdown).toContain("**Verdict:** DRIFT_RISK");
    expect(markdown).toContain("**Analyzer provider:** rag");
    expect(markdown).toContain("**Fallback used:** no");
    expect(markdown).toContain("docs/adr/0002-frontend-must-not-import-db.md");
    expect(markdown).toContain("src/frontend/components/UserCard.tsx");
    expect(markdown).not.toContain("Pull request diff:");
    expect(markdown).not.toContain("systemPrompt");
  });
});

