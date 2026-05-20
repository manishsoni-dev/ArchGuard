import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseDotenv } from "dotenv";
import {
  validateGitHubAppEnv,
  type GitHubAppEnvInput,
  type GitHubAppEnvValidationResult
} from "../github/github-app-env-validation.js";

export async function validateGitHubAppEnvFile(envPath?: string): Promise<GitHubAppEnvValidationResult> {
  const resolvedEnvPath = envPath ?? path.join(await findRepoRoot(process.cwd()), ".env");
  let rawEnv = "";
  try {
    rawEnv = await readFile(resolvedEnvPath, "utf8");
  } catch {
    const result = validateGitHubAppEnv({});
    return {
      ...result,
      problems: [
        { field: "GITHUB_APP_ID", message: `.env file was not found at ${resolvedEnvPath}.` },
        ...result.problems
      ],
      nextSteps: ["Create .env from .env.example, then run pnpm setup:github-app."]
    };
  }

  return validateGitHubAppEnv(pickGitHubEnv(parseDotenv(rawEnv)));
}

export function pickGitHubEnv(env: Record<string, string | undefined>): GitHubAppEnvInput {
  return {
    GITHUB_APP_ID: env.GITHUB_APP_ID,
    GITHUB_PRIVATE_KEY: env.GITHUB_PRIVATE_KEY,
    GITHUB_WEBHOOK_SECRET: env.GITHUB_WEBHOOK_SECRET,
    GITHUB_CLIENT_ID: env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET,
    PUBLIC_WEBHOOK_URL: env.PUBLIC_WEBHOOK_URL,
    TEST_GITHUB_OWNER: env.TEST_GITHUB_OWNER,
    TEST_GITHUB_REPO: env.TEST_GITHUB_REPO
  };
}

async function findRepoRoot(cwd: string): Promise<string> {
  let current = path.resolve(cwd);
  for (;;) {
    try {
      await readFile(path.join(current, "pnpm-workspace.yaml"), "utf8");
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        return path.resolve(cwd);
      }
      current = parent;
    }
  }
}

async function main(): Promise<void> {
  const result = await validateGitHubAppEnvFile();
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "error") {
    process.exitCode = 1;
  }
}

if (process.env.NODE_ENV !== "test") {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
