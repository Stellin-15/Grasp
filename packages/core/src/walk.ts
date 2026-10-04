import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import ignore from "ignore";
import { DEFAULT_IGNORED_DIRS, isSecretPath } from "./classify.js";
import { listGitFiles } from "./git.js";
import { toPosixPath } from "./paths.js";

export interface WalkOptions {
  /** Extra gitignore-style patterns from config. */
  ignore?: string[] | undefined;
  /** Use `git ls-files` when available. Tests turn this off for fixtures inside this repo. */
  useGit?: boolean | undefined;
}

export interface WalkResult {
  files: string[];
  /** Secret-looking files: counted for transparency, never read. */
  secretsSkipped: number;
  ignoredByGrasp: number;
  source: "git" | "filesystem";
}

async function readIgnoreFile(path: string): Promise<string[]> {
  try {
    return (await readFile(path, "utf8")).split(/\r?\n/);
  } catch {
    return [];
  }
}

/** Fallback for non-git folders. Only the root .gitignore is honored. */
async function walkFilesystem(root: string, gitignore: string[]): Promise<string[]> {
  const ig = ignore().add(gitignore);
  const out: string[] = [];
  const skipDirs = new Set(DEFAULT_IGNORED_DIRS);
  async function visit(dir: string, rel: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      // Gotcha: symlinks are skipped, not followed, to avoid cycles and escaping the repo.
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (skipDirs.has(e.name) || ig.ignores(`${relPath}/`)) continue;
        await visit(join(dir, e.name), relPath);
      } else if (e.isFile() && !ig.ignores(relPath)) {
        out.push(relPath);
      }
    }
  }
  await visit(root, "");
  return out;
}

export async function listFiles(root: string, options: WalkOptions = {}): Promise<WalkResult> {
  const useGit = options.useGit ?? true;
  let source: WalkResult["source"] = "filesystem";
  let candidates: string[] | undefined;
  if (useGit) {
    candidates = await listGitFiles(root);
    if (candidates) source = "git";
  }
  candidates ??= await walkFilesystem(root, await readIgnoreFile(join(root, ".gitignore")));

  const graspIgnore = ignore()
    .add(DEFAULT_IGNORED_DIRS.map((d) => `${d}/`))
    .add(await readIgnoreFile(join(root, ".graspignore")))
    .add(options.ignore ?? []);

  const files: string[] = [];
  let secretsSkipped = 0;
  let ignoredByGrasp = 0;
  for (const raw of candidates) {
    const path = toPosixPath(raw);
    if (isSecretPath(path)) {
      secretsSkipped++;
      continue;
    }
    if (graspIgnore.ignores(path)) {
      ignoredByGrasp++;
      continue;
    }
    files.push(path);
  }
  files.sort();
  return { files, secretsSkipped, ignoredByGrasp, source };
}
