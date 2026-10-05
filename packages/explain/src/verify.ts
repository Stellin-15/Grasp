import type {
  Claim,
  FileExplanation,
  FolderExplanation,
  FrameworkExplanation,
  PipelineExplanation,
  RepoExplanation,
  SymbolExplanation,
} from "./types.js";

/** What the verifier checks claims against. */
export interface VerifyContext {
  start: number;
  end: number;
  /** The exact source text the model saw for this unit (after redaction). */
  source: string;
  /** Names that exist in the repo: symbols, files, folders, packages, parameters. */
  known: ReadonlySet<string>;
  /** Repo symbol names only (classes, functions), to spot invented members like `Real.madeUp`. */
  repoSymbols?: ReadonlySet<string> | undefined;
  paramNames?: readonly string[] | undefined;
}

export class MalformedAnswer extends Error {}

const IDENT = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\(\))?$/;

/**
 * Language builtins, keywords, and standard globals. Explanations rightly
 * mention these (`TypeError`, `str`, `Promise`) even when the source does not.
 * Measured: without this list, about 90% of rejected claims were correct.
 */
const BUILTINS = new Set(
  // Python
  (
    "str bytes int float bool list dict set tuple frozenset object type None True False len isinstance " +
    "issubclass getattr setattr hasattr delattr callable iter next range enumerate zip map filter sorted " +
    "reversed min max sum any all abs round print open repr hash id super property staticmethod " +
    "classmethod NotImplemented Ellipsis memoryview bytearray complex divmod format vars dir globals " +
    "locals self cls args kwargs Exception BaseException TypeError ValueError KeyError IndexError " +
    "AttributeError RuntimeError NotImplementedError StopIteration StopAsyncIteration OSError IOError " +
    "FileNotFoundError PermissionError TimeoutError ImportError ModuleNotFoundError NameError " +
    "ZeroDivisionError OverflowError ArithmeticError AssertionError UnicodeDecodeError UnicodeEncodeError " +
    "UnicodeError LookupError RecursionError MemoryError KeyboardInterrupt SystemExit GeneratorExit " +
    "Warning DeprecationWarning UserWarning return yield async await if else elif for while with try " +
    "except finally raise lambda import from class def del pass in is not and or global nonlocal assert " +
    // JavaScript / TypeScript
    "undefined null true false NaN Infinity Object Array String Number Boolean Symbol BigInt Promise Map " +
    "Set WeakMap WeakSet Date RegExp JSON Math Error RangeError SyntaxError ReferenceError console " +
    "process Buffer globalThis window document fetch Response Request URL URLSearchParams setTimeout " +
    "clearTimeout setInterval clearInterval queueMicrotask structuredClone Record Partial Pick Omit " +
    "Readonly Required ReturnType Awaited unknown any never void string number boolean bigint this new " +
    "throw catch typeof instanceof keyof const let var function export default length prototype " +
    "constructor then"
  ).split(" "),
);

function isAllowed(bare: string, ctx: VerifyContext): boolean {
  const parts = bare.split(".");
  const head = parts[0] ?? "";
  const last = parts[parts.length - 1] ?? "";
  if (/^__\w+__$/.test(last) || BUILTINS.has(bare) || BUILTINS.has(last)) return true;
  if (ctx.known.has(bare) || ctx.known.has(last)) return true;
  if (ctx.source.includes(bare) || ctx.source.includes(last)) return true;
  // Members of builtins or imported packages (`base64.urlsafe_b64decode`) are real outside knowledge.
  if (
    parts.length > 1 &&
    (BUILTINS.has(head) || (ctx.known.has(head) && !ctx.repoSymbols?.has(head)))
  )
    return true;
  return false;
}

/** Identifiers in backticks that are neither in the code, the repo, nor the language. */
function unknownIdentifiers(text: string, ctx: VerifyContext): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const token = (m[1] ?? "").trim();
    if (!IDENT.test(token)) continue;
    if (!isAllowed(token.replace(/\(\)$/, ""), ctx)) out.push(token);
  }
  return out;
}

/**
 * The clearest sign of fabrication: a member of a real repo class or module
 * that does not exist (`Signer.made_up`). Other unknown names are flagged only.
 */
function fabricated(unknown: string[], ctx: VerifyContext): string[] {
  return unknown.filter((u) => {
    const parts = u.replace(/\(\)$/, "").split(".");
    return parts.length > 1 && !!ctx.repoSymbols?.has(parts[0] ?? "");
  });
}

