import { fileURLToPath } from "node:url";
import { z } from "zod";
import { assertNoPlaceholderArgs, parseOrFriendlyError, printCliArgumentError } from "./cli-args.js";

type CheckStatus = "ok" | "error";

export type HttpCheckDetails = {
  url: string;
  statusCode: number | null;
  bodyPreview: string | null;
  errorMessage: string | null;
  looksLikeRailwayError: boolean;
  looksLikeHtml: boolean;
};

export type DeploymentSmokeReport = {
  status: "ok" | "error";
  checks: {
    health: CheckStatus;
    ready: CheckStatus;
    https: CheckStatus;
    webhookUrl: CheckStatus;
    version: CheckStatus;
  };
  details: {
    health: HttpCheckDetails;
    ready: HttpCheckDetails;
    version: HttpCheckDetails;
  };
  nextSteps: string[];
};

export type DeploymentSmokeDependencies = {
  fetch: typeof fetch;
};

const argsSchema = z.object({
  baseUrl: z.string().url()
});

const smokeDeploymentExamples = [
  "pnpm smoke:deployment -- baseUrl=https://archguard-production.up.railway.app"
];

export function parseSmokeDeploymentArgs(argv: string[]): { baseUrl: string } {
  const parsedArgs: Record<string, string> = {};
  for (const arg of argv) {
    if (arg.startsWith("baseUrl=")) {
      parsedArgs.baseUrl = arg.slice("baseUrl=".length);
    } else if (arg.startsWith("--baseUrl=")) {
      parsedArgs.baseUrl = arg.slice("--baseUrl=".length);
    }
  }
  assertNoPlaceholderArgs(parsedArgs, smokeDeploymentExamples);
  return parseOrFriendlyError(argsSchema, parsedArgs, smokeDeploymentExamples);
}

export async function smokeDeployment(
  input: { baseUrl: string },
  dependencies: DeploymentSmokeDependencies = { fetch }
): Promise<DeploymentSmokeReport> {
  const baseUrl = input.baseUrl.replace(/\/+$/, "");
  const health = await httpCheck(`${baseUrl}/health`, dependencies);
  const ready = await httpCheck(`${baseUrl}/ready`, dependencies);
  const version = await httpCheck(`${baseUrl}/version`, dependencies);
  const checks = {
    https: baseUrl.startsWith("https://") ? "ok" : "error",
    health: health.status,
    ready: ready.status,
    webhookUrl: validWebhookUrl(`${baseUrl}/webhooks/github`) ? "ok" : "error",
    version: version.status
  } satisfies DeploymentSmokeReport["checks"];
  const status = Object.values(checks).every((check) => check === "ok") ? "ok" : "error";

  return {
    status,
    checks,
    details: {
      health: health.details,
      ready: ready.details,
      version: version.details
    },
    nextSteps: nextStepsFor(checks, baseUrl, {
      health: health.details,
      ready: ready.details,
      version: version.details
    })
  };
}

async function httpCheck(
  url: string,
  dependencies: DeploymentSmokeDependencies
): Promise<{ status: CheckStatus; details: HttpCheckDetails }> {
  try {
    const response = await withTimeout(dependencies.fetch(url), 5_000);
    const bodyPreview = await safeBodyPreview(response);
    const details = {
      url,
      statusCode: response.status,
      bodyPreview,
      errorMessage: null,
      looksLikeRailwayError: looksLikeRailwayError(bodyPreview),
      looksLikeHtml: looksLikeHtml(bodyPreview)
    } satisfies HttpCheckDetails;

    return {
      status: response.ok ? "ok" : "error",
      details
    };
  } catch (error) {
    return {
      status: "error",
      details: {
        url,
        statusCode: null,
        bodyPreview: null,
        errorMessage: error instanceof Error ? error.message : String(error),
        looksLikeRailwayError: false,
        looksLikeHtml: false
      }
    };
  }
}

function validWebhookUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.pathname === "/webhooks/github";
  } catch {
    return false;
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error("Timed out")), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function nextStepsFor(
  checks: DeploymentSmokeReport["checks"],
  baseUrl: string,
  details: DeploymentSmokeReport["details"]
): string[] {
  const nextSteps: string[] = [];
  if (checks.https === "error") nextSteps.push("Use an https:// deployment URL.");
  if (Object.values(details).some((detail) => isRailwayApplicationNotFound(detail))) {
    nextSteps.push(
      "Railway returned Application not found. Attach this public domain to the ArchGuard API service, or replace baseUrl with the API service's actual Railway domain."
    );
    nextSteps.push("In Railway, confirm the public domain belongs to the API service, not the worker, database, Redis, or an old deleted service.");
  }
  if (checks.health === "error") {
    nextSteps.push(`Confirm the API process is running, bound to Railway's PORT, and reachable at ${baseUrl}/health.`);
  }
  if (checks.ready === "error") {
    nextSteps.push(`Check ${baseUrl}/ready for database, Redis, env, or GitHub App readiness errors.`);
  }
  if (checks.version === "error") nextSteps.push(`Confirm ${baseUrl}/version is served by the ArchGuard API process.`);
  if (checks.webhookUrl === "error") nextSteps.push("Configure the GitHub App webhook URL as PUBLIC_WEBHOOK_URL + /webhooks/github.");
  return nextSteps;
}

async function safeBodyPreview(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "";
  }
}

function looksLikeRailwayError(value: string | null): boolean {
  return /railway|application failed|application not found|upstream|502|503|bad gateway/i.test(value ?? "");
}

function looksLikeHtml(value: string | null): boolean {
  return /<!doctype html|<html[\s>]/i.test(value ?? "");
}

function isRailwayApplicationNotFound(detail: HttpCheckDetails): boolean {
  return detail.statusCode === 404 && /application not found/i.test(detail.bodyPreview ?? "");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let input: { baseUrl: string };
  try {
    input = parseSmokeDeploymentArgs(process.argv.slice(2));
  } catch (error) {
    if (!printCliArgumentError(error)) {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
    process.exit();
  }

  void smokeDeployment(input)
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      if (report.status !== "ok") process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
