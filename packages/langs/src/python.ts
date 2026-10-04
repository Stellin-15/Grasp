import { posix } from "node:path";
import {
  symbolId,
  type CallFact,
  type ExtractResult,
  type ImportFact,
  type ImportedName,
  type LanguagePack,
  type Param,
  type ResolveContext,
  type Resolver,
  type SymbolFact,
} from "@grasp/core";
import { loadGrammar, parse, type Node } from "./runtime.js";
import {
  calleeText,
  cleanPyDocstring,
  endLineOf,
  headText,
  isLicenseHeader,
  lineOf,
  oneLine,
} from "./util.js";

const MEMBER = ["attribute"];

function nodeKey(node: Node): string {
  return `${node.startIndex}:${node.endIndex}:${node.type}`;
}

function docstringOf(body: Node | null): string | undefined {
  const first = body?.namedChildren[0];
  if (first?.type !== "expression_statement") return undefined;
  const str = first.namedChildren[0];
  if (str?.type !== "string") return undefined;
  return cleanPyDocstring(str.text) || undefined;
}

function parseParams(node: Node | null, isMethod: boolean): Param[] {
  if (!node) return [];
  const out: Param[] = [];
  for (const p of node.namedChildren) {
    const typeNode = p.childForFieldName("type");
    const valueNode = p.childForFieldName("value");
    switch (p.type) {
      case "identifier":
        out.push({ name: p.text });
        break;
      case "typed_parameter": {
        const id = p.namedChildren.find((c) => c.type !== "type");
        const splat = id?.type === "list_splat_pattern" || id?.type === "dictionary_splat_pattern";
        out.push({
          name: oneLine(id?.text ?? p.text, 80),
          type: typeNode ? oneLine(typeNode.text, 120) : undefined,
          ...(splat ? { rest: true } : {}),
        });
        break;
      }
      case "default_parameter":
      case "typed_default_parameter":
        out.push({
          name: p.childForFieldName("name")?.text ?? p.text,
          type: typeNode ? oneLine(typeNode.text, 120) : undefined,
          defaultValue: valueNode ? oneLine(valueNode.text, 80) : undefined,
          optional: true,
        });
        break;
      case "list_splat_pattern":
      case "dictionary_splat_pattern":
        out.push({ name: p.text, rest: true });
        break;
      default:
        break;
    }
  }
  // `self` and `cls` are implicit at call sites, so leave them out of the documented parameters.
  if (isMethod && (out[0]?.name === "self" || out[0]?.name === "cls")) out.shift();
  return out;
}

class PyExtractor {
  readonly symbols: SymbolFact[] = [];
  readonly imports: ImportFact[] = [];
  readonly calls: CallFact[] = [];
  isScript = false;
  description: string | undefined;
  private readonly owners = new Map<string, string>();
  private allNames: Set<string> | undefined;

  constructor(private readonly path: string) {}

  run(root: Node): void {
    const doc = docstringOf(root);
    if (doc && !isLicenseHeader(doc)) this.description = doc;
    for (const child of root.namedChildren) this.statement(child, undefined);
    if (this.allNames) {
      for (const s of this.symbols) if (!s.parentId) s.exported = this.allNames.has(s.name);
    }
    this.collectCalls(root);
  }

