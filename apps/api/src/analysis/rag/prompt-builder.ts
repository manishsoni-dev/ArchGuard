import type { AnalyzePullRequestInput } from "../analyzer.js";
import type { CompressedContext } from "./context-compressor.js";

export type RagPromptInput = {
  analysisInput: AnalyzePullRequestInput;
  context: CompressedContext;
  promptVersion: string;
};

export function buildRagPrompt(input: RagPromptInput): { system: string; user: string } {
  const noMeaningfulDiff = !hasMeaningfulSourceDiff(input.analysisInput.diff, input.analysisInput.changedFiles);
  const system = [
    "You are ArchGuard, an architecture fitness reviewer for GitHub pull requests.",
    "ArchGuard is not a generic code reviewer.",
    "ArchGuard evaluates whether the PR fits the repository architecture, documented decisions, module boundaries, and dependency direction.",
    "",
    "Check for:",
    "- module/layer boundary violations",
    "- dependency direction violations",
    "- ADR conflicts",
    "- missing companion changes",
    "- inconsistent patterns compared to retrieved examples",
    "- test/contract implications",
    "- insufficient evidence cases",
    "",
    "Do not:",
    "- invent ADRs",
    "- claim violations without evidence",
    "- make style-only comments",
    "- block merges",
    "- output markdown",
    "- output anything except JSON",
    "",
    "If retrieved context is insufficient, return INSUFFICIENT_EVIDENCE instead of guessing."
  ].join("\n");

  const user = [
    `Prompt version: ${input.promptVersion}`,
    `Repository: ${input.analysisInput.repositoryFullName}`,
    `Pull request: #${input.analysisInput.pullRequestNumber}`,
    `Changed files: ${input.analysisInput.changedFiles.length ? input.analysisInput.changedFiles.join(", ") : "none"}`,
    `Diff signal: ${noMeaningfulDiff ? "empty/no meaningful diff" : "meaningful source diff"}`,
    "",
    "Return JSON with exactly this shape:",
    '{"verdict":"FIT|DRIFT_RISK|INSUFFICIENT_EVIDENCE","confidence":0.0,"summary":"...","findings":[{"title":"...","severity":"LOW|MEDIUM|HIGH","filePath":"optional","startLine":1,"endLine":1,"evidence":["short evidence"],"recommendation":"actionable recommendation"}],"retrievedContextSummary":"..."}',
    "",
    "Retrieved architecture/code context:",
    input.context.formatted || "No repository context was retrieved.",
    "",
    "Pull request diff:",
    "```diff",
    truncateDiff(input.analysisInput.diff),
    "```"
  ].join("\n");

  return { system, user };
}

function hasMeaningfulSourceDiff(diff: string, changedFiles: string[]): boolean {
  const meaningfulFilePattern = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|go|rs|py|rb|java|kt|cs|php|swift)$/i;
  const hasMeaningfulFile = changedFiles.some((filePath) => meaningfulFilePattern.test(filePath));
  const hasCodeChange = diff
    .split("\n")
    .some((line) => (line.startsWith("+") || line.startsWith("-")) && !line.startsWith("+++") && !line.startsWith("---"));

  return Boolean(diff.trim()) && hasMeaningfulFile && hasCodeChange;
}

function truncateDiff(diff: string): string {
  const maxChars = 40_000;
  if (diff.length <= maxChars) {
    return diff;
  }

  return `${diff.slice(0, maxChars - 32)}\n... [diff truncated]`;
}

