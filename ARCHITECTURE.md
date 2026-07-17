# Architecture

How Interviewer MCP fits together, and why it's built the way it is. For contributor setup, see [CONTRIBUTING.md](CONTRIBUTING.md).

## The pipeline

```
 GitHub repo URL
      │
      ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ INGESTION            src/core/github.ts                     │
 │  REST API: repo meta → recursive tree → per-file contents   │
 │  filters: source extensions only, skip vendored dirs,       │
 │  lockfiles, files >100KB; cap 120 files; surfaces           │
 │  GitHub tree truncation + unfetchable files as `skipped`    │
 └──────────────┬──────────────────────────────────────────────┘
                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ CODE MAP             src/core/codemap.ts                    │
 │  regex sectioning per language family → named sections      │
 │  teaching order: entry points → most-imported → utilities   │
 └──────────────┬──────────────────────────────────────────────┘
                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ STORE                src/core/db.ts                         │
 │  one JSON file: repos · sections · interview log ·          │
 │  JD text · file cache                                       │
 │  serialized writes + atomic rename + corruption quarantine  │
 └──────────────┬──────────────────────────────────────────────┘
                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ TOOL LAYER           src/tools/register.ts · src/format.ts  │
 │  8 thin MCP tools: zod schema → guard → delegate to core    │
 │  every error carries a `hint` telling the model what to do  │
 └──────────────┬──────────────────────────────────────────────┘
                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ MODES                src/index.ts server instructions       │
 │  TEACH: list_sections → get_code_section → explain →        │
 │         user explains back → mark_covered                   │
 │  INTERVIEW: get_interview_targets → in-character probing →  │
 │         log_interview_result after every exchange           │
 │  RETURN: get_progress first → re-attack weakest sections    │
 └─────────────────────────────────────────────────────────────┘
```

## Ingestion (`src/core/github.ts`)

Three GitHub REST calls, native `fetch`, no SDK: repo metadata (default branch) → recursive git tree → file contents in parallel batches of 8.

File contents come from two routes depending on auth:

- **`GITHUB_TOKEN` set** → the **Contents API** with `Accept: application/vnd.github.raw`. This is the route that makes private repos work with *both* classic and fine-grained PATs (`raw.githubusercontent.com` does not reliably accept fine-grained tokens).
- **No token** → `raw.githubusercontent.com`, which sits outside the 60 req/hour API quota — so an unauthenticated 120-file public ingest can't exhaust it.

Failure discipline: rate limiting (403/429) aborts the ingest loudly with a set-a-token hint; any other per-file failure records the path in `skipped` — files are never dropped silently. GitHub's tree `truncated` flag (huge repos) is passed through and surfaced as a `warning` in the `ingest_repo` result.

## Code map (`src/core/codemap.ts`)

Splits each file into sections — one top-level function/class per section, plus a "module top-level" preamble — using per-language-family regexes (JS/TS, Python, Go, Java/C#/Kotlin). Unknown languages fall back to fixed-size chunks, so every file is always teachable.

Teaching order is a three-key sort: entry-point score (`main`/`index`/`app`/`server`/`cli` stems, shallower paths win) → inbound-import count (rough, stem-based) → path. The intent: a learner meets the program the way execution does — entry point first, core logic next, leaf utilities last.

Deliberately regex-based, not AST-based: it covers the shapes that dominate real student/portfolio repos with zero native dependencies. Section boundaries only need to be good enough to *teach* — they don't need compiler fidelity. tree-sitter is the roadmap upgrade.

## Store (`src/core/db.ts`)

One JSON document at `~/.interviewer-mcp/store.json` (`INTERVIEWER_DATA_DIR` overrides):

```jsonc
{
  "repos":           { "<owner>/<repo>": { branch, languages, dependencies, ... } },
  "sections":        { "<owner>/<repo>#<path>:<name>@<line>": { covered, weaknessScore, ... } },
  "interviewLog":    [ { repoId, sectionId, question, performance, notes, createdAt } ],
  "jobDescriptions": { "<owner>/<repo>": "COMPANY... JOB DESCRIPTION... CV..." },
  "fileCache":       { "<owner>/<repo>:<path>": "file contents" }
}
```

**Why JSON, not SQLite:** no native modules means `npx interviewer-mcp` works on every OS with no build toolchain, and data volume is small (a handful of repos). The costs are managed explicitly:

- **Concurrency** — the MCP SDK dispatches tool handlers concurrently; all read-modify-write cycles are serialized through a promise-chain lock (parallel writes corrupted the store in testing before this existed).
- **Atomicity** — writes go to a unique temp file then `rename`, so a killed process can't leave a half-written store.
- **Corruption** — an unparseable store is quarantined to `store.json.corrupt-<ts>` and the server starts fresh instead of bricking every future session.
- **Bloat** — JD/CV text is capped at 20k chars, ingest caps at 120 files × 100KB.

Repo ids are lowercased at parse time — GitHub treats `Owner/Repo` and `owner/repo` as the same repo, so the store does too.

## Mastery model

Every interview exchange is logged with a performance grade; grades move the targeted section's `weaknessScore`:

| performance | delta |
|---|---|
| `weak` | +1.0 |
| `okay` | +0.25 |
| `strong` | −0.5 (floored at 0) |

`get_interview_targets` sorts weakness-first, so past struggles outrank fresh heuristic finds; `get_progress` exposes the five weakest sections plus the most recent weak answers verbatim. **Re-ingesting preserves history**: matching section ids keep their covered/weakness state, and the interview log is never deleted — refreshing the code doesn't lobotomize the interviewer.

Interview targets themselves come from `src/core/targets.ts`: ten heuristics for what real interviewers probe (network calls, auth/secrets, raw SQL, concurrency, error handling, state/caching, env/config access, TODOs, long sections, dense uncommented logic).

## Tool layer (`src/tools/register.ts`, `src/format.ts`)

Deliberately thin: zod schema → precondition guards → delegate to core → shape the JSON reply. Two conventions carry the UX:

- **Every error includes a `hint`** — machine-actionable next steps ("call ingest_repo first", "set GITHUB_TOKEN"), because the consumer of these errors is a model choosing its next tool call.
- **Long tool descriptions are intentional** — they are prompt engineering. When-to-call and when-NOT-to-call live in the description because that's what the client shows the model.

Core (`src/core/`) never imports MCP types; it's pure functions, which is where all the tests point.

## The Skill variant (`SKILL.md`)

The same curriculum ships as a standalone Claude Skill for claude.ai, where no MCP server or local store exists. It clones the repo into the sandbox per session and recalls prior sessions via conversation search. Same phases and teaching format; the difference is memory durability — the MCP store makes "it remembered" a hard guarantee, the Skill makes it best-effort. The two share no code; SKILL.md is prompt-only by design.
