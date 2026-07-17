import { describe, it, expect } from "vitest";
import { detectTargets } from "../src/core/targets.js";
import { parseRepoUrl } from "../src/core/github.js";
import type { Section } from "../src/types.js";

function section(id: string, code: string, weakness = 0): { s: Section; code: string } {
  const lines = code.split("\n").length;
  return {
    s: {
      id,
      repoId: "me/repo",
      file: "src/x.ts",
      name: id,
      startLine: 1,
      endLine: lines,
      teachOrder: 1,
      covered: false,
      weaknessScore: weakness,
    },
    code,
  };
}

describe("detectTargets", () => {
  it("flags network calls, auth, and SQL", () => {
    const items = [
      section("net", 'const r = await fetch("https://api.example.com");'),
      section("auth", "const token = jwt.sign(payload, SECRET);"),
      section("sql", 'db.query("SELECT id FROM users WHERE email = " + email);'),
      section("plain", "const x = 1 + 1;"),
    ];
    const targets = detectTargets(
      items.map((i) => i.s),
      (s) => items.find((i) => i.s.id === s.id)!.code,
    );
    const ids = targets.map((t) => t.sectionId);
    expect(ids).toContain("net");
    expect(ids).toContain("auth");
    expect(ids).toContain("sql");
    expect(ids).not.toContain("plain");
  });

  it("puts previously-weak sections first", () => {
    const items = [
      section("fresh", 'fetch("/a");', 0),
      section("struggled", 'fetch("/b");', 2),
    ];
    const targets = detectTargets(
      items.map((i) => i.s),
      (s) => items.find((i) => i.s.id === s.id)!.code,
    );
    expect(targets[0].sectionId).toBe("struggled");
  });

  it("flags long uncommented sections", () => {
    const long = Array.from({ length: 60 }, (_, i) => `doThing(${i});`).join("\n");
    const items = [section("big", long)];
    const targets = detectTargets(
      items.map((i) => i.s),
      () => long,
    );
    expect(targets[0].reasons.join(" ")).toMatch(/long section/);
  });
});

describe("parseRepoUrl", () => {
  it("parses https URLs", () => {
    expect(parseRepoUrl("https://github.com/girik/velox")).toEqual({ owner: "girik", repo: "velox" });
  });
  it("parses .git and trailing slashes", () => {
    expect(parseRepoUrl("https://github.com/a/b.git/")).toEqual({ owner: "a", repo: "b" });
  });
  it("parses ssh form", () => {
    expect(parseRepoUrl("git@github.com:a/b.git")).toEqual({ owner: "a", repo: "b" });
  });
  it("parses shorthand", () => {
    expect(parseRepoUrl("owner/repo")).toEqual({ owner: "owner", repo: "repo" });
  });
  it("lowercases owner/repo — GitHub ids are case-insensitive", () => {
    expect(parseRepoUrl("https://github.com/Owner/RepoName")).toEqual({ owner: "owner", repo: "reponame" });
  });
  it("rejects garbage", () => {
    expect(() => parseRepoUrl("not a repo")).toThrow();
  });
});
