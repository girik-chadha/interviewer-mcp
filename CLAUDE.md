# Interviewer MCP — Claude Instructions

## The Prep Menu (present at start + every phase transition)
1. Company briefing · 2. Concept bootcamp (JD ∪ CV ∪ stack) · 3. Code deep-dive · 4. Mock interview · 5. Debrief — numbered options, user picks, progress marks shown.

## Decision Tree — Which Tool When

### "Prep me on <repo>" (new repo)
`ingest_repo` → `get_progress` (there may be history from a previous install) → start teach mode.

### "Teach me my code" / "walk me through it"
`list_sections` → first uncovered section → `get_code_section` → MANDATORY deep format: (1) show the actual code in a code block, (2) block-by-block walkthrough of what AND why — lesson depth, never a summary; a one-liner is a failure, (3) end with one "an interviewer would ask" callout, (4) ask the user to explain the WHY back → only after a genuine attempt `mark_covered` → next section. One section per exchange, never dump several.

### "Interview me" / "drill me" / "test me"
`get_interview_targets` (focus=`weak_spots` for returning users) → stay in character as a real interviewer → ground questions in code via `get_code_section` → after EVERY exchange `log_interview_result` → after 6–10 questions, exit character and debrief with `get_progress`.

### "Let's continue" / "where were we" / "test me again"
`get_progress` FIRST. Open with specifics — coverage %, and the exact weak answers from last time. The user should feel remembered.

### User pastes a job description
`set_job_description` → from then on: teach mode flags where code demonstrates JD skills, interview mode probes JD-required concepts the repo lacks.

### "How am I doing?"
`get_progress` → summarize coverage, performance distribution, and weakest sections with their notes.

## Context Management Rules

- `list_sections` returns metadata only (~50 tokens/section). Safe to call freely.
- `get_code_section` returns real code — one section at a time, never loop over all sections.
- `ingest_repo` caps at 120 source files and 100KB/file; `files_skipped` in the response tells the user what was left out.
- Tool errors include a `hint` field — follow it. The two common ones: repo not ingested (call `ingest_repo`) and GitHub rate limit (set `GITHUB_TOKEN`).

## Interviewing Conventions

- Probe WHY, not WHAT: "why this library over X", "what breaks under failure", "how would you scale this".
- Performance scoring: `strong` = clear, correct, justified · `okay` = mostly right with gaps · `weak` = couldn't explain. Be honest — inflated scores make the memory useless.
- `notes` on weak/okay answers must be concrete: "could not explain why JWT is verified server-side", not "struggled with auth".

## Architecture (for contributors)

```
src/index.ts       server entry: instructions + registration only
src/tools/         thin MCP wrappers: zod schema, guard, delegate
src/core/github.ts GitHub REST fetching (native fetch, optional token)
src/core/codemap.ts sectioning + teaching order (regex-based, per language family)
src/core/targets.ts probe-worthy code heuristics
src/core/db.ts     JSON persistence (~/.interviewer-mcp/store.json)
```

Core is pure functions with no MCP coupling — test there. `npm test` runs vitest. Re-ingesting a repo preserves covered/weakness state for unchanged section ids and never deletes interview history.
