import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import pc from "picocolors";
import { FactIndex, readJson, writeJson } from "@grasp/core";
import type { ScanReport } from "@grasp/docs";
import {
  checkExplanations,
  ClaudeCodeBackend,
  emptySet,
  estimateUsd,
  FakeBackend,
  planExplanations,
  runExplanations,
  type Audience,
  type Claim,
  type Depth,
  type ExplainOptions,
  type ExplanationSet,
  type LlmBackend,
  type RepoContext,
} from "@grasp/explain";
import { analyze, UserError, type Analysis } from "./analyze.js";
import type { OutputOptions } from "./commands.js";
import { mdToTerminal } from "./terminal.js";

export interface ExplainCliOptions extends OutputOptions {
  explain?: boolean | undefined;
  for?: string | undefined;
  depth?: string | undefined;
  dryRun?: boolean | undefined;
  model?: string | undefined;
  concurrency?: string | undefined;
  maxUnits?: string | undefined;
  maxCost?: string | undefined;
  includeTests?: boolean | undefined;
  yes?: boolean | undefined;
  strict?: boolean | undefined;
}

/** Runs above this many new units ask before spending. */
const CONFIRM_ABOVE = 25;

interface SavedSet {
  backend: string;
  model: string;
  depth: Depth;
  includeTests: boolean;
  set: ExplanationSet;
}

function audienceOf(o: ExplainCliOptions): Audience {
  const a = o.for ?? "dev";
  if (a !== "beginner" && a !== "dev" && a !== "reviewer") {
    throw new UserError(`--for must be beginner, dev, or reviewer`);
  }
  return a;
}

function depthOf(o: ExplainCliOptions): Depth {
  const d = o.depth ?? "symbol";
  if (d === "logic") return "symbol";
  if (d !== "overview" && d !== "file" && d !== "symbol") {
    throw new UserError(`--depth must be overview, file, or symbol`);
  }
  return d;
}

function number(v: string | undefined, flag: string): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new UserError(`${flag} must be a non-negative number`);
  return n;
}

/** Claude Code is the only real backend. `GRASP_BACKEND=fake` exists for tests. */
function makeBackend(o: ExplainCliOptions): LlmBackend {
  if (process.env.GRASP_BACKEND === "fake") return new FakeBackend();
  return new ClaudeCodeBackend({ model: o.model });
}

export function repoContext(r: ScanReport): RepoContext {
  return {
    name: r.repo.name,
    languages: r.languages,
    entryPoints: r.entryPoints,
    readingOrder: r.readingOrder,
    frameworks: r.stack.frameworks.map((f) => ({
      id: f.id,
      name: f.name,
      category: f.category,
      brief: f.brief,
      usedIn: f.usedIn,
      configFiles: f.configFiles,
      packages: f.packages.map((p) => `${p.name} ${p.locked ?? p.declared ?? ""}`.trim()),
    })),
    pipelines: r.pipelines
      .filter((p) => p.parsed)
      .map((p) => ({
        path: p.path,
        name: p.name,
        brief: p.brief,
        steps: p.jobs.flatMap((j) =>
          j.steps.map((s) => ({
            line: s.line,
            label: `job ${j.id}: ${s.name ?? s.uses ?? s.run?.split("\n")[0] ?? "step"}`,
          })),
        ),
      })),
  };
}

function savedPath(a: Analysis, audience: Audience): string {
  return join(a.workspace, "explanations", `${audience}.json`);
}

async function loadSaved(a: Analysis, audience: Audience): Promise<SavedSet | undefined> {
  return readJson<SavedSet>(savedPath(a, audience));
}

function explainOptions(a: Analysis, o: ExplainCliOptions, backend: LlmBackend): ExplainOptions {
  return {
    backend,
    audience: audienceOf(o),
    depth: depthOf(o),
    cacheDir: join(a.workspace, "cache", "explain"),
    readText: a.repo.readText,
    includeTests: o.includeTests ?? false,
    concurrency: number(o.concurrency, "--concurrency") ?? 4,
    maxUnits: number(o.maxUnits, "--max-units"),
    maxCostUsd: number(o.maxCost, "--max-cost"),
  };
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
}

function err(text: string): void {
  process.stderr.write(text.endsWith("\n") ? text : text + "\n");
}

/**
 * Plans, shows the cost, asks when the run is large, then explains. Returns the
 * explanations, merged with earlier ones when only some units were requested.
 */
