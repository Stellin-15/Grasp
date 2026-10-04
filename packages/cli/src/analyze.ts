import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  FACTS_SCHEMA_VERSION,
  gitInfo,
  loadConfig,
  readJson,
  repoId,
  resolveWorkspace,
  sanitizeRemote,
  scanRepo,
  toPosixPath,
  writeJson,
  type GraspConfig,
  type RepoFacts,
  type WalkResult,
} from "@grasp/core";
import { buildOnboarding, type OnboardGuide } from "@grasp/contribute";
import { buildReport, type ScanReport } from "@grasp/docs";
import { detectInfra, type InfraReport, type RepoView } from "@grasp/infra";
import { defaultPacks } from "@grasp/langs";
import { VERSION } from "./version.js";

export interface CommonOptions {
  workspace?: string | undefined;
  inRepo?: boolean | undefined;
  git?: boolean | undefined;
}

export interface Analysis {
  root: string;
  workspace: string;
  config: GraspConfig;
  facts: RepoFacts;
  walk: WalkResult;
  infra: InfraReport;
  onboarding: OnboardGuide;
  report: ScanReport;
  repo: RepoView;
  reused: number;
  ms: number;
}

export class UserError extends Error {}

function progress(message: string): void {
  // Progress goes to stderr so `--json` output on stdout stays machine-readable.
  if (process.stderr.isTTY) process.stderr.write(`\r\x1b[2K${message}`);
}

function clearProgress(): void {
  if (process.stderr.isTTY) process.stderr.write("\r\x1b[2K");
}

export async function analyze(pathArg: string, opts: CommonOptions): Promise<Analysis> {
  const started = Date.now();
  const root = resolve(pathArg);
  const st = await stat(root).catch(() => undefined);
  if (!st?.isDirectory()) throw new UserError(`Not a directory: ${pathArg}`);

  const useGit = opts.git !== false;
  const info = useGit ? await gitInfo(root) : { isGit: false };
  const remote = "remote" in info && info.remote ? sanitizeRemote(info.remote) : undefined;
  const id = repoId(toPosixPath(root), remote);
  const workspace = resolveWorkspace(root, id, { dir: opts.workspace, inRepo: opts.inRepo });

  const { config, warnings: configWarnings } = await loadConfig(root, workspace);
  const previous = await readJson<RepoFacts>(join(workspace, "facts.json"));
  const usablePrevious =
    previous?.schemaVersion === FACTS_SCHEMA_VERSION && previous.toolVersion === VERSION
      ? previous
      : undefined;

  progress("Scanning files…");
  const { facts, walk, reused } = await scanRepo(root, {
    packs: defaultPacks(),
    config,
    toolVersion: VERSION,
    useGit,
    previous: usablePrevious,
    onProgress: (done, total) => {
      if (done % 200 === 0 || done === total) progress(`Scanning files… ${done}/${total}`);
    },
  });

  progress("Reading manifests and pipelines…");
  const repo: RepoView = {
    files: walk.files,
    readText: (p) => readFile(join(root, p), "utf8").catch(() => undefined),
  };
  const infra = await detectInfra(repo, facts.imports);
  const onboarding = await buildOnboarding(repo, infra);
  const report = buildReport({
    facts,
    infra,
    onboarding,
    config,
    secretsSkipped: walk.secretsSkipped,
    extraWarnings: configWarnings,
  });
  clearProgress();

  await writeJson(join(workspace, "facts.json"), facts);
  await writeJson(join(workspace, "report.json"), report);
  return {
    root,
    workspace,
    config,
    facts,
    walk,
    infra,
    onboarding,
    report,
    repo,
    reused,
    ms: Date.now() - started,
  };
}
