import { fileURLToPath } from "node:url";
import { z } from "zod";

type CheckStatus = "ok" | "error";

export type DeploymentSmokeReport = {
  status: "ok" | "error";
  checks: {
    health: CheckStatus;
    ready: CheckStatus;
    https: CheckStatus;
    webhookUrl: CheckStatus;
    version: CheckStatus;
  };
  nextSteps: string[];
};

export type DeploymentSmokeDependencies = {
  fetch: typeof fetch;
};

const argsSchema = z.object({
  baseUrl: z.string().url()
});

export function parseSmokeDeploymentArgs(argv: string[]): { baseUrl: string } {
  const parsedArgs: Record<string, string> = {};
  for (const arg of argv) {
    if (arg.startsWith("baseUrl=")) {
      parsedArgs.baseUrl = arg.slice("baseUrl=".length);
    } else if (arg.startsWith("--baseUrl=")) {
      parsedArgs.baseUrl = arg.slice("--baseUrl=".length);
    }
  }
  return argsSchema.parse(parsedArgs);
}

export async function smokeDeployment(
  input: { baseUrl: string },
  dependencies: DeploymentSmokeDependencies = { fetch }
): Promise<DeploymentSmokeReport> {
  const baseUrl = input.baseUrl.replace(/\/+$/, "");
  const checks = {
    https: baseUrl.startsWith("https://") ? "ok" : "error",
    health: await httpCheck(`${baseUrl}/health`, dependencies),
    ready: await httpCheck(`${baseUrl}/ready`, dependencies),
    webhookUrl: validWebhookUrl(`${baseUrl}/webhooks/github`) ? "ok" : "error",
    version: await httpCheck(`${baseUrl}/version`, dependencies, { optional: true })
  } satisfies DeploymentSmokeReport["checks"];
  const status = Object.values(checks).every((check) => check === "ok") ? "ok" : "error";

  return {
    status,
    checks,
    nextSteps: nextStepsFor(checks, baseUrl)
  };
}

async function httpCheck(
  url: string,
  dependencies: DeploymentSmokeDependencies,
  options: { optional?: boolean } = {}
): Promise<CheckStatus> {
  try {
    const response = await withTimeout(dependencies.fetch(url), 5_000);
    if (response.ok) return "ok";
    return options.optional && response.status === 404 ? "ok" : "error";
  } catch {
    return options.optional ? "ok" : "error";
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

function nextStepsFor(checks: DeploymentSmokeReport["checks"], baseUrl: string): string[] {
  const nextSteps: string[] = [];
  if (checks.https === "error") nextSteps.push("Use an https:// deployment URL.");
  if (checks.health === "error") nextSteps.push(`Confirm the API process is running at ${baseUrl}/health.`);
  if (checks.ready === "error") nextSteps.push(`Check ${baseUrl}/ready for database, Redis, env, or GitHub App readiness errors.`);
  if (checks.webhookUrl === "error") nextSteps.push("Configure the GitHub App webhook URL as PUBLIC_WEBHOOK_URL + /webhooks/github.");
  return nextSteps;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void smokeDeployment(parseSmokeDeploymentArgs(process.argv.slice(2)))
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      if (report.status !== "ok") process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
