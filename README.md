# Interviewer MCP

**A technical interviewer that has actually read your repos — teaches you your own code, drills you on it, and remembers every answer you flubbed.**

<p>
  <a href="https://github.com/girikchadha24/interviewer-mcp/actions/workflows/ci.yml"><img src="https://github.com/girikchadha24/interviewer-mcp/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/interviewer-mcp"><img src="https://img.shields.io/npm/v/interviewer-mcp.svg" alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg" alt="Node >=20">
</p>

<!-- mcp-name: io.github.girikchadha24/interviewer-mcp -->

[Install](#get-started-60-seconds) · [Demo](#what-a-session-looks-like) · [Tools](#tools-8) · [Architecture](ARCHITECTURE.md) · [llms.txt](llms.txt)

<sub><b>AI agents / LLMs:</b> read <a href="llms.txt"><code>/llms.txt</code></a> for a machine-readable index of this project.</sub>

---

Interviewers ask about *your* projects: why this library, what happens when this request fails, walk me through the auth flow. LeetCode can't prep you for that, and a plain chat session forgets everything between sessions. Interviewer MCP indexes your GitHub repo into a teachable code map, walks you through it Socratically, mock-interviews you in character — and keeps a persistent, per-section record of what you couldn't explain, so the next session re-attacks exactly those spots. It teaches **and** tests, and the test gets smarter every time. Not a stateless quiz.

> "Walk me through this function." Every candidate has frozen on that question about code they wrote months ago — or that AI wrote for them. This makes sure it never happens in the real interview.

## What a session looks like

<!-- DEMO GIF: record ~30s — ingest → one teach section → "interview me" → a weak answer →
     return session opening with "last time you couldn't explain…". Then replace or augment
     the transcript below with: <img src="demo.gif" width="820"> -->

```text
You     Test me again on soundofspace — last week went badly.

Claude  [get_progress] Welcome back. Coverage: 9/14 sections. Three questions
        logged weak, the worst: "why is the JWT verified server-side?"
        Let's start exactly there. [get_code_section auth.ts:verifyToken]

        Here's your own code. Line 12 verifies the signature before touching
        the payload. Why can't the client just send the decoded claims?

You     Because... the client could edit them?

Claude  Right instinct — be precise. What stops an attacker who edits the
        payload AND re-signs it? Where does the signing secret live?

        [log_interview_result: okay — "knows tampering risk, fuzzy on
         why the secret never leaves the server"]
```

## Get started (60 seconds)

Two ways to run it — pick per surface:

### Option A — MCP server (Claude Code / Claude Desktop) — full experience

```bash
claude mcp add interviewer -- npx -y interviewer-mcp

# optional: private repos + 5,000 req/hr instead of 60
claude mcp add interviewer --env GITHUB_TOKEN=github_pat_... -- npx -y interviewer-mcp
```

Claude Desktop — add to the config file instead:

```json
{
  "mcpServers": {
    "interviewer": {
      "command": "npx",
      "args": ["-y", "interviewer-mcp"],
      "env": { "GITHUB_TOKEN": "github_pat_optional_but_recommended" }
    }
  }
}
```

Both classic and fine-grained tokens work (read-only **Contents** permission is enough). Then:

> Prep me for my interview — my repo is github.com/you/your-project

Agent-driven install: point Claude at [SETUP_GUIDE.md](SETUP_GUIDE.md) and it configures everything itself.

### Option B — Claude Skill (claude.ai, no install)

1. Grab [`SKILL.md`](SKILL.md), put it in a folder named `interview-prepper/`, zip the folder
2. claude.ai → **Settings → Capabilities → Skills → Upload skill**
3. Say: *"prep me for my interview on github.com/you/your-project"*

**The honest difference:** the MCP server keeps a durable local database of your coverage and weak spots — return in three weeks and it remembers. The Skill runs entirely inside claude.ai: it clones your repo per session and recalls prior sessions via conversation search, which is best-effort, not guaranteed. Same curriculum and teaching format either way; the MCP path is the one that makes "it remembered" a hard promise.

## Features

- **Per-repo ingestion** — fetches any GitHub repo via the REST API (no clone needed), filters to real source files, splits them into teachable sections, and orders them: entry points → most-imported core logic → utilities. Warns instead of silently truncating on huge repos.
- **Teaching mode** — one section per exchange, code always shown first, block-by-block *what and why*, ending with "an interviewer would ask…" — and a section only counts as covered after **you** explain it back.
- **Mock interview mode** — Claude stays in character, grounding every question in your actual lines: *"Why Supabase over Firebase?" "This fetch has no timeout — what happens at 2am?"* Probe targets are auto-detected: external API calls, auth/secrets handling, raw SQL, concurrency, leftover TODOs, long uncommented functions.
- **Job-description targeting** — store the JD, company, and your CV once; teaching then flags "this section is your evidence for the REST-APIs requirement," and interviews probe the JD skills your repo *doesn't* demonstrate.
- **Mastery tracking** — every answer is scored strong/okay/weak with a concrete note. Scores raise per-section weakness; strong answers decay it. All of it persists in `~/.interviewer-mcp/` and every returning session opens from your weakest point.

## The curriculum — you steer

Five phases, picked in your order from a menu: **① company briefing** → **② concept bootcamp** (JD ∪ CV ∪ repo stack) → **③ code deep-dive** → **④ mock interview** → **⑤ debrief**.

```
ingest_repo ──▶ briefing ──▶ bootcamp ──▶ code deep-dive ──▶ mock interview ──▶ debrief
                    ▲                                │
                    └──── "test me again" (days later)
                          the interviewer REMEMBERS ◀┘
```

## Tools (8)

| Tool | What it does |
|---|---|
| `ingest_repo` | Fetch + index a GitHub repo into a teachable code map |
| `list_sections` | Sections in teaching order, with covered status + weakness scores |
| `get_code_section` | One section's code with file context |
| `mark_covered` | Mark a section learned (only after you explain it back) |
| `get_interview_targets` | Probe-worthy code, weakest spots first |
| `log_interview_result` | Score an answer; powers cross-session memory |
| `set_job_description` | Store JD + company + CV; powers briefing, bootcamp, and gap questions |
| `get_progress` | Coverage, history, top weaknesses — the "welcome back" tool |

## When to use · When to skip

**Great fit if you…**
- have an interview where your projects/portfolio will come up
- shipped fast (hackathons, AI-assisted) and need to *own* every line
- want targeted revision of your weak spots instead of re-reading the whole repo

**Skip it if you…**
- need algorithm/DSA drilling — that's LeetCode's muscle, not this
- want generic behavioral prep with no codebase involved

## How it works

Local-first and dependency-light by design: plain TypeScript, native `fetch`, and a JSON store — no native modules, so `npx interviewer-mcp` boots on every OS with zero build tooling. Your code cache and interview history live in `~/.interviewer-mcp/` (override with `INTERVIEWER_DATA_DIR`) and never leave your machine; the only network calls are to GitHub. Sectioning is regex-based per language family (JS/TS, Python, Go, Java/C#/Kotlin) with chunking fallback — tree-sitter AST parsing is on the roadmap.

Full pipeline, store layout, and design-decision rationale: **[ARCHITECTURE.md](ARCHITECTURE.md)**.

## Roadmap

- [ ] tree-sitter AST parsing for exact section boundaries
- [ ] multi-repo interviews ("you use pgvector in two projects — compare the schemas")
- [ ] spaced-repetition scheduling of weak sections

## Contributing & security

PRs welcome — the core is small, pure, and tested (`npm install && npm test`). See [CONTRIBUTING.md](CONTRIBUTING.md). Vulnerabilities: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Girik Chadha
