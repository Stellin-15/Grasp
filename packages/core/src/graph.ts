import type { FileFact, ImportFact } from "./types.js";

export interface ImportGraph {
  nodes: string[];
  /** file -> files it imports (in-repo only, deduplicated). */
  out: Map<string, Set<string>>;
  /** file -> files that import it. */
  in: Map<string, Set<string>>;
}

/** Graph over source files. Tests and fixtures are excluded so they do not inflate centrality. */
export function buildImportGraph(files: FileFact[], imports: ImportFact[]): ImportGraph {
  const nodes = files.filter((f) => f.role === "source").map((f) => f.path);
  const nodeSet = new Set(nodes);
  const out = new Map<string, Set<string>>(nodes.map((n) => [n, new Set()]));
  const inn = new Map<string, Set<string>>(nodes.map((n) => [n, new Set()]));
  for (const imp of imports) {
    if (!imp.resolved || imp.resolved === imp.from) continue;
    if (!nodeSet.has(imp.from) || !nodeSet.has(imp.resolved)) continue;
    out.get(imp.from)?.add(imp.resolved);
    inn.get(imp.resolved)?.add(imp.from);
  }
  return { nodes, out, in: inn };
}

/**
 * Standard PageRank. An import edge A -> B passes A's rank to B, so files that
 * many important files depend on rank highest. Dangling nodes spread evenly.
 */
export function pageRank(graph: ImportGraph, damping = 0.85, iterations = 50): Map<string, number> {
  const n = graph.nodes.length;
  const rank = new Map<string, number>();
  if (n === 0) return rank;
  for (const node of graph.nodes) rank.set(node, 1 / n);
  for (let i = 0; i < iterations; i++) {
    let dangling = 0;
    for (const node of graph.nodes) {
      if ((graph.out.get(node)?.size ?? 0) === 0) dangling += rank.get(node) ?? 0;
    }
    const next = new Map<string, number>();
    for (const node of graph.nodes) next.set(node, (1 - damping) / n + (damping * dangling) / n);
    for (const node of graph.nodes) {
      const targets = graph.out.get(node);
      if (!targets || targets.size === 0) continue;
      const share = (damping * (rank.get(node) ?? 0)) / targets.size;
      for (const t of targets) next.set(t, (next.get(t) ?? 0) + share);
    }
    for (const [k, v] of next) rank.set(k, v);
  }
  return rank;
}

export interface EntryPoint {
  path: string;
  reason: string;
}

const ENTRY_NAMES = /^(main|index|app|server|cli|manage|wsgi|asgi|run|__main__)\.[a-z]+$/;

/** Entry points visible from code alone. Manifests (package.json bin, pyproject scripts) add more. */
export function detectEntryPoints(files: FileFact[], graph: ImportGraph): EntryPoint[] {
  const out: EntryPoint[] = [];
  for (const f of files) {
    if (f.role !== "source") continue;
    const base = f.path.slice(f.path.lastIndexOf("/") + 1);
    const depth = f.path.split("/").length - 1;
    if (base === "__main__.py") out.push({ path: f.path, reason: "package __main__ module" });
    else if (f.isScript) out.push({ path: f.path, reason: "runs as a script (main guard)" });
    else if (ENTRY_NAMES.test(base) && depth <= 2 && (graph.in.get(f.path)?.size ?? 0) === 0) {
      out.push({
        path: f.path,
        reason: `conventional entry file name, not imported by other files`,
      });
    }
  }
  return out;
}

export type ReadingStage = "entry" | "core" | "leaf";

export interface ReadingItem {
  path: string;
  stage: ReadingStage;
  rank: number;
  importedBy: number;
  imports: number;
  reason: string;
}

/**
 * Order for reading an unfamiliar codebase: entry points (where execution
 * starts), then the core (what most code depends on), then everything else.
 */
export function readingOrder(
  graph: ImportGraph,
  entryPoints: EntryPoint[],
  ranks: Map<string, number> = pageRank(graph),
): ReadingItem[] {
  const nodeSet = new Set(graph.nodes);
  const entryReasons = new Map<string, string>();
  for (const e of entryPoints) {
    if (nodeSet.has(e.path) && !entryReasons.has(e.path)) entryReasons.set(e.path, e.reason);
  }
  const sortedRanks = [...ranks.values()].sort((a, b) => b - a);
  // Top 15% by rank counts as core, but never fewer than files imported by 2+ others.
  const coreCut = sortedRanks[Math.max(0, Math.ceil(sortedRanks.length * 0.15) - 1)] ?? Infinity;

  const items: ReadingItem[] = graph.nodes.map((path) => {
    const importedBy = graph.in.get(path)?.size ?? 0;
    const imports = graph.out.get(path)?.size ?? 0;
    const rank = ranks.get(path) ?? 0;
    const entryReason = entryReasons.get(path);
    if (entryReason)
      return { path, stage: "entry", rank, importedBy, imports, reason: entryReason };
    const isCore = importedBy >= 2 || (importedBy >= 1 && rank >= coreCut);
    const reason = isCore
      ? `imported by ${importedBy} file${importedBy === 1 ? "" : "s"}`
      : importedBy === 0 && imports === 0
        ? "standalone (no in-repo imports either way)"
        : `imported by ${importedBy}, imports ${imports}`;
    return { path, stage: isCore ? "core" : "leaf", rank, importedBy, imports, reason };
  });

  const stageOrder: Record<ReadingStage, number> = { entry: 0, core: 1, leaf: 2 };
  return items.sort(
    (a, b) =>
      stageOrder[a.stage] - stageOrder[b.stage] ||
      // Entry points that reach more code come first.
      (a.stage === "entry" ? b.imports - a.imports : 0) ||
      b.rank - a.rank ||
      a.path.localeCompare(b.path),
  );
}
