# ArchGuard

ArchGuard is an AI-powered GitHub PR review bot focused on architecture fitness. It is not a generic code reviewer: it evaluates whether a pull request fits a repository's existing architecture, conventions, module boundaries, and documented architecture decisions.

## Current MVP

This vertical slice includes:

- `POST /webhooks/github` for GitHub webhook intake.
- Raw-body HMAC verification for `x-hub-signature-256`.
- Header validation for `x-github-event`, `x-github-delivery`, and `x-hub-signature-256`.
- Durable webhook event persistence with `x-github-delivery` idempotency.
- BullMQ queue named `archguard-analysis`.
- Separate API and worker processes.
- Pull request routing for `opened`, `synchronize`, and `reopened`.
- AnalysisRun lifecycle: `QUEUED`, `IN_PROGRESS`, `COMPLETED`, `FAILED`.
- GitHub App installation authentication using Octokit.
- Check Run creation and completion for **ArchGuard Architecture Fitness**.
- Repository indexing that clones or pulls a repository, scans source files, chunks content, and stores chunks in Postgres.
- Deterministic fake embeddings for local development.
- Placeholder retriever and mock architecture analyzer.
- Pino structured logging with delivery, repository, PR, tenant, installation, analysis run, and job fields where available.
- `/health` and `/ready` endpoints for local integration checks.
- Development-only webhook replay endpoint at `POST /dev/github-webhook-debug`.

## Not Included Yet

This MVP intentionally does not include:

- Frontend dashboard.
- Authentication UI.
- Billing.
- Kubernetes.
- Neo4j or graph analysis.
- Real OpenAI or LLM API calls.
- pgvector similarity search.
- Advanced RAG.

## Local Setup

Requirements:

- Node.js 22+
- pnpm 10+
- Docker Desktop or another Docker runtime
- A GitHub App for live webhook testing

Install dependencies:

```bash
pnpm install
```

If `pnpm` is not installed locally:

```bash
npx pnpm@10.11.0 install
```

Create your environment file:

```bash
cp .env.example .env
```

Start Postgres and Redis:

```bash
docker compose up -d postgres redis
```

The local Postgres service uses `pgvector/pgvector:pg16` so the `vector` extension is available for semantic retrieval.

Generate the Prisma client and run migrations:

```bash
pnpm prisma:generate
pnpm prisma:migrate
```

Run the API and worker in separate terminals:

```bash
pnpm dev
```

```bash
pnpm worker
```

The webhook endpoint is:

```text
POST http://localhost:3000/webhooks/github
```

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `PORT` | API server port. Defaults to `3000` in `.env.example`. |
| `DATABASE_URL` | PostgreSQL connection string used by Prisma. |
| `REDIS_URL` | Redis connection string used by BullMQ. |
| `GITHUB_APP_ID` | Numeric GitHub App ID. |
| `GITHUB_PRIVATE_KEY` | GitHub App private key. Newlines may be escaped as `\n`. |
| `GITHUB_WEBHOOK_SECRET` | Shared secret used to verify GitHub webhook signatures. |
| `GITHUB_CLIENT_ID` | GitHub App client ID, reserved for later OAuth flows. |
| `GITHUB_CLIENT_SECRET` | GitHub App client secret, reserved for later OAuth flows. |
| `DEV_WEBHOOK_TOKEN` | Local-only token for `POST /dev/github-webhook-debug`. Never use this as production auth. |
| `EMBEDDING_PROVIDER` | `fake` by default. Set to `openai` only when real embeddings are wanted. |
| `OPENAI_API_KEY` | Optional. Required only when `EMBEDDING_PROVIDER=openai`. |
| `EMBEDDING_MODEL` | Defaults to `text-embedding-3-small`. |
| `EMBEDDING_DIMENSIONS` | Defaults to `1536`; must match the pgvector column dimension until a migration changes it. |
| `EMBEDDING_BATCH_SIZE` | Defaults to `64`. |
| `RETRIEVAL_TOP_K` | Defaults to `12`. |
| `RETRIEVAL_MAX_CONTEXT_CHARS` | Defaults to `20000`. |
| `LLM_PROVIDER` | `mock` by default. Set to `openai` only when real RAG analysis should call OpenAI. |
| `LLM_MODEL` | Defaults to `gpt-4o-mini`. |
| `LLM_TIMEOUT_MS` | Defaults to `30000`; applies to LLM calls. |
| `LLM_MAX_OUTPUT_TOKENS` | Defaults to `1200`. |
| `ANALYZER_PROVIDER` | `mock` by default. Set to `rag` to use the retrieval-augmented analyzer. |
| `RAG_FALLBACK_TO_MOCK` | Defaults to `true`; if RAG LLM calls fail, ArchGuard falls back to deterministic mock analysis. |
| `RAG_PROMPT_VERSION` | Defaults to `archguard-rag-v1`. |
| `RAG_MAX_CONTEXT_CHARS` | Defaults to `20000`; caps context inserted into RAG prompts. |
| `DEBUG_RAG_PROMPTS` | Defaults to `false`; when true, prompt text is logged at debug level. Do not enable with sensitive repos unless logs are protected. |
| `RAG_WRITE_EVAL_REPORT` | Defaults to `false`; when true, writes timestamped RAG eval JSON to `.reports/rag-evals`. |
| `RAG_VALIDATE_GOLDEN` | Defaults to `false`; when true, validates minimal golden expectations in `fixtures/evals/golden`. |
| `SMOKE_FAIL_ON_FALLBACK` | Defaults to `true`; OpenAI smoke tests fail if RAG falls back to mock. |
| `LLM_INPUT_COST_PER_1M_TOKENS` | Optional approximate input token cost for eval reporting. Not treated as authoritative pricing. |
| `LLM_OUTPUT_COST_PER_1M_TOKENS` | Optional approximate output token cost for eval reporting. Not treated as authoritative pricing. |
| `NODE_ENV` | `development`, `test`, or `production`. |

