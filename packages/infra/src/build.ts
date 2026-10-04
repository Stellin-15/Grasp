import { classifyFile, detectLanguage } from "@grasp/core";
import { parse as parseToml } from "smol-toml";
import {
  asArray,
  asRecord,
  asString,
  basename,
  dirname,
  findLine,
  isForeign,
  parseYaml,
} from "./text.js";
import type {
  BuildReport,
  Dependency,
  ComposeService,
  DockerImage,
  EnvVar,
  QualityTool,
  RepoView,
  Script,
} from "./types.js";

const MAX_ENV_SCAN_FILES = 3000;

export function scriptKind(name: string, command = ""): Script["kind"] {
  const s = `${name} ${command}`.toLowerCase();
  if (/\b(test|tests|spec|e2e|coverage|pytest|vitest|jest)\b/.test(name.toLowerCase()))
    return "test";
  if (/\b(lint|check|typecheck|types)\b/.test(name.toLowerCase())) return "lint";
  if (/\b(format|fmt|prettier)\b/.test(name.toLowerCase())) return "format";
  if (/\b(build|compile|bundle|dist)\b/.test(name.toLowerCase())) return "build";
  if (/\b(dev|watch|serve)\b/.test(name.toLowerCase())) return "dev";
  if (/\bstart\b/.test(name.toLowerCase())) return "start";
  if (/\b(release|publish|deploy|version)\b/.test(name.toLowerCase())) return "release";
  if (/\b(setup|install|bootstrap|prepare|init)\b/.test(name.toLowerCase())) return "setup";
  if (/\b(pytest|vitest|jest|mocha|go test|cargo test)\b/.test(s)) return "test";
  if (/\b(eslint|ruff|flake8|mypy|tsc --noemit)\b/.test(s)) return "lint";
  return "other";
}

function npmScripts(path: string, text: string): Script[] {
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    return Object.entries(asRecord(json.scripts) ?? {}).map(([name, cmd]) => ({
      source: "npm" as const,
      name,
      command: String(cmd),
      kind: scriptKind(name, String(cmd)),
      at: {
        path,
        line: findLine(
          text,
          new RegExp(`^\\s*"${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:`),
        ),
      },
    }));
  } catch {
    return [];
  }
}

function makeTargets(path: string, text: string): Script[] {
  const out: Script[] = [];
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    const m = /^([A-Za-z0-9_][A-Za-z0-9_./-]*)\s*:(?!=)([^#]*)(?:##\s*(.*))?$/.exec(line);
    if (!m?.[1]) return;
    const prev = lines[i - 1] ?? "";
    const description =
      m[3]?.trim() || (/^##\s*/.test(prev) ? prev.replace(/^##\s*/, "").trim() : undefined);
    const recipe = lines[i + 1]?.startsWith("\t")
      ? (lines[i + 1] ?? "").trim()
      : (m[2] ?? "").trim();
    out.push({
      source: "make",
      name: m[1],
      command: recipe ? recipe : `make ${m[1]}`,
      description,
      kind: scriptKind(m[1], recipe),
      at: { path, line: i + 1 },
    });
  });
  return out;
}

function justRecipes(path: string, text: string): Script[] {
  const out: Script[] = [];
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    const m = /^@?([A-Za-z_][\w-]*)(?:\s+[^:=]*)?:(?!=)/.exec(line);
    if (!m?.[1] || line.startsWith(" ") || line.startsWith("set ")) return;
    const prev = lines[i - 1] ?? "";
    out.push({
      source: "just",
      name: m[1],
      command: (lines[i + 1] ?? "").trim() || `just ${m[1]}`,
      description: prev.startsWith("#") ? prev.replace(/^#\s*/, "") : undefined,
      kind: scriptKind(m[1], lines[i + 1] ?? ""),
      at: { path, line: i + 1 },
    });
  });
  return out;
}

function pyprojectScripts(path: string, text: string): Script[] {
  try {
    const toml = parseToml(text) as Record<string, unknown>;
    const scripts = {
      ...(asRecord(asRecord(toml.project)?.scripts) ?? {}),
      ...(asRecord(asRecord(asRecord(toml.tool)?.poetry)?.scripts) ?? {}),
    };
    return Object.entries(scripts).map(([name, target]) => ({
      source: "python-entry" as const,
      name,
      command: name,
      description: `Console command that calls ${String(target)}`,
      kind: "start" as const,
      at: { path, line: findLine(text, new RegExp(`^\\s*"?${name}"?\\s*=`)) },
    }));
  } catch {
    return [];
  }
}

