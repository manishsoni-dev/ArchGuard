import { describe, expect, it } from "vitest";
import { MockArchitectureAnalyzer } from "../src/analysis/mock-analyzer.js";
import { parseArchitectureAnalysisResult } from "../src/analysis/types.js";

const analyzer = new MockArchitectureAnalyzer();

describe("MockArchitectureAnalyzer", () => {
  it("detects UI-to-DB import drift", async () => {
    const result = await analyzer.analyze({
      repositoryFullName: "acme/widgets",
      pullRequestNumber: 42,
      changedFiles: ["frontend/App.tsx"],
      retrievedContext: [],
      diff: [
        "diff --git a/frontend/App.tsx b/frontend/App.tsx",
        "+++ b/frontend/App.tsx",
        "@@ -0,0 +1,2 @@",
        "+import { db } from \"../db/client\";",
        "+export function App() { return null; }"
      ].join("\n")
    });

    expect(parseArchitectureAnalysisResult(result).verdict).toBe("DRIFT_RISK");
    expect(result.findings[0]?.severity).toBe("HIGH");
  });

  it("returns FIT for ordinary service-layer changes", async () => {
    const result = await analyzer.analyze({
      repositoryFullName: "acme/widgets",
      pullRequestNumber: 43,
      changedFiles: ["services/widget-service.ts"],
      retrievedContext: [
        {
          chunkId: "adr-1",
          filePath: "docs/adr/0002.md",
          chunkType: "ADR",
          content: "Frontend must not import db.",
          score: 0.9
        },
        {
          chunkId: "code-1",
          filePath: "services/widget-service.ts",
          chunkType: "CODE",
          content: "export function normalizeWidgetName() {}",
          score: 0.8
        }
      ],
      diff: [
        "diff --git a/services/widget-service.ts b/services/widget-service.ts",
        "+++ b/services/widget-service.ts",
        "@@ -1,2 +1,3 @@",
        "+export function normalizeWidgetName(name: string) { return name.trim(); }"
      ].join("\n")
    });

    expect(parseArchitectureAnalysisResult(result).verdict).toBe("FIT");
    expect(result.findings).toEqual([]);
    expect(result.retrievedContextSummary).toContain("2 chunks");
    expect(result.retrievedContextSummary).toContain("1 ADR");
  });

  it("returns INSUFFICIENT_EVIDENCE for empty diffs", async () => {
    const result = await analyzer.analyze({
      repositoryFullName: "acme/widgets",
      pullRequestNumber: 44,
      changedFiles: [],
      retrievedContext: [],
      diff: ""
    });

    expect(parseArchitectureAnalysisResult(result).verdict).toBe("INSUFFICIENT_EVIDENCE");
  });
});