## Commands

```bash
pnpm dev
pnpm worker
pnpm test
pnpm typecheck
pnpm build
pnpm prisma:generate
pnpm prisma:migrate
pnpm replay:webhook -- ./sample-payloads/pull-request-opened.json
pnpm index:repo -- tenantId=<tenant-id> repositoryId=<repo-id> cloneUrl=https://github.com/org/repo.git fullName=org/repo
pnpm retrieval:test -- tenantId=<tenant-id> repositoryId=<repo-id> query="frontend must not import database"
pnpm fixture:create
pnpm fixture:seed
pnpm fixture:index
pnpm fixture:retrieval
pnpm fixture:analyze -- fixtures/pr-diffs/frontend-db-violation.diff
pnpm verify:phase3
pnpm eval:rag
pnpm smoke:openai-rag
```

## Health Checks

```bash
curl http://localhost:3000/health
curl http://localhost:3000/ready
```

`/health` only confirms that the API process is alive. `/ready` checks database connectivity, Redis connectivity, required environment variables, and whether the GitHub App private key is parseable enough to catch obvious configuration errors.

## Workflow

1. GitHub sends a webhook to `POST /webhooks/github`.
2. The API validates required GitHub headers and verifies the signature against the raw body.
3. The API writes a `WebhookEvent`.
4. Duplicate `x-github-delivery` values return `202 already_received` and do not enqueue another job.
5. Unsupported events are persisted as `IGNORED`.
6. Supported PR events upsert tenant, repository, pull request, and a `QUEUED` `AnalysisRun`.
7. The API enqueues an `archguard-analysis` BullMQ job and returns `202 Accepted`.
8. The worker validates the job payload with Zod.
9. The worker creates an in-progress GitHub Check Run, marks the run `IN_PROGRESS`, indexes the repository, retrieves placeholder context, runs the mock analyzer, stores findings, and completes the Check Run.
10. Failed final attempts are persisted as `FAILED`. If a Check Run exists, the worker updates it with neutral failure output.

## Local GitHub Webhook Testing

Expose the local API with ngrok:

```bash
ngrok http 3000
```

Configure your GitHub App webhook URL:

```text
https://<your-ngrok-subdomain>.ngrok-free.app/webhooks/github
```

In the GitHub App settings:

- Set the webhook secret to match `GITHUB_WEBHOOK_SECRET`.
- Subscribe to `Pull request` events.
- Grant repository contents read access for indexing.
- Grant pull requests read access for metadata and files.
- Grant checks read/write access for Check Run creation and updates.
- Install the app on a test repository.

