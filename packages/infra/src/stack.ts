import type { ImportFact } from "@grasp/core";
import { parse as parseToml } from "smol-toml";
import { CATALOG, matchesPackage, pythonModulesFor } from "./catalog.js";
import { lockedKey, readLockfiles, readManifests } from "./manifests.js";
import { asRecord, asString, basename, findLine, isForeign } from "./text.js";
import type {
  Citation,
  Dependency,
  FrameworkUsage,
  PackageManager,
  RepoView,
  Runtime,
  StackReport,
} from "./types.js";

const MAX_USAGE_SITES = 50;

/** Import specifier package names for a dependency, as they appear in `ImportFact.external`. */
function importNames(d: Dependency, extraModules: string[] = []): string[] {
  if (d.ecosystem === "npm") return [d.name];
  if (d.ecosystem === "pypi") return [...pythonModulesFor(d.name), ...extraModules];
  return [];
}

function usageSites(
  packages: Dependency[],
  imports: ImportFact[],
  modules: string[] | undefined,
): Citation[] {
  const names = new Set(packages.flatMap((p) => importNames(p, modules)));
  const firstLine = new Map<string, number>();
  for (const imp of imports) {
    if (!imp.external || !names.has(imp.external)) continue;
    const prev = firstLine.get(imp.from);
    if (prev === undefined || imp.line < prev) firstLine.set(imp.from, imp.line);
  }
  return [...firstLine.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, MAX_USAGE_SITES)
    .map(([path, line]) => ({ path, line }));
}

function frameworks(
  deps: Dependency[],
  files: readonly string[],
  imports: ImportFact[],
): FrameworkUsage[] {
  const out: FrameworkUsage[] = [];
  for (const entry of CATALOG) {
    const packages = deps.filter((d) =>
      (entry.packages[d.ecosystem] ?? []).some((p) => matchesPackage(p, d.name, d.ecosystem)),
    );
    if (packages.length === 0) continue;
    const config = (entry.config ?? []).map((re) => new RegExp(re));
    const configFiles = files.filter(
      (f) => !isForeign(f) && config.some((re) => re.test(basename(f))),
    );
    out.push({
      id: entry.id,
      name: entry.name,
      category: entry.category,
      brief: entry.brief,
      docs: entry.docs,
      packages,
      usedIn: usageSites(packages, imports, entry.modules),
      configFiles,
    });
  }
  // Most used first; ties by name so output is stable.
  return out.sort((a, b) => b.usedIn.length - a.usedIn.length || a.name.localeCompare(b.name));
}

async function runtimes(repo: RepoView): Promise<Runtime[]> {
  const out: Runtime[] = [];
  const has = new Set(repo.files);
  const read = async (p: string) =>
    has.has(p) ? (await repo.readText(p))?.replace(/\r\n/g, "\n") : undefined;

  for (const file of [".nvmrc", ".node-version"]) {
    const v = (await read(file))?.trim();
    if (v) out.push({ name: "Node.js", version: v, source: { path: file, line: 1 } });
  }
  const pkgText = await read("package.json");
  if (pkgText) {
    try {
      const pkg = JSON.parse(pkgText) as Record<string, unknown>;
      const engines = asRecord(pkg.engines);
      for (const [engine, label] of [
        ["node", "Node.js"],
        ["bun", "Bun"],
      ] as const) {
        const v = asString(engines?.[engine]);
        if (v)
          out.push({
            name: label,
            version: v,
            source: {
              path: "package.json",
              line: findLine(pkgText, new RegExp(`"${engine}"\\s*:`)),
            },
          });
      }
    } catch {
      // Reported by the manifest reader.
    }
  }
  const pyVersion = (await read(".python-version"))?.trim();
  if (pyVersion)
    out.push({ name: "Python", version: pyVersion, source: { path: ".python-version", line: 1 } });
  const pyproject = await read("pyproject.toml");
  if (pyproject) {
    try {
      const toml = parseToml(pyproject) as Record<string, unknown>;
      const req = asString(asRecord(toml.project)?.["requires-python"]);
      const poetryPy = asString(
        asRecord(asRecord(asRecord(toml.tool)?.poetry)?.dependencies)?.python,
      );
      const v = req ?? poetryPy;
      if (v)
        out.push({
          name: "Python",
          version: v,
          source: {
            path: "pyproject.toml",
            line: findLine(pyproject, /requires-python|^python\s*=/),
          },
        });
    } catch {
      // Reported by the manifest reader.
    }
  }
  const goMod = await read("go.mod");
  const goLine = goMod ? /^go\s+(\S+)/m.exec(goMod) : null;
  if (goMod && goLine?.[1])
    out.push({
      name: "Go",
      version: goLine[1],
      source: { path: "go.mod", line: findLine(goMod, /^go\s+/) },
    });
  for (const file of ["rust-toolchain.toml", "rust-toolchain"]) {
    const t = await read(file);
    const v = t ? (/channel\s*=\s*"([^"]+)"/.exec(t)?.[1] ?? t.trim().split("\n")[0]) : undefined;
    if (v) out.push({ name: "Rust", version: v, source: { path: file, line: 1 } });
  }
  const ruby = (await read(".ruby-version"))?.trim();
  if (ruby) out.push({ name: "Ruby", version: ruby, source: { path: ".ruby-version", line: 1 } });
  const toolVersions = await read(".tool-versions");
  toolVersions?.split("\n").forEach((line, i) => {
    const [tool, version] = line.trim().split(/\s+/);
    if (tool && version && !line.startsWith("#"))
      out.push({ name: tool, version, source: { path: ".tool-versions", line: i + 1 } });
  });
  return out;
}

