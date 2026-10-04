import { builtinModules } from "node:module";
import { posix } from "node:path";
import {
  parseJsonc,
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
  type SymbolKind,
} from "@grasp/core";
import { loadGrammar, parse, type GrammarName, type Node } from "./runtime.js";
import {
  calleeText,
  cleanJsDoc,
  endLineOf,
  headText,
  isLicenseHeader,
  lineOf,
  oneLine,
} from "./util.js";

const FUNCTION_VALUES = new Set([
  "arrow_function",
  "function_expression",
  "function",
  "generator_function",
]);
const CLASS_VALUES = new Set(["class", "class_expression"]);
const MEMBER = ["member_expression"];

function grammarFor(language: string): GrammarName {
  if (language === "TSX") return "tsx";
  if (language === "TypeScript") return "typescript";
  return "javascript";
}

function stringValue(node: Node | null | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === "string") return node.text.slice(1, -1);
  if (node.type === "template_string" && !node.text.includes("${")) return node.text.slice(1, -1);
  return undefined;
}

function typeText(node: Node | null): string | undefined {
  return node ? oneLine(node.text.replace(/^:\s*/, ""), 160) : undefined;
}

function nodeKey(node: Node): string {
  return `${node.startIndex}:${node.endIndex}:${node.type}`;
}

function parseParams(node: Node | null): Param[] {
  if (!node) return [];
  // Arrow functions with a single bare parameter: `x => x + 1`.
  if (node.type === "identifier") return [{ name: node.text }];
  const out: Param[] = [];
  for (const p of node.namedChildren) {
    switch (p.type) {
      case "identifier":
        out.push({ name: p.text });
        break;
      case "assignment_pattern":
        out.push({
          name: oneLine(p.childForFieldName("left")?.text ?? p.text, 80),
          defaultValue: oneLine(p.childForFieldName("right")?.text ?? "", 80),
        });
        break;
      case "rest_pattern":
        out.push({ name: p.text.replace(/^\.\.\./, ""), rest: true });
        break;
      case "object_pattern":
      case "array_pattern":
        out.push({ name: oneLine(p.text, 80) });
        break;
      case "required_parameter":
      case "optional_parameter": {
        const pattern = p.childForFieldName("pattern");
        const value = p.childForFieldName("value");
        const isRest = pattern?.type === "rest_pattern";
        const param: Param = {
          name: oneLine((pattern?.text ?? p.text).replace(/^\.\.\./, ""), 80),
          type: typeText(p.childForFieldName("type")),
        };
        if (value) param.defaultValue = oneLine(value.text, 80);
        if (p.type === "optional_parameter") param.optional = true;
        if (isRest) param.rest = true;
        if (param.name !== "this") out.push(param);
        break;
      }
      default:
        break;
    }
  }
  return out;
}

function isAsync(node: Node): boolean {
  return node.children.some((c) => c.type === "async");
}

class JsExtractor {
  readonly symbols: SymbolFact[] = [];
  readonly imports: ImportFact[] = [];
  readonly calls: CallFact[] = [];
  isScript = false;
  description: string | undefined;
  private readonly exportedNames = new Set<string>();
  private defaultName: string | undefined;
  /** Nodes whose calls belong to a symbol (function bodies, initializers). */
  private readonly owners = new Map<string, string>();

  constructor(private readonly path: string) {}

  run(root: Node): void {
    this.description = this.fileDescription(root);
    for (const child of root.namedChildren) this.statement(child, child, false, false);
    for (const s of this.symbols) {
      if (s.parentId) continue;
      if (this.exportedNames.has(s.name)) s.exported = true;
      if (this.defaultName === s.name) {
        s.exported = true;
        s.defaultExport = true;
      }
    }
    this.collectCalls(root);
  }

  private fileDescription(root: Node): string | undefined {
    const first = root.namedChildren.find((c) => c.type !== "hash_bang_line");
    if (first?.type !== "comment" || isLicenseHeader(first.text)) return undefined;
    const next = first.nextNamedSibling;
    const explicit = /@(file|fileoverview|module)\b/.test(first.text);
    // A comment glued to the next declaration documents that declaration, not the file.
    const separated = !next || next.startPosition.row > first.endPosition.row + 1;
    if (!explicit && !separated) return undefined;
    const text = first.text.startsWith("/*")
      ? cleanJsDoc(first.text)
      : first.text.replace(/^\/\/\s?/, "");
    return text.replace(/@(file|fileoverview|module)\s*/g, "").trim() || undefined;
  }

