import type { CallFact, FileFact, ImportFact, SymbolFact } from "./types.js";

/** How deep to follow re-export chains (barrel files importing barrel files). */
const MAX_REEXPORT_DEPTH = 8;

interface Binding {
  file: string;
  imported: string;
}

/**
 * Cross-file lookup tables built once per scan. Resolution is heuristic and
 * name-based: it resolves what static analysis can see and leaves dynamic
 * dispatch unresolved rather than guessing.
 */
export class Linker {
  private readonly topLevel = new Map<string, Map<string, SymbolFact>>();
  private readonly members = new Map<string, Map<string, SymbolFact>>();
  private readonly defaults = new Map<string, SymbolFact>();
  private readonly bindings = new Map<string, Map<string, Binding>>();
  private readonly starExports = new Map<string, string[]>();
  private readonly byId = new Map<string, SymbolFact>();

  constructor(symbols: SymbolFact[], imports: ImportFact[]) {
    for (const s of symbols) {
      this.byId.set(s.id, s);
      if (s.parentId) {
        let m = this.members.get(s.parentId);
        if (!m) this.members.set(s.parentId, (m = new Map()));
        m.set(s.name, s);
      } else {
        let m = this.topLevel.get(s.path);
        if (!m) this.topLevel.set(s.path, (m = new Map()));
        // First declaration wins (overloads and redeclarations share a name).
        if (!m.has(s.name)) m.set(s.name, s);
        if (s.defaultExport) this.defaults.set(s.path, s);
      }
    }
    for (const imp of imports) {
      if (!imp.resolved) continue;
      for (const n of imp.names) {
        if (n.imported === "*" && n.local === "*") {
          const list = this.starExports.get(imp.from) ?? [];
          list.push(imp.resolved);
          this.starExports.set(imp.from, list);
          continue;
        }
        let m = this.bindings.get(imp.from);
        if (!m) this.bindings.set(imp.from, (m = new Map()));
        m.set(n.local, { file: imp.resolved, imported: n.imported });
      }
    }
  }

  symbol(id: string): SymbolFact | undefined {
    return this.byId.get(id);
  }

  /** Finds what `name` refers to when imported from `file`, following re-exports. */
  findExport(file: string, name: string, depth = 0): SymbolFact | undefined {
    if (depth > MAX_REEXPORT_DEPTH) return undefined;
    if (name === "default") {
      const d = this.defaults.get(file);
      if (d) return d;
    }
    const own = this.topLevel.get(file)?.get(name);
    if (own) return own;
    const binding = this.bindings.get(file)?.get(name);
    if (binding && binding.imported !== "*") {
      return this.findExport(binding.file, binding.imported, depth + 1);
    }
    for (const target of this.starExports.get(file) ?? []) {
      const found = this.findExport(target, name, depth + 1);
      if (found) return found;
    }
    return undefined;
  }

  /** File a namespace-style local name points at (`import * as x`, Python `import x`). */
  namespaceFile(file: string, local: string): string | undefined {
    const b = this.bindings.get(file)?.get(local);
    return b?.imported === "*" ? b.file : undefined;
  }

  private memberOf(classSymbol: SymbolFact | undefined, name: string): SymbolFact | undefined {
    if (!classSymbol || classSymbol.kind !== "class") return undefined;
    return this.members.get(classSymbol.id)?.get(name);
  }

  private enclosingClass(fromId: string): SymbolFact | undefined {
    let s = this.byId.get(fromId);
    while (s) {
      if (s.kind === "class") return s;
      s = s.parentId ? this.byId.get(s.parentId) : undefined;
    }
    return undefined;
  }

  /** Resolves one call. Returns the target symbol id or undefined. */
  resolveCall(call: CallFact): string | undefined {
    const parts = call.callee.split(".");
    if (parts.length === 1) {
      const name = parts[0] ?? "";
      const local = this.topLevel.get(call.path)?.get(name);
      if (local) return local.id;
      const b = this.bindings.get(call.path)?.get(name);
      if (b && b.imported !== "*") return this.findExport(b.file, b.imported)?.id;
      return undefined;
    }
    if (parts.length !== 2) return undefined;
    const [head = "", member = ""] = parts;
    if (head === "this" || head === "self" || head === "cls") {
      return this.memberOf(this.enclosingClass(call.from), member)?.id;
    }
    const nsFile = this.namespaceFile(call.path, head);
    if (nsFile) return this.findExport(nsFile, member)?.id;
    // `ClassName.staticMethod()` where the class is local or imported.
    const cls = this.resolveCall({ ...call, callee: head });
    return cls ? this.memberOf(this.byId.get(cls), member)?.id : undefined;
  }
}

export function resolveCalls(calls: CallFact[], linker: Linker): void {
  for (const c of calls) c.resolved = linker.resolveCall(c);
}

/**
 * Maps symbol ids and file paths to the test files that exercise them.
 * Evidence: a test calls the symbol, imports it by name, or follows the
 * `test_<module>.py` / `<module>.test.ts` naming convention (file level only).
 */
export function linkTests(
  files: FileFact[],
  imports: ImportFact[],
  calls: CallFact[],
  linker: Linker,
): Record<string, string[]> {
  const testFiles = new Set(files.filter((f) => f.role === "test").map((f) => f.path));
  const links = new Map<string, Set<string>>();
  const add = (key: string, test: string) => {
    let s = links.get(key);
    if (!s) links.set(key, (s = new Set()));
    s.add(test);
  };

  for (const c of calls) {
    if (testFiles.has(c.path) && c.resolved && !testFiles.has(pathOf(c.resolved))) {
      add(c.resolved, c.path);
      add(pathOf(c.resolved), c.path);
    }
  }
  for (const imp of imports) {
    if (!testFiles.has(imp.from) || !imp.resolved || testFiles.has(imp.resolved)) continue;
    add(imp.resolved, imp.from);
    for (const n of imp.names) {
      if (n.imported === "*") continue;
      const s = linker.findExport(imp.resolved, n.imported);
      if (s) {
        add(s.id, imp.from);
        add(s.path, imp.from);
      }
    }
  }

  const sourceByStem = new Map<string, string[]>();
  for (const f of files) {
    if (f.role !== "source") continue;
    const stem = stemOf(f.path);
    sourceByStem.set(stem, [...(sourceByStem.get(stem) ?? []), f.path]);
  }
  for (const t of testFiles) {
    const stem = stemOf(t)
      .replace(/^test_/, "")
      .replace(/_test$/, "")
      .replace(/\.(test|spec)$/, "");
    const matches = sourceByStem.get(stem);
    // Only trust the convention when it is unambiguous.
    if (matches?.length === 1 && matches[0]) add(matches[0], t);
  }

  const out: Record<string, string[]> = {};
  for (const key of [...links.keys()].sort()) out[key] = [...(links.get(key) ?? [])].sort();
  return out;
}

export function pathOf(symbolIdOrPath: string): string {
  const i = symbolIdOrPath.indexOf("#");
  return i === -1 ? symbolIdOrPath : symbolIdOrPath.slice(0, i);
}

function stemOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base.replace(/\.[^.]+$/, "");
}
