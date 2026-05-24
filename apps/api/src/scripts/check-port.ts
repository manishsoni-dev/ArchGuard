import { checkPort, parsePortArg, type PortCheckDependencies, type PortCheckResult } from "./port-utils.js";

export async function runCheckPort(args: string[], dependencies: PortCheckDependencies = {}): Promise<PortCheckResult> {
  const port = parsePortArg(args);
  return checkPort(port, dependencies);
}

async function main(): Promise<void> {
  const result = await runCheckPort(process.argv.slice(2));
  console.log(JSON.stringify(result, null, 2));
}

if (process.env.NODE_ENV !== "test") {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
