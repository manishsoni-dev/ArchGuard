import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { checkPort, type PortCheckDependencies } from "./port-utils.js";
import { validateGitHubAppEnvFile } from "./validate-github-app-env.js";

type DoctorCheckStatus = "ok" | "warning" | "error";

export type LocalDoctorResult = {
  status: "ok" | "warning" | "error";
  checks: {
    envFile: "ok" | "error";
    port: "ok" | "error";
    githubApp: "ok" | "error";
    nodeModules: "ok" | "error";
    prismaClient: "ok" | "warning";
  };
  nextSteps: string[];
};

export type LocalDoctorDependencies = PortCheckDependencies & {
  cwd?: string;
};

export async function runLocalDoctor(dependencies: LocalDoctorDependencies = {}): Promise<LocalDoctorResult> {
  const repoRoot = await findRepoRoot(dependencies.cwd ?? process.cwd());
  const envPath = path.join(repoRoot, ".env");
  const envExists = await pathExists(envPath);
  const envContent = envExists ? await readFile(envPath, "utf8") : "";
  const port = extractPort(envContent);
  const portCheck = await checkPort(port, dependencies);
  const githubValidation = await validateGitHubAppEnvFile(envPath);
  const nodeModulesExists = await pathExists(path.join(repoRoot, "node_modules"));
  const prismaClientExists =
    (await pathExists(path.join(repoRoot, "node_modules/.prisma/client/index.js"))) ||
    (await pathExists(path.join(repoRoot, "node_modules/@prisma/client/index.d.ts")));

  const checks = {
    envFile: envExists ? "ok" : "error",
    port: portCheck.available ? "ok" : "error",
    githubApp: githubValidation.status === "ok" ? "ok" : "error",
    nodeModules: nodeModulesExists ? "ok" : "error",
    prismaClient: prismaClientExists ? "ok" : "warning"
  } satisfies LocalDoctorResult["checks"];

  return {
    status: doctorStatus(checks),
    checks,
    nextSteps: nextStepsFor(checks, port)
  };
}

async function findRepoRoot(cwd: string): Promise<string> {
  let current = path.resolve(cwd);
  for (;;) {
    if (await pathExists(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(cwd);
    }
    current = parent;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function extractPort(envContent: string): number {
  const match = envContent.match(/^PORT=(\d+)/m);
  return match ? Number.parseInt(match[1] ?? "3000", 10) : 3000;
}

function doctorStatus(checks: Record<string, DoctorCheckStatus>): LocalDoctorResult["status"] {
  if (Object.values(checks).some((status) => status === "error")) {
    return "error";
  }
  if (Object.values(checks).some((status) => status === "warning")) {
    return "warning";
  }
  return "ok";
}

function nextStepsFor(checks: LocalDoctorResult["checks"], port: number): string[] {
  const nextSteps: string[] = [];

  if (checks.envFile === "error") {
    nextSteps.push("Create .env from .env.example or run pnpm setup:github-app:interactive.");
  }
  if (checks.port === "error") {
    nextSteps.push(`Run pnpm check:port -- ${port}, then pnpm kill:port -- ${port} --yes if it is safe.`);
  }
  if (checks.githubApp === "error") {
    nextSteps.push("Run pnpm validate:github-app and fix the reported GitHub App settings.");
  }
  if (checks.nodeModules === "error") {
    nextSteps.push("Run pnpm install.");
  }
  if (checks.prismaClient === "warning") {
    nextSteps.push("Run pnpm prisma:generate.");
  }

  return nextSteps;
}

async function main(): Promise<void> {
  const result = await runLocalDoctor();
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
