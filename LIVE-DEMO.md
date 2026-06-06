# ArchGuard Live Demo

ArchGuard is live as a public demo with the API and worker on Replit and the demo UI on Vercel.

- Live UI: [https://demo-web-delta-five.vercel.app](https://demo-web-delta-five.vercel.app)
- Live API: [https://arch-guard-1--manishsoni-dev.replit.app](https://arch-guard-1--manishsoni-dev.replit.app)
- Proof pack: [docs/live-demo-proof.md](docs/live-demo-proof.md)
- FIT proof PR: [PR #8](https://github.com/manishsoni-dev/ArchGuard/pull/8)
- DRIFT_RISK proof PR: [PR #1](https://github.com/manishsoni-dev/ArchGuard/pull/1)

The public proof endpoints are safe to inspect:

- `/health`
- `/ready`
- `/version`
- `/demo/status`
- `/demo/proof`

Do not test `/webhooks/github` with a browser `GET`; that route is for signed GitHub `POST` deliveries.
