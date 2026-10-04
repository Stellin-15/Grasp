import type { CallFact, FileFact, ImportFact, RepoFacts, SymbolFact } from "./types.js";

/** Read-side indexes over a fact base, for lookups like "who calls this?". */
export class FactIndex {
  readonly files = new Map<string, FileFact>();
  readonly symbols = new Map<string, SymbolFact>();
  private readonly symbolsByPath = new Map<string, SymbolFact[]>();
  private readonly callersOf = new Map<string, CallFact[]>();
  private readonly callsFrom = new Map<string, CallFact[]>();
  private readonly importsFrom = new Map<string, ImportFact[]>();
  private readonly importersOf = new Map<string, ImportFact[]>();

  constructor(readonly facts: RepoFacts) {
    const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => {
      const list = m.get(k);
      if (list) list.push(v);
      else m.set(k, [v]);
    };
    for (const f of facts.files) this.files.set(f.path, f);
    for (const s of facts.symbols) {
      this.symbols.set(s.id, s);
      push(this.symbolsByPath, s.path, s);
    }
    for (const c of facts.calls) {
      push(this.callsFrom, c.from, c);
      if (c.resolved) push(this.callersOf, c.resolved, c);
    }
    for (const i of facts.imports) {
      push(this.importsFrom, i.from, i);
      if (i.resolved) push(this.importersOf, i.resolved, i);
    }
  }

  symbolsIn(path: string): SymbolFact[] {
    return this.symbolsByPath.get(path) ?? [];
  }

  children(id: string): SymbolFact[] {
    const s = this.symbols.get(id);
    return s ? this.symbolsIn(s.path).filter((c) => c.parentId === id) : [];
  }

  callers(id: string): CallFact[] {
    return this.callersOf.get(id) ?? [];
  }

  callees(id: string): CallFact[] {
    return this.callsFrom.get(id) ?? [];
  }

  importsOf(path: string): ImportFact[] {
    return this.importsFrom.get(path) ?? [];
  }

  importers(path: string): ImportFact[] {
    return this.importersOf.get(path) ?? [];
  }

  testsFor(idOrPath: string): string[] {
    return this.facts.tests[idOrPath] ?? [];
  }

  /**
   * Accepts `path#Name`, a file path, a qualified name (`Class.method`), or a
   * bare name. Exact matches beat case-insensitive ones.
   */
  find(query: string): { files: FileFact[]; symbols: SymbolFact[] } {
    const q = query.replaceAll("\\", "/").replace(/^\.\//, "");
    const exactSymbol = this.symbols.get(q);
    if (exactSymbol) return { files: [], symbols: [exactSymbol] };
    const file = this.files.get(q);
    if (file) return { files: [file], symbols: [] };

    const all = [...this.symbols.values()];
    let symbols = all.filter((s) => s.qualifiedName === q || s.name === q);
    if (symbols.length === 0) {
      const lower = q.toLowerCase();
      symbols = all.filter(
        (s) => s.qualifiedName.toLowerCase() === lower || s.name.toLowerCase() === lower,
      );
    }
    const files =
      symbols.length === 0
        ? [...this.files.values()].filter((f) => f.path.endsWith(`/${q}`) || f.path === q)
        : [];
    return { files, symbols };
  }
}
