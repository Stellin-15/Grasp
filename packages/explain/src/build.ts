import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  contentHash,
  FactIndex,
  type FileFact,
  type RepoFacts,
  type SymbolFact,
} from "@grasp/core";
import { BackendError, type LlmBackend } from "./backend.js";
import {
  FILE_SCHEMA,
  filePrompt,
  FOLDER_SCHEMA,
  folderPrompt,
  numbered,
  PROMPT_VERSION,
  REPO_SCHEMA,
  repoPrompt,
  SYMBOL_SCHEMA,
  symbolPrompt,
  systemPrompt,
} from "./prompts.js";
import { redactSecrets } from "./redact.js";
import { emptySet, type Audience, type Depth, type ExplanationSet, type Stored } from "./types.js";
import {
  verifyFile,
  verifyFolder,
  verifyRepo,
  verifySymbol,
  type VerifyContext,
} from "./verify.js";

/** Repo-level context the caller already has from the scan report. */
export interface RepoContext {
  name: string;
  languages: { language: string; share: number }[];
  entryPoints: { path: string; reason: string }[];
  readingOrder: { path: string; stage: string; reason: string }[];
  frameworks: { name: string; category: string; brief: string; usedIn: number }[];
  pipelines: { path: string; brief: string }[];
}

export interface ExplainOptions {
  backend: LlmBackend;
  audience: Audience;
  depth: Depth;
  /** Where verified answers are cached, one JSON file per input hash. */
  cacheDir: string;
  readText(path: string): Promise<string | undefined>;
  /** Functions shorter than this get static facts only. */
  minLines?: number | undefined;
  includeTests?: boolean | undefined;
  /** Restrict to these symbol ids and file paths (used by `grasp explain <name>`). */
  only?: { symbols?: string[] | undefined; files?: string[] | undefined } | undefined;
  concurrency?: number | undefined;
  maxUnits?: number | undefined;
  maxCostUsd?: number | undefined;
  onProgress?: ((e: ProgressEvent) => void) | undefined;
}

export interface ProgressEvent {
  done: number;
  total: number;
  unit: string;
  status: "cached" | "generated" | "failed" | "skipped";
}

type UnitKind = "symbol" | "file" | "folder" | "repo";

export interface Unit {
  kind: UnitKind;
  /** Symbol id, file path, folder path, or "." for the repo. */
  key: string;
  inputHash: string;
  /** Hash of the exact source the explanation describes, for freshness checks. */
  sourceHash: string;
  /** Lower runs first. Callees sit below their callers. */
  level: number;
  estInputTokens: number;
  estOutputTokens: number;
  cached: boolean;
}

export interface Plan {
  units: Unit[];
  cached: number;
  toGenerate: number;
  inputTokens: number;
  outputTokens: number;
  skippedLarge: string[];
}

export interface RunResult {
  set: ExplanationSet;
  generated: number;
  cached: number;
  failed: { unit: string; error: string }[];
  skipped: number;
  dropped: number;
  costUsd: number;
  stoppedReason?: string | undefined;
}

const MAX_SYMBOL_LINES = 1500;
const MAX_FILE_SOURCE_LINES = 800;
/** Classes longer than this are shown as header plus member signatures. */
const ABRIDGE_CLASS_LINES = 150;
// Calibrated on real Claude Code runs: thorough answers plus thinking run long.
const OUTPUT_TOKENS: Record<UnitKind, number> = {
  symbol: 2500,
  file: 1200,
  folder: 600,
  repo: 2000,
};

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "." : path.slice(0, i);
}

function oneLine(s: string, max = 300): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function firstSentence(s: string | undefined): string {
  if (!s) return "";
  const t = oneLine(s, 240);
  return /^(.+?[.!?])(\s|$)/.exec(t)?.[1] ?? t;
}

/** Everything one run needs, computed once. */
class Workbench {
  readonly idx: FactIndex;
  readonly texts = new Map<string, string[]>();
  readonly redactions = new Map<string, number>();
  readonly known = new Set<string>();

