/** Read access to the repo. Paths are POSIX and relative to the repo root. */
export interface RepoView {
  files: readonly string[];
  readText(path: string): Promise<string | undefined>;
}

/** A place in the repo that backs a statement, so docs can cite it. */
export interface Citation {
  path: string;
  line: number;
}

export type Ecosystem = "npm" | "pypi" | "go" | "cargo" | "maven" | "gem" | "composer";

export interface Dependency {
  ecosystem: Ecosystem;
  name: string;
  /** Version range as declared in the manifest. */
  declared?: string | undefined;
  /** Exact version from a lockfile, when one exists. */
  locked?: string | undefined;
  scope: "runtime" | "dev" | "peer" | "optional" | "build";
  manifest: Citation;
}

export interface FrameworkUsage {
  id: string;
  name: string;
  category: string;
  /** Two or three sentences for someone who has never used it. Static catalog text. */
  brief: string;
  docs: string;
  /** Matching dependencies (one framework can span several packages). */
  packages: Dependency[];
  /** Files that import it, with the first import line. */
  usedIn: Citation[];
  /** Config files that control it. */
  configFiles: string[];
}

export interface Runtime {
  name: string;
  version: string;
  source: Citation;
}

export interface PackageManager {
  name: string;
  evidence: string;
  install: string;
}

export interface StackReport {
  runtimes: Runtime[];
  packageManagers: PackageManager[];
  dependencies: Dependency[];
  frameworks: FrameworkUsage[];
  warnings: string[];
}

export type PipelineSystem =
  | "github-actions"
  | "gitlab-ci"
  | "circleci"
  | "azure-pipelines"
  | "pre-commit"
  | "jenkins"
  | "travis"
  | "bitbucket"
  | "drone"
  | "buildkite"
  | "appveyor"
  | "cloud-build";

export interface Trigger {
  event: string;
  detail?: string | undefined;
  line?: number | undefined;
}

export interface PipelineStep {
  name?: string | undefined;
  /** Reusable action, orb, task, or hook reference. */
  uses?: string | undefined;
  /** Brief idea of the reusable action, from the catalog. */
  usesBrief?: string | undefined;
  run?: string | undefined;
  line: number;
}

export interface PipelineJob {
  id: string;
  name?: string | undefined;
  /** Runner label, VM image, or container image. */
  runsOn?: string | undefined;
  stage?: string | undefined;
  needs: string[];
  matrix?: Record<string, string[]> | undefined;
  services?: string[] | undefined;
  environment?: string | undefined;
  condition?: string | undefined;
  steps: PipelineStep[];
  line: number;
}

export interface Pipeline {
  system: PipelineSystem;
  path: string;
  name: string;
  /** False when the file was detected but not parsed (unsupported system or invalid YAML). */
  parsed: boolean;
  error?: string | undefined;
  triggers: Trigger[];
  runsOnPullRequests: boolean;
  jobs: PipelineJob[];
  /** Secret or CI variable names referenced. Never values. */
  secrets: string[];
  purposes: string[];
  /** Generated one-sentence summary, built from the parsed facts. */
  brief: string;
  deploys: { target: string; evidence: string; line: number }[];
}

export interface Script {
  source: "npm" | "make" | "just" | "python-entry" | "tox" | "nox" | "task" | "composer";
  name: string;
  command: string;
  description?: string | undefined;
  kind: "build" | "test" | "lint" | "format" | "dev" | "start" | "release" | "setup" | "other";
  at: Citation;
}

export interface EnvVar {
  name: string;
  description?: string | undefined;
  /** Where it is declared (templates, compose) or read (code). */
  sources: (Citation & { kind: "template" | "code" | "compose" | "ci" })[];
}

export interface DockerImage {
  path: string;
  stages: { name?: string | undefined; from: string; line: number }[];
  exposes: string[];
  command?: string | undefined;
}

export interface ComposeService {
  name: string;
  image?: string | undefined;
  build?: string | undefined;
  ports: string[];
  dependsOn: string[];
  at: Citation;
}

export interface QualityTool {
  name: string;
  category:
    | "linter"
    | "formatter"
    | "type checker"
    | "test runner"
    | "coverage"
    | "git hooks"
    | "dependency updates"
    | "commit convention";
  configFiles: string[];
  brief: string;
}

export interface BuildReport {
  scripts: Script[];
  env: EnvVar[];
  docker: DockerImage[];
  compose: ComposeService[];
  infrastructure: { kind: string; files: string[]; detail?: string | undefined }[];
  quality: QualityTool[];
  entryPoints: { path: string; reason: string; at: Citation }[];
}

export interface InfraReport {
  stack: StackReport;
  pipelines: Pipeline[];
  build: BuildReport;
}
