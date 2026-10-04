import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG, listFiles, scanRepo } from "@grasp/core";
import { defaultPacks } from "@grasp/langs";
import { describe, expect, it } from "vitest";
import { normalizePypi, pythonModulesFor } from "./catalog.js";
import { detectInfra } from "./index.js";
import { parseRequirement } from "./manifests.js";
import { describeUses } from "./pipelines/actions.js";
import { jobEdges, jobGraphMermaid } from "./pipelines/index.js";
import { parseGitlab } from "./pipelines/others.js";
import { scriptKind } from "./build.js";
import { isForeign } from "./text.js";

const fixture = (name: string) =>
  fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url));

async function infra(name: string) {
  const root = fixture(name);
  const { files } = await listFiles(root, { useGit: false });
  const { facts } = await scanRepo(root, {
    packs: defaultPacks(),
    config: DEFAULT_CONFIG,
    toolVersion: "test",
    useGit: false,
  });
  const repo = {
    files,
    readText: (p: string) => readFile(join(root, p), "utf8").catch(() => undefined),
  };
  return detectInfra(repo, facts.imports);
}

const golden = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

describe("js-app infra", async () => {
  const r = await infra("js-app");

  it("matches the golden report", async () => {
    await expect(golden(r)).toMatchFileSnapshot("./__golden__/js-app.infra.json");
  });

  it("finds frameworks with usage sites from real imports", () => {
    const express = r.stack.frameworks.find((f) => f.id === "express");
    expect(express?.usedIn).toEqual([{ path: "src/server.ts", line: 1 }]);
    expect(express?.brief).toMatch(/middleware/);
    expect(r.stack.frameworks.find((f) => f.id === "typescript")?.configFiles).toEqual([
      "tsconfig.json",
    ]);
  });

  it("summarizes pipelines and never exposes secret values", () => {
    const ci = r.pipelines.find((p) => p.path === ".github/workflows/ci.yml");
    expect(ci?.brief).toBe(
      "Runs lint and tests on pushes to main and pull requests, across os ubuntu-latest and windows-latest × node 20 and 22.",
    );
    expect(ci?.secrets).toEqual(["TEST_JWT_SECRET"]);
    expect(ci && jobEdges(ci)).toEqual([["lint", "test"]]);
    const release = r.pipelines.find((p) => p.path === ".github/workflows/release.yml");
    expect(release?.deploys.map((d) => d.target)).toEqual(["npm registry", "container registry"]);
  });

  it("maps bin and main back to source entry points", () => {
    expect(r.build.entryPoints.map((e) => e.path)).toEqual(["src/index.ts", "src/index.ts"]);
  });

  it("collects env vars from templates and code with descriptions", () => {
    const jwt = r.build.env.find((e) => e.name === "JWT_SECRET");
    expect(jwt?.description).toMatch(/16 characters/);
    expect(jwt?.sources.map((s) => s.kind).sort()).toEqual(["code", "template"]);
  });
});

describe("py-app infra", async () => {
  const r = await infra("py-app");

  it("matches the golden report", async () => {
    await expect(golden(r)).toMatchFileSnapshot("./__golden__/py-app.infra.json");
  });

  it("maps Python import names to distributions", () => {
    expect(
      r.stack.frameworks.find((f) => f.id === "sqlalchemy")?.usedIn.map((u) => u.path),
    ).toEqual(["src/shop/models.py"]);
  });
});

describe("malformed infra", () => {
  it("reports broken files instead of throwing", async () => {
    const r = await infra("malformed");
    expect(r.stack.warnings[0]).toMatch(/package\.json: invalid JSON/);
    const broken = r.pipelines.find((p) => p.path === ".github/workflows/broken.yml");
    expect(broken?.parsed).toBe(false);
    expect(broken?.brief).toMatch(/Could not parse/);
    expect(r.pipelines.find((p) => p.system === "jenkins")?.parsed).toBe(false);
    expect(r.pipelines.find((p) => p.system === "circleci")?.jobs[0]?.steps).toHaveLength(3);
  });
});

describe("helpers", () => {
  it("parses requirement lines", () => {
    expect(parseRequirement("uvicorn[standard]==0.30.1 ; python_version>'3.8'")).toEqual({
      name: "uvicorn",
      spec: "==0.30.1",
    });
    expect(parseRequirement("-r dev.txt")).toBeUndefined();
    expect(parseRequirement("git+https://x/y.git")).toBeUndefined();
  });

  it("normalizes Python names and import modules", () => {
    expect(normalizePypi("Flask_SQLAlchemy")).toBe("flask-sqlalchemy");
    expect(pythonModulesFor("PyYAML")).toEqual(["yaml"]);
    expect(pythonModulesFor("python-multipart")).toEqual(["python_multipart"]);
  });

  it("classifies script names", () => {
    expect(scriptKind("test:unit")).toBe("test");
    expect(scriptKind("typecheck")).toBe("lint");
    expect(scriptKind("ci", "pytest -q")).toBe("test");
  });

  it("describes known actions regardless of version", () => {
    expect(describeUses("actions/checkout@v4")).toMatch(/Checks out/);
    expect(describeUses("github/codeql-action/init@v3")).toMatch(/CodeQL/);
    expect(describeUses("./.github/actions/setup")).toMatch(/local action/);
  });

  it("chains GitLab stages when jobs have no needs", () => {
    const p = parseGitlab(
      ".gitlab-ci.yml",
      "stages: [a, b]\nj1:\n  stage: a\n  script: [x]\nj2:\n  stage: b\n  script: [y]\n",
    );
    expect(jobEdges(p)).toEqual([["j1", "j2"]]);
    expect(jobGraphMermaid(p)).toContain("j1 --> j2");
  });

  it("treats fixtures and vendored code as foreign", () => {
    expect(isForeign("fixtures/app/package.json")).toBe(true);
    expect(isForeign("vendor/x/composer.json")).toBe(true);
    expect(isForeign("package.json")).toBe(false);
  });
});
