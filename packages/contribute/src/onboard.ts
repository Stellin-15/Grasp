import {
  localChecks,
  type Citation,
  type InfraReport,
  type RepoView,
  type Script,
} from "@grasp/infra";

export interface OnboardStep {
  title: string;
  commands: string[];
  why?: string | undefined;
  sources: Citation[];
}

export interface PrCheck {
  pipeline: string;
  job: string;
  command: string;
  at: Citation;
}

export interface ContributingInfo {
  guide?: string | undefined;
  /** Section headings of the contributing guide, a quick map of what it covers. */
  sections: string[];
  codeOfConduct?: string | undefined;
  prTemplate?: string | undefined;
  issueTemplates: string[];
  license?: { path: string; name: string } | undefined;
  /** Sign-off or CLA requirement found in the guide. */
  signoff?: string | undefined;
}

export interface OnboardGuide {
  steps: OnboardStep[];
  prChecks: PrCheck[];
  contributing: ContributingInfo;
}

const PREFERRED_ORDER: Script["source"][] = [
  "npm",
  "make",
  "just",
  "task",
  "nox",
  "tox",
  "composer",
  "python-entry",
];

/** Root-level scripts first, then by tool preference, then by name. */
function pick(scripts: Script[], kind: Script["kind"], max = 3): Script[] {
  return scripts
    .filter((s) => s.kind === kind)
    .sort(
      (a, b) =>
        Number(a.at.path.includes("/")) - Number(b.at.path.includes("/")) ||
        PREFERRED_ORDER.indexOf(a.source) - PREFERRED_ORDER.indexOf(b.source) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, max);
}

function invocation(s: Script, pm: string | undefined): string {
  switch (s.source) {
    case "npm": {
      const runner =
        pm === "Yarn" ? "yarn" : pm === "pnpm" ? "pnpm" : pm === "Bun" ? "bun run" : "npm run";
      const prefix = s.at.path.includes("/")
        ? `cd ${s.at.path.slice(0, s.at.path.lastIndexOf("/"))} && `
        : "";
      return `${prefix}${runner} ${s.name}`;
    }
    case "make":
      return `make ${s.name}`;
    case "just":
      return `just ${s.name}`;
    case "task":
      return `task ${s.name}`;
    case "composer":
      return `composer run ${s.name}`;
    default:
      return s.command;
  }
}

const TOOL_COMMAND: Record<string, string> = {
  pytest: "pytest",
  Vitest: "npx vitest run",
  Jest: "npx jest",
  Mocha: "npx mocha",
  Ruff: "ruff check .",
  mypy: "mypy .",
  Pyright: "pyright",
  Flake8: "flake8",
  ESLint: "npx eslint .",
  Biome: "npx biome check .",
  TypeScript: "npx tsc --noEmit",
  Prettier: "npx prettier --check .",
  Black: "black --check .",
};

const TOOL_KIND: Record<string, Script["kind"]> = {
  pytest: "test",
  Vitest: "test",
  Jest: "test",
  Mocha: "test",
  Ruff: "lint",
  mypy: "lint",
  Pyright: "lint",
  Flake8: "lint",
  ESLint: "lint",
  Biome: "lint",
  TypeScript: "lint",
  Prettier: "format",
  Black: "format",
};

const LICENSES: [RegExp, string][] = [
  [/MIT License|Permission is hereby granted, free of charge/i, "MIT"],
  [/Apache License,?\s+Version 2\.0/i, "Apache-2.0"],
  [/GNU GENERAL PUBLIC LICENSE\s+Version 3/i, "GPL-3.0"],
  [/GNU GENERAL PUBLIC LICENSE\s+Version 2/i, "GPL-2.0"],
  [/GNU LESSER GENERAL PUBLIC LICENSE/i, "LGPL"],
  [/GNU AFFERO GENERAL PUBLIC LICENSE/i, "AGPL-3.0"],
  [/Mozilla Public License,? v(ersion)?\.? ?2\.0/i, "MPL-2.0"],
  // The BSD texts are often not titled; the third clause ("Neither the name...") tells 3 from 2.
  [
    /BSD 3-Clause|Redistribution and use in source and binary forms[\s\S]*Neither the name/i,
    "BSD-3-Clause",
  ],
  [/BSD 2-Clause|Redistribution and use in source and binary forms/i, "BSD-2-Clause"],
  [/ISC License/i, "ISC"],
  [/This is free and unencumbered software released into the public domain/i, "Unlicense"],
];