  private docFor(outer: Node): string | undefined {
    let prev = outer.previousNamedSibling;
    while (prev?.type === "decorator") prev = prev.previousNamedSibling;
    if (prev?.type !== "comment" || !prev.text.startsWith("/**")) return undefined;
    if (prev.endPosition.row < outer.startPosition.row - 1) return undefined;
    return cleanJsDoc(prev.text) || undefined;
  }

  private decoratorsOf(decl: Node, outer: Node): string[] | undefined {
    const found = decl.namedChildren
      .filter((c) => c.type === "decorator")
      .map((d) => oneLine(d.text, 80));
    let prev = outer.previousNamedSibling;
    while (prev?.type === "decorator") {
      found.unshift(oneLine(prev.text, 80));
      prev = prev.previousNamedSibling;
    }
    return found.length ? found : undefined;
  }

  private add(
    kind: SymbolKind,
    name: string,
    decl: Node,
    outer: Node,
    opts: {
      parent?: SymbolFact | undefined;
      exported: boolean;
      isDefault?: boolean | undefined;
      fn?: Node | undefined;
      signature?: string | undefined;
      owner?: Node | undefined;
    },
  ): SymbolFact {
    const qualifiedName = opts.parent ? `${opts.parent.qualifiedName}.${name}` : name;
    const fn = opts.fn;
    const body = (fn ?? decl).childForFieldName("body");
    const sym: SymbolFact = {
      id: symbolId(this.path, qualifiedName),
      name,
      qualifiedName,
      kind,
      path: this.path,
      range: { startLine: lineOf(outer), endLine: endLineOf(outer) },
      signature: opts.signature ?? headText(outer, body),
      params: fn
        ? parseParams(fn.childForFieldName("parameters") ?? fn.childForFieldName("parameter"))
        : [],
      exported: opts.exported,
    };
    if (fn) {
      const ret = typeText(fn.childForFieldName("return_type"));
      if (ret) sym.returns = ret;
      if (isAsync(fn)) sym.async = true;
    }
    if (opts.isDefault) sym.defaultExport = true;
    const doc = this.docFor(outer);
    if (doc) sym.docstring = doc;
    const decorators = this.decoratorsOf(decl, outer);
    if (decorators) sym.decorators = decorators;
    if (opts.parent) sym.parentId = opts.parent.id;

    // TS overloads repeat a name; keep the first declaration, extend its range.
    const existing = this.symbols.find((s) => s.id === sym.id);
    if (existing) {
      existing.range.endLine = Math.max(existing.range.endLine, sym.range.endLine);
      if (opts.owner) this.owners.set(nodeKey(opts.owner), existing.id);
      return existing;
    }
    this.symbols.push(sym);
    if (opts.owner) this.owners.set(nodeKey(opts.owner), sym.id);
    return sym;
  }

  private statement(node: Node, outer: Node, exported: boolean, isDefault: boolean): void {
    switch (node.type) {
      case "export_statement":
        this.exportStatement(node);
        return;
      case "function_declaration":
      case "generator_function_declaration": {
        const name = node.childForFieldName("name")?.text ?? "default";
        this.add("function", name, node, outer, { exported, isDefault, fn: node, owner: node });
        return;
      }
      case "function_signature": {
        // Overload signature without a body; the implementation follows.
        const name = node.childForFieldName("name")?.text;
        if (name) this.add("function", name, node, outer, { exported, fn: node });
        return;
      }
      case "class_declaration":
      case "abstract_class_declaration":
      case "class": {
        const name = node.childForFieldName("name")?.text ?? "default";
        const cls = this.add("class", name, node, outer, { exported, isDefault, owner: node });
        this.classBody(node.childForFieldName("body"), cls);
        return;
      }
      case "interface_declaration":
        this.simple("interface", node, outer, exported);
        return;
      case "type_alias_declaration":
        this.simple("type", node, outer, exported, oneLine(outer.text, 200));
        return;
      case "enum_declaration":
        this.simple("enum", node, outer, exported);
        return;
      case "lexical_declaration":
      case "variable_declaration":
        this.variables(node, outer, exported);
        return;
      case "ambient_declaration":
        for (const c of node.namedChildren) this.statement(c, outer, exported, false);
        return;
      case "import_statement":
        this.importStatement(node);
        return;
      case "expression_statement":
        this.commonJsExport(node);
        return;
      case "if_statement":
        if (
          /require\.main\s*===?\s*module|import\.meta\.main/.test(
            node.childForFieldName("condition")?.text ?? "",
          )
        ) {
          this.isScript = true;
        }
        return;
      default:
        return;
    }
  }

