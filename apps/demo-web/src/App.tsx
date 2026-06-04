import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  RefreshCw,
  Server,
  ShieldCheck
} from "lucide-react";

type CheckState = "idle" | "loading" | "ok" | "warning" | "error";

type EndpointResult = {
  label: string;
  path: string;
  state: CheckState;
  statusCode?: number;
  detail: string;
};

type ProofExample = {
  pr: number;
  verdict: "FIT" | "DRIFT_RISK" | "INSUFFICIENT_EVIDENCE";
  url: string | null;
  summary: string;
};

type DemoProof = {
  repositoryUrl: string | null;
  examples: ProofExample[];
};

const fallbackDriftExample: ProofExample = {
  pr: 1,
  verdict: "DRIFT_RISK",
  url: null,
  summary: "Architecture drift risk detected in the demo repository."
};

const fallbackFitExample: ProofExample = {
  pr: 2,
  verdict: "FIT",
  url: null,
  summary: "Architecture fit confirmed for a normal maintenance change."
};

const fallbackProof: DemoProof = {
  repositoryUrl: null,
  examples: [fallbackDriftExample, fallbackFitExample]
};

const endpointChecks = [
  { label: "Health", path: "/health" },
  { label: "Readiness", path: "/ready" },
  { label: "Version", path: "/version" },
  { label: "Proof", path: "/demo/proof" }
];

