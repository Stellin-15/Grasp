import { jobGraphMermaid, localChecks, type Pipeline } from "@grasp/infra";
import type { OnboardGuide } from "@grasp/contribute";
import type { ExplanationSet } from "@grasp/explain";
import type { ScanReport } from "./report.js";

/** Escapes characters that would break a Markdown table cell. */
export function cell(s: string | number | undefined): string {
  return String(s ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ");
}

export function code(s: string): string {
  const ticks = s.includes("`") ? "``" : "`";
  return `${ticks}${s}${ticks}`;
}

export function table(headers: string[], rows: (string | number | undefined)[][]): string {
  if (rows.length === 0) return "_None._\n";
  return (
    [
      `| ${headers.join(" | ")} |`,
      `| ${headers.map(() => "---").join(" | ")} |`,
      ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
    ].join("\n") + "\n"
  );
}

export function cite(path: string, line?: number, link?: (path: string) => string): string {
  const label = line ? `${path}:${line}` : path;
  return link ? `[${code(label)}](${link(path)})` : code(label);
}

const pct = (n: number) => (n > 0 && n < 0.005 ? "<1%" : `${Math.round(n * 100)}%`);

export interface RenderOptions {
  /** Turns a repo path into a link target; omit for plain citations. */
  link?: ((path: string) => string) | undefined;
  readingLimit?: number | undefined;
  /** Adds generated "how this repo uses it" and "why this step" sections. */
  explanations?: ExplanationSet | undefined;
}

export function renderSummary(r: ScanReport): string {
  const s = r.summary;
  const where = [r.repo.branch, r.repo.head?.slice(0, 7)].filter(Boolean).join(" @ ");
  return [
    `# ${r.repo.name}`,
    "",
    where ? `Branch ${code(where)}${r.repo.remote ? ` · ${r.repo.remote}` : ""}` : "",
    "",
    table(
      ["Files", "Source", "Tests", "Lines of code", "Functions", "Classes", "Docstring coverage"],
      [
        [
          s.files,
          s.sourceFiles,
          s.testFiles,
          s.linesOfCode,
          s.functions,
          s.classes,
          pct(s.docstringCoverage),
        ],
      ],
    ),
    "**Languages:** " +
      (r.languages.map((l) => `${l.language} ${pct(l.share)}`).join(", ") || "none detected"),
    "",
    `Static analysis resolved ${s.resolvedCalls} of ${s.calls} calls and ${s.internalImports} in-repo imports. ` +
      `Unresolved calls are usually to external libraries or dynamic dispatch.`,
    "",
  ].join("\n");
}

export function renderEntryPoints(r: ScanReport, o: RenderOptions = {}): string {
  return [
    "## Entry points",
    "",
    table(
      ["File", "Why"],
      r.entryPoints.map((e) => [cite(e.path, undefined, o.link), e.reason]),
    ),
  ].join("\n");
}

export function renderReadingOrder(r: ScanReport, o: RenderOptions = {}): string {
  const limit = o.readingLimit ?? 20;
  const items = r.readingOrder.slice(0, limit);
  const stageLabel = { entry: "Entry point", core: "Core", leaf: "Supporting" } as const;
  return [
    "## Reading order",
    "",
    "Start where execution starts, then read what most of the code depends on, then the rest.",
    "",
    table(
      ["#", "File", "Stage", "Why"],
      items.map((it, i) => [
        i + 1,
        cite(it.path, undefined, o.link),
        stageLabel[it.stage],
        it.reason,
      ]),
    ),
    r.readingOrder.length > limit ? `_${r.readingOrder.length - limit} more files omitted._\n` : "",
  ].join("\n");
}

export function renderRisk(r: ScanReport, o: RenderOptions = {}): string {
  return [
    "## Riskiest to misunderstand",
    "",
    "Scored from import centrality, git churn, sensitive paths or names, and size. Scores are relative to this repo.",
    "",
    table(
      ["File", "Score", "Why"],
      r.risk
        .slice(0, 10)
        .map((x) => [
          cite(x.path, undefined, o.link),
          x.score.toFixed(2),
          x.reasons.join("; ") || "-",
        ]),
    ),
  ].join("\n");
}

export function renderHotspots(r: ScanReport, o: RenderOptions = {}): string {
  if (!r.hotspots.length) return "";
  return [
    "## Git hotspots",
    "",
    `From the last ${r.summary.historyCommits ?? "?"} commits.`,
    "",
    table(
      ["File", "Commits", "Authors", "Last change"],
      r.hotspots.map((h) => [
        cite(h.path, undefined, o.link),
        h.commits,
        h.authors,
        h.lastDate.slice(0, 10),
      ]),
    ),
  ].join("\n");
}

export function renderUndocumented(r: ScanReport): string {
  return [
    "## Folders without docs",
    "",
    "Folders with two or more source files and no README.",
    "",
    table(
      ["Folder", "Source files", "Docstring coverage"],
      r.undocumentedFolders
        .slice(0, 15)
        .map((f) => [code(f.path), f.sourceFiles, pct(f.docstringCoverage)]),
    ),
  ].join("\n");
}

export function renderStack(r: Pick<ScanReport, "stack" | "build">, o: RenderOptions = {}): string {
  const { stack, build } = r;
  const out: string[] = ["# Tech stack", ""];
  if (stack.runtimes.length) {
    out.push(
      "## Runtimes",
      "",
      table(
        ["Runtime", "Version", "Source"],
        stack.runtimes.map((x) => [x.name, x.version, cite(x.source.path, x.source.line, o.link)]),
      ),
    );
  }
  if (stack.packageManagers.length) {
    out.push(
      "## Package managers",
      "",
      table(
        ["Tool", "Install", "Evidence"],
        stack.packageManagers.map((p) => [p.name, code(p.install), p.evidence]),
      ),
    );
  }
  out.push("## Frameworks and major libraries", "");
  if (!stack.frameworks.length)
    out.push("_No catalogued frameworks detected. See the dependency list below._", "");
  for (const f of stack.frameworks) {
    const versions = f.packages
      .map((p) => `${code(p.name)} ${p.locked ?? p.declared ?? ""}`.trim())
      .join(", ");
    const scopes = [...new Set(f.packages.map((p) => p.scope))].join(", ");
    out.push(
      `### ${f.name}`,
      "",
      `*${f.category}* · ${versions} · ${scopes} · [docs](${f.docs})`,
      "",
      f.brief,
      "",
    );
    const fx = o.explanations?.frameworks?.[f.id];
    if (fx) {
      out.push(`**How this repo uses it:** ${fx.doc.howUsed}`, "");
      for (const pt of fx.doc.patterns)
        out.push(`- ${pt.text} (${cite(pt.path, pt.start, o.link)})`);
      out.push(
        "",
        `_Generated by ${fx.meta.model}; citations checked against the files that use it._`,
        "",
      );
    }
    if (f.usedIn.length) {
      const shown = f.usedIn
        .slice(0, 8)
        .map((u) => cite(u.path, u.line, o.link))
        .join(", ");
      out.push(
        `**Used in ${f.usedIn.length} file${f.usedIn.length === 1 ? "" : "s"}:** ${shown}${f.usedIn.length > 8 ? ", …" : ""}`,
        "",
      );
    }
    if (f.configFiles.length)
      out.push(
        `**Configured by:** ${f.configFiles.map((c) => cite(c, undefined, o.link)).join(", ")}`,
        "",
      );
    out.push(
      `**Declared in:** ${f.packages.map((p) => cite(p.manifest.path, p.manifest.line, o.link)).join(", ")}`,
      "",
    );
  }
  if (build.quality.length) {
    out.push(
      "## Quality tooling",
      "",
      table(
        ["Tool", "Kind", "What it does", "Config"],
        build.quality.map((q) => [
          q.name,
          q.category,
          q.brief,
          q.configFiles.map((c) => code(c)).join(", ") || "-",
        ]),
      ),
    );
  }
  const runtime = stack.dependencies.filter((d) => d.scope === "runtime");
  const other = stack.dependencies.filter((d) => d.scope !== "runtime");
  out.push(
    "## All dependencies",
    "",
    `${runtime.length} runtime, ${other.length} dev/build/optional.`,
    "",
    table(
      ["Package", "Ecosystem", "Scope", "Declared", "Locked", "Manifest"],
      stack.dependencies.map((d) => [
        code(d.name),
        d.ecosystem,
        d.scope,
        d.declared ?? "",
        d.locked ?? "",
        cite(d.manifest.path, d.manifest.line, o.link),
      ]),
    ),
  );
  return out.join("\n");
}

function triggerList(p: Pipeline): string {
  return (
    p.triggers.map((t) => `${code(t.event)}${t.detail ? ` (${t.detail})` : ""}`).join(", ") || "-"
  );
}

export function renderPipeline(p: Pipeline, o: RenderOptions = {}): string {
  const out: string[] = [
    `## ${p.name}`,
    "",
    `${cite(p.path, undefined, o.link)} · ${p.system}`,
    "",
    `**Brief idea:** ${p.brief}`,
    "",
  ];
  const px = o.explanations?.pipelines?.[p.path];
  if (px)
    out.push(`**Why it exists:** ${px.doc.summary}`, "", `_Generated by ${px.meta.model}._`, "");
  const why = new Map((px?.doc.steps ?? []).map((s) => [s.line, s.why]));
  if (!p.parsed) return out.join("\n");
  out.push(`**Triggers:** ${triggerList(p)}`, "");
  if (p.runsOnPullRequests)
    out.push("**Runs on pull requests**, so contributor PRs must pass it.", "");
  if (p.secrets.length)
    out.push(`**Secrets and CI variables (names only):** ${p.secrets.map(code).join(", ")}`, "");
  if (p.deploys.length) {
    out.push(
      "**Publishes or deploys to:** " +
        p.deploys.map((d) => `${d.target} (${cite(p.path, d.line, o.link)})`).join(", "),
      "",
    );
  }
  if (p.jobs.length > 1) out.push("```mermaid", jobGraphMermaid(p), "```", "");
  for (const j of p.jobs) {
    const meta = [
      j.runsOn ? `runs on ${code(j.runsOn)}` : "",
      j.stage ? `stage ${code(j.stage)}` : "",
      j.needs.length ? `after ${j.needs.map(code).join(", ")}` : "",
      j.environment ? `environment ${code(j.environment)}` : "",
      j.matrix
        ? `matrix ${Object.entries(j.matrix)
            .map(([k, v]) => `${k}: ${v.join(", ")}`)
            .join("; ")}`
        : "",
      j.services?.length ? `services ${j.services.map(code).join(", ")}` : "",
      j.condition ? `if ${code(j.condition)}` : "",
    ].filter(Boolean);
    out.push(
      `### Job ${code(j.id)}${j.name && j.name !== j.id ? ` (${j.name})` : ""}`,
      "",
      `${cite(p.path, j.line, o.link)}${meta.length ? " · " + meta.join(" · ") : ""}`,
      "",
    );
    out.push(
      table(
        px ? ["#", "Step", "What it does", "Why", "Line"] : ["#", "Step", "What it does", "Line"],
        j.steps.map((s, i) => [
          i + 1,
          s.run
            ? code(s.run.split("\n")[0] + (s.run.includes("\n") ? " …" : ""))
            : code(s.uses ?? ""),
          s.name ?? s.usesBrief ?? (s.run ? "Runs a shell command." : ""),
          ...(px ? [why.get(s.line) ?? ""] : []),
          s.line,
        ]),
      ),
    );
  }
  const checks = localChecks(p).filter((c) => !c.ciOnly);
  if (checks.length) {
    out.push(
      "**Reproduce locally:**",
      "",
      "```sh",
      ...[...new Set(checks.map((c) => c.command))],
      "```",
      "",
    );
  }
  return out.join("\n");
}

export function renderPipelines(pipelines: Pipeline[], o: RenderOptions = {}): string {
  if (!pipelines.length) return "# CI/CD pipelines\n\n_No pipeline definitions found._\n";
  const summary = table(
    ["Pipeline", "System", "Runs on PRs", "Brief idea"],
    pipelines.map((p) => [
      cite(p.path, undefined, o.link),
      p.system,
      p.runsOnPullRequests ? "yes" : "no",
      p.brief,
    ]),
  );
  return ["# CI/CD pipelines", "", summary, ...pipelines.map((p) => renderPipeline(p, o))].join(
    "\n",
  );
}

export function renderOnboarding(g: OnboardGuide, o: RenderOptions = {}): string {
  const out: string[] = ["# Getting started", ""];
  g.steps.forEach((s, i) => {
    out.push(`## ${i + 1}. ${s.title}`, "");
    if (s.why) out.push(s.why, "");
    if (s.commands.length) out.push("```sh", ...s.commands, "```", "");
    if (s.sources.length)
      out.push(
        `Sources: ${s.sources
          .slice(0, 6)
          .map((c) => cite(c.path, c.line, o.link))
          .join(", ")}`,
        "",
      );
  });
  out.push("## Before you open a pull request", "");
  if (g.prChecks.length) {
    out.push(
      "These commands mirror the CI jobs that run on pull requests:",
      "",
      "```sh",
      ...g.prChecks.map((c) => c.command),
      "```",
      "",
    );
  } else out.push("_No pull request pipelines detected._", "");
  const c = g.contributing;
  out.push("## Contribution guidelines", "");
  const facts = [
    c.guide
      ? `Guide: ${cite(c.guide, undefined, o.link)}${c.sections.length ? ` (covers: ${c.sections.join(", ")})` : ""}`
      : "No CONTRIBUTING guide found.",
    c.codeOfConduct ? `Code of conduct: ${cite(c.codeOfConduct, undefined, o.link)}` : "",
    c.prTemplate ? `Pull request template: ${cite(c.prTemplate, undefined, o.link)}` : "",
    c.issueTemplates.length
      ? `Issue templates: ${c.issueTemplates.map((t) => code(t)).join(", ")}`
      : "",
    c.signoff ? `Requires: ${c.signoff}` : "",
    c.license
      ? `License: ${c.license.name} (${cite(c.license.path, undefined, o.link)})`
      : "No license file found.",
  ].filter(Boolean);
  out.push(...facts.map((f) => `- ${f}`), "");
  return out.join("\n");
}

/** The full scan report as one Markdown document. */
export function renderReport(r: ScanReport, o: RenderOptions = {}): string {
  const pipelines = r.pipelines.length
    ? [
        "## CI/CD pipelines",
        "",
        table(
          ["Pipeline", "Brief idea"],
          r.pipelines.map((p) => [cite(p.path, undefined, o.link), p.brief]),
        ),
      ].join("\n")
    : "## CI/CD pipelines\n\n_None found._\n";
  const frameworks = r.stack.frameworks.length
    ? [
        "## Tech stack",
        "",
        table(
          ["Framework", "Category", "Version", "Used in"],
          r.stack.frameworks.map((f) => [
            f.name,
            f.category,
            f.packages[0]?.locked ?? f.packages[0]?.declared ?? "",
            `${f.usedIn.length} files`,
          ]),
        ),
      ].join("\n")
    : "## Tech stack\n\n_No catalogued frameworks detected._\n";
  const warnings = r.warnings.length
    ? ["## Warnings", "", ...r.warnings.map((w) => `- ${w}`), ""].join("\n")
    : "";
  return [
    renderSummary(r),
    renderEntryPoints(r, o),
    renderReadingOrder(r, o),
    renderRisk(r, o),
    frameworks,
    pipelines,
    renderHotspots(r, o),
    renderUndocumented(r),
    warnings,
    `_Generated by Grasp ${r.toolVersion}. Everything here is static analysis: estimates with cited evidence, not proof._`,
    "",
  ]
    .filter((s) => s !== "")
    .join("\n");
}
