import { spawn } from "node:child_process";

const requiredEnv = [
  "DATABASE_URL",
  "REDIS_URL",
  "GITHUB_APP_ID",
  "GITHUB_PRIVATE_KEY",
  "GITHUB_WEBHOOK_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET"
];

const demoDefaults = {
  ANALYZER_PROVIDER: "rag",
  LLM_PROVIDER: "mock",
  EMBEDDING_PROVIDER: "fake"
};

export function applyDemoDefaults(source = process.env) {
  return {
    ...source,
    ANALYZER_PROVIDER: source.ANALYZER_PROVIDER || demoDefaults.ANALYZER_PROVIDER,
    LLM_PROVIDER: source.LLM_PROVIDER || demoDefaults.LLM_PROVIDER,
    EMBEDDING_PROVIDER: source.EMBEDDING_PROVIDER || demoDefaults.EMBEDDING_PROVIDER
  };
}

export function validateRequiredEnv(source) {
  return requiredEnv.filter((name) => !source[name]?.trim());
}

export function demoModeWarnings(source) {
  return Object.entries(demoDefaults)
    .filter(([name, expected]) => source[name] !== expected)
    .map(([name, expected]) => `${name} is ${source[name] ?? "<unset>"}; expected ${expected} for the default demo.`);
}

export function publicWebhookUrl(source) {
  return source.REPLIT_DEV_DOMAIN ? `https://${source.REPLIT_DEV_DOMAIN}/webhooks/github` : "<public-url>/webhooks/github";
}

function main() {
  const env = applyDemoDefaults(process.env);
  const missing = validateRequiredEnv(env);

  // Keep hosted demo startup failures focused on missing runtime secrets.
  if (missing.length > 0) {
    console.error(`Missing required Replit secrets: ${missing.join(", ")}`);
    process.exit(1);
  }

  for (const warning of demoModeWarnings(env)) {
    console.warn(`[demo warning] ${warning}`);
  }

  console.log("ArchGuard demo API expected at Replit public URL");
  console.log(`Set GitHub App webhook to ${publicWebhookUrl(env)}`);

  const children = [
    spawnProcess("api", "pnpm", ["--filter", "@archguard/api", "dev"], env),
    spawnProcess("worker", "pnpm", ["--filter", "@archguard/api", "worker"], env)
  ];

  let shuttingDown = false;

  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}; stopping ArchGuard demo processes.`);

    for (const child of children) {
      if (!child.killed) {
        child.kill(signal);
      }
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  for (const child of children) {
    child.on("exit", (code, signal) => {
      if (!shuttingDown) {
        shuttingDown = true;
        console.error(`${child.prefix} exited with ${signal ?? `code ${code ?? 0}`}; stopping remaining process.`);

        for (const other of children) {
          if (other !== child && !other.killed) {
            other.kill("SIGTERM");
          }
        }

        process.exitCode = code ?? 1;
      }
    });
  }
}

function spawnProcess(prefix, command, args, env) {
  const child = spawn(command, args, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false
  });

  child.prefix = `[${prefix}]`;
  prefixStream(child.stdout, child.prefix);
  prefixStream(child.stderr, child.prefix);
  return child;
}

function prefixStream(stream, prefix) {
  let buffer = "";

  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      console.log(`${prefix} ${line}`);
    }
  });
  stream.on("end", () => {
    if (buffer.length > 0) {
      console.log(`${prefix} ${buffer}`);
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
