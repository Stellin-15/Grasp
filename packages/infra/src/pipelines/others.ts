import { asArray, asRecord, asString, parseYaml } from "../text.js";
import type { Pipeline, PipelineStep, Trigger } from "../types.js";
import { describeUses } from "./actions.js";

function base(system: Pipeline["system"], path: string, name: string): Pipeline {
  return {
    system,
    path,
    name,
    parsed: true,
    triggers: [],
    runsOnPullRequests: false,
    jobs: [],
    secrets: [],
    purposes: [],
    brief: "",
    deploys: [],
  };
}

const GITLAB_RESERVED = new Set([
  "stages",
  "variables",
  "default",
  "include",
  "workflow",
  "image",
  "services",
  "cache",
  "before_script",
  "after_script",
  "types",
  "pages:deploy",
]);

/** GitLab predefined variables start with CI_ or GITLAB_; anything else must be set in project settings. */
function gitlabExternalVars(text: string, defined: Set<string>): string[] {
  const vars = new Set<string>();
  for (const m of text.matchAll(/\$\{?([A-Z][A-Z0-9_]+)\}?/g)) {
    const v = m[1] ?? "";
    if (!/^(CI|GITLAB|FF)_/.test(v) && !defined.has(v) && v !== "HOME" && v !== "PATH") vars.add(v);
  }
  return [...vars].sort();
}

export function parseGitlab(path: string, text: string): Pipeline {
  const y = parseYaml(text);
  const root = asRecord(y.value) ?? {};
  const p = base("gitlab-ci", path, "GitLab CI");
  const defined = new Set(Object.keys(asRecord(root.variables) ?? {}));
  const img = root.image ?? asRecord(root.default)?.image;
  const defaultImage = asString(img) ?? asString(asRecord(img)?.name);
  for (const [id, raw] of Object.entries(root)) {
    // Keys starting with `.` are hidden templates used via `extends`.
    if (GITLAB_RESERVED.has(id) || id.startsWith(".")) continue;
    const j = asRecord(raw);
    if (!j || !(j.script || j.trigger || j.extends)) continue;
    for (const k of Object.keys(asRecord(j.variables) ?? {})) defined.add(k);
    const steps: PipelineStep[] = [];
    for (const section of ["before_script", "script", "after_script"]) {
      asArray(j[section]).forEach((cmd, i) => {
        const run = asString(cmd);
        if (run) steps.push({ run, line: y.lineAt([id, section, i]) });
      });
    }
    const rules = asArray(j.rules)
      .map((r) => asString(asRecord(r)?.if))
      .filter(Boolean);
    const only = asArray(asRecord(j.only)?.refs ?? j.only).map(String);
    const env = j.environment;
    p.jobs.push({
      id,
      runsOn: asString(j.image) ?? asString(asRecord(j.image)?.name) ?? defaultImage,
      stage: asString(j.stage) ?? "test",
      needs: asArray(j.needs)
        .map((n) => asString(n) ?? asString(asRecord(n)?.job) ?? "")
        .filter(Boolean),
      environment: asString(env) ?? asString(asRecord(env)?.name),
      condition:
        [...rules, ...(only.length ? [`only: ${only.join(", ")}`] : [])].join(" | ") || undefined,
      services: asArray(j.services)
        .map((s) => asString(s) ?? asString(asRecord(s)?.name) ?? "")
        .filter(Boolean),
      steps,
      line: y.lineAt([id]),
    });
  }
  const mr = /merge_request_event|merge_requests/.test(text);
  const triggers: Trigger[] = [
    { event: "push", detail: "every branch unless rules or workflow limit it" },
  ];
  if (mr) triggers.push({ event: "merge_request" });
  if (/\btags\b|CI_COMMIT_TAG/.test(text)) triggers.push({ event: "tag" });
  if (/schedule/.test(text)) triggers.push({ event: "schedule" });
  p.triggers = triggers;
  // GitLab runs branch pipelines for merge request source branches by default.
  p.runsOnPullRequests = true;
  p.secrets = gitlabExternalVars(text, defined);
  // Order jobs by declared stage order, as GitLab executes them.
  const stages = asArray(root.stages).map(String);
  if (stages.length) {
    p.jobs.sort(
      (a, b) => stages.indexOf(a.stage ?? "") - stages.indexOf(b.stage ?? "") || a.line - b.line,
    );
  }
  return p;
}

