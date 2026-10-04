import type { Node } from "./runtime.js";

export function lineOf(node: Node): number {
  return node.startPosition.row + 1;
}

export function endLineOf(node: Node): number {
  return node.endPosition.row + 1;
}

export function oneLine(text: string, max = 240): string {
  const s = text.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Source text of a declaration up to (not including) its body, as one line. */
export function headText(node: Node, body: Node | null): string {
  if (!body) return oneLine(node.text);
  const end = body.startIndex - node.startIndex;
  // Gotcha: strip only the token that introduces the body, so `Promise<T>` keeps its `>`.
  return oneLine(node.text.slice(0, Math.max(0, end)).replace(/\s*(=>|=|:|\{)?\s*$/, ""));
}

/** Strips `/** ... *\/` framing and leading `*` from a JSDoc block. */
export function cleanJsDoc(text: string): string {
  return text
    .replace(/^\/\*\*?/, "")
    .replace(/\*\/$/, "")
    .split("\n")
    .map((l) => l.replace(/^\s*\* ?/, ""))
    .join("\n")
    .trim();
}

/** Strips quotes and prefixes from a Python string literal used as a docstring. */
export function cleanPyDocstring(text: string): string {
  const body = text.replace(/^[rRuUbBfF]*("""|'''|"|')/, "").replace(/("""|'''|"|')$/, "");
  const lines = body.split("\n");
  // PEP 257: strip the common indentation of all lines after the first.
  const indents = lines
    .slice(1)
    .filter((l) => l.trim())
    .map((l) => l.length - l.trimStart().length);
  const cut = indents.length ? Math.min(...indents) : 0;
  return [lines[0] ?? "", ...lines.slice(1).map((l) => l.slice(cut))].join("\n").trim();
}

const LICENSE_HEADER = /copyright|license|spdx|all rights reserved/i;

export function isLicenseHeader(text: string): boolean {
  return LICENSE_HEADER.test(text);
}

/** Callee text when it is a plain chain like `a`, `this.a`, `a.b.c`; otherwise `<expr>.name`. */
export function calleeText(
  node: Node,
  memberTypes: string[],
  objectField: string,
  propField: string,
): string {
  if (node.type === "identifier" || node.type === "this" || node.type === "super") return node.text;
  if (memberTypes.includes(node.type)) {
    const obj = node.childForFieldName(objectField);
    const prop = node.childForFieldName(propField);
    const propText = prop?.text ?? "?";
    if (!obj) return propText;
    const objText = calleeText(obj, memberTypes, objectField, propField);
    return objText.includes("<expr>") ? `<expr>.${propText}` : `${objText}.${propText}`;
  }
  return "<expr>";
}