  constructor(
    readonly facts: RepoFacts,
    readonly ctx: RepoContext,
    readonly opts: ExplainOptions,
  ) {
    this.idx = new FactIndex(facts);
    for (const s of facts.symbols) {
      this.known.add(s.name);
      this.known.add(s.qualifiedName);
      for (const p of s.params) this.known.add(p.name.replace(/^\.\.\./, ""));
    }
    for (const f of facts.files) {
      this.known.add(f.path);
      this.known.add(f.path.slice(f.path.lastIndexOf("/") + 1));
      let d = dirOf(f.path);
      while (d !== ".") {
        this.known.add(d);
        this.known.add(d.slice(d.lastIndexOf("/") + 1));
        d = dirOf(d);
      }
    }
    for (const i of facts.imports)
      if (i.external) this.known.add(i.external.replace(/^(node|python):/, ""));
  }

  /** Redacted source lines, read once per file. Index 0 is line 1. */
  async lines(path: string): Promise<string[]> {
    const cached = this.texts.get(path);
    if (cached) return cached;
    const raw = (await this.opts.readText(path)) ?? "";
    const { text, redactions } = redactSecrets(raw.replace(/\r\n/g, "\n"));
    this.redactions.set(
      path,
      redactions.reduce((a, r) => a + r.count, 0),
    );
    const lines = text.split("\n");
    this.texts.set(path, lines);
    return lines;
  }

  /** Source for a symbol, abridging long classes to header plus member signatures. */
  async slice(s: SymbolFact): Promise<{ text: string; abridged: boolean }> {
    const lines = await this.lines(s.path);
    const { startLine, endLine } = s.range;
    const members = s.kind === "class" ? this.idx.children(s.id) : [];
    const abridged =
      s.kind === "class" && endLine - startLine + 1 > ABRIDGE_CLASS_LINES && members.length > 0;
    if (!abridged)
      return { text: numbered(lines.slice(startLine - 1, endLine), startLine), abridged };
    const width = String(endLine).length;
    const out: string[] = [];
    let skipping = false;
    for (let n = startLine; n <= endLine; n++) {
      const m = members.find((x) => n > x.range.startLine && n <= x.range.endLine);
      if (m) {
        if (!skipping)
          out.push(
            `${" ".repeat(width)} | ${" ".repeat(4)}… (body of \`${m.name}\`, lines ${m.range.startLine}-${m.range.endLine})`,
          );
        skipping = true;
        continue;
      }
      skipping = false;
      out.push(`${String(n).padStart(width)} | ${lines[n - 1] ?? ""}`);
    }
    return { text: out.join("\n"), abridged };
  }
}

function hash(...parts: unknown[]): string {
  return contentHash(JSON.stringify(parts));
}

function selectSymbols(wb: Workbench, files: Set<string>): SymbolFact[] {
  const minLines = wb.opts.minLines ?? 3;
  const onlySymbols = wb.opts.only?.symbols ? new Set(wb.opts.only.symbols) : undefined;
  return wb.facts.symbols.filter((s) => {
    if (onlySymbols) return onlySymbols.has(s.id);
    if (!files.has(s.path)) return false;
    if (s.kind !== "function" && s.kind !== "method" && s.kind !== "class") return false;
    return s.range.endLine - s.range.startLine + 1 >= minLines;
  });
}

/** Callees first: a symbol's level is one more than the highest level among the symbols it calls. */
function symbolLevels(wb: Workbench, symbols: SymbolFact[]): Map<string, number> {
  const selected = new Set(symbols.map((s) => s.id));
  const callees = new Map<string, Set<string>>();
  for (const c of wb.facts.calls) {
    if (!c.resolved || c.resolved === c.from || !selected.has(c.from) || !selected.has(c.resolved))
      continue;
    let set = callees.get(c.from);
    if (!set) callees.set(c.from, (set = new Set()));
    set.add(c.resolved);
  }
  const level = new Map<string, number>();
  const visiting = new Set<string>();
  const visit = (id: string): number => {
    const known = level.get(id);
    if (known !== undefined) return known;
    // A cycle (mutual recursion): treat the back edge as a leaf.
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let l = 0;
    for (const c of callees.get(id) ?? []) l = Math.max(l, visit(c) + 1);
    visiting.delete(id);
    level.set(id, l);
    return l;
  };
  for (const s of symbols) visit(s.id);
  // A class reads best after its members are explained.
  for (const s of symbols) {
    if (s.kind !== "class") continue;
    const members = wb.idx.children(s.id).map((m) => level.get(m.id) ?? -1);
    level.set(s.id, Math.max(level.get(s.id) ?? 0, ...members.map((m) => m + 1)));
  }
  return level;
}

