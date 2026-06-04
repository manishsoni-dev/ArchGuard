# Vercel + Replit Live Demo

This guide creates a public ArchGuard demo without changing the core product architecture.

## Topology

- Vercel hosts the static demo web app from `apps/demo-web`.
- Replit runs the long-lived API and worker for the demo.
- Postgres with pgvector and Redis remain required for the API and worker.
- Production deployments should still run API and worker as separate processes.

Default demo mode does not require OpenAI:

```text
ANALYZER_PROVIDER=rag
LLM_PROVIDER=mock
EMBEDDING_PROVIDER=fake
```

## Replit Runtime

Use `.replit.example` as a reference. Do not overwrite an existing `.replit` without checking local Replit settings first.

Replit setup:

```bash
pnpm install
pnpm prisma:generate
pnpm prisma migrate deploy --schema prisma/schema.prisma
pnpm demo:replit
```

For a throwaway local-style database, `pnpm prisma:migrate` is acceptable. For persistent hosted data, prefer `pnpm prisma migrate deploy --schema prisma/schema.prisma`.

Required Replit secrets:

- `DATABASE_URL`
- `REDIS_URL`
- `GITHUB_APP_ID`
- `GITHUB_PRIVATE_KEY`
- `GITHUB_WEBHOOK_SECRET`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`

Recommended demo env:

- `PUBLIC_WEBHOOK_URL=https://YOUR-REPLIT-PUBLIC-URL`
- `DEMO_REPO_URL=https://github.com/OWNER/REPO`
- `DEMO_DRIFT_PR_URL=https://github.com/OWNER/REPO/pull/1`
- `DEMO_FIT_PR_URL=https://github.com/OWNER/REPO/pull/2`
- `DEMO_ALLOWED_ORIGIN=https://YOUR-VERCEL-DEMO-URL`

After the Replit process starts, set the GitHub App webhook URL to:

```text
https://YOUR-REPLIT-PUBLIC-URL/webhooks/github
```

## Vercel Demo Web

Create a Vercel project with:

- Project root: `apps/demo-web`
- Install command: `pnpm install`
- Build command: `pnpm build`
- Output directory: `dist`
- Environment variable: `VITE_ARCHGUARD_API_URL=https://YOUR-REPLIT-OR-HOSTED-API-URL`

Do not deploy the API or worker to Vercel. ArchGuard needs a long-running API process and a worker process, which belong on Replit or a production process host.

## Public API Demo Routes

The Replit API should expose:

- `/`
- `/health`
- `/ready`
- `/version`
- `/demo`
- `/demo/status`
- `/demo/proof`

The public demo routes are safe to link publicly. They do not expose secrets, raw prompts, database URLs, Redis URLs, or retrieved context.
