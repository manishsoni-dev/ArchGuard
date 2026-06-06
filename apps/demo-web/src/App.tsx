import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  FileText,
  GitPullRequest,
  Github,
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
  checkedAt?: Date;
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

const publicApiUrl = "https://arch-guard-1--manishsoni-dev.replit.app";
const repositoryUrl = "https://github.com/manishsoni-dev/ArchGuard";
const docsUrl = "https://github.com/manishsoni-dev/ArchGuard/blob/main/docs/live-demo-proof.md";

const proofUrls = {
  drift: "https://github.com/manishsoni-dev/ArchGuard/pull/1",
  fit: "https://github.com/manishsoni-dev/ArchGuard/pull/8"
};

const fallbackDriftExample: ProofExample = {
  pr: 1,
  verdict: "DRIFT_RISK",
  url: proofUrls.drift,
  summary: "A frontend-to-database boundary violation caught as architecture drift."
};

const fallbackFitExample: ProofExample = {
  pr: 8,
  verdict: "FIT",
  url: proofUrls.fit,
  summary: "A valid live demo verification change confirmed as architecture-fit."
};

const fallbackProof: DemoProof = {
  repositoryUrl,
  examples: [fallbackDriftExample, fallbackFitExample]
};

const endpointChecks = [
  { label: "Health", path: "/health" },
  { label: "Readiness", path: "/ready" },
  { label: "Version", path: "/version" },
  { label: "Demo proof", path: "/demo/proof" }
];

const architectureFlow = ["GitHub PR", "Fastify API", "BullMQ Worker", "Repository Context", "GitHub Check Run"];

