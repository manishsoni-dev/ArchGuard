# Production Processes

ArchGuard deploys as two separate processes with shared environment variables.

## API Process

```bash
node apps/api/dist/src/server.js
```

Exposes:

- `GET /health`
- `GET /ready`
- `GET /version`
- `POST /webhooks/github`

## Worker Process

```bash
node apps/api/dist/src/jobs/worker.js
```

The worker has no public port. It consumes BullMQ jobs from Redis and writes analysis results to Postgres and GitHub Check Runs.

## Migration Command

Run before deploying new application code:

```bash
pnpm prisma migrate deploy --schema prisma/schema.prisma
```

Use `pnpm migration:status` to inspect migration state without applying migrations.

## Shared Environment Variables

Both API and worker require:

- `NODE_ENV`
- `DATABASE_URL`
- `REDIS_URL`
- `GITHUB_APP_ID`
- `GITHUB_PRIVATE_KEY`
- `GITHUB_WEBHOOK_SECRET`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `PUBLIC_WEBHOOK_URL`
- `ANALYZER_PROVIDER`
- `LLM_PROVIDER`
- `EMBEDDING_PROVIDER`
- `APP_VERSION`
- `GIT_SHA`

## API-Only Environment Variables

- `PORT`
- `DEV_WEBHOOK_TOKEN` only for non-production development debugging

## Worker-Only Environment Variables

There are no worker-only required variables today. Keep analyzer, embedding, Redis, database, and GitHub variables in sync with the API.

## Release Order

1. Provision Postgres with pgvector.
2. Provision Redis.
3. Set secrets.
4. Run migration.
5. Deploy API.
6. Deploy worker.
7. Run smoke test.
8. Update GitHub webhook URL.
9. Open test PR.

## Commands

```bash
pnpm validate:prod-env
pnpm migration:status
pnpm smoke:deployment -- baseUrl=https://YOUR-DOMAIN
pnpm hosted:pr-proof -- owner=OWNER repo=REPO pr=NUMBER baseUrl=https://YOUR-DOMAIN
```
