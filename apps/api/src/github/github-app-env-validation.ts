import { createPrivateKey } from "node:crypto";

export type GitHubAppEnvInput = {
  GITHUB_APP_ID?: number | string;
  GITHUB_PRIVATE_KEY?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  PUBLIC_WEBHOOK_URL?: string;
  TEST_GITHUB_OWNER?: string;
  TEST_GITHUB_REPO?: string;
};

export type GitHubAppDiagnosticChecks = {
  appId: "ok" | "error";
  privateKey: "ok" | "error";
  webhookSecret: "ok" | "error";
  clientId: "ok" | "error";
  clientSecret: "ok" | "error";
};

export type GitHubAppEnvProblem = {
  field: keyof GitHubAppEnvInput;
  message: string;
};

export type GitHubAppEnvValidationResult = {
  status: "ok" | "error";
  checks: GitHubAppDiagnosticChecks & {
    publicWebhookUrl: "ok" | "error";
    testRepo: "ok" | "error";
  };
  problems: GitHubAppEnvProblem[];
  nextSteps: string[];
};

const PLACEHOLDER_PATTERNS = [
  /^your_/i,
  /your_/i,
  /your-/i,
  /YOUR_REAL/i,
  /PASTE_/i,
  /\.\.\./,
  /KEY=/i,
  /your_real-ngrok-url/i
];

export function normalizePrivateKey(value: string): string {
  return stripWrappingQuotes(value).replace(/\\n/g, "\n");
}

export function toEscapedEnvPrivateKey(pem: string): string {
  return normalizePrivateKey(pem).trimEnd().replace(/\r\n/g, "\n").replace(/\n/g, "\\n");
}

export function hasPemHeader(value: string): boolean {
  const normalized = normalizePrivateKey(value);
  return normalized.includes("-----BEGIN RSA PRIVATE KEY-----") || normalized.includes("-----BEGIN PRIVATE KEY-----");
}

export function privateKeyLooksParseable(value: string): boolean {
  try {
    createPrivateKey(normalizePrivateKey(value));
    return true;
  } catch {
    return false;
  }
}

