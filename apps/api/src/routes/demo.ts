import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Env } from "../env.js";

const service = "archguard-api";
const demoNote = "This is a demo API. No secrets or raw prompts are exposed.";
const endpointLinks = {
  health: "/health",
  ready: "/ready",
  version: "/version",
  demo: "/demo",
  demoStatus: "/demo/status",
  demoProof: "/demo/proof"
} as const;
const publicDemoPaths = ["/", "/demo", "/demo/status", "/demo/proof", "/health", "/ready", "/version"];

type DemoRouteEnv = Pick<
  Env,
  | "APP_VERSION"
  | "GIT_SHA"
  | "NODE_ENV"
  | "ANALYZER_PROVIDER"
  | "LLM_PROVIDER"
  | "EMBEDDING_PROVIDER"
  | "DEMO_REPO_URL"
  | "DEMO_DRIFT_PR_URL"
  | "DEMO_FIT_PR_URL"
  | "DEMO_ALLOWED_ORIGIN"
>;

export type RegisterDemoRoutesOptions = {
  env: DemoRouteEnv;
};

export async function registerDemoRoutes(fastify: FastifyInstance, options: RegisterDemoRoutesOptions): Promise<void> {
  fastify.addHook("onRequest", async (request, reply) => {
    applyDemoCorsHeaders(request, reply, options.env.DEMO_ALLOWED_ORIGIN);
  });

  for (const path of publicDemoPaths) {
    fastify.options(path, async (_request, reply) => reply.code(204).send());
  }

  fastify.get("/", async (_request, reply) => {
    return reply.type("text/html; charset=utf-8").send(renderHomeHtml(options.env));
  });

  fastify.get("/demo", async (_request, reply) => {
    return reply.type("text/html; charset=utf-8").send(renderDemoHtml(options.env));
  });

  fastify.get("/demo/status", async () => ({
    service,
    status: "ok",
    mode: {
      analyzerProvider: options.env.ANALYZER_PROVIDER,
      llmProvider: options.env.LLM_PROVIDER,
      embeddingProvider: options.env.EMBEDDING_PROVIDER
    },
    endpoints: endpointLinks,
    repositoryUrl: options.env.DEMO_REPO_URL ?? null,
    note: demoNote
  }));

  fastify.get("/demo/proof", async () => ({
    service,
    repositoryUrl: options.env.DEMO_REPO_URL ?? null,
    examples: [
      {
        pr: 1,
        verdict: "DRIFT_RISK",
        url: options.env.DEMO_DRIFT_PR_URL ?? null,
        summary: "Architecture drift risk detected in the demo repository."
      },
      {
        pr: 2,
        verdict: "FIT",
        url: options.env.DEMO_FIT_PR_URL ?? null,
        summary: "Architecture fit confirmed for a normal maintenance change."
      },
      {
        pr: 3,
        verdict: "FIT",
        url: null,
        summary: "Architecture fit confirmed for a follow-up demo PR."
      },
      {
        pr: 4,
        verdict: "FIT",
        url: null,
        summary: "Architecture fit confirmed for a follow-up demo PR."
      },
      {
        pr: 5,
        verdict: "FIT",
        url: null,
        summary: "Architecture fit confirmed for a follow-up demo PR."
      }
    ],
    note: demoNote
  }));
}

function applyDemoCorsHeaders(request: FastifyRequest, reply: FastifyReply, allowedOrigin: string): void {
  if (!isPublicDemoPath(request.url)) return;

  reply.header("Access-Control-Allow-Origin", allowedOrigin);
  reply.header("Access-Control-Allow-Methods", "GET, OPTIONS");
  reply.header("Access-Control-Allow-Headers", "Content-Type");
  reply.header("Vary", "Origin");
}

function isPublicDemoPath(url: string): boolean {
  const path = url.split("?")[0] ?? "";

  return publicDemoPaths.includes(path);
}

