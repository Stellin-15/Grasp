import { rm } from "node:fs/promises";
import { join } from "node:path";
import pc from "picocolors";
import {
  blame,
  FactIndex,
  summarizeRange,
  writeFileAtomic,
  type BlameLine,
  type FileFact,
  type SymbolFact,
} from "@grasp/core";
import {
  buildReference,
  pagesToHtml,
  pageToHtml,
  renderOnboarding,
  renderPipelines,
  renderReadingOrder,
  renderReport,
  renderStack,
} from "@grasp/docs";
import { analyze, UserError, type Analysis, type CommonOptions } from "./analyze.js";
import { mdToTerminal } from "./terminal.js";

export interface OutputOptions extends CommonOptions {
  json?: boolean | undefined;
  md?: boolean | undefined;
}

function print(text: string): void {
  process.stdout.write(text.endsWith("\n") ? text : text + "\n");
}

function emit(a: Analysis, opts: OutputOptions, data: unknown, markdown: string): void {
  if (opts.json) print(JSON.stringify(data, null, 2));
  else if (opts.md) print(markdown);
  else print(mdToTerminal(markdown));
}

const pct = (n: number) => (n > 0 && n < 0.005 ? "<1%" : `${Math.round(n * 100)}%`);
const shortPath = (p: string, max = 48) => (p.length > max ? "…" + p.slice(p.length - max + 1) : p);

/** The first screen a new user sees: dense, scannable, and pointing at what to do next. */
function scanSummary(a: Analysis): string {
  const r = a.report;
  const s = r.summary;
  const out: string[] = [];
  const where = [r.repo.branch, r.repo.head?.slice(0, 7)].filter(Boolean).join(" @ ");
  out.push(
    `${pc.bold(pc.magenta("Grasp"))} ${pc.bold(r.repo.name)}${where ? pc.dim(`  ${where}`) : ""}`,
  );
  out.push(
    `  ${s.files} files · ${s.sourceFiles} source · ${s.testFiles} test · ${s.linesOfCode.toLocaleString("en-US")} lines · ` +
      `${s.functions} functions · ${s.classes} classes`,
  );
  out.push(
    `  ${
      r.languages
        .slice(0, 5)
        .map((l) => `${l.language} ${pct(l.share)}`)
        .join(", ") || "no supported languages found"
    }`,
  );
  out.push(
    pc.dim(
      `  ${s.resolvedCalls}/${s.calls} calls resolved · docstring coverage ${pct(s.docstringCoverage)} · ${a.ms} ms${a.reused ? ` (${a.reused} files cached)` : ""}`,
    ),
  );

  const section = (title: string) => out.push("", pc.bold(title));
  section("Start here");
  for (const [i, it] of r.readingOrder.slice(0, 7).entries()) {
    const tag =
      it.stage === "entry"
        ? pc.green("entry")
        : it.stage === "core"
          ? pc.yellow("core ")
          : pc.dim("leaf ");
    out.push(
      `  ${String(i + 1).padStart(2)}. ${tag}  ${pc.cyan(shortPath(it.path).padEnd(40))} ${pc.dim(it.reason)}`,
    );
  }
  if (r.readingOrder.length > 7) out.push(pc.dim(`      … full order: grasp order`));

  if (r.risk.length) {
    section("Riskiest to misunderstand");
    for (const x of r.risk.slice(0, 5)) {
      out.push(
        `  ${x.score.toFixed(2)}  ${pc.cyan(shortPath(x.path).padEnd(40))} ${pc.dim(x.reasons.join("; ") || "-")}`,
      );
    }
  }

  if (r.stack.frameworks.length || r.stack.runtimes.length) {
    section("Stack");
    const rt = [...new Map(r.stack.runtimes.map((x) => [x.name, x])).values()].map(
      (x) => `${x.name} ${x.version}`,
    );
    if (rt.length) out.push(`  ${pc.dim("runtime")}  ${rt.join(", ")}`);
    for (const f of r.stack.frameworks.slice(0, 8)) {
      const v = f.packages[0]?.locked ?? f.packages[0]?.declared ?? "";
      const used = f.usedIn.length
        ? `used in ${f.usedIn.length} file${f.usedIn.length === 1 ? "" : "s"}`
        : "";
      out.push(
        `  ${pc.bold(f.name)} ${pc.dim(v)}  ${pc.dim(`${f.category}${used ? " · " + used : ""}`)}`,
      );
    }
    if (r.stack.frameworks.length > 8)
      out.push(pc.dim(`  … ${r.stack.frameworks.length - 8} more: grasp stack`));
  }

  if (r.pipelines.length) {
    section("Pipelines");
    for (const p of r.pipelines.slice(0, 6))
      out.push(`  ${pc.cyan(shortPath(p.path, 36))}  ${p.brief}`);
  }

  if (r.hotspots.length) {
    section("Hotspots");
    out.push(
      "  " +
        r.hotspots
          .slice(0, 5)
          .map((h) => `${pc.cyan(shortPath(h.path, 36))} ${pc.dim(`(${h.commits})`)}`)
          .join("  "),
    );
  }
  if (r.undocumentedFolders.length) {
    section("Folders without a README");
    out.push(
      "  " +
        r.undocumentedFolders
          .slice(0, 6)
          .map((f) => `${pc.cyan(f.path + "/")} ${pc.dim(`(${f.sourceFiles} files)`)}`)
          .join("  "),
    );
  }
  if (r.warnings.length) {
    out.push(
      "",
      pc.yellow(`${r.warnings.length} warning${r.warnings.length === 1 ? "" : "s"}`) +
        pc.dim(" (see report.md)"),
    );
  }
  if (a.walk.secretsSkipped)
    out.push(
      pc.dim(`${a.walk.secretsSkipped} secret-looking file(s) were skipped and never read.`),
    );

  out.push(
    "",
    pc.bold("Next"),
    `  ${pc.cyan("grasp onboard")}        how to set up, run, and test this project`,
    `  ${pc.cyan("grasp show <name>")}    any function or file: signature, callers, callees, tests, history`,
    `  ${pc.cyan("grasp docs build")}     full cross-linked reference for every file and symbol`,
    "",
    pc.dim(`Report: ${join(a.workspace, "report.html")}`),
  );
  return out.join("\n");
}