export function isPlaceholderValue(field: keyof GitHubAppEnvInput, rawValue: unknown): boolean {
  const value = String(rawValue ?? "").trim();

  if (!value) {
    return false;
  }

  if (field === "GITHUB_APP_ID" && value === "123456") {
    return true;
  }

  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

export function validateGitHubAppEnv(input: GitHubAppEnvInput): GitHubAppEnvValidationResult {
  const problems: GitHubAppEnvProblem[] = [];

  validateAppId(input, problems);
  validateRequiredSecret("GITHUB_PRIVATE_KEY", input.GITHUB_PRIVATE_KEY, problems);
  validatePrivateKey(input.GITHUB_PRIVATE_KEY, problems);
  validateRequiredSecret("GITHUB_WEBHOOK_SECRET", input.GITHUB_WEBHOOK_SECRET, problems);
  validateRequiredSecret("GITHUB_CLIENT_ID", input.GITHUB_CLIENT_ID, problems);
  validateRequiredSecret("GITHUB_CLIENT_SECRET", input.GITHUB_CLIENT_SECRET, problems);
  validatePublicWebhookUrl(input.PUBLIC_WEBHOOK_URL, problems);
  validateTestRepo(input, problems);

  const checks = {
    appId: hasProblem(problems, "GITHUB_APP_ID") ? "error" : "ok",
    privateKey: hasProblem(problems, "GITHUB_PRIVATE_KEY") ? "error" : "ok",
    webhookSecret: hasProblem(problems, "GITHUB_WEBHOOK_SECRET") ? "error" : "ok",
    clientId: hasProblem(problems, "GITHUB_CLIENT_ID") ? "error" : "ok",
    clientSecret: hasProblem(problems, "GITHUB_CLIENT_SECRET") ? "error" : "ok",
    publicWebhookUrl: hasProblem(problems, "PUBLIC_WEBHOOK_URL") ? "error" : "ok",
    testRepo:
      hasProblem(problems, "TEST_GITHUB_OWNER") || hasProblem(problems, "TEST_GITHUB_REPO") ? "error" : "ok"
  } satisfies GitHubAppEnvValidationResult["checks"];

  return {
    status: problems.length ? "error" : "ok",
    checks,
    problems,
    nextSteps: nextStepsFor(problems)
  };
}

export function githubAppDiagnostics(input: GitHubAppEnvInput): GitHubAppDiagnosticChecks {
  const result = validateGitHubAppEnv({
    ...input,
    PUBLIC_WEBHOOK_URL: input.PUBLIC_WEBHOOK_URL ?? "https://diagnostics-only.example.com",
    TEST_GITHUB_OWNER: input.TEST_GITHUB_OWNER ?? "diagnostics-owner",
    TEST_GITHUB_REPO: input.TEST_GITHUB_REPO ?? "diagnostics-repo"
  });

  return {
    appId: result.checks.appId,
    privateKey: result.checks.privateKey,
    webhookSecret: result.checks.webhookSecret,
    clientId: result.checks.clientId,
    clientSecret: result.checks.clientSecret
  };
}

function validateAppId(input: GitHubAppEnvInput, problems: GitHubAppEnvProblem[]): void {
  const rawValue = String(input.GITHUB_APP_ID ?? "").trim();
  if (!rawValue) {
    problems.push({ field: "GITHUB_APP_ID", message: "GITHUB_APP_ID is required." });
    return;
  }

  if (!/^\d+$/.test(rawValue)) {
    problems.push({ field: "GITHUB_APP_ID", message: "GITHUB_APP_ID must be numeric." });
    return;
  }

  if (isPlaceholderValue("GITHUB_APP_ID", rawValue)) {
    problems.push({ field: "GITHUB_APP_ID", message: "GITHUB_APP_ID still looks like a placeholder." });
  }
}

function validateRequiredSecret(
  field: "GITHUB_PRIVATE_KEY" | "GITHUB_WEBHOOK_SECRET" | "GITHUB_CLIENT_ID" | "GITHUB_CLIENT_SECRET",
  value: string | undefined,
  problems: GitHubAppEnvProblem[]
): void {
  if (!value?.trim()) {
    problems.push({ field, message: `${field} is required.` });
    return;
  }

  if (isPlaceholderValue(field, value)) {
    problems.push({ field, message: `${field} still contains placeholder text.` });
  }
}

function validatePrivateKey(value: string | undefined, problems: GitHubAppEnvProblem[]): void {
  if (!value?.trim()) {
    return;
  }

  if (!hasPemHeader(value)) {
    problems.push({
      field: "GITHUB_PRIVATE_KEY",
      message: "GITHUB_PRIVATE_KEY must include a PEM private key header."
    });
    return;
  }

  if (!privateKeyLooksParseable(value)) {
    problems.push({
      field: "GITHUB_PRIVATE_KEY",
      message: "GITHUB_PRIVATE_KEY is not parseable; check PEM formatting and escaped newlines."
    });
  }
}

function validatePublicWebhookUrl(value: string | undefined, problems: GitHubAppEnvProblem[]): void {
  if (!value?.trim()) {
    problems.push({ field: "PUBLIC_WEBHOOK_URL", message: "PUBLIC_WEBHOOK_URL is required." });
    return;
  }

  if (isPlaceholderValue("PUBLIC_WEBHOOK_URL", value)) {
    problems.push({ field: "PUBLIC_WEBHOOK_URL", message: "PUBLIC_WEBHOOK_URL still looks like a placeholder." });
    return;
  }

  if (!value.startsWith("https://")) {
    problems.push({ field: "PUBLIC_WEBHOOK_URL", message: "PUBLIC_WEBHOOK_URL must start with https://." });
  }
}

function validateTestRepo(input: GitHubAppEnvInput, problems: GitHubAppEnvProblem[]): void {
  for (const field of ["TEST_GITHUB_OWNER", "TEST_GITHUB_REPO"] as const) {
    const value = input[field];
    if (!value?.trim()) {
      problems.push({ field, message: `${field} is required.` });
    } else if (isPlaceholderValue(field, value)) {
      problems.push({ field, message: `${field} still looks like a placeholder.` });
    }
  }
}

function hasProblem(problems: GitHubAppEnvProblem[], field: keyof GitHubAppEnvInput): boolean {
  return problems.some((problem) => problem.field === field);
}

function nextStepsFor(problems: GitHubAppEnvProblem[]): string[] {
  const fields = new Set(problems.map((problem) => problem.field));
  const nextSteps: string[] = [];

  if (fields.has("GITHUB_PRIVATE_KEY")) {
    nextSteps.push("Generate a GitHub App private key, then run pnpm setup:github-app -- pem=/absolute/path/to/key.pem ...");
  }
  if (fields.has("PUBLIC_WEBHOOK_URL")) {
    nextSteps.push("Start ngrok with ngrok http 3000 and set PUBLIC_WEBHOOK_URL to the HTTPS forwarding URL.");
  }
  if (fields.has("TEST_GITHUB_OWNER") || fields.has("TEST_GITHUB_REPO")) {
    nextSteps.push("Set TEST_GITHUB_OWNER and TEST_GITHUB_REPO to the repository where the GitHub App is installed.");
  }
  if (
    fields.has("GITHUB_APP_ID") ||
    fields.has("GITHUB_WEBHOOK_SECRET") ||
    fields.has("GITHUB_CLIENT_ID") ||
    fields.has("GITHUB_CLIENT_SECRET")
  ) {
    nextSteps.push("Copy the missing GitHub App settings from GitHub Developer settings into .env.");
  }

  return nextSteps;
}

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return value;
}
