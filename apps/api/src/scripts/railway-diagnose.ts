import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync } from "node:fs";
import { config as loadDotenv } from "dotenv";
import { hasPemHeader, isPlaceholderValue, privateKeyLooksParseable } from "../github/github-app-env-validation.js";

type CheckStatus = "ok" | "warning" | "error";

export type RailwayDiagnoseReport = {
  status: "ok" | "warning" | "error";
  checks: {
    nodeEnv: CheckStatus;
    port: CheckStatus;
    databaseUrl: CheckStatus;
    redisUrl: CheckStatus;
    githubAppEnv: CheckStatus;
    publicWebhookUrl: CheckStatus;
    analyzerMode: CheckStatus;
    llmMode: CheckStatus;
    embeddingMode: CheckStatus;
    privateKeyParse: CheckStatus;
  };
  safeConfig: {
    nodeEnv: string | null;
    port: string | null;
    publicWebhookUrl: string | null;
    analyzerProvider: string | null;
    llmProvider: string | null;
    embeddingProvider: string | null;
  };
  nextSteps: string[];
};

export function diagnoseRailwayEnv(source: NodeJS.ProcessEnv): RailwayDiagnoseReport {
  const checks = {
    nodeEnv: source.NODE_ENV === "production" ? "ok" : source.NODE_ENV ? "warning" : "error",
    port: validPort(source.PORT) ? "ok" : "warning",
    databaseUrl: source.DATABASE_URL?.trim() ? "ok" : "error",
    redisUrl: source.REDIS_URL?.trim() ? "ok" : "error",
    githubAppEnv: githubAppEnvPresent(source) ? "ok" : "error",
    publicWebhookUrl: validPublicWebhookUrl(source.PUBLIC_WEBHOOK_URL) ? "ok" : "error",
    analyzerMode: source.ANALYZER_PROVIDER === "rag" ? "ok" : "error",
    llmMode: source.LLM_PROVIDER === "mock" ? "ok" : "error",
    embeddingMode: source.EMBEDDING_PROVIDER === "fake" ? "ok" : "error",
    privateKeyParse: privateKeyParseStatus(source.GITHUB_PRIVATE_KEY)
  } satisfies RailwayDiagnoseReport["checks"];

  return {
    status: overallStatus(checks),
    checks,
    safeConfig: {
      nodeEnv: source.NODE_ENV ?? null,
      port: source.PORT ?? null,
      publicWebhookUrl: source.PUBLIC_WEBHOOK_URL ?? null,
      analyzerProvider: source.ANALYZER_PROVIDER ?? null,
      llmProvider: source.LLM_PROVIDER ?? null,
      embeddingProvider: source.EMBEDDING_PROVIDER ?? null
    },
    nextSteps: nextStepsFor(checks)
  };
}

function validPort(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65_536;
}

function githubAppEnvPresent(source: NodeJS.ProcessEnv): boolean {
  return (
    validGitHubAppId(source.GITHUB_APP_ID) &&
    validSecret("GITHUB_WEBHOOK_SECRET", source.GITHUB_WEBHOOK_SECRET) &&
    validSecret("GITHUB_CLIENT_ID", source.GITHUB_CLIENT_ID) &&
    validSecret("GITHUB_CLIENT_SECRET", source.GITHUB_CLIENT_SECRET) &&
    privateKeyParseStatus(source.GITHUB_PRIVATE_KEY) === "ok"
  );
}

function validGitHubAppId(value: string | undefined): boolean {
  return Boolean(value?.trim() && /^\d+$/.test(value) && value !== "123456");
}

function validSecret(
  field: "GITHUB_WEBHOOK_SECRET" | "GITHUB_CLIENT_ID" | "GITHUB_CLIENT_SECRET",
  value: string | undefined
): boolean {
  return Boolean(value?.trim() && !isPlaceholderValue(field, value));
}

function validPublicWebhookUrl(value: string | undefined): boolean {
  if (!value?.trim() || isPlaceholderValue("PUBLIC_WEBHOOK_URL", value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1";
  } catch {
    return false;
  }
}

function privateKeyParseStatus(value: string | undefined): CheckStatus {
  if (!value?.trim()) return "error";
  if (isPlaceholderValue("GITHUB_PRIVATE_KEY", value)) return "error";
  if (!hasPemHeader(value)) return "error";
  return privateKeyLooksParseable(value) ? "ok" : "error";
}

function overallStatus(checks: RailwayDiagnoseReport["checks"]): RailwayDiagnoseReport["status"] {
  const values = Object.values(checks);
  if (values.some((value) => value === "error")) return "error";
  if (values.some((value) => value === "warning")) return "warning";
  return "ok";
}

function nextStepsFor(checks: RailwayDiagnoseReport["checks"]): string[] {
  const nextSteps: string[] = [];
  if (checks.nodeEnv !== "ok") nextSteps.push("Set NODE_ENV=production in Railway.");
  if (checks.port !== "ok") nextSteps.push("Confirm Railway injects PORT and the API service does not hardcode a different port.");
  if (checks.databaseUrl !== "ok") nextSteps.push("Attach Postgres and set DATABASE_URL.");
  if (checks.redisUrl !== "ok") nextSteps.push("Attach Redis and set REDIS_URL.");
  if (checks.githubAppEnv !== "ok" || checks.privateKeyParse !== "ok") {
    nextSteps.push("Set GitHub App id, escaped private key, webhook secret, client id, and client secret.");
  }
  if (checks.publicWebhookUrl !== "ok") {
    nextSteps.push("Set PUBLIC_WEBHOOK_URL to https://archguard-production.up.railway.app or your stable Railway domain.");
  }
  if (checks.analyzerMode !== "ok" || checks.llmMode !== "ok" || checks.embeddingMode !== "ok") {
    nextSteps.push("For the hosted demo use ANALYZER_PROVIDER=rag, LLM_PROVIDER=mock, EMBEDDING_PROVIDER=fake.");
  }
  return nextSteps;
}

function loadDotenvIfPresent(): void {
  for (const candidate of [path.resolve(process.cwd(), ".env.production"), path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "../../.env")]) {
    if (existsSync(candidate)) {
      loadDotenv({ path: candidate });
      return;
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadDotenvIfPresent();
  const report = diagnoseRailwayEnv(process.env);
  console.log(JSON.stringify(report, null, 2));
  if (report.status === "error") process.exitCode = 1;
}
