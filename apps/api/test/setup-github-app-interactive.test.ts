import { copyFile, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  maskSecret,
  promptForPemPath,
  runInteractiveGitHubAppSetup,
  runInteractiveGitHubAppSetupCli,
  validateInteractiveInput
} from "../src/scripts/setup-github-app-interactive.js";

const fixturePemPath = path.resolve("test/fixtures/test-private-key.pem");

describe("setup-github-app-interactive", () => {
  it("validates numeric app ID", async () => {
    const pem = await copyPemToTemp();
    const errors = await validateInteractiveInput(validInput({ pem, appId: "YOUR_REAL_GITHUB_APP_ID" }));

    expect(errors.join("\n")).toContain("GitHub App ID must be numeric");
  });

  it("rejects placeholder webhook secret", async () => {
    const pem = await copyPemToTemp();
    const errors = await validateInteractiveInput(validInput({ pem, webhookSecret: "..." }));

    expect(errors.join("\n")).toContain("Webhook Secret still looks like a placeholder");
  });

  it("rejects placeholder client secret", async () => {
    const pem = await copyPemToTemp();
    const errors = await validateInteractiveInput(validInput({ pem, clientSecret: "YOUR_REAL_CLIENT_SECRET" }));

    expect(errors.join("\n")).toContain("Client Secret still looks like a placeholder");
  });

  it("rejects fake ngrok URL", async () => {
    const pem = await copyPemToTemp();
    const errors = await validateInteractiveInput(
      validInput({ pem, webhookUrl: "https://your_real-ngrok-url.ngrok-free.app" })
    );

    expect(errors.join("\n")).toContain("Public ngrok URL still looks like a placeholder");
  });

  it("discovers PEM files and allows selecting one", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "archguard-interactive-pem-"));
    const pemPath = path.join(tmpDir, "github-app.pem");
    await copyFile(fixturePemPath, pemPath);
    const output: string[] = [];

    const selected = await promptForPemPath(answerPrompter(["1"]), tmpDir, (message) => output.push(message), {
      searchDirs: [tmpDir]
    });

    expect(selected).toBe(pemPath);
    expect(output.join("\n")).toContain("Discovered PEM files");
    expect(output.join("\n")).toContain(pemPath);
    expect(output.join("\n")).not.toContain(os.homedir());
  });

  it("converts PEM to escaped newline format and writes .env", async () => {
    const repoRoot = await repoFixtureDir();
    const pemPath = path.join(repoRoot, "github-app.pem");
    await copyFile(fixturePemPath, pemPath);

    const result = await runInteractiveGitHubAppSetup({
      cwd: repoRoot,
      searchDirs: [repoRoot],
      prompter: answerPrompter(validAnswers({ pemSelection: "1" })),
      writeOutput: () => undefined
    });

    expect(result.status).toBe("ok");
    const env = await readFile(path.join(repoRoot, ".env"), "utf8");
    expect(env).toContain('GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\\n');
    expect(env).not.toContain("-----BEGIN RSA PRIVATE KEY-----\n");
  });

  it("validates private key parseability", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "archguard-bad-pem-"));
    const pem = path.join(tmpDir, "bad.pem");
    await writeFile(pem, "-----BEGIN RSA PRIVATE KEY-----\nnot-real\n-----END RSA PRIVATE KEY-----", "utf8");

    const errors = await validateInteractiveInput(validInput({ pem }));

    expect(errors.join("\n")).toContain("PEM private key is not parseable");
  });

  it("writes .env backup before update and preserves unrelated env vars", async () => {
    const repoRoot = await repoFixtureDir();
    const pemPath = path.join(repoRoot, "github-app.pem");
    await copyFile(fixturePemPath, pemPath);
    await writeFile(path.join(repoRoot, ".env"), "DATABASE_URL=postgresql://local\nANALYZER_PROVIDER=rag\n", "utf8");

    const result = await runInteractiveGitHubAppSetup({
      cwd: repoRoot,
      searchDirs: [repoRoot],
      prompter: answerPrompter(validAnswers({ pemSelection: "1" })),
      writeOutput: () => undefined
    });

    expect(result.status).toBe("ok");
    expect(result.envBackupFile).toBeTruthy();
    const backup = await readFile(result.envBackupFile ?? "", "utf8");
    expect(backup).toContain("DATABASE_URL=postgresql://local");

    const env = await readFile(path.join(repoRoot, ".env"), "utf8");
    expect(env).toContain("DATABASE_URL=postgresql://local");
    expect(env).toContain("ANALYZER_PROVIDER=rag");
    expect(env).toContain("GITHUB_APP_ID=654321");
  });

  it("returns only masked secret previews", async () => {
    const repoRoot = await repoFixtureDir();
    const pemPath = path.join(repoRoot, "github-app.pem");
    await copyFile(fixturePemPath, pemPath);

    const result = await runInteractiveGitHubAppSetup({
      cwd: repoRoot,
      searchDirs: [repoRoot],
      prompter: answerPrompter(validAnswers({ pemSelection: "1" })),
      writeOutput: () => undefined
    });

    expect(result.safeSummary?.clientSecret).toBe("cli...ret");
    expect(result.safeSummary?.webhookSecret).toBe("web...ret");
    expect(JSON.stringify(result)).not.toContain("client-secret");
    expect(JSON.stringify(result)).not.toContain("webhook-secret");
    expect(maskSecret("abcdefghi")).toBe("abc...ghi");
  });

  it("does not print required-field validation errors before prompting", async () => {
    const repoRoot = await repoFixtureDir();
    const output: string[] = [];
    const result = await runInteractiveGitHubAppSetup({
      cwd: repoRoot,
      searchDirs: [repoRoot],
      prompter: answerPrompter(["", "", "", "", "", "", "", ""]),
      writeOutput: (message) => output.push(message)
    });

    expect(result.status).toBe("error");
    expect(output.join("\n")).not.toContain("Required");
    expect(output.join("\n")).toContain("ArchGuard GitHub App setup");
  });

  it("exits 0 after successful .env write", async () => {
    const repoRoot = await repoFixtureDir();
    const pemPath = path.join(repoRoot, "github-app.pem");
    await copyFile(fixturePemPath, pemPath);
    const output: string[] = [];

    const exitCode = await runInteractiveGitHubAppSetupCli({
      cwd: repoRoot,
      searchDirs: [repoRoot],
      prompter: answerPrompter(validAnswers({ pemSelection: "1" })),
      writeOutput: (message) => output.push(message),
      writeError: (message) => output.push(message)
    });

    expect(exitCode).toBe(0);
    expect(output.join("\n")).not.toContain("client-secret");
    expect(output.join("\n")).not.toContain("BEGIN RSA PRIVATE KEY");
  });

  it("exits 1 on invalid PEM", async () => {
    const repoRoot = await repoFixtureDir();
    const pemPath = path.join(repoRoot, "bad.pem");
    await writeFile(pemPath, "not a key", "utf8");

    const exitCode = await runInteractiveGitHubAppSetupCli({
      cwd: repoRoot,
      searchDirs: [repoRoot],
      prompter: answerPrompter(validAnswers({ pemSelection: pemPath })),
      writeOutput: () => undefined,
      writeError: () => undefined
    });

    expect(exitCode).toBe(1);
  });

  it("closes injected prompt resources after CLI execution", async () => {
    const repoRoot = await repoFixtureDir();
    const pemPath = path.join(repoRoot, "github-app.pem");
    await copyFile(fixturePemPath, pemPath);
    let closed = false;

    const exitCode = await runInteractiveGitHubAppSetupCli({
      cwd: repoRoot,
      searchDirs: [repoRoot],
      prompter: answerPrompter(validAnswers({ pemSelection: "1" }), () => {
        closed = true;
      }),
      writeOutput: () => undefined,
      writeError: () => undefined
    });

    expect(exitCode).toBe(0);
    expect(closed).toBe(true);
  });
});