async function cacheExists(dir: string, key: string): Promise<boolean> {
  try {
    await stat(join(dir, `${key}.json`));
    return true;
  } catch {
    return false;
  }
}

/** Decides what to explain and what it will cost. Makes no model calls. */
export async function planExplanations(
  facts: RepoFacts,
  ctx: RepoContext,
  opts: ExplainOptions,
): Promise<{ plan: Plan; wb: Workbench }> {
  const wb = new Workbench(facts, ctx, opts);
  const roles = new Set(opts.includeTests ? ["source", "test"] : ["source"]);
  const onlyFiles = opts.only?.files ? new Set(opts.only.files) : undefined;
  const restricted = !!opts.only;
  const eligible = facts.files.filter((f) =>
    onlyFiles ? onlyFiles.has(f.path) : !restricted && roles.has(f.role) && f.lines > 0,
  );
  const fileSet = new Set(eligible.map((f) => f.path));
  const base = [PROMPT_VERSION, opts.backend.id, opts.backend.model, opts.audience];
  const units: Unit[] = [];
  const skippedLarge: string[] = [];
  const system = systemPrompt(opts.audience).length;
  const est = (chars: number) => Math.ceil((chars + system) / 3.5) + opts.backend.overheadTokens;

  const symbolKeys = new Map<string, string>();
  if (opts.depth === "symbol" || opts.only?.symbols) {
    const symbols = selectSymbols(wb, fileSet);
    const levels = symbolLevels(wb, symbols);
    for (const s of symbols) {
      if (s.range.endLine - s.range.startLine + 1 > MAX_SYMBOL_LINES && s.kind !== "class") {
        skippedLarge.push(s.id);
        continue;
      }
      const { text } = await wb.slice(s);
      const sourceHash = contentHash(text);
      const inputHash = hash(...base, "symbol", s.id, s.signature, sourceHash);
      symbolKeys.set(s.id, inputHash);
      units.push({
        kind: "symbol",
        key: s.id,
        inputHash,
        sourceHash,
        level: levels.get(s.id) ?? 0,
        estInputTokens: est(text.length + 1500),
        estOutputTokens: OUTPUT_TOKENS.symbol,
        cached: false,
      });
    }
  }

  const fileKeys = new Map<string, string>();
  if (opts.depth !== "overview" && !opts.only?.symbols) {
    for (const f of eligible) {
      const symKeys = wb.idx
        .symbolsIn(f.path)
        .map((s) => symbolKeys.get(s.id) ?? "")
        .filter(Boolean);
      const inputHash = hash(...base, "file", opts.depth, f.path, f.hash, symKeys);
      fileKeys.set(f.path, inputHash);
      const withSource = opts.depth === "file" || symKeys.length === 0;
      units.push({
        kind: "file",
        key: f.path,
        inputHash,
        sourceHash: f.hash,
        level: 0,
        estInputTokens: est(1500 + (withSource ? Math.min(f.size, MAX_FILE_SOURCE_LINES * 40) : 0)),
        estOutputTokens: OUTPUT_TOKENS.file,
        cached: false,
      });
    }
  }

  if (!restricted) {
    // Folders that hold explained files, plus their ancestors; deepest first.
    const folders = new Set<string>();
    for (const f of eligible) {
      let d = dirOf(f.path);
      while (d !== ".") {
        folders.add(d);
        d = dirOf(d);
      }
    }
    const folderKeys = new Map<string, string>();
    const byDepth = [...folders].sort(
      (a, b) => b.split("/").length - a.split("/").length || a.localeCompare(b),
    );
    for (const d of byDepth) {
      const childFiles = eligible
        .filter((f) => dirOf(f.path) === d)
        .map((f) => fileKeys.get(f.path) ?? f.hash);
      const childDirs = [...folders]
        .filter((x) => dirOf(x) === d)
        .map((x) => folderKeys.get(x) ?? x);
      const inputHash = hash(...base, "folder", opts.depth, d, childFiles, childDirs);
      folderKeys.set(d, inputHash);
      units.push({
        kind: "folder",
        key: d,
        inputHash,
        sourceHash: hash(childFiles, childDirs),
        level: 1000 - d.split("/").length,
        estInputTokens: est(1500 + childFiles.length * 200),
        estOutputTokens: OUTPUT_TOKENS.folder,
        cached: false,
      });
    }
    const top = [...folderKeys.entries()].filter(([d]) => !d.includes("/")).map(([, k]) => k);
    const inputHash = hash(...base, "repo", opts.depth, top, ctx);
    units.push({
      kind: "repo",
      key: ".",
      inputHash,
      sourceHash: hash(top),
      level: 0,
      estInputTokens: est(4000 + top.length * 300),
      estOutputTokens: OUTPUT_TOKENS.repo,
      cached: false,
    });
  }

  for (const u of units) u.cached = await cacheExists(opts.cacheDir, u.inputHash);
  const todo = units.filter((u) => !u.cached);
  return {
    wb,
    plan: {
      units,
      cached: units.length - todo.length,
      toGenerate: todo.length,
      inputTokens: todo.reduce((a, u) => a + u.estInputTokens, 0),
      outputTokens: todo.reduce((a, u) => a + u.estOutputTokens, 0),
      skippedLarge,
    },
  };
}

