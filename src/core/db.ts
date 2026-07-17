/**
 * Persistence layer.
 *
 * Deliberately a plain JSON file rather than SQLite: no native modules means
 * `npx interviewer-mcp` works on every OS with zero build tooling. Data volume is
 * small (sections + interview log for a handful of repos).
 *
 * Location: $INTERVIEWER_DATA_DIR/store.json, defaulting to ~/.interviewer-mcp/store.json
 */

import { promises as fs } from "fs";
import path from "path";
import os from "os";
import type { InterviewEntry, RepoRecord, Section, Store } from "../types.js";

const EMPTY: Store = { repos: {}, sections: {}, interviewLog: [], fileCache: {}, jobDescriptions: {} };

/**
 * All read-modify-write cycles are serialized through this promise chain.
 * MCP SDK dispatches tool handlers concurrently, so without this, parallel
 * tool calls race on the store file and corrupt it (found in testing).
 */
let queue: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined); // keep the chain alive after failures
  return next;
}

export function storePath(): string {
  const dir = process.env.INTERVIEWER_DATA_DIR ?? path.join(os.homedir(), ".interviewer-mcp");
  return path.join(dir, "store.json");
}

export async function loadStore(): Promise<Store> {
  try {
    const raw = await fs.readFile(storePath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<Store>;
    return { ...EMPTY, ...parsed };
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return structuredClone(EMPTY);
    }
    if (err instanceof SyntaxError) {
      // Corrupted store: quarantine it instead of bricking every future session.
      const backup = `${storePath()}.corrupt-${Date.now()}`;
      await fs.rename(storePath(), backup).catch(() => undefined);
      console.error(`Interviewer: store.json was corrupted; moved to ${backup} and starting fresh.`);
      return structuredClone(EMPTY);
    }
    throw err;
  }
}

export async function saveStore(store: Store): Promise<void> {
  const file = storePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  // Unique temp name per write + atomic rename: no partially-written store,
  // even if the process dies mid-write.
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2));
  await fs.rename(tmp, file);
}

// ---- Convenience mutations ------------------------------------------------

export function upsertRepo(
  repo: RepoRecord,
  sections: Section[],
  files: Record<string, string>,
): Promise<void> {
  return withLock(async () => {
    const store = await loadStore();

    // Re-ingesting: drop this repo's old sections/cache but KEEP interview
    // history and carry weakness/covered state over to matching section ids.
    const prior = new Map<string, Section>();
    for (const [id, s] of Object.entries(store.sections)) {
      if (s.repoId === repo.id) {
        prior.set(id, s);
        delete store.sections[id];
      }
    }
    for (const key of Object.keys(store.fileCache)) {
      if (key.startsWith(`${repo.id}:`)) delete store.fileCache[key];
    }

    for (const section of sections) {
      const old = prior.get(section.id);
      if (old) {
        section.covered = old.covered;
        section.weaknessScore = old.weaknessScore;
      }
      store.sections[section.id] = section;
    }
    for (const [p, content] of Object.entries(files)) {
      store.fileCache[`${repo.id}:${p}`] = content;
    }
    store.repos[repo.id] = repo;
    await saveStore(store);
  });
}

export async function getRepo(repoId: string): Promise<RepoRecord | undefined> {
  const store = await loadStore();
  return store.repos[repoId];
}

export async function sectionsForRepo(repoId: string): Promise<Section[]> {
  const store = await loadStore();
  return Object.values(store.sections)
    .filter((s) => s.repoId === repoId)
    .sort((a, b) => a.teachOrder - b.teachOrder);
}

export async function getSection(sectionId: string): Promise<Section | undefined> {
  const store = await loadStore();
  return store.sections[sectionId];
}

export async function getFileContent(repoId: string, file: string): Promise<string | undefined> {
  const store = await loadStore();
  return store.fileCache[`${repoId}:${file}`];
}

export function markCovered(sectionId: string): Promise<Section | undefined> {
  return withLock(async () => {
    const store = await loadStore();
    const section = store.sections[sectionId];
    if (!section) return undefined;
    section.covered = true;
    await saveStore(store);
    return section;
  });
}

const WEAKNESS_DELTA: Record<string, number> = { weak: 1.0, okay: 0.25, strong: -0.5 };

export function logInterview(entry: InterviewEntry): Promise<void> {
  return withLock(async () => {
    const store = await loadStore();
    store.interviewLog.push(entry);
    if (entry.sectionId && store.sections[entry.sectionId]) {
      const s = store.sections[entry.sectionId];
      s.weaknessScore = Math.max(0, s.weaknessScore + (WEAKNESS_DELTA[entry.performance] ?? 0));
    }
    await saveStore(store);
  });
}

export async function interviewLogForRepo(repoId: string): Promise<InterviewEntry[]> {
  const store = await loadStore();
  return store.interviewLog.filter((e) => e.repoId === repoId);
}

/**
 * Cap on stored JD+CV text. The store is a single JSON file rewritten on
 * every mutation, so an unbounded paste (a whole CV PDF's text, say) would
 * tax every later write. 20k chars comfortably fits a JD + CV.
 */
export const MAX_JD_CHARS = 20_000;

export function setJobDescription(repoId: string, text: string): Promise<void> {
  return withLock(async () => {
    const store = await loadStore();
    store.jobDescriptions[repoId] = text.slice(0, MAX_JD_CHARS);
    await saveStore(store);
  });
}

export async function getJobDescription(repoId: string): Promise<string | undefined> {
  const store = await loadStore();
  return store.jobDescriptions[repoId];
}
