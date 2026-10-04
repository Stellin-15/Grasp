import type { Audience } from "./types.js";

/** Bump when prompts or schemas change in a way that should regenerate cached explanations. */
export const PROMPT_VERSION = 1;

const AUDIENCE: Record<Audience, string> = {
  beginner:
    "someone new to this language and to this project. Use plain words. The first time the code relies on a language feature (for example decorators, async/await, generics, closures, context managers), explain it in one sentence. Use a short analogy only when it genuinely helps.",
  dev: "an experienced developer who is new to this codebase. Focus on intent, design, data flow, and tradeoffs. Skip explanations of basic language features.",
  reviewer:
    "a code reviewer. Focus on risks: edge cases, assumptions, failure modes, missing checks, and what else would break if this code changed (its blast radius).",
};

export function systemPrompt(audience: Audience): string {
  return [
    "You explain source code so that people understand it well enough to change it safely.",
    "",
    "Rules:",
    "- State only what the provided source and facts show. If something cannot be known from them, say so instead of guessing.",
    "- Every item that has `start` and `end` must cite lines inside the LINES range, using the line numbers printed left of the source.",
    "- Write identifiers exactly as they appear in the code, wrapped in backticks.",
    "- Explain why as well as what: the intent, the case being handled, the consequence of each branch.",
    "- Be concrete and brief. No filler, no praise, no restating the signature.",
    `- Audience: ${AUDIENCE[audience]}`,
  ].join("\n");
}

/** Source with right-aligned line numbers, so citations can be checked against what the model saw. */
export function numbered(lines: string[], firstLine: number): string {
  const width = String(firstLine + lines.length - 1).length;
  return lines.map((l, i) => `${String(firstLine + i).padStart(width)} | ${l}`).join("\n");
}

const claim = {
  type: "object",
  properties: {
    text: { type: "string" },
    start: { type: "integer" },
    end: { type: "integer" },
  },
  required: ["text", "start", "end"],
  additionalProperties: false,
};
const claims = { type: "array", items: claim };

export const SYMBOL_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "One sentence: what it does." },
    purpose: { type: "string", description: "Why it exists and where it fits." },
    params: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, meaning: { type: "string" } },
        required: ["name", "meaning"],
        additionalProperties: false,
      },
    },
    returns: { type: "string", description: "What is returned and when. Empty if nothing." },
    steps: {
      ...claims,
      description: "The logic in execution order, one step per meaningful block.",
    },
    branches: { ...claims, description: "Each condition and what triggers it." },
    errors: { ...claims, description: "What can fail and how it is raised or reported." },
    sideEffects: { ...claims, description: "I/O, network, mutation of arguments or shared state." },
    gotchas: {
      ...claims,
      description: "Surprising behavior or pitfalls for someone changing this code.",
    },
  },
  required: [
    "summary",
    "purpose",
    "params",
    "returns",
    "steps",
    "branches",
    "errors",
    "sideEffects",
    "gotchas",
  ],
  additionalProperties: false,
};

export const FILE_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "One sentence: what this file is for." },
    overview: { type: "string", description: "What is in it and how its parts relate." },
    role: {
      type: "string",
      description: "How the rest of the repo uses it. Name files in backticks.",
    },
    highlights: { ...claims, description: "The parts worth reading first." },
  },
  required: ["summary", "overview", "role", "highlights"],
  additionalProperties: false,
};

export const FOLDER_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "One sentence: this folder's responsibility." },
    overview: {
      type: "string",
      description: "How its files work together and how it connects to the rest.",
    },
  },
  required: ["summary", "overview"],
  additionalProperties: false,
};

export const REPO_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "One sentence: what this project is." },
    overview: { type: "string", description: "What it does, for whom, and how it is organized." },
    architecture: {
      type: "string",
      description: "How the major parts fit together. Name folders and files in backticks.",
    },
    flows: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, description: { type: "string" } },
        required: ["name", "description"],
        additionalProperties: false,
      },
      description:
        "Two to five main flows through the code, each naming the files involved in order.",
    },
  },
  required: ["summary", "overview", "architecture", "flows"],
  additionalProperties: false,
};

export interface SymbolPromptInput {
  name: string;
  kind: string;
  path: string;
  language: string;
  start: number;
  end: number;
  facts: string[];
  source: string;
  abridged: boolean;
}

export function symbolPrompt(i: SymbolPromptInput): string {
  return [
    "UNIT: symbol",
    `NAME: ${i.name}`,
    `KIND: ${i.kind}`,
    `FILE: ${i.path} (${i.language})`,
    `LINES: ${i.start}-${i.end}`,
    "",
    "FACTS (from static analysis, verified):",
    ...i.facts.map((f) => `- ${f}`),
    "",
    i.abridged
      ? "SOURCE (abridged: member bodies are omitted and explained separately):"
      : "SOURCE:",
    i.source,
    "",
    "TASK:",
    `Write the reference entry for this ${i.kind}. In \`params\`, use exactly the parameter names from FACTS.`,
    "`steps` is a walkthrough of the logic in execution order: one step per meaningful block, each citing its lines.",
    "Use empty arrays for sections that do not apply, and an empty `returns` when nothing is returned.",
  ].join("\n");
}

export interface FilePromptInput {
  path: string;
  language: string;
  lines: number;
  facts: string[];
  source?: string | undefined;
}

export function filePrompt(i: FilePromptInput): string {
  return [
    "UNIT: file",
    `NAME: ${i.path}`,
    `FILE: ${i.path} (${i.language})`,
    `LINES: 1-${i.lines}`,
    "",
    "FACTS (from static analysis, verified):",
    ...i.facts.map((f) => `- ${f}`),
    "",
    i.source
      ? `SOURCE:\n${i.source}`
      : "SOURCE: omitted; the symbol summaries above describe its contents.",
    "",
    "TASK:",
    "Explain this file for someone about to read it. `highlights` cites the lines of the two to five parts worth reading first.",
  ].join("\n");
}

export function folderPrompt(path: string, facts: string[]): string {
  return [
    "UNIT: folder",
    `NAME: ${path}/`,
    "",
    "FACTS (from static analysis and explanations of its files, verified):",
    ...facts.map((f) => `- ${f}`),
    "",
    "TASK:",
    "Explain this folder's responsibility and how its files work together. Name files in backticks.",
  ].join("\n");
}

export function repoPrompt(name: string, facts: string[]): string {
  return [
    "UNIT: repo",
    `NAME: ${name}`,
    "",
    "FACTS (from static analysis and explanations of its folders, verified):",
    ...facts.map((f) => `- ${f}`),
    "",
    "TASK:",
    "Explain this project to someone about to contribute to it for the first time.",
    "`architecture` explains how the major folders fit together; `flows` traces the main paths through the code, naming files in order.",
  ].join("\n");
}
