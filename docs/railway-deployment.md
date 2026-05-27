# Railway Deployment Runbook

This runbook is for the stable hosted demo at:

```txt
https://archguard-production.up.railway.app
```

ArchGuard should stay in demo-safe mode for this deployment:

```env
ANALYZER_PROVIDER=rag
LLM_PROVIDER=mock
EMBEDDING_PROVIDER=fake
```

No OpenAI key is required for the hosted demo.

## Placeholder Warning

Do not run commands with `THE_REAL_API_SERVICE_URL`, `THE_REAL_API_URL`, `YOUR-STABLE-DOMAIN`, or `YOUR-DEPLOYED-DOMAIN`.
Those are documentation placeholders. Copy the exact public domain from the Railway API service.

## Required Railway Services

1. `archguard-api` web service
2. `archguard-worker` background service
3. Postgres with pgvector support
4. Redis

The API and worker must share the same `DATABASE_URL`, `REDIS_URL`, GitHub App secrets, and analyzer configuration.

## API Service Settings

- Build from the repository root.
- Use `Dockerfile.api`, or equivalent Node build/start commands.
- Start command must run the API server, not the worker.
- The API must listen on Railway's injected `PORT`.
- The app binds to `0.0.0.0` by default.
- Health path: `/health`.
- Readiness path: `/ready`.

Docker command:

```txt
node apps/api/dist/src/server.js
```

Node command equivalent:

```bash
pnpm install --frozen-lockfile
pnpm prisma:generate
pnpm build
node apps/api/dist/src/server.js
```

## Worker Service Settings

- Use `Dockerfile.worker`, or equivalent Node build/start commands.
- No public domain is required.
- Must run only the worker process.
- Must share `DATABASE_URL`, `REDIS_URL`, GitHub App env vars, and analyzer env vars with the API.

Docker command:

```txt
node apps/api/dist/src/jobs/worker.js
```

## Required Production Environment Variables

```env
NODE_ENV=production
DATABASE_URL=...
REDIS_URL=...
GITHUB_APP_ID=...
GITHUB_PRIVATE_KEY=...
GITHUB_WEBHOOK_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
PUBLIC_WEBHOOK_URL=https://archguard-production.up.railway.app
ANALYZER_PROVIDER=rag
LLM_PROVIDER=mock
EMBEDDING_PROVIDER=fake
RAG_FALLBACK_TO_MOCK=true
```

Railway should supply `PORT`. Do not hardcode `PORT` unless Railway support requires it for a specific service shape.

Never print or commit `DATABASE_URL`, `REDIS_URL`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, or `GITHUB_CLIENT_SECRET`.

## Migration Command

Run migrations before the API and worker handle traffic:

```bash
pnpm prisma migrate deploy --schema prisma/schema.prisma
```

If the migration command fails, do not cut over the GitHub App webhook.

## Debug Sequence

1. Check Railway API logs.
2. Confirm the API process starts and logs host, port, env, and service role.
3. Open `https://archguard-production.up.railway.app/health`.
4. Run:

   ```bash
   pnpm smoke:deployment -- baseUrl=https://archguard-production.up.railway.app
   ```

5. If Railway returns `Application not found`, run:

   ```bash
   pnpm railway:domain-check -- baseUrl=https://archguard-production.up.railway.app
   ```

   This means the public domain is not attached to the API service, is stale, or the wrong Railway URL is being tested.

6. Inspect `/ready` if `/health` passes but readiness fails.
7. Run inside Railway shell if available:

   ```bash
   pnpm railway:diagnose
   ```

8. Check worker logs for queue startup and Redis connectivity.
9. Only after smoke passes, update the GitHub App webhook URL.

## Common Failure Map

- `/health` fails: API process is not running, wrong start command, wrong port binding, bad Docker build, missing runtime dependency, or crash loop.
- `/health` ok but `/ready` fails: database, Redis, production env, or GitHub App configuration is wrong.
- `/version` ok but `/health` fails: route registration or smoke-script path bug; both should be served by the same API process.
- Railway `404 Application not found` on `/health`, `/ready`, and `/version`: the domain is not attached to the API service, or the wrong/stale domain is being used. Fix it in Railway by opening the API service, going to Networking, generating or attaching a public domain, and copying the exact URL.
- Zod invalid URL or invalid arguments: placeholder text was passed instead of a real URL. Use a real `https://` domain from the Railway API service.
- Webhook returns `404`: GitHub App webhook URL is wrong; use `/webhooks/github`.
- Webhook returns `401`: webhook secret mismatch between GitHub App settings and Railway env.
- Check Run missing: worker is down, Redis is unavailable, the job failed, or Checks permission is missing.
- pgvector missing: use a pgvector-capable Postgres service or enable the extension before indexing.

## Cutover Order

1. Provision Postgres with pgvector.
2. Provision Redis.
3. Set production secrets and demo mode env vars.
4. Run migration deploy.
5. Deploy API.
6. Deploy worker.
7. Run `pnpm railway:diagnose` in Railway shell.
8. Run `pnpm smoke:deployment -- baseUrl=https://archguard-production.up.railway.app`.
9. Update GitHub App webhook URL to `https://archguard-production.up.railway.app/webhooks/github`.
10. Redeliver a `pull_request` webhook or open a test PR.
11. Run hosted proof with a real PR number:

    ```bash
    pnpm hosted:pr-proof -- owner=Manisshhhhhh repo=ArchGuard pr=5 baseUrl=https://archguard-production.up.railway.app
    ```
