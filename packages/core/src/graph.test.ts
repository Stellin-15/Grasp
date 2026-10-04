import { describe, expect, it } from "vitest";
import { buildImportGraph, detectEntryPoints, pageRank, readingOrder } from "./graph.js";
import type { FileFact, ImportFact } from "./types.js";

const file = (path: string, extra: Partial<FileFact> = {}): FileFact => ({
  path,
  language: "TypeScript",
  role: "source",
  size: 1,
  lines: 1,
  hash: "h",
  parsed: true,
  ...extra,
});

const imp = (from: string, resolved: string): ImportFact => ({
  from,
  specifier: resolved,
  line: 1,
  names: [],
  kind: "import",
  resolved,
});

// index -> app -> {db, log}; worker -> {db, log}; util is standalone; test file is excluded.
const files = [
  file("src/index.ts"),
  file("src/app.ts"),
  file("src/db.ts"),
  file("src/log.ts"),
  file("src/worker.ts"),
  file("src/util.ts"),
  file("src/app.test.ts", { role: "test" }),
];
const imports = [
  imp("src/index.ts", "src/app.ts"),
  imp("src/app.ts", "src/db.ts"),
  imp("src/app.ts", "src/log.ts"),
  imp("src/worker.ts", "src/db.ts"),
  imp("src/worker.ts", "src/log.ts"),
  imp("src/app.test.ts", "src/app.ts"),
];

describe("import graph", () => {
  const graph = buildImportGraph(files, imports);

  it("excludes tests", () => {
    expect(graph.nodes).not.toContain("src/app.test.ts");
    expect(graph.in.get("src/app.ts")?.size).toBe(1);
  });

  it("ranks shared dependencies highest and sums to 1", () => {
    const ranks = pageRank(graph);
    const total = [...ranks.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 6);
    expect(ranks.get("src/db.ts")).toBeGreaterThan(ranks.get("src/app.ts") ?? 0);
    expect(ranks.get("src/app.ts")).toBeGreaterThan(ranks.get("src/index.ts") ?? 0);
  });

  it("orders entry points, then core, then leaves", () => {
    const entries = detectEntryPoints(files, graph);
    expect(entries.map((e) => e.path)).toEqual(["src/index.ts"]);
    const order = readingOrder(graph, [...entries, { path: "src/worker.ts", reason: "bin" }]);
    expect(order.map((o) => [o.path, o.stage])).toEqual([
      ["src/worker.ts", "entry"],
      ["src/index.ts", "entry"],
      ["src/db.ts", "core"],
      ["src/log.ts", "core"],
      ["src/app.ts", "leaf"],
      ["src/util.ts", "leaf"],
    ]);
  });
});