function App() {
  const apiUrl = normalizeApiUrl(import.meta.env.VITE_ARCHGUARD_API_URL);
  const [results, setResults] = useState<EndpointResult[]>(() =>
    endpointChecks.map((endpoint) => ({
      ...endpoint,
      state: apiUrl ? "idle" : "warning",
      detail: apiUrl ? "Waiting to check" : "API URL is not configured"
    }))
  );
  const [proof, setProof] = useState<DemoProof>(fallbackProof);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const repoUrl = useMemo(() => proof.repositoryUrl ?? "https://github.com/Manisshhhhhh/ArchGuard", [proof.repositoryUrl]);

  async function refresh() {
    if (!apiUrl) return;

    setIsRefreshing(true);
    setResults((current) => current.map((result) => ({ ...result, state: "loading", detail: "Checking live API" })));

    const nextResults = await Promise.all(endpointChecks.map((endpoint) => checkEndpoint(apiUrl, endpoint)));
    setResults(nextResults);

    const proofResult = await fetchJson<DemoProof>(apiUrl, "/demo/proof");
    if (proofResult.ok) {
      setProof(proofResult.data);
    }

    setIsRefreshing(false);
  }

  useEffect(() => {
    void refresh();
  }, [apiUrl]);

  const driftExample = proof.examples.find((example) => example.verdict === "DRIFT_RISK") ?? fallbackDriftExample;
  const fitExample = proof.examples.find((example) => example.verdict === "FIT") ?? fallbackFitExample;

  return (
    <main>
      <section className="hero">
        <div className="heroCopy">
          <div className="eyebrow">
            <ShieldCheck aria-hidden="true" size={18} />
            Live PR architecture fitness
          </div>
          <h1>ArchGuard</h1>
          <p>
            ArchGuard checks whether pull requests fit a repository&apos;s existing architecture before drift turns into
            expensive review debt.
          </p>
          <div className="heroActions">
            <a className="primaryLink" href={repoUrl} target="_blank" rel="noreferrer">
              <GitBranch aria-hidden="true" size={18} />
              GitHub repo
              <ExternalLink aria-hidden="true" size={16} />
            </a>
            {apiUrl ? (
              <a className="secondaryLink" href={`${apiUrl}/demo`} target="_blank" rel="noreferrer">
                <Server aria-hidden="true" size={18} />
                Demo API
                <ExternalLink aria-hidden="true" size={16} />
              </a>
            ) : null}
          </div>
        </div>
        <div className="heroPanel" aria-label="ArchGuard live demo summary">
          <div className="panelMetric">
            <span>Demo mode</span>
            <strong>RAG + mock LLM</strong>
          </div>
          <div className="panelMetric">
            <span>Webhook flow</span>
            <strong>API to worker to Check Run</strong>
          </div>
          <div className="panelMetric">
            <span>Proof set</span>
            <strong>1 drift risk, 4 fits</strong>
          </div>
        </div>
      </section>

      <section className="band split">
        <div>
          <h2>What ArchGuard does</h2>
          <p>
            It listens for GitHub pull request events, persists the webhook, queues analysis, retrieves architecture
            context from the repository, and posts an advisory Check Run verdict.
          </p>
        </div>
        <div className="flow" aria-label="Architecture flow">
          {["GitHub PR", "Fastify API", "BullMQ worker", "Repository context", "Check Run"].map((step, index) => (
            <div className="flowStep" key={step}>
              <span>{index + 1}</span>
              <strong>{step}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="band">
        <div className="sectionHeader">
          <div>
            <h2>Live API status</h2>
            <p>{apiUrl ? apiUrl : "Set VITE_ARCHGUARD_API_URL in Vercel to connect this page to the demo API."}</p>
          </div>
          <button className="iconButton" type="button" onClick={refresh} disabled={!apiUrl || isRefreshing} title="Refresh status">
            <RefreshCw aria-hidden="true" size={18} />
          </button>
        </div>
        <div className="statusGrid">
          {results.map((result) => (
            <StatusCard key={result.path} result={result} apiUrl={apiUrl} />
          ))}
        </div>
      </section>

      <section className="band">
        <div className="sectionHeader">
          <div>
            <h2>Proof PRs</h2>
            <p>Static safe proof from the live demo API, with links only when configured.</p>
          </div>
        </div>
        <div className="proofGrid">
          <ProofCard example={driftExample} tone="risk" />
          <ProofCard example={fitExample} tone="fit" />
        </div>
      </section>

      <section className="band limitations">
        <h2>Demo limits</h2>
        <ul>
          <li>No billing, account management, or dashboard is included.</li>
          <li>No OpenAI key is required in the default demo mode.</li>
          <li>The public API never exposes secrets, raw prompts, database URLs, Redis URLs, or retrieved context.</li>
        </ul>
      </section>
    </main>
  );
}

function StatusCard({ result, apiUrl }: { result: EndpointResult; apiUrl: string }) {
  const Icon = result.state === "ok" ? CheckCircle2 : result.state === "warning" ? AlertTriangle : Activity;

  return (
    <article className={`statusCard ${result.state}`}>
      <div className="cardTop">
        <Icon aria-hidden="true" size={20} />
        <span>{result.label}</span>
      </div>
      <strong>{result.path}</strong>
      <p>{result.detail}</p>
      {apiUrl ? (
        <a href={`${apiUrl}${result.path}`} target="_blank" rel="noreferrer">
          Open endpoint
          <ExternalLink aria-hidden="true" size={14} />
        </a>
      ) : null}
    </article>
  );
}

function ProofCard({ example, tone }: { example: DemoProof["examples"][number]; tone: "risk" | "fit" }) {
  return (
    <article className={`proofCard ${tone}`}>
      <div className="cardTop">
        <GitPullRequest aria-hidden="true" size={20} />
        <span>PR #{example.pr}</span>
      </div>
      <strong>{example.verdict}</strong>
      <p>{example.summary}</p>
      {example.url ? (
        <a href={example.url} target="_blank" rel="noreferrer">
          View PR
          <ExternalLink aria-hidden="true" size={14} />
        </a>
      ) : (
        <span className="muted">Link not configured</span>
      )}
    </article>
  );
}

async function checkEndpoint(
  apiUrl: string,
  endpoint: {
    label: string;
    path: string;
  }
): Promise<EndpointResult> {
  const result = await fetchJson<unknown>(apiUrl, endpoint.path);

  if (!result.ok) {
    if (endpoint.path === "/ready" && result.statusCode) {
      return {
        ...endpoint,
        state: "warning",
        statusCode: result.statusCode,
        detail: `Reachable but not ready (${result.statusCode})`
      };
    }

    return {
      ...endpoint,
      state: "error",
      statusCode: result.statusCode,
      detail: result.statusCode ? `Request returned ${result.statusCode}` : "Could not reach API"
    };
  }

  return {
    ...endpoint,
    state: "ok",
    statusCode: result.statusCode,
    detail: `HTTP ${result.statusCode}`
  };
}

async function fetchJson<T>(
  apiUrl: string,
  path: string
): Promise<{ ok: true; data: T; statusCode: number } | { ok: false; statusCode?: number }> {
  try {
    const response = await fetch(`${apiUrl}${path}`);
    const data = (await response.json().catch(() => null)) as T;

    if (!response.ok) {
      return { ok: false, statusCode: response.status };
    }

    return { ok: true, data, statusCode: response.status };
  } catch {
    return { ok: false };
  }
}

function normalizeApiUrl(value: string | undefined): string {
  if (!value?.trim()) return "";

  return value.trim().replace(/\/+$/, "");
}

export default App;
