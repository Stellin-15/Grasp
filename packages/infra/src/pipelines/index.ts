import type { Pipeline, PipelineJob, PipelineSystem, RepoView } from "../types.js";
import { parseGithubWorkflow } from "./github.js";
import { parseAzure, parseCircleci, parseGitlab, parsePreCommit } from "./others.js";

type Parser = (path: string, text: string) => Pipeline;

const PARSED: [RegExp, PipelineSystem, Parser][] = [
  [/^\.github\/workflows\/[^/]+\.ya?ml$/, "github-actions", parseGithubWorkflow],
  [/^\.gitlab-ci\.ya?ml$/, "gitlab-ci", parseGitlab],
  [/^\.circleci\/config\.ya?ml$/, "circleci", parseCircleci],
  [/^(\.azure-pipelines\/[^/]+|azure-pipelines)\.ya?ml$/, "azure-pipelines", parseAzure],
  [/^\.pre-commit-config\.ya?ml$/, "pre-commit", parsePreCommit],
];

/** Recognized but not parsed yet; listed so readers know they exist. */
const DETECTED: [RegExp, PipelineSystem, string][] = [
  [/^Jenkinsfile$/, "jenkins", "Jenkins"],
  [/^\.travis\.ya?ml$/, "travis", "Travis CI"],
  [/^bitbucket-pipelines\.ya?ml$/, "bitbucket", "Bitbucket Pipelines"],
  [/^\.drone\.ya?ml$/, "drone", "Drone CI"],
  [/^\.buildkite\/pipeline\.ya?ml$/, "buildkite", "Buildkite"],
  [/^\.?appveyor\.ya?ml$/, "appveyor", "AppVeyor"],
  [/^cloudbuild\.ya?ml$/, "cloud-build", "Google Cloud Build"],
];

const PURPOSES: [string, RegExp][] = [
  [
    "lint",
    /\b(lint|eslint|ruff check|flake8|pylint|golangci|clippy|prettier --check|format:check|black --check|stylelint|biome check)\b/i,
  ],
  ["type check", /\b(tsc\b|typecheck|mypy|pyright)/i],
  [
    "tests",
    /\b(test|tests|pytest|jest|vitest|mocha|go test|cargo test|tox|nox|rspec|phpunit|unittest)\b/i,
  ],
  [
    "build",
    /\b(build|compile|webpack|vite build|cargo build|go build|mvn (package|install)|gradlew? build|docker build)\b/i,
  ],
  ["coverage upload", /codecov|coveralls/i],
  ["security scan", /codeql|snyk|trivy|dependency-review|npm audit|pip-audit|gitleaks|semgrep/i],
  ["docs", /\b(mkdocs|sphinx|docusaurus|typedoc|jsdoc|pages)\b/i],
  [
    "release",
    /npm publish|changesets\/action|pypi-publish|twine upload|cargo publish|goreleaser|gh-release|semantic-release|release-please|gem push/i,
  ],
  [
    "deploy",
    /\b(deploy|vercel|netlify|fly(ctl)? deploy|heroku|kubectl|helm (upgrade|install)|aws |gcloud|az webapp|terraform apply)\b/i,
  ],
  [
    "maintenance",
    /actions\/stale|labeler|lock-threads|dependabot|renovate|first-interaction|welcome/i,
  ],
];