export async function runExplain(
  a: Analysis,
  o: ExplainCliOptions,
  only?: ExplainOptions["only"],
): Promise<ExplanationSet | undefined> {
  const backend = makeBackend(o);
  if (!(await backend.available())) {
    throw new UserError(
      "Claude Code was not found. Install it (https://claude.com/claude-code) and sign in, then retry. Grasp uses the `claude` command, the same one the VS Code extension uses.",
    );
  }
  const tty = process.stderr.isTTY;
  let failed = 0;
  const opts: ExplainOptions = {
    ...explainOptions(a, o, backend),
    only,
    onProgress: (e) => {
      if (e.status === "failed") failed++;
      if (tty) {
        process.stderr.write(
          `\r\x1b[2KExplaining ${e.done}/${e.total}${failed ? pc.red(` (${failed} failed)`) : ""}  ${pc.dim(e.unit.slice(-60))}`,
        );
      }
    },
  };
  const { plan, wb } = await planExplanations(a.facts, repoContext(a.report), opts);
  const { usd, basis } = estimateUsd(backend.model, plan.inputTokens, plan.outputTokens);
  const counts = (["symbol", "file", "folder", "repo"] as const)
    .map((k) => [k, plan.units.filter((u) => u.kind === k).length] as const)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${k}${n === 1 ? "" : "s"}`)
    .join(", ");
  err(
    [
      `${pc.bold("Explain")} ${counts} for a ${opts.audience} audience with ${backend.label}${backend.model !== "default" ? ` (${backend.model})` : ""}`,
      `  ${plan.cached} already up to date, ${plan.toGenerate} to generate`,
      plan.toGenerate
        ? `  about ${Math.round(plan.inputTokens / 1000)}k input and ${Math.round(plan.outputTokens / 1000)}k output tokens, ` +
          `roughly $${usd.toFixed(2)} at API prices (${basis}); billed to ${backend.billing}`
        : "",
      plan.skippedLarge.length
        ? pc.yellow(`  ${plan.skippedLarge.length} functions over 1,500 lines are skipped`)
        : "",
      `  source is redacted for secrets before it is sent; Claude Code runs with all tools disabled`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  if (o.dryRun) return undefined;
  if (plan.toGenerate > CONFIRM_ABOVE && !o.yes) {
    if (!process.stdin.isTTY) {
      throw new UserError(
        `This run generates ${plan.toGenerate} explanations. Rerun with --yes to confirm, or --dry-run to only estimate.`,
      );
    }
    if (!(await confirm(`Generate ${plan.toGenerate} explanations? [y/N] `)))
      throw new UserError("Cancelled.");
  }

  const result = await runExplanations(plan, wb);
  if (tty) process.stderr.write("\r\x1b[2K");

  const summary = [
    `${pc.bold("Explained")} ${result.generated} new, ${result.cached} cached` +
      (result.failed.length ? pc.red(`, ${result.failed.length} failed`) : "") +
      (result.skipped ? pc.yellow(`, ${result.skipped} skipped`) : ""),
    result.dropped
      ? `  the verifier removed or flagged ${result.dropped} claims whose citations did not hold`
      : "",
    result.costUsd
      ? `  reported cost ${pc.bold(`$${result.costUsd.toFixed(2)}`)} at API prices (billed to ${backend.billing})`
      : "",
    result.stoppedReason ? pc.yellow(`  stopped early: ${result.stoppedReason}`) : "",
    ...result.failed.slice(0, 5).map((f) => pc.red(`  ${f.unit}: ${f.error}`)),
  ];
  err(summary.filter(Boolean).join("\n"));

  // Partial runs (`grasp explain <name>`) merge into what was explained before.
  const previous = await loadSaved(a, opts.audience);
  const set: ExplanationSet = only && previous ? previous.set : emptySet();
  Object.assign(set.symbols, result.set.symbols);
  Object.assign(set.files, result.set.files);
  Object.assign(set.folders, result.set.folders);
  // Saved sets from before frameworks and pipelines were explained lack these maps.
  set.frameworks = { ...(set.frameworks ?? {}), ...result.set.frameworks };
  set.pipelines = { ...(set.pipelines ?? {}), ...result.set.pipelines };
  if (result.set.repo) set.repo = result.set.repo;
  const saved: SavedSet = {
    backend: backend.id,
    model: backend.model,
    depth: previous && only ? previous.depth : opts.depth,
    includeTests: opts.includeTests ?? false,
    set,
  };
  await writeJson(savedPath(a, opts.audience), saved, false);
  return set;
}

export async function docsCheckCommand(path: string, o: ExplainCliOptions): Promise<void> {
  const a = await analyze(path, o);
  const audience = audienceOf(o);
  const saved = await loadSaved(a, audience);
  if (!saved) {
    throw new UserError(
      `No ${audience} explanations yet. Run: grasp docs build --explain --for ${audience}`,
    );
  }
  const backend: LlmBackend = makeBackend({
    ...o,
    model: saved.model === "default" ? undefined : saved.model,
  });
  const opts = explainOptions(
    a,
    { ...o, depth: o.depth ?? saved.depth, includeTests: o.includeTests ?? saved.includeTests },
    backend,
  );
  const c = await checkExplanations(a.facts, repoContext(a.report), saved.set, opts);
  if (o.json) {
    process.stdout.write(JSON.stringify(c, null, 2) + "\n");
  } else {
    const row = (
      name: string,
      x: { expected: number; current: number; stale: number; missing: number },
    ) =>
      `  ${name.padEnd(9)} ${String(x.current).padStart(5)} / ${String(x.expected).padEnd(5)} current` +
      (x.stale ? pc.yellow(`  ${x.stale} stale`) : "") +
      (x.missing ? pc.red(`  ${x.missing} missing`) : "");
    const pct = Math.round(c.completeness * 100);
    process.stdout.write(
      [
        `${pc.bold("Docs check")} ${pct === 100 ? pc.green(`${pct}% complete`) : pc.yellow(`${pct}% complete`)} (${audience})`,
        row("symbols", c.symbols),
        row("files", c.files),
        row("folders", c.folders),
        row("infra", c.infra),
        row("repo", c.repo),
        `  ${c.droppedClaims} claims were removed or flagged by the citation verifier`,
        c.staleUnits.length
          ? pc.yellow(
              `  stale (code changed since explained): ${c.staleUnits.slice(0, 8).join(", ")}${c.staleUnits.length > 8 ? ", …" : ""}`,
            )
          : "",
        c.completeness < 1
          ? pc.dim(`  update with: grasp docs build --explain --for ${audience}`)
          : "",
      ]
        .filter(Boolean)
        .join("\n") + "\n",
    );
  }
  if (o.strict && c.completeness < 1) process.exitCode = 1;
}

function claimsMd(title: string, claims: Claim[], path: string, numbered = false): string[] {
  if (!claims.length) return [];
  return [
    `## ${title}`,
    "",
    ...claims.map(
      (c, i) =>
        `${numbered ? `${i + 1}.` : "-"} ${c.text} \`${path}:${c.start === c.end ? c.start : `${c.start}-${c.end}`}\``,
    ),
    "",
  ];
}

