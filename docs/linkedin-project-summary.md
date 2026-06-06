# LinkedIn Project Summary

## Post Copy

I built ArchGuard, an AI-powered GitHub App that checks pull requests for architecture fitness instead of only looking for syntax, lint, or test issues.

The core idea: a PR can compile and still violate the way a codebase is supposed to be built. ArchGuard listens to GitHub pull request webhooks, persists each delivery, runs analysis through a durable worker queue, indexes repository code and ADRs, retrieves architecture context, and posts a typed GitHub Check Run verdict.

The live demo is now public:

- Replit API and worker: https://arch-guard-1--manishsoni-dev.replit.app
- Vercel demo UI: https://demo-web-delta-five.vercel.app
- Repository: https://github.com/manishsoni-dev/ArchGuard

Current proof:

- PR #8 passed with `FIT` after the live Replit and Vercel deployment was verified.
- PR #1 is kept as a `DRIFT_RISK` proof case where a frontend component imports the database layer directly.
- The public demo check verifies `/health`, `/ready`, `/version`, `/demo/status`, `/demo/proof`, and the Vercel UI.

Tech used: TypeScript, Fastify, Prisma, Postgres with pgvector, Redis, BullMQ, GitHub Apps, Octokit, Vercel, and Replit.

What I like most about this project is that the demo is not a static mock. It is a real webhook-to-worker-to-check-run path that makes architecture review visible inside the pull request workflow.

## Short Version

ArchGuard is an AI-powered GitHub App for architecture fitness checks on pull requests. It runs a real webhook, queue, repository indexing, retrieval, analysis, and GitHub Check Run workflow, with the API and worker hosted on Replit and the demo UI hosted on Vercel.
