import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG, scanRepo, type RepoFacts } from "@grasp/core";
import { defaultPacks } from "@grasp/langs";
import { describe, expect, it } from "vitest";
import { FakeBackend } from "./backends/fake.js";
import { explainRepo, planExplanations, type ExplainOptions, type RepoContext } from "./build.js";
import { checkExplanations } from "./check.js";
import { verifySymbol } from "./verify.js";

const fixture = fileURLToPath(new URL("../../../fixtures/js-app", import.meta.url));

const ctx: RepoContext = {
  name: "js-app",
  languages: [{ language: "TypeScript", share: 1 }],
  entryPoints: [{ path: "src/index.ts", reason: "package entry" }],
  readingOrder: [{ path: "src/index.ts", stage: "entry", reason: "package entry" }],
  frameworks: [
    {
      id: "express",
      name: "Express",
      category: "Web server framework",
      brief: "HTTP",
      usedIn: [{ path: "src/server.ts", line: 1 }],
      configFiles: [],
      packages: ["express ^4.19.2"],
    },
  ],
  pipelines: [
    {
      path: ".github/workflows/ci.yml",
      name: "CI",
      brief: "Runs tests.",
      steps: [
        { line: 22, label: "job lint: pnpm install" },
        { line: 23, label: "job lint: pnpm lint" },
      ],
    },
  ],
};

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "grasp-explain-"));
  await cp(fixture, root, { recursive: true });
  const scan = async () =>
    (
      await scanRepo(root, {
        packs: defaultPacks(),
        config: DEFAULT_CONFIG,
        toolVersion: "test",
        useGit: false,
      })
    ).facts;
  const backend = new FakeBackend();
  const opts = (_facts: RepoFacts): ExplainOptions => ({
    backend,
    audience: "dev",
    depth: "symbol",
    cacheDir: join(root, ".cache"),
    readText: (p) => readFile(join(root, p), "utf8").catch(() => undefined),
    concurrency: 2,
  });
  return { root, scan, backend, opts };
}

