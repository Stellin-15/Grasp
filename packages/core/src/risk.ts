import type { GraspConfig } from "./config.js";
import type { FileFact, FileHistory, SymbolFact } from "./types.js";

export interface RiskItem {
  path: string;
  score: number;
  factors: { centrality: number; churn: number; sensitive: number; size: number };
  reasons: string[];
}

/**
 * Ranks source files by how costly it is to misunderstand them. Every factor is
 * normalized to 0..1 against the repo's own maximum, so scores are relative to
 * this repo and not comparable across repos.
 */
export function rankRisk(
  files: FileFact[],
  symbols: SymbolFact[],
  history: Record<string, FileHistory>,
  ranks: Map<string, number>,
  config: GraspConfig,
): RiskItem[] {
  const sources = files.filter((f) => f.role === "source");
  if (sources.length === 0) return [];
  const sensitive = config.risk.sensitivePatterns.map((p) => new RegExp(p, "i"));
  const symbolNames = new Map<string, string[]>();
  for (const s of symbols) symbolNames.set(s.path, [...(symbolNames.get(s.path) ?? []), s.name]);

  const maxRank = Math.max(...sources.map((f) => ranks.get(f.path) ?? 0), Number.EPSILON);
  const maxChurn = Math.max(...sources.map((f) => history[f.path]?.commits ?? 0), 1);
  // Log scale: a 2000-line file is riskier than a 200-line one, but not 10x.
  const maxSize = Math.max(...sources.map((f) => Math.log1p(f.lines)), 1);
  const w = config.risk.weights;

  return sources
    .map((f) => {
      const reasons: string[] = [];
      const centrality = (ranks.get(f.path) ?? 0) / maxRank;
      const commits = history[f.path]?.commits ?? 0;
      const churn = commits / maxChurn;
      const pathHit = sensitive.find((re) => re.test(f.path));
      const symbolHit = (symbolNames.get(f.path) ?? []).find((n) =>
        sensitive.some((re) => re.test(n)),
      );
      const sens = pathHit ? 1 : symbolHit ? 0.6 : 0;
      const size = Math.log1p(f.lines) / maxSize;

      if (centrality >= 0.5) reasons.push("central in the import graph");
      if (churn >= 0.5) reasons.push(`changed often (${commits} commits)`);
      if (pathHit)
        reasons.push(`sensitive path ("${pathHit.exec(f.path)?.[0] ?? pathHit.source}")`);
      else if (symbolHit) reasons.push(`sensitive symbol name (${symbolHit})`);
      if (size >= 0.8) reasons.push(`large (${f.lines} lines)`);

      const score =
        w.centrality * centrality + w.churn * churn + w.sensitive * sens + w.size * size;
      const round = (n: number) => Math.round(n * 1000) / 1000;
      return {
        path: f.path,
        score: round(score),
        factors: {
          centrality: round(centrality),
          churn: round(churn),
          sensitive: sens,
          size: round(size),
        },
        reasons,
      };
    })
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}
