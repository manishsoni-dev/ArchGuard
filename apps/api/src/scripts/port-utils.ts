import { execFile as execFileCallback } from "node:child_process";
import net from "node:net";
import { promisify } from "node:util";
import { z } from "zod";

const execFile = promisify(execFileCallback);

export type PortProcess = {
  command: string;
  pid: number;
  user?: string;
  name?: string;
};

export type PortCheckResult = {
  port: number;
  available: boolean;
  processes: PortProcess[];
};

export type ExecFileLike = (
  file: string,
  args: string[]
) => Promise<{
  stdout: string;
  stderr?: string;
}>;

export type PortProbe = (port: number) => Promise<boolean>;

export type PortCheckDependencies = {
  execFile?: ExecFileLike;
  probePort?: PortProbe;
};

const portSchema = z.coerce.number().int().min(1).max(65_535).default(3000);

export function parsePortArg(args: string[]): number {
  const positional = args.find((arg) => !arg.startsWith("--"));
  return portSchema.parse(positional ?? 3000);
}

export async function checkPort(port: number, dependencies: PortCheckDependencies = {}): Promise<PortCheckResult> {
  const processes = await getListeningProcesses(port, dependencies.execFile);
  const probePort = dependencies.probePort ?? canListenOnPort;
  const canListen = await probePort(port);

  return {
    port,
    available: canListen && processes.length === 0,
    processes
  };
}

export async function getListeningProcesses(port: number, execFileLike: ExecFileLike = defaultExecFile): Promise<PortProcess[]> {
  try {
    const { stdout } = await execFileLike("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]);
    return parseLsofOutput(stdout);
  } catch {
    return [];
  }
}

export function parseLsofOutput(stdout: string): PortProcess[] {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const processes: PortProcess[] = [];

  for (const line of lines.slice(1)) {
    const parts = line.split(/\s+/);
    const pid = Number.parseInt(parts[1] ?? "", 10);
    if (!Number.isInteger(pid)) {
      continue;
    }

    processes.push({
      command: parts[0] ?? "unknown",
      pid,
      user: parts[2],
      name: parts.slice(8).join(" ") || undefined
    });
  }

  return processes;
}

export async function canListenOnPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "0.0.0.0");
  });
}

async function defaultExecFile(file: string, args: string[]): Promise<{ stdout: string; stderr?: string }> {
  return execFile(file, args);
}
