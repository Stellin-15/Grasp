import { existsSync } from "node:fs";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { ExtractResult } from "@grasp/core";
import type { ExtractJob, ExtractReply } from "./worker.js";

interface Pending {
  job: ExtractJob;
  resolve: (r: ExtractResult) => void;
  reject: (e: Error) => void;
}

interface Slot {
  worker: Worker;
  current?: Pending | undefined;
}

const MAX_WORKERS = 8;

function poolSize(): number {
  const env = process.env.GRASP_WORKERS;
  if (env !== undefined && env !== "") return Math.max(0, Math.min(32, Number(env) || 0));
  return Math.max(0, Math.min(MAX_WORKERS, availableParallelism() - 1));
}

/**
 * Parses files on worker threads. tree-sitter's WASM build is single-threaded,
 * so on a large repo parsing dominates scan time; one worker per core divides it.
 */
export class ExtractPool {
  private readonly slots: Slot[] = [];
  private readonly queue: Pending[] = [];
  private nextId = 0;

  private constructor(
    private readonly workerUrl: URL,
    private readonly size: number,
  ) {}

  /** Undefined when workers are disabled or unavailable (e.g. running from TypeScript sources in tests). */
  static create(): ExtractPool | undefined {
    const size = poolSize();
    const url = new URL("./worker.js", import.meta.url);
    if (size < 1 || url.protocol !== "file:" || !existsSync(fileURLToPath(url))) return undefined;
    return new ExtractPool(url, size);
  }

  run(packId: string, source: string, path: string, language: string): Promise<ExtractResult> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        job: { id: this.nextId++, packId, source, path, language },
        resolve,
        reject,
      });
      this.pump();
    });
  }

  private spawn(): Slot {
    const slot: Slot = { worker: new Worker(this.workerUrl) };
    slot.worker.on("message", (reply: ExtractReply) => {
      const p = slot.current;
      slot.current = undefined;
      if (p) {
        if ("error" in reply) p.reject(new Error(reply.error));
        else p.resolve(reply.result);
      }
      this.pump();
    });
    // A crashed worker (e.g. out of WASM memory) fails only its current file.
    slot.worker.on("error", (err) => {
      slot.current?.reject(err);
      slot.current = undefined;
      this.slots.splice(this.slots.indexOf(slot), 1);
      this.pump();
    });
    this.slots.push(slot);
    return slot;
  }

  private pump(): void {
    while (this.queue.length) {
      let slot = this.slots.find((s) => !s.current);
      if (!slot && this.slots.length < this.size) slot = this.spawn();
      if (!slot) break;
      const next = this.queue.shift();
      if (!next) break;
      slot.current = next;
      slot.worker.ref();
      slot.worker.postMessage(next.job);
    }
    // Idle workers must not keep the CLI process alive after the scan ends.
    for (const s of this.slots) if (!s.current) s.worker.unref();
  }
}

let shared: ExtractPool | undefined | null = null;

export function sharedPool(): ExtractPool | undefined {
  if (shared === null) shared = ExtractPool.create();
  return shared;
}
