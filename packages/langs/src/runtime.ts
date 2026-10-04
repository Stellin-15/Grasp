import { createRequire } from "node:module";
import { Language, Parser, type Node, type Tree } from "web-tree-sitter";

const require = createRequire(import.meta.url);

/** Grammar name to the npm package file holding its WASM build. */
const GRAMMARS = {
  javascript: "tree-sitter-javascript/tree-sitter-javascript.wasm",
  typescript: "tree-sitter-typescript/tree-sitter-typescript.wasm",
  tsx: "tree-sitter-typescript/tree-sitter-tsx.wasm",
  python: "tree-sitter-python/tree-sitter-python.wasm",
} as const;

export type GrammarName = keyof typeof GRAMMARS;

let initPromise: Promise<void> | undefined;
const languages = new Map<GrammarName, Promise<Language>>();
const parsers = new Map<GrammarName, Parser>();

function ensureInit(): Promise<void> {
  initPromise ??= Parser.init();
  return initPromise;
}

export async function loadGrammar(name: GrammarName): Promise<void> {
  await ensureInit();
  let lang = languages.get(name);
  if (!lang) {
    lang = Language.load(require.resolve(GRAMMARS[name]));
    languages.set(name, lang);
  }
  const loaded = await lang;
  if (!parsers.has(name)) {
    const parser = new Parser();
    parser.setLanguage(loaded);
    parsers.set(name, parser);
  }
}

/**
 * Parses synchronously with a grammar loaded by `loadGrammar`.
 * Gotcha: callers must `tree.delete()` when done, WASM memory is not garbage collected.
 */
export function parse(name: GrammarName, source: string): Tree {
  const parser = parsers.get(name);
  if (!parser) throw new Error(`grammar "${name}" not loaded`);
  const tree = parser.parse(source);
  if (!tree) throw new Error(`tree-sitter returned no tree`);
  return tree;
}

export type { Node, Tree };
