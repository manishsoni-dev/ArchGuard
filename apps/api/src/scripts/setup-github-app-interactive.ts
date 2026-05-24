import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { z } from "zod";
import {
  hasPemHeader,
  isPlaceholderValue,
  privateKeyLooksParseable
} from "../github/github-app-env-validation.js";
import {
  buildGitHubEnvValues,
  findPemCandidates,
  findRepoRoot,
  mergeEnv,
  type RequiredSetupArgs
} from "./setup-github-app-env.js";

export type InteractivePrompter = {
  question: (prompt: string) => Promise<string>;
};

export type InteractiveSetupResult = {
  status: "ok" | "error";
  envBackupFile?: string;
  messages: string[];
  errors: string[];
  safeSummary?: {
    appId: string;
    clientId: string;
    clientSecret: string;
    webhookSecret: string;
    webhookUrl: string;
    owner: string;
    repo: string;
    pemPath: string;
  };
};

export type InteractiveSetupOptions = {
  cwd?: string;
  prompter: InteractivePrompter;
  writeOutput?: (message: string) => void;
};

export type InteractiveSetupCliOptions = InteractiveSetupOptions & {
  writeError?: (message: string) => void;
};

const interactiveInputSchema = z.object({
  appId: z.string().min(1),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  webhookSecret: z.string().min(1),
  webhookUrl: z.string().min(1),
  owner: z.string().min(1),
  repo: z.string().min(1),
  pem: z.string().min(1)
});

export async function runInteractiveGitHubAppSetup(options: InteractiveSetupOptions): Promise<InteractiveSetupResult> {
  const cwd = options.cwd ?? process.cwd();
  const writeOutput = options.writeOutput ?? (() => undefined);
  const repoRoot = await findRepoRoot(cwd);

  writeOutput("ArchGuard GitHub App setup");
  writeOutput("Secrets are masked in output and written only to .env.");

  const pem = await promptForPemPath(options.prompter, cwd, writeOutput);
  const inputValuesResult = interactiveInputSchema.safeParse({
    appId: await options.prompter.question("GitHub App ID: "),
    clientId: await options.prompter.question("Client ID: "),
    clientSecret: await options.prompter.question("Client Secret: "),
    webhookSecret: await options.prompter.question("Webhook Secret: "),
    webhookUrl: await options.prompter.question("Public ngrok HTTPS URL: "),
    owner: await options.prompter.question("GitHub repository owner: "),
    repo: await options.prompter.question("GitHub repository name: "),
    pem
  });

  if (!inputValuesResult.success) {
    return {
      status: "error",
      messages: ["GitHub App setup was not written because required answers were missing."],
      errors: inputValuesResult.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    };
  }

  const inputValues = inputValuesResult.data;
  const errors = await validateInteractiveInput(inputValues);
  if (errors.length > 0) {
    return {
      status: "error",
      messages: ["GitHub App setup was not written because some answers need correction."],
      errors
    };
  }

  try {
    const pemPath = path.resolve(inputValues.pem);
    const pemContents = await readFile(pemPath, "utf8");
    const args: RequiredSetupArgs = {
      pem: pemPath,
      appId: inputValues.appId,
      clientId: inputValues.clientId,
      clientSecret: inputValues.clientSecret,
      webhookSecret: inputValues.webhookSecret,
      webhookUrl: inputValues.webhookUrl,
      owner: inputValues.owner,
      repo: inputValues.repo,
      findPem: false,
      writeEnv: true
    };

    const envValues = buildGitHubEnvValues(args, pemContents);
    const envPath = path.join(repoRoot, ".env");
    const backupPath = path.join(repoRoot, `.env.backup.${timestampForFileName(new Date())}`);
    let existingEnv = "";

    try {
      existingEnv = await readFile(envPath, "utf8");
      await copyFile(envPath, backupPath);
    } catch {
      await mkdir(repoRoot, { recursive: true });
    }

    await writeFile(envPath, mergeEnv(existingEnv, envValues), "utf8");

    return {
      status: "ok",
      envBackupFile: existingEnv ? backupPath : undefined,
      messages: existingEnv
        ? [".env backup created", ".env updated with GitHub App settings"]
        : [".env created with GitHub App settings"],
      errors: [],
      safeSummary: {
        appId: inputValues.appId,
        clientId: maskSecret(inputValues.clientId),
        clientSecret: maskSecret(inputValues.clientSecret),
        webhookSecret: maskSecret(inputValues.webhookSecret),
        webhookUrl: inputValues.webhookUrl,
        owner: inputValues.owner,
        repo: inputValues.repo,
        pemPath
      }
    };
  } catch (error) {
    return {
      status: "error",
      messages: ["GitHub App setup could not update .env."],
      errors: [error instanceof Error ? error.message : String(error)]
    };
  }
}

