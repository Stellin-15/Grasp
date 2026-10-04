import type { ImportFact } from "@grasp/core";
import { detectBuild } from "./build.js";
import { detectPipelines } from "./pipelines/index.js";
import { detectStack } from "./stack.js";
import type { InfraReport, RepoView } from "./types.js";

export * from "./types.js";
export { CATALOG, normalizePypi, pythonModulesFor, type CatalogEntry } from "./catalog.js";
export { detectStack } from "./stack.js";
export { detectBuild, scriptKind } from "./build.js";
export {
  readManifests,
  readLockfiles,
  parseRequirement,
  isManifest,
  isLockfile,
} from "./manifests.js";
export {
  detectPipelines,
  isPipelineFile,
  jobEdges,
  jobGraphMermaid,
  localChecks,
} from "./pipelines/index.js";
export { describeUses } from "./pipelines/actions.js";

/** Everything about how this repo is built, tested, shipped, and what it is built with. */
export async function detectInfra(
  repo: RepoView,
  imports: ImportFact[] = [],
): Promise<InfraReport> {
  const stack = await detectStack(repo, imports);
  const [pipelines, build] = await Promise.all([
    detectPipelines(repo),
    detectBuild(repo, stack.dependencies),
  ]);
  return { stack, pipelines, build };
}