export async function scanCommand(path: string, opts: OutputOptions): Promise<void> {
  const a = await analyze(path, opts);
  const md = renderReport(a.report);
  await writeFileAtomic(join(a.workspace, "report.md"), md);
  await writeFileAtomic(
    join(a.workspace, "report.html"),
    pageToHtml({ path: "report.md", title: a.report.repo.name, markdown: md }),
  );
  if (opts.json) print(JSON.stringify(a.report, null, 2));
  else if (opts.md) print(md);
  else print(scanSummary(a));
}

export async function stackCommand(path: string, opts: OutputOptions): Promise<void> {
  const a = await analyze(path, opts);
  emit(a, opts, { ...a.infra.stack, quality: a.infra.build.quality }, renderStack(a.report));
}

export async function pipelinesCommand(path: string, opts: OutputOptions): Promise<void> {
  const a = await analyze(path, opts);
  emit(a, opts, a.infra.pipelines, renderPipelines(a.infra.pipelines));
}

export async function onboardCommand(path: string, opts: OutputOptions): Promise<void> {
  const a = await analyze(path, opts);
  emit(a, opts, a.onboarding, renderOnboarding(a.onboarding));
}

export async function orderCommand(
  path: string,
  opts: OutputOptions & { limit?: string },
): Promise<void> {
  const a = await analyze(path, opts);
  const limit = opts.limit ? Number(opts.limit) : 30;
  emit(a, opts, a.report.readingOrder, renderReadingOrder(a.report, { readingLimit: limit }));
}

