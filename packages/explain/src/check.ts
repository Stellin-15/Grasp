import type { RepoFacts } from "@grasp/core";
import { planExplanations, type ExplainOptions, type RepoContext } from "./build.js";
import type { ExplanationSet } from "./types.js";

export interface CoverageCount {
  expected: number;
  current: number;
  stale: number;
  missing: number;
}

export interface DocsCheck {
  symbols: CoverageCount;
  files: CoverageCount;
  folders: CoverageCount;
  /** Framework usage and pipeline step explanations. */
  infra: CoverageCount;
  repo: CoverageCount;
  /** Claims the verifier removed or flagged, across all current explanations. */
  droppedClaims: number;
  /** 0..1: current explanations over expected units. */
  completeness: number;
  staleUnits: string[];
  missingUnits: string[];
}

/**
 * Completeness and freshness without any model call: re-plans with the same
 * options and compares each unit's source hash with the stored explanation.
 * Stale means the code changed after it was explained.
 */
export async function checkExplanations(
  facts: RepoFacts,
  ctx: RepoContext,
  set: ExplanationSet,
  opts: ExplainOptions,
): Promise<DocsCheck> {
  const { plan } = await planExplanations(facts, ctx, opts);
  const zero = (): CoverageCount => ({ expected: 0, current: 0, stale: 0, missing: 0 });
  const out: DocsCheck = {
    symbols: zero(),
    files: zero(),
    folders: zero(),
    infra: zero(),
    repo: zero(),
    droppedClaims: 0,
    completeness: 0,
    staleUnits: [],
    missingUnits: [],
  };
  for (const u of plan.units) {
    const stored = {
      symbol: () => set.symbols[u.key],
      file: () => set.files[u.key],
      folder: () => set.folders[u.key],
      framework: () => set.frameworks?.[u.key],
      pipeline: () => set.pipelines?.[u.key],
      repo: () => set.repo,
    }[u.kind]();
    const bucket = {
      symbol: out.symbols,
      file: out.files,
      folder: out.folders,
      framework: out.infra,
      pipeline: out.infra,
      repo: out.repo,
    }[u.kind];
    bucket.expected++;
    if (!stored) {
      bucket.missing++;
      out.missingUnits.push(u.key);
    } else if (stored.meta.sourceHash !== u.sourceHash) {
      bucket.stale++;
      out.staleUnits.push(u.key);
    } else {
      bucket.current++;
      out.droppedClaims += stored.meta.dropped.length;
    }
  }
  const expected = plan.units.length;
  const current =
    out.symbols.current +
    out.files.current +
    out.folders.current +
    out.infra.current +
    out.repo.current;
  out.completeness = expected ? current / expected : 1;
  return out;
}
