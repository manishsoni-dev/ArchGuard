import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  hasPemHeader,
  isPlaceholderValue,
  privateKeyLooksParseable,
  toEscapedEnvPrivateKey
} from "../github/github-app-env-validation.js";

const booleanFlagSchema = z.preprocess((value) => {
  if (typeof value === "string") {
    return value === "true";
  }
  return value;
}, z.boolean());

const setupArgsSchema = z.object({
  pem: z.string().optional(),
  appId: z.string().optional(),
  webhookSecret: z.string().min(1).optional(),
  clientId: z.string().min(1).optional(),
  clientSecret: z.string().min(1).optional(),
  webhookUrl: z.string().optional(),
  owner: z.string().min(1).optional(),
  repo: z.string().min(1).optional(),
  findPem: booleanFlagSchema.default(false),
  writeEnv: booleanFlagSchema.default(false)
});

const requiredSetupArgsSchema = setupArgsSchema.extend({
  pem: z.string().min(1),
  appId: z.string().min(1),
  webhookSecret: z.string().min(1),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  webhookUrl: z.string().min(1),
  owner: z.string().min(1),
  repo: z.string().min(1)
});

type SetupArgs = z.infer<typeof setupArgsSchema>;
type RequiredSetupArgs = z.infer<typeof requiredSetupArgsSchema>;

export type SetupGitHubAppEnvResult = {
  status: "ok" | "error";
  pemCandidates?: string[];
  outputFile?: string;
  envBackupFile?: string;
  messages: string[];
  errors: string[];
};

const GITHUB_ENV_KEYS = [
  "GITHUB_APP_ID",
  "GITHUB_PRIVATE_KEY",
  "GITHUB_WEBHOOK_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "PUBLIC_WEBHOOK_URL",
  "TEST_GITHUB_OWNER",
  "TEST_GITHUB_REPO"
] as const;

export async function runSetupGitHubAppEnv(rawArgs: string[], cwd = process.cwd()): Promise<SetupGitHubAppEnvResult> {
  const parsedArgsResult = setupArgsSchema.safeParse(parseCliArgs(rawArgs));
  if (!parsedArgsResult.success) {
    return {
      status: "error",
      messages: [],
      errors: parsedArgsResult.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    };
  }

  const parsedArgs = parsedArgsResult.data;
  const repoRoot = await findRepoRoot(cwd);

  if (parsedArgs.findPem) {
    const candidates = await findPemCandidates(cwd);
    return {
      status: "ok",
      pemCandidates: candidates,
      messages: candidates.length
        ? ["PEM candidates found. Pass one with pem=/absolute/path/to/private-key.pem."]
        : ["No PEM candidates found in ~/Downloads, ~/Desktop, or the current directory."],
      errors: []
    };
  }

  const requiredArgs = requiredSetupArgsSchema.safeParse(parsedArgs);
  if (!requiredArgs.success) {
    return {
      status: "error",
      messages: [],
      errors: requiredArgs.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    };
  }

  const setupErrors = validateSetupArgs(requiredArgs.data);
  if (setupErrors.length > 0) {
    return {
      status: "error",
      messages: ["Replace the placeholder setup command values with real GitHub App settings."],
      errors: setupErrors
    };
  }

  return writeGitHubAppEnv(requiredArgs.data, repoRoot);
}

export async function writeGitHubAppEnv(args: RequiredSetupArgs, repoRoot: string): Promise<SetupGitHubAppEnvResult> {
  const pemPath = path.resolve(args.pem);
  let pem: string;

  try {
    pem = await readFile(pemPath, "utf8");
  } catch {
    return {
      status: "error",
      messages: [],
      errors: [`PEM file does not exist or cannot be read: ${pemPath}`]
    };
  }

  if (!hasPemHeader(pem)) {
    return {
      status: "error",
      messages: ["PEM file found"],
      errors: ["Private key must contain -----BEGIN RSA PRIVATE KEY----- or -----BEGIN PRIVATE KEY-----."]
    };
  }

  if (!privateKeyLooksParseable(pem)) {
    return {
      status: "error",
      messages: ["PEM file found"],
      errors: ["Private key parse: error. Confirm this is the GitHub App private key PEM."]
    };
  }

  const envValues = {
    GITHUB_APP_ID: args.appId,
    GITHUB_PRIVATE_KEY: `"${toEscapedEnvPrivateKey(pem)}"`,
    GITHUB_WEBHOOK_SECRET: args.webhookSecret,
    GITHUB_CLIENT_ID: args.clientId,
    GITHUB_CLIENT_SECRET: args.clientSecret,
    PUBLIC_WEBHOOK_URL: args.webhookUrl,
    TEST_GITHUB_OWNER: args.owner,
    TEST_GITHUB_REPO: args.repo
  } satisfies Record<(typeof GITHUB_ENV_KEYS)[number], string>;

  const snippetPath = path.join(repoRoot, ".env.github.local");
  await writeFile(snippetPath, formatEnv(envValues), "utf8");

  const result: SetupGitHubAppEnvResult = {
    status: "ok",
    outputFile: snippetPath,
    messages: [
      "PEM file found",
      "Private key parse: ok",
      ".env.github.local written",
      "Next: copy the GitHub-related values into .env, or rerun with --write-env=true to merge them automatically."
    ],
    errors: []
  };

  if (args.writeEnv) {
    const envPath = path.join(repoRoot, ".env");
    const timestamp = timestampForFileName(new Date());
    const backupPath = path.join(repoRoot, `.env.backup.${timestamp}`);
    let existingEnv = "";

    try {
      existingEnv = await readFile(envPath, "utf8");
      await copyFile(envPath, backupPath);
      result.envBackupFile = backupPath;
    } catch {
      await mkdir(repoRoot, { recursive: true });
    }

    await writeFile(envPath, mergeEnv(existingEnv, envValues), "utf8");
    result.messages.push(".env updated with GitHub-related values");
  }

  return result;
}