// ---------------------------------------------------------------------------
// Prompt construction, one per unit kind. Each returns the prompt plus the
// context the verifier checks the answer against.

interface Prepared {
  prompt: string;
  schema: Record<string, unknown>;
  verify: VerifyContext;
}

async function prepareSymbol(wb: Workbench, set: ExplanationSet, id: string): Promise<Prepared> {
  const s = wb.idx.symbols.get(id);
  if (!s) throw new Error(`unknown symbol ${id}`);
  const file = wb.idx.files.get(s.path) as FileFact;
  const { text, abridged } = await wb.slice(s);
  const summary = (sid: string) =>
    set.symbols[sid]?.doc.summary ?? firstSentence(wb.idx.symbols.get(sid)?.docstring);
  const facts: string[] = [
    `Signature: ${s.signature}`,
    `Exported: ${s.exported ? "yes" : "no"}${s.async ? ", async" : ""}`,
  ];
  if (s.decorators?.length) facts.push(`Decorators: ${s.decorators.join(", ")}`);
  if (s.docstring) facts.push(`Docstring: ${oneLine(s.docstring, 600)}`);
  if (s.params.length) {
    facts.push(
      `Parameters: ${s.params.map((p) => `${p.rest ? "..." : ""}${p.name}${p.type ? `: ${p.type}` : ""}${p.defaultValue ? ` = ${p.defaultValue}` : ""}`).join("; ")}`,
    );
  }
  if (s.returns)
    facts.push(`Declared ${s.kind === "class" ? "type" : "return type"}: ${s.returns}`);
  if (s.parentId) {
    const parent = wb.idx.symbols.get(s.parentId);
    if (parent)
      facts.push(
        `Member of \`${parent.qualifiedName}\`${summary(parent.id) ? `: ${summary(parent.id)}` : ""}`,
      );
  }
  const members = wb.idx.children(s.id);
  if (members.length) {
    facts.push(
      `Members: ${members.map((m) => `\`${m.name}\` (lines ${m.range.startLine}-${m.range.endLine})${summary(m.id) ? `: ${summary(m.id)}` : ""}`).join("; ")}`,
    );
  }
  const callers = wb.idx.callers(s.id);
  if (callers.length) {
    const shown = callers
      .slice(0, 10)
      .map(
        (c) =>
          `${c.path}:${c.line}${wb.idx.symbols.get(c.from) ? ` in \`${wb.idx.symbols.get(c.from)?.qualifiedName}\`` : ""}`,
      );
    facts.push(
      `Called by (${callers.length}): ${shown.join("; ")}${callers.length > 10 ? "; …" : ""}`,
    );
  } else
    facts.push(
      "Called by: no static callers found (may be an entry point, a callback, or called dynamically)",
    );
  const callees = wb.idx.callees(s.id);
  const resolved = [
    ...new Set(callees.filter((c) => c.resolved).map((c) => c.resolved ?? "")),
  ].slice(0, 15);
  for (const r of resolved) {
    const t = wb.idx.symbols.get(r);
    if (t)
      facts.push(
        `Calls \`${t.qualifiedName}\` (${t.path}:${t.range.startLine})${summary(t.id) ? `: ${summary(t.id)}` : ""}`,
      );
  }
  const external = [
    ...new Set(
      callees
        .filter((c) => !c.resolved)
        .map((c) => (c.callee.includes("<expr>") ? `.${c.name}()` : c.callee)),
    ),
  ].slice(0, 20);
  if (external.length)
    facts.push(`Also calls (outside this repo or dynamic): ${external.join(", ")}`);
  const tests = wb.idx.testsFor(s.id);
  if (tests.length) facts.push(`Tested by: ${tests.slice(0, 5).join(", ")}`);
  const known = new Set(wb.known);
  return {
    prompt: symbolPrompt({
      name: s.qualifiedName,
      kind: s.kind,
      path: s.path,
      language: file.language,
      start: s.range.startLine,
      end: s.range.endLine,
      facts,
      source: text,
      abridged,
    }),
    schema: SYMBOL_SCHEMA,
    verify: {
      start: s.range.startLine,
      end: s.range.endLine,
      source: text,
      known,
      paramNames: s.params.map((p) => p.name.replace(/^\.\.\./, "")),
    },
  };
}

