import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import {
  findPemCandidates,
  mergeEnv,
  runSetupGitHubAppEnv
} from "../src/scripts/setup-github-app-env.js";

const fixturePemPath = path.resolve("test/fixtures/test-private-key.pem");

describe("setup-github-app-env", () => {
  it("rejects missing pem arg", async () => {
    const result = await runSetupGitHubAppEnv([], process.cwd());

    expect(result.status).toBe("error");
    expect(result.errors.join("\n")).toContain("pem");
  });

  it("find-pem returns candidate list without printing contents", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "archguard-pem-"));
    const candidate = path.join(tmpDir, "github-app.pem");
    await writeFile(candidate, "SECRET PEM CONTENT", "utf8");

    const startedAt = performance.now();
    const candidates = await findPemCandidates({ searchDirs: [tmpDir], maxDepth: 1, limit: 10 });

    expect(candidates).toContain(candidate);
    expect(performance.now() - startedAt).toBeLessThan(1000);
    expect(JSON.stringify(candidates)).not.toContain("SECRET PEM CONTENT");
  });

  it("find-pem ignores heavy internal directories and respects limit", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "archguard-pem-bounds-"));
    await writeFile(path.join(tmpDir, "one.pem"), "one", "utf8");
    await writeFile(path.join(tmpDir, "two.pem"), "two", "utf8");
    const ignoredDir = path.join(tmpDir, "node_modules");
    await writeFile(path.join(tmpDir, "three.txt"), "nope", "utf8");
    await mkdir(ignoredDir);
    await writeFile(path.join(ignoredDir, "ignored.pem"), "ignored", "utf8");

    const candidates = await findPemCandidates({ searchDirs: [tmpDir], maxDepth: 2, limit: 1 });

    expect(candidates).toHaveLength(1);
    expect(JSON.stringify(candidates)).not.toContain("ignored.pem");
    expect(JSON.stringify(candidates)).not.toContain(os.homedir());
  });

  it("--find-pem can use explicit search roots without scanning real home", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "archguard-find-pem-cli-"));
    const candidate = path.join(tmpDir, "github-app.pem");
    await writeFile(candidate, "RAW PEM BODY THAT MUST NOT PRINT", "utf8");

    const result = await runSetupGitHubAppEnv(["--find-pem"], process.cwd(), { searchDirs: [tmpDir] });

    expect(result.status).toBe("ok");
    expect(result.pemCandidates).toEqual([candidate]);
    expect(JSON.stringify(result)).not.toContain("RAW PEM BODY THAT MUST NOT PRINT");
    expect(JSON.stringify(result)).not.toContain(os.homedir());
  });

  it("rejects nonexistent pem path", async () => {
    const result = await runSetupGitHubAppEnv(validArgs({ pem: "/does/not/exist.pem" }), process.cwd());

    expect(result.status).toBe("error");
    expect(result.errors.join("\n")).toContain("does not exist");
  });

  it("rejects placeholder command values with actionable errors", async () => {
    const result = await runSetupGitHubAppEnv(
      validArgs({
        pem: "/absolute/path/to/private-key.pem",
        appId: "YOUR_REAL_GITHUB_APP_ID",
        webhookSecret: "YOUR_REAL_WEBHOOK_SECRET",
        clientId: "YOUR_REAL_CLIENT_ID",
        clientSecret: "YOUR_REAL_CLIENT_SECRET",
        webhookUrl: "https://YOUR_NGROK_URL.ngrok-free.app"
      }),
      process.cwd()
    );

    expect(result.status).toBe("error");
    expect(result.message).toBe("Replace placeholder values with real GitHub App settings.");
    expect(result.missingOrInvalid).toEqual([
      "pem",
      "appId",
      "webhookSecret",
      "clientId",
      "clientSecret",
      "webhookUrl"
    ]);
    expect(result.hint).toBe("Run pnpm setup:github-app:interactive for guided setup.");
    expect(result.messages.join("\n")).toContain("Replace the placeholder");
    expect(result.errors.join("\n")).toContain("appId must be the numeric GitHub App ID");
    expect(result.errors.join("\n")).toContain("pem must be the real absolute path");
    expect(JSON.stringify(result)).not.toContain("ZodError");
  });

  it("rejects malformed PEM", async () => {
    const tmpDir = await repoFixtureDir();
    const badPem = path.join(tmpDir, "bad.pem");
    await writeFile(badPem, "not a pem", "utf8");

    const result = await runSetupGitHubAppEnv(validArgs({ pem: badPem }), tmpDir);

    expect(result.status).toBe("error");
    expect(result.errors.join("\n")).toContain("BEGIN RSA PRIVATE KEY");
  });

  it("accepts valid test PEM fixture and writes .env.github.local without printing key", async () => {
    const tmpDir = await repoFixtureDir();
    const result = await runSetupGitHubAppEnv(validArgs({ pem: fixturePemPath }), tmpDir);

    expect(result.status).toBe("ok");
    expect(result.outputFile).toBe(path.join(tmpDir, ".env.github.local"));

    const output = await readFile(path.join(tmpDir, ".env.github.local"), "utf8");
    expect(output).toContain("GITHUB_APP_ID=654321");
    expect(output).toContain('GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\\n');
    expect(JSON.stringify(result)).not.toContain("BEGIN RSA PRIVATE KEY");
  });

  it("--write-env creates backup and preserves unrelated env vars", async () => {
    const tmpDir = await repoFixtureDir();
    await writeFile(
      path.join(tmpDir, ".env"),
      "DATABASE_URL=postgresql://local\nANALYZER_PROVIDER=rag\nGITHUB_APP_ID=old\n",
      "utf8"
    );

    const result = await runSetupGitHubAppEnv(validArgs({ pem: fixturePemPath, "--write-env": "true" }), tmpDir);

    expect(result.status).toBe("ok");
    expect(result.envBackupFile).toBeTruthy();

    const env = await readFile(path.join(tmpDir, ".env"), "utf8");
    expect(env).toContain("DATABASE_URL=postgresql://local");
    expect(env).toContain("ANALYZER_PROVIDER=rag");
    expect(env).toContain("GITHUB_APP_ID=654321");
    expect(env).not.toContain("GITHUB_APP_ID=old");
  });

  it("mergeEnv updates only GitHub-related values", () => {
    const merged = mergeEnv("DATABASE_URL=db\nGITHUB_APP_ID=old\n", { GITHUB_APP_ID: "new" });

    expect(merged).toContain("DATABASE_URL=db");
    expect(merged).toContain("GITHUB_APP_ID=new");
    expect(merged).not.toContain("GITHUB_APP_ID=old");
  });
});

function validArgs(overrides: Record<string, string> = {}): string[] {
  return Object.entries({
    pem: fixturePemPath,
    appId: "654321",
    webhookSecret: "webhook-secret",
    clientId: "client-id",
    clientSecret: "client-secret",
    webhookUrl: "https://abc.ngrok-free.app",
    owner: "mmanishsoni70",
    repo: "archguard-test",
    ...overrides
  }).map(([key, value]) => `${key}=${value}`);
}

async function repoFixtureDir(): Promise<string> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "archguard-repo-"));
  await writeFile(path.join(tmpDir, "pnpm-workspace.yaml"), "packages: []\n", "utf8");
  return tmpDir;
}
