import type { CallFact, ImportFact, SymbolFact } from "./types.js";

export interface ExtractResult {
  symbols: SymbolFact[];
  /** Unresolved: `resolved` and `external` are filled in later by the pack's resolver. */
  imports: ImportFact[];
  /** Unresolved: `resolved` is filled in by core call resolution. */
  calls: CallFact[];
  hasSyntaxErrors: boolean;
  isScript?: boolean | undefined;
  description?: string | undefined;
}

export interface ResolveContext {
  root: string;
  /** Every listed file in the repo, POSIX relative paths. */
  files: ReadonlySet<string>;
  readText(path: string): Promise<string | undefined>;
}

export interface ImportResolution {
  resolved?: string | undefined;
  external?: string | undefined;
}

export interface Resolver {
  resolve(specifier: string, fromPath: string): ImportResolution;
}

/**
 * A language plugs into the scanner by extracting facts from one file at a time
 * and resolving import specifiers to repo files. Everything cross-file (call
 * resolution, test linking, ranking) is language-independent and lives in core.
 */
export interface LanguagePack {
  id: string;
  /** Bump when extraction output changes, so cached extractions are discarded. */
  version: number;
  /** Language names from `detectLanguage` that this pack handles. */
  languages: string[];
  init(): Promise<void>;
  extract(source: string, path: string, language: string): ExtractResult;
  createResolver(ctx: ResolveContext): Promise<Resolver>;
}

export function symbolId(path: string, qualifiedName: string): string {
  return `${path}#${qualifiedName}`;
}