function renderHomeHtml(env: DemoRouteEnv): string {
  return renderPage({
    title: "ArchGuard Demo API",
    eyebrow: service,
    heading: "ArchGuard",
    lead: "AI-powered architecture fitness checks for GitHub pull requests.",
    body: [
      detailList([
        ["Service", service],
        ["Environment", env.NODE_ENV],
        ["Version", env.APP_VERSION],
        ["Commit", env.GIT_SHA],
        ["Repository", env.DEMO_REPO_URL ?? "Not configured"]
      ]),
      linkList(endpointLinks),
      `<p class="note">${escapeHtml(demoNote)}</p>`
    ]
  });
}

function renderDemoHtml(env: DemoRouteEnv): string {
  return renderPage({
    title: "ArchGuard Live Demo",
    eyebrow: "Live demo",
    heading: "Architecture fitness for real PRs",
    lead: "ArchGuard receives GitHub PR webhooks, queues analysis work, retrieves repository architecture context, and posts a typed Check Run verdict.",
    body: [
      `<section><h2>Demo mode</h2>${detailList([
        ["Analyzer", env.ANALYZER_PROVIDER],
        ["LLM", env.LLM_PROVIDER],
        ["Embeddings", env.EMBEDDING_PROVIDER],
        ["Repository", env.DEMO_REPO_URL ?? "Not configured"]
      ])}</section>`,
      `<section><h2>Proof</h2><ul><li>PR #1: DRIFT_RISK</li><li>PR #2: FIT</li><li>PR #3: FIT</li><li>PR #4: FIT</li><li>PR #5: FIT</li></ul></section>`,
      linkList(endpointLinks),
      `<p class="note">${escapeHtml(demoNote)}</p>`
    ]
  });
}

function renderPage(input: { title: string; eyebrow: string; heading: string; lead: string; body: string[] }): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(input.title)}</title>
    <style>
      :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { margin: 0; min-height: 100vh; background: #f7f4ee; color: #151515; }
      main { width: min(920px, calc(100% - 40px)); margin: 0 auto; padding: 56px 0; }
      .eyebrow { color: #3d6b6b; font-size: 0.82rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
      h1 { margin: 10px 0 12px; font-size: clamp(2.25rem, 8vw, 5rem); line-height: 0.95; }
      h2 { margin-top: 28px; font-size: 1.1rem; }
      p { font-size: 1rem; line-height: 1.65; max-width: 680px; }
      a { color: #0f5c5c; font-weight: 700; }
      dl { display: grid; grid-template-columns: minmax(120px, 180px) 1fr; gap: 10px 18px; margin: 28px 0; }
      dt { color: #565656; font-weight: 700; }
      dd { margin: 0; overflow-wrap: anywhere; }
      ul { line-height: 1.8; padding-left: 1.25rem; }
      .links { display: flex; flex-wrap: wrap; gap: 10px; padding: 0; list-style: none; }
      .links a { display: inline-flex; border: 1px solid #c8d4cd; border-radius: 8px; padding: 8px 11px; text-decoration: none; background: #fffaf2; }
      .note { margin-top: 28px; color: #565656; }
      @media (prefers-color-scheme: dark) {
        body { background: #111615; color: #f4f0e8; }
        .eyebrow, a { color: #8cc9c1; }
        dt, .note { color: #c0bbb0; }
        .links a { background: #18211f; border-color: #31413d; }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="eyebrow">${escapeHtml(input.eyebrow)}</div>
      <h1>${escapeHtml(input.heading)}</h1>
      <p>${escapeHtml(input.lead)}</p>
      ${input.body.join("\n")}
    </main>
  </body>
</html>`;
}

function detailList(items: Array<[string, string]>): string {
  return `<dl>${items.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl>`;
}

function linkList(links: typeof endpointLinks): string {
  return `<section><h2>Endpoints</h2><ul class="links">${Object.values(links)
    .map((href) => `<li><a href="${escapeHtml(href)}">${escapeHtml(href)}</a></li>`)
    .join("")}</ul></section>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
