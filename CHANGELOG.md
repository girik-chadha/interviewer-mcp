# Changelog

## 0.4.0 — 2026-07-17

Public-release hardening. No changes to teaching, interviewing, or mastery-tracking behavior.

**Reliability**
- Authenticated file fetches now use the GitHub Contents API (`Accept: application/vnd.github.raw`) instead of `raw.githubusercontent.com` — private repos now work with fine-grained PATs, not just classic tokens. Unauthenticated fetches still use the raw host, which sits outside the 60 req/hr API quota.
- Files that fail to fetch are recorded in `files_skipped` instead of vanishing silently; rate limiting mid-ingest aborts loudly with the set-a-token hint.
- Huge repos: GitHub's tree-truncation flag is surfaced as a `warning` in the `ingest_repo` result.
- `owner/repo` ids are now case-insensitive, matching GitHub's behavior.
- `set_job_description` input is capped at 20k chars; truncation is reported in the response.

**Packaging & tooling**
- `package.json` is publish-ready: author, repository/homepage/bugs, registry `mcpName` (`io.github.girik-chadha/interviewer-mcp`).
- Node >= 20 (18 is EOL); CI matrix now 20/22/24. vitest 4 (clears all `npm audit` findings). Regenerated lockfile fixes `npm ci`.

**Docs**
- New ARCHITECTURE.md, SECURITY.md, llms.txt. README rewritten: both install paths (MCP server and claude.ai Skill) side by side, demo transcript, honest MCP-vs-Skill memory comparison.

## 0.3.0

- Restructured as a 5-phase user-steered curriculum: company briefing → concept bootcamp → code deep-dive → mock interview → debrief. A numbered prep menu is presented at start and every transition.
- `set_job_description` extended with optional `company` and `cv_text` — CV skills become bootcamp and interview material.
- Section headers must name repo + file; running progress shown per section.

## 0.2.0

- Mandatory deep-teaching format in server instructions: show code, block-by-block walkthrough, interviewer-lens callout, explain-back checkpoint. One-line summaries are explicitly a failure mode.
- New tool `set_job_description`: store the JD per repo; surfaced in `get_progress` and `get_interview_targets` for gap-based questioning.

## 0.1.0

Initial release.

- `ingest_repo`: GitHub fetch + code map with teaching order (entry points → most-imported → utilities)
- Teach mode: `list_sections`, `get_code_section`, `mark_covered`
- Interview mode: `get_interview_targets` (8 probe heuristics + weakness-first ranking), `log_interview_result`
- Cross-session memory: `get_progress`, weakness scoring that decays on strong answers, re-ingest preserves history
- Zero native deps; JSON store at `~/.interviewer-mcp/`
