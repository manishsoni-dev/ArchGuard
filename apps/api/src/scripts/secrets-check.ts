import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type SecretFinding = {
  filePath: string;
  rule: string;
};

export type SecretsCheckReport = {
  status: "ok" | "error";
  findings: SecretFinding[];
  scannedFiles: number;
};

const ignoredExact = new Set([
  ".env.example",
  ".env.production.example",
  "apps/api/test/fixtures/test-private-key.pem",
  "test/fixtures/test-private-key.pem"
]);

const ignoredPrefixes = ["node_modules/", ".git/", ".tmp/", ".reports/", "apps/api/.archguard/"];

export function runSecretsCheck(input: { files?: Record<string, string> } = {}): SecretsCheckReport {
  const files = input.files ?? loadTrackedFiles();
  const findings: SecretFinding[] = [];

  for (const [filePath, content] of Object.entries(files)) {
    if (shouldIgnore(filePath)) continue;
    if (/^\.env(?:\.|$)/.test(filePath)) {
      findings.push({ filePath, rule: "env-file-tracked" });
      continue;
    }
    if (/OPENAI_API_KEY\s*=\s*sk-[A-Za-z0-9_-]{20,}/.test(content)) {
      findings.push({ filePath, rule: "openai-api-key" });
    }
    if (!isTestPath(filePath) && realLookingPemBlock(content)) {
      findings.push({ filePath, rule: "private-key-pem" });
    }
    if (/GITHUB_WEBHOOK_SECRET\s*=\s*(?!CHANGE_ME|your_|PASTE_|test|valid|placeholder)[A-Za-z0-9_./+=-]{20,}/i.test(content)) {
      findings.push({ filePath, rule: "github-webhook-secret" });
    }
    if (/GITHUB_CLIENT_SECRET\s*=\s*(?!CHANGE_ME|your_|PASTE_|test|valid|placeholder)[A-Za-z0-9_./+=-]{20,}/i.test(content)) {
      findings.push({ filePath, rule: "github-client-secret" });
    }
  }

  return {
    status: findings.length ? "error" : "ok",
    findings,
    scannedFiles: Object.keys(files).filter((filePath) => !shouldIgnore(filePath)).length
  };
}

function loadTrackedFiles(): Record<string, string> {
  const rootDir = findRepositoryRoot(process.cwd());
  const result = spawnSync("git", ["-C", rootDir, "ls-files", "-z"], { encoding: "utf8", shell: false });
  if (result.status !== 0) {
    throw new Error("Could not list tracked files for secret scanning.");
  }

  const files: Record<string, string> = {};
  for (const filePath of result.stdout.split("\0").filter(Boolean)) {
    if (shouldIgnore(filePath)) continue;
    files[filePath] = readFileSync(path.join(rootDir, filePath), "utf8");
  }
  return files;
}

function shouldIgnore(filePath: string): boolean {
  return ignoredExact.has(filePath) || ignoredPrefixes.some((prefix) => filePath.startsWith(prefix));
}

function isTestPath(filePath: string): boolean {
  return filePath.startsWith("test/") || filePath.includes("/test/");
}

function realLookingPemBlock(content: string): boolean {
  const blocks = content.match(/-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA )?PRIVATE KEY-----/g) ?? [];
  return blocks.some((block) => {
    if (/PASTE|TEST|FIXTURE|EXAMPLE|DUMMY/i.test(block)) return false;
    return /[A-Za-z0-9+/=]{80,}/.test(block.replace(/\s+/g, ""));
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
  const report = runSecretsCheck();
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "ok") process.exitCode = 1;
}