  private simple(
    kind: SymbolKind,
    node: Node,
    outer: Node,
    exported: boolean,
    signature?: string,
  ): void {
    const name = node.childForFieldName("name")?.text;
    if (name) this.add(kind, name, node, outer, { exported, signature });
  }

  private variables(node: Node, outer: Node, exported: boolean): void {
    const isConst = node.child(0)?.text === "const";
    for (const d of node.namedChildren) {
      if (d.type !== "variable_declarator") continue;
      const nameNode = d.childForFieldName("name");
      if (nameNode?.type !== "identifier") continue;
      const value = d.childForFieldName("value");
      const name = nameNode.text;
      if (value && FUNCTION_VALUES.has(value.type)) {
        this.add("function", name, d, outer, { exported, fn: value, owner: value });
      } else if (value && CLASS_VALUES.has(value.type)) {
        const cls = this.add("class", name, d, outer, { exported, owner: value });
        this.classBody(value.childForFieldName("body"), cls);
      } else {
        this.add(isConst ? "constant" : "variable", name, d, outer, {
          exported,
          signature: oneLine(outer.text, 160),
          owner: value ?? undefined,
        });
      }
    }
  }

  private classBody(body: Node | null, cls: SymbolFact): void {
    if (!body) return;
    // `private`/`protected` members and `#name` fields are not part of the public API.
    const isPublic = (m: Node, name: string) =>
      cls.exported &&
      !name.startsWith("#") &&
      !m.namedChildren.some((c) => c.type === "accessibility_modifier" && c.text !== "public");
    for (const m of body.namedChildren) {
      if (
        m.type === "method_definition" ||
        m.type === "abstract_method_signature" ||
        m.type === "method_signature"
      ) {
        const name = m.childForFieldName("name")?.text;
        if (name)
          this.add("method", name, m, m, {
            parent: cls,
            exported: isPublic(m, name),
            fn: m,
            owner: m,
          });
      } else if (m.type === "public_field_definition" || m.type === "field_definition") {
        const nameNode = m.childForFieldName("name") ?? m.childForFieldName("property");
        const value = m.childForFieldName("value");
        if (nameNode && value && FUNCTION_VALUES.has(value.type)) {
          this.add("method", nameNode.text, m, m, {
            parent: cls,
            exported: isPublic(m, nameNode.text),
            fn: value,
            owner: value,
          });
        }
      }
    }
  }

  private exportStatement(node: Node): void {
    const isDefault = node.children.some((c) => c.type === "default");
    const source = stringValue(node.childForFieldName("source"));
    const clause = node.namedChildren.find((c) => c.type === "export_clause");
    if (source !== undefined) {
      const names: ImportedName[] = [];
      const ns = node.namedChildren.find((c) => c.type === "namespace_export");
      if (clause) {
        for (const s of clause.namedChildren) {
          if (s.type !== "export_specifier") continue;
          const imported = s.childForFieldName("name")?.text ?? "";
          const local = s.childForFieldName("alias")?.text ?? imported;
          names.push({ imported, local });
          this.exportedNames.add(local);
        }
      } else if (ns) {
        const local = ns.namedChildren.at(-1)?.text ?? "*";
        names.push({ imported: "*", local });
      } else {
        names.push({ imported: "*", local: "*" });
      }
      this.imports.push({
        from: this.path,
        specifier: source,
        line: lineOf(node),
        names,
        kind: "reexport",
      });
      return;
    }
    const decl = node.childForFieldName("declaration");
    if (decl) {
      this.statement(decl, node, true, isDefault);
      return;
    }
    if (clause) {
      for (const s of clause.namedChildren) {
        if (s.type !== "export_specifier") continue;
        const name = s.childForFieldName("name")?.text;
        const alias = s.childForFieldName("alias")?.text;
        if (!name) continue;
        this.exportedNames.add(name);
        if (alias === "default") this.defaultName = name;
      }
      return;
    }
    if (isDefault) {
      const value = node.childForFieldName("value") ?? node.namedChildren.at(-1);
      if (!value) return;
      if (value.type === "identifier") this.defaultName = value.text;
      else if (FUNCTION_VALUES.has(value.type)) {
        this.add("function", "default", value, node, {
          exported: true,
          isDefault: true,
          fn: value,
          owner: value,
        });
      } else if (CLASS_VALUES.has(value.type)) {
        const cls = this.add("class", "default", value, node, {
          exported: true,
          isDefault: true,
          owner: value,
        });
        this.classBody(value.childForFieldName("body"), cls);
      }
    }
  }

