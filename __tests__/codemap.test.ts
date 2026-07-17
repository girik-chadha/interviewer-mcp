import { describe, it, expect } from "vitest";
import { sectionFile, importCounts, buildCodeMap } from "../src/core/codemap.js";

describe("sectionFile", () => {
  it("splits TypeScript into named top-level sections", () => {
    const code = [
      'import { x } from "./x";',
      "const CONFIG = 1;",
      "",
      "export function alpha() {",
      "  return 1;",
      "}",
      "",
      "export const beta = async () => {",
      "  return 2;",
      "};",
      "",
      "class Gamma {",
      "  run() {}",
      "}",
    ].join("\n");

    const sections = sectionFile("src/app.ts", code);
    const names = sections.map((s) => s.name);
    expect(names).toContain("alpha");
    expect(names).toContain("beta");
    expect(names).toContain("Gamma");
    expect(names[0]).toBe("module top-level"); // preamble captured
  });

  it("splits Python by top-level def/class only", () => {
    const code = [
      "import os",
      "",
      "def outer():",
      "    def inner():",
      "        pass",
      "    return inner",
      "",
      "class Thing:",
      "    def method(self):",
      "        pass",
    ].join("\n");

    const sections = sectionFile("main.py", code);
    const names = sections.map((s) => s.name);
    expect(names).toContain("outer");
    expect(names).toContain("Thing");
    expect(names).not.toContain("inner"); // indented, not top-level
    expect(names).not.toContain("method");
  });

  it("falls back to chunks for unknown languages", () => {
    const code = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
    const sections = sectionFile("data.sql", code);
    expect(sections.length).toBeGreaterThan(1);
    expect(sections[0].startLine).toBe(1);
  });

  it("covers every line exactly once within declarations", () => {
    const code = ["function a() {", "}", "function b() {", "}"].join("\n");
    const sections = sectionFile("f.js", code);
    expect(sections[0].endLine + 1).toBe(sections[1].startLine);
  });
});

describe("importCounts", () => {
  it("counts inbound imports by stem", () => {
    const files = {
      "src/util.ts": "export const u = 1;",
      "src/a.ts": 'import { u } from "./util";',
      "src/b.ts": 'import { u } from "../src/util";',
      "src/c.ts": "const nothing = 0;",
    };
    const counts = importCounts(files);
    expect(counts["src/util.ts"]).toBe(2);
    expect(counts["src/c.ts"]).toBeUndefined();
  });

  it("handles python-style imports", () => {
    const files = {
      "app/db.py": "x = 1",
      "app/main.py": "from app.db import x",
    };
    const counts = importCounts(files);
    expect(counts["app/db.py"]).toBe(1);
  });
});

describe("buildCodeMap", () => {
  it("orders entry points before utilities", () => {
    const files = {
      "src/helpers/strings.ts": "export function pad() {}",
      "src/index.ts": 'import { pad } from "./helpers/strings";\nexport function main() {}',
    };
    const sections = buildCodeMap("me/repo", files);
    expect(sections[0].file).toBe("src/index.ts");
    expect(sections.every((s, i) => s.teachOrder === i + 1)).toBe(true);
  });

  it("produces stable unique ids", () => {
    const files = { "a.ts": "export function f() {}\nexport function f2() {}" };
    const sections = buildCodeMap("me/repo", files);
    const ids = new Set(sections.map((s) => s.id));
    expect(ids.size).toBe(sections.length);
    expect(sections[0].id.startsWith("me/repo#a.ts:")).toBe(true);
  });
});
