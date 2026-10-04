import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG, FactIndex, scanRepo, type RepoFacts } from "@grasp/core";
import { describe, expect, it } from "vitest";
import { defaultPacks } from "./index.js";

const fixture = (name: string) =>
  fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url));

async function scan(name: string): Promise<RepoFacts> {
  // Fixtures live inside this repo, so git would report the parent repo's files and history.
  const { facts } = await scanRepo(fixture(name), {
    packs: defaultPacks(),
    config: DEFAULT_CONFIG,
    toolVersion: "test",
    useGit: false,
  });
  return facts;
}

/** Drops machine-specific fields so golden files are identical on every OS. */
function golden(facts: RepoFacts): string {
  const { repo, ...rest } = facts;
  delete (rest as Partial<RepoFacts>).generatedAt;
  const files = rest.files.map(({ mtimeMs: _mtime, ...f }) => f);
  return (
    JSON.stringify({ ...rest, files, repo: { name: repo.name, isGit: repo.isGit } }, null, 2) + "\n"
  );
}

describe("js-app fixture", async () => {
  const facts = await scan("js-app");
  const idx = new FactIndex(facts);

  it("matches the golden fact base", async () => {
    await expect(golden(facts)).toMatchFileSnapshot("./__golden__/js-app.facts.json");
  });

  it("resolves tsconfig aliases, barrels, and default re-exports", () => {
    const clampCallers = idx.callers("src/utils/math.ts#clamp").map((c) => c.from);
    expect(clampCallers).toContain("src/server.ts#createServer");
    expect(idx.importsOf("src/index.ts").map((i) => i.resolved)).toContain("src/config.ts");
  });

  it("resolves methods on locally constructed objects", () => {
    expect(idx.callers("src/auth/token.ts#TokenService.verify").map((c) => c.from)).toEqual([
      "src/server.ts#createServer",
    ]);
  });

  it("captures signatures, params, JSDoc, and overloads once", () => {
    const issue = idx.symbols.get("src/auth/token.ts#TokenService.issue");
    expect(issue?.params).toEqual([
      { name: "subject", type: "string" },
      { name: "ttlSeconds", defaultValue: "3600" },
    ]);
    expect(issue?.returns).toBe("string");
    expect(issue?.docstring).toContain("Signs a token");
    expect(facts.symbols.filter((s) => s.id === "src/utils/math.ts#add")).toHaveLength(1);
    expect(idx.symbols.get("src/utils/math.ts#sumAll")?.signature).toContain("Promise<number>");
  });

  it("handles CommonJS exports and script guards", () => {
    expect(idx.symbols.get("src/legacy.js#total")?.exported).toBe(true);
    expect(idx.files.get("src/legacy.js")?.isScript).toBe(true);
  });

  it("keeps facts from files with syntax errors", () => {
    expect(idx.files.get("src/broken.ts")?.hasSyntaxErrors).toBe(true);
    expect(idx.symbols.has("src/broken.ts#ok")).toBe(true);
  });
});

describe("py-app fixture", async () => {
  const facts = await scan("py-app");
  const idx = new FactIndex(facts);

  it("matches the golden fact base", async () => {
    await expect(golden(facts)).toMatchFileSnapshot("./__golden__/py-app.facts.json");
  });

  it("resolves relative imports and __init__ re-exports", () => {
    const callers = idx.callers("src/shop/services/billing.py#BillingService").map((c) => c.from);
    expect(callers).toContain("src/shop/main.py#charge_order");
  });

  it("links tests to methods called on constructed objects", () => {
    expect(idx.testsFor("src/shop/services/billing.py#BillingService.invoice_for")).toEqual([
      "tests/test_billing.py",
    ]);
  });

  it("reads docstrings, drops self, and honors __all__", () => {
    const init = idx.symbols.get("src/shop/services/billing.py#BillingService.__init__");
    expect(init?.params.map((p) => p.name)).toEqual(["provider", "retries"]);
    expect(
      idx.symbols.get("src/shop/services/billing.py#BillingService.invoice_for")?.docstring,
    ).toMatch(/^Builds an invoice/);
    expect(idx.files.get("src/shop/main.py")?.isScript).toBe(true);
    expect(idx.importsOf("src/shop/models.py").map((i) => i.external)).toContain("sqlalchemy");
  });
});

describe("malformed fixture", () => {
  it("scans without throwing and records what it could", async () => {
    const facts = await scan("malformed");
    const idx = new FactIndex(facts);
    expect(idx.files.get("bad.py")?.hasSyntaxErrors).toBe(true);
    expect(idx.symbols.has("bad.py#ok")).toBe(true);
    expect(idx.files.get("blob.dat")?.language).toBe("Binary");
  });
});