const DEPLOY_TARGETS: [string, RegExp][] = [
  ["npm registry", /npm publish|pnpm publish|yarn npm publish|changesets\/action/i],
  ["PyPI", /pypi-publish|twine upload|uv publish|poetry publish/i],
  ["crates.io", /cargo publish/i],
  ["RubyGems", /gem push/i],
  ["container registry", /docker push|build-push-action|docker\/login-action|ghcr\.io/i],
  ["GitHub Pages", /deploy-pages|gh-pages|github-pages-deploy/i],
  ["GitHub Releases", /gh-release|release-please|goreleaser|gh release create/i],
  ["Vercel", /vercel/i],
  ["Netlify", /netlify/i],
  ["Fly.io", /fly(ctl)? deploy/i],
  ["Heroku", /heroku/i],
  ["Kubernetes", /kubectl|helm (upgrade|install)/i],
  ["AWS", /aws-actions|aws (s3|ecs|lambda|cloudformation)|serverless deploy|cdk deploy/i],
  ["Google Cloud", /gcloud|google-github-actions/i],
  ["Azure", /azure\/|az webapp|AzureWebApp/i],
  ["custom deploy script", /\.\/deploy|deploy\.sh/i],
];

function stepText(job: PipelineJob): string[] {
  return job.steps.map((s) => [s.name, s.uses, s.run].filter(Boolean).join(" "));
}

