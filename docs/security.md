# ArchGuard Security Notes

ArchGuard handles GitHub App credentials, webhook secrets, repository code, pull request diffs, prompts, and retrieved architecture context. Treat local development logs and screenshots as potentially sensitive.

## Secrets Hygiene

Never commit:

- `.env`
- `.env.*`
- downloaded GitHub App `.pem` files
- ngrok auth tokens
- GitHub client secrets
- GitHub webhook secrets
- OpenAI API keys
- generated prompt traces from private repositories

The repository includes a fake test-only PEM fixture under `apps/api/test/fixtures/test-private-key.pem`. It is intentionally generated for tests and must never be replaced with a real GitHub App key.

## Minimum GitHub App Permissions

ArchGuard should run with the smallest permission set needed for PR analysis:

- Contents: Read-only
- Pull requests: Read-only
- Checks: Read and write
- Metadata: Read-only

Required event:

- Pull request

Do not enable unrelated permissions such as Security advisory unless a future feature explicitly requires them.

## Rotation Guidance

Rotate the GitHub webhook secret if:

- it appears in terminal output
- it appears in a screenshot
- it is pasted into chat
- it is committed to git
- it is shared in an issue, PR, or document

Rotate the GitHub client secret if:

- it appears in terminal output
- it appears in a screenshot
- it is pasted into chat
- it is committed to git

Delete and regenerate the GitHub App private key if:

- a real PEM file is committed
- the key is uploaded to a public service
- the key appears in logs, screenshots, or chat
- the local machine is no longer trusted

## Logging Boundaries

ArchGuard should not log:

- private keys
- webhook secrets
- client secrets
- installation access tokens
- OpenAI API keys
- raw full diffs
- full prompts unless `DEBUG_RAG_PROMPTS=true`
- full retrieved context for private repositories

Check Run output should stay concise. It may include verdict, confidence, finding titles, file paths, line ranges, recommendations, and evidence file references. It should not dump the full prompt or full repository context.

## Local Secret Scan

Before sharing or publishing:

```bash
git status --short
git diff --cached
git ls-files | grep -E '(^|/)(\\.env|.*\\.pem)$' || true
grep -RIn --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.tmp --exclude-dir=.reports --exclude-dir=.archguard \
  -E 'OPENAI_API_KEY|GITHUB_PRIVATE_KEY|GITHUB_WEBHOOK_SECRET|GITHUB_CLIENT_SECRET|-----BEGIN (RSA )?PRIVATE KEY-----' .
```

If `gitleaks` is installed:

```bash
gitleaks detect --source . --redact
```

## Development Webhook Route

`POST /dev/github-webhook-debug` exists only for local replay and is disabled in production. It requires `x-archguard-dev-token` matching `DEV_WEBHOOK_TOKEN`.

Do not expose this route publicly as a substitute for GitHub webhook signature verification.

## Prompt Trace Safety

Debug traces are written only when:

```env
DEBUG_RAG_PROMPTS=true
```

Trace files live under `.reports/`, which is ignored by git. Do not enable prompt tracing for sensitive repositories unless logs are protected.
