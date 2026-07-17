/**
 * GitHub fetching via the REST API with native fetch — no SDK dependency.
 * Public repos work with no token; set GITHUB_TOKEN for higher rate limits
 * and private repos.
 */

const API = "https://api.github.com";

const SOURCE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "py", "java", "go", "rs", "rb", "php",
  "c", "h", "cpp", "hpp", "cc", "cs",
  "kt", "swift", "scala", "sql", "sh",
  "vue", "svelte",
]);

const SKIP_DIRS = [
  "node_modules/", "dist/", "build/", "out/", ".next/", "vendor/",
  "venv/", ".venv/", "__pycache__/", "coverage/", ".git/",
];

const SKIP_FILES = [
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock",
  "cargo.lock", "gemfile.lock", "uv.lock",
];

const MAX_FILE_BYTES = 100 * 1024; // skip generated monsters
const MAX_FILES = 120; // context sanity for very large repos

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface FetchedRepo {
  ref: RepoRef;
  branch: string;
  /** path -> file content, source files only */
  files: Record<string, string>;
  /** paths that exist but were skipped (too big / over file cap / fetch failed) */
  skipped: string[];
  /** true when GitHub truncated the tree listing (very large repo) */
  truncated: boolean;
  readme: string | null;
  dependencies: string[];
}

export function parseRepoUrl(input: string): RepoRef {
  // Accepts: https://github.com/owner/repo(.git), git@github.com:owner/repo, owner/repo
  const cleaned = input.trim().replace(/\/+$/, "").replace(/\.git$/, "");
  const match =
    cleaned.match(/github\.com[/:]([^/]+)\/([^/]+)/) ??
    cleaned.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!match) {
    throw new Error(
      `Could not parse "${input}" as a GitHub repo. Expected a URL like https://github.com/owner/repo or shorthand owner/repo.`,
    );
  }
  // GitHub treats owner/repo as case-insensitive; the store must too,
  // or "Owner/Repo" and "owner/repo" become two different repos.
  return { owner: match[1].toLowerCase(), repo: match[2].toLowerCase() };
}

function headers(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "interviewer-mcp",
  };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function gh<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: headers() });
  if (res.status === 403 || res.status === 429) {
    throw new Error(
      "GitHub API rate limit hit. Set a GITHUB_TOKEN environment variable in your MCP config to raise the limit from 60 to 5000 requests/hour.",
    );
  }
  if (res.status === 404) {
    throw new Error(
      "Repo or branch not found (404). Check the URL, and for private repos set GITHUB_TOKEN.",
    );
  }
  if (!res.ok) throw new Error(`GitHub API error ${res.status} on ${path}`);
  return (await res.json()) as T;
}

/**
 * Fetch one file's raw contents.
 *
 * With a token: the Contents API with the raw media type — works for private
 * repos with BOTH classic and fine-grained PATs (raw.githubusercontent does
 * not reliably accept fine-grained tokens).
 *
 * Without a token: raw.githubusercontent, which is not subject to the
 * 60 req/hour API quota — so a 120-file public ingest cannot exhaust it.
 *
 * Returns null for a missing/unreadable file (caller records it as skipped);
 * throws only on rate limiting, which should abort the whole ingest loudly.
 */
async function fetchFileRaw(ref: RepoRef, branch: string, filePath: string): Promise<string | null> {
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  const res = process.env.GITHUB_TOKEN
    ? await fetch(
        `${API}/repos/${ref.owner}/${ref.repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`,
        { headers: { ...headers(), Accept: "application/vnd.github.raw" } },
      )
    : await fetch(
        `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${encodeURIComponent(branch)}/${encodedPath}`,
      );
  if (res.status === 403 || res.status === 429) {
    throw new Error(
      "GitHub rate limit hit (or access denied) while fetching file contents. Set a GITHUB_TOKEN environment variable in your MCP config to raise the limit from 60 to 5000 requests/hour.",
    );
  }
  if (!res.ok) return null;
  return await res.text();
}

function isSourcePath(path: string, size: number): "keep" | "skip-listed" | "ignore" {
  const lower = path.toLowerCase();
  if (SKIP_DIRS.some((d) => lower.includes(d))) return "ignore";
  if (SKIP_FILES.some((f) => lower.endsWith(f))) return "ignore";
  const ext = lower.split(".").pop() ?? "";
  if (!SOURCE_EXTENSIONS.has(ext)) return "ignore";
  if (size > MAX_FILE_BYTES) return "skip-listed";
  return "keep";
}

function extractDependencies(files: Record<string, string>): string[] {
  const deps = new Set<string>();
  for (const [path, content] of Object.entries(files)) {
    const base = path.split("/").pop()?.toLowerCase();
    try {
      if (base === "package.json") {
        const pkg = JSON.parse(content);
        for (const k of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) deps.add(k);
      }
      if (base === "requirements.txt") {
        for (const line of content.split("\n")) {
          const name = line.split(/[=<>~!;\[ ]/)[0].trim();
          if (name && !name.startsWith("#")) deps.add(name);
        }
      }
    } catch {
      // malformed manifest — skip silently, deps are best-effort
    }
  }
  return [...deps].sort();
}

export async function fetchRepo(url: string, branch?: string): Promise<FetchedRepo> {
  const ref = parseRepoUrl(url);
  const base = `/repos/${ref.owner}/${ref.repo}`;

  const meta = await gh<{ default_branch: string }>(base);
  const useBranch = branch ?? meta.default_branch;

  const tree = await gh<{ tree: Array<{ path: string; type: string; size?: number }>; truncated: boolean }>(
    `${base}/git/trees/${encodeURIComponent(useBranch)}?recursive=1`,
  );

  const candidates: string[] = [];
  const skipped: string[] = [];
  let readmePath: string | null = null;

  for (const node of tree.tree) {
    if (node.type !== "blob") continue;
    if (/^readme\.(md|rst|txt)$/i.test(node.path)) readmePath = node.path;
    const verdict = isSourcePath(node.path, node.size ?? 0);
    if (verdict === "keep") candidates.push(node.path);
    else if (verdict === "skip-listed") skipped.push(node.path);
  }

  // Also grab dependency manifests even though they aren't "source"
  const manifests = tree.tree
    .filter((n) => n.type === "blob" && /(^|\/)(package\.json|requirements\.txt)$/i.test(n.path))
    .filter((n) => !SKIP_DIRS.some((d) => n.path.toLowerCase().includes(d)))
    .map((n) => n.path);

  const toFetch = [...new Set([...candidates.slice(0, MAX_FILES), ...manifests])];
  if (candidates.length > MAX_FILES) {
    skipped.push(...candidates.slice(MAX_FILES));
  }

  const files: Record<string, string> = {};
  // Fetch raw contents in modest parallel batches
  const BATCH = 8;
  for (let i = 0; i < toFetch.length; i += BATCH) {
    const batch = toFetch.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async (p) => [p, await fetchFileRaw(ref, useBranch, p)] as const),
    );
    for (const [p, content] of results) {
      if (content !== null) files[p] = content;
      else skipped.push(p); // listed in the tree but unfetchable — never drop silently
    }
  }

  let readme: string | null = null;
  if (readmePath) {
    const content = await fetchFileRaw(ref, useBranch, readmePath);
    if (content !== null) readme = content.slice(0, 2000);
  }

  return {
    ref,
    branch: useBranch,
    files,
    skipped,
    truncated: tree.truncated,
    readme,
    dependencies: extractDependencies(files),
  };
}
