import { classifyFile, detectLanguage } from "@grasp/core";
import { parse as parseToml } from "smol-toml";
import { normalizePypi } from "./catalog.js";
import { asRecord, asString, basename, escapeRegex, isForeign, parseYaml } from "./text.js";
import type { Dependency, Ecosystem, RepoView } from "./types.js";

type Scope = Dependency["scope"];

function dep(
  ecosystem: Ecosystem,
  name: string,
  declared: string | undefined,
  scope: Scope,
  path: string,
  text: string,
): Dependency {
  // Prefer a quoted key (JSON, TOML tables), then the bare name inside a list entry.
  const n = escapeRegex(name);
  const quoted = new RegExp(`["']${n}["']\\s*[:=]`);
  const bare = new RegExp(`(^|[\\s"'(:])${n}($|[\\s"'\\[<>=~!;,)@:])`, "i");
  const lines = text.split("\n");
  const idx = lines.findIndex((l) => quoted.test(l));
  const line = (idx !== -1 ? idx : lines.findIndex((l) => bare.test(l))) + 1 || 1;
  return { ecosystem, name, declared: declared || undefined, scope, manifest: { path, line } };
}

function fromRecord(
  ecosystem: Ecosystem,
  record: unknown,
  scope: Scope,
  path: string,
  text: string,
): Dependency[] {
  const r = asRecord(record);
  if (!r) return [];
  return Object.entries(r).map(([name, v]) => {
    const version = asString(v) ?? asString(asRecord(v)?.version);
    return dep(ecosystem, name, version, scope, path, text);
  });
}

function packageJson(path: string, text: string, warnings: string[]): Dependency[] {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch (err) {
    warnings.push(`${path}: invalid JSON (${(err as Error).message})`);
    return [];
  }
  return [
    ...fromRecord("npm", json.dependencies, "runtime", path, text),
    ...fromRecord("npm", json.devDependencies, "dev", path, text),
    ...fromRecord("npm", json.peerDependencies, "peer", path, text),
    ...fromRecord("npm", json.optionalDependencies, "optional", path, text),
  ];
}

