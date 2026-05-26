import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { hasPemHeader, isPlaceholderValue, privateKeyLooksParseable } from "../github/github-app-env-validation.js";

type CheckStatus = "ok" | "error";

export type ProductionEnvValidationReport = {
  status: "ok" | "error";
  checks: {
    nodeEnv: CheckStatus;
    databaseUrl: CheckStatus;
    redisUrl: CheckStatus;
    githubAppId: CheckStatus;
    githubPrivateKey: CheckStatus;
    githubWebhookSecret: CheckStatus;
    githubClientId: CheckStatus;
    githubClientSecret: CheckStatus;
    publicWebhookUrl: CheckStatus;
    analyzerProvider: CheckStatus;
    llmProvider: CheckStatus;
    embeddingProvider: CheckStatus;
    openaiApiKey: CheckStatus;
  };
  problems: Array<{ field: string; message: string }>;
  nextSteps: string[];
};

const requiredFields = [
  "NODE_ENV",
  "DATABASE_URL",
  "REDIS_URL",
  "GITHUB_APP_ID",
  "GITHUB_PRIVATE_KEY",
  "GITHUB_WEBHOOK_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "PUBLIC_WEBHOOK_URL",
  "ANALYZER_PROVIDER",
  "LLM_PROVIDER",
  "EMBEDDING_PROVIDER"
] as const;

export function validateProductionEnv(source: NodeJS.ProcessEnv): ProductionEnvValidationReport {
  const problems: ProductionEnvValidationReport["problems"] = [];

  for (const field of requiredFields) {
    if (!source[field]?.trim()) {
      problems.push({ field, message: `${field} is required for production deployment.` });
    }
  }

  if (source.NODE_ENV && source.NODE_ENV !== "production") {
    problems.push({ field: "NODE_ENV", message: "NODE_ENV must be production." });
  }

  validateUrl("DATABASE_URL", source.DATABASE_URL, problems);
  validateUrl("REDIS_URL", source.REDIS_URL, problems);
  validateGitHubAppId(source.GITHUB_APP_ID, problems);
  validatePrivateKey(source.GITHUB_PRIVATE_KEY, problems);
  validateSecret("GITHUB_WEBHOOK_SECRET", source.GITHUB_WEBHOOK_SECRET, problems);
  validateSecret("GITHUB_CLIENT_ID", source.GITHUB_CLIENT_ID, problems);
  validateSecret("GITHUB_CLIENT_SECRET", source.GITHUB_CLIENT_SECRET, problems);
  validatePublicWebhookUrl(source.PUBLIC_WEBHOOK_URL, problems);
  validateEnum("ANALYZER_PROVIDER", source.ANALYZER_PROVIDER, ["mock", "rag"], problems);
  validateEnum("LLM_PROVIDER", source.LLM_PROVIDER, ["mock", "openai"], problems);
  validateEnum("EMBEDDING_PROVIDER", source.EMBEDDING_PROVIDER, ["fake", "openai"], problems);

  if ((source.LLM_PROVIDER === "openai" || source.EMBEDDING_PROVIDER === "openai") && !source.OPENAI_API_KEY?.trim()) {
    problems.push({
      field: "OPENAI_API_KEY",
      message: "OPENAI_API_KEY is required when LLM_PROVIDER=openai or EMBEDDING_PROVIDER=openai."
    });
  }

  const checks = {
    nodeEnv: statusFor(problems, "NODE_ENV"),
    databaseUrl: statusFor(problems, "DATABASE_URL"),
    redisUrl: statusFor(problems, "REDIS_URL"),
    githubAppId: statusFor(problems, "GITHUB_APP_ID"),
    githubPrivateKey: statusFor(problems, "GITHUB_PRIVATE_KEY"),
    githubWebhookSecret: statusFor(problems, "GITHUB_WEBHOOK_SECRET"),
    githubClientId: statusFor(problems, "GITHUB_CLIENT_ID"),
    githubClientSecret: statusFor(problems, "GITHUB_CLIENT_SECRET"),
    publicWebhookUrl: statusFor(problems, "PUBLIC_WEBHOOK_URL"),
    analyzerProvider: statusFor(problems, "ANALYZER_PROVIDER"),
    llmProvider: statusFor(problems, "LLM_PROVIDER"),
    embeddingProvider: statusFor(problems, "EMBEDDING_PROVIDER"),
    openaiApiKey: statusFor(problems, "OPENAI_API_KEY")
  } satisfies ProductionEnvValidationReport["checks"];

  return {
    status: problems.length ? "error" : "ok",
    checks,
    problems,
    nextSteps: nextStepsFor(problems)
  };
}

