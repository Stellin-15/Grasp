import type {
  Claim,
  FileExplanation,
  FolderExplanation,
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
  paramNames?: readonly string[] | undefined;
}

export class MalformedAnswer extends Error {}

const IDENT = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\(\))?$/;

/**
 * Identifiers in backticks must exist: in the source the model was shown, or
 * among known repo names. Anything else is likely invented.
 */
function unknownIdentifiers(text: string, ctx: VerifyContext): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const token = (m[1] ?? "").trim();
    if (!IDENT.test(token)) continue;
    const bare = token.replace(/\(\)$/, "");
    const last = bare.slice(bare.lastIndexOf(".") + 1);
    if (ctx.known.has(bare) || ctx.known.has(last)) continue;
    if (ctx.source.includes(bare) || ctx.source.includes(last)) continue;
    out.push(token);
  }
  return out;
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
    if (unknown.length) {
      dropped.push(
        `${field}: "${c.text.slice(0, 80)}" mentions ${unknown.map((u) => `\`${u}\``).join(", ")}, not found in the code`,
      );
      return false;
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