function symbolDetail(idx: FactIndex, s: SymbolFact, history?: (BlameLine | undefined)[]): string {
  const out: string[] = [];
  out.push(
    `${pc.bold(pc.magenta(s.qualifiedName))} ${pc.dim(s.kind)}  ${pc.cyan(`${s.path}:${s.range.startLine}-${s.range.endLine}`)}`,
  );
  out.push("  " + s.signature);
  const flags = [
    s.exported ? (s.defaultExport ? "default export" : "exported") : "internal",
    s.async ? "async" : "",
    ...(s.decorators ?? []),
  ].filter(Boolean);
  out.push(pc.dim("  " + flags.join(" · ")));
  if (s.docstring) out.push("", ...s.docstring.split("\n").map((l) => pc.dim("  │ ") + l));
  if (s.params.length) {
    out.push("", pc.bold("Parameters"));
    for (const p of s.params) {
      out.push(
        `  ${pc.cyan((p.rest ? "..." : "") + p.name)}${p.type ? pc.dim(": " + p.type) : ""}${p.defaultValue ? pc.dim(" = " + p.defaultValue) : ""}`,
      );
    }
  }
  if (s.returns)
    out.push(
      "",
      `${pc.bold(s.kind === "constant" || s.kind === "variable" ? "Type" : "Returns")}  ${s.returns}`,
    );
  const members = idx.children(s.id);
  if (members.length)
    out.push("", pc.bold("Members"), "  " + members.map((m) => m.name).join(", "));
  const callers = idx.callers(s.id);
  out.push("", pc.bold(`Called by (${callers.length})`));
  if (!callers.length)
    out.push(
      pc.dim(
        "  no static callers found (may be an entry point, a callback, or called dynamically)",
      ),
    );
  for (const c of callers.slice(0, 25)) {
    const from = idx.symbols.get(c.from);
    out.push(
      `  ${pc.cyan(`${c.path}:${c.line}`)}  ${from ? from.qualifiedName : pc.dim("top level of file")}`,
    );
  }
  const callees = idx.callees(s.id);
  const resolved = [...new Set(callees.filter((c) => c.resolved).map((c) => c.resolved ?? ""))];
  const unresolved = [...new Set(callees.filter((c) => !c.resolved).map((c) => c.callee))];
  if (resolved.length || unresolved.length) {
    out.push("", pc.bold("Calls"));
    for (const r of resolved.slice(0, 25)) {
      const t = idx.symbols.get(r);
      if (t) out.push(`  ${t.qualifiedName}  ${pc.dim(`${t.path}:${t.range.startLine}`)}`);
    }
    if (unresolved.length)
      out.push(
        pc.dim(
          `  outside the repo or dynamic: ${unresolved.slice(0, 20).join(", ")}${unresolved.length > 20 ? ", …" : ""}`,
        ),
      );
  }
  const tests = idx.testsFor(s.id);
  out.push(
    "",
    pc.bold("Tested by"),
    tests.length
      ? tests.map((t) => "  " + pc.cyan(t)).join("\n")
      : pc.dim("  no linked tests found"),
  );
  if (history?.length) {
    const h = summarizeRange(history, s.range.startLine, s.range.endLine);
    if (h.introduced) {
      const fmt = (b: BlameLine) =>
        `${b.hash.slice(0, 7)} ${b.date.slice(0, 10)} ${b.author}: ${b.subject}`;
      out.push("", pc.bold("History"), `  introduced  ${fmt(h.introduced)}`);
      if (h.lastChanged && h.lastChanged.hash !== h.introduced.hash)
        out.push(`  last change ${fmt(h.lastChanged)}`);
      out.push(pc.dim(`  ${h.commits.length} commit(s) own the current lines (from git blame)`));
    }
  }
  return out.join("\n");
}

function fileDetail(a: Analysis, idx: FactIndex, f: FileFact): string {
  const out: string[] = [];
  const h = a.facts.history[f.path];
  out.push(
    `${pc.bold(pc.magenta(f.path))}  ${pc.dim(`${f.language} · ${f.role} · ${f.lines} lines`)}`,
  );
  if (h)
    out.push(
      pc.dim(`  ${h.commits} commits by ${h.authors} author(s), last ${h.lastDate.slice(0, 10)}`),
    );
  if (f.description) out.push("", ...f.description.split("\n").map((l) => pc.dim("  │ ") + l));
  const symbols = idx.symbolsIn(f.path);
  if (symbols.length) {
    out.push("", pc.bold(`Symbols (${symbols.length})`));
    for (const s of symbols) {
      const indent = s.parentId ? "    " : "  ";
      out.push(
        `${indent}${pc.cyan(s.name)} ${pc.dim(`${s.kind} · line ${s.range.startLine} · ${idx.callers(s.id).length} callers`)}`,
      );
    }
  }
  const imports = idx.importsOf(f.path);
  if (imports.length) {
    out.push("", pc.bold("Imports"));
    for (const i of imports)
      out.push(
        `  ${pc.dim(String(i.line).padStart(4))}  ${i.specifier}${i.resolved ? pc.dim(` → ${i.resolved}`) : ""}`,
      );
  }
  const importers = [...new Set(idx.importers(f.path).map((i) => i.from))];
  if (importers.length)
    out.push(
      "",
      pc.bold(`Imported by (${importers.length})`),
      ...importers.slice(0, 25).map((p) => "  " + pc.cyan(p)),
    );
  const tests = idx.testsFor(f.path);
  if (tests.length) out.push("", pc.bold("Tests"), ...tests.map((t) => "  " + pc.cyan(t)));
  return out.join("\n");
}

