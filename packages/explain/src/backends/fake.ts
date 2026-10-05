import type { CompletionRequest, CompletionResult, LlmBackend } from "../backend.js";

export type FakeResponder = (req: CompletionRequest) => unknown;

/**
 * Deterministic backend for tests: no process, no network, no cost. The
 * default responder reads the unit's line range and name out of the prompt and
 * returns schema-shaped answers that cite those lines, plus one deliberately
 * bad citation so tests can prove the verifier removes it.
 */
export class FakeBackend implements LlmBackend {
  readonly id = "fake";
  readonly label = "Fake (tests)";
  readonly billing = "free";
  readonly overheadTokens = 0;
  readonly model = "fake-1";
  readonly calls: CompletionRequest[] = [];

  constructor(private readonly responder: FakeResponder = defaultResponder) {}

  async available(): Promise<boolean> {
    return true;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    this.calls.push(req);
    return {
      data: this.responder(req),
      model: this.model,
      inputTokens: Math.ceil((req.system.length + req.prompt.length) / 4),
      outputTokens: 200,
      costUsd: 0,
    };
  }
}

function defaultResponder(req: CompletionRequest): unknown {
  const kind = /^UNIT: (\w+)/m.exec(req.prompt)?.[1];
  const name = /^NAME: (.+)$/m.exec(req.prompt)?.[1] ?? "unit";
  const range = /^LINES: (\d+)-(\d+)$/m.exec(req.prompt);
  const start = Number(range?.[1] ?? 1);
  const end = Number(range?.[2] ?? start);
  switch (kind) {
    case "symbol":
      return {
        summary: `${name} does its job.`,
        purpose: `Exists so callers can use ${name}.`,
        params: [],
        returns: "",
        steps: [
          { text: `Starts at the declaration of \`${name.split(".").pop()}\`.`, start, end: start },
          { text: "Finishes the work.", start, end },
        ],
        branches: [],
        errors: [],
        sideEffects: [],
        // Out of range on purpose: the verifier must drop it.
        gotchas: [{ text: "Something past the end.", start: end + 50, end: end + 60 }],
      };
    case "file":
      return {
        summary: `${name} groups related code.`,
        overview: "An overview of the file.",
        role: "Used by other files.",
        highlights: [{ text: "The first lines.", start: 1, end: 1 }],
      };
    case "folder":
      return { summary: `${name} is a folder.`, overview: "It holds related files." };
    case "framework": {
      const file = /^--- (.+) ---$/m.exec(req.prompt)?.[1] ?? "unknown";
      return {
        howUsed: `This repo uses ${name} in \`${file}\`.`,
        patterns: [
          { text: "Imported at the top.", path: file, start: 1, end: 1 },
          // Not a file that uses the framework: the verifier must drop it.
          { text: "Somewhere else.", path: "nowhere.ts", start: 1, end: 1 },
        ],
      };
    }
    case "pipeline": {
      const lines = [...req.prompt.matchAll(/^- Step at line (\d+):/gm)].map((m) => Number(m[1]));
      return {
        summary: `${name} keeps the main branch healthy.`,
        steps: [
          ...lines.map((line) => ({ line, why: `Step on line ${line} matters.` })),
          { line: 9999, why: "Not a step." },
        ],
      };
    }
    default:
      return {
        summary: "A test repository.",
        overview: "It is small.",
        architecture: "Files import each other.",
        flows: [{ name: "Main flow", description: "Starts at the entry point." }],
      };
  }
}
