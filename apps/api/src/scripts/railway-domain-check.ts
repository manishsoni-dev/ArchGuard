import { fileURLToPath } from "node:url";
import { z } from "zod";
import { assertNoPlaceholderArgs, parseOrFriendlyError, printCliArgumentError } from "./cli-args.js";
import { smokeDeployment, type DeploymentSmokeReport, type HttpCheckDetails } from "./smoke-deployment.js";

type CheckStatus = "ok" | "error";

export type RailwayDomainCheckReport = {
  status: "ok" | "error";
  checks: {
    https: CheckStatus;
    health: CheckStatus;
    ready: CheckStatus;
    version: CheckStatus;
  };
  domainDiagnosis:
    | "ok"
    | "domain_not_attached_to_api_service"
    | "api_reachable_but_not_ready"
    | "api_unreachable_or_crashing";
  checkedUrls: {
    health: string;
    ready: string;
    version: string;
  };
  details: DeploymentSmokeReport["details"];
  nextSteps: string[];
};

const argsSchema = z.object({
  baseUrl: z.string().url()
});

const railwayDomainExamples = [
  "pnpm railway:domain-check -- baseUrl=https://archguard-production.up.railway.app"
];

export function parseRailwayDomainCheckArgs(argv: string[]): { baseUrl: string } {
  const parsedArgs: Record<string, string> = {};
  for (const arg of argv) {
    if (arg.startsWith("baseUrl=")) parsedArgs.baseUrl = arg.slice("baseUrl=".length);
    if (arg.startsWith("--baseUrl=")) parsedArgs.baseUrl = arg.slice("--baseUrl=".length);
  }
  assertNoPlaceholderArgs(parsedArgs, railwayDomainExamples);
  return parseOrFriendlyError(argsSchema, parsedArgs, railwayDomainExamples);
}

export async function checkRailwayDomain(input: { baseUrl: string }): Promise<RailwayDomainCheckReport> {
  const smoke = await smokeDeployment(input);
  const domainDiagnosis = diagnose(smoke);

  return {
    status: smoke.status,
    checks: {
      https: smoke.checks.https,
      health: smoke.checks.health,
      ready: smoke.checks.ready,
      version: smoke.checks.version
    },
    domainDiagnosis,
    checkedUrls: {
      health: smoke.details.health.url,
      ready: smoke.details.ready.url,
      version: smoke.details.version.url
    },
    details: smoke.details,
    nextSteps: nextStepsFor(domainDiagnosis, input.baseUrl, smoke)
  };
}

function diagnose(smoke: DeploymentSmokeReport): RailwayDomainCheckReport["domainDiagnosis"] {
  if (smoke.status === "ok") return "ok";
  if (Object.values(smoke.details).some(isRailwayApplicationNotFound)) return "domain_not_attached_to_api_service";
  if (smoke.checks.health === "ok" && smoke.checks.version === "ok" && smoke.checks.ready === "error") {
    return "api_reachable_but_not_ready";
  }
  return "api_unreachable_or_crashing";
}

function isRailwayApplicationNotFound(detail: HttpCheckDetails): boolean {
  return detail.statusCode === 404 && /application not found|train has not arrived/i.test(detail.bodyPreview ?? "");
}

function nextStepsFor(
  diagnosis: RailwayDomainCheckReport["domainDiagnosis"],
  baseUrl: string,
  smoke: DeploymentSmokeReport
): string[] {
  if (diagnosis === "ok") return [];
  if (diagnosis === "domain_not_attached_to_api_service") {
    return [
      "In Railway, open the API service, not the worker service.",
      "Attach or generate the public domain on the API service.",
      `Use the API service's actual public URL as baseUrl. The currently checked URL was ${baseUrl}.`,
      "Do not update the GitHub App webhook until /health, /ready, and /version all return 200."
    ];
  }
  if (diagnosis === "api_reachable_but_not_ready") {
    return [
      "The API service is reachable, so inspect /ready for database, Redis, env, or GitHub App readiness failures.",
      "Run pnpm railway:diagnose inside the Railway API service shell.",
      ...smoke.nextSteps
    ];
  }
  return [
    "Check Railway API service deployment logs for a crash loop or wrong start command.",
    "Confirm the API service uses Dockerfile.api and starts node apps/api/dist/src/server.js.",
    "Confirm the API binds to Railway's PORT on 0.0.0.0.",
    ...smoke.nextSteps
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let input: { baseUrl: string };
  try {
    input = parseRailwayDomainCheckArgs(process.argv.slice(2));
  } catch (error) {
    if (!printCliArgumentError(error)) {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
    process.exit();
  }

  void checkRailwayDomain(input)
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      if (report.status !== "ok") process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