export function parseCircleci(path: string, text: string): Pipeline {
  const y = parseYaml(text);
  const root = asRecord(y.value) ?? {};
  const p = base("circleci", path, "CircleCI");
  const orbs = Object.values(asRecord(root.orbs) ?? {}).map(String);
  for (const [id, raw] of Object.entries(asRecord(root.jobs) ?? {})) {
    const j = asRecord(raw) ?? {};
    const steps: PipelineStep[] = asArray(j.steps).map((s, i) => {
      const line = y.lineAt(["jobs", id, "steps", i]);
      if (typeof s === "string")
        return {
          uses: s,
          usesBrief: s === "checkout" ? describeUses("actions/checkout") : undefined,
          line,
        };
      const r = asRecord(s) ?? {};
      const [kind, value] = Object.entries(r)[0] ?? ["", undefined];
      if (kind === "run") {
        const v = asRecord(value);
        return { name: asString(v?.name), run: asString(value) ?? asString(v?.command), line };
      }
      return {
        uses: kind,
        usesBrief: describeUses(
          kind.split("/")[0] === kind ? kind : `circleci/${kind.split("/")[0]}`,
        ),
        line,
      };
    });
    const docker = asArray(j.docker)
      .map((d) => asString(asRecord(d)?.image))
      .filter(Boolean);
    p.jobs.push({
      id,
      runsOn: docker[0] ?? asString(asRecord(j.machine)?.image) ?? asString(j.executor),
      needs: [],
      steps,
      line: y.lineAt(["jobs", id]),
    });
  }
  // Workflow `requires` gives job dependencies.
  for (const wf of Object.values(asRecord(root.workflows) ?? {})) {
    for (const entry of asArray(asRecord(wf)?.jobs)) {
      const [name, cfg] =
        typeof entry === "string"
          ? [entry, undefined]
          : (Object.entries(asRecord(entry) ?? {})[0] ?? ["", undefined]);
      const job = p.jobs.find((j) => j.id === name);
      const requires = asArray(asRecord(cfg)?.requires).map(String);
      if (job) job.needs = [...new Set([...job.needs, ...requires])];
      const filters = asRecord(asRecord(cfg)?.filters);
      if (filters && asRecord(filters.tags))
        p.triggers.push({ event: "tag", detail: `job ${name}` });
    }
  }
  p.triggers.unshift({ event: "push", detail: "every branch, including pull request branches" });
  if (orbs.length) p.triggers.push({ event: "orbs", detail: orbs.join(", ") });
  p.runsOnPullRequests = true;
  // CircleCI injects secrets through named contexts; list the contexts, never values.
  p.secrets = [
    ...new Set([...text.matchAll(/context:\s*\[?\s*([\w-]+)/g)].map((m) => `context ${m[1]}`)),
  ].sort();
  return p;
}

export function parseAzure(path: string, text: string): Pipeline {
  const y = parseYaml(text);
  const root = asRecord(y.value) ?? {};
  const p = base("azure-pipelines", path, asString(root.name) ?? "Azure Pipelines");
  const pool = asString(asRecord(root.pool)?.vmImage) ?? asString(root.pool);
  const toSteps = (list: unknown, path0: (string | number)[]): PipelineStep[] =>
    asArray(list).map((s, i) => {
      const r = asRecord(s) ?? {};
      const task = asString(r.task);
      return {
        name: asString(r.displayName),
        uses: task ?? asString(r.template),
        usesBrief: task ? describeUses(task.replace(/@.*/, "")) : undefined,
        run: asString(r.script) ?? asString(r.bash) ?? asString(r.pwsh) ?? asString(r.powershell),
        line: y.lineAt([...path0, i]),
      };
    });
  const addJob = (j: Record<string, unknown>, at: (string | number)[], stage?: string) => {
    p.jobs.push({
      id: asString(j.job) ?? asString(j.deployment) ?? (stage ? `${stage}` : "job"),
      name: asString(j.displayName),
      runsOn: asString(asRecord(j.pool)?.vmImage) ?? pool,
      stage,
      needs: asArray(j.dependsOn).map(String),
      environment: asString(j.environment),
      condition: asString(j.condition),
      steps: toSteps(j.steps ?? asRecord(asRecord(asRecord(j.strategy)?.runOnce)?.deploy)?.steps, [
        ...at,
        "steps",
      ]),
      line: y.lineAt(at),
    });
  };
  if (root.steps) addJob({ job: "default", steps: root.steps }, []);
  asArray(root.jobs).forEach((j, i) => addJob(asRecord(j) ?? {}, ["jobs", i]));
  asArray(root.stages).forEach((s, si) => {
    const st = asRecord(s) ?? {};
    asArray(st.jobs).forEach((j, ji) =>
      addJob(asRecord(j) ?? {}, ["stages", si, "jobs", ji], asString(st.stage)),
    );
  });
  const trig = root.trigger;
  p.triggers.push({
    event: "push",
    detail: trig === "none" ? "disabled" : JSON.stringify(trig ?? "all branches"),
  });
  if (root.pr !== "none")
    p.triggers.push({
      event: "pull_request",
      detail: root.pr ? JSON.stringify(root.pr) : undefined,
    });
  if (root.schedules) p.triggers.push({ event: "schedule" });
  p.runsOnPullRequests = root.pr !== "none";
  p.secrets = [
    ...new Set([...text.matchAll(/\$\(([A-Za-z_][\w.]*)\)/g)].map((m) => m[1] ?? "")),
  ].filter((v) => v && !/^(Build|System|Agent|Pipeline|Environment)\./.test(v));
  return p;
}

export function parsePreCommit(path: string, text: string): Pipeline {
  const y = parseYaml(text);
  const root = asRecord(y.value) ?? {};
  const p = base("pre-commit", path, "pre-commit hooks");
  const steps: PipelineStep[] = [];
  asArray(root.repos).forEach((r, ri) => {
    const repo = asRecord(r) ?? {};
    asArray(repo.hooks).forEach((h, hi) => {
      const id = asString(asRecord(h)?.id) ?? "?";
      steps.push({
        name: id,
        uses: `${asString(repo.repo) ?? "local"}${repo.rev ? `@${String(repo.rev)}` : ""}`,
        run: `pre-commit run ${id} --all-files`,
        line: y.lineAt(["repos", ri, "hooks", hi]),
      });
    });
  });
  p.jobs.push({ id: "hooks", needs: [], steps, line: 1 });
  p.triggers.push({
    event: "git commit",
    detail: "after `pre-commit install`; also runnable in CI",
  });
  return p;
}
