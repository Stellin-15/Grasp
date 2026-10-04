import { asArray, asRecord, asString, parseYaml, type ParsedYaml } from "../text.js";
import type { Pipeline, PipelineJob, PipelineStep, Trigger } from "../types.js";
import { describeUses } from "./actions.js";

function triggers(on: unknown, y: ParsedYaml): Trigger[] {
  if (typeof on === "string") return [{ event: on, line: y.lineAt(["on"]) }];
  if (Array.isArray(on)) return on.map((e) => ({ event: String(e), line: y.lineAt(["on"]) }));
  const out: Trigger[] = [];
  for (const [event, cfg] of Object.entries(asRecord(on) ?? {})) {
    const c = asRecord(cfg);
    const details: string[] = [];
    for (const k of [
      "branches",
      "branches-ignore",
      "tags",
      "tags-ignore",
      "paths",
      "paths-ignore",
      "types",
    ]) {
      const v = asArray(c?.[k]).map(String);
      if (v.length) details.push(`${k}: ${v.join(", ")}`);
    }
    if (event === "schedule") {
      for (const s of asArray(cfg)) {
        const cron = asString(asRecord(s)?.cron);
        if (cron) details.push(`cron ${cron}`);
      }
    }
    out.push({ event, detail: details.join("; ") || undefined, line: y.lineAt(["on", event]) });
  }
  return out;
}

function matrix(strategy: unknown): Record<string, string[]> | undefined {
  const m = asRecord(asRecord(strategy)?.matrix);
  if (!m) return undefined;
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(m)) {
    if (k === "include" || k === "exclude") continue;
    if (Array.isArray(v))
      out[k] = v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x)));
    else if (typeof v === "string") out[k] = [v];
  }
  return Object.keys(out).length ? out : undefined;
}

export function parseGithubWorkflow(path: string, text: string): Pipeline {
  const y = parseYaml(text);
  const root = asRecord(y.value) ?? {};
  const trig = triggers(root.on ?? root.true, y);
  const jobs: PipelineJob[] = [];
  for (const [id, raw] of Object.entries(asRecord(root.jobs) ?? {})) {
    const j = asRecord(raw) ?? {};
    const steps: PipelineStep[] = asArray(j.steps).map((s, i) => {
      const step = asRecord(s) ?? {};
      const uses = asString(step.uses);
      return {
        name: asString(step.name),
        uses,
        usesBrief: uses ? describeUses(uses) : undefined,
        run: asString(step.run)?.trim(),
        line: y.lineAt(["jobs", id, "steps", i]),
      };
    });
    // A job that calls a reusable workflow has `uses` at job level and no steps.
    const jobUses = asString(j.uses);
    if (jobUses)
      steps.push({
        uses: jobUses,
        usesBrief: "Calls a reusable workflow.",
        line: y.lineAt(["jobs", id, "uses"]),
      });
    const env = j.environment;
    jobs.push({
      id,
      name: asString(j.name),
      runsOn:
        asString(j["runs-on"]) ??
        (Array.isArray(j["runs-on"]) ? j["runs-on"].map(String).join(", ") : undefined),
      needs: asArray(j.needs).map(String),
      matrix: matrix(j.strategy),
      services: Object.keys(asRecord(j.services) ?? {}),
      environment: asString(env) ?? asString(asRecord(env)?.name),
      condition: asString(j.if),
      steps,
      line: y.lineAt(["jobs", id]),
    });
  }
  const secrets = [
    ...new Set([...text.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((m) => m[1] ?? "")),
  ]
    .filter((s) => s && s !== "GITHUB_TOKEN")
    .sort();
  return {
    system: "github-actions",
    path,
    name: asString(root.name) ?? path.slice(path.lastIndexOf("/") + 1),
    parsed: true,
    triggers: trig,
    runsOnPullRequests: trig.some(
      (t) => t.event === "pull_request" || t.event === "pull_request_target",
    ),
    jobs,
    secrets,
    purposes: [],
    brief: "",
    deploys: [],
  };
}