async function prepareFile(wb: Workbench, set: ExplanationSet, path: string): Promise<Prepared> {
  const f = wb.idx.files.get(path) as FileFact;
  const facts: string[] = [`Language: ${f.language}, role: ${f.role}, ${f.lines} lines`];
  if (f.description) facts.push(`File docstring: ${oneLine(f.description, 400)}`);
  const entry = wb.ctx.entryPoints.find((e) => e.path === path);
  if (entry) facts.push(`Entry point: ${entry.reason}`);
  const imports = wb.idx.importsOf(path);
  const internal = [...new Set(imports.filter((i) => i.resolved).map((i) => i.resolved ?? ""))];
  const external = [...new Set(imports.filter((i) => i.external).map((i) => i.external ?? ""))];
  if (internal.length)
    facts.push(`Imports from this repo: ${internal.map((p) => `\`${p}\``).join(", ")}`);
  if (external.length) facts.push(`Imports packages: ${external.join(", ")}`);
  const importers = [...new Set(wb.idx.importers(path).map((i) => i.from))];
  if (importers.length)
    facts.push(
      `Imported by (${importers.length}): ${importers
        .slice(0, 15)
        .map((p) => `\`${p}\``)
        .join(", ")}`,
    );
  const tests = wb.idx.testsFor(path);
  if (tests.length) facts.push(`Tests: ${tests.slice(0, 5).join(", ")}`);
  const symbols = wb.idx.symbolsIn(path);
  for (const s of symbols.slice(0, 60)) {
    const sum = set.symbols[s.id]?.doc.summary ?? (firstSentence(s.docstring) || s.signature);
    facts.push(
      `Symbol \`${s.qualifiedName}\` (${s.kind}, lines ${s.range.startLine}-${s.range.endLine}): ${oneLine(sum, 200)}`,
    );
  }
  if (symbols.length > 60) facts.push(`… and ${symbols.length - 60} more symbols`);
  const hasSymbolDocs = symbols.some((s) => set.symbols[s.id]);
  const lines = await wb.lines(path);
  const withSource = (!hasSymbolDocs || symbols.length === 0) && f.lines <= MAX_FILE_SOURCE_LINES;
  const source = withSource ? numbered(lines.slice(0, f.lines), 1) : undefined;
  return {
    prompt: filePrompt({ path, language: f.language, lines: f.lines, facts, source }),
    schema: FILE_SCHEMA,
    verify: {
      start: 1,
      end: Math.max(1, f.lines),
      source: source ?? lines.join("\n"),
      known: wb.known,
    },
  };
}

