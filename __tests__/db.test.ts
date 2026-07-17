import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import * as db from "../src/core/db.js";
import type { RepoRecord, Section } from "../src/types.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "interviewer-test-"));
  process.env.INTERVIEWER_DATA_DIR = tmpDir;
});

afterEach(async () => {
  delete process.env.INTERVIEWER_DATA_DIR;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function repo(id = "me/repo"): RepoRecord {
  return {
    id,
    url: `https://github.com/${id}`,
    branch: "main",
    ingestedAt: new Date().toISOString(),
    languages: { ts: 1 },
    fileCount: 1,
    readmeExcerpt: null,
    dependencies: [],
  };
}

function makeSection(id: string, repoId = "me/repo"): Section {
  return {
    id,
    repoId,
    file: "src/a.ts",
    name: id,
    startLine: 1,
    endLine: 10,
    teachOrder: 1,
    covered: false,
    weaknessScore: 0,
  };
}

describe("store", () => {
  it("returns empty store when no file exists", async () => {
    const store = await db.loadStore();
    expect(store.repos).toEqual({});
    expect(store.interviewLog).toEqual([]);
  });

  it("persists a repo with sections and file cache", async () => {
    await db.upsertRepo(repo(), [makeSection("me/repo#a")], { "src/a.ts": "code here" });
    expect(await db.getRepo("me/repo")).toBeDefined();
    expect(await db.getFileContent("me/repo", "src/a.ts")).toBe("code here");
    expect((await db.sectionsForRepo("me/repo")).length).toBe(1);
  });

  it("weak answers raise weakness score, strong answers lower it (floored at 0)", async () => {
    await db.upsertRepo(repo(), [makeSection("s1")], {});
    await db.logInterview({
      repoId: "me/repo",
      sectionId: "s1",
      question: "why?",
      performance: "weak",
      notes: null,
      createdAt: new Date().toISOString(),
    });
    let s = await db.getSection("s1");
    expect(s!.weaknessScore).toBe(1);

    await db.logInterview({
      repoId: "me/repo",
      sectionId: "s1",
      question: "why again?",
      performance: "strong",
      notes: null,
      createdAt: new Date().toISOString(),
    });
    s = await db.getSection("s1");
    expect(s!.weaknessScore).toBe(0.5);

    await db.logInterview({
      repoId: "me/repo",
      sectionId: "s1",
      question: "and again?",
      performance: "strong",
      notes: null,
      createdAt: new Date().toISOString(),
    });
    s = await db.getSection("s1");
    expect(s!.weaknessScore).toBe(0); // floored
  });

  it("re-ingest preserves covered + weakness state for matching ids", async () => {
    await db.upsertRepo(repo(), [makeSection("keep")], {});
    await db.markCovered("keep");
    await db.logInterview({
      repoId: "me/repo",
      sectionId: "keep",
      question: "q",
      performance: "weak",
      notes: "gap",
      createdAt: new Date().toISOString(),
    });

    // Re-ingest with same id + one new section
    await db.upsertRepo(repo(), [makeSection("keep"), makeSection("new")], {});
    const kept = await db.getSection("keep");
    expect(kept!.covered).toBe(true);
    expect(kept!.weaknessScore).toBe(1);

    // Interview history survives re-ingest
    expect((await db.interviewLogForRepo("me/repo")).length).toBe(1);
  });

  it("caps stored job-description text at MAX_JD_CHARS", async () => {
    await db.setJobDescription("me/repo", "x".repeat(db.MAX_JD_CHARS + 5000));
    const stored = await db.getJobDescription("me/repo");
    expect(stored!.length).toBe(db.MAX_JD_CHARS);
  });

  it("keeps repos isolated", async () => {
    await db.upsertRepo(repo("me/a"), [makeSection("a1", "me/a")], {});
    await db.upsertRepo(repo("me/b"), [makeSection("b1", "me/b")], {});
    expect((await db.sectionsForRepo("me/a")).map((s) => s.id)).toEqual(["a1"]);
    expect((await db.sectionsForRepo("me/b")).map((s) => s.id)).toEqual(["b1"]);
  });
});

describe("concurrency", () => {
  it("survives 20 parallel mutations without corrupting the store", async () => {
    await db.upsertRepo(repo(), [makeSection("s1")], {});
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        db.logInterview({
          repoId: "me/repo",
          sectionId: "s1",
          question: `q${i}`,
          performance: "weak",
          notes: null,
          createdAt: new Date().toISOString(),
        }),
      ),
    );
    const log = await db.interviewLogForRepo("me/repo");
    expect(log.length).toBe(20); // no lost updates
    const s = await db.getSection("s1");
    expect(s!.weaknessScore).toBe(20); // every increment applied
    // and the file itself parses (no corruption)
    const store = await db.loadStore();
    expect(store.interviewLog.length).toBe(20);
  });
});