export async function explainCommand(
  query: string,
  path: string,
  o: ExplainCliOptions,
): Promise<void> {
  const a = await analyze(path, o);
  const idx = new FactIndex(a.facts);
  const { files, symbols } = idx.find(query);
  if (!files.length && !symbols.length) {
    throw new UserError(
      `Nothing named "${query}" found. Try a file path, a function name, or Class.method.`,
    );
  }
  if (symbols.length > 1) {
    throw new UserError(
      `${symbols.length} symbols match "${query}": ${symbols
        .slice(0, 6)
        .map((s) => s.id)
        .join(", ")}. Pass one of these ids.`,
    );
  }
  const symbol = symbols[0];
  const file = files[0];
  const set = await runExplain(
    a,
    { ...o, depth: symbol ? "symbol" : "file" },
    symbol ? { symbols: [symbol.id] } : { files: [file?.path ?? ""] },
  );
  if (!set) return;
  if (o.json) {
    process.stdout.write(
      JSON.stringify(symbol ? set.symbols[symbol.id] : set.files[file?.path ?? ""], null, 2) + "\n",
    );
    return;
  }
  const md: string[] = [];
  if (symbol) {
    const e = set.symbols[symbol.id];
    if (!e) throw new UserError(`Could not explain ${symbol.id}. See the error above.`);
    md.push(
      `# ${symbol.qualifiedName}`,
      "",
      `\`${symbol.path}:${symbol.range.startLine}-${symbol.range.endLine}\``,
      "",
      "```",
      symbol.signature,
      "```",
      "",
    );
    md.push(`**${e.doc.summary}**`, "", e.doc.purpose, "");
    if (e.doc.params.length)
      md.push("## Parameters", "", ...e.doc.params.map((p) => `- \`${p.name}\`: ${p.meaning}`), "");
    if (e.doc.returns) md.push(`**Returns:** ${e.doc.returns}`, "");
    md.push(
      ...claimsMd("How it works", e.doc.steps, symbol.path, true),
      ...claimsMd("Branches", e.doc.branches, symbol.path),
      ...claimsMd("Errors", e.doc.errors, symbol.path),
      ...claimsMd("Side effects", e.doc.sideEffects, symbol.path),
      ...claimsMd("Gotchas", e.doc.gotchas, symbol.path),
    );
    md.push(
      `_Generated by ${e.meta.model}; ${e.meta.dropped.length} unverifiable claims removed or flagged._`,
    );
  } else if (file) {
    const e = set.files[file.path];
    if (!e) throw new UserError(`Could not explain ${file.path}. See the error above.`);
    md.push(
      `# ${file.path}`,
      "",
      `**${e.doc.summary}**`,
      "",
      e.doc.overview,
      "",
      `**How it is used:** ${e.doc.role}`,
      "",
    );
    md.push(...claimsMd("Read these parts first", e.doc.highlights, file.path));
    md.push(
      `_Generated by ${e.meta.model}; ${e.meta.dropped.length} unverifiable claims removed or flagged._`,
    );
  }
  process.stdout.write((o.md ? md.join("\n") : mdToTerminal(md.join("\n"))) + "\n");
}