To test GitHub redelivery, open the GitHub App's Recent Deliveries view, select a delivery, and click **Redeliver**. The second delivery with the same `x-github-delivery` should be persisted once and return `already_received` without adding another BullMQ job.

## Local Webhook Replay

For local debugging without GitHub signatures, start the API and worker, then run:

```bash
pnpm replay:webhook -- ./sample-payloads/pull-request-opened.json
pnpm replay:webhook -- ./sample-payloads/pull-request-synchronize.json
```

The replay script posts to `POST /dev/github-webhook-debug` with `x-archguard-dev-token: DEV_WEBHOOK_TOKEN`. This endpoint is only registered when `NODE_ENV !== "production"`.

## Local Real GitHub App Smoke Test

1. Install dependencies:

```bash
pnpm install
```

2. Start Postgres and Redis:

```bash
docker compose up -d postgres redis
```

3. Run Prisma migration:

```bash
pnpm prisma:generate
pnpm prisma:migrate
```

4. Start the API:

```bash
pnpm dev
```

5. Start the worker in another terminal:

```bash
pnpm worker
```

6. Run health checks:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/ready
```

7. Expose the API:

```bash
ngrok http 3000
```

8. Configure the GitHub App webhook URL:

```text
https://<your-ngrok-subdomain>.ngrok-free.app/webhooks/github
```

9. In GitHub App settings, confirm:

- Webhook secret matches `GITHUB_WEBHOOK_SECRET`.
- Pull request events are subscribed.
- Contents read permission is enabled.
- Pull requests read permission is enabled.
- Checks read/write permission is enabled.
- The app is installed on the test repository.

10. Create or update a test PR.

11. Verify the webhook was received:

- Check the API logs for `GitHub pull_request webhook enqueued for architecture analysis`.
- Check GitHub App Recent Deliveries for a `202` response.

12. Verify database rows exist:

```bash
pnpm prisma studio
```

Inspect `WebhookEvent`, `Repository`, `PullRequest`, `AnalysisRun`, and `Finding`.

13. Verify BullMQ job processing:

```bash
redis-cli keys 'bull:archguard-analysis:*'
redis-cli zrange bull:archguard-analysis:completed 0 -1
redis-cli zrange bull:archguard-analysis:failed 0 -1
```

14. Verify the GitHub Check Run appears on the PR under **Checks** as **ArchGuard Architecture Fitness**.

15. Test GitHub redelivery from the GitHub App Recent Deliveries page.

16. Confirm duplicate delivery behavior:

- The API returns `202 already_received`.
- No duplicate BullMQ job is enqueued.
- `WebhookEvent.githubDeliveryId` remains unique.

## Inspecting Redis and BullMQ

With Redis running locally:

```bash
redis-cli keys 'bull:archguard-analysis:*'
redis-cli llen bull:archguard-analysis:wait
redis-cli zrange bull:archguard-analysis:failed 0 -1
```

For a richer local UI, you can point any BullMQ-compatible inspector at `redis://localhost:6379` and the queue name `archguard-analysis`.

## Database Inspection

Open Prisma Studio:

```bash
pnpm prisma studio
```

Useful tables:

- `WebhookEvent`: delivery idempotency, event status, raw sanitized payload JSON.
- `Repository`: GitHub repository identity and clone URL.
- `PullRequest`: PR number, title, head SHA, and state.
- `IndexedFile`: indexed file paths, content hashes, file types, and last indexed time.
- `CodeChunk`: code/doc/ADR chunks, embedding status, model, and pgvector-backed embedding column.
- `ArchitectureDocument`: detected ADRs, READMEs, and design docs.
- `AnalysisRun`: queued/in-progress/completed/failed lifecycle, verdict, Check Run ID, and errors.
- `Finding`: analyzer findings linked to completed runs.

## Indexing And Retrieval

Repository indexing is incremental:

- Files are scanned while ignoring `.git`, `node_modules`, `dist`, `build`, `coverage`, and lock files.
- Each file gets a content hash.
- Unchanged files are skipped and their chunks are preserved.
- Changed files have chunks rebuilt and re-embedded.
- Deleted files are removed with cascading chunks.
- Markdown architecture documents are detected and stored in `ArchitectureDocument`.

Chunking is heuristic for now:

- TypeScript/JavaScript splits on exported functions, classes, interfaces, types, and constants.
- Python splits on `def`, `async def`, and `class`.
- Markdown splits by headings.
- Other files fall back to line windows.

