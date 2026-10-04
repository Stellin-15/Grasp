import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "./config.js";
import { symbolId, type LanguagePack } from "./lang.js";
import { FactIndex } from "./query.js";
import { scanRepo } from "./scan.js";

/**
 * A line-based toy language (`.toy`) so core can be tested without tree-sitter:
 *   fn NAME        declares a function until the next `fn`
 *   use NAME from PATH
 *   call NAME
 *   boom           makes extraction throw
 */
let extractCount = 0;
const toyPack: LanguagePack = {
  id: "toy",
  version: 1,
  languages: ["Other"],
  init: async () => {},
  extract(source, path) {
    extractCount++;
    if (source.includes("boom")) throw new Error("toy parser exploded");
    const result = { symbols: [], imports: [], calls: [], hasSyntaxErrors: false } as ReturnType<
      LanguagePack["extract"]
    >;
    let current: string = path;
    source.split("\n").forEach((line, i) => {
      const [kw, name = "", , from = ""] = line.trim().split(/\s+/);
      if (kw === "fn") {
        current = symbolId(path, name);
        result.symbols.push({
          id: current,
          name,
          qualifiedName: name,
          kind: "function",
          path,
          range: { startLine: i + 1, endLine: i + 1 },
          signature: `fn ${name}`,
          params: [],
          exported: true,
        });
      } else if (kw === "use") {
        result.imports.push({
          from: path,
          specifier: from,
          line: i + 1,
          kind: "import",
          names: [{ imported: name, local: name }],
        });
      } else if (kw === "call") {
        result.calls.push({ from: current, path, line: i + 1, callee: name, name });
      }
    });
    return result;
  },
  createResolver: async (ctx) => ({
    resolve: (spec) => (ctx.files.has(spec) ? { resolved: spec } : { external: spec }),
  }),
};

async function repo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "grasp-scan-"));
  for (const [p, c] of Object.entries(files)) {
    await mkdir(join(root, p, ".."), { recursive: true });
    await writeFile(join(root, p), c);
  }
  return root;
}

const opts = { packs: [toyPack], config: DEFAULT_CONFIG, toolVersion: "test", useGit: false };

describe("scanRepo", () => {
  it("extracts, resolves, links tests, and fails soft", async () => {
    const root = await repo({
      "src/lib.toy": "fn helper\nfn other\ncall helper\n",
      "src/main.toy": "use helper from src/lib.toy\nfn main\ncall helper\ncall missing\n",
      "tests/lib.test.toy": "use helper from src/lib.toy\nfn t\ncall helper\n",
      "src/bad.toy": "boom\n",
      "img.bin": "\0\0\0binary",
      ".env": "TOKEN=secret",
    });
    const { facts, walk } = await scanRepo(root, opts);
    const idx = new FactIndex(facts);

    expect(walk.secretsSkipped).toBe(1);
    expect(facts.files.map((f) => f.path)).not.toContain(".env");
    expect(idx.files.get("img.bin")?.language).toBe("Binary");

    expect(idx.callers("src/lib.toy#helper").map((c) => c.from)).toEqual([
      "src/lib.toy#other",
      "src/main.toy#main",
      "tests/lib.test.toy#t",
    ]);
    expect(
      idx.callees("src/main.toy#main").find((c) => c.name === "missing")?.resolved,
    ).toBeUndefined();
    expect(facts.tests["src/lib.toy#helper"]).toEqual(["tests/lib.test.toy"]);

    expect(idx.files.get("src/bad.toy")?.parsed).toBe(false);
    expect(facts.warnings.some((w) => w.includes("src/bad.toy") && w.includes("exploded"))).toBe(
      true,
    );
  });

  it("reuses extraction for unchanged files", async () => {
    const root = await repo({ "a.toy": "fn a\n", "b.toy": "fn b\ncall a\n" });
    const first = await scanRepo(root, opts);
    await writeFile(join(root, "b.toy"), "fn b\ncall a\ncall a\n");
    extractCount = 0;
    const second = await scanRepo(root, { ...opts, previous: first.facts });
    expect(second.reused).toBe(1);
    expect(extractCount).toBe(1);
    expect(second.facts.symbols.map((s) => s.id)).toEqual(["a.toy#a", "b.toy#b"]);
  });
});
