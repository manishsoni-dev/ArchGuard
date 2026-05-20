import { validateGitHubAppEnv } from "./github-app-env-validation.js";

export type GitHubAppCheckInput = {
  GITHUB_APP_ID?: number | string;
  GITHUB_PRIVATE_KEY?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
};

export type GitHubAppCheckResult = {
  status: "ok" | "error";
  errors: string[];
  requiredPermissions: {
    contents: "read";
    pullRequests: "read";
    checks: "read-write";
    metadata: "read";
  };
  requiredEvents: ["pull_request"];
};

export function checkGitHubAppConfig(input: GitHubAppCheckInput): GitHubAppCheckResult {
  const validation = validateGitHubAppEnv({
    ...input,
    PUBLIC_WEBHOOK_URL: "https://github-app-check.local",
    TEST_GITHUB_OWNER: "local-owner",
    TEST_GITHUB_REPO: "local-repo"
  });
  const errors = validation.problems.map((problem) => problem.message);

  return {
    status: errors.length ? "error" : "ok",
    errors,
    requiredPermissions: {
      contents: "read",
      pullRequests: "read",
      checks: "read-write",
      metadata: "read"
    },
    requiredEvents: ["pull_request"]
  };
}
