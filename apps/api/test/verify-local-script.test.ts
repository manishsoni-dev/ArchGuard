import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

describe("verify-local script", () => {
  it("prints the expected verification plan", () => {
    const scriptPath = path.resolve(process.cwd(), "../../scripts/verify-local.mjs");
    const result = spawnSync(process.execPath, [scriptPath, "--print-plan"], {
      encoding: "utf8",
      shell: false
    });

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      steps: Array<{ label: string; args: string[]; env?: Record<string, string> }>;
    };

    expect(parsed.steps.map((step) => step.label)).toEqual(["test", "typecheck", "build", "phase3", "rag-eval"]);
    expect(parsed.steps.map((step) => step.args.join(" "))).toEqual([
      "test",
      "typecheck",
      "build",
      "verify:phase3",
      "eval:rag"
    ]);
    expect(parsed.steps.at(-1)?.env).toMatchObject({
      ANALYZER_PROVIDER: "rag",
      LLM_PROVIDER: "mock"
    });
  });
});