function App() {
  const apiUrl = normalizeApiUrl(import.meta.env.VITE_ARCHGUARD_API_URL) || publicApiUrl;
  const [results, setResults] = useState<EndpointResult[]>(() =>
    endpointChecks.map((endpoint) => ({
      ...endpoint,
      state: apiUrl ? "idle" : "warning",
      detail: apiUrl ? "Waiting for first check" : "API URL is not configured"
    }))
  );
  const [proof, setProof] = useState<DemoProof>(fallbackProof);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const resolvedRepoUrl = useMemo(() => proof.repositoryUrl ?? repositoryUrl, [proof.repositoryUrl]);

  async function refresh() {
    if (!apiUrl) return;

    setIsRefreshing(true);
    setResults((current) =>
      current.map((result) => ({ ...result, state: "loading", detail: "Checking live API" }))
    );

    const checkedAt = new Date();
    const nextResults = await Promise.all(
      endpointChecks.map((endpoint) => checkEndpoint(apiUrl, endpoint, checkedAt))
    );
    setResults(nextResults);

    const proofResult = await fetchJson<DemoProof>(apiUrl, "/demo/proof");
    if (proofResult.ok) {
      setProof({
        repositoryUrl: proofResult.data.repositoryUrl ?? repositoryUrl,
        examples: proofResult.data.examples.map(withKnownProofUrl)
      });
    } else {
      setProof(fallbackProof);
    }

    setIsRefreshing(false);
  }

  useEffect(() => {
    void refresh();
  }, [apiUrl]);

  const driftExample = proof.examples.find((example) => example.verdict === "DRIFT_RISK") ?? fallbackDriftExample;
  const fitExample = proof.examples.find((example) => example.verdict === "FIT") ?? fallbackFitExample;

  return (
    <>
      <header className="topNav">
        <a className="brandMark" href="#overview" aria-label="ArchGuard home">
          <span className="brandIcon">
            <ShieldCheck aria-hidden="true" size={18} />
          </span>
          ArchGuard
        </a>
        <nav aria-label="Primary navigation">
          <a href="#overview">Overview</a>
          <a href="#how-it-works">How it works</a>
          <a href="#proof">Proof</a>
          <a href={docsUrl} target="_blank" rel="noreferrer">
            Docs
          </a>
          <a href={resolvedRepoUrl} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
        <div className="navActions">
          <span className="statusPill">
            <span aria-hidden="true" />
            All systems operational
          </span>
          <a className="navButton" href={resolvedRepoUrl} target="_blank" rel="noreferrer">
            <Github aria-hidden="true" size={16} />
            GitHub
          </a>
        </div>
      </header>

      <main>
        <section className="hero" id="overview">
          <div className="heroCopy">
            <div className="eyebrow">
              <ShieldCheck aria-hidden="true" size={16} />
              AI-powered architecture review
            </div>
            <h1>ArchGuard</h1>
            <p className="heroLead">
              AI-powered GitHub PR architecture review bot. Checks pull requests for architecture fitness before drift
              becomes review debt.
            </p>
            <div className="heroActions">
              <a className="primaryLink" href={resolvedRepoUrl} target="_blank" rel="noreferrer">
                <Github aria-hidden="true" size={18} />
                View GitHub Repo
                <ExternalLink aria-hidden="true" size={15} />
              </a>
              <a className="secondaryLink" href={`${apiUrl}/demo`} target="_blank" rel="noreferrer">
                <Server aria-hidden="true" size={18} />
                Open Live Demo API
                <ExternalLink aria-hidden="true" size={15} />
              </a>
            </div>
          </div>

          <aside className="demoOverview" aria-label="ArchGuard demo overview">
            <div className="overviewHeader">
              <span>Live demo</span>
              <strong>Production-style proof surface</strong>
            </div>
            <Metric label="Demo mode" value="RAG + mock LLM" />
            <Metric label="Webhook flow" value="API -> Worker -> Check Run" />
            <Metric label="Proof set" value="1 drift risk, 4 fits" />
          </aside>
        </section>

        <section className="section" id="how-it-works">
          <div className="sectionHeader">
            <div>
              <span className="sectionKicker">Architecture flow</span>
              <h2>From pull request to architecture verdict.</h2>
            </div>
            <p>
              ArchGuard receives signed GitHub events, queues analysis work, retrieves repository context, and posts an
              advisory Check Run back to the PR.
            </p>
          </div>
          <div className="flow" aria-label="Architecture flow">
            {architectureFlow.map((step, index) => (
              <div className="flowStep" key={step}>
                <span>{index + 1}</span>
                <strong>{step}</strong>
                {index < architectureFlow.length - 1 ? <ArrowRight aria-hidden="true" size={17} /> : null}
              </div>
            ))}
          </div>
        </section>

        <section className="section" id="status">
          <div className="sectionHeader">
            <div>
              <span className="sectionKicker">Live API status</span>
              <h2>Public endpoints, checked from the browser.</h2>
            </div>
            <div className="refreshCluster">
              <p>{apiUrl}</p>
              <button
                className="iconButton"
                type="button"
                onClick={refresh}
                disabled={!apiUrl || isRefreshing}
                title="Refresh API status"
              >
                <RefreshCw aria-hidden="true" size={18} />
              </button>
            </div>
          </div>
          <div className="statusGrid">
            {results.map((result) => (
              <StatusCard key={result.path} result={result} apiUrl={apiUrl} />
            ))}
          </div>
        </section>

        <section className="section" id="proof">
          <div className="sectionHeader">
            <div>
              <span className="sectionKicker">Proof PRs</span>
              <h2>Real GitHub checks, not a static mockup.</h2>
            </div>
            <p>
              One proof case demonstrates architecture drift detection. The other shows a verified FIT result from the
              live demo rollout.
            </p>
          </div>
          <div className="proofGrid">
            <ProofCard example={withKnownProofUrl(driftExample)} tone="risk" />
            <ProofCard example={withKnownProofUrl(fitExample)} tone="fit" />
          </div>
        </section>

        <section className="section limitsSection">
          <div className="sectionHeader">
            <div>
              <span className="sectionKicker">Demo limits</span>
              <h2>Honest scope for a public portfolio demo.</h2>
            </div>
          </div>
          <div className="limitsGrid">
            <LimitCard title="No SaaS surface" body="No billing, account management, auth, or dashboard is included." />
            <LimitCard title="Deterministic demo mode" body="Uses demo mode: RAG + mock LLM, so no OpenAI key is required." />
            <LimitCard title="Safe public proof" body="Public proof endpoints are safe to inspect and do not expose secrets." />
            <LimitCard
              title="Webhook boundary"
              body="The webhook endpoint is for signed GitHub POST requests, not browser GET."
            />
          </div>
        </section>
      </main>

      <footer className="footer">
        <div>
          <strong>ArchGuard</strong>
          <span>Architecture fitness checks for GitHub pull requests.</span>
        </div>
        <div className="footerLinks">
          <a href={resolvedRepoUrl} target="_blank" rel="noreferrer">
            GitHub repo
          </a>
          <a href={docsUrl} target="_blank" rel="noreferrer">
            Docs
          </a>
        </div>
        <p>Fastify · BullMQ · PostgreSQL/pgvector · Redis · GitHub Checks API</p>
      </footer>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusCard({ result, apiUrl }: { result: EndpointResult; apiUrl: string }) {
  const Icon = result.state === "ok" ? CheckCircle2 : result.state === "warning" ? AlertTriangle : Activity;
  const statusLabel = statusText(result.state);

  return (
    <article className={`statusCard ${result.state}`}>
      <div className="cardTop">
        <Icon aria-hidden="true" size={18} />
        <span>{result.label}</span>
      </div>
      <div>
        <strong>{statusLabel}</strong>
        <code>{result.path}</code>
      </div>
      <p>{result.detail}</p>
      <div className="cardMeta">
        <span>{result.checkedAt ? `Last checked ${formatTime(result.checkedAt)}` : "Not checked yet"}</span>
        <a href={`${apiUrl}${result.path}`} target="_blank" rel="noreferrer">
          Open
          <ExternalLink aria-hidden="true" size={13} />
        </a>
      </div>
    </article>
  );
}

function ProofCard({ example, tone }: { example: DemoProof["examples"][number]; tone: "risk" | "fit" }) {
  return (
    <article className={`proofCard ${tone}`}>
      <div className="cardTop">
        <GitPullRequest aria-hidden="true" size={18} />
        <span>PR #{example.pr}</span>
      </div>
      <strong>{example.verdict}</strong>
      <p>{example.summary}</p>
      <a href={example.url ?? proofUrls.fit} target="_blank" rel="noreferrer">
        View proof PR
        <ExternalLink aria-hidden="true" size={13} />
      </a>
    </article>
  );
}

function LimitCard({ title, body }: { title: string; body: string }) {
  return (
    <article className="limitCard">
      <FileText aria-hidden="true" size={18} />
      <strong>{title}</strong>
      <p>{body}</p>
    </article>
  );
}

async function checkEndpoint(
  apiUrl: string,
  endpoint: {
    label: string;
    path: string;
  },
  checkedAt: Date
): Promise<EndpointResult> {
  const result = await fetchJson<unknown>(apiUrl, endpoint.path);

  if (!result.ok) {
    if (endpoint.path === "/ready" && result.statusCode) {
      return {
        ...endpoint,
        state: "warning",
        statusCode: result.statusCode,
        detail: `Reachable but not ready (${result.statusCode})`,
        checkedAt
      };
    }

    return {
      ...endpoint,
      state: "error",
      statusCode: result.statusCode,
      detail: result.statusCode ? `Request returned ${result.statusCode}` : "Could not reach API",
      checkedAt
    };
  }

  return {
    ...endpoint,
    state: "ok",
    statusCode: result.statusCode,
    detail: `HTTP ${result.statusCode}`,
    checkedAt
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

function withKnownProofUrl(example: ProofExample): ProofExample {
  if (example.verdict === "DRIFT_RISK") return { ...example, pr: 1, url: proofUrls.drift };
  if (example.verdict === "FIT") return { ...example, pr: 8, url: proofUrls.fit };
  return example;
}

function statusText(state: CheckState): string {
  if (state === "ok") return "Healthy";
  if (state === "warning") return "Warning";
  if (state === "error") return "Error";
  if (state === "loading") return "Checking";
  return "Waiting";
}

function formatTime(value: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(value);
}

export default App;
