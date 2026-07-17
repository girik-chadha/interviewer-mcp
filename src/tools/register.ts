/**
 * Tool registration. Thin layer only: zod schemas, guards, delegation to core.
 * Long descriptions are intentional — they are what teaches the model when
 * and how to use each tool.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, fail, guarded } from "../format.js";
import { fetchRepo, parseRepoUrl } from "../core/github.js";
import { buildCodeMap } from "../core/codemap.js";
import { detectTargets } from "../core/targets.js";
import * as db from "../core/db.js";
import type { Performance } from "../types.js";

const INGEST_HINT =
  "If this is a rate-limit error, add GITHUB_TOKEN to the MCP server env config. If 404, check the repo URL/branch.";

function languageBreakdown(files: Record<string, string>): Record<string, number> {
  const langs: Record<string, number> = {};
  for (const p of Object.keys(files)) {
    const ext = p.toLowerCase().split(".").pop() ?? "?";
    langs[ext] = (langs[ext] ?? 0) + 1;
  }
  return langs;
}

export function registerTools(server: McpServer): void {
  server.registerTool(
    "ingest_repo",
    {
      title: "Ingest Repository",
      description:
        "Fetch and index a GitHub repository so it can be taught and interviewed. " +
        "Call this FIRST whenever the user provides a repo URL or asks to prep a repo that has not been ingested yet. " +
        "Builds a code map (sections in a suggested teaching order) and caches file contents locally. " +
        "Returns the repo summary and the first few sections — NOT full code; use get_code_section to pull code. " +
        "Safe to call again on the same repo: it refreshes the code while preserving the user's progress and weakness history.",
      inputSchema: {
        repo_url: z
          .string()
          .describe("GitHub repo URL (https://github.com/owner/repo) or shorthand owner/repo"),
        branch: z.string().optional().describe("Branch to ingest; defaults to the repo's default branch"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guarded(async ({ repo_url, branch }) => {
      const fetched = await fetchRepo(repo_url, branch);
      const repoId = `${fetched.ref.owner}/${fetched.ref.repo}`;
      const sections = buildCodeMap(repoId, fetched.files);

      await db.upsertRepo(
        {
          id: repoId,
          url: `https://github.com/${repoId}`,
          branch: fetched.branch,
          ingestedAt: new Date().toISOString(),
          languages: languageBreakdown(fetched.files),
          fileCount: Object.keys(fetched.files).length,
          readmeExcerpt: fetched.readme,
          dependencies: fetched.dependencies,
        },
        sections,
        fetched.files,
      );

      return ok({
        repo: repoId,
        branch: fetched.branch,
        files_indexed: Object.keys(fetched.files).length,
        files_skipped: fetched.skipped.length,
        ...(fetched.truncated
          ? {
              warning:
                "GitHub truncated the file listing for this repo (it is very large) — some files were never seen and could not be indexed. Teaching will cover the indexed files only.",
            }
          : {}),
        sections: sections.length,
        languages: languageBreakdown(fetched.files),
        dependencies: fetched.dependencies.slice(0, 30),
        readme_excerpt: fetched.readme,
        first_sections: sections.slice(0, 5).map((s) => ({ id: s.id, file: s.file, name: s.name })),
        next_step:
          "Call get_progress to check prior history, then list_sections and start teaching with get_code_section.",
      });
    }, INGEST_HINT),
  );

  server.registerTool(
    "list_sections",
    {
      title: "List Sections",
      description:
        "List all sections of an ingested repo in the suggested teaching order, with covered status and weakness scores. " +
        "Use this to decide what to teach next (first uncovered section) or what to re-attack in an interview (highest weakness_score). " +
        "Returns metadata only, never code — keep context small and pull code per-section with get_code_section.",
      inputSchema: {
        repo: z.string().describe("Repo id in owner/repo form, as returned by ingest_repo"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded(async ({ repo }) => {
      const repoId = normalizeRepoId(repo);
      const sections = await db.sectionsForRepo(repoId);
      if (sections.length === 0) {
        const ingested = await db.getRepo(repoId);
        if (ingested) {
          return fail(
            `"${repoId}" was ingested but produced 0 sections — it may contain no recognized source files.`,
            "Check the repo has source code (not just docs/assets), or try a different branch via ingest_repo.",
          );
        }
        return fail(
          `No sections found for "${repoId}".`,
          "The repo has not been ingested yet — call ingest_repo with its URL first.",
        );
      }
      return ok({
        repo: repoId,
        total: sections.length,
        covered: sections.filter((s) => s.covered).length,
        sections: sections.map((s) => ({
          id: s.id,
          file: s.file,
          name: s.name,
          lines: `${s.startLine}-${s.endLine}`,
          covered: s.covered,
          weakness_score: s.weaknessScore,
        })),
      });
    }),
  );

  server.registerTool(
    "get_code_section",
    {
      title: "Get Code Section",
      description:
        "Fetch the actual code for one section, plus its file context (imports at the top of the file). " +
        "Use during TEACH mode to walk the user through their code one section at a time, and during INTERVIEW mode " +
        "to ground questions in the real code. After the user demonstrates understanding of a section in teach mode, " +
        "call mark_covered — this tool does not mark automatically.",
      inputSchema: {
        repo: z.string().describe("Repo id in owner/repo form"),
        section_id: z.string().describe("Section id from list_sections or ingest_repo"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded(async ({ repo, section_id }) => {
      const repoId = normalizeRepoId(repo);
      const section = await db.getSection(section_id);
      if (!section || section.repoId !== repoId) {
        return fail(
          `Section "${section_id}" not found in "${repoId}".`,
          "Call list_sections to get valid section ids; ids change if the repo was re-ingested.",
        );
      }
      const content = await db.getFileContent(repoId, section.file);
      if (!content) {
        return fail(
          `File "${section.file}" is not in the local cache.`,
          "Re-run ingest_repo to refresh the cache.",
        );
      }
      const lines = content.split("\n");
      const code = lines.slice(section.startLine - 1, section.endLine).join("\n");
      const fileImports = lines
        .slice(0, Math.min(lines.length, 30))
        .filter((l) => /^\s*(import|from|require|using|#include)\b/.test(l))
        .join("\n");

      return ok({
        section: { id: section.id, file: section.file, name: section.name, lines: `${section.startLine}-${section.endLine}` },
        file_imports: fileImports || null,
        code,
        covered: section.covered,
        weakness_score: section.weaknessScore,
      });
    }),
  );

  server.registerTool(
    "mark_covered",
    {
      title: "Mark Section Covered",
      description:
        "Mark a section as covered in teach mode. Call this ONLY after the user has explained the section back " +
        "in their own words or answered a comprehension question about it correctly — not merely after showing them the code.",
      inputSchema: {
        repo: z.string().describe("Repo id in owner/repo form"),
        section_id: z.string().describe("Section id to mark as covered"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    guarded(async ({ repo, section_id }) => {
      const section = await db.markCovered(section_id);
      if (!section || section.repoId !== normalizeRepoId(repo)) {
        return fail(`Section "${section_id}" not found.`, "Call list_sections for valid ids.");
      }
      const all = await db.sectionsForRepo(section.repoId);
      const remaining = all.filter((s) => !s.covered);
      return ok({
        marked: section.id,
        covered_count: all.length - remaining.length,
        total: all.length,
        next_uncovered: remaining[0] ? { id: remaining[0].id, file: remaining[0].file, name: remaining[0].name } : null,
      });
    }),
  );

  server.registerTool(
    "get_interview_targets",
    {
      title: "Get Interview Targets",
      description:
        "Get the most probe-worthy parts of the repo for a mock interview: external API calls, auth/secrets handling, " +
        "raw SQL, concurrency, long uncommented functions, leftover TODOs — plus any sections the user previously " +
        "performed poorly on (weakness_score > 0 comes first). Call this at the START of every interview session " +
        "and build questions from the returned reasons. Use focus='weak_spots' on returning users to re-attack past struggles.",
      inputSchema: {
        repo: z.string().describe("Repo id in owner/repo form"),
        focus: z
          .enum(["all", "weak_spots", "design_decisions"])
          .optional()
          .describe(
            "all (default): every target. weak_spots: only sections with prior weak performance. design_decisions: only heuristic-detected probe points.",
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded(async ({ repo, focus }) => {
      const repoId = normalizeRepoId(repo);
      const sections = await db.sectionsForRepo(repoId);
      if (sections.length === 0) {
        return fail(`"${repoId}" has not been ingested.`, "Call ingest_repo first.");
      }
      const store = await Promise.all(
        sections.map(async (s) => ({ s, code: (await db.getFileContent(repoId, s.file)) ?? "" })),
      );
      const codeBySection = new Map(store.map(({ s, code }) => {
        const lines = code.split("\n").slice(s.startLine - 1, s.endLine).join("\n");
        return [s.id, lines];
      }));

      let targets = detectTargets(sections, (s) => codeBySection.get(s.id) ?? "");
      if (focus === "weak_spots") targets = targets.filter((t) => t.weaknessScore > 0);
      if (focus === "design_decisions") targets = targets.filter((t) => t.weaknessScore === 0);

      const repoRecord = await db.getRepo(repoId);
      const jd = await db.getJobDescription(repoId);
      return ok({
        repo: repoId,
        job_description_excerpt: jd ? jd.slice(0, 800) : null,
        dependencies_to_probe: repoRecord?.dependencies.slice(0, 15) ?? [],
        targets: targets.slice(0, 20),
        interviewer_note:
          "Ask WHY questions about these (why this library, why this structure, what breaks under failure), " +
          "not just WHAT questions. Log every exchange with log_interview_result.",
      });
    }),
  );

  server.registerTool(
    "log_interview_result",
    {
      title: "Log Interview Result",
      description:
        "Record one interview question and how the user performed. Call this after EVERY question-answer exchange " +
        "in a mock interview — this is what powers cross-session memory of weaknesses. " +
        "performance: 'strong' (clear, correct, justified), 'okay' (mostly right, some gaps), 'weak' (couldn't explain or wrong). " +
        "Include the specific gap in notes when performance is weak or okay, e.g. 'could not explain why JWT is verified server-side'.",
      inputSchema: {
        repo: z.string().describe("Repo id in owner/repo form"),
        question: z.string().describe("The interview question that was asked"),
        performance: z.enum(["strong", "okay", "weak"]).describe("How the user performed on this question"),
        section_id: z
          .string()
          .optional()
          .describe("Section this question targeted, if any — weak performance raises its weakness_score"),
        notes: z.string().optional().describe("Specific gap or strength observed; be concrete"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    guarded(async ({ repo, question, performance, section_id, notes }) => {
      const repoId = normalizeRepoId(repo);
      await db.logInterview({
        repoId,
        sectionId: section_id ?? null,
        question,
        performance: performance as Performance,
        notes: notes ?? null,
        createdAt: new Date().toISOString(),
      });
      return ok({ logged: true, repo: repoId, performance });
    }),
  );

  server.registerTool(
    "set_job_description",
    {
      title: "Set Job Description",
      description:
        "Store the prep context: job description, and optionally company name and CV text, tied to a repo. " +
        "Call this when the user pastes or describes any of them. Once set, use it throughout: in teach mode, point out where the code demonstrates " +
        "JD-required skills; in interview mode, probe JD-required concepts the repo does NOT demonstrate " +
        "(e.g. 'the JD requires Docker and your repo has no containerization — how would you containerize this app?'). " +
        "The JD is returned by get_progress so returning sessions stay JD-aware.",
      inputSchema: {
        repo: z.string().describe("Repo id in owner/repo form this JD applies to"),
        job_description: z.string().describe("The full job description text, or the user's summary of the role"),
        company: z.string().optional().describe("Company name, for company-specific briefing and question style"),
        cv_text: z.string().optional().describe("The candidate's CV/resume text — every claimed skill becomes bootcamp + interview material"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    guarded(async ({ repo, job_description, company, cv_text }) => {
      const repoId = normalizeRepoId(repo);
      const repoRecord = await db.getRepo(repoId);
      if (!repoRecord) {
        return fail(`"${repoId}" has not been ingested.`, "Call ingest_repo first, then set the job description.");
      }
      const combined = [
        company ? `COMPANY: ${company}` : null,
        `JOB DESCRIPTION:\n${job_description}`,
        cv_text ? `CANDIDATE CV:\n${cv_text}` : null,
      ].filter(Boolean).join("\n\n");
      await db.setJobDescription(repoId, combined);
      return ok({
        saved: true,
        repo: repoId,
        ...(combined.length > db.MAX_JD_CHARS
          ? { truncated: `Input exceeded ${db.MAX_JD_CHARS} chars; only the first ${db.MAX_JD_CHARS} were stored.` }
          : {}),
        next_step:
          "Weave this JD into teaching and interviewing: highlight where the repo demonstrates JD skills, and probe the gaps it doesn't cover.",
      });
    }),
  );

  server.registerTool(
    "get_progress",
    {
      title: "Get Progress",
      description:
        "Get the user's full learning state for a repo: coverage %, session history, top weaknesses with notes, and " +
        "recent interview performance. Call this FIRST at the start of any returning session ('let's continue', " +
        "'test me again', 'where were we') so you can resume from weak spots instead of starting over. " +
        "Also call it to generate the strengths/weaknesses summary after an interview.",
      inputSchema: {
        repo: z.string().describe("Repo id in owner/repo form"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded(async ({ repo }) => {
      const repoId = normalizeRepoId(repo);
      const repoRecord = await db.getRepo(repoId);
      if (!repoRecord) {
        return fail(`"${repoId}" has not been ingested.`, "Call ingest_repo with the repo URL first.");
      }
      const sections = await db.sectionsForRepo(repoId);
      const log = await db.interviewLogForRepo(repoId);
      const weakest = [...sections]
        .filter((s) => s.weaknessScore > 0)
        .sort((a, b) => b.weaknessScore - a.weaknessScore)
        .slice(0, 5);

      const perfCounts = { strong: 0, okay: 0, weak: 0 };
      for (const e of log) perfCounts[e.performance]++;

      const jd = await db.getJobDescription(repoId);
      return ok({
        repo: repoId,
        ingested_at: repoRecord.ingestedAt,
        job_description: jd ? jd.slice(0, 1500) : null,
        coverage: {
          covered: sections.filter((s) => s.covered).length,
          total: sections.length,
          percent: sections.length
            ? Math.round((sections.filter((s) => s.covered).length / sections.length) * 100)
            : 0,
        },
        interview_history: {
          questions_answered: log.length,
          performance: perfCounts,
          recent_weak_answers: log
            .filter((e) => e.performance === "weak")
            .slice(-5)
            .map((e) => ({ question: e.question, notes: e.notes, when: e.createdAt })),
        },
        weakest_sections: weakest.map((s) => ({
          id: s.id,
          file: s.file,
          name: s.name,
          weakness_score: s.weaknessScore,
        })),
        next_uncovered: sections.find((s) => !s.covered)
          ? { id: sections.find((s) => !s.covered)!.id, file: sections.find((s) => !s.covered)!.file }
          : null,
      });
    }),
  );
}

function normalizeRepoId(input: string): string {
  try {
    const ref = parseRepoUrl(input);
    return `${ref.owner}/${ref.repo}`;
  } catch {
    return input;
  }
}
