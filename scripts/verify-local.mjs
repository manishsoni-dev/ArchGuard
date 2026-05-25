#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

export function getVerifyLocalSteps() {
  return [
    { label: "test", command: pnpmCommand, args: ["test"] },
    { label: "typecheck", command: pnpmCommand, args: ["typecheck"] },
    { label: "build", command: pnpmCommand, args: ["build"] },
    { label: "phase3", command: pnpmCommand, args: ["verify:phase3"] },
    {
      label: "rag-eval",
      command: pnpmCommand,
      args: ["eval:rag"],
      env: {
        ANALYZER_PROVIDER: "rag",
        LLM_PROVIDER: "mock"
      }
    }
  ];
}

function runStep(step) {
  console.log(`\n==> ${step.label}`);
  const result = spawnSync(step.command, step.args, {
    stdio: "inherit",
    shell: false,
    env: {
      ...process.env,
      ...(step.env ?? {})
    }
  });

  if (result.error) {
    console.error(`${step.label} failed to start: ${result.error.message}`);
    return 1;
  }

  return result.status ?? 1;
}

export function runVerifyLocal() {
  for (const step of getVerifyLocalSteps()) {
    const exitCode = runStep(step);
    if (exitCode !== 0) {
      console.error(`\nverify:local failed at step: ${step.label}`);
      return exitCode;
    }
  }

  console.log("\nverify:local passed");
  return 0;
}

if (process.argv.includes("--print-plan")) {
  console.log(JSON.stringify({ steps: getVerifyLocalSteps() }, null, 2));
} else if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(runVerifyLocal());
}