  private importStatement(node: Node): void {
    const specifier = stringValue(node.childForFieldName("source"));
    if (specifier === undefined) return;
    const names: ImportedName[] = [];
    const clause = node.namedChildren.find((c) => c.type === "import_clause");
    for (const c of clause?.namedChildren ?? []) {
      if (c.type === "identifier") names.push({ imported: "default", local: c.text });
      else if (c.type === "namespace_import") {
        const id = c.namedChildren.find((n) => n.type === "identifier");
        if (id) names.push({ imported: "*", local: id.text });
      } else if (c.type === "named_imports") {
        for (const s of c.namedChildren) {
          if (s.type !== "import_specifier") continue;
          const imported = s.childForFieldName("name")?.text ?? "";
          names.push({ imported, local: s.childForFieldName("alias")?.text ?? imported });
        }
      }
    }
    this.imports.push({ from: this.path, specifier, line: lineOf(node), names, kind: "import" });
  }

  /** `module.exports = x`, `module.exports.x = ...`, `exports.x = ...`. */
  private commonJsExport(node: Node): void {
    const assign = node.namedChildren[0];
    if (assign?.type !== "assignment_expression") return;
    const left = assign.childForFieldName("left")?.text ?? "";
    const right = assign.childForFieldName("right");
    if (!right) return;
    if (left === "module.exports") {
      if (right.type === "identifier") this.defaultName = right.text;
      else if (right.type === "object") {
        for (const p of right.namedChildren) {
          if (p.type === "shorthand_property_identifier") this.exportedNames.add(p.text);
          else if (p.type === "pair") {
            const v = p.childForFieldName("value");
            if (v?.type === "identifier") this.exportedNames.add(v.text);
          }
        }
      }
      return;
    }
    const m = /^(?:module\.)?exports\.([A-Za-z_$][\w$]*)$/.exec(left);
    if (!m?.[1]) return;
    if (FUNCTION_VALUES.has(right.type)) {
      this.add("function", m[1], assign, node, { exported: true, fn: right, owner: right });
    } else if (right.type === "identifier") this.exportedNames.add(right.text);
  }

  /** `${owner}\0${variable}` -> constructor callee, from `const x = new Foo()`. */
  private readonly constructed = new Map<string, string>();

  private collectCalls(root: Node): void {
    // Pre-order, in source order, so a declaration is seen before later uses.
    const stack: [Node, string][] = [[root, this.path]];
    while (stack.length) {
      const [node, parentOwner] = stack.pop() as [Node, string];
      const owner = this.owners.get(nodeKey(node)) ?? parentOwner;
      if (node.type === "variable_declarator") {
        const name = node.childForFieldName("name");
        const value = node.childForFieldName("value");
        const ctor =
          value?.type === "new_expression" ? value.childForFieldName("constructor") : null;
        if (name?.type === "identifier" && ctor) {
          this.constructed.set(
            `${owner}\0${name.text}`,
            calleeText(ctor, MEMBER, "object", "property"),
          );
        }
      }
      if (node.type === "call_expression") this.call(node, owner);
      else if (node.type === "new_expression") {
        const ctor = node.childForFieldName("constructor");
        if (ctor) this.pushCall(node, owner, calleeText(ctor, MEMBER, "object", "property"), true);
      }
      const children = node.namedChildren;
      for (let i = children.length - 1; i >= 0; i--) {
        const c = children[i];
        if (c) stack.push([c, owner]);
      }
    }
  }

