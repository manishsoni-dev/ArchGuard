# Operations

This guide covers hosted-demo operations for ArchGuard: logs, diagnostics, rollback, and incident response.

## Healthy Startup

API logs should show:

- server listening on the configured `PORT`
- `/health` returning 200
- `/ready` returning 200 after Postgres, Redis, env, and GitHub App config pass

Worker logs should show:

- queue name: `archguard-analysis`
- Redis connection ready
- `NODE_ENV`
- GitHub environment presence as booleans only

No log should print private keys, webhook secrets, client secrets, OpenAI keys, full prompts, or full diffs.

## Webhook 202

A `POST /webhooks/github` response with 202 means ArchGuard accepted the delivery. For supported pull request actions, the event should be persisted and a BullMQ job should be enqueued. Duplicate GitHub delivery ids also return 202 but should not enqueue duplicate jobs.

## Useful Diagnostics

```bash
pnpm webhook:events
pnpm queue:inspect
pnpm analysis:runs
pnpm debug:pr -- owner=OWNER repo=REPO pr=NUMBER
pnpm hosted:pr-proof -- owner=OWNER repo=REPO pr=NUMBER baseUrl=https://YOUR-DOMAIN
```

Use these in order:

1. `webhook:events`: confirms GitHub reached the API.
2. `queue:inspect`: confirms jobs are not stuck or failed.
3. `analysis:runs`: confirms worker lifecycle and verdict persistence.
4. `debug:pr`: confirms GitHub App can read PR metadata.
5. `hosted:pr-proof`: checks deployed health, PR access, Check Run presence, and persisted analysis.

## Failed Job Symptoms

- Queue has failed jobs.
- `AnalysisRun.status` is `FAILED`.
- Worker logs include GitHub API, database, Redis, indexing, or retrieval errors.
- GitHub Check Run may be neutral with a failure-style summary.

## No Check Run

Check:

- GitHub App has Checks read/write permission.
- GitHub App is installed on the repository.
- Webhook URL ends in `/webhooks/github`.
- Worker is running.
- `analysis:runs` has a completed run with `githubCheckRunId`.

## Rollback Checklist

1. Repoint the service to the previous known-good image or commit.
2. Keep Postgres data intact.
3. Restart API and worker.
4. Run:

   ```bash
   pnpm smoke:deployment -- baseUrl=https://YOUR-DOMAIN
   ```

5. Redeliver a recent pull request webhook or push a no-op commit.
6. Run:

   ```bash
   pnpm hosted:pr-proof -- owner=OWNER repo=REPO pr=NUMBER baseUrl=https://YOUR-DOMAIN
   ```

## Incident Checklists

### Database Down

- `/ready` reports database error.
- Confirm `DATABASE_URL`.
- Confirm firewall/network access.
- Run `pnpm migration:status` from the deployment environment.

### Redis Down

- `/ready` reports Redis error.
- Worker cannot reserve jobs.
- Confirm `REDIS_URL`.
- Restart Redis and worker.

### GitHub Webhook 401

- Webhook secret mismatch.
- Update `GITHUB_WEBHOOK_SECRET` in the deployment secret store.
- Update the GitHub App webhook secret to match.

### GitHub Webhook 404

- Webhook URL is wrong.
- Confirm it is `https://YOUR-DOMAIN/webhooks/github`.
- Confirm the API process is deployed and routing traffic.

### Worker Not Running

- Webhooks are persisted but no analysis completes.
- Start the worker process:

  ```bash
  node apps/api/dist/src/jobs/worker.js
  ```

### pgvector Extension Missing

- Retrieval/indexing fails around vector SQL.
- Run migrations:

  ```bash
  pnpm prisma migrate deploy --schema prisma/schema.prisma
  ```

### Wrong GitHub App Installation

- GitHub PR lookup fails or Check Run cannot be created.
- Confirm the app is installed on the target owner/repo.
- Confirm the installation id in deployment env if using hosted proof scripts.