describe("explainRepo", () => {
  it("explains bottom-up, verifies citations, caches, and regenerates only what changed", async () => {
    const { root, scan, backend, opts } = await setup();
    const facts = await scan();
    const { plan, result } = await explainRepo(facts, ctx, opts(facts));

    const kinds = (k: string) => plan.units.filter((u) => u.kind === k).length;
    expect(kinds("symbol")).toBeGreaterThan(5);
    expect(kinds("file")).toBeGreaterThan(5);
    expect(kinds("repo")).toBe(1);
    expect(result.failed).toEqual([]);
    expect(result.generated).toBe(plan.units.length);

    // The fake's deliberately out-of-range gotcha is removed from every symbol.
    const verify = result.set.symbols["src/auth/token.ts#TokenService.verify"];
    expect(verify?.doc.gotchas).toEqual([]);
    expect(verify?.meta.dropped[0]).toMatch(/outside/);
    expect(verify?.doc.steps.length).toBe(2);

    // Framework and pipeline explanations keep only citations into files and steps that exist.
    const express = result.set.frameworks["express"];
    expect(express?.doc.patterns).toEqual([
      { text: "Imported at the top.", path: "src/server.ts", start: 1, end: 1 },
    ]);
    expect(express?.meta.dropped[0]).toMatch(/not a file that uses this framework/);
    const ci = result.set.pipelines[".github/workflows/ci.yml"];
    expect(ci?.doc.steps.map((s) => s.line)).toEqual([22, 23]);
    expect(ci?.meta.dropped[0]).toMatch(/line 9999 is not a step/);

    // Callees are explained before callers, so their summaries reach the caller's prompt.
    const createServerPrompt =
      backend.calls.find((c) => c.prompt.includes("NAME: createServer"))?.prompt ?? "";
    expect(createServerPrompt).toContain("Calls `TokenService.verify`");
    expect(createServerPrompt).toContain("TokenService.verify does its job.");
    expect(createServerPrompt).toMatch(/^\s*11 \| export function createServer/m);

    // Second run: nothing is sent to the model.
    const callsBefore = backend.calls.length;
    const again = await explainRepo(facts, ctx, opts(facts));
    expect(again.result.cached).toBe(plan.units.length);
    expect(backend.calls.length).toBe(callsBefore);
    expect((await checkExplanations(facts, ctx, again.result.set, opts(facts))).completeness).toBe(
      1,
    );

    // Change one function: only it and its file, folder, and repo roll-ups regenerate.
    const mathPath = join(root, "src/utils/math.ts");
    const math = await readFile(mathPath, "utf8");
    await writeFile(mathPath, math.replace("return values.reduce", "return values.slice().reduce"));
    const changed = await scan();
    const check = await checkExplanations(changed, ctx, again.result.set, opts(changed));
    expect(check.symbols.stale).toBe(1);
    expect(check.staleUnits).toContain("src/utils/math.ts#sumAll");
    const { plan: replan } = await planExplanations(changed, ctx, opts(changed));
    const regenerate = replan.units.filter((u) => !u.cached).map((u) => u.key);
    expect(regenerate.sort()).toEqual([
      ".",
      "src",
      "src/utils",
      "src/utils/math.ts",
      "src/utils/math.ts#sumAll",
    ]);
  });

  it("redacts secrets before anything reaches the model", async () => {
    const { root, scan, backend, opts } = await setup();
    const p = join(root, "src/config.ts");
    await writeFile(
      p,
      (await readFile(p, "utf8"))
        .replace(
          "const parsed = Schema.parse(env);",
          'const fallback = "sk-ant-api03-supersecretvalue1234567890";\n  const parsed = Schema.parse(env);',
        )
        .replace(
          "const Schema",
          'const SERVICE_TOKEN = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";\nconst Schema',
        ),
    );
    const facts = await scan();
    // Symbol prompts carry the function body; the file prompt carries constant signatures.
    await explainRepo(facts, ctx, {
      ...opts(facts),
      only: { symbols: ["src/config.ts#loadConfig"] },
    });
    await explainRepo(facts, ctx, {
      ...opts(facts),
      depth: "file",
      only: { files: ["src/config.ts"] },
    });
    const sent = backend.calls.map((c) => c.prompt).join("\n");
    expect(sent).toContain("NAME: loadConfig");
    expect(sent).not.toContain("supersecretvalue");
    expect(sent).not.toContain("ghp_abcdef");
    expect(sent.match(/\[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("estimates cost before running and respects --max-units", async () => {
    const { scan, backend, opts } = await setup();
    const facts = await scan();
    const { plan } = await planExplanations(facts, ctx, opts(facts));
    expect(plan.toGenerate).toBe(plan.units.length);
    expect(plan.inputTokens).toBeGreaterThan(0);
    expect(backend.calls).toHaveLength(0);
    const { result } = await explainRepo(facts, ctx, { ...opts(facts), maxUnits: 3 });
    expect(result.generated).toBe(3);
    expect(result.stoppedReason).toMatch(/max-units/);
  });
});

describe("verifySymbol", () => {
  const base = {
    summary: "s",
    purpose: "p",
    params: [],
    returns: "",
    branches: [],
    errors: [],
    sideEffects: [],
    gotchas: [],
  };
  const ctx2 = {
    start: 10,
    end: 20,
    source: "function add(a, b) { return a + b; }",
    known: new Set(["helper"]),
    paramNames: ["a", "b"],
  };

  it("drops fabricated repo references and unknown params, allows builtins, flags the rest", () => {
    const { doc, dropped } = verifySymbol(
      {
        ...base,
        params: [
          { name: "a", meaning: "left" },
          { name: "c", meaning: "made up" },
        ],
        steps: [
          { text: "Adds `a` and `b`.", start: 10, end: 10 },
          { text: "Raises `TypeError` on `str` and uses `base64.b64encode`.", start: 11, end: 11 },
          { text: "Calls `helper.made_up()`.", start: 12, end: 12 },
          { text: "Then calls `invented()`.", start: 12, end: 12 },
        ],
      },
      { ...ctx2, known: new Set(["helper", "base64"]), repoSymbols: new Set(["helper"]) },
    );
    expect(doc.params.map((p) => p.name)).toEqual(["a"]);
    expect(doc.steps.map((s) => s.text)).toEqual([
      "Adds `a` and `b`.",
      "Raises `TypeError` on `str` and uses `base64.b64encode`.",
      "Then calls `invented()`.",
    ]);
    expect(dropped).toEqual([
      expect.stringMatching(/"c" is not a parameter/),
      expect.stringMatching(/`helper\.made_up\(\)`, which does not exist/),
      expect.stringMatching(/`invented\(\)`, not found in the code \(kept, flagged\)/),
    ]);
  });

  it("rejects malformed answers", () => {
    expect(() => verifySymbol({ ...base, steps: "nope" }, ctx2)).toThrow(/steps/);
  });
});
