import {
  buildImportGraph,
  detectEntryPoints,
  isProgrammingLanguage,
  pageRank,
  rankRisk,
  readingOrder,
  type EntryPoint,
  type GraspConfig,
  type ReadingItem,
  type RepoFacts,
  type RiskItem,
} from "@grasp/core";
import type { OnboardGuide } from "@grasp/contribute";
import type { InfraReport, Pipeline } from "@grasp/infra";

export interface LanguageShare {
  language: string;
  files: number;
  lines: number;
  share: number;
}

export interface FolderGap {
  path: string;
  sourceFiles: number;
  /** Share of exported symbols with a docstring or JSDoc, 0..1. */
  docstringCoverage: number;
}

export interface ScanReport {
  repo: {
    name: string;
    remote?: string | undefined;
    branch?: string | undefined;
    head?: string | undefined;
  };
  toolVersion: string;
  summary: {
    files: number;
    sourceFiles: number;
    testFiles: number;
    parsedFiles: number;
    linesOfCode: number;
    symbols: number;
    functions: number;
    classes: number;
    internalImports: number;
    externalPackages: number;
    resolvedCalls: number;
    calls: number;
    syntaxErrorFiles: number;
    secretsSkipped: number;
    historyCommits?: number | undefined;
    docstringCoverage: number;
  };
  languages: LanguageShare[];
  entryPoints: EntryPoint[];
  readingOrder: ReadingItem[];
  risk: RiskItem[];
  hotspots: { path: string; commits: number; authors: number; lastDate: string }[];
  undocumentedFolders: FolderGap[];
  stack: InfraReport["stack"];
  pipelines: Pipeline[];
  build: InfraReport["build"];
  onboarding: OnboardGuide;
  warnings: string[];
}

const README = /^(readme|_about|index)\.(md|mdx|rst|txt)$/i;

function folderOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "." : path.slice(0, i);
}

export interface ReportInput {
  facts: RepoFacts;
  infra: InfraReport;
  onboarding: OnboardGuide;
  config: GraspConfig;
  secretsSkipped?: number | undefined;
  extraWarnings?: string[] | undefined;
}

/** Everything `grasp scan` shows, as plain data. Renderers turn it into Markdown, HTML, or terminal text. */
export function buildReport(input: ReportInput): ScanReport {
  const { facts, infra, onboarding, config } = input;
  const sources = facts.files.filter((f) => f.role === "source");
  const graph = buildImportGraph(facts.files, facts.imports);
  const ranks = pageRank(graph);

  // Entry points: code conventions plus manifests, one entry per file.
  const entries = new Map<string, EntryPoint>();
  for (const e of [...infra.build.entryPoints, ...detectEntryPoints(facts.files, graph)]) {
    const prev = entries.get(e.path);
    entries.set(
      e.path,
      prev
        ? { path: e.path, reason: `${prev.reason}; ${e.reason}` }
        : { path: e.path, reason: e.reason },
    );
  }

  const langs = new Map<string, { files: number; lines: number }>();
  for (const f of facts.files) {
    if (
      !isProgrammingLanguage(f.language) ||
      f.role === "generated" ||
      f.role === "vendored" ||
      f.role === "fixture"
    )
      continue;
    const l = langs.get(f.language) ?? { files: 0, lines: 0 };
    l.files++;
    l.lines += f.lines;
    langs.set(f.language, l);
  }
  const totalLines = [...langs.values()].reduce((a, l) => a + l.lines, 0) || 1;
  const languages = [...langs.entries()]
    .map(([language, l]) => ({
      language,
      ...l,
      share: Math.round((l.lines / totalLines) * 1000) / 1000,
    }))
    .sort((a, b) => b.lines - a.lines || a.language.localeCompare(b.language));

  const roleOf = new Map(facts.files.map((f) => [f.path, f.role]));
  const exported = facts.symbols.filter(
    (s) => s.exported && !s.parentId && roleOf.get(s.path) === "source",
  );
  const documented = exported.filter((s) => s.docstring).length;

  const folders = new Map<
    string,
    { sources: number; hasReadme: boolean; exported: number; documented: number }
  >();
  for (const f of facts.files) {
    const dir = folderOf(f.path);
    const entry = folders.get(dir) ?? { sources: 0, hasReadme: false, exported: 0, documented: 0 };
    if (f.role === "source") entry.sources++;
    if (README.test(f.path.slice(f.path.lastIndexOf("/") + 1))) entry.hasReadme = true;
    folders.set(dir, entry);
  }
  for (const s of exported) {
    const entry = folders.get(folderOf(s.path));
    if (!entry) continue;
    entry.exported++;
    if (s.docstring) entry.documented++;
  }
  const undocumentedFolders = [...folders.entries()]
    .filter(([, v]) => v.sources >= 2 && !v.hasReadme)
    .map(([path, v]) => ({
      path,
      sourceFiles: v.sources,
      docstringCoverage: v.exported ? Math.round((v.documented / v.exported) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.sourceFiles - a.sourceFiles || a.path.localeCompare(b.path));

  const hotspots = sources
    .map((f) => ({ path: f.path, h: facts.history[f.path] }))
    .filter((x) => x.h && x.h.commits > 0)
    .map(({ path, h }) => ({
      path,
      commits: h?.commits ?? 0,
      authors: h?.authors ?? 0,
      lastDate: h?.lastDate ?? "",
    }))
    .sort((a, b) => b.commits - a.commits || a.path.localeCompare(b.path))
    .slice(0, 10);

  const internalImports = facts.imports.filter((i) => i.resolved).length;
  const externalPackages = new Set(
    facts.imports
      .filter((i) => i.external && !/^(node|python):/.test(i.external))
      .map((i) => i.external),
  ).size;

  return {
    repo: {
      name: facts.repo.name,
      remote: facts.repo.remote,
      branch: facts.repo.branch,
      head: facts.repo.head,
    },
    toolVersion: facts.toolVersion,
    summary: {
      files: facts.files.length,
      sourceFiles: sources.length,
      testFiles: facts.files.filter((f) => f.role === "test").length,
      parsedFiles: facts.files.filter((f) => f.parsed).length,
      linesOfCode: sources.reduce((a, f) => a + f.lines, 0),
      symbols: facts.symbols.length,
      functions: facts.symbols.filter((s) => s.kind === "function" || s.kind === "method").length,
      classes: facts.symbols.filter((s) => s.kind === "class").length,
      internalImports,
      externalPackages,
      resolvedCalls: facts.calls.filter((c) => c.resolved).length,
      calls: facts.calls.length,
      syntaxErrorFiles: facts.files.filter((f) => f.hasSyntaxErrors).length,
      secretsSkipped: input.secretsSkipped ?? 0,
      historyCommits: facts.historyWindow,
      docstringCoverage: exported.length
        ? Math.round((documented / exported.length) * 100) / 100
        : 0,
    },
    languages,
    entryPoints: [...entries.values()],
    readingOrder: readingOrder(graph, [...entries.values()], ranks),
    risk: rankRisk(facts.files, facts.symbols, facts.history, ranks, config).slice(0, 20),
    hotspots,
    undocumentedFolders,
    stack: infra.stack,
    pipelines: infra.pipelines,
    build: infra.build,
    onboarding,
    warnings: [...facts.warnings, ...infra.stack.warnings, ...(input.extraWarnings ?? [])],
  };
}
