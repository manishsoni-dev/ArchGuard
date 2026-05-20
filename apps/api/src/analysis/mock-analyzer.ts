import type { ArchitectureAnalyzer, AnalyzePullRequestInput } from "./analyzer.js";
import type { ArchitectureAnalysisResult } from "./types.js";

const uiPathPattern = /(^|\/)(ui|frontend)\//i;
const dbImportPattern = /^\+\s*import\s+.+\s+from\s+['"](?:db(?:\/|['"])|[^'"]*\/db(?:\/|['"]))/;
const meaningfulFilePattern = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|go|rs|py|rb|java|kt|cs|php|swift)$/i;

export class MockArchitectureAnalyzer implements ArchitectureAnalyzer {
  readonly providerName = "mock";

  async analyze(input: AnalyzePullRequestInput): Promise<ArchitectureAnalysisResult> {
    if (!hasMeaningfulDiff(input.diff, input.changedFiles)) {
      return {
        verdict: "INSUFFICIENT_EVIDENCE",
        confidence: 0.92,
        summary: "No meaningful source changes were found for architecture analysis.",
        findings: [],
        retrievedContextSummary: summarizeRetrievedContext(input.retrievedContext)
      };
    }

    const drift = findUiToDbImport(input.diff);

    if (drift) {
      return {
        verdict: "DRIFT_RISK",
        confidence: 0.86,
        summary: "The PR appears to introduce a direct dependency from UI/frontend code into the database layer.",
        findings: [
          {
            title: "UI layer imports database module directly",
            severity: "HIGH",
            filePath: drift.filePath,
            startLine: drift.lineNumber,
            endLine: drift.lineNumber,
            evidence: [drift.line],
            recommendation:
              "Route data access through an application service, API client, or established boundary instead of importing database modules from UI code."
          }
        ],
        retrievedContextSummary: summarizeRetrievedContext(input.retrievedContext)
      };
    }

    return {
      verdict: "FIT",
      confidence: 0.78,
      summary: "The PR does not trigger the MVP architecture drift heuristic.",
      findings: [],
      retrievedContextSummary: summarizeRetrievedContext(input.retrievedContext)
    };
  }
}

function summarizeRetrievedContext(context: AnalyzePullRequestInput["retrievedContext"]): string {
  const adrCount = context.filter((chunk) => chunk.chunkType === "ADR").length;
  const codeCount = context.filter((chunk) => chunk.chunkType === "CODE" || chunk.chunkType === "TEST").length;
  const topFilePaths = Array.from(new Set(context.map((chunk) => chunk.filePath))).slice(0, 5);

  return [
    `Retrieved ${context.length} chunk${context.length === 1 ? "" : "s"}`,
    `${adrCount} ADR`,
    `${codeCount} code/test`,
    `top files: ${topFilePaths.length ? topFilePaths.join(", ") : "none"}`
  ].join("; ");
}

function hasMeaningfulDiff(diff: string, changedFiles: string[]): boolean {
  if (!diff.trim()) {
    return false;
  }

  const hasMeaningfulFile = changedFiles.some((filePath) => meaningfulFilePattern.test(filePath));
  const hasCodeChange = diff
    .split("\n")
    .some((line) => (line.startsWith("+") || line.startsWith("-")) && !line.startsWith("+++") && !line.startsWith("---"));

  return hasMeaningfulFile && hasCodeChange;
}

function findUiToDbImport(diff: string): { filePath: string; lineNumber?: number; line: string } | undefined {
  let currentFile = "";
  let currentNewLine: number | undefined;

  for (const line of diff.split("\n")) {
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (fileMatch?.[1]) {
      currentFile = fileMatch[1];
      currentNewLine = undefined;
      continue;
    }

    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch?.[1]) {
      currentNewLine = Number(hunkMatch[1]);
      continue;
    }

    if (currentFile && uiPathPattern.test(currentFile) && dbImportPattern.test(line)) {
      return { filePath: currentFile, lineNumber: currentNewLine, line };
    }

    if (currentNewLine !== undefined && !line.startsWith("-")) {
      currentNewLine += 1;
    }
  }

  return undefined;
}
