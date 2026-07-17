# Security Policy

## Supported versions

Only the latest published release on npm receives security fixes.

## Reporting a vulnerability

Please report vulnerabilities privately via [GitHub Security Advisories](https://github.com/girik-chadha/interviewer-mcp/security/advisories/new) — do not open a public issue. You can expect an acknowledgement within a few days.

## Security model

- **Runs locally.** The server is a local stdio process; it opens no ports and talks to exactly one external service: the GitHub API.
- **Your data stays on your machine.** Repo contents, interview history, and any JD/CV text you store live in `~/.interviewer-mcp/store.json` (or `INTERVIEWER_DATA_DIR`). Nothing is sent anywhere except the GitHub fetches you initiate. Note that the store is plain JSON on disk — don't paste secrets into a job description or CV.
- **Token handling.** `GITHUB_TOKEN` is read from the environment, sent only to `api.github.com` / `raw.githubusercontent.com` over HTTPS, and never written to disk or logged. A read-only fine-grained token with Contents permission is sufficient and recommended.
- **Ingested code is data, not instructions.** Repo contents are cached and displayed for teaching; treat any repo you ingest as untrusted text.