export async function showCommand(query: string, path: string, opts: OutputOptions): Promise<void> {
  const a = await analyze(path, opts);
  const idx = new FactIndex(a.facts);
  const { files, symbols } = idx.find(query);
  if (!files.length && !symbols.length) {
    throw new UserError(
      `Nothing named "${query}" found. Try a file path, a function name, or Class.method.`,
    );
  }
  if (opts.json) {
    print(
      JSON.stringify(
        {
          files,
          symbols: symbols.map((s) => ({
            ...s,
            callers: idx.callers(s.id),
            callees: idx.callees(s.id),
            tests: idx.testsFor(s.id),
          })),
        },
        null,
        2,
      ),
    );
    return;
  }
  if (symbols.length > 1) {
    print(pc.bold(`${symbols.length} symbols match "${query}":`));
    for (const s of symbols.slice(0, 40))
      print(`  ${pc.cyan(s.id)}  ${pc.dim(`${s.kind} · line ${s.range.startLine}`)}`);
    print(pc.dim(`\nShow one with: grasp show "${symbols[0]?.id}"`));
    return;
  }
  const s = symbols[0];
  if (s) {
    const history = a.facts.repo.isGit ? await blame(a.root, s.path) : undefined;
    print(symbolDetail(idx, s, history));
    return;
  }
  for (const f of files.slice(0, 5)) print(fileDetail(a, idx, f));
}

async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++] as T);
    }),
  );
}

export async function docsBuildCommand(
  path: string,
  opts: OutputOptions & { history?: boolean; format?: string; historyLimit?: string },
): Promise<void> {
  const a = await analyze(path, opts);
  const format = opts.format ?? "all";
  if (!["md", "html", "all"].includes(format))
    throw new UserError(`--format must be md, html, or all`);

  const blameByFile = new Map<string, (BlameLine | undefined)[]>();
  if (opts.history !== false && a.facts.repo.isGit) {
    const limit = opts.historyLimit ? Number(opts.historyLimit) : 2000;
    const withSymbols = [...new Set(a.facts.symbols.map((s) => s.path))].slice(0, limit);
    let done = 0;
    await mapLimit(withSymbols, 8, async (p) => {
      blameByFile.set(p, await blame(a.root, p));
      if (process.stderr.isTTY)
        process.stderr.write(`\r\x1b[2KReading history… ${++done}/${withSymbols.length}`);
    });
    if (process.stderr.isTTY) process.stderr.write("\r\x1b[2K");
  }

  const pages = buildReference(a.facts, a.report, { blame: blameByFile });
  const outDir = join(a.workspace, "docs");
  // Why: pages for deleted files must not linger. The docs folder belongs to Grasp.
  await rm(outDir, { recursive: true, force: true });
  const write = async (list: { path: string; markdown: string }[]) => {
    await mapLimit(list, 16, (p) => writeFileAtomic(join(outDir, p.path), p.markdown));
  };
  if (format !== "html") await write(pages);
  if (format !== "md") await write(pagesToHtml(pages));

  const symbolCount = a.facts.symbols.length;
  const filePages = pages.filter(
    (p) => p.path.startsWith("files/") && !p.path.endsWith("_folder.md"),
  ).length;
  if (opts.json) {
    print(
      JSON.stringify({ outDir, pages: pages.length, filePages, symbols: symbolCount }, null, 2),
    );
    return;
  }
  print(
    `${pc.bold(pc.magenta("Grasp"))} wrote ${pages.length} pages (${filePages} files, ${symbolCount} symbols${blameByFile.size ? `, history for ${blameByFile.size} files` : ""})`,
  );
  if (format !== "html") print(`  ${pc.cyan(join(outDir, "index.md"))}`);
  if (format !== "md") print(`  ${pc.cyan(join(outDir, "index.html"))}`);
  print(
    pc.dim(
      "These are static facts. LLM-written explanations of each function's logic arrive in Phase 2.",
    ),
  );
}
