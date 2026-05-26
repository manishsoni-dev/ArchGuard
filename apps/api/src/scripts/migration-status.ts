import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type MigrationStatusReport = {
  status: "ok" | "warning" | "error";
  pendingMigrations: boolean | null;
  message: string;
  nextSteps: string[];
};

export type MigrationStatusRunner = (command: string, args: string[]) => {
  status: number | null;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
  error?: Error;
};

export function checkMigrationStatus(runner: MigrationStatusRunner = defaultRunner): MigrationStatusReport {
  const result = runner("pnpm", ["exec", "prisma", "migrate", "status", "--schema", "prisma/schema.prisma"]);
  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "");
  const combined = `${stdout}\n${stderr}`;

  if (result.error || result.status === null) {
    return {
      status: "error",
      pendingMigrations: null,
      message: "Could not run Prisma migrate status.",
      nextSteps: ["Confirm pnpm is installed and DATABASE_URL is reachable."]
    };
  }

  if (/database.*(unreachable|can't be reached|could not connect)|can't reach database|authentication failed|connection refused/i.test(combined)) {
    return {
      status: "error",
      pendingMigrations: null,
      message: "Database could not be reached for migration status.",
      nextSteps: ["Check DATABASE_URL and network access from the deployment environment."]
    };
  }

  const pending = /following migration\(s\).*not yet been applied|database schema is not up to date|pending/i.test(combined);
  if (pending || result.status !== 0) {
    return {
      status: "warning",
      pendingMigrations: true,
      message: "Pending migrations may need to be applied.",
      nextSteps: ["Run pnpm prisma migrate deploy --schema prisma/schema.prisma before cutover."]
    };
  }

  return {
    status: "ok",
    pendingMigrations: false,
    message: "Database migrations are up to date.",
    nextSteps: []
  };
}

function defaultRunner(command: string, args: string[]) {
  return spawnSync(command, args, {
    cwd: findRepositoryRoot(process.cwd()),
    encoding: "utf8",
    shell: false
  });
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
  const report = checkMigrationStatus();
  console.log(JSON.stringify(report, null, 2));
  if (report.status === "error") process.exitCode = 1;
}