export async function findPemCandidates(cwd = process.cwd()): Promise<string[]> {
  const searchDirs = [path.join(os.homedir(), "Downloads"), path.join(os.homedir(), "Desktop"), cwd];
  const candidates = new Set<string>();

  for (const dir of searchDirs) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".pem")) {
          candidates.add(path.join(dir, entry.name));
        }
      }
    } catch {
      // Missing common directories are fine on CI and developer machines.
    }
  }

  return [...candidates].sort();
}

export function parseCliArgs(args: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};

  for (const arg of args) {
    if (arg === "--find-pem") {
      parsed.findPem = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const [rawKey, rawValue = "true"] = arg.slice(2).split("=");
      if (!rawKey) {
        continue;
      }
      parsed[toCamelCase(rawKey)] = rawValue;
      continue;
    }
    const [rawKey, ...rest] = arg.split("=");
    if (rawKey && rest.length > 0) {
      parsed[toCamelCase(rawKey)] = rest.join("=");
    }
  }

  return parsed;
}

export function mergeEnv(existingEnv: string, updates: Record<string, string>): string {
  const remainingLines: string[] = [];
  const updateKeys = new Set(Object.keys(updates));

  for (const line of existingEnv.split(/\r?\n/)) {
    const keyMatch = line.match(/^([A-Z0-9_]+)=/);
    const key = keyMatch?.[1];
    if (!key || !updateKeys.has(key)) {
      remainingLines.push(line);
    }
  }

  const trimmedRemaining = remainingLines.join("\n").replace(/\n+$/g, "");
  const updateText = formatEnv(updates).trimEnd();
  return `${trimmedRemaining ? `${trimmedRemaining}\n` : ""}${updateText}\n`;
}

function formatEnv(values: Record<string, string>): string {
  return `${Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")}\n`;
}

async function findRepoRoot(cwd: string): Promise<string> {
  let current = path.resolve(cwd);
  for (;;) {
    try {
      await readFile(path.join(current, "pnpm-workspace.yaml"), "utf8");
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        return path.resolve(cwd);
      }
      current = parent;
    }
  }
}

function timestampForFileName(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function toCamelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function validateSetupArgs(args: RequiredSetupArgs): string[] {
  const errors: string[] = [];

  if (args.pem.includes("/absolute/path") || isPlaceholderValue("GITHUB_PRIVATE_KEY", args.pem)) {
    errors.push("pem must be the real absolute path to the downloaded GitHub App .pem file.");
  }

  if (!/^\d+$/.test(args.appId)) {
    errors.push("appId must be the numeric GitHub App ID from GitHub App settings.");
  } else if (isPlaceholderValue("GITHUB_APP_ID", args.appId)) {
    errors.push("appId still looks like a placeholder.");
  }

  for (const [field, envField] of [
    ["webhookSecret", "GITHUB_WEBHOOK_SECRET"],
    ["clientId", "GITHUB_CLIENT_ID"],
    ["clientSecret", "GITHUB_CLIENT_SECRET"]
  ] as const) {
    if (isPlaceholderValue(envField, args[field])) {
      errors.push(`${field} still looks like a placeholder.`);
    }
  }

  if (isPlaceholderValue("PUBLIC_WEBHOOK_URL", args.webhookUrl)) {
    errors.push("webhookUrl still looks like a placeholder.");
  } else if (!args.webhookUrl.startsWith("https://")) {
    errors.push("webhookUrl must start with https://.");
  } else {
    try {
      new URL(args.webhookUrl);
    } catch {
      errors.push("webhookUrl must be a valid HTTPS URL.");
    }
  }

  if (isPlaceholderValue("TEST_GITHUB_OWNER", args.owner)) {
    errors.push("owner still looks like a placeholder.");
  }

  if (isPlaceholderValue("TEST_GITHUB_REPO", args.repo)) {
    errors.push("repo still looks like a placeholder.");
  }

  return errors;
}

async function main(): Promise<void> {
  const result = await runSetupGitHubAppEnv(process.argv.slice(2));
  console.log(
    JSON.stringify(
      {
        status: result.status,
        pemCandidates: result.pemCandidates,
        outputFile: result.outputFile,
        envBackupFile: result.envBackupFile,
        messages: result.messages,
        errors: result.errors
      },
      null,
      2
    )
  );

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
