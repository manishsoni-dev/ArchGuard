# ArchGuard Deployment Templates

ArchGuard deploys as two long-running Node.js processes that share the same environment:

- API process: `node apps/api/dist/src/server.js`
- Worker process: `node apps/api/dist/src/jobs/worker.js`

Both processes need access to the same Postgres database, Redis instance, GitHub App credentials, and analyzer configuration.

## Provider-Neutral Flow

1. Provision Postgres with pgvector support.
2. Provision Redis.
3. Build the API image:

   ```bash
   pnpm docker:build:api
   ```

4. Build the worker image:

   ```bash
   pnpm docker:build:worker
   ```

5. Run Prisma migrations before starting traffic:

   ```bash
   pnpm prisma migrate deploy --schema prisma/schema.prisma
   ```

6. Start one API process and at least one worker process.
7. Point the GitHub App webhook URL at:

   ```text
   https://YOUR-STABLE-DOMAIN/webhooks/github
   ```

## Shared Environment

Use `.env.production.example` as the template for your deployment secret store. Keep the API and worker environment identical unless a platform requires separating process-specific values.

The default hosted demo mode is:

```text
ANALYZER_PROVIDER=rag
LLM_PROVIDER=mock
EMBEDDING_PROVIDER=fake
```

OpenAI remains opt-in only.

## Docker Compose Example

`deploy/docker-compose.production.example.yml` shows the complete four-service topology:

- `api`
- `worker`
- `postgres`
- `redis`

It is intentionally an example. Replace placeholder passwords and secret values before using it for a hosted demo.

## Process Templates

- `deploy/processes.md` documents the API process, worker process, migration command, and release order.
- `deploy/render.example.yaml` is an example Render-style service template.
- `deploy/railway.example.json` is an example Railway-style service template.

The provider templates intentionally contain placeholders. Put real values in your provider secret store, not in these files.
