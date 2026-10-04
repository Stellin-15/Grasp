import { readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { classifyFile, looksGenerated } from "./classify.js";
import type { GraspConfig } from "./config.js";
import { gitInfo, readHistory } from "./git.js";
import { contentHash } from "./hash.js";
import { detectLanguage } from "./languages.js";
import type { ExtractResult, LanguagePack, ResolveContext, Resolver } from "./lang.js";
import { toPosixPath } from "./paths.js";
import { Linker, linkTests, resolveCalls } from "./resolve.js";
import {
  FACTS_SCHEMA_VERSION,
  type CallFact,
  type FileFact,
  type ImportFact,
  type RepoFacts,
  type SymbolFact,
} from "./types.js";
import { listFiles, type WalkResult } from "./walk.js";
import { repoId, sanitizeRemote } from "./workspace.js";

export interface ScanOptions {
  packs: LanguagePack[];
  config: GraspConfig;
  toolVersion: string;
  useGit?: boolean | undefined;
  /** Facts from the last scan. Files with an unchanged hash reuse their extraction. */
  previous?: RepoFacts | undefined;
  onProgress?: ((done: number, total: number) => void) | undefined;
}

export interface ScanResult {
  facts: RepoFacts;
  walk: WalkResult;
  reused: number;
}

/** Roles whose code is worth extracting. Generated, vendored, and fixture code is listed only. */
const PARSE_ROLES = new Set(["source", "test", "config"]);
const CONCURRENCY = 16;

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function isBinary(buf: Buffer): boolean {
  return buf.subarray(0, 8000).includes(0);
}

export async function scanRepo(rootInput: string, opts: ScanOptions): Promise<ScanResult> {
  const root = resolve(rootInput);
  const useGit = opts.useGit ?? true;
  const warnings: string[] = [];
  const info = useGit ? await gitInfo(root) : { isGit: false as const };
  const remote = info.remote ? sanitizeRemote(info.remote) : undefined;

  const walk = await listFiles(root, { ignore: opts.config.ignore, useGit });
  const fileSet = new Set(walk.files);
  const packByLanguage = new Map<string, LanguagePack>();
  for (const p of opts.packs) for (const l of p.languages) packByLanguage.set(l, p);
  await Promise.all(opts.packs.map((p) => p.init()));

  const prevFiles = new Map((opts.previous?.files ?? []).map((f) => [f.path, f]));
  const prevByPath = groupPrevious(opts.previous);
  const maxBytes = opts.config.maxFileSizeKb * 1024;
  let done = 0;
  let reused = 0;

  const perFile = await mapLimit(walk.files, CONCURRENCY, async (path) => {
    const result = await scanFile(
      root,
      path,
      maxBytes,
      packByLanguage,
      prevFiles,
      prevByPath,
      warnings,
    );
    if (result.reused) reused++;
    opts.onProgress?.(++done, walk.files.length);
    return result;
  });

  const files: FileFact[] = [];
  const symbols: SymbolFact[] = [];
  const imports: ImportFact[] = [];
  const calls: CallFact[] = [];
  for (const r of perFile) {
    if (!r.file) continue;
    files.push(r.file);
    if (r.extract) {
      symbols.push(...r.extract.symbols);
      imports.push(...r.extract.imports);
      calls.push(...r.extract.calls);
    }
  }

  const ctx: ResolveContext = {
    root,
    files: fileSet,
    readText: async (p) => {
      try {
        return await readFile(join(root, p), "utf8");
      } catch {
        return undefined;
      }
    },
  };
  const resolvers = new Map<string, Resolver>();
  for (const p of opts.packs) {
    try {
      resolvers.set(p.id, await p.createResolver(ctx));
    } catch (err) {
      warnings.push(`${p.id}: import resolver failed (${(err as Error).message})`);
    }
  }
  const fileByPath = new Map(files.map((f) => [f.path, f]));
  for (const imp of imports) {
    const lang = fileByPath.get(imp.from)?.language ?? "";
    const pack = packByLanguage.get(lang);
    const r = pack ? resolvers.get(pack.id) : undefined;
    if (!r) continue;
    const res = r.resolve(imp.specifier, imp.from);
    imp.resolved = res.resolved;
    imp.external = res.external;
  }
  for (let i = imports.length - 1; i >= 0; i--) {
    const imp = imports[i];
    if (imp?.speculative && !imp.resolved) imports.splice(i, 1);
  }

  const linker = new Linker(symbols, imports);
  resolveCalls(calls, linker);
  const tests = linkTests(files, imports, calls, linker);

  let history: RepoFacts["history"] = {};
  let historyWindow: number | undefined;
  if (info.isGit && opts.config.git.maxCommits > 0) {
    const h = await readHistory(root, opts.config.git.maxCommits);
    history = Object.fromEntries(Object.entries(h.files).filter(([p]) => fileSet.has(p)));
    historyWindow = h.commitsRead;
  }

  // Files are read concurrently, so warning order is otherwise nondeterministic.
  warnings.sort();
  files.sort((a, b) => a.path.localeCompare(b.path));
  symbols.sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      a.range.startLine - b.range.startLine ||
      a.qualifiedName.localeCompare(b.qualifiedName),
  );
  imports.sort(
    (a, b) =>
      a.from.localeCompare(b.from) || a.line - b.line || a.specifier.localeCompare(b.specifier),
  );
  calls.sort(
    (a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.callee.localeCompare(b.callee),
  );

  const facts: RepoFacts = {
    schemaVersion: FACTS_SCHEMA_VERSION,
    toolVersion: opts.toolVersion,
    generatedAt: new Date().toISOString(),
    repo: {
      name: basename(root),
      root: toPosixPath(root),
      id: repoId(toPosixPath(root), remote),
      isGit: info.isGit,
      remote,
      branch: "branch" in info ? info.branch : undefined,
      head: "head" in info ? info.head : undefined,
    },
    files,
    symbols,
    imports,
    calls,
    tests,
    history,
    historyWindow,
    warnings,
  };
  return { facts, walk, reused };
}

interface PrevExtract {
  symbols: SymbolFact[];
  imports: ImportFact[];
  calls: CallFact[];
}

function groupPrevious(prev: RepoFacts | undefined): Map<string, PrevExtract> {
  const out = new Map<string, PrevExtract>();
  if (!prev) return out;
  const get = (p: string) => {
    let e = out.get(p);
    if (!e) out.set(p, (e = { symbols: [], imports: [], calls: [] }));
    return e;
  };
  for (const s of prev.symbols) get(s.path).symbols.push(s);
  // Gotcha: speculative imports that did not resolve last time were dropped, so a
  // submodule added since then is only linked once the importing file changes.
  for (const i of prev.imports)
    get(i.from).imports.push({ ...i, resolved: undefined, external: undefined });
  for (const c of prev.calls) get(c.path).calls.push({ ...c, resolved: undefined });
  return out;
}

interface FileScan {
  file?: FileFact | undefined;
  extract?: ExtractResult | undefined;
  reused: boolean;
}

async function scanFile(
  root: string,
  path: string,
  maxBytes: number,
  packByLanguage: Map<string, LanguagePack>,
  prevFiles: Map<string, FileFact>,
  prevByPath: Map<string, PrevExtract>,
  warnings: string[],
): Promise<FileScan> {
  const abs = join(root, path);
  let size: number;
  try {
    const st = await stat(abs);
    if (!st.isFile()) return { reused: false };
    size = st.size;
  } catch {
    // Listed by git but deleted in the working tree.
    return { reused: false };
  }
  const language = detectLanguage(path);
  let role = classifyFile(path, language);

  if (size > maxBytes) {
    warnings.push(`${path}: ${Math.round(size / 1024)} KB exceeds maxFileSizeKb, not parsed`);
    return {
      file: { path, language, role, size, lines: 0, hash: `size-${size}`, parsed: false },
      reused: false,
    };
  }

  let buf: Buffer;
  try {
    buf = await readFile(abs);
  } catch (err) {
    warnings.push(`${path}: unreadable (${(err as Error).message})`);
    return { reused: false };
  }
  if (isBinary(buf)) {
    return {
      file: {
        path,
        language: "Binary",
        role: "data",
        size,
        lines: 0,
        hash: contentHash(buf),
        parsed: false,
      },
      reused: false,
    };
  }
  // Why: normalize CRLF so a checkout on Windows hashes the same as on Linux.
  const text = buf.toString("utf8").replace(/\r\n/g, "\n");
  const hash = contentHash(text);
  const lines = text.length === 0 ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  if (role === "source" && looksGenerated(text)) role = "generated";

  const pack = packByLanguage.get(language);
  // A language with a pack is code by definition, even if classification found no better role.
  if (pack && (role === "data" || role === "other")) role = "source";
  const file: FileFact = { path, language, role, size, lines, hash, parsed: false };
  if (!pack || !PARSE_ROLES.has(role)) return { file, reused: false };

  const extractor = `${pack.id}@${pack.version}`;
  const prev = prevFiles.get(path);
  if (prev && prev.hash === hash && prev.extractor === extractor && prev.parsed) {
    const cached = prevByPath.get(path) ?? { symbols: [], imports: [], calls: [] };
    return {
      file: { ...prev, role, size },
      extract: { ...cached, hasSyntaxErrors: prev.hasSyntaxErrors ?? false },
      reused: true,
    };
  }

  try {
    const extract = pack.extract(text, path, language);
    file.parsed = true;
    file.extractor = extractor;
    if (extract.hasSyntaxErrors) file.hasSyntaxErrors = true;
    if (extract.isScript) file.isScript = true;
    if (extract.description) file.description = extract.description;
    return { file, extract, reused: false };
  } catch (err) {
    // Fail soft: one bad file must never crash a scan.
    warnings.push(`${path}: extraction failed (${(err as Error).message})`);
    return { file, reused: false };
  }
}
