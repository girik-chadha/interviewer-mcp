/**
 * Code map builder.
 *
 * Splits source files into teachable sections (top-level functions/classes)
 * using per-language-family regexes, then orders them for teaching:
 *
 *   1. entry points (main/index/app/server)
 *   2. files most imported by other files (core logic first)
 *   3. everything else, leaf utilities last
 *
 * Deliberately regex-based for v1 — covers the JS/TS/Python/Go/Java shapes
 * that dominate student repos. Roadmap: tree-sitter for full AST accuracy.
 */

import type { Section } from "../types.js";

interface RawSection {
  file: string;
  name: string;
  startLine: number;
  endLine: number;
}

const DECLARATION_PATTERNS: Array<{ exts: string[]; regex: RegExp; nameGroup: number }> = [
  {
    // JS / TS family — top-level (non-indented) declarations
    exts: ["ts", "tsx", "js", "jsx", "mjs", "cjs", "vue", "svelte"],
    regex:
      /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s+([A-Za-z_$][\w$]*)|class\s+([A-Za-z_$][\w$]*)|const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>)/,
    nameGroup: 1,
  },
  {
    // Python — top-level def / class only (no leading whitespace)
    exts: ["py"],
    regex: /^(?:async\s+)?(?:def|class)\s+([A-Za-z_][\w]*)/,
    nameGroup: 1,
  },
  {
    // Go
    exts: ["go"],
    regex: /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)|^type\s+([A-Za-z_][\w]*)/,
    nameGroup: 1,
  },
  {
    // Java / C# / Kotlin — class-level declarations
    exts: ["java", "cs", "kt"],
    regex: /^\s*(?:public|private|protected|internal)?\s*(?:static\s+)?(?:final\s+)?(?:abstract\s+)?class\s+([A-Za-z_][\w]*)/,
    nameGroup: 1,
  },
];

const ENTRY_HINTS = ["main", "index", "app", "server", "cli"];
const FALLBACK_CHUNK_LINES = 80;
const MIN_SECTION_LINES = 3;

function ext(path: string): string {
  return path.toLowerCase().split(".").pop() ?? "";
}

function firstGroup(match: RegExpMatchArray): string | null {
  for (let i = 1; i < match.length; i++) {
    if (match[i]) return match[i];
  }
  return null;
}

/** Split one file into named sections. Falls back to fixed-size chunks. */
export function sectionFile(file: string, content: string): RawSection[] {
  const lines = content.split("\n");
  const pattern = DECLARATION_PATTERNS.find((p) => p.exts.includes(ext(file)));

  const boundaries: Array<{ line: number; name: string }> = [];
  if (pattern) {
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(pattern.regex);
      if (match) {
        const name = firstGroup(match);
        if (name) boundaries.push({ line: i, name });
      }
    }
  }

  if (boundaries.length === 0) {
    // Unknown language or script-style file: chunk it
    const sections: RawSection[] = [];
    for (let start = 0; start < lines.length; start += FALLBACK_CHUNK_LINES) {
      const end = Math.min(start + FALLBACK_CHUNK_LINES, lines.length);
      if (end - start < MIN_SECTION_LINES) break;
      sections.push({
        file,
        name: sections.length === 0 ? "module top-level" : `lines ${start + 1}–${end}`,
        startLine: start + 1,
        endLine: end,
      });
    }
    return sections.length > 0
      ? sections
      : [{ file, name: "module top-level", startLine: 1, endLine: lines.length }];
  }

  const sections: RawSection[] = [];
  // Preamble (imports, constants) before the first declaration
  if (boundaries[0].line >= MIN_SECTION_LINES) {
    sections.push({ file, name: "module top-level", startLine: 1, endLine: boundaries[0].line });
  }
  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i].line;
    const end = i + 1 < boundaries.length ? boundaries[i + 1].line : lines.length;
    sections.push({ file, name: boundaries[i].name, startLine: start + 1, endLine: end });
  }
  return sections;
}

/** Count how many other files import each file (rough, path-based). */
export function importCounts(files: Record<string, string>): Record<string, number> {
  const counts: Record<string, number> = {};
  const stems = Object.keys(files).map((p) => ({
    path: p,
    stem: p.replace(/\.[^.]+$/, "").split("/").pop() ?? p,
  }));

  const importLine = /(?:^|\n)\s*(?:import\s.+?from\s+['"](.+?)['"]|import\s+['"](.+?)['"]|from\s+([\w.]+)\s+import|require\(['"](.+?)['"]\))/g;

  for (const [importer, content] of Object.entries(files)) {
    const seen = new Set<string>();
    for (const match of content.matchAll(importLine)) {
      const spec = match[1] ?? match[2] ?? match[3] ?? match[4];
      if (!spec) continue;
      // "./util" -> "util"; "./util.js" -> "util"; "app.db" (python) -> "db"
      const lastSegment = spec.split("/").pop() ?? "";
      const withoutExt = lastSegment.replace(
        /\.(js|ts|jsx|tsx|mjs|cjs|py|go|rs|java|rb|php|vue|svelte)$/,
        "",
      );
      const specStem = withoutExt.split(".").pop() ?? "";
      for (const { path, stem } of stems) {
        if (path === importer || seen.has(path)) continue;
        if (specStem && stem === specStem) {
          counts[path] = (counts[path] ?? 0) + 1;
          seen.add(path);
        }
      }
    }
  }
  return counts;
}

function entryScore(path: string): number {
  const stem = path.replace(/\.[^.]+$/, "").split("/").pop()?.toLowerCase() ?? "";
  const depth = path.split("/").length;
  const hintIndex = ENTRY_HINTS.indexOf(stem);
  if (hintIndex === -1) return 0;
  // Shallower entry files score higher (src/index.ts beats src/utils/index.ts)
  return (ENTRY_HINTS.length - hintIndex) * 10 - depth;
}

/** Build final ordered sections for a repo. */
export function buildCodeMap(repoId: string, files: Record<string, string>): Section[] {
  const counts = importCounts(files);

  const fileOrder = Object.keys(files)
    .filter((p) => !/(^|\/)(package\.json|requirements\.txt)$/i.test(p))
    .sort((a, b) => {
      const entryDiff = entryScore(b) - entryScore(a);
      if (entryDiff !== 0) return entryDiff;
      const importDiff = (counts[b] ?? 0) - (counts[a] ?? 0);
      if (importDiff !== 0) return importDiff;
      return a.localeCompare(b);
    });

  const sections: Section[] = [];
  let order = 1;
  for (const file of fileOrder) {
    for (const raw of sectionFile(file, files[file])) {
      sections.push({
        id: `${repoId}#${raw.file}:${raw.name}@${raw.startLine}`,
        repoId,
        file: raw.file,
        name: raw.name,
        startLine: raw.startLine,
        endLine: raw.endLine,
        teachOrder: order++,
        covered: false,
        weaknessScore: 0,
      });
    }
  }
  return sections;
}
