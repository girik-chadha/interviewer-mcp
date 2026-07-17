# Interviewer MCP — Setup Guide (for AI agents)

This file is a step-by-step guide for Claude Code (or any LLM agent) to install and configure the Interviewer MCP server. If a user asks you to install or set up this project, follow these steps exactly.

## Step 1 — Verify Node.js

```bash
node --version
```

Requires Node 20+. If missing or older, tell the user to install Node from https://nodejs.org before continuing.

## Step 2 — Add the server to MCP config

No cloning needed — the server runs via npx.

For Claude Code, prefer the CLI:

```bash
claude mcp add interviewer -- npx -y interviewer-mcp
```

For Claude Desktop (or manual config editing), merge this entry into the existing `mcpServers` object (do not overwrite other servers):

```json
{
  "mcpServers": {
    "interviewer": {
      "command": "npx",
      "args": ["-y", "interviewer-mcp"]
    }
  }
}
```

## Step 3 — Optional: GitHub token

Ask the user if they want to add a GitHub token. It is optional (public repos work without it) but recommended: it raises the GitHub API limit from 60 to 5,000 requests/hour and enables private repos.

If yes, they can create one at https://github.com/settings/tokens — both classic and fine-grained tokens work; a fine-grained token with read-only Contents permission is enough and is the safer choice. Add it to the server env (or via `claude mcp add interviewer --env GITHUB_TOKEN=<token> -- npx -y interviewer-mcp`):

```json
"interviewer": {
  "command": "npx",
  "args": ["-y", "interviewer-mcp"],
  "env": { "GITHUB_TOKEN": "<their token>" }
}
```

Never echo the token back in conversation after it is saved.

## Step 4 — Restart and verify

The MCP server only loads when the client starts. After editing the config, tell the user to restart Claude Code / Claude Desktop.

Then verify by calling the `get_progress` tool with any repo id (e.g. `octocat/hello-world`). Expected result: an error object with `hint: "Call ingest_repo with the repo URL first."` — that error confirms the server is connected and responding.

## Step 5 — First run

Ask the user for a GitHub repo they want to prep, then:

1. Call `ingest_repo` with the URL
2. Call `get_progress` to check for prior history
3. Begin teach mode as described in the server instructions

## Troubleshooting

- **`npx` hangs on first run** — it is downloading the package; give it 30 seconds.
- **Rate limit errors on ingest** — set `GITHUB_TOKEN` (Step 3).
- **404 on ingest** — repo is private (needs token) or the URL/branch is wrong.
- **Data location** — progress is stored in `~/.interviewer-mcp/store.json`; override with the `INTERVIEWER_DATA_DIR` env var.
