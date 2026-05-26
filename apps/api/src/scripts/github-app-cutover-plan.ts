import { fileURLToPath } from "node:url";
import { z } from "zod";

export type GitHubAppCutoverPlan = {
  status: "ok" | "error";
  publicWebhookUrl: string | null;
  githubAppWebhookUrl: string | null;
  checklist: string[];
  problems: Array<{ field: string; message: string }>;
};

const argsSchema = z.object({
  url: z.string().url(),
  allowNgrok: z.boolean().default(false)
});

export function parseCutoverPlanArgs(argv: string[]): { url: string; allowNgrok: boolean } {
  const values: Record<string, string | boolean> = {};
  for (const arg of argv) {
    if (arg.startsWith("url=")) values.url = arg.slice("url=".length);
    if (arg.startsWith("--url=")) values.url = arg.slice("--url=".length);
    if (arg === "--allow-ngrok" || arg === "allowNgrok=true" || arg === "--allow-ngrok=true") values.allowNgrok = true;
  }
  return argsSchema.parse(values);
}

export function buildGitHubAppCutoverPlan(input: { url: string; allowNgrok?: boolean }): GitHubAppCutoverPlan {
  const problems: GitHubAppCutoverPlan["problems"] = [];
  const normalized = input.url.replace(/\/+$/, "");

  let parsed: URL | undefined;
  try {
    parsed = new URL(normalized);
  } catch {
    problems.push({ field: "url", message: "Deployment URL must be a valid URL." });
  }

  if (parsed) {
    if (parsed.protocol !== "https:") {
      problems.push({ field: "url", message: "Deployment URL must use https://." });
    }
    if (["localhost", "127.0.0.1", "::1"].includes(parsed.hostname.toLowerCase())) {
      problems.push({ field: "url", message: "Deployment URL must not point to localhost." });
    }
    if (looksPlaceholder(normalized)) {
      problems.push({ field: "url", message: "Deployment URL still looks like a placeholder." });
    }
    if (!input.allowNgrok && /ngrok/i.test(parsed.hostname)) {
      problems.push({ field: "url", message: "Ngrok URLs are not stable hosted demo URLs. Pass --allow-ngrok only for temporary testing." });
    }
  }

  return {
    status: problems.length ? "error" : "ok",
    publicWebhookUrl: problems.length ? null : normalized,
    githubAppWebhookUrl: problems.length ? null : `${normalized}/webhooks/github`,
    checklist: [
      "Update production env PUBLIC_WEBHOOK_URL.",
      "Redeploy API and worker.",
      "Run pnpm validate:prod-env.",
      "Run pnpm smoke:deployment -- baseUrl=<stable-url>.",
      "Update the GitHub App webhook URL.",
      "Redeliver a pull_request webhook or open a test PR.",
      "Run pnpm hosted:pr-proof -- owner=OWNER repo=REPO pr=NUMBER baseUrl=<stable-url>."
    ],
    problems
  };
}

function looksPlaceholder(value: string): boolean {
  return /YOUR-|YOUR_|example\.com|stable-domain|placeholder/i.test(value);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = buildGitHubAppCutoverPlan(parseCutoverPlanArgs(process.argv.slice(2)));
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "ok") process.exitCode = 1;
}