function toxEnvs(path: string, text: string): Script[] {
  const out: Script[] = [];
  text.split("\n").forEach((line, i) => {
    const m = /^\[testenv(?::([^\]]+))?\]/.exec(line);
    if (!m) return;
    const name = m[1] ?? "default";
    out.push({
      source: "tox",
      name,
      command: m[1] ? `tox -e ${m[1]}` : "tox",
      kind: scriptKind(name, "test"),
      at: { path, line: i + 1 },
    });
  });
  return out;
}

function noxSessions(path: string, text: string): Script[] {
  const out: Script[] = [];
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (!/^\s*@nox\.session/.test(line)) return;
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
      const m = /^\s*def\s+(\w+)/.exec(lines[j] ?? "");
      if (m?.[1]) {
        out.push({
          source: "nox",
          name: m[1],
          command: `nox -s ${m[1]}`,
          kind: scriptKind(m[1]),
          at: { path, line: j + 1 },
        });
        break;
      }
    }
  });
  return out;
}

function taskfile(path: string, text: string): Script[] {
  try {
    const y = parseYaml(text);
    const tasks = asRecord(asRecord(y.value)?.tasks) ?? {};
    return Object.entries(tasks).map(([name, t]) => {
      const cmds = asArray(asRecord(t)?.cmds).map(
        (c) => asString(c) ?? asString(asRecord(c)?.cmd) ?? "",
      );
      return {
        source: "task" as const,
        name,
        command: cmds[0] ?? `task ${name}`,
        description: asString(asRecord(t)?.desc),
        kind: scriptKind(name, cmds.join(" ")),
        at: { path, line: y.lineAt(["tasks", name]) },
      };
    });
  } catch {
    return [];
  }
}

function composerScripts(path: string, text: string): Script[] {
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    return Object.entries(asRecord(json.scripts) ?? {}).map(([name, cmd]) => ({
      source: "composer" as const,
      name,
      command: Array.isArray(cmd) ? cmd.map(String).join(" && ") : String(cmd),
      kind: scriptKind(name, String(cmd)),
      at: { path, line: findLine(text, new RegExp(`"${name}"\\s*:`)) },
    }));
  } catch {
    return [];
  }
}

const SCRIPT_SOURCES: [RegExp, (path: string, text: string) => Script[]][] = [
  [/(^|\/)package\.json$/, npmScripts],
  [/(^|\/)(GNU)?[Mm]akefile$/, makeTargets],
  [/(^|\/)[Jj]ustfile$/, justRecipes],
  [/(^|\/)pyproject\.toml$/, pyprojectScripts],
  [/(^|\/)tox\.ini$/, toxEnvs],
  [/(^|\/)noxfile\.py$/, noxSessions],
  [/(^|\/)Taskfile\.ya?ml$/, taskfile],
  [/(^|\/)composer\.json$/, composerScripts],
];

// ---------------------------------------------------------------------------

const ENV_TEMPLATE =
  /(^|\/)\.env\.(example|sample|template|dist|defaults)$|(^|\/)(example|sample)\.env$/;

