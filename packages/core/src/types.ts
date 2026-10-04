/**
 * The static fact base. Everything here is computed without an LLM and is the
 * ground truth that later generated docs must cite and agree with.
 *
 * Conventions: paths are POSIX and relative to the repo root; line numbers are
 * 1-based and inclusive.
 */

export const FACTS_SCHEMA_VERSION = 1;

export interface LineRange {
  startLine: number;
  endLine: number;
}

export type FileRole =
  "source" | "test" | "fixture" | "config" | "docs" | "generated" | "vendored" | "data" | "other";

export interface FileFact {
  path: string;
  language: string;
  role: FileRole;
  size: number;
  lines: number;
  hash: string;
  /** True when a language pack extracted symbols from this file. */
  parsed: boolean;
  /** `packId@version` that produced the facts; a mismatch invalidates cached extraction. */
  extractor?: string | undefined;
  /** Parsed, but tree-sitter reported syntax errors, so facts may be partial. */
  hasSyntaxErrors?: boolean | undefined;
  /** Python `if __name__ == "__main__":` and similar run-as-script markers. */
  isScript?: boolean | undefined;
  /** Docstring or leading comment describing the whole file. */
  description?: string | undefined;
}

export type SymbolKind =
  "function" | "method" | "class" | "interface" | "type" | "enum" | "constant" | "variable";

export interface Param {
  name: string;
  type?: string | undefined;
  defaultValue?: string | undefined;
  optional?: boolean | undefined;
  rest?: boolean | undefined;
}

export interface SymbolFact {
  /** `${path}#${qualifiedName}`. Stable across scans while name and file stay the same. */
  id: string;
  name: string;
  /** Includes enclosing classes, e.g. `UserService.find`. */
  qualifiedName: string;
  kind: SymbolKind;
  path: string;
  range: LineRange;
  /** Declaration head as written in source, collapsed to one line. */
  signature: string;
  params: Param[];
  returns?: string | undefined;
  exported: boolean;
  defaultExport?: boolean | undefined;
  async?: boolean | undefined;
  docstring?: string | undefined;
  decorators?: string[] | undefined;
  parentId?: string | undefined;
}

export interface ImportedName {
  /** Name in the source module. `default` for default imports, `*` for namespaces. */
  imported: string;
  /** Name bound in the importing file. */
  local: string;
}

export interface ImportFact {
  from: string;
  specifier: string;
  line: number;
  names: ImportedName[];
  kind: "import" | "require" | "dynamic" | "reexport";
  /** Repo-relative path of the imported file when it is part of this repo. */
  resolved?: string | undefined;
  /** Package name when the import points outside the repo. */
  external?: string | undefined;
}

export interface CallFact {
  /** Enclosing symbol id, or the file path for module-level calls. */
  from: string;
  path: string;
  line: number;
  /** Callee as written, e.g. `save`, `this.save`, `db.save`. */
  callee: string;
  /** Last segment of the callee, e.g. `save`. */
  name: string;
  isNew?: boolean | undefined;
  /** Resolved symbol id when the target could be found statically. */
  resolved?: string | undefined;
}

export interface CommitRef {
  hash: string;
  date: string;
  author: string;
  subject: string;
}

export interface FileHistory {
  commits: number;
  authors: number;
  firstDate: string;
  lastDate: string;
  recent: CommitRef[];
}

export interface RepoInfo {
  name: string;
  /** Absolute POSIX path. Not written into golden outputs. */
  root: string;
  id: string;
  isGit: boolean;
  remote?: string | undefined;
  branch?: string | undefined;
  head?: string | undefined;
}

export interface RepoFacts {
  schemaVersion: number;
  toolVersion: string;
  generatedAt: string;
  repo: RepoInfo;
  files: FileFact[];
  symbols: SymbolFact[];
  imports: ImportFact[];
  calls: CallFact[];
  /** Symbol id or file path to the test file paths that exercise it. */
  tests: Record<string, string[]>;
  history: Record<string, FileHistory>;
  /** Commits scanned for history, so readers know the window. */
  historyWindow?: number | undefined;
  warnings: string[];
}
