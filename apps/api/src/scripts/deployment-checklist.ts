import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type CheckStatus = "ok" | "error";

export type DeploymentChecklistReport = {
  status: "ok" | "warning" | "error";
  checks: {
    envProductionExample: CheckStatus;
    dockerfiles: CheckStatus;
    dockerignore: CheckStatus;
    deploymentDocs: CheckStatus;
    productionEnvValidation: CheckStatus;
    databaseMigrationCommandDocumented: CheckStatus;
    workerDocumented: CheckStatus;
    webhookUpdateDocumented: CheckStatus;
  };
  nextSteps: string[];
};

export function buildDeploymentChecklist(rootDir = findRepositoryRoot(process.cwd())): DeploymentChecklistReport {
  const checks = {
    envProductionExample: fileExists(rootDir, ".env.production.example"),
    dockerfiles: fileExists(rootDir, "Dockerfile.api") === "ok" && fileExists(rootDir, "Dockerfile.worker") === "ok" ? "ok" : "error",
    dockerignore: hasAllDockerignoreEntries(rootDir),
    deploymentDocs: fileExists(rootDir, "docs/deployment.md") === "ok" && fileExists(rootDir, "docs/operations.md") === "ok" ? "ok" : "error",
    productionEnvValidation: fileExists(rootDir, "apps/api/src/scripts/validate-production-env.ts"),
    databaseMigrationCommandDocumented: fileContains(rootDir, "docs/deployment.md", "pnpm prisma migrate deploy --schema prisma/schema.prisma"),
    workerDocumented: fileContains(rootDir, "deploy/processes.md", "node apps/api/dist/src/jobs/worker.js"),
    webhookUpdateDocumented: fileContains(rootDir, "docs/deployment.md", "/webhooks/github")
  } satisfies DeploymentChecklistReport["checks"];

  const nextSteps = nextStepsFor(checks);
  return {
    status: nextSteps.length ? "error" : "ok",
    checks,
    nextSteps
  };
}

function fileExists(rootDir: string, relativePath: string): CheckStatus {
  return existsSync(path.join(rootDir, relativePath)) ? "ok" : "error";
}

function fileContains(rootDir: string, relativePath: string, expectedText: string): CheckStatus {
  const filePath = path.join(rootDir, relativePath);
  if (!existsSync(filePath)) return "error";
  return readFileSync(filePath, "utf8").includes(expectedText) ? "ok" : "error";
}

function hasAllDockerignoreEntries(rootDir: string): CheckStatus {
  const filePath = path.join(rootDir, ".dockerignore");
  if (!existsSync(filePath)) return "error";
  const content = readFileSync(filePath, "utf8");
  const requiredEntries = [".env", ".env.*", "*.pem", "node_modules", ".git", ".tmp", ".reports", "apps/api/.archguard"];
  return requiredEntries.every((entry) => content.split(/\r?\n/).includes(entry)) ? "ok" : "error";
}

function nextStepsFor(checks: DeploymentChecklistReport["checks"]): string[] {
  const nextSteps: string[] = [];
  if (checks.envProductionExample === "error") nextSteps.push("Add .env.production.example with safe placeholder values.");
  if (checks.dockerfiles === "error") nextSteps.push("Add Dockerfile.api and Dockerfile.worker.");
  if (checks.dockerignore === "error") nextSteps.push("Update .dockerignore so secrets and local caches are excluded from image builds.");
  if (checks.deploymentDocs === "error") nextSteps.push("Add docs/deployment.md and docs/operations.md.");
  if (checks.productionEnvValidation === "error") nextSteps.push("Add pnpm validate:prod-env support.");
  if (checks.databaseMigrationCommandDocumented === "error") nextSteps.push("Document pnpm prisma migrate deploy --schema prisma/schema.prisma.");
  if (checks.workerDocumented === "error") nextSteps.push("Document the production worker command.");
  if (checks.webhookUpdateDocumented === "error") nextSteps.push("Document the GitHub App webhook URL update.");
  return nextSteps;
}

function findRepositoryRoot(startDir: string): string {
  let current = path.resolve(startDir);
  for (let depth = 0; depth < 5; depth += 1) {
    if (existsSync(path.join(current, "pnpm-workspace.yaml")) && existsSync(path.join(current, "prisma/schema.prisma"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(startDir);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = buildDeploymentChecklist();
  console.log(JSON.stringify(report, null, 2));
  if (report.status === "error") process.exitCode = 1;
}
