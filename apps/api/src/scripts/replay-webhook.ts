import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadEnv } from "../env.js";

export type ReplayWebhookArgs = {
  filePath: string;
};

export function parseReplayWebhookArgs(args: string[]): ReplayWebhookArgs {
  const filePath = args.filter((arg) => arg !== "--")[0];

  if (!filePath) {
    throw new Error("Usage: pnpm replay:webhook -- ./sample-payloads/pull-request-opened.json");
  }

  return { filePath };
}

export async function replayWebhook(args = process.argv.slice(2)): Promise<void> {
  const { filePath } = parseReplayWebhookArgs(args);
  const env = loadEnv();
  const absolutePath = resolvePayloadPath(filePath);
  const payload = await readFile(absolutePath, "utf8");
  const apiBaseUrl = process.env.ARCHGUARD_API_URL ?? `http://localhost:${env.PORT}`;

  const response = await fetch(`${apiBaseUrl}/dev/github-webhook-debug`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-archguard-dev-token": env.DEV_WEBHOOK_TOKEN,
      "x-github-event": "pull_request",
      "x-github-delivery": `replay-${Date.now()}`
    },
    body: payload
  });

  const responseBody = await response.text();
  console.log(
    JSON.stringify(
      {
        status: response.status,
        body: parseJsonIfPossible(responseBody)
      },
      null,
      2
    )
  );
}

function resolvePayloadPath(filePath: string): string {
  const fromCwd = path.resolve(process.cwd(), filePath);

  if (existsSync(fromCwd)) {
    return fromCwd;
  }

  return path.resolve(process.cwd(), "../..", filePath);
}

function parseJsonIfPossible(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void replayWebhook().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
