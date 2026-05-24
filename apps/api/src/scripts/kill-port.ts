import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { z } from "zod";
import { checkPort, parsePortArg, type PortCheckDependencies, type PortProcess } from "./port-utils.js";

export type KillPortResult = {
  port: number;
  killed: PortProcess[];
  skipped: PortProcess[];
  cancelled: boolean;
  messages: string[];
};

export type KillPortDependencies = PortCheckDependencies & {
  confirm?: (message: string) => Promise<boolean>;
  killProcess?: (pid: number) => void;
};

const yesFlagSchema = z.object({
  yes: z.boolean().default(false)
});

export async function runKillPort(args: string[], dependencies: KillPortDependencies = {}): Promise<KillPortResult> {
  const port = parsePortArg(args);
  const { yes } = yesFlagSchema.parse({ yes: args.includes("--yes") });
  const portCheck = await checkPort(port, dependencies);

  if (portCheck.processes.length === 0) {
    return {
      port,
      killed: [],
      skipped: [],
      cancelled: false,
      messages: [`No listening processes found on port ${port}.`]
    };
  }

  const confirm = dependencies.confirm ?? defaultConfirm;
  if (!yes) {
    const approved = await confirm(`Kill ${portCheck.processes.length} process(es) listening on port ${port}? [y/N] `);
    if (!approved) {
      return {
        port,
        killed: [],
        skipped: portCheck.processes,
        cancelled: true,
        messages: ["Cancelled. No processes were killed."]
      };
    }
  }

  const killProcess = dependencies.killProcess ?? ((pid: number) => process.kill(pid, "SIGTERM"));
  const killed: PortProcess[] = [];
  const skipped: PortProcess[] = [];

  for (const processInfo of portCheck.processes) {
    if (processInfo.pid === process.pid) {
      skipped.push(processInfo);
      continue;
    }

    killProcess(processInfo.pid);
    killed.push(processInfo);
  }

  return {
    port,
    killed,
    skipped,
    cancelled: false,
    messages: killed.length
      ? [`Killed ${killed.length} process(es) listening on port ${port}.`]
      : [`No eligible processes were killed on port ${port}.`]
  };
}

async function defaultConfirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(message);
    return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const result = await runKillPort(process.argv.slice(2));
  console.log(JSON.stringify(result, null, 2));
}

if (process.env.NODE_ENV !== "test") {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