  private statement(node: Node, cls: SymbolFact | undefined): void {
    switch (node.type) {
      case "decorated_definition": {
        const def = node.childForFieldName("definition");
        const decorators = node.namedChildren
          .filter((c) => c.type === "decorator")
          .map((d) => oneLine(d.text, 80));
        if (def) this.definition(def, node, cls, decorators);
        return;
      }
      case "function_definition":
      case "class_definition":
        this.definition(node, node, cls, []);
        return;
      case "import_statement":
      case "import_from_statement":
        if (!cls) this.importStatement(node);
        return;
      case "expression_statement":
        if (!cls) this.assignment(node);
        return;
      case "if_statement": {
        const cond = node.childForFieldName("condition")?.text ?? "";
        if (!cls && /__name__\s*==\s*["']__main__["']/.test(cond)) this.isScript = true;
        // Imports guarded by `if TYPE_CHECKING:` or version checks are still real dependencies.
        if (!cls) {
          for (const c of node.childForFieldName("consequence")?.namedChildren ?? []) {
            if (c.type === "import_statement" || c.type === "import_from_statement")
              this.importStatement(c);
          }
        }
        return;
      }
      case "try_statement":
        // `try: import x / except ImportError: import y` is a common optional-dependency pattern.
        if (!cls) {
          for (const block of node.namedChildren) {
            const stmts =
              block.type === "block"
                ? block.namedChildren
                : (block.namedChildren.find((c) => c.type === "block")?.namedChildren ?? []);
            for (const c of stmts) {
              if (c.type === "import_statement" || c.type === "import_from_statement")
                this.importStatement(c);
            }
          }
        }
        return;
      default:
        return;
    }
  }

  private definition(
    def: Node,
    outer: Node,
    cls: SymbolFact | undefined,
    decorators: string[],
  ): void {
    const name = def.childForFieldName("name")?.text;
    if (!name) return;
    const body = def.childForFieldName("body");
    const isClass = def.type === "class_definition";
    const qualifiedName = cls ? `${cls.qualifiedName}.${name}` : name;
    const sym: SymbolFact = {
      id: symbolId(this.path, qualifiedName),
      name,
      qualifiedName,
      kind: isClass ? "class" : cls ? "method" : "function",
      path: this.path,
      range: { startLine: lineOf(outer), endLine: endLineOf(outer) },
      signature: headText(def, body),
      params: isClass ? [] : parseParams(def.childForFieldName("parameters"), !!cls),
      exported: !name.startsWith("_") || (name.startsWith("__") && name.endsWith("__")),
    };
    const ret = def.childForFieldName("return_type");
    if (ret) sym.returns = oneLine(ret.text, 120);
    if (!isClass && def.children.some((c) => c.type === "async")) sym.async = true;
    const doc = docstringOf(body);
    if (doc) sym.docstring = doc;
    if (decorators.length) sym.decorators = decorators;
    if (cls) {
      sym.parentId = cls.id;
      sym.exported = cls.exported && sym.exported;
    }
    // A redefinition (e.g. property setter) keeps the first entry.
    if (this.symbols.some((s) => s.id === sym.id)) {
      const existing = this.symbols.find((s) => s.id === sym.id);
      if (existing) {
        existing.range.endLine = Math.max(existing.range.endLine, sym.range.endLine);
        this.owners.set(nodeKey(def), existing.id);
      }
      return;
    }
    this.symbols.push(sym);
    this.owners.set(nodeKey(def), sym.id);
    if (isClass) for (const c of body?.namedChildren ?? []) this.statement(c, sym);
    // Nested functions are not separate symbols; their calls belong to the outer function.
  }

  private assignment(node: Node): void {
    const a = node.namedChildren[0];
    if (a?.type !== "assignment") return;
    const left = a.childForFieldName("left");
    if (left?.type !== "identifier") return;
    const name = left.text;
    const right = a.childForFieldName("right");
    if (name === "__all__" && right && (right.type === "list" || right.type === "tuple")) {
      this.allNames = new Set(
        right.namedChildren
          .filter((c) => c.type === "string")
          .map((c) => c.text.replace(/^[rbuRBU]*["']|["']$/g, "")),
      );
      return;
    }
    if (name.startsWith("__") && name.endsWith("__")) return;
    const sym: SymbolFact = {
      id: symbolId(this.path, name),
      name,
      qualifiedName: name,
      kind: /^[A-Z][A-Z0-9_]*$/.test(name) ? "constant" : "variable",
      path: this.path,
      range: { startLine: lineOf(node), endLine: endLineOf(node) },
      signature: oneLine(node.text, 160),
      params: [],
      exported: !name.startsWith("_"),
    };
    const type = a.childForFieldName("type");
    if (type) sym.returns = oneLine(type.text, 120);
    if (this.symbols.some((s) => s.id === sym.id)) return;
    this.symbols.push(sym);
    if (right) this.owners.set(nodeKey(right), sym.id);
  }

  private importStatement(node: Node): void {
    const line = lineOf(node);
    if (node.type === "import_statement") {
      for (const n of node.childrenForFieldName("name")) {
        const dotted = n.type === "aliased_import" ? n.childForFieldName("name") : n;
        const alias = n.type === "aliased_import" ? n.childForFieldName("alias")?.text : undefined;
        const spec = dotted?.text ?? "";
        // `import a.b` binds `a`, not `a.b`, so only aliased or single-segment imports bind the module.
        const local = alias ?? (spec.includes(".") ? undefined : spec);
        const names: ImportedName[] = local ? [{ imported: "*", local }] : [];
        this.imports.push({ from: this.path, specifier: spec, line, names, kind: "import" });
      }
      return;
    }
    const module = node.childForFieldName("module_name")?.text ?? "";
    const names: ImportedName[] = [];
    if (node.namedChildren.some((c) => c.type === "wildcard_import")) {
      names.push({ imported: "*", local: "*" });
    }
    for (const n of node.childrenForFieldName("name")) {
      const imported = (n.type === "aliased_import" ? n.childForFieldName("name") : n)?.text ?? "";
      const local =
        n.type === "aliased_import" ? (n.childForFieldName("alias")?.text ?? imported) : imported;
      names.push({ imported, local });
      // `from pkg import mod` may import a submodule rather than a name defined in pkg.
      const sep = module.endsWith(".") ? "" : ".";
      this.imports.push({
        from: this.path,
        specifier: `${module}${sep}${imported}`,
        line,
        names: [{ imported: "*", local }],
        kind: "import",
        speculative: true,
      });
    }
    this.imports.push({ from: this.path, specifier: module, line, names, kind: "import" });
  }

  /**
   * Class name a call constructs, by the PEP 8 convention that classes are
   * CapWords. Assumption: `x = make()` is a factory, `x = Make()` a constructor.
   */
  private constructorOf(node: Node | null | undefined): string | undefined {
    if (node?.type !== "call") return undefined;
    const fn = node.childForFieldName("function");
    if (!fn) return undefined;
    const callee = calleeText(fn, MEMBER, "object", "attribute");
    const last = callee.slice(callee.lastIndexOf(".") + 1);
    return /^[A-Z]/.test(last) && !callee.includes("<expr>") ? callee : undefined;
  }

  private collectCalls(root: Node): void {
    // `${owner}\0${variable}` -> class callee, from `x = Foo(...)`.
    const constructed = new Map<string, string>();
    const stack: [Node, string][] = [[root, this.path]];
    while (stack.length) {
      const [node, parentOwner] = stack.pop() as [Node, string];
      const owner = this.owners.get(nodeKey(node)) ?? parentOwner;
      if (node.type === "assignment") {
        const left = node.childForFieldName("left");
        const cls = this.constructorOf(node.childForFieldName("right"));
        if (left?.type === "identifier" && cls) constructed.set(`${owner}\0${left.text}`, cls);
      }
      if (node.type === "call") {
        const fn = node.childForFieldName("function");
        if (fn) {
          const callee = calleeText(fn, MEMBER, "object", "attribute");
          const name = callee.slice(callee.lastIndexOf(".") + 1);
          if (name && name !== "<expr>") {
            const call: CallFact = {
              from: owner,
              path: this.path,
              line: lineOf(node),
              callee,
              name,
            };
            const head = callee.includes(".")
              ? callee.slice(0, callee.lastIndexOf("."))
              : undefined;
            const receiver =
              (fn.type === "attribute"
                ? this.constructorOf(fn.childForFieldName("object"))
                : undefined) ??
              (head
                ? (constructed.get(`${owner}\0${head}`) ?? constructed.get(`${this.path}\0${head}`))
                : undefined);
            if (receiver) call.receiver = receiver;
            this.calls.push(call);
          }
        }
      }
      const children = node.namedChildren;
      for (let i = children.length - 1; i >= 0; i--) {
        const c = children[i];
        if (c) stack.push([c, owner]);
      }
    }
  }
}

export function extractPython(source: string, path: string): ExtractResult {
  const tree = parse("python", source);
  try {
    const ex = new PyExtractor(path);
    ex.run(tree.rootNode);
    return {
      symbols: ex.symbols,
      imports: ex.imports,
      calls: ex.calls,
      hasSyntaxErrors: tree.rootNode.hasError,
      isScript: ex.isScript || undefined,
      description: ex.description,
    };
  } finally {
    tree.delete();
  }
}

// ---------------------------------------------------------------------------
// Import resolution

/** Python 3 standard library top-level modules (subset that covers real-world imports). */
const STDLIB = new Set(
  (
    "__future__ abc argparse array ast asyncio atexit base64 bisect builtins bz2 calendar cmath " +
    "codecs collections colorsys concurrent configparser contextlib contextvars copy copyreg cProfile " +
    "csv ctypes curses dataclasses datetime dbm decimal difflib dis doctest email encodings enum errno " +
    "faulthandler fcntl filecmp fileinput fnmatch fractions ftplib functools gc getopt getpass gettext " +
    "glob graphlib grp gzip hashlib heapq hmac html http imaplib importlib inspect io ipaddress itertools " +
    "json keyword linecache locale logging lzma mailbox marshal math mimetypes mmap multiprocessing netrc " +
    "numbers operator optparse os pathlib pdb pickle pkgutil platform plistlib poplib posix pprint profile " +
    "pstats pty pwd py_compile queue quopri random re readline reprlib resource rlcompleter runpy sched " +
    "secrets select selectors shelve shlex shutil signal site smtplib socket socketserver sqlite3 ssl stat " +
    "statistics string stringprep struct subprocess symtable sys sysconfig syslog tabnanny tarfile tempfile " +
    "termios textwrap threading time timeit tkinter token tokenize tomllib trace traceback tracemalloc tty " +
    "turtle types typing unicodedata unittest urllib uuid venv warnings wave weakref webbrowser winreg " +
    "wsgiref xml xmlrpc zipapp zipfile zipimport zlib zoneinfo _thread"
  ).split(" "),
);

export async function createPyResolver(ctx: ResolveContext): Promise<Resolver> {
  // Source roots: the repo root, conventional layouts, and every folder holding a Python project file.
  const roots = new Set<string>(["", "src", "lib", "python"]);
  for (const f of ctx.files) {
    const base = posix.basename(f);
    if (base === "pyproject.toml" || base === "setup.py" || base === "setup.cfg") {
      const dir = posix.dirname(f) === "." ? "" : posix.dirname(f);
      roots.add(dir);
      roots.add(dir ? `${dir}/src` : "src");
    }
  }
  const join = (root: string, rel: string) => (root ? `${root}/${rel}` : rel);
  const tryModule = (relPath: string): string | undefined => {
    for (const cand of [`${relPath}.py`, `${relPath}/__init__.py`, `${relPath}.pyi`]) {
      if (ctx.files.has(cand)) return cand;
    }
    return undefined;
  };
  const topLevelInternal = new Set<string>();
  for (const f of ctx.files) {
    if (!f.endsWith(".py")) continue;
    for (const r of roots) {
      const prefix = r ? `${r}/` : "";
      if (!f.startsWith(prefix)) continue;
      const first = f.slice(prefix.length).split("/")[0];
      if (first) topLevelInternal.add(first.replace(/\.py$/, ""));
    }
  }

  return {
    resolve(spec, from) {
      const rel = /^(\.+)(.*)$/.exec(spec);
      if (rel) {
        const dots = rel[1]?.length ?? 1;
        let dir = posix.dirname(from);
        for (let i = 1; i < dots; i++) dir = posix.dirname(dir);
        if (dir === ".") dir = "";
        const rest = (rel[2] ?? "").replaceAll(".", "/");
        const target = rest ? join(dir, rest) : dir;
        return { resolved: target ? tryModule(target) : undefined };
      }
      const relPath = spec.replaceAll(".", "/");
      for (const r of roots) {
        const hit = tryModule(join(r, relPath));
        if (hit) return { resolved: hit };
      }
      const top = spec.split(".")[0] ?? spec;
      if (STDLIB.has(top)) return { external: `python:${top}` };
      // An unresolved submodule of an in-repo package is not an external dependency.
      if (topLevelInternal.has(top)) return {};
      return { external: top };
    },
  };
}

export const pythonPack: LanguagePack = {
  id: "python",
  version: 1,
  languages: ["Python"],
  init: () => loadGrammar("python"),
  extract: (source, path) => extractPython(source, path),
  createResolver: createPyResolver,
};
