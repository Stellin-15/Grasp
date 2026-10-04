import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface RiskWeights {
  centrality: number;
  churn: number;
  sensitive: number;
  size: number;
}

export interface GraspConfig {
  /** Extra gitignore-style patterns, on top of .gitignore and .graspignore. */
  ignore: string[];
  /** Files larger than this are listed but not parsed. */
  maxFileSizeKb: number;
  git: {
    /** How many recent commits to read for churn and history. */
    maxCommits: number;
  };
  risk: {
    weights: RiskWeights;
    /** Regex sources matched against paths to flag sensitive code. */
    sensitivePatterns: string[];
  };
}

export const DEFAULT_CONFIG: GraspConfig = {
  ignore: [],
  maxFileSizeKb: 512,
  git: { maxCommits: 5000 },
  risk: {
    weights: { centrality: 0.4, churn: 0.3, sensitive: 0.2, size: 0.1 },
    sensitivePatterns: [
      "auth",
      "login",
      "passw",
      "token",
      "secret",
      "crypt",
      "session",
      "oauth",
      "jwt",
      "permission",
      "acl",
      "payment",
      "billing",
      "invoice",
      "checkout",
      "sql",
      "migration",
      "security",
      "sanitiz",
    ],
  },
};

export interface LoadedConfig {
  config: GraspConfig;
  sources: string[];
  warnings: string[];
}

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Merges one user-supplied layer onto a valid config.
 * Fail soft: a wrong value is reported and skipped instead of aborting the scan.
 */
export function mergeConfig(
  base: GraspConfig,
  layer: unknown,
  source: string,
  warnings: string[],
): GraspConfig {
  if (!isObject(layer)) {
    warnings.push(`${source}: expected a JSON object, ignored`);
    return base;
  }
  const out: GraspConfig = structuredClone(base);
  const bad = (key: string, expected: string) =>
    warnings.push(`${source}: "${key}" should be ${expected}, using default`);

  for (const [key, value] of Object.entries(layer)) {
    switch (key) {
      case "$schema":
        break;
      case "ignore":
        if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
          out.ignore = [...out.ignore, ...value];
        } else bad(key, "an array of strings");
        break;
      case "maxFileSizeKb":
        if (typeof value === "number" && value > 0) out.maxFileSizeKb = value;
        else bad(key, "a positive number");
        break;
      case "git":
        if (isObject(value) && typeof value.maxCommits === "number" && value.maxCommits >= 0) {
          out.git.maxCommits = value.maxCommits;
        } else bad("git.maxCommits", "a non-negative number");
        break;
      case "risk":
        if (!isObject(value)) {
          bad(key, "an object");
          break;
        }
        if (value.weights !== undefined) {
          if (isObject(value.weights)) {
            for (const [w, n] of Object.entries(value.weights)) {
              if (w in out.risk.weights && typeof n === "number" && n >= 0) {
                out.risk.weights[w as keyof RiskWeights] = n;
              } else bad(`risk.weights.${w}`, "a known weight with a non-negative number");
            }
          } else bad("risk.weights", "an object");
        }
        if (value.sensitivePatterns !== undefined) {
          const p = value.sensitivePatterns;
          if (Array.isArray(p) && p.every((v) => typeof v === "string" && isValidRegex(v))) {
            out.risk.sensitivePatterns = p as string[];
          } else bad("risk.sensitivePatterns", "an array of valid regex strings");
        }
        break;
      default:
        warnings.push(`${source}: unknown key "${key}", ignored`);
    }
  }
  return out;
}

function isValidRegex(source: string): boolean {
  try {
    new RegExp(source, "i");
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(path: string, warnings: string[]): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    warnings.push(`${path}: invalid JSON (${(err as Error).message}), ignored`);
    return undefined;
  }
}

/**
 * Layers, later wins: defaults, the repo's own `.grasp/config.json` (read only,
 * maintainers may commit one), then the user's workspace `config.json`.
 */
export async function loadConfig(repoRoot: string, workspaceDir?: string): Promise<LoadedConfig> {
  const warnings: string[] = [];
  const sources: string[] = [];
  let config = structuredClone(DEFAULT_CONFIG);
  const layers = [join(repoRoot, ".grasp", "config.json")];
  if (workspaceDir) layers.push(join(workspaceDir, "config.json"));
  for (const path of layers) {
    const raw = await readJsonIfExists(path, warnings);
    if (raw === undefined) continue;
    config = mergeConfig(config, raw, path, warnings);
    sources.push(path);
  }
  return { config, sources, warnings };
}