const MANAGERS: [RegExp, string, string][] = [
  [/(^|\/)pnpm-lock\.yaml$/, "pnpm", "pnpm install"],
  [/(^|\/)yarn\.lock$/, "Yarn", "yarn install"],
  [/(^|\/)package-lock\.json$/, "npm", "npm ci"],
  [/(^|\/)bun\.lockb?$/, "Bun", "bun install"],
  [/(^|\/)uv\.lock$/, "uv", "uv sync"],
  [/(^|\/)poetry\.lock$/, "Poetry", "poetry install"],
  [/(^|\/)Pipfile\.lock$/, "Pipenv", "pipenv install --dev"],
  [/(^|\/)Cargo\.lock$/, "Cargo", "cargo build"],
  [/(^|\/)go\.sum$/, "Go modules", "go mod download"],
  [/(^|\/)Gemfile\.lock$/, "Bundler", "bundle install"],
  [/(^|\/)composer\.lock$/, "Composer", "composer install"],
  [/(^|\/)pom\.xml$/, "Maven", "mvn install"],
  [/(^|\/)build\.gradle(\.kts)?$/, "Gradle", "./gradlew build"],
];

async function packageManagers(repo: RepoView): Promise<PackageManager[]> {
  const out: PackageManager[] = [];
  const seen = new Set<string>();
  const pkgText = repo.files.includes("package.json")
    ? await repo.readText("package.json")
    : undefined;
  const declared = pkgText ? /"packageManager"\s*:\s*"([a-z]+)@([^"]+)"/.exec(pkgText) : null;
  if (declared?.[1]) {
    const name = declared[1] === "yarn" ? "Yarn" : declared[1];
    out.push({
      name,
      evidence: `package.json packageManager ${declared[1]}@${declared[2]}`,
      install: `corepack enable && ${declared[1]} install`,
    });
    seen.add(name);
  }
  // Root-level evidence wins; nested lockfiles in fixtures or examples are ignored.
  for (const f of repo.files) {
    if (f.includes("/")) continue;
    for (const [re, name, install] of MANAGERS) {
      if (re.test(f) && !seen.has(name)) {
        out.push({ name, evidence: f, install });
        seen.add(name);
      }
    }
  }
  const hasRequirements = repo.files.some((f) => /^requirements[^/]*\.txt$/.test(f));
  if (hasRequirements && !seen.has("uv") && !seen.has("Poetry") && !seen.has("Pipenv")) {
    out.push({
      name: "pip",
      evidence: "requirements.txt",
      install: "pip install -r requirements.txt",
    });
  } else if (repo.files.includes("pyproject.toml") && !seen.has("uv") && !seen.has("Poetry")) {
    out.push({ name: "pip", evidence: "pyproject.toml", install: "pip install -e ." });
  }
  return out;
}

export async function detectStack(
  repo: RepoView,
  imports: ImportFact[] = [],
): Promise<StackReport> {
  const warnings: string[] = [];
  const deps = await readManifests(repo, warnings);
  const locked = await readLockfiles(repo, warnings);
  for (const d of deps) d.locked ??= locked.get(lockedKey(d));
  return {
    runtimes: await runtimes(repo),
    packageManagers: await packageManagers(repo),
    dependencies: deps,
    frameworks: frameworks(deps, repo.files, imports),
    warnings,
  };
}
