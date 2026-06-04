import { fileURLToPath } from "node:url";
import { z } from "zod";
import { assertNoPlaceholderArgs, parseOrFriendlyError, printCliArgumentError } from "./cli-args.js";

type CheckStatus = "ok" | "warning" | "error" | "not_checked";

export type DemoCheckInput = {
  apiUrl: string;
  webUrl?: string;
};

export type DemoCheckReport = {
  status: "ok" | "warning" | "error";
  checks: {
    apiHealth: CheckStatus;
    apiReady: CheckStatus;
    apiVersion: CheckStatus;
    demoStatus: CheckStatus;
    demoProof: CheckStatus;
    web: CheckStatus;
  };
  nextSteps: string[];
};

export type DemoCheckDependencies = {
  fetch: typeof fetch;
};

const argsSchema = z.object({
  apiUrl: z.string().url(),
  webUrl: z.string().url().optional()
});

const demoCheckExamples = [
  "pnpm demo:check -- apiUrl=https://your-replit-api.example",
  "pnpm demo:check -- apiUrl=https://your-replit-api.example webUrl=https://your-vercel-demo.example"
];

const apiChecks = [
  ["apiHealth", "/health"],
  ["apiReady", "/ready"],
  ["apiVersion", "/version"],
  ["demoStatus", "/demo/status"],
  ["demoProof", "/demo/proof"]
] as const;

export function parseDemoCheckArgs(argv: string[]): DemoCheckInput {
  const values: Record<string, string> = {};
  for (const arg of argv) {
    for (const key of ["apiUrl", "webUrl"] as const) {
      if (arg.startsWith(`${key}=`)) values[key] = arg.slice(key.length + 1);
      if (arg.startsWith(`--${key}=`)) values[key] = arg.slice(key.length + 3);
    }
  }

  assertNoPlaceholderArgs(values, demoCheckExamples);
  return parseOrFriendlyError(argsSchema, values, demoCheckExamples);
}

export async function demoCheck(
  input: DemoCheckInput,
  dependencies: DemoCheckDependencies = { fetch }
): Promise<DemoCheckReport> {
  const apiUrl = stripTrailingSlash(input.apiUrl);
  const checks: DemoCheckReport["checks"] = {
    apiHealth: "error",
    apiReady: "error",
    apiVersion: "error",
    demoStatus: "error",
    demoProof: "error",
    web: input.webUrl ? "warning" : "not_checked"
  };

  for (const [key, path] of apiChecks) {
    checks[key] = await urlStatus(`${apiUrl}${path}`, dependencies);
  }

  if (input.webUrl) {
    checks.web = (await urlStatus(stripTrailingSlash(input.webUrl), dependencies)) === "ok" ? "ok" : "warning";
  }

  return {
    status: overallStatus(checks),
    checks,
    nextSteps: nextStepsFor(checks, { apiUrl, webUrl: input.webUrl ? stripTrailingSlash(input.webUrl) : undefined })
  };
}

async function urlStatus(url: string, dependencies: DemoCheckDependencies): Promise<"ok" | "error"> {
  try {
    const response = await withTimeout(dependencies.fetch(url), 5_000);
    return response.ok ? "ok" : "error";
  } catch {
    return "error";
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

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function overallStatus(checks: DemoCheckReport["checks"]): DemoCheckReport["status"] {
  const values = Object.values(checks);
  if (values.some((value) => value === "error")) return "error";
  if (values.some((value) => value === "warning")) return "warning";
  return "ok";
}

function nextStepsFor(checks: DemoCheckReport["checks"], input: DemoCheckInput): string[] {
  const nextSteps: string[] = [];
  if (checks.apiHealth === "error") nextSteps.push(`Confirm the API is running and reachable at ${input.apiUrl}/health.`);
  if (checks.apiReady === "error") nextSteps.push(`Inspect ${input.apiUrl}/ready for database, Redis, or env readiness errors.`);
  if (checks.apiVersion === "error") nextSteps.push(`Confirm ${input.apiUrl}/version is served by the ArchGuard API process.`);
  if (checks.demoStatus === "error") nextSteps.push(`Confirm the demo API route is enabled at ${input.apiUrl}/demo/status.`);
  if (checks.demoProof === "error") nextSteps.push(`Confirm safe proof data is exposed at ${input.apiUrl}/demo/proof.`);
  if (checks.web === "warning" && input.webUrl) nextSteps.push(`Confirm the Vercel demo web app is reachable at ${input.webUrl}.`);
  return nextSteps;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let input: DemoCheckInput;
  try {
    input = parseDemoCheckArgs(process.argv.slice(2));
  } catch (error) {
    if (!printCliArgumentError(error)) {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
    process.exit();
  }

  void demoCheck(input)
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      if (report.status === "error") process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