function classify(p: Pipeline): void {
  const texts = p.jobs.flatMap((j) => [j.id, j.name ?? "", ...stepText(j)]);
  const all = texts.join("\n");
  p.purposes = PURPOSES.filter(([, re]) => re.test(all)).map(([name]) => name);
  if (
    p.triggers.some((t) => t.event === "release" || /tags/.test(t.detail ?? "")) &&
    !p.purposes.includes("release")
  ) {
    p.purposes.push("release");
  }
  for (const job of p.jobs) {
    for (const s of job.steps) {
      const text = [s.uses, s.run].filter(Boolean).join(" ");
      for (const [target, re] of DEPLOY_TARGETS) {
        if (re.test(text) && !p.deploys.some((d) => d.target === target)) {
          p.deploys.push({
            target,
            evidence: (s.uses ?? s.run ?? "").split("\n")[0] ?? "",
            line: s.line,
          });
        }
      }
    }
    if (job.environment && !p.purposes.includes("deploy")) p.purposes.push("deploy");
  }
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function triggerPhrase(p: Pipeline): string {
  const parts: string[] = [];
  for (const t of p.triggers) {
    const branches = /branches: ([^;]+)/.exec(t.detail ?? "")?.[1];
    const tags = /tags: ([^;]+)/.exec(t.detail ?? "")?.[1];
    switch (t.event) {
      case "push":
        if (tags && !branches) parts.push(`tags matching ${tags}`);
        else parts.push(branches ? `pushes to ${branches}` : "pushes");
        break;
      case "pull_request":
      case "pull_request_target":
        parts.push("pull requests");
        break;
      case "merge_request":
        parts.push("merge requests");
        break;
      case "workflow_dispatch":
        parts.push("manual runs");
        break;
      case "schedule":
        parts.push(t.detail ? `a schedule (${t.detail})` : "a schedule");
        break;
      case "release":
        parts.push("published releases");
        break;
      case "tag":
        parts.push("tags");
        break;
      case "orbs":
        break;
      default:
        parts.push(t.event.replace(/_/g, " "));
    }
  }
  return parts.length ? ` on ${list([...new Set(parts)])}` : "";
}

function matrixPhrase(p: Pipeline): string {
  const merged = new Map<string, Set<string>>();
  for (const j of p.jobs) {
    for (const [k, vs] of Object.entries(j.matrix ?? {})) {
      const set = merged.get(k) ?? new Set();
      vs.forEach((v) => set.add(v));
      merged.set(k, set);
    }
  }
  if (merged.size === 0) return "";
  return `, across ${[...merged].map(([k, vs]) => `${k} ${list([...vs])}`).join(" × ")}`;
}

function buildBrief(p: Pipeline): string {
  if (!p.parsed) return `${p.name} pipeline (detected, not parsed yet).`;
  if (p.system === "pre-commit") {
    const hooks = p.jobs.flatMap((j) => j.steps.map((s) => s.name ?? ""));
    return `Runs ${hooks.length} hook${hooks.length === 1 ? "" : "s"} (${list(hooks)}) before each commit.`;
  }
  const what = p.purposes.length
    ? list(p.purposes)
    : `${p.jobs.length} job${p.jobs.length === 1 ? "" : "s"}`;
  let s = `Runs ${what}${triggerPhrase(p)}${matrixPhrase(p)}.`;
  if (p.deploys.length) s += ` Publishes or deploys to ${list(p.deploys.map((d) => d.target))}.`;
  return s;
}

/** Edges `from -> to`. GitLab jobs without `needs` wait for every job in the previous stage. */
export function jobEdges(p: Pipeline): [string, string][] {
  const edges: [string, string][] = [];
  const ids = new Set(p.jobs.map((j) => j.id));
  for (const j of p.jobs) for (const n of j.needs) if (ids.has(n)) edges.push([n, j.id]);
  if (p.system === "gitlab-ci") {
    const stages = [...new Set(p.jobs.map((j) => j.stage ?? ""))];
    for (const j of p.jobs) {
      if (j.needs.length) continue;
      const prev = stages[stages.indexOf(j.stage ?? "") - 1];
      if (prev === undefined) continue;
      for (const k of p.jobs) if (k.stage === prev) edges.push([k.id, j.id]);
    }
  }
  return edges;
}

export function jobGraphMermaid(p: Pipeline): string {
  const id = (s: string) => s.replace(/[^A-Za-z0-9_]/g, "_");
  const lines = ["flowchart LR"];
  for (const j of p.jobs) lines.push(`  ${id(j.id)}["${(j.name ?? j.id).replace(/"/g, "'")}"]`);
  for (const [a, b] of jobEdges(p)) lines.push(`  ${id(a)} --> ${id(b)}`);
  return lines.join("\n");
}

/** Shell commands a contributor can run locally to reproduce what CI checks. */
export function localChecks(
  p: Pipeline,
): { job: string; command: string; line: number; ciOnly: boolean }[] {
  const out: { job: string; command: string; line: number; ciOnly: boolean }[] = [];
  for (const j of p.jobs) {
    for (const s of j.steps) {
      if (!s.run) continue;
      const ciOnly = /\$\{\{|\$CI_|::(set-output|add-mask|group)|secrets\.|deploy|publish/i.test(
        s.run,
      );
      out.push({ job: j.id, command: s.run, line: s.line, ciOnly });
    }
  }
  return out;
}

export function isPipelineFile(path: string): boolean {
  return PARSED.some(([re]) => re.test(path)) || DETECTED.some(([re]) => re.test(path));
}

export async function detectPipelines(repo: RepoView): Promise<Pipeline[]> {
  const out: Pipeline[] = [];
  for (const path of repo.files) {
    const parsed = PARSED.find(([re]) => re.test(path));
    if (parsed) {
      const [, system, parse] = parsed;
      const text = (await repo.readText(path))?.replace(/\r\n/g, "\n");
      let p: Pipeline;
      try {
        if (text === undefined) throw new Error("unreadable");
        p = parse(path, text);
      } catch (err) {
        p = {
          system,
          path,
          name: path,
          parsed: false,
          error: (err as Error).message.split("\n")[0],
          triggers: [],
          runsOnPullRequests: false,
          jobs: [],
          secrets: [],
          purposes: [],
          brief: "",
          deploys: [],
        };
      }
      classify(p);
      p.brief = p.parsed
        ? buildBrief(p)
        : `Could not parse this ${system} file: ${p.error ?? "unknown error"}.`;
      out.push(p);
      continue;
    }
    const detected = DETECTED.find(([re]) => re.test(path));
    if (detected) {
      const [, system, name] = detected;
      const p: Pipeline = {
        system,
        path,
        name,
        parsed: false,
        triggers: [],
        runsOnPullRequests: false,
        jobs: [],
        secrets: [],
        purposes: [],
        brief: "",
        deploys: [],
      };
      p.brief = buildBrief(p);
      out.push(p);
    }
  }
  return out;
}
