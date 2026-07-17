/** A slice of a source file that gets taught / interviewed as one unit. */
export interface Section {
  /** Stable id: "<owner>/<repo>#<path>:<name>" */
  id: string;
  repoId: string;
  file: string;
  /** Function/class name, or a descriptive label like "module top-level". */
  name: string;
  startLine: number;
  endLine: number;
  /** 1-based position in the suggested teaching order. */
  teachOrder: number;
  covered: boolean;
  /** Grows when the user performs badly on questions about this section. */
  weaknessScore: number;
}

export interface RepoRecord {
  /** "<owner>/<repo>" */
  id: string;
  url: string;
  branch: string;
  ingestedAt: string;
  /** Language breakdown by file extension, e.g. { ts: 12, py: 3 } */
  languages: Record<string, number>;
  fileCount: number;
  /** First ~2000 chars of the README, used as the intro when teaching. */
  readmeExcerpt: string | null;
  /** Names of dependencies pulled from package.json / requirements.txt etc. */
  dependencies: string[];
}

export type Performance = "strong" | "okay" | "weak";

export interface InterviewEntry {
  repoId: string;
  sectionId: string | null;
  question: string;
  performance: Performance;
  notes: string | null;
  createdAt: string;
}

/** Probe-worthy code the interviewer should attack. */
export interface InterviewTarget {
  sectionId: string;
  file: string;
  name: string;
  /** Why this is worth probing, e.g. "external API call", "auth/secrets handling". */
  reasons: string[];
  weaknessScore: number;
}

export interface Store {
  repos: Record<string, RepoRecord>;
  /** Job description text per repo, for gap-based interview prep. */
  jobDescriptions: Record<string, string>;
  sections: Record<string, Section>;
  interviewLog: InterviewEntry[];
  /** Raw file contents cache, keyed by "<repoId>:<path>". */
  fileCache: Record<string, string>;
}