/** `name[extra]>=1.0 ; python_version<"3.12"` -> name and version spec. */
export function parseRequirement(
  line: string,
): { name: string; spec?: string | undefined } | undefined {
  const s = line.replace(/#.*$/, "").trim();
  if (!s || s.startsWith("-") || s.includes("://")) return undefined;
  const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*([^;]*)/.exec(s);
  if (!m?.[1]) return undefined;
  return { name: m[1], spec: m[3]?.trim() || undefined };
}

function pyList(list: unknown, scope: Scope, path: string, text: string): Dependency[] {
  if (!Array.isArray(list)) return [];
  const out: Dependency[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const r = parseRequirement(item);
    if (r) out.push(dep("pypi", r.name, r.spec, scope, path, text));
  }
  return out;
}

const DEV_GROUP = /dev|test|lint|doc|type|check|ci/i;

function pyproject(path: string, text: string, warnings: string[]): Dependency[] {
  let toml: Record<string, unknown>;
  try {
    toml = parseToml(text) as Record<string, unknown>;
  } catch (err) {
    warnings.push(`${path}: invalid TOML (${(err as Error).message})`);
    return [];
  }
  const out: Dependency[] = [];
  const project = asRecord(toml.project);
  out.push(...pyList(project?.dependencies, "runtime", path, text));
  for (const [group, list] of Object.entries(asRecord(project?.["optional-dependencies"]) ?? {})) {
    out.push(...pyList(list, DEV_GROUP.test(group) ? "dev" : "optional", path, text));
  }
  // PEP 735 dependency groups.
  for (const [group, list] of Object.entries(asRecord(toml["dependency-groups"]) ?? {})) {
    out.push(...pyList(list, DEV_GROUP.test(group) ? "dev" : "optional", path, text));
  }
  const poetry = asRecord(asRecord(toml.tool)?.poetry);
  if (poetry) {
    const main = fromRecord("pypi", poetry.dependencies, "runtime", path, text).filter(
      (d) => d.name.toLowerCase() !== "python",
    );
    out.push(...main, ...fromRecord("pypi", poetry["dev-dependencies"], "dev", path, text));
    for (const [group, cfg] of Object.entries(asRecord(poetry.group) ?? {})) {
      const scope: Scope = DEV_GROUP.test(group) ? "dev" : "optional";
      out.push(...fromRecord("pypi", asRecord(cfg)?.dependencies, scope, path, text));
    }
  }
  const build = asRecord(toml["build-system"]);
  out.push(...pyList(build?.requires, "build", path, text));
  return out;
}

function requirementsTxt(path: string, text: string): Dependency[] {
  const scope: Scope = DEV_GROUP.test(basename(path)) ? "dev" : "runtime";
  const out: Dependency[] = [];
  text.split("\n").forEach((line, i) => {
    const r = parseRequirement(line);
    if (r)
      out.push({
        ecosystem: "pypi",
        name: r.name,
        declared: r.spec,
        scope,
        manifest: { path, line: i + 1 },
      });
  });
  return out;
}

function pipfile(path: string, text: string, warnings: string[]): Dependency[] {
  try {
    const toml = parseToml(text) as Record<string, unknown>;
    return [
      ...fromRecord("pypi", toml.packages, "runtime", path, text),
      ...fromRecord("pypi", toml["dev-packages"], "dev", path, text),
    ];
  } catch (err) {
    warnings.push(`${path}: invalid TOML (${(err as Error).message})`);
    return [];
  }
}

function goMod(path: string, text: string): Dependency[] {
  const out: Dependency[] = [];
  let inBlock = false;
  text.split("\n").forEach((raw, i) => {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (line.startsWith("require (")) inBlock = true;
    else if (inBlock && line === ")") inBlock = false;
    const m = inBlock ? /^(\S+)\s+(\S+)/.exec(line) : /^require\s+(\S+)\s+(\S+)/.exec(line);
    if (m?.[1] && m[2] && m[1] !== "require") {
      const indirect = raw.includes("// indirect");
      out.push({
        ecosystem: "go",
        name: m[1],
        declared: m[2],
        locked: m[2],
        scope: indirect ? "optional" : "runtime",
        manifest: { path, line: i + 1 },
      });
    }
  });
  return out;
}

function cargoToml(path: string, text: string, warnings: string[]): Dependency[] {
  try {
    const toml = parseToml(text) as Record<string, unknown>;
    const ws = asRecord(toml.workspace);
    return [
      ...fromRecord("cargo", toml.dependencies, "runtime", path, text),
      ...fromRecord("cargo", toml["dev-dependencies"], "dev", path, text),
      ...fromRecord("cargo", toml["build-dependencies"], "build", path, text),
      ...fromRecord("cargo", ws?.dependencies, "runtime", path, text),
    ];
  } catch (err) {
    warnings.push(`${path}: invalid TOML (${(err as Error).message})`);
    return [];
  }
}

function pomXml(path: string, text: string): Dependency[] {
  const out: Dependency[] = [];
  const re = /<dependency>([\s\S]*?)<\/dependency>/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const body = m[1] ?? "";
    const tag = (t: string) => new RegExp(`<${t}>\\s*([^<]+?)\\s*</${t}>`).exec(body)?.[1];
    const g = tag("groupId");
    const a = tag("artifactId");
    if (!g || !a) continue;
    const scope = tag("scope");
    const line = text.slice(0, m.index).split("\n").length;
    out.push({
      ecosystem: "maven",
      name: `${g}:${a}`,
      declared: tag("version"),
      scope: scope === "test" ? "dev" : scope === "provided" ? "optional" : "runtime",
      manifest: { path, line },
    });
  }
  return out;
}