async function contributing(repo: RepoView): Promise<ContributingInfo> {
  const find = (re: RegExp) => repo.files.find((f) => re.test(f));
  const guide = find(/^(\.github\/|docs\/)?CONTRIBUTING(\.md|\.rst|\.txt)?$/i);
  const info: ContributingInfo = {
    guide,
    sections: [],
    codeOfConduct: find(/^(\.github\/|docs\/)?CODE_OF_CONDUCT(\.md)?$/i),
    prTemplate: find(
      /^(\.github\/|docs\/)?(PULL_REQUEST_TEMPLATE(\.md)?|pull_request_template\.md|\.github\/PULL_REQUEST_TEMPLATE\/.+)$/i,
    ),
    issueTemplates: repo.files.filter(
      (f) => /^\.github\/ISSUE_TEMPLATE\/.+\.(md|ya?ml)$/i.test(f) && !/config\.ya?ml$/.test(f),
    ),
  };
  if (guide) {
    const text = (await repo.readText(guide)) ?? "";
    info.sections = [...text.matchAll(/^#{2,3}\s+(.+)$/gm)].map((m) => (m[1] ?? "").trim());
    if (/Signed-off-by|Developer Certificate of Origin|\bDCO\b/i.test(text))
      info.signoff = "DCO sign-off (git commit -s)";
    else if (/\bCLA\b|Contributor License Agreement/i.test(text))
      info.signoff = "Contributor License Agreement";
  }
  const licensePath = find(/^(LICEN[CS]E|COPYING)(\.md|\.txt)?$/i);
  if (licensePath) {
    const text = (await repo.readText(licensePath)) ?? "";
    info.license = {
      path: licensePath,
      name: LICENSES.find(([re]) => re.test(text))?.[1] ?? "unrecognized",
    };
  }
  return info;
}

export async function buildOnboarding(repo: RepoView, infra: InfraReport): Promise<OnboardGuide> {
  const steps: OnboardStep[] = [];
  const { stack, build, pipelines } = infra;
  const pm = stack.packageManagers[0];

  if (stack.runtimes.length) {
    const seen = new Set<string>();
    const unique = stack.runtimes.filter((r) => !seen.has(r.name) && seen.add(r.name));
    steps.push({
      title: "Install the language runtime",
      commands: unique.map((r) => `# ${r.name} ${r.version}`),
      why: "Use the pinned version to match CI and other contributors.",
      sources: stack.runtimes.map((r) => r.source),
    });
  }

  if (stack.packageManagers.length) {
    steps.push({
      title: "Install dependencies",
      commands: stack.packageManagers.map((p) => p.install),
      sources: [],
      why: `Detected from ${stack.packageManagers.map((p) => p.evidence).join(", ")}.`,
    });
  }

  const template = build.env.flatMap((e) => e.sources).find((s) => s.kind === "template");
  if (build.env.length) {
    const names = build.env.map((e) => e.name);
    steps.push({
      title: "Configure environment variables",
      commands: template ? [`cp ${template.path} .env`] : [],
      why: `The code reads ${names.length} variable${names.length === 1 ? "" : "s"}: ${names.join(", ")}.`,
      sources: build.env.flatMap((e) => e.sources).slice(0, 10),
    });
  }

  const backing = build.compose.filter((s) => s.image && !s.build);
  if (backing.length) {
    steps.push({
      title: "Start backing services",
      commands: [`docker compose up -d ${backing.map((s) => s.name).join(" ")}`],
      why: `Services the app depends on: ${backing.map((s) => `${s.name} (${s.image})`).join(", ")}.`,
      sources: backing.map((s) => s.at),
    });
  }

  const section = (title: string, kind: Script["kind"], why?: string) => {
    const found = pick(build.scripts, kind);
    if (found.length) {
      steps.push({
        title,
        commands: found.map((s) => invocation(s, pm?.name)),
        why: why ?? (found[0]?.description ? found[0].description : undefined),
        sources: found.map((s) => s.at),
      });
      return;
    }
    // No project script: fall back to the standard command of each configured tool.
    const tools = build.quality.filter((q) => TOOL_KIND[q.name] === kind && TOOL_COMMAND[q.name]);
    if (tools.length) {
      steps.push({
        title,
        commands: tools.map((q) => TOOL_COMMAND[q.name] ?? ""),
        why: `No ${kind} script is defined; these are the standard commands for the configured tools.`,
        sources: [...new Set(tools.flatMap((q) => q.configFiles))].map((path) => ({
          path,
          line: 1,
        })),
      });
    }
  };
  section("Set up the project", "setup");
  section("Build", "build");
  section("Run it locally", "dev");
  if (!pick(build.scripts, "dev").length) section("Run it", "start");
  section("Run the tests", "test");
  section("Lint and type check", "lint");
  section("Format", "format");

  if (
    !pick(build.scripts, "dev").length &&
    !pick(build.scripts, "start").length &&
    build.entryPoints.length
  ) {
    const e = build.entryPoints[0];
    if (e)
      steps.push({
        title: "Run it",
        commands: [`# entry point: ${e.path}`],
        why: e.reason,
        sources: [e.at],
      });
  }

  const prChecks: PrCheck[] = [];
  const seen = new Set<string>();
  for (const p of pipelines) {
    if (!p.runsOnPullRequests || p.system === "pre-commit") continue;
    for (const c of localChecks(p)) {
      if (c.ciOnly || seen.has(c.command)) continue;
      seen.add(c.command);
      prChecks.push({
        pipeline: p.path,
        job: c.job,
        command: c.command,
        at: { path: p.path, line: c.line },
      });
    }
  }
  const preCommit = pipelines.find((p) => p.system === "pre-commit");
  if (preCommit) {
    steps.push({
      title: "Install git hooks",
      commands: ["pre-commit install"],
      why: preCommit.brief,
      sources: [{ path: preCommit.path, line: 1 }],
    });
  }

  return { steps, prChecks, contributing: await contributing(repo) };
}