function validateGitHubAppId(value: string | undefined, problems: ProductionEnvValidationReport["problems"]): void {
  if (!value?.trim()) return;
  if (!/^\d+$/.test(value)) {
    problems.push({ field: "GITHUB_APP_ID", message: "GITHUB_APP_ID must be numeric." });
    return;
  }
  if (value === "123456" || isPlaceholderValue("GITHUB_APP_ID", value)) {
    problems.push({ field: "GITHUB_APP_ID", message: "GITHUB_APP_ID still looks like a placeholder." });
  }
}

function validatePrivateKey(value: string | undefined, problems: ProductionEnvValidationReport["problems"]): void {
  if (!value?.trim()) return;
  if (looksPlaceholder(value) || isPlaceholderValue("GITHUB_PRIVATE_KEY", value)) {
    problems.push({ field: "GITHUB_PRIVATE_KEY", message: "GITHUB_PRIVATE_KEY still contains placeholder text." });
    return;
  }
  if (!hasPemHeader(value) || !privateKeyLooksParseable(value)) {
    problems.push({ field: "GITHUB_PRIVATE_KEY", message: "GITHUB_PRIVATE_KEY is not a parseable PEM private key." });
  }
}

function validateSecret(
  field: "GITHUB_WEBHOOK_SECRET" | "GITHUB_CLIENT_ID" | "GITHUB_CLIENT_SECRET",
  value: string | undefined,
  problems: ProductionEnvValidationReport["problems"]
): void {
  if (!value?.trim()) return;
  if (looksPlaceholder(value) || isPlaceholderValue(field, value)) {
    problems.push({ field, message: `${field} still looks like a placeholder.` });
  }
}

function validatePublicWebhookUrl(value: string | undefined, problems: ProductionEnvValidationReport["problems"]): void {
  if (!value?.trim()) return;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    problems.push({ field: "PUBLIC_WEBHOOK_URL", message: "PUBLIC_WEBHOOK_URL must be a valid URL." });
    return;
  }

  if (parsed.protocol !== "https:") {
    problems.push({ field: "PUBLIC_WEBHOOK_URL", message: "PUBLIC_WEBHOOK_URL must use https://." });
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    problems.push({ field: "PUBLIC_WEBHOOK_URL", message: "PUBLIC_WEBHOOK_URL must not point to localhost." });
  }

  if (looksPlaceholder(value) || /your.*ngrok|ngrok.*placeholder/i.test(value)) {
    problems.push({ field: "PUBLIC_WEBHOOK_URL", message: "PUBLIC_WEBHOOK_URL still looks like a placeholder." });
  }
}

function validateUrl(field: string, value: string | undefined, problems: ProductionEnvValidationReport["problems"]): void {
  if (!value?.trim()) return;
  try {
    new URL(value);
  } catch {
    problems.push({ field, message: `${field} must be a valid URL.` });
  }
}

function validateEnum(
  field: string,
  value: string | undefined,
  allowedValues: string[],
  problems: ProductionEnvValidationReport["problems"]
): void {
  if (!value?.trim()) return;
  if (!allowedValues.includes(value)) {
    problems.push({ field, message: `${field} must be one of: ${allowedValues.join(", ")}.` });
  }
}

function looksPlaceholder(value: string): boolean {
  return /^your_/i.test(value) || /your[-_]/i.test(value) || /PASTE_/i.test(value) || /\.\.\./.test(value) || /KEY=/i.test(value);
}

function statusFor(problems: ProductionEnvValidationReport["problems"], field: string): CheckStatus {
  return problems.some((problem) => problem.field === field) ? "error" : "ok";
}

function nextStepsFor(problems: ProductionEnvValidationReport["problems"]): string[] {
  const fields = new Set(problems.map((problem) => problem.field));
  const nextSteps: string[] = [];

  if (fields.has("NODE_ENV")) nextSteps.push("Set NODE_ENV=production in the deployment environment.");
  if (fields.has("PUBLIC_WEBHOOK_URL")) nextSteps.push("Set PUBLIC_WEBHOOK_URL to the stable HTTPS deployment origin.");
  if (fields.has("GITHUB_PRIVATE_KEY")) nextSteps.push("Store the GitHub App private key as an escaped-newline PEM secret.");
  if (fields.has("OPENAI_API_KEY")) nextSteps.push("Either provide OPENAI_API_KEY or use LLM_PROVIDER=mock and EMBEDDING_PROVIDER=fake.");
  if (problems.length) nextSteps.push("Run pnpm validate:prod-env again after updating deployment variables.");

  return nextSteps;
}

function loadDotenvIfPresent(): void {
  for (const candidate of [path.resolve(process.cwd(), ".env.production"), path.resolve(process.cwd(), ".env")]) {
    if (existsSync(candidate)) {
      loadDotenv({ path: candidate });
      return;
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadDotenvIfPresent();
  const report = validateProductionEnv(process.env);
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "ok") process.exitCode = 1;
}
