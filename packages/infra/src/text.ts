import { classifyFile, detectLanguage } from "@grasp/core";
import { isMap, isScalar, isSeq, LineCounter, parseDocument, type Document, type Node } from "yaml";

/** 1-based line of the first line matching `re`, or 1 when nothing matches. */
export function findLine(text: string, re: RegExp, from = 1): number {
  const lines = text.split("\n");
  for (let i = Math.max(0, from - 1); i < lines.length; i++) {
    if (re.test(lines[i] ?? "")) return i + 1;
  }
  return from;
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface ParsedYaml {
  doc: Document;
  value: unknown;
  /** Line of the key at `path` (or the item for sequence indexes). */
  lineAt(path: (string | number)[]): number;
}

/** YAML with line numbers kept, so every pipeline fact can cite its source line. */
export function parseYaml(text: string): ParsedYaml {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, uniqueKeys: false });
  if (doc.errors.length) throw new Error(doc.errors[0]?.message ?? "invalid YAML");
  const lineOf = (n: Node | null | undefined) =>
    n?.range ? lineCounter.linePos(n.range[0]).line : 1;
  return {
    doc,
    value: doc.toJS({ maxAliasCount: 1000 }) as unknown,
    lineAt(path) {
      let node: unknown = doc.contents;
      let line = 1;
      for (const seg of path) {
        if (isMap(node)) {
          const pair = node.items.find(
            (p) => isScalar(p.key) && String(p.key.value) === String(seg),
          );
          if (!pair) return line;
          line = lineOf(pair.key as Node);
          node = pair.value;
        } else if (isSeq(node) && typeof seg === "number") {
          const item = node.items[seg] as Node | undefined;
          if (!item) return line;
          line = lineOf(item);
          node = item;
        } else return line;
      }
      return line;
    },
  };
}

export function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

export function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
}

export function asString(v: unknown): string | undefined {
  return typeof v === "string"
    ? v
    : typeof v === "number" || typeof v === "boolean"
      ? String(v)
      : undefined;
}

export function basename(p: string): string {
  return p.slice(p.lastIndexOf("/") + 1);
}

export function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}

/**
 * Test fixtures and vendored code describe other projects, so their manifests,
 * scripts, and env vars must not be reported as this repo's own.
 */
export function isForeign(path: string): boolean {
  const role = classifyFile(path, detectLanguage(path));
  return role === "fixture" || role === "vendored";
}