  private call(node: Node, owner: string): void {
    const fn = node.childForFieldName("function");
    if (!fn) return;
    const firstArg = node.childForFieldName("arguments")?.namedChildren[0];
    if (fn.type === "import") {
      const spec = stringValue(firstArg);
      if (spec !== undefined) {
        this.imports.push({
          from: this.path,
          specifier: spec,
          line: lineOf(node),
          names: [],
          kind: "dynamic",
        });
      }
      return;
    }
    if (fn.type === "identifier" && fn.text === "require") {
      const spec = stringValue(firstArg);
      if (spec !== undefined) {
        this.imports.push({
          from: this.path,
          specifier: spec,
          line: lineOf(node),
          names: requireBindings(node),
          kind: "require",
        });
      }
      return;
    }
    let receiver: string | undefined;
    const object = fn.type === "member_expression" ? fn.childForFieldName("object") : null;
    if (object?.type === "new_expression") {
      const ctor = object.childForFieldName("constructor");
      if (ctor) receiver = calleeText(ctor, MEMBER, "object", "property");
    }
    this.pushCall(node, owner, calleeText(fn, MEMBER, "object", "property"), false, receiver);
  }

  private pushCall(
    node: Node,
    owner: string,
    callee: string,
    isNew: boolean,
    receiver?: string,
  ): void {
    const name = callee.slice(callee.lastIndexOf(".") + 1);
    if (!name || name === "<expr>") return;
    const call: CallFact = { from: owner, path: this.path, line: lineOf(node), callee, name };
    if (isNew) call.isNew = true;
    const head = callee.includes(".") ? callee.slice(0, callee.lastIndexOf(".")) : undefined;
    receiver ??= head
      ? (this.constructed.get(`${owner}\0${head}`) ?? this.constructed.get(`${this.path}\0${head}`))
      : undefined;
    if (receiver) call.receiver = receiver;
    this.calls.push(call);
  }
}

/** `const x = require("m")` binds a namespace; `const { a, b: c } = require("m")` binds names. */
function requireBindings(call: Node): ImportedName[] {
  const parent = call.parent;
  if (parent?.type !== "variable_declarator") return [];
  const name = parent.childForFieldName("name");
  if (name?.type === "identifier") return [{ imported: "*", local: name.text }];
  if (name?.type !== "object_pattern") return [];
  const out: ImportedName[] = [];
  for (const p of name.namedChildren) {
    if (p.type === "shorthand_property_identifier_pattern")
      out.push({ imported: p.text, local: p.text });
    else if (p.type === "pair_pattern") {
      const key = p.childForFieldName("key")?.text;
      const value = p.childForFieldName("value");
      if (key && value?.type === "identifier") out.push({ imported: key, local: value.text });
    }
  }
  return out;
}