function asString(v: unknown, field: string): string {
  if (typeof v !== "string") throw new MalformedAnswer(`\`${field}\` is not a string`);
  return v.trim();
}

function asClaims(v: unknown, field: string): Claim[] {
  if (!Array.isArray(v)) throw new MalformedAnswer(`\`${field}\` is not an array`);
  return v.map((c, i) => {
    const r = c as Record<string, unknown>;
    if (typeof r?.text !== "string" || !Number.isInteger(r.start) || !Number.isInteger(r.end)) {
      throw new MalformedAnswer(`\`${field}[${i}]\` is not a claim`);
    }
    return { text: r.text.trim(), start: r.start as number, end: r.end as number };
  });
}

function checkClaims(
  claims: Claim[],
  field: string,
  ctx: VerifyContext,
  dropped: string[],
): Claim[] {
  return claims.filter((c) => {
    if (c.start > c.end || c.start < ctx.start || c.end > ctx.end) {
      dropped.push(
        `${field}: "${c.text.slice(0, 80)}" cites lines ${c.start}-${c.end}, outside ${ctx.start}-${ctx.end}`,
      );
      return false;
    }
    const unknown = unknownIdentifiers(c.text, ctx);
    const invented = fabricated(unknown, ctx);
    if (invented.length) {
      dropped.push(
        `${field}: "${c.text.slice(0, 80)}" refers to ${invented.map((u) => `\`${u}\``).join(", ")}, which does not exist in the repo`,
      );
      return false;
    }
    if (unknown.length) {
      dropped.push(
        `${field}: "${c.text.slice(0, 80)}" mentions ${unknown.map((u) => `\`${u}\``).join(", ")}, not found in the code (kept, flagged)`,
      );
    }
    return true;
  });
}

/** Prose fields are kept (they cannot be cut in half) but unknown names are reported. */
function flagProse(text: string, field: string, ctx: VerifyContext, dropped: string[]): string {
  const unknown = unknownIdentifiers(text, ctx);
  if (unknown.length)
    dropped.push(
      `${field}: mentions ${unknown.map((u) => `\`${u}\``).join(", ")}, not found in the code (kept, flagged)`,
    );
  return text;
}

export function verifySymbol(
  data: unknown,
  ctx: VerifyContext,
): { doc: SymbolExplanation; dropped: string[] } {
  const r = (data ?? {}) as Record<string, unknown>;
  const dropped: string[] = [];
  if (!Array.isArray(r.params)) throw new MalformedAnswer("`params` is not an array");
  const allowed = new Set(ctx.paramNames ?? []);
  const params = (r.params as Record<string, unknown>[])
    .map((p) => ({ name: String(p?.name ?? "").trim(), meaning: String(p?.meaning ?? "").trim() }))
    .filter((p) => {
      if (allowed.size && !allowed.has(p.name)) {
        dropped.push(`params: "${p.name}" is not a parameter of this symbol`);
        return false;
      }
      return p.name && p.meaning;
    });
  const doc: SymbolExplanation = {
    summary: flagProse(asString(r.summary, "summary"), "summary", ctx, dropped),
    purpose: flagProse(asString(r.purpose, "purpose"), "purpose", ctx, dropped),
    params,
    returns: asString(r.returns, "returns"),
    steps: checkClaims(asClaims(r.steps, "steps"), "steps", ctx, dropped),
    branches: checkClaims(asClaims(r.branches, "branches"), "branches", ctx, dropped),
    errors: checkClaims(asClaims(r.errors, "errors"), "errors", ctx, dropped),
    sideEffects: checkClaims(asClaims(r.sideEffects, "sideEffects"), "sideEffects", ctx, dropped),
    gotchas: checkClaims(asClaims(r.gotchas, "gotchas"), "gotchas", ctx, dropped),
  };
  if (!doc.summary) throw new MalformedAnswer("empty summary");
  return { doc, dropped };
}

export function verifyFile(
  data: unknown,
  ctx: VerifyContext,
): { doc: FileExplanation; dropped: string[] } {
  const r = (data ?? {}) as Record<string, unknown>;
  const dropped: string[] = [];
  const doc: FileExplanation = {
    summary: flagProse(asString(r.summary, "summary"), "summary", ctx, dropped),
    overview: flagProse(asString(r.overview, "overview"), "overview", ctx, dropped),
    role: flagProse(asString(r.role, "role"), "role", ctx, dropped),
    highlights: checkClaims(asClaims(r.highlights, "highlights"), "highlights", ctx, dropped),
  };
  if (!doc.summary) throw new MalformedAnswer("empty summary");
  return { doc, dropped };
}

export function verifyFolder(
  data: unknown,
  ctx: VerifyContext,
): { doc: FolderExplanation; dropped: string[] } {
  const r = (data ?? {}) as Record<string, unknown>;
  const dropped: string[] = [];
  const doc: FolderExplanation = {
    summary: flagProse(asString(r.summary, "summary"), "summary", ctx, dropped),
    overview: flagProse(asString(r.overview, "overview"), "overview", ctx, dropped),
  };
  if (!doc.summary) throw new MalformedAnswer("empty summary");
  return { doc, dropped };
}

export function verifyRepo(
  data: unknown,
  ctx: VerifyContext,
): { doc: RepoExplanation; dropped: string[] } {
  const r = (data ?? {}) as Record<string, unknown>;
  const dropped: string[] = [];
  if (!Array.isArray(r.flows)) throw new MalformedAnswer("`flows` is not an array");
  const doc: RepoExplanation = {
    summary: flagProse(asString(r.summary, "summary"), "summary", ctx, dropped),
    overview: flagProse(asString(r.overview, "overview"), "overview", ctx, dropped),
    architecture: flagProse(asString(r.architecture, "architecture"), "architecture", ctx, dropped),
    flows: (r.flows as Record<string, unknown>[]).map((f, i) => ({
      name: String(f?.name ?? `Flow ${i + 1}`),
      description: flagProse(String(f?.description ?? ""), `flows[${i}]`, ctx, dropped),
    })),
  };
  if (!doc.summary) throw new MalformedAnswer("empty summary");
  return { doc, dropped };
}

export interface FrameworkVerifyContext extends VerifyContext {
  /** Files the framework explanation may cite, with their line counts. */
  files: ReadonlyMap<string, number>;
}

export function verifyFramework(
  data: unknown,
  ctx: FrameworkVerifyContext,
): { doc: FrameworkExplanation; dropped: string[] } {
  const r = (data ?? {}) as Record<string, unknown>;
  const dropped: string[] = [];
  if (!Array.isArray(r.patterns)) throw new MalformedAnswer("`patterns` is not an array");
  const patterns = (r.patterns as Record<string, unknown>[]).flatMap((p, i) => {
    const path = String(p?.path ?? "");
    const start = Number(p?.start);
    const end = Number(p?.end);
    const text = String(p?.text ?? "").trim();
    const lines = ctx.files.get(path);
    if (lines === undefined) {
      dropped.push(
        `patterns[${i}]: cites \`${path}\`, which is not a file that uses this framework`,
      );
      return [];
    }
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 1 ||
      start > end ||
      end > lines
    ) {
      dropped.push(
        `patterns[${i}]: cites ${path}:${start}-${end}, outside the file's ${lines} lines`,
      );
      return [];
    }
    const unknown = unknownIdentifiers(text, ctx);
    const invented = fabricated(unknown, ctx);
    if (invented.length) {
      dropped.push(
        `patterns[${i}]: refers to ${invented.map((u) => `\`${u}\``).join(", ")}, which does not exist in the repo`,
      );
      return [];
    }
    if (unknown.length) {
      dropped.push(
        `patterns[${i}]: mentions ${unknown.map((u) => `\`${u}\``).join(", ")}, not found in the code (kept, flagged)`,
      );
    }
    return [{ text, path, start, end }];
  });
  const doc: FrameworkExplanation = {
    howUsed: flagProse(asString(r.howUsed, "howUsed"), "howUsed", ctx, dropped),
    patterns,
  };
  if (!doc.howUsed) throw new MalformedAnswer("empty howUsed");
  return { doc, dropped };
}

export function verifyPipeline(
  data: unknown,
  stepLines: ReadonlySet<number>,
): { doc: PipelineExplanation; dropped: string[] } {
  const r = (data ?? {}) as Record<string, unknown>;
  const dropped: string[] = [];
  if (!Array.isArray(r.steps)) throw new MalformedAnswer("`steps` is not an array");
  const steps = (r.steps as Record<string, unknown>[]).flatMap((s) => {
    const line = Number(s?.line);
    const why = String(s?.why ?? "").trim();
    if (!stepLines.has(line)) {
      dropped.push(`steps: line ${line} is not a step in this pipeline`);
      return [];
    }
    return why ? [{ line, why }] : [];
  });
  const summary = asString(r.summary, "summary");
  if (!summary) throw new MalformedAnswer("empty summary");
  return { doc: { summary, steps }, dropped };
}
