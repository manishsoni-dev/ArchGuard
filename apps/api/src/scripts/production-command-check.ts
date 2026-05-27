import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type CheckStatus = "ok" | "error";

export type ProductionCommandCheckReport = {
  status: "ok" | "error";
  checks: {
    rootBuildScript: CheckStatus;
    migrationCommandDocumented: CheckStatus;
    apiStartScript: CheckStatus;
    workerScript: CheckStatus;
    dockerfileApiCommand: CheckStatus;
    dockerfileWorkerCommand: CheckStatus;
    dockerfileApiPort: CheckStatus;
    dockerfilesAvoidEnvCopy: CheckStatus;
  };
  nextSteps: string[];
};

export function checkProductionCommands(rootDir = process.cwd()): ProductionCommandCheckReport {
  rootDir = findRepoRoot(rootDir);
  const rootPackage = readJson(path.join(rootDir, "package.json"));
  const apiPackage = readJson(path.join(rootDir, "apps/api/package.json"));
  const dockerfileApi = readText(path.join(rootDir, "Dockerfile.api"));
  const dockerfileWorker = readText(path.join(rootDir, "Dockerfile.worker"));
  const deploymentDocs = readText(path.join(rootDir, "docs/deployment.md")) + readText(path.join(rootDir, "deploy/processes.md"));

  const checks = {
    rootBuildScript: hasScript(rootPackage, "build") ? "ok" : "error",
    migrationCommandDocumented: /prisma migrate deploy --schema prisma\/schema\.prisma/.test(deploymentDocs) ? "ok" : "error",
    apiStartScript: hasScript(apiPackage, "start") && /server\.js/.test(String(apiPackage?.scripts?.start ?? "")) ? "ok" : "error",
    workerScript: hasScript(apiPackage, "start:worker") && /worker\.js/.test(String(apiPackage?.scripts?.["start:worker"] ?? "")) ? "ok" : "error",
    dockerfileApiCommand: /CMD\s+\["node",\s*"apps\/api\/dist\/src\/server\.js"\]/.test(dockerfileApi) ? "ok" : "error",
    dockerfileWorkerCommand: /CMD\s+\["node",\s*"apps\/api\/dist\/src\/jobs\/worker\.js"\]/.test(dockerfileWorker) ? "ok" : "error",
    dockerfileApiPort: /EXPOSE\s+3000/.test(dockerfileApi) ? "ok" : "error",
    dockerfilesAvoidEnvCopy: dockerfilesAvoidEnvCopy(dockerfileApi, dockerfileWorker) ? "ok" : "error"
  } satisfies ProductionCommandCheckReport["checks"];

  return {
    status: Object.values(checks).every((check) => check === "ok") ? "ok" : "error",
    checks,
    nextSteps: nextStepsFor(checks)
  };
}

function findRepoRoot(startDir: string): string {
  let current = path.resolve(startDir);

  while (true) {
    if (existsSync(path.join(current, "pnpm-workspace.yaml")) && existsSync(path.join(current, "apps/api/package.json"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startDir);
    current = parent;
  }
}

function readJson(filePath: string): { scripts?: Record<string, unknown> } | null {
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf8")) as { scripts?: Record<string, unknown> };
}

function readText(filePath: string): string {
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
}

function hasScript(pkg: { scripts?: Record<string, unknown> } | null, scriptName: string): boolean {
  return typeof pkg?.scripts?.[scriptName] === "string";
}

function dockerfilesAvoidEnvCopy(api: string, worker: string): boolean {
  const combined = `${api}\n${worker}`;
  return !/(COPY|ADD)\s+.*\.env/i.test(combined) && !/(COPY|ADD)\s+.*\.pem/i.test(combined);
}

function nextStepsFor(checks: ProductionCommandCheckReport["checks"]): string[] {
  const nextSteps: string[] = [];
  if (checks.apiStartScript !== "ok") nextSteps.push("Add an apps/api start script that runs the built API server.");
  if (checks.workerScript !== "ok") nextSteps.push("Add an apps/api start:worker script that runs the built worker.");
  if (checks.dockerfileApiCommand !== "ok") nextSteps.push("Ensure Dockerfile.api CMD starts the API server.");
  if (checks.dockerfileWorkerCommand !== "ok") nextSteps.push("Ensure Dockerfile.worker CMD starts the worker.");
  if (checks.dockerfilesAvoidEnvCopy !== "ok") nextSteps.push("Do not copy .env, .env.*, or PEM files into production images.");
  return nextSteps;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = checkProductionCommands();
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "ok") process.exitCode = 1;
}