Retrieval is hybrid:

- Always include chunks from changed files when available.
- Include ADR chunks.
- Include pgvector semantic matches from `CodeChunk.embeddingVector`.
- Fall back to keyword search if vector retrieval is unavailable.
- Cap total context with `RETRIEVAL_TOP_K` and `RETRIEVAL_MAX_CONTEXT_CHARS`.

The worker indexes the repository and generates embeddings before calling the selected analyzer. The default remains the deterministic mock analyzer; `ANALYZER_PROVIDER=rag` enables the Phase 4 RAG analyzer.

## Phase 3 Local Retrieval Verification

Use this workflow to prove the local pgvector/indexing/retrieval path without GitHub:

```bash
docker compose up -d postgres redis
pnpm prisma:migrate
pnpm fixture:create
pnpm fixture:seed
pnpm fixture:index
pnpm fixture:retrieval
EXPECT_VERDICT=DRIFT_RISK pnpm fixture:analyze -- fixtures/pr-diffs/frontend-db-violation.diff
pnpm verify:phase3
```

The fixture repository is generated under:

```text
.tmp/fixture-repos/layered-app
```

It contains a clean layered TypeScript app plus ADRs:

- `docs/adr/0001-layered-architecture.md`
- `docs/adr/0002-frontend-must-not-import-db.md`
- `src/frontend/components/UserCard.tsx`
- `src/frontend/api/user-api.ts`
- `src/backend/services/user-service.ts`
- `src/backend/db/client.ts`
- `src/backend/db/user-repository.ts`

PR-like diff fixtures live in:

```text
fixtures/pr-diffs/
  clean-frontend-change.diff
  frontend-db-violation.diff
  empty-change.diff
```

Expected analyzer checks:

```bash
EXPECT_VERDICT=FIT pnpm fixture:analyze -- fixtures/pr-diffs/clean-frontend-change.diff
EXPECT_VERDICT=DRIFT_RISK pnpm fixture:analyze -- fixtures/pr-diffs/frontend-db-violation.diff
EXPECT_VERDICT=INSUFFICIENT_EVIDENCE pnpm fixture:analyze -- fixtures/pr-diffs/empty-change.diff
```

`pnpm verify:phase3` prints a report like:

```text
ARCHGUARD PHASE 3 VERIFICATION

Database: ok
pgvector extension: ok
Fixture repo: ok
Architecture documents: 2
ADR chunks: N
Code chunks: N
Embeddings embedded: N
Retrieval checks: passed
Analyzer checks:
- clean change: FIT
- frontend db violation: DRIFT_RISK
- empty change: INSUFFICIENT_EVIDENCE

Overall: PASSED
```

Phase 3 troubleshooting:

- pgvector extension missing: confirm Docker Compose uses `pgvector/pgvector:pg16`, then recreate Postgres if an old `postgres:16-alpine` image initialized the volume.
- `embeddingVector` column missing: run `pnpm prisma:migrate` and inspect migration `20260519093000_pgvector_retrieval_adr_ingestion`.
- Zero ADR chunks: run `pnpm fixture:create`, confirm ADR markdown files exist under `.tmp/fixture-repos/layered-app/docs/adr`, then run `pnpm fixture:index`.
- Zero embedded chunks: confirm `EMBEDDING_PROVIDER=fake` for local verification and check `CodeChunk.embeddingStatus`.
- Retrieval does not return ADR 0002: inspect `CodeChunk` rows where `chunkType=ADR`, then run `pnpm fixture:retrieval`.
- Analyzer returns `FIT` when `DRIFT_RISK` is expected: confirm the diff contains an added import from `backend/db/client` inside `src/frontend/components/UserCard.tsx`.

## Phase 4: Real RAG Analyzer

Phase 4 adds a retrieval-augmented analyzer behind a provider switch. It builds an architecture-specific prompt from PR diff, changed files, ADR chunks, changed-file chunks, and semantically similar code chunks. The LLM must return strict JSON matching `ArchitectureAnalysisResult`; invalid JSON is retried once with a repair prompt. If repair still fails, ArchGuard returns `INSUFFICIENT_EVIDENCE` instead of crashing the worker.

Mock RAG mode is deterministic and requires no network:

