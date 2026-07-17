/**
 * Interview target detection.
 *
 * Scans each section's code for the things real interviewers probe:
 * external calls, auth/secrets, error handling (or its absence),
 * concurrency, raw SQL, suspiciously long functions, and leftover TODOs.
 */

import type { InterviewTarget, Section } from "../types.js";

interface Heuristic {
  reason: string;
  test: (code: string) => boolean;
}

const LONG_SECTION_LINES = 50;

const HEURISTICS: Heuristic[] = [
  {
    reason: "external API / network call — expect 'what happens if this fails or times out?'",
    test: (c) => /\b(fetch|axios|requests\.(get|post|put|delete)|http\.request|urllib|got\()/i.test(c),
  },
  {
    reason: "auth / secrets handling — expect questions on token storage, expiry, and leakage",
    test: (c) => /\b(jwt|token|auth|password|secret|api[_-]?key|bearer|session)\b/i.test(c),
  },
  {
    reason: "environment/config access — expect 'how is this deployed and configured?'",
    test: (c) => /\b(process\.env|os\.environ|dotenv|getenv)\b/.test(c),
  },
  {
    reason: "raw SQL / query building — expect injection and indexing questions",
    test: (c) => /\b(SELECT\s+.+\s+FROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i.test(c),
  },
  {
    reason: "explicit error handling — expect 'why catch here, and what do you do with it?'",
    test: (c) => /\b(try\s*\{|except\s|\.catch\(|rescue\b)/.test(c),
  },
  {
    reason: "concurrency / async coordination — expect race condition and ordering questions",
    test: (c) => /\b(Promise\.(all|race|allSettled)|asyncio\.(gather|wait)|go\s+func|threading|mutex|lock\b)/i.test(c),
  },
  {
    reason: "state management / caching — expect invalidation and consistency questions",
    test: (c) => /\b(useState|useReducer|redux|cache|memo(ize)?|localStorage|store\b)/i.test(c),
  },
  {
    reason: "leftover TODO/FIXME/HACK — interviewers love asking what you'd finish",
    test: (c) => /\b(TODO|FIXME|HACK|XXX)\b/.test(c),
  },
];

export function detectTargets(
  sections: Section[],
  getCode: (s: Section) => string,
): InterviewTarget[] {
  const targets: InterviewTarget[] = [];

  for (const section of sections) {
    const code = getCode(section);
    if (!code) continue;

    const reasons: string[] = [];
    for (const h of HEURISTICS) {
      if (h.test(code)) reasons.push(h.reason);
    }

    const lineCount = section.endLine - section.startLine + 1;
    if (lineCount > LONG_SECTION_LINES) {
      reasons.push(
        `long section (${lineCount} lines) — expect 'walk me through this' and 'how would you refactor it?'`,
      );
    }
    const commentDensity = (code.match(/(?:^|\n)\s*(?:\/\/|#|\/\*)/g) ?? []).length / Math.max(lineCount, 1);
    if (lineCount > 25 && commentDensity < 0.02) {
      reasons.push("dense uncommented logic — expect line-by-line explanation requests");
    }

    if (reasons.length > 0) {
      targets.push({
        sectionId: section.id,
        file: section.file,
        name: section.name,
        reasons,
        weaknessScore: section.weaknessScore,
      });
    }
  }

  // Highest-value targets first: weakness (past struggles) then reason count
  return targets.sort(
    (a, b) => b.weaknessScore - a.weaknessScore || b.reasons.length - a.reasons.length,
  );
}