const ENV_CODE: RegExp[] = [
  /process\.env\.([A-Z_][A-Z0-9_]*)/g,
  /process\.env\[["']([A-Z_][A-Z0-9_]*)["']\]/g,
  /import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g,
  /os\.environ\[["']([A-Z_][A-Z0-9_]*)["']\]/g,
  /(?:os\.environ|environ)\.get\(\s*["']([A-Z_][A-Z0-9_]*)["']/g,
  /os\.getenv\(\s*["']([A-Z_][A-Z0-9_]*)["']/g,
  /os\.(?:Getenv|LookupEnv)\(\s*"([A-Z_][A-Z0-9_]*)"/g,
  /env::var\(\s*"([A-Z_][A-Z0-9_]*)"/g,
  /ENV(?:\.fetch\(|\[)\s*["']([A-Z_][A-Z0-9_]*)["']/g,
];

/** Common variables that every environment has; listing them adds noise. */
const ENV_IGNORE = new Set([
  "NODE_ENV",
  "HOME",
  "PATH",
  "PWD",
  "USER",
  "CI",
  "DEBUG",
  "TERM",
  "SHELL",
  "TMPDIR",
  "LANG",
]);

async function envVars(repo: RepoView): Promise<EnvVar[]> {
  const vars = new Map<string, EnvVar>();
  const add = (name: string, source: EnvVar["sources"][number], description?: string) => {
    if (ENV_IGNORE.has(name)) return;
    let v = vars.get(name);
    if (!v) vars.set(name, (v = { name, sources: [] }));
    if (description && !v.description) v.description = description;
    if (!v.sources.some((s) => s.path === source.path && s.line === source.line))
      v.sources.push(source);
  };

  let scanned = 0;
  for (const path of repo.files) {
    if (isForeign(path)) continue;
    if (ENV_TEMPLATE.test(path)) {
      const lines = ((await repo.readText(path)) ?? "").split(/\r?\n/);
      lines.forEach((line, i) => {
        const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
        if (!m?.[1]) return;
        const prev = lines[i - 1] ?? "";
        add(
          m[1],
          { path, line: i + 1, kind: "template" },
          prev.startsWith("#") ? prev.replace(/^#\s*/, "") : undefined,
        );
      });
      continue;
    }
    const role = classifyFile(path, detectLanguage(path));
    if (role !== "source" || scanned >= MAX_ENV_SCAN_FILES) continue;
    scanned++;
    const text = await repo.readText(path);
    if (!text || !/env|ENV|getenv|Getenv/.test(text)) continue;
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const re of ENV_CODE) {
        re.lastIndex = 0;
        for (let m = re.exec(line); m; m = re.exec(line))
          if (m[1]) add(m[1], { path, line: i + 1, kind: "code" });
      }
    });
  }
  return [...vars.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------

function dockerfile(path: string, text: string): DockerImage {
  const img: DockerImage = { path, stages: [], exposes: [] };
  // Join continuation lines but keep line numbers of the instruction start.
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    const from = /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i.exec(line);
    if (from?.[1]) img.stages.push({ from: from[1], name: from[2], line: i + 1 });
    const expose = /^\s*EXPOSE\s+(.+)$/i.exec(line);
    if (expose?.[1]) img.exposes.push(...expose[1].trim().split(/\s+/));
    const cmd = /^\s*(CMD|ENTRYPOINT)\s+(.+)$/i.exec(line);
    if (cmd?.[2]) {
      const v = cmd[2].trim();
      try {
        img.command = v.startsWith("[") ? (JSON.parse(v) as string[]).join(" ") : v;
      } catch {
        img.command = v;
      }
    }
  });
  return img;
}

function composeServices(
  path: string,
  text: string,
  env: (name: string, line: number) => void,
): ComposeService[] {
  const y = parseYaml(text);
  const services = asRecord(asRecord(y.value)?.services) ?? {};
  return Object.entries(services).map(([name, raw]) => {
    const s = asRecord(raw) ?? {};
    const environment = s.environment;
    if (Array.isArray(environment)) {
      environment.forEach((e, i) => {
        const k = String(e).split("=")[0];
        if (k) env(k, y.lineAt(["services", name, "environment", i]));
      });
    } else {
      for (const k of Object.keys(asRecord(environment) ?? {}))
        env(k, y.lineAt(["services", name, "environment", k]));
    }
    const dependsOn = Array.isArray(s.depends_on)
      ? s.depends_on.map(String)
      : Object.keys(asRecord(s.depends_on) ?? {});
    return {
      name,
      image: asString(s.image),
      build: asString(s.build) ?? asString(asRecord(s.build)?.context),
      ports: asArray(s.ports).map((p) => asString(p) ?? JSON.stringify(p)),
      dependsOn,
      at: { path, line: y.lineAt(["services", name]) },
    };
  });
}

async function infrastructure(repo: RepoView): Promise<BuildReport["infrastructure"]> {
  const out: BuildReport["infrastructure"] = [];
  const tf = repo.files.filter((f) => f.endsWith(".tf"));
  if (tf.length) {
    const providers = new Set<string>();
    for (const f of tf) {
      for (const m of ((await repo.readText(f)) ?? "").matchAll(/^\s*provider\s+"([^"]+)"/gm))
        if (m[1]) providers.add(m[1]);
    }
    out.push({
      kind: "Terraform",
      files: tf,
      detail: providers.size ? `providers: ${[...providers].sort().join(", ")}` : undefined,
    });
  }
  const charts = repo.files.filter((f) => basename(f) === "Chart.yaml");
  if (charts.length) out.push({ kind: "Helm charts", files: charts });
  const k8s: string[] = [];
  const kinds = new Set<string>();
  for (const f of repo.files) {
    if (
      !/\.ya?ml$/.test(f) ||
      /^\.github\//.test(f) ||
      charts.some((c) => f.startsWith(dirname(c)))
    )
      continue;
    if (!/(^|\/)(k8s|kube|kubernetes|manifests|deploy|deployment|overlays|base)\//.test(f))
      continue;
    const text = (await repo.readText(f)) ?? "";
    if (/^apiVersion:/m.test(text) && /^kind:/m.test(text)) {
      k8s.push(f);
      for (const m of text.matchAll(/^kind:\s*(\w+)/gm)) if (m[1]) kinds.add(m[1]);
    }
  }
  if (k8s.length)
    out.push({
      kind: "Kubernetes manifests",
      files: k8s,
      detail: `kinds: ${[...kinds].sort().join(", ")}`,
    });
  const named: [RegExp, string][] = [
    [/(^|\/)serverless\.ya?ml$/, "Serverless Framework"],
    [/(^|\/)Pulumi\.ya?ml$/, "Pulumi"],
    [/(^|\/)cdk\.json$/, "AWS CDK"],
    [/(^|\/)fly\.toml$/, "Fly.io app config"],
    [/(^|\/)vercel\.json$/, "Vercel project config"],
    [/(^|\/)netlify\.toml$/, "Netlify site config"],
    [/(^|\/)app\.ya?ml$/, "Google App Engine config"],
    [/(^|\/)Procfile$/, "Procfile (Heroku-style process types)"],
    [/(^|\/)\.devcontainer\//, "Dev container"],
  ];
  for (const [re, kind] of named) {
    const files = repo.files.filter((f) => re.test(f));
    if (files.length) out.push({ kind, files });
  }
  return out;
}

const QUALITY: {
  name: string;
  category: QualityTool["category"];
  deps?: string[];
  files?: RegExp;
  brief: string;
}[] = [
  {
    name: "ESLint",
    category: "linter",
    deps: ["eslint"],
    files: /(^|\/)(eslint\.config\.[cm]?[jt]s|\.eslintrc(\.\w+)?)$/,
    brief: "Lints JavaScript and TypeScript.",
  },
  {
    name: "Biome",
    category: "linter",
    deps: ["@biomejs/biome"],
    files: /(^|\/)biome\.jsonc?$/,
    brief: "Lints and formats JS, TS, JSON, and CSS.",
  },
  {
    name: "Prettier",
    category: "formatter",
    deps: ["prettier"],
    files: /(^|\/)(\.prettierrc(\.\w+)?|prettier\.config\.[cm]?js)$/,
    brief: "Formats code consistently.",
  },
  {
    name: "Ruff",
    category: "linter",
    deps: ["ruff"],
    files: /(^|\/)\.?ruff\.toml$/,
    brief: "Lints and formats Python.",
  },
  { name: "Black", category: "formatter", deps: ["black"], brief: "Formats Python." },
  {
    name: "Flake8",
    category: "linter",
    deps: ["flake8"],
    files: /(^|\/)\.flake8$/,
    brief: "Lints Python.",
  },
  { name: "isort", category: "formatter", deps: ["isort"], brief: "Sorts Python imports." },
  {
    name: "mypy",
    category: "type checker",
    deps: ["mypy"],
    files: /(^|\/)mypy\.ini$/,
    brief: "Type checks Python.",
  },
  {
    name: "Pyright",
    category: "type checker",
    deps: ["pyright"],
    files: /(^|\/)pyrightconfig\.json$/,
    brief: "Type checks Python.",
  },
  {
    name: "TypeScript",
    category: "type checker",
    deps: ["typescript"],
    files: /(^|\/)tsconfig\.json$/,
    brief: "Type checks TypeScript (and JS with checkJs).",
  },
  {
    name: "Vitest",
    category: "test runner",
    deps: ["vitest"],
    files: /(^|\/)vitest\.config\.[cm]?[jt]s$/,
    brief: "Runs JS/TS tests.",
  },
  {
    name: "Jest",
    category: "test runner",
    deps: ["jest"],
    files: /(^|\/)jest\.config\.[cm]?[jt]s(on)?$/,
    brief: "Runs JS/TS tests.",
  },
  {
    name: "Mocha",
    category: "test runner",
    deps: ["mocha"],
    files: /(^|\/)\.mocharc\.\w+$/,
    brief: "Runs JS tests.",
  },
  {
    name: "pytest",
    category: "test runner",
    deps: ["pytest"],
    files: /(^|\/)(pytest\.ini|conftest\.py)$/,
    brief: "Runs Python tests.",
  },
  {
    name: "Playwright",
    category: "test runner",
    deps: ["@playwright/test"],
    files: /(^|\/)playwright\.config\.[cm]?[jt]s$/,
    brief: "Runs browser end-to-end tests.",
  },
  {
    name: "coverage.py",
    category: "coverage",
    deps: ["coverage", "pytest-cov"],
    files: /(^|\/)\.coveragerc$/,
    brief: "Measures Python test coverage.",
  },
  {
    name: "c8 / nyc",
    category: "coverage",
    deps: ["c8", "nyc", "@vitest/coverage-v8"],
    files: /(^|\/)\.nycrc(\.\w+)?$/,
    brief: "Measures JS test coverage.",
  },
  {
    name: "Codecov",
    category: "coverage",
    files: /(^|\/)\.?codecov\.ya?ml$/,
    brief: "Reports coverage on pull requests.",
  },
  {
    name: "pre-commit",
    category: "git hooks",
    deps: ["pre-commit"],
    files: /(^|\/)\.pre-commit-config\.ya?ml$/,
    brief: "Runs checks automatically before each commit.",
  },
  {
    name: "Husky",
    category: "git hooks",
    deps: ["husky"],
    files: /(^|\/)\.husky\//,
    brief: "Runs scripts on git hooks such as pre-commit.",
  },
  {
    name: "lint-staged",
    category: "git hooks",
    deps: ["lint-staged"],
    files: /(^|\/)\.lintstagedrc(\.\w+)?$/,
    brief: "Runs linters only on staged files.",
  },
  {
    name: "commitlint",
    category: "commit convention",
    deps: ["@commitlint/cli"],
    files: /(^|\/)(commitlint\.config\.[cm]?[jt]s|\.commitlintrc(\.\w+)?)$/,
    brief: "Enforces a commit message format, usually Conventional Commits.",
  },
  {
    name: "Dependabot",
    category: "dependency updates",
    files: /^\.github\/dependabot\.ya?ml$/,
    brief: "Opens pull requests to update dependencies.",
  },
  {
    name: "Renovate",
    category: "dependency updates",
    files: /(^|\/)(renovate\.json5?|\.renovaterc(\.json)?)$/,
    brief: "Opens pull requests to update dependencies.",
  },
  {
    name: "EditorConfig",
    category: "formatter",
    files: /(^|\/)\.editorconfig$/,
    brief: "Shares basic editor settings (indentation, line endings).",
  },
];

function qualityTools(
  files: readonly string[],
  deps: Dependency[],
  pyprojectText: string | undefined,
): QualityTool[] {
  const depNames = new Set(deps.map((d) => d.name.toLowerCase()));
  const out: QualityTool[] = [];
  for (const q of QUALITY) {
    const configFiles = q.files ? files.filter((f) => q.files?.test(f) && !isForeign(f)) : [];
    const toolSection =
      pyprojectText && new RegExp(`^\\[tool\\.${q.name.toLowerCase()}`, "m").test(pyprojectText);
    if (toolSection) configFiles.push("pyproject.toml");
    if (configFiles.length || q.deps?.some((d) => depNames.has(d))) {
      out.push({ name: q.name, category: q.category, configFiles, brief: q.brief });
    }
  }
  return out;
}

/** Strip a build output prefix so `dist/index.js` points back at `src/index.ts` when that exists. */
function sourceFor(dir: string, rel: string, files: Set<string>): string | undefined {
  const clean = rel.replace(/^\.\//, "");
  const base = dir ? `${dir}/${clean}` : clean;
  const candidates = [base, base.replace(/(^|\/)(dist|lib|build|out)\//, "$1src/")];
  for (const c of candidates) {
    if (files.has(c)) return c;
    const stem = c.replace(/\.(m|c)?jsx?$/, "");
    for (const ext of [".ts", ".tsx", ".mts", ".js", ".mjs", ".py"])
      if (files.has(stem + ext)) return stem + ext;
  }
  return undefined;
}

async function manifestEntryPoints(repo: RepoView): Promise<BuildReport["entryPoints"]> {
  const files = new Set(repo.files);
  const out: BuildReport["entryPoints"] = [];
  for (const path of repo.files) {
    if (basename(path) === "package.json" && !isForeign(path)) {
      const text = (await repo.readText(path)) ?? "";
      let json: Record<string, unknown>;
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        continue;
      }
      const dir = dirname(path);
      const bin =
        typeof json.bin === "string" ? { [String(json.name)]: json.bin } : asRecord(json.bin);
      for (const [name, target] of Object.entries(bin ?? {})) {
        const src = sourceFor(dir, String(target), files);
        if (src)
          out.push({
            path: src,
            reason: `CLI command \`${name}\` (package.json bin)`,
            at: { path, line: findLine(text, /"bin"\s*:/) },
          });
      }
      for (const field of ["main", "module", "source"]) {
        const target = asString(json[field]);
        const src = target ? sourceFor(dir, target, files) : undefined;
        if (src)
          out.push({
            path: src,
            reason: `package entry (package.json ${field})`,
            at: { path, line: findLine(text, new RegExp(`"${field}"\\s*:`)) },
          });
      }
    }
    if (basename(path) === "pyproject.toml") {
      const text = (await repo.readText(path)) ?? "";
      for (const s of pyprojectScripts(path, text)) {
        const target = /calls (\S+)/.exec(s.description ?? "")?.[1] ?? "";
        const mod = target.split(":")[0]?.replaceAll(".", "/") ?? "";
        const dir = dirname(path);
        const prefix = dir ? `${dir}/` : "";
        const src = [
          `${prefix}${mod}.py`,
          `${prefix}src/${mod}.py`,
          `${prefix}${mod}/__init__.py`,
          `${prefix}src/${mod}/__init__.py`,
        ].find((c) => files.has(c));
        if (src)
          out.push({
            path: src,
            reason: `console command \`${s.name}\` (pyproject scripts)`,
            at: s.at,
          });
      }
    }
    if (/(^|\/)Procfile$/.test(path)) {
      const lines = ((await repo.readText(path)) ?? "").split(/\r?\n/);
      lines.forEach((line, i) => {
        const m = /^(\w+):\s*(.+)$/.exec(line);
        const fileRef = m?.[2]
          ?.split(/\s+/)
          .find((t) => /\.(py|js|ts|rb)$/.test(t) || /^\w+:\w+$/.test(t));
        const candidate = fileRef?.includes(":") ? `${fileRef.split(":")[0]}.py` : fileRef;
        if (m && candidate && files.has(candidate))
          out.push({
            path: candidate,
            reason: `Procfile process \`${m[1]}\``,
            at: { path, line: i + 1 },
          });
      });
    }
  }
  return out;
}

export async function detectBuild(repo: RepoView, deps: Dependency[] = []): Promise<BuildReport> {
  const scripts: Script[] = [];
  const docker: DockerImage[] = [];
  const compose: ComposeService[] = [];
  const composeEnv: EnvVar["sources"] = [];
  const composeNames: string[] = [];
  for (const path of repo.files) {
    if (isForeign(path)) continue;
    const scriptParser = SCRIPT_SOURCES.find(([re]) => re.test(path))?.[1];
    const isDocker = /(^|\/)(Dockerfile[^/]*|[^/]+\.dockerfile)$/i.test(path);
    const isCompose = /(^|\/)(docker-)?compose[^/]*\.ya?ml$/.test(path);
    if (!scriptParser && !isDocker && !isCompose) continue;
    const text = (await repo.readText(path))?.replace(/\r\n/g, "\n");
    if (text === undefined) continue;
    if (scriptParser) scripts.push(...scriptParser(path, text));
    if (isDocker) docker.push(dockerfile(path, text));
    if (isCompose) {
      try {
        compose.push(
          ...composeServices(path, text, (name, line) => {
            composeNames.push(name);
            composeEnv.push({ path, line, kind: "compose" });
          }),
        );
      } catch {
        // Invalid compose YAML: skipped, still listed as a config file.
      }
    }
  }
  const env = await envVars(repo);
  composeNames.forEach((name, i) => {
    const source = composeEnv[i];
    if (!source || ENV_IGNORE.has(name)) return;
    let v = env.find((e) => e.name === name);
    if (!v) env.push((v = { name, sources: [] }));
    v.sources.push(source);
  });
  env.sort((a, b) => a.name.localeCompare(b.name));
  const pyprojectText = repo.files.includes("pyproject.toml")
    ? await repo.readText("pyproject.toml")
    : undefined;
  return {
    scripts,
    env,
    docker,
    compose,
    infrastructure: await infrastructure(repo),
    quality: qualityTools(repo.files, deps, pyprojectText),
    entryPoints: await manifestEntryPoints(repo),
  };
}