export function extractJavaScript(source: string, path: string, language: string): ExtractResult {
  const tree = parse(grammarFor(language), source);
  try {
    const ex = new JsExtractor(path);
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

const EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".d.ts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".vue",
  ".svelte",
  ".json",
];
const BUILTINS = new Set(builtinModules.map((m) => m.replace(/^node:/, "")));

interface PathAlias {
  prefix: string;
  suffix: string;
  targets: string[];
}

function packageNameOf(spec: string): { name: string; subpath: string } {
  const parts = spec.split("/");
  const n = spec.startsWith("@") ? 2 : 1;
  return { name: parts.slice(0, n).join("/"), subpath: parts.slice(n).join("/") };
}

export async function createJsResolver(ctx: ResolveContext): Promise<Resolver> {
  const files = ctx.files;

  const tryFile = (base: string): string | undefined => {
    if (base.startsWith("../") || base === "..") return undefined;
    if (files.has(base)) return base;
    // NodeNext and ESM TypeScript import "./x.js" to mean "./x.ts".
    const js = /\.(m|c)?jsx?$/.exec(base);
    if (js) {
      const stem = base.slice(0, -js[0].length);
      for (const e of [".ts", ".tsx", ".mts", ".cts"]) if (files.has(stem + e)) return stem + e;
    }
    for (const e of EXTENSIONS) if (files.has(base + e)) return base + e;
    for (const e of EXTENSIONS) if (files.has(`${base}/index${e}`)) return `${base}/index${e}`;
    return undefined;
  };

  // tsconfig/jsconfig `paths` aliases from the repo root config.
  const aliases: PathAlias[] = [];
  let baseUrl: string | undefined;
  for (const name of ["tsconfig.json", "jsconfig.json"]) {
    if (!files.has(name)) continue;
    const json = parseJsonc((await ctx.readText(name)) ?? "") as
      { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } } | undefined;
    const opts = json?.compilerOptions;
    if (!opts) continue;
    baseUrl = posix.normalize(opts.baseUrl ?? ".");
    for (const [pattern, targets] of Object.entries(opts.paths ?? {})) {
      const star = pattern.indexOf("*");
      aliases.push({
        prefix: star === -1 ? pattern : pattern.slice(0, star),
        suffix: star === -1 ? "" : pattern.slice(star + 1),
        targets: targets.map((t) => posix.normalize(posix.join(baseUrl ?? ".", t))),
      });
    }
    break;
  }

  // Monorepo workspace packages: package name -> directory and entry.
  const workspace = new Map<string, { dir: string; entry?: string | undefined }>();
  for (const f of files) {
    if (!f.endsWith("package.json") || (f !== "package.json" && !f.endsWith("/package.json")))
      continue;
    const json = parseJsonc((await ctx.readText(f)) ?? "") as Record<string, unknown> | undefined;
    const name = typeof json?.name === "string" ? json.name : undefined;
    if (!name) continue;
    const dir = posix.dirname(f) === "." ? "" : posix.dirname(f);
    const exp = json?.exports;
    const dot = typeof exp === "string" ? exp : (exp as Record<string, unknown> | undefined)?.["."];
    const declared = [
      json?.source,
      json?.module,
      json?.main,
      typeof dot === "string" ? dot : undefined,
    ].find((v): v is string => typeof v === "string");
    workspace.set(name, { dir, entry: declared });
  }

  const inDir = (dir: string, rel: string) => posix.normalize(dir ? `${dir}/${rel}` : rel);

  const resolveWorkspace = (spec: string): string | undefined => {
    const { name, subpath } = packageNameOf(spec);
    const pkg = workspace.get(name);
    if (!pkg) return undefined;
    if (subpath)
      return tryFile(inDir(pkg.dir, subpath)) ?? tryFile(inDir(pkg.dir, `src/${subpath}`));
    const candidates: string[] = [];
    if (pkg.entry) {
      const entry = pkg.entry.replace(/^\.\//, "");
      candidates.push(entry);
      // Built output usually mirrors src: dist/index.js -> src/index.ts.
      candidates.push(entry.replace(/^(dist|lib|build|out)\//, "src/"));
    }
    candidates.push("src/index", "index");
    for (const c of candidates) {
      const hit = tryFile(inDir(pkg.dir, c));
      if (hit) return hit;
    }
    return undefined;
  };

  return {
    resolve(spec, from) {
      if (spec.startsWith(".") || spec.startsWith("/")) {
        if (spec.startsWith("/")) return {};
        return { resolved: tryFile(posix.normalize(posix.join(posix.dirname(from), spec))) };
      }
      for (const a of aliases) {
        if (!spec.startsWith(a.prefix) || !spec.endsWith(a.suffix)) continue;
        const captured = spec.slice(a.prefix.length, spec.length - a.suffix.length);
        for (const t of a.targets) {
          const hit = tryFile(t.replace("*", captured));
          if (hit) return { resolved: hit };
        }
      }
      const ws = resolveWorkspace(spec);
      if (ws) return { resolved: ws };
      const { name } = packageNameOf(spec.replace(/^node:/, ""));
      if (spec.startsWith("node:") || BUILTINS.has(name)) return { external: `node:${name}` };
      if (baseUrl !== undefined) {
        const hit = tryFile(posix.normalize(posix.join(baseUrl, spec)));
        if (hit) return { resolved: hit };
      }
      return { external: name };
    },
  };
}

export const javascriptPack: LanguagePack = {
  id: "javascript",
  version: 1,
  languages: ["JavaScript", "TypeScript", "TSX"],
  async init() {
    await Promise.all([loadGrammar("javascript"), loadGrammar("typescript"), loadGrammar("tsx")]);
  },
  extract: extractJavaScript,
  createResolver: createJsResolver,
};
