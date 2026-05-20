import type { AnalyzePullRequestInput } from "./analyzer.js";

export function buildArchitectureAnalysisPrompt(input: AnalyzePullRequestInput): string {
  const context = input.retrievedContext
    .map((record) => {
      return [
        `File: ${record.filePath}:${record.startLine}-${record.endLine}`,
        "```",
        record.content,
        "```"
      ].join("\n");
    })
    .join("\n\n");

  return [
    "You are ArchGuard, an architecture fitness reviewer for GitHub pull requests.",
    "Evaluate whether the PR follows existing repository architecture, conventions, module boundaries, and ADRs.",
    "Return JSON matching ArchitectureAnalysisResult exactly.",
    "",
    `Repository: ${input.repositoryFullName}`,
    `Pull request: #${input.pullRequestNumber}`,
    "",
    "Retrieved context:",
    context || "No repository context was retrieved.",
    "",
    "Pull request diff:",
    "```diff",
    input.diff,
    "```"
  ].join("\n");
}