export async function validateInteractiveInput(inputValues: z.infer<typeof interactiveInputSchema>): Promise<string[]> {
  const errors: string[] = [];

  if (!/^\d+$/.test(inputValues.appId) || isPlaceholderValue("GITHUB_APP_ID", inputValues.appId)) {
    errors.push("GitHub App ID must be numeric and cannot be a placeholder.");
  }

  if (isPlaceholderValue("GITHUB_CLIENT_ID", inputValues.clientId)) {
    errors.push("Client ID still looks like a placeholder.");
  }

  if (isPlaceholderValue("GITHUB_CLIENT_SECRET", inputValues.clientSecret)) {
    errors.push("Client Secret still looks like a placeholder.");
  }

  if (isPlaceholderValue("GITHUB_WEBHOOK_SECRET", inputValues.webhookSecret)) {
    errors.push("Webhook Secret still looks like a placeholder.");
  }

  if (isPlaceholderValue("PUBLIC_WEBHOOK_URL", inputValues.webhookUrl)) {
    errors.push("Public ngrok URL still looks like a placeholder.");
  } else if (!inputValues.webhookUrl.startsWith("https://")) {
    errors.push("Public ngrok URL must start with https://.");
  } else {
    try {
      new URL(inputValues.webhookUrl);
    } catch {
      errors.push("Public ngrok URL must be a valid URL.");
    }
  }

  if (isPlaceholderValue("TEST_GITHUB_OWNER", inputValues.owner)) {
    errors.push("Repository owner still looks like a placeholder.");
  }

  if (isPlaceholderValue("TEST_GITHUB_REPO", inputValues.repo)) {
    errors.push("Repository name still looks like a placeholder.");
  }

  const pemPath = path.resolve(inputValues.pem);
  let pemContents = "";
  try {
    pemContents = await readFile(pemPath, "utf8");
  } catch {
    errors.push(`PEM file does not exist or cannot be read: ${pemPath}`);
    return errors;
  }

  if (!hasPemHeader(pemContents)) {
    errors.push("PEM file must contain a private key header.");
  } else if (!privateKeyLooksParseable(pemContents)) {
    errors.push("PEM private key is not parseable. Confirm this is the GitHub App private key.");
  }

  return errors;
}

export async function promptForPemPath(
  prompter: InteractivePrompter,
  cwd: string,
  writeOutput: (message: string) => void
): Promise<string> {
  const candidates = await findPemCandidates(cwd);
  if (candidates.length > 0) {
    writeOutput("Discovered PEM files:");
    candidates.forEach((candidate, index) => {
      writeOutput(`${index + 1}. ${candidate}`);
    });
    const selected = await prompter.question("Select PEM number, or enter a PEM path: ");
    const candidateIndex = Number.parseInt(selected, 10);
    if (Number.isInteger(candidateIndex) && candidateIndex >= 1 && candidateIndex <= candidates.length) {
      return candidates[candidateIndex - 1] ?? selected;
    }
    return selected;
  }

  writeOutput("No PEM files found in ~/Downloads, ~/Desktop, or the current directory.");
  return prompter.question("Path to GitHub App private key PEM: ");
}

export function maskSecret(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 6) {
    return "******";
  }
  return `${trimmed.slice(0, 3)}...${trimmed.slice(-3)}`;
}

function timestampForFileName(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export async function runInteractiveGitHubAppSetupCli(options: InteractiveSetupCliOptions): Promise<number> {
  try {
    const result = await runInteractiveGitHubAppSetup(options);
    options.writeOutput?.(JSON.stringify(result, null, 2));
    return result.status === "ok" ? 0 : 1;
  } catch (error) {
    options.writeError?.(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function main(): Promise<void> {
  const rl = readline.createInterface({ input, output });
  try {
    const exitCode = await runInteractiveGitHubAppSetupCli({
      prompter: rl,
      writeOutput: (message) => console.log(message),
      writeError: (message) => console.error(message)
    });
    process.exitCode = exitCode;
  } finally {
    rl.close();
  }
}

if (process.env.NODE_ENV !== "test") {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
