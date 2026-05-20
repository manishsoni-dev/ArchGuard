import { describe, expect, it, vi } from "vitest";
import { formatPullRequestSummary, inspectPullRequest, parseInspectPrArgs } from "../src/scripts/inspect-pr.js";

describe("inspect-pr script helpers", () => {
  it("parses owner repo and PR args", () => {
    expect(parseInspectPrArgs(["--", "owner=acme", "repo=widgets", "pr=42"])).toEqual({
      owner: "acme",
      repo: "widgets",
      pr: 42
    });
  });

  it("rejects missing args", () => {
    expect(() => parseInspectPrArgs(["owner=acme"])).toThrow();
  });

  it("formats PR summary with mocked GitHub client", async () => {
    const summary = await inspectPullRequest(
      { owner: "acme", repo: "widgets", pr: 42 },
      {
        getPullRequest: vi.fn(async () => ({
          title: "Test PR",
          author: "octocat",
          baseBranch: "main",
          headBranch: "feature",
          headSha: "abc123"
        })),
        listChangedFiles: vi.fn(async () => [
          { filename: "src/service.ts", status: "modified", additions: 3, deletions: 1, changes: 4 }
        ])
      }
    );

    expect(summary).toMatchObject({
      repository: "acme/widgets",
      pullRequestNumber: 42,
      title: "Test PR",
      author: "octocat",
      baseBranch: "main",
      headBranch: "feature",
      headSha: "abc123",
      totals: { additions: 3, deletions: 1, files: 1 },
      hasEnoughInformationForArchGuard: true
    });
  });

  it("marks non-source empty summaries as insufficient for ArchGuard", () => {
    const summary = formatPullRequestSummary(
      { owner: "acme", repo: "widgets", pr: 42 },
      { title: "Docs", baseBranch: "main", headBranch: "docs", headSha: "abc123" },
      [{ filename: "image.png", status: "modified", additions: 0, deletions: 0, changes: 0 }]
    );

    expect(summary.hasEnoughInformationForArchGuard).toBe(false);
  });
});