function gradle(path: string, text: string): Dependency[] {
  const out: Dependency[] = [];
  const re =
    /\b(implementation|api|compileOnly|runtimeOnly|testImplementation|testRuntimeOnly|kapt|ksp)\s*\(?\s*["']([^"':]+):([^"':]+)(?::([^"']+))?["']/g;
  text.split("\n").forEach((line, i) => {
    re.lastIndex = 0;
    for (let m = re.exec(line); m; m = re.exec(line)) {
      out.push({
        ecosystem: "maven",
        name: `${m[2]}:${m[3]}`,
        declared: m[4],
        scope: m[1]?.startsWith("test") ? "dev" : "runtime",
        manifest: { path, line: i + 1 },
      });
    }
  });
  return out;
}

function gemfile(path: string, text: string): Dependency[] {
  const out: Dependency[] = [];
  let devGroup = false;
  text.split("\n").forEach((line, i) => {
    if (/^\s*group\s+.*(:development|:test)/.test(line)) devGroup = true;
    else if (/^\s*end\b/.test(line)) devGroup = false;
    const m = /^\s*gem\s+["']([^"']+)["'](?:\s*,\s*["']([^"']+)["'])?/.exec(line);
    if (m?.[1]) {
      out.push({
        ecosystem: "gem",
        name: m[1],
        declared: m[2],
        scope: devGroup || /group:.*(development|test)/.test(line) ? "dev" : "runtime",
        manifest: { path, line: i + 1 },
      });
    }
  });
  return out;
}

function composerJson(path: string, text: string, warnings: string[]): Dependency[] {
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    const isPlatform = (d: Dependency) => d.name === "php" || d.name.startsWith("ext-");
    return [
      ...fromRecord("composer", json.require, "runtime", path, text),
      ...fromRecord("composer", json["require-dev"], "dev", path, text),
    ].filter((d) => !isPlatform(d));
  } catch (err) {
    warnings.push(`${path}: invalid JSON (${(err as Error).message})`);
    return [];
  }
}

type ManifestParser = (path: string, text: string, warnings: string[]) => Dependency[];

const MANIFESTS: [RegExp, ManifestParser][] = [
  [/(^|\/)package\.json$/, packageJson],
  [/(^|\/)pyproject\.toml$/, pyproject],
  [/(^|\/)requirements[^/]*\.(txt|in)$/, requirementsTxt],
  [/(^|\/)Pipfile$/, pipfile],
  [/(^|\/)go\.mod$/, goMod],
  [/(^|\/)Cargo\.toml$/, cargoToml],
  [/(^|\/)pom\.xml$/, pomXml],
  [/(^|\/)build\.gradle(\.kts)?$/, gradle],
  [/(^|\/)Gemfile$/, gemfile],
  [/(^|\/)composer\.json$/, composerJson],
];

export function isManifest(path: string): boolean {
  return MANIFESTS.some(([re]) => re.test(path));
}

export async function readManifests(repo: RepoView, warnings: string[]): Promise<Dependency[]> {
  const out: Dependency[] = [];
  for (const path of repo.files) {
    const parser = MANIFESTS.find(([re]) => re.test(path))?.[1];
    if (!parser || isForeign(path)) continue;
    const text = await repo.readText(path);
    if (text === undefined) continue;
    try {
      const deps = parser(path, text.replace(/\r\n/g, "\n"), warnings);
      // Manifests inside test folders declare test tooling or sample projects, never runtime needs.
      if (classifyFile(path, detectLanguage(path)) === "test") {
        for (const d of deps) if (d.scope === "runtime") d.scope = "dev";
      }
      out.push(...deps);
    } catch (err) {
      warnings.push(`${path}: could not read dependencies (${(err as Error).message})`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lockfiles: exact versions keyed by `${ecosystem}:${normalized name}`.

export type LockedVersions = Map<string, string>;

function key(ecosystem: Ecosystem, name: string): string {
  return `${ecosystem}:${ecosystem === "pypi" ? normalizePypi(name) : name}`;
}

export function lockedKey(d: Pick<Dependency, "ecosystem" | "name">): string {
  return key(d.ecosystem, d.name);
}

function tomlPackages(text: string, ecosystem: Ecosystem, out: LockedVersions): void {
  const toml = parseToml(text) as Record<string, unknown>;
  for (const p of (toml.package as unknown[] | undefined) ?? []) {
    const r = asRecord(p);
    const name = asString(r?.name);
    const version = asString(r?.version);
    if (name && version && !out.has(key(ecosystem, name))) out.set(key(ecosystem, name), version);
  }
}

const LOCKFILES: [RegExp, (text: string, out: LockedVersions) => void][] = [
  [
    /(^|\/)package-lock\.json$/,
    (text, out) => {
      const json = JSON.parse(text) as Record<string, unknown>;
      for (const [p, v] of Object.entries(asRecord(json.packages) ?? {})) {
        const name = p.split("node_modules/").pop();
        const version = asString(asRecord(v)?.version);
        // Top-level entries only: nested node_modules are transitive duplicates.
        if (name && version && p === `node_modules/${name}` && !out.has(key("npm", name))) {
          out.set(key("npm", name), version);
        }
      }
      for (const [name, v] of Object.entries(asRecord(json.dependencies) ?? {})) {
        const version = asString(asRecord(v)?.version);
        if (version && !out.has(key("npm", name))) out.set(key("npm", name), version);
      }
    },
  ],
  [
    /(^|\/)pnpm-lock\.yaml$/,
    (text, out) => {
      const lock = asRecord(parseYaml(text).value);
      for (const importer of Object.values(asRecord(lock?.importers) ?? {})) {
        const imp = asRecord(importer);
        for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
          for (const [name, v] of Object.entries(asRecord(imp?.[section]) ?? {})) {
            const version = asString(asRecord(v)?.version) ?? asString(v);
            // Strip peer suffixes like `1.2.3(react@18.3.1)` and skip workspace links.
            const clean = version?.replace(/\(.*$/, "");
            if (clean && !clean.startsWith("link:") && !out.has(key("npm", name))) {
              out.set(key("npm", name), clean);
            }
          }
        }
      }
    },
  ],
  [
    /(^|\/)yarn\.lock$/,
    (text, out) => {
      let names: string[] = [];
      for (const line of text.split("\n")) {
        if (/^\S.*:$/.test(line)) {
          names = line
            .slice(0, -1)
            .split(",")
            .map((s) => s.trim().replace(/^"|"$/g, ""))
            .map((s) => s.slice(0, s.lastIndexOf("@") > 0 ? s.lastIndexOf("@") : undefined));
        }
        const v = /^\s+version:?\s+"?([^"\s]+)"?/.exec(line)?.[1];
        if (v) for (const n of names) if (!out.has(key("npm", n))) out.set(key("npm", n), v);
      }
    },
  ],
  [/(^|\/)poetry\.lock$/, (text, out) => tomlPackages(text, "pypi", out)],
  [/(^|\/)uv\.lock$/, (text, out) => tomlPackages(text, "pypi", out)],
  [/(^|\/)Cargo\.lock$/, (text, out) => tomlPackages(text, "cargo", out)],
  [
    /(^|\/)Pipfile\.lock$/,
    (text, out) => {
      const json = JSON.parse(text) as Record<string, unknown>;
      for (const section of ["default", "develop"]) {
        for (const [name, v] of Object.entries(asRecord(json[section]) ?? {})) {
          const version = asString(asRecord(v)?.version)?.replace(/^==/, "");
          if (version) out.set(key("pypi", name), version);
        }
      }
    },
  ],
  [
    /(^|\/)Gemfile\.lock$/,
    (text, out) => {
      for (const m of text.matchAll(/^ {4}([A-Za-z0-9_.-]+) \(([^)]+)\)$/gm)) {
        if (m[1] && m[2]) out.set(key("gem", m[1]), m[2]);
      }
    },
  ],
  [
    /(^|\/)composer\.lock$/,
    (text, out) => {
      const json = JSON.parse(text) as Record<string, unknown>;
      for (const p of [
        ...((json.packages as unknown[]) ?? []),
        ...((json["packages-dev"] as unknown[]) ?? []),
      ]) {
        const r = asRecord(p);
        const name = asString(r?.name);
        const version = asString(r?.version);
        if (name && version) out.set(key("composer", name), version.replace(/^v/, ""));
      }
    },
  ],
];

export function isLockfile(path: string): boolean {
  return LOCKFILES.some(([re]) => re.test(path));
}

export async function readLockfiles(repo: RepoView, warnings: string[]): Promise<LockedVersions> {
  const out: LockedVersions = new Map();
  for (const path of repo.files) {
    const parser = LOCKFILES.find(([re]) => re.test(path))?.[1];
    if (!parser || isForeign(path)) continue;
    const text = await repo.readText(path);
    if (text === undefined) continue;
    try {
      parser(text.replace(/\r\n/g, "\n"), out);
    } catch (err) {
      warnings.push(`${path}: could not read lockfile (${(err as Error).message})`);
    }
  }
  return out;
}
