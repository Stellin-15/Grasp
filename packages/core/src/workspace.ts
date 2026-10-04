import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { contentHash } from "./hash.js";

export function graspHome(): string {
  return process.env.GRASP_HOME || join(homedir(), ".grasp");
}

/**
 * Removes credentials from a remote URL before it is stored or printed.
 * Why: CI clones often embed tokens, e.g. https://x-access-token:SECRET@github.com/...
 */
export function sanitizeRemote(remote: string): string {
  return remote.replace(/^([a-z+]+:\/\/)[^@/]+@/i, "$1");
}

/** `owner/repo` style key so two clones of the same remote share one workspace. */
function normalizeRemote(remote: string): string {
  return sanitizeRemote(remote)
    .replace(/^[a-z+]+:\/\//i, "")
    .replace(/^git@/, "")
    .replace(":", "/")
    .replace(/\.git$/, "")
    .toLowerCase();
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "repo"
  );
}

/** Stable workspace id: readable name plus a short hash of the remote (or path if no remote). */
export function repoId(root: string, remote?: string): string {
  const key = remote ? normalizeRemote(remote) : root.toLowerCase();
  return `${slug(basename(root))}-${contentHash(key).slice(0, 8)}`;
}

export interface WorkspaceOptions {
  /** Write into `<repo>/.grasp/` instead of the user's home. Opt-in for maintainers. */
  inRepo?: boolean | undefined;
  /** Explicit directory, overrides everything. */
  dir?: string | undefined;
}

export function resolveWorkspace(root: string, id: string, opts: WorkspaceOptions = {}): string {
  if (opts.dir) return opts.dir;
  if (opts.inRepo) return join(root, ".grasp");
  return join(graspHome(), "workspaces", id);
}

/** Write to a temp file and rename, so an interrupted run never leaves half a JSON file. */
export async function writeFileAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, path);
}

/** `pretty: false` for large machine data: indentation makes an 80 MB fact base 5 s slower to write. */
export async function writeJson(path: string, data: unknown, pretty = true): Promise<void> {
  await writeFileAtomic(path, JSON.stringify(data, null, pretty ? 2 : undefined) + "\n");
}

export async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}
