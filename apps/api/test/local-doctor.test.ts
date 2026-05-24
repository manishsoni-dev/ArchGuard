import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { toEscapedEnvPrivateKey } from "../src/github/github-app-env-validation.js";
import { runLocalDoctor } from "../src/scripts/local-doctor.js";

const fixturePemPath = path.resolve("test/fixtures/test-private-key.pem");

describe("local doctor", () => {
  it("reports missing .env", async () => {
    const repoRoot = await repoFixtureDir();
    await mkdir(path.join(repoRoot, "node_modules/.prisma/client"), { recursive: true });
    await writeFile(path.join(repoRoot, "node_modules/.prisma/client/index.js"), "", "utf8");

    const result = await runLocalDoctor({
      cwd: repoRoot,
      probePort: async () => true,
      execFile: async () => ({ stdout: "" })
    });

    expect(result.status).toBe("error");
    expect(result.checks.envFile).toBe("error");
  });

  it("reports GitHub App validation error", async () => {
    const repoRoot = await repoFixtureDir();
    await writeFile(path.join(repoRoot, ".env"), "PORT=3000\nGITHUB_APP_ID=123456\n", "utf8");
    await mkdir(path.join(repoRoot, "node_modules/.prisma/client"), { recursive: true });
    await writeFile(path.join(repoRoot, "node_modules/.prisma/client/index.js"), "", "utf8");

    const result = await runLocalDoctor({
      cwd: repoRoot,
      probePort: async () => true,
      execFile: async () => ({ stdout: "" })
    });

    expect(result.status).toBe("error");
    expect(result.checks.githubApp).toBe("error");
  });

  it("reports port occupied", async () => {
    const repoRoot = await healthyRepoFixtureDir();

    const result = await runLocalDoctor({
      cwd: repoRoot,
      probePort: async () => false,
      execFile: async () => ({ stdout: "COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nnode 111 me 1u IPv4 x 0t0 TCP *:3000 (LISTEN)\n" })
    });

    expect(result.status).toBe("error");
    expect(result.checks.port).toBe("error");
    expect(result.nextSteps.join("\n")).toContain("pnpm check:port -- 3000");
  });

  it("reports ok when all mocked checks pass", async () => {
    const repoRoot = await healthyRepoFixtureDir();

    const result = await runLocalDoctor({
      cwd: repoRoot,
      probePort: async () => true,
      execFile: async () => ({ stdout: "" })
    });

    expect(result).toEqual({
      status: "ok",
      checks: {
        envFile: "ok",
        port: "ok",
        githubApp: "ok",
        nodeModules: "ok",
        prismaClient: "ok"
      },
      nextSteps: []
    });
  });
});

async function repoFixtureDir(): Promise<string> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "archguard-doctor-"));
  await writeFile(path.join(tmpDir, "pnpm-workspace.yaml"), "packages: []\n", "utf8");
  return tmpDir;
}

async function healthyRepoFixtureDir(): Promise<string> {
  const repoRoot = await repoFixtureDir();
  const pem = await readFile(fixturePemPath, "utf8");
  await copyFile(fixturePemPath, path.join(repoRoot, "key.pem"));
  await writeFile(
    path.join(repoRoot, ".env"),
    [
      "PORT=3000",
      "GITHUB_APP_ID=654321",
      `GITHUB_PRIVATE_KEY=\"${toEscapedEnvPrivateKey(pem)}\"`,
      "GITHUB_WEBHOOK_SECRET=webhook-secret",
      "GITHUB_CLIENT_ID=client-id",
      "GITHUB_CLIENT_SECRET=client-secret",
      "PUBLIC_WEBHOOK_URL=https://abc.ngrok-free.app",
      "TEST_GITHUB_OWNER=mmanishsoni70",
      "TEST_GITHUB_REPO=archguard-test"
    ].join("\n"),
    "utf8"
  );
  await mkdir(path.join(repoRoot, "node_modules/.prisma/client"), { recursive: true });
  await writeFile(path.join(repoRoot, "node_modules/.prisma/client/index.js"), "", "utf8");
  return repoRoot;
}