```bash
ANALYZER_PROVIDER=rag LLM_PROVIDER=mock pnpm eval:rag
ANALYZER_PROVIDER=rag LLM_PROVIDER=mock EXPECT_VERDICT=DRIFT_RISK pnpm fixture:analyze -- fixtures/pr-diffs/frontend-db-violation.diff
```

OpenAI RAG mode is opt-in:

```bash
ANALYZER_PROVIDER=rag LLM_PROVIDER=openai OPENAI_API_KEY=... pnpm eval:rag
```

Fallback behavior:

- `ANALYZER_PROVIDER=mock` keeps the Phase 2/3 deterministic analyzer.
- `ANALYZER_PROVIDER=rag LLM_PROVIDER=mock` runs the RAG prompt and strict-output pipeline with a deterministic mock LLM.
- `ANALYZER_PROVIDER=rag LLM_PROVIDER=openai` calls OpenAI chat completions with JSON output mode, timeout, and max token limits.
- If the RAG LLM call fails and `RAG_FALLBACK_TO_MOCK=true`, ArchGuard logs a warning, runs the mock analyzer, and records `fallbackUsed=true` on `AnalysisRun`.
- Full prompts are not logged unless `DEBUG_RAG_PROMPTS=true`.
- GitHub Check Runs show verdict, confidence, analyzer provider, model, fallback status, retrieved context summary, findings, evidence references, and the advisory note. They do not dump full prompts or retrieved context.

Evaluation fixtures live at:

```text
fixtures/evals/architecture-drift-cases.json
```

The eval pack covers frontend-to-db drift, clean frontend changes, empty diffs, backend repository changes, frontend API client changes, and backend-service-to-frontend dependency drift.

## Phase 4.5: Real LLM Smoke Test and RAG Eval Reports

Phase 4.5 makes RAG quality inspectable without turning normal tests into paid API calls. Regular tests still use mock providers. Real OpenAI smoke testing is an explicit opt-in command.

Mock eval with a timestamped report:

```bash
ANALYZER_PROVIDER=rag LLM_PROVIDER=mock RAG_WRITE_EVAL_REPORT=true pnpm eval:rag
```

OpenAI smoke test:

```bash
ANALYZER_PROVIDER=rag LLM_PROVIDER=openai OPENAI_API_KEY=... pnpm smoke:openai-rag
```

Debug prompt traces:

```bash
ANALYZER_PROVIDER=rag LLM_PROVIDER=mock DEBUG_RAG_PROMPTS=true RAG_WRITE_EVAL_REPORT=true pnpm eval:rag
```

Golden validation:

```bash
ANALYZER_PROVIDER=rag LLM_PROVIDER=mock RAG_VALIDATE_GOLDEN=true pnpm eval:rag
```

Eval reports are written only when `RAG_WRITE_EVAL_REPORT=true`:

```text
.reports/rag-evals/rag-eval-YYYYMMDD-HHMMSS.json
```

Reports include run metadata, pass/fail counts, average latency, confidence buckets, fallback status, top evidence files, and approximate token estimates using `ceil(charCount / 4)`. Approximate cost is included only when `LLM_INPUT_COST_PER_1M_TOKENS` and `LLM_OUTPUT_COST_PER_1M_TOKENS` are provided; those values are configuration inputs, not hardcoded pricing claims.

Prompt/output traces are written only when `DEBUG_RAG_PROMPTS=true`:

```text
.reports/rag-traces/<run-id>/<case-name>/
  prompt.txt
  raw-llm-output.json
  parsed-result.json
  retrieved-context.json
```

`.reports/` is ignored by Git. Trace files redact obvious OpenAI API key patterns, but they may still contain repository snippets; treat them as local debugging artifacts.

Golden fixtures live in:

```text
fixtures/evals/golden/
```

Golden checks intentionally validate minimal stable expectations only: verdict, required evidence files, and required severity. They do not snapshot model prose.

The OpenAI smoke test runs only two small cases by default: frontend importing DB and clean frontend display change. It refuses to run unless `ANALYZER_PROVIDER=rag`, `LLM_PROVIDER=openai`, and `OPENAI_API_KEY` are set. By default, `SMOKE_FAIL_ON_FALLBACK=true` makes the smoke test fail if the RAG analyzer falls back to mock.

## Recommended ADR Layout

