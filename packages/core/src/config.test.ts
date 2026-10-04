import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, loadConfig, mergeConfig } from "./config.js";

describe("mergeConfig", () => {
  it("applies valid values", () => {
    const warnings: string[] = [];
    const c = mergeConfig(
      DEFAULT_CONFIG,
      { ignore: ["*.gen.ts"], maxFileSizeKb: 64, risk: { weights: { churn: 0.9 } } },
      "test",
      warnings,
    );
    expect(c.ignore).toEqual(["*.gen.ts"]);
    expect(c.maxFileSizeKb).toBe(64);
    expect(c.risk.weights.churn).toBe(0.9);
    expect(c.risk.weights.centrality).toBe(DEFAULT_CONFIG.risk.weights.centrality);
    expect(warnings).toEqual([]);
  });

  it("keeps defaults and warns on bad values", () => {
    const warnings: string[] = [];
    const c = mergeConfig(
      DEFAULT_CONFIG,
      { maxFileSizeKb: "big", bogus: 1, risk: { sensitivePatterns: ["(unclosed"] } },
      "test",
      warnings,
    );
    expect(c.maxFileSizeKb).toBe(DEFAULT_CONFIG.maxFileSizeKb);
    expect(c.risk.sensitivePatterns).toEqual(DEFAULT_CONFIG.risk.sensitivePatterns);
    expect(warnings).toHaveLength(3);
  });

  it("never mutates the base config", () => {
    mergeConfig(DEFAULT_CONFIG, { ignore: ["x"] }, "test", []);
    expect(DEFAULT_CONFIG.ignore).toEqual([]);
  });
});

describe("loadConfig", () => {
  it("layers repo config under workspace config and survives invalid JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "grasp-cfg-"));
    const ws = await mkdtemp(join(tmpdir(), "grasp-ws-"));
    await mkdir(join(root, ".grasp"));
    await writeFile(join(root, ".grasp", "config.json"), JSON.stringify({ maxFileSizeKb: 10 }));
    await writeFile(join(ws, "config.json"), "{ not json");
    const { config, sources, warnings } = await loadConfig(root, ws);
    expect(config.maxFileSizeKb).toBe(10);
    expect(sources).toHaveLength(1);
    expect(warnings[0]).toMatch(/invalid JSON/);
  });
});
