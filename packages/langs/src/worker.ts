import { parentPort } from "node:worker_threads";
import type { ExtractResult } from "@grasp/core";
import { extractJavaScript } from "./javascript.js";
import { extractPython } from "./python.js";
import { loadGrammar } from "./runtime.js";

export interface ExtractJob {
  id: number;
  packId: string;
  source: string;
  path: string;
  language: string;
}

export type ExtractReply = { id: number; result: ExtractResult } | { id: number; error: string };

const EXTRACTORS: Record<
  string,
  (source: string, path: string, language: string) => ExtractResult
> = {
  javascript: extractJavaScript,
  python: (source, path) => extractPython(source, path),
};

// Gotcha: this worker calls the pure extract functions, never `pack.extract`,
// which would route back into the pool.
const ready = Promise.all(
  (["javascript", "typescript", "tsx", "python"] as const).map((g) => loadGrammar(g)),
);

parentPort?.on("message", (job: ExtractJob) => {
  void ready.then(() => {
    let reply: ExtractReply;
    try {
      const extract = EXTRACTORS[job.packId];
      if (!extract) throw new Error(`unknown pack ${job.packId}`);
      reply = { id: job.id, result: extract(job.source, job.path, job.language) };
    } catch (err) {
      reply = { id: job.id, error: (err as Error).message };
    }
    parentPort?.postMessage(reply);
  });
});
