import { describe, expect, it } from "vitest";
import { Linker, linkTests } from "./resolve.js";
import type { CallFact, FileFact, ImportFact, SymbolFact } from "./types.js";

const sym = (
  path: string,
  qualifiedName: string,
  kind: SymbolFact["kind"] = "function",
  extra: Partial<SymbolFact> = {},
): SymbolFact => {
  const name = qualifiedName.split(".").pop() ?? qualifiedName;
  const parent = qualifiedName.includes(".")
    ? `${path}#${qualifiedName.slice(0, qualifiedName.lastIndexOf("."))}`
    : undefined;
  return {
    id: `${path}#${qualifiedName}`,
    name,
    qualifiedName,
    kind,
    path,
    range: { startLine: 1, endLine: 2 },
    signature: name,
    params: [],
    exported: true,
    parentId: parent,
    ...extra,
  };
};

const imp = (
  from: string,
  resolved: string,
  names: [string, string][],
  kind: ImportFact["kind"] = "import",
): ImportFact => ({
  from,
  specifier: resolved,
  line: 1,
  kind,
  resolved,
  names: names.map(([imported, local]) => ({ imported, local })),
});

const call = (path: string, from: string, callee: string): CallFact => ({
  from,
  path,
  line: 5,
  callee,
  name: callee.split(".").pop() ?? callee,
});

const symbols = [
  sym("lib/math.ts", "add"),
  sym("lib/math.ts", "Calc", "class"),
  sym("lib/math.ts", "Calc.twice", "method"),
  sym("lib/math.ts", "Calc.create", "method"),
  sym("lib/main.ts", "main", "function", { defaultExport: true }),
  sym("app.ts", "run"),
  sym("pkg/core.py", "helper"),
];
const imports = [
  imp("lib/index.ts", "lib/math.ts", [["*", "*"]], "reexport"),
  imp("lib/index.ts", "lib/main.ts", [["default", "main"]], "reexport"),
  imp("app.ts", "lib/index.ts", [
    ["add", "plus"],
    ["main", "main"],
    ["Calc", "Calc"],
  ]),
  imp("app.ts", "lib/math.ts", [["*", "m"]]),
  imp("pkg/__init__.py", "pkg/core.py", [["helper", "helper"]]),
  imp("use.py", "pkg/__init__.py", [["helper", "helper"]]),
];
const linker = new Linker(symbols, imports);

describe("Linker", () => {
  it("follows aliases through barrel star and named re-exports", () => {
    expect(linker.resolveCall(call("app.ts", "app.ts#run", "plus"))).toBe("lib/math.ts#add");
    expect(linker.resolveCall(call("app.ts", "app.ts#run", "main"))).toBe("lib/main.ts#main");
  });

  it("follows Python __init__ re-exports", () => {
    expect(linker.resolveCall(call("use.py", "use.py", "helper"))).toBe("pkg/core.py#helper");
  });

  it("resolves namespace members, static members, and this/self", () => {
    expect(linker.resolveCall(call("app.ts", "app.ts#run", "m.add"))).toBe("lib/math.ts#add");
    expect(linker.resolveCall(call("app.ts", "app.ts#run", "Calc.create"))).toBe(
      "lib/math.ts#Calc.create",
    );
    expect(linker.resolveCall(call("lib/math.ts", "lib/math.ts#Calc.create", "this.twice"))).toBe(
      "lib/math.ts#Calc.twice",
    );
  });

  it("leaves unknown and dynamic calls unresolved", () => {
    expect(linker.resolveCall(call("app.ts", "app.ts#run", "console.log"))).toBeUndefined();
    expect(linker.resolveCall(call("app.ts", "app.ts#run", "a.b.c"))).toBeUndefined();
  });
});

describe("linkTests", () => {
  it("links by call, by named import, and by naming convention", () => {
    const f = (path: string, role: FileFact["role"]): FileFact => ({
      path,
      role,
      language: "TypeScript",
      size: 1,
      lines: 1,
      hash: "h",
      parsed: true,
    });
    const files = [
      f("lib/math.ts", "source"),
      f("app.ts", "source"),
      f("tests/math.test.ts", "test"),
      f("tests/app.test.ts", "test"),
    ];
    const testImports = [imp("tests/math.test.ts", "lib/math.ts", [["add", "add"]])];
    const testCalls = [
      { ...call("tests/math.test.ts", "tests/math.test.ts", "add"), resolved: "lib/math.ts#add" },
    ];
    const links = linkTests(files, testImports, testCalls, linker);
    expect(links["lib/math.ts#add"]).toEqual(["tests/math.test.ts"]);
    expect(links["lib/math.ts"]).toEqual(["tests/math.test.ts"]);
    expect(links["app.ts"]).toEqual(["tests/app.test.ts"]);
  });
});