function prepareFolder(wb: Workbench, set: ExplanationSet, dir: string): Prepared {
  const facts: string[] = [];
  const files = wb.facts.files.filter((f) => dirOf(f.path) === dir && set.files[f.path]);
  for (const f of files) facts.push(`File \`${f.path}\`: ${set.files[f.path]?.doc.summary}`);
  const others = wb.facts.files.filter(
    (f) => dirOf(f.path) === dir && !set.files[f.path] && f.role === "source",
  );
  if (others.length)
    facts.push(`Other source files: ${others.map((f) => `\`${f.path}\``).join(", ")}`);
  for (const [d, e] of Object.entries(set.folders))
    if (dirOf(d) === dir) facts.push(`Subfolder \`${d}/\`: ${e.doc.summary}`);
  const out = new Set<string>();
  const inn = new Set<string>();
  for (const i of wb.facts.imports) {
    if (!i.resolved) continue;
    const from = dirOf(i.from);
    const to = dirOf(i.resolved);
    if (from === dir && to !== dir) out.add(to);
    if (to === dir && from !== dir) inn.add(from);
  }
  if (out.size)
    facts.push(
      `Imports from folders: ${[...out]
        .slice(0, 12)
        .map((d) => `\`${d}/\``)
        .join(", ")}`,
    );
  if (inn.size)
    facts.push(
      `Imported by folders: ${[...inn]
        .slice(0, 12)
        .map((d) => `\`${d}/\``)
        .join(", ")}`,
    );
  return {
    prompt: folderPrompt(dir, facts),
    schema: FOLDER_SCHEMA,
    verify: { start: 1, end: 1, source: facts.join("\n"), known: wb.known },
  };
}

async function prepareRepo(wb: Workbench, set: ExplanationSet): Promise<Prepared> {
  const c = wb.ctx;
  const facts: string[] = [
    `Languages: ${c.languages.map((l) => `${l.language} ${Math.round(l.share * 100)}%`).join(", ")}`,
  ];
  for (const e of c.entryPoints.slice(0, 8)) facts.push(`Entry point \`${e.path}\`: ${e.reason}`);
  facts.push(
    `Reading order (first files): ${c.readingOrder
      .slice(0, 12)
      .map((r) => `\`${r.path}\` (${r.stage})`)
      .join(", ")}`,
  );
  for (const f of c.frameworks.slice(0, 12))
    facts.push(`Uses ${f.name} (${f.category}, imported in ${f.usedIn} files)`);
  for (const p of c.pipelines.slice(0, 6)) facts.push(`Pipeline \`${p.path}\`: ${p.brief}`);
  for (const [d, e] of Object.entries(set.folders))
    if (!d.includes("/")) facts.push(`Folder \`${d}/\`: ${e.doc.summary}`);
  for (const [p, e] of Object.entries(set.files))
    if (!p.includes("/")) facts.push(`Root file \`${p}\`: ${e.doc.summary}`);
  const readme = wb.facts.files.find((f) => /^readme(\.md|\.rst|\.txt)?$/i.test(f.path));
  if (readme) {
    const lines = (await wb.lines(readme.path)).slice(0, 40).join(" ");
    facts.push(`README excerpt: ${oneLine(lines, 1500)}`);
  }
  return {
    prompt: repoPrompt(c.name, facts),
    schema: REPO_SCHEMA,
    verify: { start: 1, end: 1, source: facts.join("\n"), known: wb.known },
  };
}

// ---------------------------------------------------------------------------

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  const delays = [2000, 8000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const delay = delays[attempt];
      if (!(err instanceof BackendError) || !err.retryable || delay === undefined) throw err;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++] as T);
    }),
  );
}

