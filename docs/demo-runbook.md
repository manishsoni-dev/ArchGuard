# ArchGuard Demo Runbook

Use this runbook for interviews, walkthroughs, and portfolio demos. The goal is to show that ArchGuard is not a static mock. It receives a real GitHub webhook, runs a durable worker job, retrieves architecture context, analyzes the PR, persists the run, and posts a GitHub Check Run.

## Pre-Demo Checklist

From the repository root:

```bash
docker compose ps
pnpm e2e:check
curl http://localhost:3000/ready
curl -H "ngrok-skip-browser-warning: true" https://YOUR-NGROK-DOMAIN.ngrok-free.dev/ready
pnpm queue:inspect
pnpm analysis:runs
```

Also confirm:

- API is running with `pnpm dev`.
- Worker is running with `pnpm worker`.
- ngrok is running with `ngrok http 3000`.
- GitHub App webhook URL is `https://YOUR-NGROK-DOMAIN.ngrok-free.dev/webhooks/github`.
- GitHub App is installed on the demo repository.
- GitHub App subscribes to the `pull_request` event.

## Demo Story

### 1. Show The Architecture Diagram

Start with the README architecture diagram. Explain the durable path:

```text
GitHub PR -> webhook -> API -> WebhookEvent -> BullMQ -> Worker -> indexing -> retrieval -> analyzer -> Check Run
```

Make the point that the API does not run analysis inline. It accepts and persists the event, then the worker handles the expensive path.

### 2. Show PR #1: DRIFT_RISK

Open:

```text
https://github.com/Manisshhhhhh/ArchGuard/pull/1
```

Point out:

- The PR adds `src/frontend/components/UserCard.tsx`.
- The frontend file imports from `src/backend/db/client.ts`.
- ArchGuard posts `ArchGuard Architecture Fitness`.
- The verdict is `DRIFT_RISK`.
- The finding references the frontend file and recommends going through the API or backend service boundary.

### 3. Explain Retrieved ADR And Code Context

Show the ADR:

```text
docs/adr/0002-frontend-must-not-import-db.md
```

Explain:

- ADRs are indexed as architecture documents.
- Code and ADR chunks are embedded.
- Retrieval prioritizes ADRs for architecture-policy queries.
- Retrieval also includes changed files and related code examples.
- The analyzer is not making a generic style comment. It is checking a repository-specific rule.

### 4. Show PR #3: FIT

Open:

```text
https://github.com/Manisshhhhhh/ArchGuard/pull/3
```

Point out:

- This is a normal maintenance change.
- ArchGuard still runs the full webhook and worker flow.
- The verdict is `FIT`.

### 5. Show Diagnostics

Run:

```bash
pnpm webhook:events
pnpm queue:inspect
pnpm analysis:runs
```

Explain:

- `webhook:events` proves GitHub deliveries reached the API and were persisted.
- `queue:inspect` proves BullMQ jobs were processed.
- `analysis:runs` proves verdicts and findings were persisted.

### 6. Explain Why This Is Not Just A ChatGPT Wrapper

Key points:

- GitHub App webhook integration is real.
- Webhook signatures are verified.
- Delivery idempotency prevents duplicate enqueueing.
- Jobs are durable and retryable through BullMQ.
- Repositories are indexed incrementally.
- ADRs and code chunks are retrieved before analysis.
- Results are typed and persisted.
- Check Runs are posted through the GitHub Checks API.
- Normal demo mode uses mock LLM and fake embeddings for deterministic repeatability.

## Failure Recovery

### ngrok Offline

Symptoms:

- GitHub delivery shows connection failure.
- `curl` to ngrok `/ready` fails.

Fix:

```bash
ngrok http 3000
```

Update the GitHub App webhook URL if ngrok gives a new domain.

### Port 3000 Busy

Symptoms:

- `pnpm dev` fails with `EADDRINUSE`.

Fix:

```bash
pnpm check:port -- 3000
pnpm kill:port -- 3000 --yes
pnpm dev
```

### No Webhook Event

Symptoms:

- `pnpm webhook:events` does not show a new `pull_request` event.

Check:

- GitHub App is installed on the correct repository.
- Webhook URL ends with `/webhooks/github`.
- GitHub App subscribes to `pull_request`.
- GitHub App delivery log shows `202`.
- API is running.

### Job Failed

Symptoms:

- `pnpm queue:inspect` shows failed jobs.
- `pnpm analysis:runs` shows `FAILED`.

Check:

- Worker is running.
- Redis is reachable.
- Database is reachable.
- GitHub App installation has Contents, Pull requests, Checks, and Metadata permissions.

### No Check Run

Symptoms:

- Webhook and job exist, but GitHub PR has no `ArchGuard Architecture Fitness` check.

Check:

- GitHub App has Checks: Read and write.
- Worker logs do not show GitHub API errors.
- `analysis:runs` has a `githubCheckRunId`.
- The PR head SHA matches the analysis run.

### GitHub App Permission Missing

Symptoms:

- Worker fails when fetching PR files or creating Check Runs.
- GitHub App metadata shows missing permissions.

Fix in GitHub App settings:

- Contents: Read-only
- Pull requests: Read-only
- Checks: Read and write
- Metadata: Read-only
- Subscribe to Pull request event

Then redeliver the webhook or push a new commit to the PR branch.
