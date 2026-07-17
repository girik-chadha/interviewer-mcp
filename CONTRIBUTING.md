# Contributing to Interviewer MCP

Thanks for the interest! The codebase is intentionally small and readable.

## Setup

Requires Node >= 20.

```bash
git clone https://github.com/girik-chadha/interviewer-mcp
cd interviewer-mcp
npm install
npm test        # vitest — core logic + mocked GitHub fetch paths
npm run build   # tsc → dist/
```

To run your local build against a real client: `claude mcp add interviewer-dev -- node /abs/path/to/dist/index.js`.

## Where things live

All logic is in `src/core/` as pure, MCP-free functions — that's where tests point and where most contributions land. `src/tools/register.ts` is a thin wrapper layer; only touch it when adding or changing a tool's schema or description. [ARCHITECTURE.md](ARCHITECTURE.md) has the full map and the reasoning behind the design decisions.

## Guidelines

- New interview heuristics for `targets.ts` are very welcome — include a test showing what code pattern they catch
- New language support goes in `codemap.ts` `DECLARATION_PATTERNS` — include a sectioning test
- Every tool error must include a `hint` telling the model what to do next
- Tool descriptions are prompt engineering: write when-to-use and when-NOT-to-use, not just what it does
- Keep zero native dependencies — `npx interviewer-mcp` must work without build tooling on every OS
- Network code gets tested with a mocked `fetch` (see `__tests__/github-fetch.test.ts`) — no live GitHub calls in the suite

## Before opening a PR

`npm run build && npm test` must pass. Describe the user-visible behavior change in one sentence at the top of the PR.

## Releasing (maintainers)

The version lives in two places — `package.json` and the `McpServer` constructor in `src/index.ts` — bump both, add a dated CHANGELOG entry, then `npm publish` (`prepublishOnly` builds automatically).
