# Portfolio Card Content

## Card

Title: ArchGuard

Subtitle: AI-powered PR architecture fitness checks

Description:

ArchGuard is a GitHub App that reviews pull requests against repository-specific architecture context. It receives GitHub webhooks, persists deliveries, runs a durable worker job, indexes code and ADRs, retrieves relevant architecture evidence, and posts a GitHub Check Run verdict such as `FIT`, `DRIFT_RISK`, or `INSUFFICIENT_EVIDENCE`.

## Links

- Live demo UI: [https://demo-web-delta-five.vercel.app](https://demo-web-delta-five.vercel.app)
- Replit API proof: [https://arch-guard-1--manishsoni-dev.replit.app](https://arch-guard-1--manishsoni-dev.replit.app)
- GitHub repository: [https://github.com/manishsoni-dev/ArchGuard](https://github.com/manishsoni-dev/ArchGuard)
- Proof pack: [docs/live-demo-proof.md](live-demo-proof.md)

## Proof Points

- PR #8 passed with `FIT` after the public Replit and Vercel demo passed verification.
- PR #1 remains available as a `DRIFT_RISK` proof case for a frontend-to-database boundary violation.
- Public demo check verifies `/health`, `/ready`, `/version`, `/demo/status`, `/demo/proof`, and the Vercel UI.

## Tags

TypeScript, Fastify, Prisma, Postgres, pgvector, Redis, BullMQ, GitHub Apps, Octokit, RAG, Replit, Vercel

## CTA Labels

- View live demo
- See API proof
- Read proof pack
- View source