function validInput(overrides: Record<string, string> = {}) {
  return {
    appId: "654321",
    clientId: "client-id",
    clientSecret: "client-secret",
    webhookSecret: "webhook-secret",
    webhookUrl: "https://abc.ngrok-free.app",
    owner: "mmanishsoni70",
    repo: "archguard-test",
    pem: fixturePemPath,
    ...overrides
  };
}

function validAnswers(overrides: { pemSelection?: string } = {}): string[] {
  return [
    overrides.pemSelection ?? fixturePemPath,
    "654321",
    "client-id",
    "client-secret",
    "webhook-secret",
    "https://abc.ngrok-free.app",
    "mmanishsoni70",
    "archguard-test"
  ];
}

function answerPrompter(answers: string[], close?: () => void) {
  let index = 0;
  return {
    question: async () => answers[index++] ?? "",
    close
  };
}

async function repoFixtureDir(): Promise<string> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "archguard-interactive-repo-"));
  await writeFile(path.join(tmpDir, "pnpm-workspace.yaml"), "packages: []\n", "utf8");
  return tmpDir;
}

async function copyPemToTemp(): Promise<string> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "archguard-pem-"));
  const pem = path.join(tmpDir, "github-app.pem");
  await copyFile(fixturePemPath, pem);
  return pem;
}
