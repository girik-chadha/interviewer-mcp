import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchRepo } from "../src/core/github.js";

type Route = { match: (url: string) => boolean; respond: () => Response };

function mockFetch(routes: Route[]) {
  const fn = vi.fn(async (input: string | URL) => {
    const url = String(input);
    const route = routes.find((r) => r.match(url));
    return route ? route.respond() : new Response("unmatched url in test", { status: 404 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function baseRoutes(tree: unknown): Route[] {
  return [
    { match: (u) => u.endsWith("/repos/o/r"), respond: () => json({ default_branch: "main" }) },
    { match: (u) => u.includes("/repos/o/r/git/trees/"), respond: () => json(tree) },
  ];
}

const savedToken = process.env.GITHUB_TOKEN;

beforeEach(() => {
  delete process.env.GITHUB_TOKEN;
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (savedToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = savedToken;
});

describe("fetchRepo", () => {
  it("maps 403 on the API to a friendly rate-limit error", async () => {
    mockFetch([{ match: (u) => u.endsWith("/repos/o/r"), respond: () => new Response("", { status: 403 }) }]);
    await expect(fetchRepo("o/r")).rejects.toThrow(/rate limit/i);
  });

  it("surfaces GitHub's tree-truncation flag for huge repos", async () => {
    const routes = baseRoutes({ truncated: true, tree: [{ path: "a.ts", type: "blob", size: 10 }] });
    routes.push({ match: (u) => u.includes("raw.githubusercontent.com"), respond: () => new Response("code") });
    mockFetch(routes);
    const repo = await fetchRepo("o/r");
    expect(repo.truncated).toBe(true);
    expect(repo.files["a.ts"]).toBe("code");
  });

  it("records unfetchable files as skipped instead of dropping them silently", async () => {
    const routes = baseRoutes({
      truncated: false,
      tree: [
        { path: "good.ts", type: "blob", size: 10 },
        { path: "bad.ts", type: "blob", size: 10 },
      ],
    });
    routes.push({ match: (u) => u.includes("good.ts"), respond: () => new Response("ok-code") });
    routes.push({ match: (u) => u.includes("bad.ts"), respond: () => new Response("", { status: 500 }) });
    mockFetch(routes);
    const repo = await fetchRepo("o/r");
    expect(Object.keys(repo.files)).toEqual(["good.ts"]);
    expect(repo.skipped).toContain("bad.ts");
  });

  it("aborts loudly with the rate-limit hint when file fetches are throttled", async () => {
    const routes = baseRoutes({ truncated: false, tree: [{ path: "a.ts", type: "blob", size: 10 }] });
    routes.push({ match: (u) => u.includes("a.ts"), respond: () => new Response("", { status: 429 }) });
    mockFetch(routes);
    await expect(fetchRepo("o/r")).rejects.toThrow(/rate limit/i);
  });

  it("fetches files via the Contents API when GITHUB_TOKEN is set (fine-grained PAT safe)", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    const routes = baseRoutes({ truncated: false, tree: [{ path: "a.ts", type: "blob", size: 10 }] });
    routes.push({ match: (u) => u.includes("/repos/o/r/contents/a.ts"), respond: () => new Response("code") });
    const fn = mockFetch(routes);
    const repo = await fetchRepo("o/r");
    expect(repo.files["a.ts"]).toBe("code");
    const urls = fn.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/contents/"))).toBe(true);
    expect(urls.every((u) => !u.includes("raw.githubusercontent.com"))).toBe(true);
  });

  it("fetches files via raw.githubusercontent (outside the API quota) when no token is set", async () => {
    const routes = baseRoutes({ truncated: false, tree: [{ path: "a.ts", type: "blob", size: 10 }] });
    routes.push({ match: (u) => u.includes("raw.githubusercontent.com"), respond: () => new Response("code") });
    const fn = mockFetch(routes);
    const repo = await fetchRepo("o/r");
    expect(repo.files["a.ts"]).toBe("code");
    const urls = fn.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("raw.githubusercontent.com"))).toBe(true);
    expect(urls.every((u) => !u.includes("/contents/"))).toBe(true);
  });
});
