import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

type IdentityStatus = "ok" | "warning" | "error";

export type GitHubIdentityFinding = {
  file: string;
  line: number;
  match: string;
};

export type GitHubIdentityReport = {
  status: IdentityStatus;
  oldOwner: string;
  newOwner: string;
  findings: GitHubIdentityFinding[];
  nextSteps: string[];
};

export type GitHubIdentityDependencies = {
  listFiles: () => Promise<string[]>;
  readFile: (file: string) => Promise<string>;
};

const execFileAsync = promisify(execFile);
const oldOwner = ["Maniss", "hhhhhh"].join("");
const newOwner = "manishsoni-dev";
const stalePattern = new RegExp(`github\\.com/${oldOwner}|${oldOwner}`, "g");
const textExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml"
]);

export async function githubIdentityCheck(
  dependencies: GitHubIdentityDependencies = {
    listFiles: listTrackedFiles,
    readFile: (file) => readFile(file, "utf8")
  }
): Promise<GitHubIdentityReport> {
  const files = (await dependencies.listFiles()).filter(shouldScanFile);
  const findings: GitHubIdentityFinding[] = [];

  for (const file of files) {
    const content = await dependencies.readFile(file);
    const lines = content.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      const matches = line.match(stalePattern);
      if (!matches) continue;
      for (const match of matches) {
        findings.push({ file, line: index + 1, match });
      }
    }
  }

  return {
    status: findings.length ? "error" : "ok",
    oldOwner,
    newOwner,
    findings,
    nextSteps: findings.length
      ? [`Replace stale ${oldOwner} repository-owner references with ${newOwner}, leaving unrelated GitHub App slugs unchanged.`]
      : []
  };
}

async function listTrackedFiles(): Promise<string[]> {
  const { stdout } = await execFileAsync("git", ["ls-files"], { encoding: "utf8" });
  return stdout.split(/\r?\n/).filter(Boolean);
}

function shouldScanFile(file: string): boolean {
  if (isIgnoredPath(file)) return false;
  if (isEnvFile(file)) return false;
  if (textExtensions.has(extname(file))) return true;
  return ["Dockerfile", "README", "LICENSE"].some((name) => file.endsWith(name));
}

function isIgnoredPath(file: string): boolean {
  return (
    file.startsWith(".git/") ||
    file.startsWith("node_modules/") ||
    file.startsWith(".tmp/") ||
    file.startsWith(".reports/") ||
    file.startsWith("apps/api/.archguard/")
  );
}

function isEnvFile(file: string): boolean {
  const name = file.split("/").pop() ?? file;
  return name === ".env" || name.startsWith(".env.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void githubIdentityCheck()
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      if (report.status === "error") process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
