import { execFile } from "node:child_process";
import type { CommitRef, FileHistory } from "./types.js";

/** Large repos produce big logs; the default 1 MB buffer truncates them. */
const MAX_BUFFER = 512 * 1024 * 1024;

/**
 * Runs a read-only git command. Returns undefined instead of throwing so that a
 * missing git binary or a non-git folder degrades to "no history" rather than a crash.
 */
export function runGit(cwd: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-c", "core.quotepath=off", ...args],
      { cwd, maxBuffer: MAX_BUFFER, windowsHide: true, encoding: "utf8" },
      (err, stdout) => resolve(err ? undefined : stdout),
    );
  });
}

export interface GitInfo {
  isGit: boolean;
  remote?: string | undefined;
  branch?: string | undefined;
  head?: string | undefined;
}

export async function gitInfo(root: string): Promise<GitInfo> {
  const inside = await runGit(root, ["rev-parse", "--is-inside-work-tree"]);
  if (inside?.trim() !== "true") return { isGit: false };
  const [remote, branch, head] = await Promise.all([
    runGit(root, ["config", "--get", "remote.origin.url"]),
    runGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]),
    runGit(root, ["rev-parse", "HEAD"]),
  ]);
  return {
    isGit: true,
    remote: remote?.trim() || undefined,
    branch: branch?.trim() || undefined,
    head: head?.trim() || undefined,
  };
}

/** Tracked plus untracked-but-not-ignored files, relative to `root` (which may be a subfolder). */
export async function listGitFiles(root: string): Promise<string[] | undefined> {
  const out = await runGit(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  if (out === undefined) return undefined;
  return [...new Set(out.split("\0").filter(Boolean))];
}

export interface HistoryResult {
  files: Record<string, FileHistory>;
  commitsRead: number;
}

const RECORD = "\x1e";
const FIELD = "\x1f";

/** One `git log` pass for every file. Per-file `git log` would be O(files) processes. */
export async function readHistory(root: string, maxCommits: number): Promise<HistoryResult> {
  if (maxCommits <= 0) return { files: {}, commitsRead: 0 };
  const out = await runGit(root, [
    "log",
    "--no-merges",
    "--no-renames",
    "--relative",
    `-n${maxCommits}`,
    `--format=${RECORD}%H${FIELD}%an${FIELD}%aI${FIELD}%s`,
    "--name-only",
  ]);
  if (out === undefined) return { files: {}, commitsRead: 0 };
  return parseLog(out);
}

export function parseLog(out: string): HistoryResult {
  const acc = new Map<string, { commits: CommitRef[]; authors: Set<string> }>();
  let commitsRead = 0;
  for (const record of out.split(RECORD)) {
    if (!record.trim()) continue;
    const [header = "", ...paths] = record.split("\n");
    const [hash = "", author = "", date = "", subject = ""] = header.split(FIELD);
    if (!hash) continue;
    commitsRead++;
    const commit: CommitRef = { hash, author, date, subject };
    for (const raw of paths) {
      const path = raw.trim();
      if (!path) continue;
      let entry = acc.get(path);
      if (!entry) acc.set(path, (entry = { commits: [], authors: new Set() }));
      entry.commits.push(commit);
      entry.authors.add(author);
    }
  }
  const files: Record<string, FileHistory> = {};
  for (const [path, { commits, authors }] of acc) {
    // git log is newest first.
    files[path] = {
      commits: commits.length,
      authors: authors.size,
      firstDate: commits[commits.length - 1]?.date ?? "",
      lastDate: commits[0]?.date ?? "",
      recent: commits.slice(0, 5),
    };
  }
  return { files, commitsRead };
}

export interface BlameLine {
  hash: string;
  author: string;
  date: string;
  subject: string;
}

const UNCOMMITTED = /^0{40}$/;

/** Line-by-line authorship. Index 0 is line 1. Uncommitted lines are omitted (undefined). */
export async function blame(root: string, path: string): Promise<(BlameLine | undefined)[]> {
  const out = await runGit(root, ["blame", "--line-porcelain", "-w", "--", path]);
  if (out === undefined) return [];
  return parseBlame(out);
}

export function parseBlame(out: string): (BlameLine | undefined)[] {
  const lines: (BlameLine | undefined)[] = [];
  let current: Partial<BlameLine> & { line?: number } = {};
  for (const row of out.split("\n")) {
    if (row.startsWith("\t")) {
      if (current.line !== undefined) {
        lines[current.line - 1] = UNCOMMITTED.test(current.hash ?? "")
          ? undefined
          : {
              hash: current.hash ?? "",
              author: current.author ?? "",
              date: current.date ?? "",
              subject: current.subject ?? "",
            };
      }
      current = {};
      continue;
    }
    const header = /^([0-9a-f]{40}) \d+ (\d+)/.exec(row);
    if (header) {
      current.hash = header[1] ?? "";
      current.line = Number(header[2]);
    } else if (row.startsWith("author ")) current.author = row.slice(7);
    else if (row.startsWith("author-time ")) {
      current.date = new Date(Number(row.slice(12)) * 1000).toISOString();
    } else if (row.startsWith("summary ")) current.subject = row.slice(8);
  }
  return lines;
}

export interface RangeHistory {
  introduced?: BlameLine | undefined;
  lastChanged?: BlameLine | undefined;
  commits: BlameLine[];
}

/**
 * Assumption: the oldest surviving line approximates when a symbol was introduced.
 * A full `git log -L` per symbol is exact but far too slow for whole-repo docs.
 */
export function summarizeRange(
  lines: (BlameLine | undefined)[],
  startLine: number,
  endLine: number,
): RangeHistory {
  const byHash = new Map<string, BlameLine>();
  for (let i = startLine - 1; i < endLine && i < lines.length; i++) {
    const l = lines[i];
    if (l && !byHash.has(l.hash)) byHash.set(l.hash, l);
  }
  const commits = [...byHash.values()].sort((a, b) => b.date.localeCompare(a.date));
  return { introduced: commits[commits.length - 1], lastChanged: commits[0], commits };
}