/** Runs a plan: cached units load from disk, the rest go to the backend, are verified, and are cached. */
export async function runExplanations(plan: Plan, wb: Workbench): Promise<RunResult> {
  const { opts } = wb;
  const set = emptySet();
  const result: RunResult = {
    set,
    generated: 0,
    cached: 0,
    failed: [],
    skipped: 0,
    dropped: 0,
    costUsd: 0,
  };
  await mkdir(opts.cacheDir, { recursive: true });
  const system = systemPrompt(opts.audience);
  let attempted = 0;
  let consecutiveFailures = 0;
  let done = 0;

  const put = (u: Unit, stored: Stored<unknown>) => {
    if (u.kind === "symbol") set.symbols[u.key] = stored as ExplanationSet["symbols"][string];
    else if (u.kind === "file") set.files[u.key] = stored as ExplanationSet["files"][string];
    else if (u.kind === "folder") set.folders[u.key] = stored as ExplanationSet["folders"][string];
    else set.repo = stored as ExplanationSet["repo"];
  };

  const runUnit = async (u: Unit) => {
    const report = (status: ProgressEvent["status"]) =>
      opts.onProgress?.({ done: ++done, total: plan.units.length, unit: u.key, status });
    const cachePath = join(opts.cacheDir, `${u.inputHash}.json`);
    if (u.cached) {
      try {
        put(u, JSON.parse(await readFile(cachePath, "utf8")) as Stored<unknown>);
        result.cached++;
        report("cached");
        return;
      } catch {
        // Corrupt cache entry: regenerate below.
      }
    }
    if (result.stoppedReason || (opts.maxUnits !== undefined && attempted >= opts.maxUnits)) {
      result.stoppedReason ??= `reached --max-units ${opts.maxUnits}`;
      result.skipped++;
      report("skipped");
      return;
    }
    attempted++;
    try {
      const prepared =
        u.kind === "symbol"
          ? await prepareSymbol(wb, set, u.key)
          : u.kind === "file"
            ? await prepareFile(wb, set, u.key)
            : u.kind === "folder"
              ? prepareFolder(wb, set, u.key)
              : await prepareRepo(wb, set);
      // Redact the whole prompt, not just source: signatures and docstrings in FACTS can hold secrets too.
      const prompt = redactSecrets(prepared.prompt).text;
      const answer = await withRetry(() =>
        opts.backend.complete({ system, prompt, schema: prepared.schema }),
      );
      const verify = {
        symbol: verifySymbol,
        file: verifyFile,
        folder: verifyFolder,
        repo: verifyRepo,
      }[u.kind];
      const { doc, dropped } = verify(answer.data, prepared.verify);
      const stored: Stored<unknown> = {
        meta: {
          backend: opts.backend.id,
          model: answer.model,
          audience: opts.audience,
          promptVersion: PROMPT_VERSION,
          generatedAt: new Date().toISOString(),
          inputHash: u.inputHash,
          sourceHash: u.sourceHash,
          dropped,
          costUsd: answer.costUsd,
        },
        doc,
      };
      await writeFile(cachePath, JSON.stringify(stored, null, 2) + "\n", "utf8");
      put(u, stored);
      result.generated++;
      result.dropped += dropped.length;
      result.costUsd += answer.costUsd ?? 0;
      consecutiveFailures = 0;
      if (opts.maxCostUsd !== undefined && result.costUsd >= opts.maxCostUsd) {
        result.stoppedReason = `reached --max-cost $${opts.maxCostUsd}`;
      }
      report("generated");
    } catch (err) {
      result.failed.push({ unit: u.key, error: (err as Error).message });
      // Five failures in a row usually means auth, quota, or a missing CLI: stop instead of burning through the plan.
      if (++consecutiveFailures >= 5)
        result.stoppedReason = `stopped after 5 failures in a row: ${(err as Error).message}`;
      report("failed");
    }
  };

  const symbols = plan.units.filter((u) => u.kind === "symbol");
  const levels = [...new Set(symbols.map((u) => u.level))].sort((a, b) => a - b);
  const concurrency = opts.concurrency ?? 4;
  for (const l of levels)
    await pool(
      symbols.filter((u) => u.level === l),
      concurrency,
      runUnit,
    );
  await pool(
    plan.units.filter((u) => u.kind === "file"),
    concurrency,
    runUnit,
  );
  const folders = plan.units.filter((u) => u.kind === "folder");
  for (const l of [...new Set(folders.map((u) => u.level))].sort((a, b) => a - b)) {
    await pool(
      folders.filter((u) => u.level === l),
      concurrency,
      runUnit,
    );
  }
  for (const u of plan.units.filter((x) => x.kind === "repo")) await runUnit(u);
  return result;
}

/** Plan and run in one call. */
export async function explainRepo(
  facts: RepoFacts,
  ctx: RepoContext,
  opts: ExplainOptions,
): Promise<{ plan: Plan; result: RunResult }> {
  const { plan, wb } = await planExplanations(facts, ctx, opts);
  return { plan, result: await runExplanations(plan, wb) };
}

export type { Workbench };
