/** Who the explanation is written for. Same facts, different depth and vocabulary. */
export type Audience = "beginner" | "dev" | "reviewer";

/**
 * How deep to go. `overview`: folders and repo only. `file`: plus one page per
 * file. `symbol`: plus a step-by-step logic walkthrough for every non-trivial
 * function, method, and class.
 */
export type Depth = "overview" | "file" | "symbol";

/** A statement about code, tied to the 1-based inclusive line range that shows it. */
export interface Claim {
  text: string;
  start: number;
  end: number;
}

/** L3 + L4 for one function, method, or class. */
export interface SymbolExplanation {
  /** One sentence: what it does. */
  summary: string;
  /** Why it exists and where it fits. */
  purpose: string;
  params: { name: string; meaning: string }[];
  returns: string;
  /** The logic walkthrough, in execution order. */
  steps: Claim[];
  branches: Claim[];
  errors: Claim[];
  sideEffects: Claim[];
  gotchas: Claim[];
}

/** L2: one file. */
export interface FileExplanation {
  summary: string;
  overview: string;
  /** How the file is used by the rest of the repo. */
  role: string;
  /** Key parts worth reading first, with the lines that hold them. */
  highlights: Claim[];
}

/** L1: one folder or module. */
export interface FolderExplanation {
  summary: string;
  overview: string;
}

/** L0: the whole repository. */
export interface RepoExplanation {
  summary: string;
  overview: string;
  architecture: string;
  /** Main flows through the code, each naming the files involved in order. */
  flows: { name: string; description: string }[];
}

export interface ExplanationMeta {
  backend: string;
  model: string;
  audience: Audience;
  promptVersion: number;
  generatedAt: string;
  /** Hash of everything that went into the prompt that should trigger regeneration. */
  inputHash: string;
  /** Content hash of the file the explanation describes, for freshness checks. */
  sourceHash: string;
  /** Claims and fields the verifier removed because their citations did not hold. */
  dropped: string[];
  costUsd?: number | undefined;
}

export interface Stored<T> {
  meta: ExplanationMeta;
  doc: T;
}

/** Everything explained so far for one repo, keyed by symbol id, file path, or folder path. */
export interface ExplanationSet {
  symbols: Record<string, Stored<SymbolExplanation>>;
  files: Record<string, Stored<FileExplanation>>;
  folders: Record<string, Stored<FolderExplanation>>;
  repo?: Stored<RepoExplanation> | undefined;
}

export function emptySet(): ExplanationSet {
  return { symbols: {}, files: {}, folders: {} };
}