```text
docs/adr/
  0001-use-layered-architecture.md
  0002-frontend-must-not-import-db.md
```

Example ADR:

```markdown
# ADR 0002: Frontend must not import database layer

## Status
Accepted

## Context
Frontend code should communicate through API/service boundaries.

## Decision
Files under frontend/ or ui/ must not import from db/ directly.

## Consequences
Database access remains centralized in backend services.
```

ADR scanner paths:

- `docs/adr`
- `docs/adrs`
- `adr`
- `adrs`
- `architecture`
- `docs/architecture`

## Failure Behavior

- Invalid webhook signatures return `401` and are not persisted.
- Missing required GitHub headers return `400`.
- Unsupported events are persisted as `IGNORED`.
- Duplicate deliveries return `202 already_received`.
- Jobs retry up to 3 times with exponential backoff.
- Invalid job payloads fail fast.
- On final job failure, `AnalysisRun.status` becomes `FAILED` and `errorMessage` is stored.
- Check Run failure output is neutral in the MVP so ArchGuard remains advisory.

## Failure Mode Guide

If the webhook returns `401`:

- Confirm `GITHUB_WEBHOOK_SECRET` matches the GitHub App webhook secret.
- Confirm the request is going to `/webhooks/github`, not the dev replay endpoint.
- In GitHub Recent Deliveries, inspect the request headers and response.

If the webhook returns `202` but no job appears:

- Check `WebhookEvent.status` in Prisma Studio.
- Confirm the event is `pull_request` and action is `opened`, `synchronize`, or `reopened`.
- Confirm Redis is reachable with `redis-cli ping`.
- Check API logs for `enqueue_failed`.

If the worker does not pick up a job:

- Confirm `pnpm worker` is running.
- Confirm `REDIS_URL` is identical for API and worker.
- Check `redis-cli llen bull:archguard-analysis:wait`.
- Check worker startup logs for queue name and Redis status.

If the Check Run does not appear:

- Confirm the GitHub App has Checks read/write permission.
- Confirm the app is installed on the repository receiving the PR.
- Check `AnalysisRun.githubCheckRunId`.
- Check worker logs for GitHub API errors.

If GitHub auth fails:

- Confirm `GITHUB_APP_ID` is numeric and belongs to the app.
- Confirm `GITHUB_PRIVATE_KEY` is the app private key, with newlines escaped as `\n` if stored on one line.
- Run `/ready`; `githubApp` should be `ok`.
- Regenerate the GitHub App private key if parsing fails.

If Redis connection fails:

- Run `docker compose up -d redis`.
- Run `redis-cli ping`.
- Confirm `REDIS_URL=redis://localhost:6379`.

If Prisma migration fails:

- Run `docker compose up -d postgres`.
- Confirm the Postgres image is `pgvector/pgvector:pg16`.
- Confirm `DATABASE_URL` points to the local Postgres service.
- Run `pnpm prisma:generate`.
- Re-run `pnpm prisma:migrate` and inspect the reported migration name.

## Mock Analyzer Behavior

The MVP analyzer returns:

- `DRIFT_RISK` when a diff adds a direct import from `db` inside files under `ui/` or `frontend/`.
- `INSUFFICIENT_EVIDENCE` when there are no meaningful source changes.
- `FIT` for ordinary source changes that do not trip the MVP heuristic.

The Check Run output includes verdict, confidence, summary, findings table, retrieved context summary, and a note that ArchGuard is advisory in the MVP.

## Current Limitations

- Embeddings are deterministic fake vectors unless `EMBEDDING_PROVIDER=openai`.
- OpenAI embeddings are implemented but not required for local tests.
- The default analyzer is heuristic-only; the RAG analyzer is opt-in with `ANALYZER_PROVIDER=rag`.
- The mock LLM provider is deterministic and intended for local evals.
- Repository indexing is synchronous inside the worker.
- RAG prompts are architecture-focused, but real OpenAI judgment is only used when explicitly configured.
- Tenant isolation is modeled but not hardened.
- No dashboard, billing, auth UI, or production observability stack yet.

## Future Roadmap

- Phase 5 production hardening for RAG quality, prompt evals, and provider observability.
- Multi-repo support.
- SaaS dashboard.
- Hardened tenant isolation.
- Observability for webhook intake, indexing, retrieval, and analysis jobs.
